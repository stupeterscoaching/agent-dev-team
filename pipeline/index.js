const Director = require('../agents/director');
const PMAgent = require('../agents/managers/pm');
const TechLeadAgent = require('../agents/managers/techlead');
const CoderAgent = require('../agents/workers/coder');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

/**
 * Pipeline — the orchestration layer.
 * Connects all agents and manages the flow between them.
 */

class Pipeline {
  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
    this.activeProjects = {};
  }

  /**
   * Starts the pipeline — boots the Director and listens for projects.
   */
  async start() {
    console.log('[Pipeline] Starting...');
    this.director = new Director();
    this.director.spawnManagers = this.spawnManagers.bind(this);
    console.log('[Pipeline] Director online. Waiting for project brief.');
  }

  /**
   * Spawns PM and Tech Lead for a confirmed project.
   * Called by the Director after spec approval.
   * @param {object} spec
   */
  async spawnManagers(spec) {
    const projectName = spec.spec.projectName;
    console.log(`[Pipeline] Spawning managers for: ${projectName}`);

    // Create project Discord channels
    const projectChannels = await this.createProjectChannels(projectName);

    // Store active project
    this.activeProjects[projectName] = {
      spec: spec.spec,
      channels: projectChannels,
      pm: null,
      techLead: null
    };

    // Spawn PM and Tech Lead simultaneously
    const pm = new PMAgent(spec.spec, projectChannels);
    const techLead = new TechLeadAgent(spec.spec, projectChannels);

    this.activeProjects[projectName].pm = pm;
    this.activeProjects[projectName].techLead = techLead;

    // Wire Tech Lead PR review into the pipeline
    techLead.reviewPR = techLead.reviewPR.bind(techLead);

    // Run PM and Tech Lead simultaneously
    await Promise.all([pm.run(), techLead.run()]);

    // Start watching for new Issues to assign to workers
    this.watchIssues(projectName);
  }

  /**
   * Creates project-scoped Discord channels.
   * @param {string} projectName
   * @returns {object} channel IDs
   */
  async createProjectChannels(projectName) {
    // For MVP — use existing org-wide channels
    // TODO: programmatically create Discord channels via API
    console.log(`[Pipeline] Using org-wide channels for project: ${projectName}`);

    return {
      director: process.env.DISCORD_CHANNEL_DIRECTOR,
      managers: process.env.DISCORD_CHANNEL_DIRECTOR,
      workers: process.env.DISCORD_CHANNEL_DIRECTOR,
      output: process.env.DISCORD_CHANNEL_DIRECTOR,
      workersWebhook: process.env.DISCORD_WEBHOOK_WORKERS || null
    };
  }

  /**
   * Watches GitHub Issues for a project and spawns workers as needed.
   * @param {string} projectName
   */
  async watchIssues(projectName) {
    console.log(`[Pipeline] Watching Issues for project: ${projectName}`);
    const project = this.activeProjects[projectName];

    const poll = async () => {
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

      // Poll every 30 seconds
      setTimeout(poll, 30000);
    };

    poll();
  }

  /**
   * Spawns a Coder worker for a GitHub Issue.
   * @param {object} issue
   * @param {object} projectChannels
   */
  async spawnWorker(issue, projectChannels) {
    console.log(`[Pipeline] Spawning worker for Issue #${issue.number}: ${issue.title}`);

    // Mark Issue as in-progress immediately to prevent double-spawning
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

// Boot the pipeline
const pipeline = new Pipeline();
pipeline.start().catch(console.error);

module.exports = Pipeline;