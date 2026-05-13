const { createWebhookClient, postAsWorker } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
const Anthropic = require('@anthropic-ai/sdk');
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
 * Researcher Agent — ephemeral, spawned per type:research GitHub Issue.
 * Responsible for:
 * - Reading the Issue brief
 * - Producing a structured research report via Ollama or Claude API
 * - Posting the report as a comment on the Issue
 * - Closing the Issue
 * - Discarding itself when done
 */

class ResearcherAgent {
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
    this.agentName = `Researcher-task-${issue.number}`;
    this.webhook = null;
  }

  async run() {
    await this.log(`🔬 Spawned for Issue #${this.issue.number}: ${this.issue.title}`);

    try {
      const report = await this.conductResearch();
      await this.postReport(report);
      await this.log(`✅ Research complete for Issue #${this.issue.number}. Discarding.`);
    } catch (err) {
      await this.log(`❌ Fatal error on Issue #${this.issue.number}: ${err.message}`);
    }
  }

  async conductResearch() {
    await this.log(`🤔 Conducting research...`);
    return this.useClaudeApi
      ? this._researchWithClaude()
      : this._researchWithOllama();
  }

  async _researchWithClaude() {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: 'You are a Researcher agent on an AI software development team. You produce concise, actionable research reports to inform implementation work.',
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

    return response.content[0].text.trim() || this._fallbackReport();
  }

  async _researchWithOllama() {
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
    return data.response.trim() || this._fallbackReport();
  }

  _buildPrompt() {
    return `You are a Researcher agent. Produce a structured research report for the following task.

${this.issue.body}

Format your response as markdown with these exact sections:

## Research Report: ${this.issue.title}

### Summary
One or two sentences describing what was researched and the key finding.

### Findings
Bullet points covering the most relevant technical facts, constraints, or context.

### Recommendations
Bullet points describing concrete next steps for the implementation team.

### References
Any relevant APIs, documentation, libraries, or resources (if applicable).`;
  }

  _fallbackReport() {
    return `## Research Report: ${this.issue.title}

### Summary
Automated research could not be completed. Manual review required.

### Findings
- Issue: ${this.issue.title}
- See issue body for full context.

### Recommendations
- Review the issue brief manually before implementation.

### References
- N/A`;
  }

  async postReport(report) {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      body: report,
    });

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issue.number,
      state: 'closed',
    });

    await this.log(`📋 Report posted and Issue #${this.issue.number} closed.`);
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
}

module.exports = ResearcherAgent;
