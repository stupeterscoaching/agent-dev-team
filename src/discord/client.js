const { Client, GatewayIntentBits, WebhookClient, Partials, ChannelType } = require('discord.js');

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
 * Waits for an approve/reject message in #approvals from the executive.
 * Resolves true for approve, false for reject or timeout.
 *
 * Accepts plain "approve"/"reject" for single-project scenarios.
 * Accepts "approve: {projectName}"/"reject: {projectName}" for multi-project disambiguation.
 * Both forms work simultaneously — the project-scoped form is encouraged when multiple
 * projects may be waiting for approval at the same time.
 *
 * @param {Client} client
 * @param {string} messageId
 * @param {string} channelId
 * @param {string|null} projectName - used for project-scoped approval matching
 * @param {number} timeoutMs - defaults to APPROVAL_TIMEOUT_MS env var or 30 minutes
 * @returns {Promise<boolean>}
 */
function waitForApproval(client, messageId, channelId, projectName = null, timeoutMs = parseInt(process.env.APPROVAL_TIMEOUT_MS) || 1800000) {
  const projectKey = projectName ? projectName.toLowerCase() : null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.off('messageCreate', handler);
      client.channels.fetch(channelId)
        .then(channel => channel.send('⏱️ Approval window closed — no response received. Treating as rejected.'))
        .catch(err => console.error('[Approval] Failed to post timeout message:', err.message));
      resolve(false);
    }, timeoutMs);

    const handler = (message) => {
      if (message.author.bot) return;
      if (message.channelId !== channelId) return;

      const content = message.content.trim().toLowerCase();
      const isApprove = content === 'approve' || (projectKey && content === `approve: ${projectKey}`);
      const isReject = content === 'reject' || (projectKey && content === `reject: ${projectKey}`);

      if (isApprove) {
        console.log(`[Approval] ✅ Approved by ${message.author.tag}`);
        clearTimeout(timer);
        client.off('messageCreate', handler);
        resolve(true);
      } else if (isReject) {
        console.log(`[Approval] ❌ Rejected by ${message.author.tag}`);
        clearTimeout(timer);
        client.off('messageCreate', handler);
        resolve(false);
      }
    };

    client.on('messageCreate', handler);
  });
}

/**
 * Creates a per-project Discord channel and a webhook inside it for workers.
 * @param {Client} client
 * @param {string} guildId
 * @param {string} projectName - already sanitized kebab-case name
 * @returns {Promise<{channelId: string|null, webhookUrl: string|null}>}
 */
async function createProjectChannel(client, guildId, projectName) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channelName = `proj-${projectName}`.slice(0, 100);

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `Agent activity for project: ${projectName}`,
    });

    const webhook = await channel.createWebhook({ name: 'Workers' });

    console.log(`[Discord] Created project channel: #${channelName} (${channel.id})`);
    return { channelId: channel.id, webhookUrl: webhook.url };
  } catch (err) {
    console.error(`[Discord] Failed to create project channel for ${projectName}: ${err.message}`);
    return { channelId: null, webhookUrl: null };
  }
}

/**
 * Archives a project channel by making it read-only and renaming it.
 * @param {Client} client
 * @param {string} channelId
 * @param {string} guildId
 */
async function archiveProjectChannel(client, channelId, guildId) {
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.permissionOverwrites.edit(guildId, { SendMessages: false });
    if (!channel.name.startsWith('archived-')) {
      await channel.setName(`archived-${channel.name}`);
    }
    console.log(`[Discord] Archived project channel: ${channelId}`);
  } catch (err) {
    console.error(`[Discord] Failed to archive project channel ${channelId}: ${err.message}`);
  }
}

module.exports = {
  createBotClient,
  createWebhookClient,
  postAsWorker,
  postToChannel,
  waitForApproval,
  createProjectChannel,
  archiveProjectChannel,
};