const { createBotClient, postToChannel } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
// Suppress Octokit request logging
process.env.NODE_DEBUG = '';

/**
 * Tech Lead Agent — ephemeral, spawned per project alongside PM.
 * Responsible for:
 * - Defining coding standards for the project
 * - Reviewing worker PRs and scoring quality
 * - Merging or rejecting PRs in the project repo
 */

class TechLeadAgent {
  constructor(spec, projectChannels) {
    this.spec = spec;
    this.projectChannels = projectChannels;
    this.client = createBotClient(process.env.TECHLEAD_TOKEN);
    this.hasSeparateGitHubAccount = !!process.env.TECHLEAD_GITHUB_TOKEN;
    this.octokit = new Octokit({ auth: process.env.TECHLEAD_GITHUB_TOKEN || process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.MANAGER_MODEL || 'llama3.1:8b';

    this.ready = new Promise((resolve) => {
      this.client.once('clientReady', () => {
        console.log(`[TechLead] Online as ${this.client.user.tag}`);
        resolve();
      });
    });
  }

  /**
   * Main entry point — defines coding standards and starts listening for PRs.
   */
  async run() {
    await this.ready;
    await this.postToManagers(`🔧 Tech Lead online for project: **${this.spec.projectName}**`);
    await this.defineCodingStandards();
    await this.postToManagers(`📐 Coding standards set. Watching for PRs.`);
  }

  /**
   * Defines coding standards for this project.
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
   * Reviews a PR opened by a worker in the project repo.
   * Scores quality, posts comment, merges or rejects.
   * @param {number} prNumber
   * @param {object} projectRepo — { owner, repo, defaultBranch }
   * @returns {object} review result
   */
  async reviewPR(prNumber, projectRepo) {
    const owner = projectRepo?.owner || this.owner;
    const repo = projectRepo?.repo || this.repo;

    await this.postToManagers(`🔍 Reviewing PR #${prNumber} in ${owner}/${repo}...`);

    // Fetch PR details
    const pr = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    });

    // Fetch PR files
    const diff = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber
    });

    const filesChanged = diff.data.map(f => ({
      filename: f.filename,
      changes: f.changes,
      patch: f.patch
    }));

    // Score the PR with the local model
    const score = await this.scorePR(pr.data, filesChanged);

    if (score.score >= 3) {
      if (this.hasSeparateGitHubAccount) {
        await this.octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          event: 'APPROVE',
          body: `✅ Tech Lead review complete.\n\n**Score: ${score.score}/10**\n\n${score.feedback}`
        });
      } else {
        await this.octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `✅ Tech Lead review complete.\n\n**Score: ${score.score}/10**\n\n${score.feedback}`
        });
      }

      await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'squash'
      });

      // Close the Issue
      const issueMatch = pr.data.body?.match(/Closes #(\d+)/);
      if (issueMatch) {
        await this.octokit.issues.update({
          owner,
          repo,
          issue_number: parseInt(issueMatch[1]),
          state: 'closed'
        });
        console.log(`[TechLead] Closed Issue #${issueMatch[1]}`);
      }

      console.log(`[TechLead] ✅ PR #${prNumber} merged in ${owner}/${repo}. Score: ${score.score}/10`);
      await this.postToManagers(
        `✅ PR #${prNumber} merged in ${owner}/${repo}. Score: ${score.score}/10\n${score.feedback}`
      );

      await new Promise(resolve => setTimeout(resolve, 8000));
      await this.checkProjectComplete(owner, repo, prNumber);

      return { approved: true, score };

    } else {
      if (this.hasSeparateGitHubAccount) {
        await this.octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          event: 'REQUEST_CHANGES',
          body: `❌ Tech Lead review — changes needed.\n\n**Score: ${score.score}/10**\n\n${score.feedback}`
        });
      } else {
        await this.octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `❌ Tech Lead review — changes needed.\n\n**Score: ${score.score}/10**\n\n${score.feedback}`
        });
      }

      await this.postToManagers(
        `❌ PR #${prNumber} rejected in ${owner}/${repo}. Score: ${score.score}/10\n${score.feedback}`
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
    const prompt = `You are a Tech Lead reviewing a pull request.

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

Return ONLY valid JSON with no other text:
{"score":5,"feedback":"your feedback here","issues":[]}`;

    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0.1 }
      })
    });

    const data = await response.json();
    const text = data.response.trim();

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[TechLead] Failed to parse score JSON:', err.message);
      return { score: 5, feedback: 'Score parsing failed — review manually', issues: [] };
    }
  }

  /**
 * Checks if all PRs and Issues in the project repo are closed.
 * Posts a completion summary to #director if done.
 */
async checkProjectComplete(owner, repo) {
  try {
    const { data: openPRs } = await this.octokit.pulls.list({
      owner, repo, state: 'open'
    });

    const { data: openIssues } = await this.octokit.issues.listForRepo({
      owner, repo, state: 'open'
    });

    const filteredIssues = openIssues.filter(i => !i.pull_request && !i.html_url.includes('/pull/'));

    console.log(`[TechLead] checkProjectComplete: ${openPRs.length} open PRs, ${filteredIssues.length} open Issues`);

    if (openPRs.length === 0 && filteredIssues.length === 0) {
      console.log(`[TechLead] Project ${this.spec.projectName} appears complete.`);
      await postToChannel(
        this.client,
        process.env.DISCORD_CHANNEL_DIRECTOR,
        `✅ **Project ${this.spec.projectName} appears complete.**\n\n` +
        `All PRs merged and Issues closed.\n` +
        `Project repo: https://github.com/${owner}/${repo}\n\n` +
        `Type \`close: ${this.spec.projectName}\` to confirm and close, or open new Issues to continue.`
      );
    }
  } catch (err) {
    console.error(`[TechLead] Error checking project completion: ${err.message}`);
  }
}

  /**
   * Posts a message to the project's managers channel.
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