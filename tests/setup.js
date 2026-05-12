const fs = require('fs');
const original = fs.readFileSync.bind(fs);

// Intercept .env reads at module load time so no real credentials are needed
fs.readFileSync = function (filePath, encoding) {
  if (String(filePath).endsWith('.env')) {
    return [
      'GITHUB_TOKEN=test-token',
      'GITHUB_OWNER=test-owner',
      'GITHUB_REPO=test-repo',
      'DIRECTOR_TOKEN=test-director-token',
      'PM_TOKEN=test-pm-token',
      'TECHLEAD_TOKEN=test-techlead-token',
      'DISCORD_GUILD_ID=test-guild',
      'DISCORD_CHANNEL_DIRECTOR=test-channel-director',
      'DISCORD_CHANNEL_APPROVALS=test-channel-approvals',
      'DISCORD_CHANNEL_ALERTS=test-channel-alerts',
      'DISCORD_WEBHOOK_WORKERS=https://discord.com/api/webhooks/test',
      'OLLAMA_BASE_URL=http://127.0.0.1:11434',
      'DIRECTOR_MODEL=llama3.1:8b',
      'MANAGER_MODEL=llama3.1:8b',
      'WORKER_MODEL=llama3.2:latest',
      'CURRENCY=CAD',
    ].join('\n');
  }
  return original(filePath, encoding);
};
