const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
require('dotenv').config();

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
      GatewayIntentBits.DirectMessages
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

    client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      if (reaction.message.id !== messageId) return;
      if (reaction.message.channelId !== channelId) return;

      clearTimeout(timer);

      if (reaction.emoji.name === '✅') resolve(true);
      else if (reaction.emoji.name === '❌') resolve(false);
    });
  });
}

module.exports = {
  createBotClient,
  createWebhookClient,
  postAsWorker,
  postToChannel,
  waitForApproval
};