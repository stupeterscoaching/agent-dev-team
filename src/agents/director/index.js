const { createMessage, MESSAGE_TYPES, PRIORITY_LEVELS, TIERS, AGENTS } = require('../../contracts/base');
const { createBotClient, postToChannel, waitForApproval } = require('../../discord/client');
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

const DIRECTOR_SYSTEM_PROMPT = `You are the Director of an AI software development team. You help executives define project specifications and coordinate work across PM, Tech Lead, and Coder agents. You are precise, technical, and always follow the exact output format requested.`;

/**
 * Director Agent — the only persistent agent in the system.
 * Collaborates with the executive to build project specs.
 * Spins up PM and Tech Lead on spec confirmation.
 */

class Director {
  constructor() {
    this.client = createBotClient(process.env.DIRECTOR_TOKEN);
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.useClaudeApi = !!process.env.ANTHROPIC_API_KEY;
    this.model = process.env.DIRECTOR_MODEL || (this.useClaudeApi ? 'claude-opus-4-7' : 'llama3.1:8b');
    this.anthropic = this.useClaudeApi
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;

    if (this.useClaudeApi) {
      console.log(`[Director] Using Claude API (${this.model})`);
    }

    this.ready = false;
    this.startTime = Date.now();

    this.client.once('clientReady', () => {
      console.log(`[Director] Online as ${this.client.user.tag}`);
      this.ready = true;
      this.listen();
    });
  }

  listen() {
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (message.channelId !== process.env.DISCORD_CHANNEL_DIRECTOR) return;
      if (message.createdTimestamp < this.startTime) return;

      console.log(`[Director] Received message: ${message.content}`);
      await this.handleMessage(message);
    });
  }

  async handleMessage(message) {
    const content = message.content.trim();

    if (content.toLowerCase().startsWith('brief:')) {
      const brief = content.slice(6).trim();
      await this.processBrief(brief, message);
      return;
    }

    if (content.toLowerCase().startsWith('close:')) {
      const projectName = content.slice(6).trim();
      await this.closeProject(projectName);
      return;
    }

    const text = await this.think(content);
    const truncated = text.length > 1900 ? text.slice(0, 1900) + '...' : text;
    await postToChannel(this.client, process.env.DISCORD_CHANNEL_DIRECTOR, truncated);
  }

  async processBrief(brief, originalMessage) {
    const directorChannel = process.env.DISCORD_CHANNEL_DIRECTOR;
    const approvalsChannel = process.env.DISCORD_CHANNEL_APPROVALS;

    await postToChannel(this.client, directorChannel, '📋 Brief received. Building project spec...');

    const spec = await this.buildSpec(brief);

    const summaryMessage =
      `**New Project Spec — Awaiting Approval**\n\n` +
      `**Project:** ${spec.spec.projectName}\n` +
      `**Goal:** ${spec.spec.brief.desiredOutcome}\n\n` +
      `**Deliverables:**\n${spec.spec.deliverables.map(d => `- ${d.name}: ${d.description}`).join('\n')}\n\n` +
      `**Tech Stack:** ${spec.spec.architecture.techStack.language} / ${spec.spec.architecture.techStack.packages.join(', ')}\n\n` +
      `Type \`approve\` to confirm or \`reject\` to request changes.`;

    const approvalMessage = await this.client.channels
      .fetch(approvalsChannel)
      .then(channel => channel.send(summaryMessage));

    await postToChannel(this.client, directorChannel, `Spec sent to #approvals. Waiting for your confirmation.`);

    try {
      const approved = await waitForApproval(this.client, approvalMessage.id, approvalsChannel);

      if (approved) {
        await postToChannel(this.client, directorChannel, `✅ Spec approved. Spinning up PM and Tech Lead...`);
        await this.spawnManagers(spec);
      } else {
        await postToChannel(this.client, directorChannel, `❌ Spec rejected. Send me a revised brief when ready.`);
      }
    } catch (err) {
      await postToChannel(this.client, process.env.DISCORD_CHANNEL_ALERTS, `⚠️ Approval timed out for project: ${spec.spec.projectName}`);
    }
  }

  async buildSpec(brief) {
    return this.useClaudeApi
      ? this._buildSpecWithClaude(brief)
      : this._buildSpecWithOllama(brief);
  }

  async _buildSpecWithClaude(brief) {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: DIRECTOR_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: `Given this project brief: "${brief}"\n\nRespond with ONLY valid JSON (no markdown, no backticks):\n{"projectName":"kebab-case-name","desiredOutcome":"one sentence describing what success looks like"}`
        }
      ]
    });

    const text = response.content[0].text.trim();
    let projectName = 'new-project';
    let desiredOutcome = brief;

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        projectName = (parsed.projectName || '').toLowerCase()
          .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
          || 'new-project';
        desiredOutcome = parsed.desiredOutcome || brief;
      }
    } catch (err) {
      console.error('[Director] Failed to parse Claude spec response:', err.message);
    }

    console.log(`[Director] Project name: ${projectName}`);
    return this._assembleSpec(projectName, desiredOutcome, brief);
  }

  async _buildSpecWithOllama(brief) {
    const nameResponse = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `Given this project brief: "${brief}"\n\nRespond with ONLY a short kebab-case project name (example: web-calculator). No other text.`,
        stream: false
      })
    });
    const nameData = await nameResponse.json();
    const rawName = nameData.response.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const projectName = rawName || 'new-project';
    console.log(`[Director] Project name: ${projectName}`);

    const goalResponse = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `Given this project brief: "${brief}"\n\nRespond with ONE sentence describing what success looks like. No other text.`,
        stream: false
      })
    });
    const goalData = await goalResponse.json();
    const desiredOutcome = goalData.response.trim();

    return this._assembleSpec(projectName, desiredOutcome, brief);
  }

  _assembleSpec(projectName, desiredOutcome, brief) {
    return {
      spec: {
        projectName,
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        brief: {
          problemStatement: brief,
          desiredOutcome,
          constraints: { technical: ['Node.js only', 'no external databases'] },
          antiGoals: ['no user authentication', 'no mobile app']
        },
        architecture: {
          overview: 'Single page web application with Express backend',
          components: [
            { name: 'frontend', description: 'HTML/CSS/JS user interface' },
            { name: 'backend', description: 'Express.js server' }
          ],
          techStack: {
            language: 'javascript',
            runtime: 'node',
            packages: ['express']
          }
        },
        team: {
          workers: ['coder'],
          managers: ['pm', 'techlead'],
          efficiency: false
        },
        deliverables: [
          {
            name: `${projectName}-frontend`,
            type: 'code',
            description: `HTML/CSS/JavaScript frontend for ${projectName}`,
            acceptanceCriteria: [
              'Page loads without errors',
              'User interface is functional',
              'All buttons and inputs work correctly'
            ]
          },
          {
            name: `${projectName}-backend`,
            type: 'code',
            description: `Express.js backend server for ${projectName}`,
            acceptanceCriteria: [
              'Server starts without errors',
              'API endpoints return correct responses',
              'Error handling is implemented'
            ]
          }
        ],
        openQuestions: []
      }
    };
  }

  async think(prompt) {
    return this.useClaudeApi
      ? this._thinkWithClaude(prompt)
      : this._thinkWithOllama(prompt);
  }

  async _thinkWithClaude(prompt) {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: DIRECTOR_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text.trim();
  }

  async _thinkWithOllama(prompt) {
    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `You are the Director of an AI software development team. ${prompt}`,
        stream: false
      })
    });

    const data = await response.json();
    return data.response.trim();
  }

  async closeProject(projectName) {
    const directorChannel = process.env.DISCORD_CHANNEL_DIRECTOR;
    console.log(`[Director] Closing project: ${projectName}`);

    await postToChannel(
      this.client,
      directorChannel,
      `🔒 Closing project **${projectName}**...`
    );

    if (this.onProjectClose) {
      await this.onProjectClose(projectName);
    }

    await postToChannel(
      this.client,
      directorChannel,
      `✅ Project **${projectName}** closed. Estimation history updated.`
    );
  }

  async spawnManagers(spec) {
    console.log(`[Director] Spawning managers for project: ${spec.spec.projectName}`);
    await postToChannel(
      this.client,
      process.env.DISCORD_CHANNEL_DIRECTOR,
      `🚀 PM and Tech Lead are being spun up for **${spec.spec.projectName}**. Stand by.`
    );
  }
}

module.exports = Director;
