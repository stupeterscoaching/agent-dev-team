const fs = require('fs');
const path = require('path');

// The manual env loader to inject
const loaderCode = `// Load env manually to bypass dotenvx interference
const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
envFile.split('\\n').forEach(line => {
  const eqIndex = line.indexOf('=');
  if (eqIndex > 0) {
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim();
    if (key && !key.startsWith('#')) process.env[key] = val;
  }
});`;

// Files to update
const files = [
  'index.js',
  'src/agents/director/index.js',
  'src/agents/managers/pm.js',
  'src/agents/managers/techlead.js',
  'src/agents/workers/coder.js',
  'src/pipeline/index.js',
  'src/discord/client.js'
];

files.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} — not found`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes("require('dotenv').config()")) {
    content = content.replace("require('dotenv').config();", loaderCode);
    fs.writeFileSync(filePath, content);
    console.log(`✅ Updated: ${file}`);
  } else {
    console.log(`⬜ No dotenv found: ${file}`);
  }
});

console.log('Done.');