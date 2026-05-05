const fs = require('fs');
const path = require('path');

// Load env manually to bypass dotenvx interference
const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
envFile.split('\n').forEach(line => {
  const eqIndex = line.indexOf('=');
  if (eqIndex > 0) {
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim();
    if (key && !key.startsWith('#')) process.env[key] = val;
  }
});

const Pipeline = require('./src/pipeline');

console.log('[Boot] GITHUB_TOKEN first 8:', process.env.GITHUB_TOKEN?.slice(0, 8));

console.log('[agent-dev-team] Booting...');

const pipeline = new Pipeline();
pipeline.start().catch((err) => {
  console.error('[agent-dev-team] Fatal error:', err);
  process.exit(1);
});