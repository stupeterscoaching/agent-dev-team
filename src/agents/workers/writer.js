const { createWebhookClient, postAsWorker } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Writer Agent — ephemeral, spawned per type:docs GitHub Issue.
 * Responsible for:
 * - Reading the Issue brief
 * - Generating written artifacts (docs, README, copy) via Ollama or Claude API
 * - Creating a branch and committing the output file(s)
 * - Opening a PR for Tech Lead review
 * - Discarding itself when done
 */

class WriterAgent {
  constructor(issue, projectChannels, projectRepo) {
    this.issue = issue;
    this.projectChannels = projectChannels;
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = projectRepo?.owner || process.env.GITHUB_OWNER;
    this.repo = projectRepo?.repo || process.env.GITHUB_REPO;
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.useClaudeApi = !!process.env.ANTHROPIC_API_KEY;
    this.model = process.env.WORKER_MODEL || (this.useClaudeApi ? 'claude-haiku-4-5-20251001' : 'llama3.2:latest');
    this.anthropic = this.useClaudeApi
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
    this.agentName = `Writer-task-${issue.number}`;
    this.branchName = `writer/${issue.number}/${this.slugify(issue.title)}`;
    this.maxAttempts = 3;
    this.webhook = null;
  }

  async run() {
    await this.log(`✍️ Spawned for Issue #${this.issue.number}: ${this.issue.title}`);

    try {
      await this.createBranch();
      const files = await this.generateContent();
      await this.commitFiles(files);
      await this.openPR();
      await this.log(`✅ PR opened for Issue #${this.issue.number}. Discarding.`);
    } catch (err) {
      await this.log(`❌ Fatal error on Issue #${this.issue.number}: ${err.message}`);
    }
  }

  async createBranch() {
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: 'heads/main',
    });

    try {
      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${this.branchName}`,
        sha: ref.object.sha,
      });
    } catch (err) {
      if (err.status === 422) {
        await this.octokit.git.deleteRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${this.branchName}`,
        });
        await this.octokit.git.createRef({
          owner: this.owner,
          repo: this.repo,
          ref: `refs/heads/${this.branchName}`,
          sha: ref.object.sha,
        });
      } else {
        throw err;
      }
    }

    await this.log(`🌿 Branch created: ${this.branchName}`);
  }

  async generateContent() {
    await this.log(`✍️ Generating content...`);
    return this.useClaudeApi
      ? this._generateWithClaude()
      : this._generateWithOllama();
  }

  async _generateWithClaude() {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: 'You are a Writer agent on an AI software development team. You produce clear, well-structured written artifacts — documentation, READMEs, changelogs, and copy.',
          cache_control: { type: 'ephemeral' },
        }
      ],
      messages: [
        {
          role: 'user',
          content: this._buildPrompt(),
        }
      ]
    });

    const text = response.content[0].text.trim();
    return this._parseFiles(text);
  }

  async _generateWithOllama() {
    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: this._buildPrompt(),
        stream: false,
        options: { temperature: 0.3 },
      })
    });

    const data = await response.json();
    return this._parseFiles(data.response.trim());
  }

  _buildPrompt() {
    return `You are a Writer agent. Produce the written artifact(s) described in this task.

Task: ${this.issue.title}

${this.issue.body}

Return ONLY a JSON object. No markdown, no backticks, no explanation.
Use this exact format:
{"files":[{"filename":"README.md","content":"# content here"}],"summary":"what you wrote"}

Use descriptive filenames based on the task. For example: README.md, CONTRIBUTING.md, docs/setup.md.`;
  }

  _parseFiles(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('No files array');
      return parsed.files;
    } catch (err) {
      return [
        {
          filename: `${this.slugify(this.issue.title)}.md`,
          content: `# ${this.issue.title}\n\n<!-- TODO: implement -->\n`,
        }
      ];
    }
  }

  async commitFiles(files) {
    for (const file of files) {
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
              ref: this.branchName,
            });
            currentSha = existing.sha;
          } catch (e) {
            // File doesn't exist yet
          }

          await this.octokit.repos.createOrUpdateFileContents({
            owner: this.owner,
            repo: this.repo,
            path: file.filename,
            message: `[writer-${this.issue.number}] add ${file.filename}`,
            content: Buffer.from(file.content).toString('base64'),
            branch: this.branchName,
            sha: currentSha || undefined,
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

  async openPR() {
    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: `[writer-${this.issue.number}] ${this.issue.title}`,
      head: this.branchName,
      base: 'main',
      body: `Closes #${this.issue.number}\n\nOpened by ${this.agentName}.`,
    });

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      labels: ['status:review'],
    });

    await this.log(`🔀 PR #${pr.number} opened: ${pr.html_url}`);
  }

  async log(content) {
    console.log(`[${this.agentName}] ${content}`);
    if (this.projectChannels?.workersWebhook) {
      if (!this.webhook) {
        this.webhook = createWebhookClient(this.projectChannels.workersWebhook);
      }
      await postAsWorker(this.webhook, content, this.agentName);
    }
  }

  slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }
}

module.exports = WriterAgent;
