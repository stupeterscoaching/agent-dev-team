let mockAnthropicCreate;
jest.mock('@anthropic-ai/sdk', () => {
  mockAnthropicCreate = jest.fn();
  return jest.fn(() => ({
    messages: { create: mockAnthropicCreate },
  }));
});

jest.mock('../../../src/discord/client', () => ({
  createBotClient: jest.fn(() => ({
    on: jest.fn(), once: jest.fn(), off: jest.fn(),
    login: jest.fn(), destroy: jest.fn(),
    channels: { fetch: jest.fn() },
    user: { tag: 'Bot#0000' },
  })),
  createWebhookClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue(undefined) })),
  postAsWorker: jest.fn().mockResolvedValue(undefined),
  postToChannel: jest.fn().mockResolvedValue(undefined),
}));

const mockOctokit = {
  issues: {
    createComment: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn(() => mockOctokit) }));

const ResearcherAgent = require('../../../src/agents/workers/researcher');

const makeIssue = (overrides = {}) => ({
  number: 7,
  title: 'Research caching strategies for Express',
  body: 'Investigate caching options for the Express backend.',
  labels: [{ name: 'type:research' }],
  ...overrides,
});

const makeProjectRepo = () => ({ owner: 'test-owner', repo: 'test-repo' });

describe('ResearcherAgent constructor', () => {
  test('sets agentName as Researcher-task-{number}', () => {
    const agent = new ResearcherAgent(makeIssue(), null, makeProjectRepo());
    expect(agent.agentName).toBe('Researcher-task-7');
  });

  test('uses WORKER_MODEL env var for model', () => {
    const agent = new ResearcherAgent(makeIssue(), null, makeProjectRepo());
    expect(agent.model).toBe(process.env.WORKER_MODEL || 'llama3.2:latest');
  });
});

describe('ResearcherAgent.conductResearch (Ollama)', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearcherAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
  });

  test('returns model response when Ollama returns text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '## Research Report\n\nFindings here.' }),
    });

    const report = await agent.conductResearch();
    expect(report).toContain('Research Report');
  });

  test('returns fallback report when Ollama returns empty response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '' }),
    });

    const report = await agent.conductResearch();
    expect(report).toContain('Research Report');
    expect(report).toContain(makeIssue().title);
  });

  test('prompt includes issue title and body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: 'some research' }),
    });

    await agent.conductResearch();

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.prompt).toContain(makeIssue().title);
    expect(body.prompt).toContain(makeIssue().body);
  });
});

describe('ResearcherAgent.conductResearch (Claude API)', () => {
  let agent;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.WORKER_MODEL;
    agent = new ResearcherAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.WORKER_MODEL = 'llama3.2:latest';
  });

  test('uses Claude API when ANTHROPIC_API_KEY is set', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '## Research Report\n\nSolid findings.' }],
    });

    const report = await agent.conductResearch();
    expect(report).toContain('Research Report');
    expect(mockAnthropicCreate).toHaveBeenCalled();
  });

  test('defaults model to claude-haiku-4-5-20251001 when using Claude API', () => {
    expect(agent.model).toBe('claude-haiku-4-5-20251001');
  });

  test('caches the system prompt', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'report' }],
    });

    await agent.conductResearch();

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('ResearcherAgent.postReport', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearcherAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
    mockOctokit.issues.createComment.mockResolvedValue({});
    mockOctokit.issues.update.mockResolvedValue({});
  });

  test('posts the report as a comment on the Issue', async () => {
    await agent.postReport('## My Report');
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 7,
        body: '## My Report',
      })
    );
  });

  test('closes the Issue after posting the report', async () => {
    await agent.postReport('## My Report');
    expect(mockOctokit.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 7,
        state: 'closed',
      })
    );
  });
});

describe('ResearcherAgent.run', () => {
  let agent;

  beforeEach(() => {
    agent = new ResearcherAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
    agent.conductResearch = jest.fn().mockResolvedValue('## Report');
    agent.postReport = jest.fn().mockResolvedValue(undefined);
  });

  test('calls conductResearch then postReport', async () => {
    await agent.run();
    expect(agent.conductResearch).toHaveBeenCalled();
    expect(agent.postReport).toHaveBeenCalledWith('## Report');
  });

  test('logs error and does not throw when conductResearch fails', async () => {
    agent.conductResearch.mockRejectedValue(new Error('model down'));
    await expect(agent.run()).resolves.not.toThrow();
    expect(agent.log).toHaveBeenCalledWith(expect.stringContaining('Fatal error'));
  });
});
