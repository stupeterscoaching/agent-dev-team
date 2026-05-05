const fs = require('fs');
const path = require('path');
 
// Read env file directly
const envFile = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
envFile.split('\n').forEach(line => {
  const eqIndex = line.indexOf('=');
  if (eqIndex > 0) {
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
});
 
console.log('Token first 8:', process.env.GITHUB_TOKEN?.slice(0, 8));
 
const { Octokit } = require('@octokit/rest');
const o = new Octokit({ auth: process.env.GITHUB_TOKEN });
o.users.getAuthenticated()
  .then(r => console.log('Authenticated as:', r.data.login))
  .catch(e => console.error('Auth failed:', e.message));