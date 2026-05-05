const { Client, GatewayIntentBits, WebhookClient, Partials } = require('discord.js');
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
 * Creates a persistent Discord bot client for Director/Auditor/Efficiency-Director.
 * @param {string} token - Bot token from .env
 * @returns {Client}
 */
function createBotClient(token) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction
    ]
  });

  client.login(token);
  return client;
}

/**
 * Creates a webhook client for ephemeral worker posts.
 * Workers use webhooks instead of bot tokens.
 * @param {string} webhookUrl
 * @returns {WebhookClient}
 */
function createWebhookClient(webhookUrl) {
  return new WebhookClient({ url: webhookUrl });
}

/**
 * Posts a message as a worker via webhook.
 * @param {WebhookClient} webhook
 * @param {string} content
 * @param {string} agentName - e.g. "Coder-task-042"
 */
async function postAsWorker(webhook, content, agentName) {
  await webhook.send({
    content,
    username: agentName,
  });
}

/**
 * Posts a message to a channel via a bot client.
 * @param {Client} client
 * @param {string} channelId
 * @param {string} content
 */
async function postToChannel(client, channelId, content) {
  const channel = await client.channels.fetch(channelId);
  await channel.send(content);
}

/**
 * Waits for a ✅ or ❌ reaction in #approvals from the executive.
 * Resolves true for ✅, false for ❌.
 * @param {Client} client
 * @param {string} messageId
 * @param {string} channelId
 * @param {number} timeoutMs - default 24 hours
 * @returns {Promise<boolean>}
 */
function waitForApproval(client, messageId, channelId, timeoutMs = 86400000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Approval timed out'));
    }, timeoutMs);

    const handler = (message) => {
      if (message.author.bot) return;
      if (message.channelId !== channelId) return;

      const content = message.content.trim().toLowerCase();

      if (content === 'approve') {
        console.log(`[Approval] ✅ Approved by ${message.author.tag}`);
        clearTimeout(timer);
        client.off('messageCreate', handler);
        resolve(true);
      } else if (content === 'reject') {
        console.log(`[Approval] ❌ Rejected by ${message.author.tag}`);
        clearTimeout(timer);
        client.off('messageCreate', handler);
        resolve(false);
      }
    };

    client.on('messageCreate', handler);
  });
}

module.exports = {
  createBotClient,
  createWebhookClient,
  postAsWorker,
  postToChannel,
  waitForApproval
};