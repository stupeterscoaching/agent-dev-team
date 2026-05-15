const { loadEnv } = require('./src/config');
loadEnv();

const Pipeline = require('./src/pipeline');

console.log('[agent-dev-team] Booting...');

const pipeline = new Pipeline();
pipeline.start().catch((err) => {
  console.error('[agent-dev-team] Fatal error:', err);
  process.exit(1);
});