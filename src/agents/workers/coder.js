const { createMessage, MESSAGE_TYPES, PRIORITY_LEVELS, TIERS, AGENTS } = require('../../contracts/base');
const { createWebhookClient, postAsWorker } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
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
 * - Creating a branch in the project repo
 * - Writing code using the local model
 * - Opening a PR in the project repo
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
      await this.createBranch();
      const code = await this.generateCode();
      await this.commitCode(code);
      await this.openPR();
      await this.log(`✅ PR opened for Issue #${this.issue.number}. Discarding.`);
    } catch (err) {
      await this.log(`❌ Fatal error on Issue #${this.issue.number}: ${err.message}`);
      await this.escalate(err.message);
    }
  }

  /**
   * Creates a branch for this Issue in the project repo.
   */
  async createBranch() {
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: 'heads/main'
    });

    try {
  await this.octokit.git.createRef({
    owner: this.owner,
    repo: this.repo,
    ref: `refs/heads/${this.branchName}`,
    sha: ref.object.sha
  });
} catch (err) {
  if (err.status === 422) {
    // Branch already exists — delete and recreate
    await this.octokit.git.deleteRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branchName}`
    });
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${this.branchName}`,
      sha: ref.object.sha
    });
  } else {
    throw err;
  }
}

    await this.log(`🌿 Branch created: ${this.branchName}`);
  }

  /**
   * Generates code for the Issue using the local model.
   * Falls back to a placeholder if the model returns malformed JSON.
   * @returns {Array} array of { filename, content } objects
   */
  async generateCode() {
    await this.log(`🤔 Generating code...`);

    const prompt = `You are a Coder agent. Write code for this task.

${this.issue.body}

Return ONLY a JSON object. No markdown, no backticks, no explanation.
Use this exact format:
{"files":[{"filename":"index.js","content":"// code here"}],"summary":"what you built"}

Use unique descriptive filenames based on the task. For example: calculator-backend.js, calculator-frontend.html, calculator-styles.css.
Keep filenames simple, no paths, no leading dots or slashes.`;

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
      const parsed = JSON.parse(jsonMatch[0]);
      await this.log(`📝 Generated ${parsed.files.length} file(s): ${parsed.summary}`);
      return parsed.files;
    } catch (err) {
      await this.log(`⚠️ JSON parse failed, using fallback template`);
      return [
        {
          filename: `${this.slugify(this.issue.title)}.js`,
          content: `// Auto-generated placeholder for: ${this.issue.title}\n// TODO: implement\nconsole.log('${this.issue.title}');`
        }
      ];
    }
  }

  /**
   * Commits generated code to the branch.
   * @param {Array} files
   */
  async commitCode(files) {
    for (const file of files) {
      // Sanitize filename
      file.filename = file.filename.replace(/^\.\//, '');

      let attempt = 0;
      let committed = false;

      while (attempt < this.maxAttempts && !committed) {
        attempt++;
        try {
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
            throw new Error(`edit-mismatch: failed to commit ${file.filename} after ${this.maxAttempts} attempts`, { cause: err });
          }
        }
      }
    }
  }

  /**
   * Opens a PR for the branch in the project repo.
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

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      labels: ['status:review']
    });

    await this.log(`🔀 PR #${pr.number} opened: ${pr.html_url}`);
  }

  /**
   * Escalates a failure — updates Issue label to blocked.
   * @param {string} reason
   */
  async escalate(reason) {
  await this.log(`🚨 Escalating: ${reason}`);

  // Post to #alerts
  try {
    const { postToChannel, createBotClient } = require('../../discord/client');
    const alertClient = createBotClient(process.env.DIRECTOR_TOKEN);
    alertClient.once('clientReady', async () => {
      await postToChannel(
        alertClient,
        process.env.DISCORD_CHANNEL_ALERTS,
        `🚨 **Worker Escalation**\n**Agent:** ${this.agentName}\n**Issue:** #${this.issue.number} — ${this.issue.title}\n**Reason:** ${reason}`
      );
      alertClient.destroy();
    });
  } catch (err) {
    console.error(`[${this.agentName}] Failed to post alert: ${err.message}`);
  }

  // Update Issue label to blocked
  try {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      labels: ['status:blocked']
    });
  } catch (err) {
    await this.log(`⚠️ Could not update Issue label: ${err.message}`);
  }
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