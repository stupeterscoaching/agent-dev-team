const crypto = require('crypto');
const http = require('http');
const GitHubWebhookServer = require('../../src/webhooks/github');

function makeSignature(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function sendWebhook(port, event, payload, { secret = '', extraHeaders = {} } = {}) {
  const body = JSON.stringify(payload);
  const sig = secret ? makeSignature(Buffer.from(body), secret) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path: '/webhooks/github', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-github-event': event,
          ...(sig ? { 'x-hub-signature-256': sig } : {}),
          ...extraHeaders,
        } },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makePipeline({ projectRepo = { owner: 'o', repo: 'myrepo' } } = {}) {
  const spawnWorker = jest.fn().mockResolvedValue(undefined);
  const reviewPR = jest.fn().mockResolvedValue({ approved: true });

  const pipeline = {
    spawnWorker,
    activeProjects: {
      'my-project': {
        channels: { managers: 'ch-123' },
        pm: { projectRepo },
        techLead: { reviewPR },
      },
    },
  };
  return { pipeline, spawnWorker, reviewPR };
}

describe('GitHubWebhookServer', () => {
  let server;

  afterEach(() => {
    if (server) { server.stop(); server = null; }
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('signature verification', () => {
    test('accepts request when no secret is configured', async () => {
      const { pipeline, spawnWorker } = makePipeline();
      server = new GitHubWebhookServer(pipeline);
      server.port = 0;
      server.start();
      const port = server.server.address().port;

      const payload = { action: 'opened', repository: { name: 'myrepo' }, issue: { number: 1, pull_request: undefined } };
      const res = await sendWebhook(port, 'issues', payload);
      expect(res.status).toBe(200);
    });

    test('accepts request with correct HMAC signature', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'mysecret';
      const { pipeline } = makePipeline();
      server = new GitHubWebhookServer(pipeline);
      server.port = 0;
      server.start();
      const port = server.server.address().port;

      const payload = { action: 'opened', repository: { name: 'myrepo' }, issue: { number: 2 } };
      const res = await sendWebhook(port, 'issues', payload, { secret: 'mysecret' });
      expect(res.status).toBe(200);
    });

    test('rejects request with wrong signature', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'mysecret';
      const { pipeline } = makePipeline();
      server = new GitHubWebhookServer(pipeline);
      server.port = 0;
      server.start();
      const port = server.server.address().port;

      const payload = { action: 'opened', repository: { name: 'myrepo' } };
      const res = await sendWebhook(port, 'issues', payload, { secret: 'wrongsecret' });
      expect(res.status).toBe(401);
    });

    test('rejects request with missing signature when secret is set', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'mysecret';
      const { pipeline } = makePipeline();
      server = new GitHubWebhookServer(pipeline);
      server.port = 0;
      server.start();
      const port = server.server.address().port;

      const payload = { action: 'opened', repository: { name: 'myrepo' } };
      const res = await sendWebhook(port, 'issues', payload);
      expect(res.status).toBe(401);
    });
  });

  describe('issues event', () => {
    let port;
    let spawnWorker;

    beforeEach(async () => {
      const result = makePipeline();
      spawnWorker = result.spawnWorker;
      server = new GitHubWebhookServer(result.pipeline);
      server.port = 0;
      server.start();
      port = server.server.address().port;
    });

    test('spawns a worker for an opened issue', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'myrepo' },
        issue: { number: 5, title: 'Do a thing', labels: [] },
      };
      await sendWebhook(port, 'issues', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(spawnWorker).toHaveBeenCalledWith(
        expect.objectContaining({ number: 5 }),
        expect.anything(),
        expect.objectContaining({ repo: 'myrepo' })
      );
    });

    test('does not spawn a worker for a PR disguised as an issue', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'myrepo' },
        issue: { number: 6, pull_request: {}, labels: [] },
      };
      await sendWebhook(port, 'issues', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(spawnWorker).not.toHaveBeenCalled();
    });

    test('does not spawn a duplicate worker for an already-spawned issue', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'myrepo' },
        issue: { number: 7, labels: [] },
      };
      await sendWebhook(port, 'issues', payload);
      await new Promise(r => setTimeout(r, 20));
      await sendWebhook(port, 'issues', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(spawnWorker).toHaveBeenCalledTimes(1);
    });

    test('ignores events for unknown repos', async () => {
      const payload = { action: 'opened', repository: { name: 'other-repo' }, issue: { number: 8 } };
      await sendWebhook(port, 'issues', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(spawnWorker).not.toHaveBeenCalled();
    });
  });

  describe('pull_request event', () => {
    let port;
    let reviewPR;

    beforeEach(async () => {
      const result = makePipeline();
      reviewPR = result.reviewPR;
      server = new GitHubWebhookServer(result.pipeline);
      server.port = 0;
      server.start();
      port = server.server.address().port;
    });

    test('triggers Tech Lead review for an opened PR', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'myrepo' },
        pull_request: { number: 10 },
      };
      await sendWebhook(port, 'pull_request', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(reviewPR).toHaveBeenCalledWith(10, expect.objectContaining({ repo: 'myrepo' }));
    });

    test('triggers review for a synchronize event', async () => {
      const payload = {
        action: 'synchronize',
        repository: { name: 'myrepo' },
        pull_request: { number: 11 },
      };
      await sendWebhook(port, 'pull_request', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(reviewPR).toHaveBeenCalledWith(11, expect.anything());
    });

    test('does not re-review an already-reviewed PR', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'myrepo' },
        pull_request: { number: 12 },
      };
      await sendWebhook(port, 'pull_request', payload);
      await new Promise(r => setTimeout(r, 20));
      await sendWebhook(port, 'pull_request', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(reviewPR).toHaveBeenCalledTimes(1);
    });

    test('ignores closed PR action', async () => {
      const payload = {
        action: 'closed',
        repository: { name: 'myrepo' },
        pull_request: { number: 13 },
      };
      await sendWebhook(port, 'pull_request', payload);
      await new Promise(r => setTimeout(r, 20));
      expect(reviewPR).not.toHaveBeenCalled();
    });
  });
});
