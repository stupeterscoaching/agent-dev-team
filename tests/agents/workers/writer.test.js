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
  git: {
    getRef: jest.fn(),
    createRef: jest.fn(),
    deleteRef: jest.fn(),
  },
  repos: {
    getContent: jest.fn(),
    createOrUpdateFileContents: jest.fn(),
  },
  issues: { update: jest.fn() },
  pulls: { create: jest.fn() },
};

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn(() => mockOctokit) }));

const WriterAgent = require('../../../src/agents/workers/writer');

const makeIssue = (overrides = {}) => ({
  number: 5,
  title: 'Write README for calculator app',
  body: 'Write a comprehensive README for the calculator project.',
  labels: [{ name: 'type:docs' }],
  ...overrides,
});

const makeProjectRepo = () => ({ owner: 'test-owner', repo: 'test-repo' });

describe('WriterAgent constructor', () => {
  test('sets branchName as writer/{number}/{slug}', () => {
    const agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    expect(agent.branchName).toBe('writer/5/write-readme-for-calculator-app');
  });

  test('sets agentName as Writer-task-{number}', () => {
    const agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    expect(agent.agentName).toBe('Writer-task-5');
  });

  test('sets maxAttempts to 3', () => {
    const agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    expect(agent.maxAttempts).toBe(3);
  });
});

describe('WriterAgent.generateContent (Ollama)', () => {
  let agent;

  beforeEach(() => {
    agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
  });

  test('returns parsed files array from valid model JSON response', async () => {
    const files = [{ filename: 'README.md', content: '# Calculator' }];
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: JSON.stringify({ files, summary: 'wrote it' }) }),
    });

    const result = await agent.generateContent();
    expect(result).toEqual(files);
  });

  test('returns fallback placeholder when model returns invalid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: 'not json at all' }),
    });

    const result = await agent.generateContent();
    expect(result).toHaveLength(1);
    expect(result[0].filename).toContain('write-readme-for-calculator-app');
    expect(result[0].filename).toMatch(/\.md$/);
    expect(result[0].content).toContain('TODO');
  });

  test('returns fallback when JSON has no files array', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"summary":"done"}' }),
    });

    const result = await agent.generateContent();
    expect(result).toHaveLength(1);
  });

  test('prompt includes issue title and body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"files":[{"filename":"README.md","content":"# hi"}],"summary":"done"}' }),
    });

    await agent.generateContent();

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.prompt).toContain(makeIssue().title);
    expect(body.prompt).toContain(makeIssue().body);
  });
});

describe('WriterAgent.generateContent (Claude API)', () => {
  let agent;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.WORKER_MODEL;
    agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.WORKER_MODEL = 'llama3.2:latest';
  });

  test('uses Claude API when ANTHROPIC_API_KEY is set', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{"files":[{"filename":"README.md","content":"# Hello"}],"summary":"done"}' }],
    });

    const result = await agent.generateContent();
    expect(result[0].filename).toBe('README.md');
    expect(mockAnthropicCreate).toHaveBeenCalled();
  });

  test('defaults model to claude-haiku-4-5-20251001 when using Claude API', () => {
    expect(agent.model).toBe('claude-haiku-4-5-20251001');
  });

  test('caches the system prompt', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{"files":[{"filename":"README.md","content":"# hi"}],"summary":"done"}' }],
    });

    await agent.generateContent();

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('WriterAgent.commitFiles', () => {
  let agent;

  beforeEach(() => {
    agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({});
  });

  test('commits a file successfully', async () => {
    await expect(agent.commitFiles([{ filename: 'README.md', content: '# hi' }])).resolves.not.toThrow();
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });

  test('commit message includes issue number and filename', async () => {
    await agent.commitFiles([{ filename: 'README.md', content: '# hi' }]);
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[writer-5] add README.md' })
    );
  });

  test('strips leading ./ from filename', async () => {
    const files = [{ filename: './docs/setup.md', content: '# Setup' }];
    await agent.commitFiles(files);
    expect(files[0].filename).toBe('docs/setup.md');
  });

  test('retries on failure and succeeds on second attempt', async () => {
    mockOctokit.repos.createOrUpdateFileContents
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValueOnce({});

    await expect(agent.commitFiles([{ filename: 'README.md', content: '# hi' }])).resolves.not.toThrow();
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
  });

  test('throws edit-mismatch error after maxAttempts exhausted', async () => {
    mockOctokit.repos.createOrUpdateFileContents.mockRejectedValue(new Error('conflict'));
    await expect(agent.commitFiles([{ filename: 'README.md', content: '# hi' }]))
      .rejects.toThrow('edit-mismatch');
  });
});

describe('WriterAgent.openPR', () => {
  let agent;

  beforeEach(() => {
    agent = new WriterAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
    mockOctokit.pulls.create.mockResolvedValue({
      data: { number: 9, html_url: 'https://github.com/test-owner/test-repo/pull/9' },
    });
    mockOctokit.issues.update.mockResolvedValue({});
  });

  test('creates PR with correct title format', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: '[writer-5] Write README for calculator app' })
    );
  });

  test('PR body contains Closes reference', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Closes #5') })
    );
  });

  test('PR targets main branch', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'main' })
    );
  });

  test('PR head is the writer branch', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'writer/5/write-readme-for-calculator-app' })
    );
  });
});
