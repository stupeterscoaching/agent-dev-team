const Director = require('../agents/director');
const PMAgent = require('../agents/managers/pm');
const TechLeadAgent = require('../agents/managers/techlead');
const CoderAgent = require('../agents/workers/coder');
const ResearcherAgent = require('../agents/workers/researcher');
const WriterAgent = require('../agents/workers/writer');
const { Octokit } = require('@octokit/rest');
const { createProjectChannel, archiveProjectChannel } = require('../discord/client');
const fs = require('fs');
const path = require('path');

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
    const client = this.director?.client;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (client && guildId) {
      const { channelId, webhookUrl } = await createProjectChannel(client, guildId, projectName);
      if (channelId) {
        console.log(`[Pipeline] Project channel created for: ${projectName}`);
        return {
          director: process.env.DISCORD_CHANNEL_DIRECTOR,
          managers: channelId,
          workers: channelId,
          output: channelId,
          workersWebhook: webhookUrl,
        };
      }
    }

    console.log(`[Pipeline] Falling back to org-wide channels for: ${projectName}`);
    return {
      director: process.env.DISCORD_CHANNEL_DIRECTOR,
      managers: process.env.DISCORD_CHANNEL_DIRECTOR,
      workers: process.env.DISCORD_CHANNEL_DIRECTOR,
      output: process.env.DISCORD_CHANNEL_DIRECTOR,
      workersWebhook: process.env.DISCORD_WEBHOOK_WORKERS || null,
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

    const labels = issue.labels?.map(l => l.name) || [];
    let worker;

    if (labels.includes('type:research')) {
      worker = new ResearcherAgent(issue, projectChannels, projectRepo);
    } else if (labels.includes('type:docs')) {
      worker = new WriterAgent(issue, projectChannels, projectRepo);
    } else {
      worker = new CoderAgent(issue, projectChannels, projectRepo);
    }

    await worker.run();
  }

  async closeProject(projectName) {
    console.log(`[Pipeline] Closing project: ${projectName}`);
    const project = this.activeProjects[projectName];

    if (!project) {
      console.error(`[Pipeline] No active project found: ${projectName}`);
      return;
    }

    const estimate = project.pm?.estimate || { hours: 0, cost: 0, currency: 'CAD' };
    const newEntry = {
      projectName,
      closedAt: new Date().toISOString(),
      projectType: project.spec?.projectType || null,
      estimate: { hours: estimate.hours, cost: estimate.cost, currency: estimate.currency },
      actuals: { hours: estimate.hours, cost: estimate.cost, currency: estimate.currency },
      variance: 0,
      notes: 'Actuals not tracked — using estimate as proxy'
    };

    await this._writeToBessemerState(newEntry);
    this._writeLocalEstimationHistory(newEntry);

    if (project.pm) await project.pm.discard();
    if (project.techLead) await project.techLead.discard();

    const projectChannelId = project.channels?.managers;
    const directorChannelId = process.env.DISCORD_CHANNEL_DIRECTOR;
    if (projectChannelId && projectChannelId !== directorChannelId && this.director?.client) {
      await archiveProjectChannel(this.director.client, projectChannelId, process.env.DISCORD_GUILD_ID);
    }

    delete this.activeProjects[projectName];
    console.log(`[Pipeline] Project closed: ${projectName}`);
  }

  async _writeToBessemerState(newEntry) {
    const stateOwner = process.env.BESSEMER_STATE_OWNER || 'usebessemer';
    const stateRepo = process.env.BESSEMER_STATE_REPO || 'bessemer-state';

    try {
      const { data: fileData } = await this.octokit.repos.getContent({
        owner: stateOwner,
        repo: stateRepo,
        path: 'estimation-history.json',
      });
      const current = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf8'));
      current.projects.push(newEntry);

      await this.octokit.repos.createOrUpdateFileContents({
        owner: stateOwner,
        repo: stateRepo,
        path: 'estimation-history.json',
        message: `chore: add estimation history for ${newEntry.projectName}`,
        content: Buffer.from(JSON.stringify(current, null, 2)).toString('base64'),
        sha: fileData.sha,
      });
      console.log(`[Pipeline] Estimation history written to bessemer-state for: ${newEntry.projectName}`);
    } catch (err) {
      console.warn(`[Pipeline] Failed to write to bessemer-state: ${err.message}`);
    }
  }

  _writeLocalEstimationHistory(newEntry) {
    const historyPath = path.join(process.cwd(), 'projects', 'estimation-history.json');
    const projectsDir = path.join(process.cwd(), 'projects');
    if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir);

    let history = { projects: [] };
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    history.projects.push(newEntry);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  }
}

module.exports = Pipeline;