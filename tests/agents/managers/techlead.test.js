jest.mock('../../../src/discord/client', () => ({
  createBotClient: jest.fn(() => ({
    on: jest.fn(), once: jest.fn(), off: jest.fn(),
    login: jest.fn(), destroy: jest.fn(),
    channels: { fetch: jest.fn() },
    user: { tag: 'TechLead#0000' },
  })),
  createWebhookClient: jest.fn(),
  postAsWorker: jest.fn().mockResolvedValue(undefined),
  postToChannel: jest.fn().mockResolvedValue(undefined),
  waitForApproval: jest.fn().mockResolvedValue(true),
}));

const mockOctokit = {
  pulls: {
    get: jest.fn(),
    listFiles: jest.fn(),
    merge: jest.fn(),
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  issues: {
    createComment: jest.fn(),
    update: jest.fn(),
    listForRepo: jest.fn().mockResolvedValue({ data: [] }),
  },
};

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn(() => mockOctokit) }));

const TechLeadAgent = require('../../../src/agents/managers/techlead');

const makeSpec = (overrides = {}) => ({
  projectName: 'test-project',
  architecture: {
    techStack: { language: 'javascript', runtime: 'node', packages: ['express'] },
    components: [{ name: 'frontend' }, { name: 'backend' }],
  },
  ...overrides,
});

const projectRepo = { owner: 'test-owner', repo: 'test-repo' };

describe('TechLeadAgent.defineCodingStandards', () => {
  let agent;

  beforeEach(() => {
    agent = new TechLeadAgent(makeSpec(), { managers: 'ch-managers' });
    agent.postToManagers = jest.fn();
  });

  test('returns standards with language from spec', async () => {
    const standards = await agent.defineCodingStandards();
    expect(standards.language).toBe('javascript');
  });

  test('returns standards with a non-empty rules array', async () => {
    const standards = await agent.defineCodingStandards();
    expect(Array.isArray(standards.rules)).toBe(true);
    expect(standards.rules.length).toBeGreaterThan(0);
  });

  test('sets this.standards on the agent', async () => {
    await agent.defineCodingStandards();
    expect(agent.standards).toBeDefined();
    expect(agent.standards.language).toBe('javascript');
  });
});

describe('TechLeadAgent.scorePR', () => {
  let agent;

  beforeEach(() => {
    agent = new TechLeadAgent(makeSpec(), { managers: 'ch-managers' });
    agent.standards = { rules: ['Use clear names'] };
  });

  test('returns parsed score from valid model JSON response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":7,"feedback":"Good work","issues":[]}' }),
    });

    const result = await agent.scorePR({ title: 'Add feature', body: 'description' }, []);
    expect(result.score).toBe(7);
    expect(result.feedback).toBe('Good work');
  });

  test('returns fallback score 5 when model returns non-JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: 'Looks good to me!' }),
    });

    const result = await agent.scorePR({ title: 'Add feature', body: 'description' }, []);
    expect(result.score).toBe(5);
    expect(result.feedback).toContain('manually');
  });

  test('extracts JSON from response even with surrounding text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: 'Here is my review: {"score":8,"feedback":"Solid","issues":[]}' }),
    });

    const result = await agent.scorePR({ title: 'Add feature', body: 'description' }, []);
    expect(result.score).toBe(8);
  });
});

describe('TechLeadAgent.reviewPR', () => {
  let agent;

  beforeEach(() => {
    jest.useFakeTimers();
    agent = new TechLeadAgent(makeSpec(), { managers: 'ch-managers' });
    agent.postToManagers = jest.fn();
    agent.standards = { rules: ['Use clear names'] };

    mockOctokit.pulls.get.mockResolvedValue({
      data: { title: 'Add feature', body: 'Closes #5', number: 1 },
    });
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'app.js', changes: 10, patch: '+code' }],
    });
    mockOctokit.issues.createComment.mockResolvedValue({});
    mockOctokit.pulls.merge.mockResolvedValue({});
    mockOctokit.issues.update.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // reviewPR has an 8s setTimeout after merge before checkProjectComplete — advance timers to skip it
  async function runReviewPR(a, prNum, repo) {
    const promise = a.reviewPR(prNum, repo);
    await jest.runAllTimersAsync();
    return promise;
  }

  test('merges PR when score >= 3', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":7,"feedback":"Good","issues":[]}' }),
    });

    const result = await runReviewPR(agent, 1, projectRepo);
    expect(result.approved).toBe(true);
    expect(mockOctokit.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 1, merge_method: 'squash' })
    );
  });

  test('rejects PR and does not merge when score < 3', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":2,"feedback":"Needs work","issues":[]}' }),
    });

    const result = await runReviewPR(agent, 1, projectRepo);
    expect(result.approved).toBe(false);
    expect(mockOctokit.pulls.merge).not.toHaveBeenCalled();
  });

  test('posts approval comment with score before merging', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":8,"feedback":"Great","issues":[]}' }),
    });

    await runReviewPR(agent, 1, projectRepo);
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Score: 8/10') })
    );
  });

  test('posts rejection comment without merging', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":1,"feedback":"Too bad","issues":[]}' }),
    });

    await runReviewPR(agent, 1, projectRepo);
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('changes needed') })
    );
    expect(mockOctokit.pulls.merge).not.toHaveBeenCalled();
  });

  test('closes linked issue after merge', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":6,"feedback":"Good","issues":[]}' }),
    });

    await runReviewPR(agent, 1, projectRepo);
    expect(mockOctokit.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 5 })
    );
  });

  test('uses projectRepo owner and repo for all API calls', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ response: '{"score":7,"feedback":"Good","issues":[]}' }),
    });

    await runReviewPR(agent, 1, projectRepo);
    expect(mockOctokit.pulls.get).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test-owner', repo: 'test-repo' })
    );
  });
});
