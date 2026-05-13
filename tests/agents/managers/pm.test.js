jest.mock('../../../src/discord/client', () => ({
  createBotClient: jest.fn(() => ({
    on: jest.fn(), once: jest.fn(), off: jest.fn(),
    login: jest.fn(), destroy: jest.fn(),
    channels: {
      fetch: jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
      }),
    },
    user: { tag: 'PM#0000' },
  })),
  createWebhookClient: jest.fn(),
  postAsWorker: jest.fn().mockResolvedValue(undefined),
  postToChannel: jest.fn().mockResolvedValue(undefined),
  waitForApproval: jest.fn().mockResolvedValue(true),
}));

const mockOctokit = {
  repos: {
    createForAuthenticatedUser: jest.fn(),
    get: jest.fn(),
    getContent: jest.fn(),
  },
  issues: {
    create: jest.fn(),
    createLabel: jest.fn(),
  },
};

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn(() => mockOctokit) }));

const fs = require('fs');
const PMAgent = require('../../../src/agents/managers/pm');

const makeSpec = (overrides = {}) => ({
  projectName: 'test-project',
  projectType: 'web-app',
  brief: { desiredOutcome: 'A working calculator' },
  architecture: {
    techStack: { language: 'javascript', runtime: 'node', packages: ['express'] },
    components: [{ name: 'frontend' }, { name: 'backend' }],
  },
  deliverables: [
    {
      name: 'frontend',
      type: 'code',
      description: 'HTML/CSS/JS frontend',
      acceptanceCriteria: ['Page loads without errors', 'UI is functional'],
    },
  ],
  ...overrides,
});

describe('PMAgent.readEstimationHistory', () => {
  let agent;

  beforeEach(() => {
    agent = new PMAgent(makeSpec(), { managers: 'ch-managers' });
  });

  test('returns history from bessemer-state when reachable', async () => {
    const remoteHistory = { projects: [{ projectName: 'past-project', hours: 10 }] };
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { content: Buffer.from(JSON.stringify(remoteHistory)).toString('base64') },
    });
    const result = await agent.readEstimationHistory();
    expect(result).toEqual(remoteHistory);
  });

  test('falls back to local file when bessemer-state is unreachable', async () => {
    mockOctokit.repos.getContent.mockRejectedValue(new Error('network error'));
    const localHistory = { projects: [{ projectType: 'web-app', hours: 8 }] };
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(localHistory));
    const result = await agent.readEstimationHistory();
    expect(result).toEqual(localHistory);
  });

  test('returns empty projects array when bessemer-state unreachable and no local file', async () => {
    mockOctokit.repos.getContent.mockRejectedValue(new Error('network error'));
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const result = await agent.readEstimationHistory();
    expect(result).toEqual({ projects: [] });
  });

  test('reads from BESSEMER_STATE_OWNER and BESSEMER_STATE_REPO env vars', async () => {
    process.env.BESSEMER_STATE_OWNER = 'custom-owner';
    process.env.BESSEMER_STATE_REPO = 'custom-repo';
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { content: Buffer.from('{"projects":[]}').toString('base64') },
    });
    await agent.readEstimationHistory();
    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'custom-owner', repo: 'custom-repo' })
    );
    delete process.env.BESSEMER_STATE_OWNER;
    delete process.env.BESSEMER_STATE_REPO;
  });
});

describe('PMAgent.buildEstimate', () => {
  let agent;

  beforeEach(() => {
    agent = new PMAgent(makeSpec(), { managers: 'ch-managers' });
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '8' }),
    });
  });

  test('returns estimate with required fields', async () => {
    const estimate = await agent.buildEstimate({ projects: [] });
    expect(estimate).toMatchObject({
      hours: expect.any(Number),
      cost: expect.any(Number),
      currency: expect.any(String),
      breakdown: expect.any(Array),
      confidence: expect.any(String),
      notes: expect.any(String),
    });
  });

  test('cost equals hours * 20', async () => {
    const estimate = await agent.buildEstimate({ projects: [] });
    expect(estimate.cost).toBe(estimate.hours * 20);
  });

  test('confidence is "low" when no relevant history', async () => {
    const estimate = await agent.buildEstimate({ projects: [] });
    expect(estimate.confidence).toBe('low');
  });

  test('confidence is "medium" when relevant history exists', async () => {
    const history = {
      projects: [
        { projectType: 'web-app', hours: 10 },
        { projectType: 'web-app', hours: 12 },
      ],
    };
    const estimate = await agent.buildEstimate(history);
    expect(estimate.confidence).toBe('medium');
  });

  test('breakdown has one entry per deliverable', async () => {
    const estimate = await agent.buildEstimate({ projects: [] });
    expect(estimate.breakdown).toHaveLength(makeSpec().deliverables.length);
  });
});

describe('PMAgent.createIssues', () => {
  let agent;

  beforeEach(() => {
    agent = new PMAgent(makeSpec(), { managers: 'ch-managers' });
    agent.postToManagers = jest.fn();
    agent.projectRepo = {
      owner: 'test-owner',
      repo: 'test-project',
      url: 'https://github.com/test-owner/test-project',
    };
    mockOctokit.issues.create.mockResolvedValue({ data: { number: 1 } });
  });

  test('creates one issue per deliverable', async () => {
    await agent.createIssues();
    expect(mockOctokit.issues.create).toHaveBeenCalledTimes(1);
  });

  test('issue title includes project name and deliverable name', async () => {
    await agent.createIssues();
    const title = mockOctokit.issues.create.mock.calls[0][0].title;
    expect(title).toContain('test-project');
    expect(title).toContain('frontend');
  });

  test('issue body includes acceptance criteria', async () => {
    await agent.createIssues();
    const body = mockOctokit.issues.create.mock.calls[0][0].body;
    expect(body).toContain('Page loads without errors');
    expect(body).toContain('UI is functional');
  });

  test('issue body includes tech stack language and packages', async () => {
    await agent.createIssues();
    const body = mockOctokit.issues.create.mock.calls[0][0].body;
    expect(body).toContain('javascript');
    expect(body).toContain('express');
  });

  test('issue body includes project repo URL', async () => {
    await agent.createIssues();
    const body = mockOctokit.issues.create.mock.calls[0][0].body;
    expect(body).toContain('https://github.com/test-owner/test-project');
  });
});
