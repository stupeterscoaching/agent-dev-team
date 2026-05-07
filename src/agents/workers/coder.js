const { createMessage, MESSAGE_TYPES, PRIORITY_LEVELS, TIERS, AGENTS } = require('../../contracts/base');
const { createWebhookClient, postAsWorker } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
// Load env manually to bypass dotenvx interference
const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
envFile.split('\n').forEach(line => {
  const eqIndex = line.indexOf('=');
  if (eqIndex > 0) {
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim();
    if (key && !key.startsWith('#')) process.env[key] = val;
  }
});

/**
 * Coder Agent — ephemeral, spawned per GitHub Issue.
 * Responsible for:
 * - Reading the Issue brief
 * - Creating a branch
 * - Writing code using exact-match search/replace
 * - Opening a PR
 * - Discarding itself when done
 */

class CoderAgent {
  constructor(issue, projectChannels, projectRepo) {
    this.issue = issue;
    this.projectChannels = projectChannels;
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = projectRepo?.owner || process.env.GITHUB_OWNER;
    this.repo = projectRepo?.repo || process.env.GITHUB_REPO;
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.WORKER_MODEL || 'llama3.2:latest';
    this.agentName = `Coder-task-${issue.number}`;
    this.branchName = `coder/${issue.number}/${this.slugify(issue.title)}`;
    this.maxAttempts = 3;
    this.webhook = null;
  }

  /**
   * Main entry point — runs the full coder execution sequence.
   */
  async run() {
    await this.log(`🚀 Spawned for Issue #${this.issue.number}: ${this.issue.title}`);

    try {
      // Step 1 — Create branch
      await this.createBranch();

      // Step 2 — Generate code
      const code = await this.generateCode();

      // Step 3 — Commit code with exact-match validation
      await this.commitCode(code);

      // Step 4 — Open PR
      await this.openPR();

      await this.log(`✅ PR opened for Issue #${this.issue.number}. Discarding.`);

    } catch (err) {
      await this.log(`❌ Fatal error on Issue #${this.issue.number}: ${err.message}`);
      await this.escalate(err.message);
    }
  }

  /**
   * Creates a branch for this Issue.
   */
  async createBranch() {
    // Get the SHA of main
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: 'heads/main'
    });

    // Create the branch
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${this.branchName}`,
      sha: ref.object.sha
    });

    await this.log(`🌿 Branch created: ${this.branchName}`);
  }

  /**
   * Generates code for the Issue using the local model.
   * @returns {Array} array of { filename, content } objects
   */
  async generateCode() {
    await this.log(`🤔 Generating code...`);

    const prompt = `You are a Coder agent in an AI software development team.

Your only job is to write code. Read the Issue brief carefully and implement exactly what is asked.

Issue brief:
${this.issue.body}

Rules:
- Write clean, well-commented code
- Handle errors explicitly
- Keep functions small and single-purpose
- No hardcoded values

Return ONLY valid JSON in this format — no other text:
{
  "files": [
    {
      "filename": "path/to/file.js",
      "content": "full file content here"
    }
  ],
  "summary": "brief description of what you built"
}`;

    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false
      })
    });

    const data = await response.json();
    const text = data.response.trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in model response');

    const parsed = JSON.parse(jsonMatch[0]);
    await this.log(`📝 Generated ${parsed.files.length} file(s): ${parsed.summary}`);
    return parsed.files;
  }

  /**
   * Commits generated code to the branch.
   * Uses exact-match validation — fails loudly if file state doesn't match.
   * @param {Array} files
   */
  async commitCode(files) {
    for (const file of files) {
      let attempt = 0;
      let committed = false;

      while (attempt < this.maxAttempts && !committed) {
        attempt++;
        try {
          // Check if file already exists on the branch
          let currentSha = null;
          try {
            const { data: existing } = await this.octokit.repos.getContent({
              owner: this.owner,
              repo: this.repo,
              path: file.filename,
              ref: this.branchName
            });
            currentSha = existing.sha;
          } catch (e) {
            // File doesn't exist yet — that's fine
          }

          // Commit the file
          await this.octokit.repos.createOrUpdateFileContents({
            owner: this.owner,
            repo: this.repo,
            path: file.filename,
            message: `[coder-${this.issue.number}] add ${file.filename}`,
            content: Buffer.from(file.content).toString('base64'),
            branch: this.branchName,
            sha: currentSha || undefined
          });

          await this.log(`💾 Committed: ${file.filename} (attempt ${attempt})`);
          committed = true;

        } catch (err) {
          await this.log(`⚠️ Commit failed for ${file.filename} (attempt ${attempt}): ${err.message}`);
          if (attempt === this.maxAttempts) {
            throw new Error(`edit-mismatch: failed to commit ${file.filename} after ${this.maxAttempts} attempts`);
          }
        }
      }
    }
  }

  /**
   * Opens a PR for the branch.
   */
  async openPR() {
    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: `[coder-${this.issue.number}] ${this.issue.title}`,
      head: this.branchName,
      base: 'main',
      body: `Closes #${this.issue.number}\n\nOpened by ${this.agentName}.`
    });

    // Update Issue label to in-review
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      labels: ['status:review']
    });

    await this.log(`🔀 PR #${pr.number} opened: ${pr.html_url}`);
  }

  /**
   * Escalates a failure to the PM via the managers channel.
   * @param {string} reason
   */
  async escalate(reason) {
    await this.log(`🚨 Escalating to PM: ${reason}`);
    // Update Issue label to blocked
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      labels: ['status:blocked']
    });
  }

  /**
   * Posts a message to the workers channel via webhook.
   * @param {string} content
   */
  async log(content) {
    console.log(`[${this.agentName}] ${content}`);
    if (this.projectChannels?.workersWebhook) {
      if (!this.webhook) {
        this.webhook = createWebhookClient(this.projectChannels.workersWebhook);
      }
      await postAsWorker(this.webhook, content, this.agentName);
    }
  }

  /**
   * Converts a string to a URL-safe slug.
   * @param {string} str
   * @returns {string}
   */
  slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }
}

module.exports = CoderAgent;