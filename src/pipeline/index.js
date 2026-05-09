const Director = require('../agents/director');
const PMAgent = require('../agents/managers/pm');
const TechLeadAgent = require('../agents/managers/techlead');
const CoderAgent = require('../agents/workers/coder');
const { Octokit } = require('@octokit/rest');
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
    this.director.onProjectClose = this.closeProject.bind(this);
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

    // Tech Lead fires immediately — no approval needed
    techLead.run().catch(err => console.error('[TechLead] Error:', err.message));

    // PM runs, then starts watchers when done
    pm.run()
      .then(() => {
        console.log(`[Pipeline] PM finished. Starting watchers for: ${projectName}`);
        const projectRepo = pm.projectRepo;
        this.watchIssues(projectName, projectRepo);
        this.watchPRs(projectName, projectRepo);
      })
      .catch(err => console.error('[PM] Error:', err.message));
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

  async watchIssues(projectName, projectRepo) {
    console.log(`[Pipeline] Watching Issues for project: ${projectName}`);
    const project = this.activeProjects[projectName];

    project.spawnedIssues = new Set();
    const spawnedIssues = project.spawnedIssues;
    
    const poll = async () => {
      console.log(`[Pipeline] Polling project repo for open Issues...`);
      try {
        const owner = projectRepo?.owner || this.owner;
        const repo = projectRepo?.repo || this.repo;

        const { data: issues } = await this.octokit.issues.listForRepo({
            owner,
            repo,
            state: 'open'
        });

        // Filter out pull requests — GitHub returns PRs in the Issues list
        const filteredIssues = issues.filter(i => !i.pull_request && !i.html_url.includes('/pull/'));

        console.log(`[Pipeline] Found ${filteredIssues.length} open Issues in ${owner}/${repo}`);
            if (filteredIssues.length > 0) {
            filteredIssues.forEach(i => console.log(`  - #${i.number}: ${i.title}`));
            }

            for (const issue of filteredIssues) {
            if (spawnedIssues.has(issue.number)) continue;
            spawnedIssues.add(issue.number);
            await this.spawnWorker(issue, project.channels, projectRepo);
            }
      } catch (err) {
        console.error(`[Pipeline] Issue watch error: ${err.message}`);
      }

      setTimeout(poll, 30000);
    };

    // Wait 5 seconds before first poll to let GitHub index the new Issues
    setTimeout(poll, 5000);
  }

  async watchPRs(projectName, projectRepo) {
    console.log(`[Pipeline] Watching PRs for project: ${projectName}`);
    const project = this.activeProjects[projectName];
    const reviewedPRs = new Set();

    const poll = async () => {
      try {
        // Watch PRs in the project repo, not agent-dev-team
        const owner = projectRepo?.owner || this.owner;
        const repo = projectRepo?.repo || this.repo;

        const { data: prs } = await this.octokit.pulls.list({
          owner,
          repo,
          state: 'open'
        });

        for (const pr of prs) {
          if (reviewedPRs.has(pr.number)) continue;
          reviewedPRs.add(pr.number);
          console.log(`[Pipeline] PR found for review: #${pr.number}`);
          const result = await project.techLead.reviewPR(pr.number, projectRepo);
          if (!result.approved) {
            // Get the Issue number from the PR and remove from spawnedIssues
            const issueMatch = pr.body?.match(/Closes #(\d+)/);
            if (issueMatch) {
              const issueNumber = parseInt(issueMatch[1]);
              console.log(`[Pipeline] PR rejected — requeueing Issue #${issueNumber}`);
              project.spawnedIssues.delete(issueNumber);
            }
          }
        }
      } catch (err) {
        console.error(`[Pipeline] PR watch error: ${err.message}`);
      }

      setTimeout(poll, 30000);
    };

    setTimeout(poll, 10000);
  }

  async spawnWorker(issue, projectChannels, projectRepo) {
    console.log(`[Pipeline] Spawning worker for Issue #${issue.number}: ${issue.title}`);

    const issueOwner = projectRepo?.owner || this.owner;
    const issueRepo = projectRepo?.repo || this.repo;

    const worker = new CoderAgent(issue, projectChannels, projectRepo);
    await worker.run();
  }

    async closeProject(projectName) {
    console.log(`[Pipeline] Closing project: ${projectName}`);
    const project = this.activeProjects[projectName];

    if (!project) {
      console.error(`[Pipeline] No active project found: ${projectName}`);
      return;
    }

    // Write estimation history placeholder
    const historyPath = require('path').join(process.cwd(), 'projects', 'estimation-history.json');
    const fs = require('fs');

    if (!fs.existsSync(require('path').join(process.cwd(), 'projects'))) {
      fs.mkdirSync(require('path').join(process.cwd(), 'projects'));
    }

    let history = { projects: [] };
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }

    history.projects.push({
      projectName,
      closedAt: new Date().toISOString(),
      projectRepo: project.channels
    });

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    console.log(`[Pipeline] Estimation history updated for: ${projectName}`);

    // Discard PM and Tech Lead
    if (project.pm) await project.pm.discard();
    if (project.techLead) await project.techLead.discard();

    // Remove from active projects
    delete this.activeProjects[projectName];

    console.log(`[Pipeline] Project closed: ${projectName}`);
  }
}

module.exports = Pipeline;