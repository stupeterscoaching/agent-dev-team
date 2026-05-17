const express = require('express');
const crypto = require('crypto');

/**
 * GitHub webhook receiver.
 * Runs alongside the pipeline in the same process.
 * Handles issues.opened, issues.labeled, pull_request.opened, pull_request.synchronize.
 * Pollers remain as a 5-minute safety net for dropped webhooks.
 *
 * Requires env vars:
 *   GITHUB_WEBHOOK_SECRET  — used to verify X-Hub-Signature-256
 *   WEBHOOK_PORT           — port to listen on (default 3000)
 */
class GitHubWebhookServer {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    this.port = parseInt(process.env.WEBHOOK_PORT || '3000', 10);
    this.app = express();
    this._setupRoutes();
  }

  _verifySignature(rawBody, sigHeader) {
    if (!this.secret) return true;
    if (!sigHeader) return false;
    const expected = `sha256=${crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex')}`;
    try {
      return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  _setupRoutes() {
    this.app.post('/webhooks/github', express.raw({ type: 'application/json' }), (req, res) => {
      const rawBody = req.body;

      if (!this._verifySignature(rawBody, req.headers['x-hub-signature-256'])) {
        return res.status(401).send('Unauthorized');
      }

      const event = req.headers['x-github-event'];
      let payload;
      try {
        payload = JSON.parse(rawBody.toString());
      } catch {
        return res.status(400).send('Bad Request');
      }

      res.status(200).send('OK');

      this._handleEvent(event, payload).catch(err =>
        console.error(`[Webhooks] Error handling ${event}:`, err.message)
      );
    });
  }

  async _handleEvent(event, payload) {
    const repoName = payload.repository?.name;
    const projectEntry = this._findProjectByRepo(repoName);
    if (!projectEntry) return;

    const [projectName, project] = projectEntry;
    const projectRepo = project.pm?.projectRepo;

    if (event === 'issues' && ['opened', 'labeled'].includes(payload.action)) {
      const issue = payload.issue;
      if (issue.pull_request) return;
      if (!project.spawnedIssues) project.spawnedIssues = new Set();
      if (project.spawnedIssues.has(issue.number)) return;
      project.spawnedIssues.add(issue.number);
      console.log(`[Webhooks] Issue #${issue.number} opened in ${projectName} — spawning worker`);
      await this.pipeline.spawnWorker(issue, project.channels, projectRepo);
    }

    if (event === 'pull_request' && ['opened', 'synchronize'].includes(payload.action)) {
      const pr = payload.pull_request;
      if (!project.reviewedPRs) project.reviewedPRs = new Set();
      if (project.reviewedPRs.has(pr.number)) return;
      project.reviewedPRs.add(pr.number);
      console.log(`[Webhooks] PR #${pr.number} in ${projectName} — requesting Tech Lead review`);
      await project.techLead.reviewPR(pr.number, projectRepo);
    }
  }

  _findProjectByRepo(repoName) {
    if (!repoName) return null;
    return Object.entries(this.pipeline.activeProjects)
      .find(([, p]) => p.pm?.projectRepo?.repo === repoName) || null;
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`[Webhooks] GitHub webhook receiver listening on port ${this.port}`);
    });
    return this;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = GitHubWebhookServer;
