const fs = require('fs');
const original = fs.readFileSync.bind(fs);

const TEST_ENV = [
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
];

// Set process.env directly so tests work regardless of which code path
// populates env vars. Agents used to load .env themselves at module load;
// now only index.js calls loadEnv() at boot, which never runs during tests.
TEST_ENV.forEach(entry => {
  const eq = entry.indexOf('=');
  process.env[entry.slice(0, eq)] = entry.slice(eq + 1);
});

// Also intercept fs.readFileSync for .env paths — keeps any code that still
// reads .env directly (e.g. src/config.js if imported in a test) consistent.
fs.readFileSync = function (filePath, encoding) {
  if (String(filePath).endsWith('.env')) return TEST_ENV.join('\n');
  return original(filePath, encoding);
};
