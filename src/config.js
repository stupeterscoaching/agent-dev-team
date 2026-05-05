const fs = require('fs');
const path = require('path');

// Bypass dotenvx interference — read .env directly
const envPath = path.join(process.cwd(), '.env');
const envFile = fs.readFileSync(envPath, 'utf8');

envFile.split('\n').forEach(line => {
  const eqIndex = line.indexOf('=');
  if (eqIndex > 0) {
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim();
    if (key && !key.startsWith('#')) {
      process.env[key] = val;
    }
  }
});