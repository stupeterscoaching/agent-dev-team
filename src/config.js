const fs = require('fs');
const path = require('path');

// Loads .env from CWD into process.env. Silently skips if the file is absent
// (CI, Docker, etc. set env vars directly). Safe to call multiple times — later
// calls overwrite earlier values, same as the file-per-agent pattern it replaces.
function loadEnv() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const stripped = line.replace(/^export\s+/, '');
    const eqIndex = stripped.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = stripped.slice(0, eqIndex).trim();
    if (!key || key.startsWith('#')) continue;

    let val = stripped.slice(eqIndex + 1).trim();
    val = val.replace(/\s+#.*$/, '');                          // strip inline comments
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);     // strip surrounding quotes

    process.env[key] = val;
  }
}

module.exports = { loadEnv };
