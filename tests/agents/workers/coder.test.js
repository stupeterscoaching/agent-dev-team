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
  waitForApproval: jest.fn().mockResolvedValue(true),
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

const CoderAgent = require('../../../src/agents/workers/coder');

const makeIssue = (overrides = {}) => ({
  number: 42,
  title: 'Build a calculator app',
  body: 'Build a simple calculator',
  ...overrides,
});

const makeProjectRepo = () => ({ owner: 'test-owner', repo: 'test-repo' });

describe('CoderAgent.slugify', () => {
  let agent;

  beforeEach(() => {
    agent = new CoderAgent(makeIssue(), null, makeProjectRepo());
  });

  test('lowercases and hyphenates words', () => {
    expect(agent.slugify('Hello World')).toBe('hello-world');
  });

  test('strips special characters', () => {
    expect(agent.slugify('Add: feature! (v2)')).toBe('add-feature-v2');
  });

  test('collapses multiple separators into one hyphen', () => {
    expect(agent.slugify('hello   world')).toBe('hello-world');
  });

  test('strips leading and trailing hyphens', () => {
    expect(agent.slugify('---hello---')).toBe('hello');
  });

  test('truncates at 50 characters', () => {
    const long = 'a'.repeat(60);
    expect(agent.slugify(long)).toHaveLength(50);
  });

  test('handles empty string', () => {
    expect(agent.slugify('')).toBe('');
  });
});

describe('CoderAgent constructor', () => {
  test('sets branchName as coder/{number}/{slug}', () => {
    const agent = new CoderAgent(makeIssue({ number: 42, title: 'Build a calculator app' }), null, makeProjectRepo());
    expect(agent.branchName).toBe('coder/42/build-a-calculator-app');
  });

  test('sets maxAttempts to 3', () => {
    const agent = new CoderAgent(makeIssue(), null, makeProjectRepo());
    expect(agent.maxAttempts).toBe(3);
  });
});

describe('CoderAgent.generateCode', () => {
  let agent;

  beforeEach(() => {
    agent = new CoderAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
  });

  test('returns parsed files array from valid model JSON response', async () => {
    const files = [{ filename: 'app.js', content: 'console.log("hi")' }];
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: JSON.stringify({ files, summary: 'built it' }) }),
    });

    const result = await agent.generateCode();
    expect(result).toEqual(files);
  });

  test('returns fallback placeholder when model returns invalid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: 'not json at all' }),
    });

    const result = await agent.generateCode();
    expect(result).toHaveLength(1);
    expect(result[0].filename).toContain('build-a-calculator-app');
    expect(result[0].content).toContain('TODO: implement');
  });

  test('returns fallback when JSON has no files array', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"summary":"done"}' }),
    });

    const result = await agent.generateCode();
    expect(result).toHaveLength(1);
  });
});

describe('CoderAgent.commitCode', () => {
  let agent;

  beforeEach(() => {
    agent = new CoderAgent(makeIssue(), null, makeProjectRepo());
    agent.log = jest.fn();
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({});
  });

  test('commits a file successfully on first attempt', async () => {
    await expect(agent.commitCode([{ filename: 'app.js', content: 'code' }])).resolves.not.toThrow();
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds on second attempt', async () => {
    mockOctokit.repos.createOrUpdateFileContents
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValueOnce({});

    await expect(agent.commitCode([{ filename: 'app.js', content: 'code' }])).resolves.not.toThrow();
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
  });

  test('throws edit-mismatch error after maxAttempts exhausted', async () => {
    mockOctokit.repos.createOrUpdateFileContents.mockRejectedValue(new Error('conflict'));

    await expect(agent.commitCode([{ filename: 'app.js', content: 'code' }]))
      .rejects.toThrow('edit-mismatch');
  });

  test('strips leading ./ from filename', async () => {
    const files = [{ filename: './src/app.js', content: 'code' }];
    await agent.commitCode(files);
    expect(files[0].filename).toBe('src/app.js');
  });

  test('uses existing file SHA when file already exists on the branch', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({ data: { sha: 'existing-sha-123' } });

    await agent.commitCode([{ filename: 'app.js', content: 'updated code' }]);

    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: 'existing-sha-123' })
    );
  });

  test('commit message includes issue number and filename', async () => {
    await agent.commitCode([{ filename: 'app.js', content: 'code' }]);

    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[coder-42] add app.js' })
    );
  });
});

describe('CoderAgent.openPR', () => {
  let agent;

  beforeEach(() => {
    agent = new CoderAgent(makeIssue({ number: 42, title: 'Build a calculator app' }), null, makeProjectRepo());
    agent.log = jest.fn();
    mockOctokit.pulls.create.mockResolvedValue({
      data: { number: 10, html_url: 'https://github.com/test-owner/test-repo/pull/10' },
    });
    mockOctokit.issues.update.mockResolvedValue({});
  });

  test('creates PR with correct title format', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: '[coder-42] Build a calculator app' })
    );
  });

  test('PR body contains Closes reference', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Closes #42') })
    );
  });

  test('PR targets main branch', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'main' })
    );
  });

  test('PR head is the coder branch', async () => {
    await agent.openPR();
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'coder/42/build-a-calculator-app' })
    );
  });
});
