const { createMessage, MESSAGE_TYPES, PRIORITY_LEVELS, TIERS, AGENTS } = require('../../contracts/base');
const { createBotClient, postToChannel, waitForApproval } = require('../../discord/client');
require('dotenv').config();

/**
 * Director Agent — the only persistent agent in the system.
 * Collaborates with the executive to build project specs.
 * Spins up PM and Tech Lead on spec confirmation.
 */

class Director {
  constructor() {
    this.client = createBotClient(process.env.DIRECTOR_TOKEN);
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.DIRECTOR_MODEL || 'llama3.1:8b';
    this.ready = false;

    this.client.once('ready', () => {
      console.log(`[Director] Online as ${this.client.user.tag}`);
      this.ready = true;
      this.listen();
    });
  }

  /**
   * Listens for messages in the #director channel.
   * Executive communicates with the Director here.
   */
  listen() {
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (message.channelId !== process.env.DISCORD_CHANNEL_DIRECTOR) return;

      console.log(`[Director] Received message: ${message.content}`);
      await this.handleMessage(message);
    });
  }

  /**
   * Handles incoming messages from the executive.
   * @param {Message} message - Discord message
   */
  async handleMessage(message) {
    const content = message.content.trim();

    // New project brief
    if (content.toLowerCase().startsWith('brief:')) {
      const brief = content.slice(6).trim();
      await this.processBrief(brief, message);
      return;
    }

    // General conversation with Director
    const response = await this.think(content);
    await postToChannel(this.client, process.env.DISCORD_CHANNEL_DIRECTOR, response);
  }

  /**
   * Processes a new project brief from the executive.
   * Builds a spec and sends it to #approvals for confirmation.
   * @param {string} brief
   * @param {Message} originalMessage
   */
  async processBrief(brief, originalMessage) {
    const directorChannel = process.env.DISCORD_CHANNEL_DIRECTOR;
    const approvalsChannel = process.env.DISCORD_CHANNEL_APPROVALS;

    await postToChannel(this.client, directorChannel, '📋 Brief received. Building project spec...');

    const spec = await this.buildSpec(brief);
    const specJson = JSON.stringify(spec, null, 2);

    // Post spec to #approvals for executive confirmation
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

  /**
   * Builds a project spec from a brief using the local model.
   * @param {string} brief
   * @returns {object} spec
   */
  async buildSpec(brief) {
    const prompt = `You are the Director of an AI software development team.
    
An executive has given you the following project brief:
"${brief}"

Build a structured project spec in JSON format. Return ONLY valid JSON, no other text.

The JSON must follow this structure exactly:
{
  "spec": {
    "projectName": "short-kebab-case-name",
    "version": "1.0.0",
    "createdAt": "${new Date().toISOString()}",
    "brief": {
      "problemStatement": "what problem this solves and for who",
      "desiredOutcome": "what success looks like",
      "constraints": {
        "technical": []
      },
      "antiGoals": []
    },
    "architecture": {
      "overview": "brief architecture description",
      "components": [],
      "techStack": {
        "language": "javascript",
        "runtime": "node",
        "packages": []
      }
    },
    "team": {
      "workers": ["coder"],
      "managers": ["pm", "techlead"],
      "efficiency": false
    },
    "deliverables": [
      {
        "name": "string",
        "type": "code",
        "description": "string",
        "acceptanceCriteria": []
      }
    ],
    "openQuestions": []
  }
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

    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[Director] Failed to parse spec JSON:', err);
      // Return a basic fallback spec
      return {
        spec: {
          projectName: 'unknown-project',
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          brief: { problemStatement: brief, desiredOutcome: 'TBD', constraints: { technical: [] }, antiGoals: [] },
          architecture: { overview: 'TBD', components: [], techStack: { language: 'javascript', runtime: 'node', packages: [] } },
          team: { workers: ['coder'], managers: ['pm', 'techlead'], efficiency: false },
          deliverables: [],
          openQuestions: ['Spec parsing failed — please review and resubmit brief']
        }
      };
    }
  }

  /**
   * General purpose thinking — sends a prompt to the local model.
   * @param {string} prompt
   * @returns {string}
   */
  async think(prompt) {
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

  /**
   * Spins up PM and Tech Lead for a confirmed project.
   * @param {object} spec
   */
  async spawnManagers(spec) {
    // This will be implemented when we build the PM and Tech Lead agents
    console.log(`[Director] Spawning managers for project: ${spec.spec.projectName}`);
    await postToChannel(
      this.client,
      process.env.DISCORD_CHANNEL_DIRECTOR,
      `🚀 PM and Tech Lead are being spun up for **${spec.spec.projectName}**. Stand by.`
    );
  }
}

module.exports = Director;