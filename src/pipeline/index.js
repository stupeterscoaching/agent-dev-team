const Director = require('../agents/director');
const PMAgent = require('../agents/managers/pm');
const TechLeadAgent = require('../agents/managers/techlead');
const CoderAgent = require('../agents/workers/coder');
const { Octokit } = require('@octokit/rest');
// Load env manually to bypass dotenvx interference
const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
envFile.split('\n').forEach(line => {
  const eqIndex = line.indexOf('=');
  if (eqIndex > 0) {
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim();
    if (key && !key.startsWith('#')) process.env[key] = val;
  }
});

class Pipeline {
  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
    this.activeProjects = {};
  }

  async start() {
    console.log('[Pipeline] Starting...');
    this.director = new Director();
    this.director.spawnManagers = this.spawnManagers.bind(this);
    console.log('[Pipeline] Director online. Waiting for project brief.');
  }

  async spawnManagers(spec) {
    const projectName = spec.spec.projectName;
    console.log(`[Pipeline] Spawning managers for: ${projectName}`);

    const projectChannels = await this.createProjectChannels(projectName);

    this.activeProjects[projectName] = {
      spec: spec.spec,
      channels: projectChannels,
      pm: null,
      techLead: null
    };

    const pm = new PMAgent(spec.spec, projectChannels);
    const techLead = new TechLeadAgent(spec.spec, projectChannels);

    this.activeProjects[projectName].pm = pm;
    this.activeProjects[projectName].techLead = techLead;

    console.log(`[Pipeline] PM and Tech Lead instantiated for: ${projectName}`);

    await Promise.all([
  pm.run().catch(err => console.error('[PM] Error:', err.message)),
  techLead.run().catch(err => console.error('[TechLead] Error:', err.message))
]);
  }

  async createProjectChannels(projectName) {
    console.log(`[Pipeline] Using org-wide channels for project: ${projectName}`);
    return {
      director: process.env.DISCORD_CHANNEL_DIRECTOR,
      managers: process.env.DISCORD_CHANNEL_DIRECTOR,
      workers: process.env.DISCORD_CHANNEL_DIRECTOR,
      output: process.env.DISCORD_CHANNEL_DIRECTOR,
      workersWebhook: process.env.DISCORD_WEBHOOK_WORKERS || null
    };
  }

  async watchIssues(projectName) {
    console.log(`[Pipeline] Watching Issues for project: ${projectName}`);
    const project = this.activeProjects[projectName];

    const poll = async () => {
        console.log(`[Pipeline] Polling for Issues with label: project:${projectName},status:backlog`);

      try {
        const { data: issues } = await this.octokit.issues.listForRepo({
          owner: this.owner,
          repo: this.repo,
          state: 'open',
          labels: `project:${projectName},status:backlog`
        });

        for (const issue of issues) {
          await this.spawnWorker(issue, project.channels);
        }
      } catch (err) {
        console.error(`[Pipeline] Issue watch error: ${err.message}`);
      }

      setTimeout(poll, 30000);
    };

    poll();
  }

  async spawnWorker(issue, projectChannels) {
    console.log(`[Pipeline] Spawning worker for Issue #${issue.number}: ${issue.title}`);

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issue.number,
      labels: ['status:in-progress']
    });

    const worker = new CoderAgent(issue, projectChannels);
    await worker.run();
  }
}

module.exports = Pipeline;