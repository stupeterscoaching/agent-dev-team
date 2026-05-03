const { createMessage, MESSAGE_TYPES, PRIORITY_LEVELS, TIERS, AGENTS } = require('../../contracts/base');
const { createBotClient, postToChannel } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

/**
 * Tech Lead Agent — ephemeral, spawned per project alongside PM.
 * Responsible for:
 * - Defining coding standards for the project
 * - Reviewing worker PRs and scoring quality
 * - Merging or rejecting PRs
 * - Collaborating with PM on cost estimates
 */

class TechLeadAgent {
  constructor(spec, projectChannels) {
    this.spec = spec;
    this.projectChannels = projectChannels;
    this.client = createBotClient(process.env.TECHLEAD_TOKEN);
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.MANAGER_MODEL || 'llama3.1:8b';

    this.client.once('ready', () => {
      console.log(`[TechLead] Online as ${this.client.user.tag}`);
      this.listen();
    });
  }

  /**
   * Main entry point — defines coding standards and starts listening for PRs.
   */
  async run() {
    await this.postToManagers(`🔧 Tech Lead online for project: **${this.spec.projectName}**`);
    await this.defineCodingStandards();
    await this.postToManagers(`📐 Coding standards set. Watching for PRs.`);
  }

  /**
   * Listens for new PRs and reviews them.
   */
  listen() {
    // PR review is triggered by the pipeline — see pipeline/index.js
    console.log(`[TechLead] Listening for PR review requests.`);
  }

  /**
   * Defines coding standards for this project.
   * These are included in every worker's Issue brief.
   * @returns {object} standards
   */
  async defineCodingStandards() {
    const { techStack } = this.spec.architecture;

    this.standards = {
      language: techStack.language,
      rules: [
        'Use clear, descriptive variable and function names',
        'Add a comment above every function explaining what it does',
        'Handle all errors explicitly — no silent failures',
        'Keep functions small and single-purpose',
        'No hardcoded values — use constants or config',
        'Use exact-match search/replace blocks for all file edits'
      ],
      fileStructure: this.spec.architecture.components,
      techStack
    };

    await this.postToManagers(
      `📐 Coding standards defined:\n\`\`\`json\n${JSON.stringify(this.standards, null, 2)}\n\`\`\``
    );

    return this.standards;
  }

  /**
   * Reviews a PR opened by a worker.
   * Scores quality and merges or rejects.
   * @param {number} prNumber
   * @returns {object} review result
   */
  async reviewPR(prNumber) {
    await this.postToManagers(`🔍 Reviewing PR #${prNumber}...`);

    // Fetch PR details
    const pr = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber
    });

    // Fetch PR diff
    const diff = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber
    });

    const filesChanged = diff.data.map(f => ({
      filename: f.filename,
      changes: f.changes,
      patch: f.patch
    }));

    // Score the PR with the local model
    const score = await this.scorePR(pr.data, filesChanged);

    if (score.score >= 7) {
      // Approve and merge
      await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        event: 'APPROVE',
        body: `✅ Approved. Quality score: ${score.score}/10\n\n${score.feedback}`
      });

      await this.octokit.pulls.merge({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        merge_method: 'squash'
      });

      // Close the Issue
      const issueNumber = pr.data.body?.match(/#(\d+)/)?.[1];
      if (issueNumber) {
        await this.octokit.issues.update({
          owner: this.owner,
          repo: this.repo,
          issue_number: parseInt(issueNumber),
          state: 'closed',
          labels: ['status:complete']
        });
      }

      await this.postToManagers(
        `✅ PR #${prNumber} merged. Score: ${score.score}/10\n${score.feedback}`
      );

      return { approved: true, score };

    } else {
      // Reject — add feedback to Issue for worker to retry
      await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        event: 'REQUEST_CHANGES',
        body: `❌ Changes requested. Quality score: ${score.score}/10\n\n${score.feedback}`
      });

      await this.postToManagers(
        `❌ PR #${prNumber} rejected. Score: ${score.score}/10\n${score.feedback}`
      );

      return { approved: false, score };
    }
  }

  /**
   * Scores a PR using the local model.
   * @param {object} pr
   * @param {array} files
   * @returns {object} { score, feedback }
   */
  async scorePR(pr, files) {
    const prompt = `You are a Tech Lead reviewing a pull request for a software project.

Coding standards:
${JSON.stringify(this.standards?.rules || [], null, 2)}

PR title: ${pr.title}
PR description: ${pr.body}

Files changed:
${JSON.stringify(files, null, 2)}

Score this PR from 1-10 based on:
- Does it meet the acceptance criteria?
- Does it follow coding standards?
- Is the code clear and well-commented?
- Are errors handled?

Return ONLY valid JSON:
{
  "score": 0,
  "feedback": "specific, actionable feedback",
  "issues": []
}`;

    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false })
    });

    const data = await response.json();
    const text = data.response.trim();

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[TechLead] Failed to parse score JSON:', err);
      return { score: 5, feedback: 'Score parsing failed — review manually', issues: [] };
    }
  }

  /**
   * Posts a message to the project's #managers channel.
   * @param {string} content
   */
  async postToManagers(content) {
    await postToChannel(this.client, this.projectChannels.managers, content);
  }

  /**
   * Discards this Tech Lead agent — called when project closes.
   */
  async discard() {
    console.log(`[TechLead] Discarding for project: ${this.spec.projectName}`);
    await this.client.destroy();
  }
}

module.exports = TechLeadAgent;