jest.mock('../../src/discord/client', () => ({
  createBotClient: jest.fn(() => ({
    on: jest.fn(), once: jest.fn(), off: jest.fn(),
    login: jest.fn(), destroy: jest.fn(),
    channels: { fetch: jest.fn() },
    user: { tag: 'Bot#0000' },
  })),
  createWebhookClient: jest.fn(),
  postAsWorker: jest.fn().mockResolvedValue(undefined),
  postToChannel: jest.fn().mockResolvedValue(undefined),
  waitForApproval: jest.fn().mockResolvedValue(true),
}));

const mockOctokit = {
  issues: { listForRepo: jest.fn() },
  pulls: { list: jest.fn() },
};

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn(() => mockOctokit) }));

jest.mock('../../src/agents/director/index', () => jest.fn(() => ({})));
jest.mock('../../src/agents/managers/pm', () => jest.fn(() => ({
  run: jest.fn().mockResolvedValue(undefined),
  projectRepo: { owner: 'o', repo: 'r' },
})));
jest.mock('../../src/agents/managers/techlead', () => jest.fn(() => ({
  run: jest.fn().mockResolvedValue(undefined),
  reviewPR: jest.fn().mockResolvedValue({ approved: true }),
})));

const mockCoderRun = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/agents/workers/coder', () => jest.fn(() => ({ run: mockCoderRun })));

const Pipeline = require('../../src/pipeline/index');
const CoderAgent = require('../../src/agents/workers/coder');

const makeIssue = (n, isPR = false) => ({
  number: n,
  title: `Issue ${n}`,
  pull_request: isPR ? {} : undefined,
  html_url: isPR
    ? `https://github.com/o/r/pull/${n}`
    : `https://github.com/o/r/issues/${n}`,
});

describe('Pipeline.createProjectChannels', () => {
  test('returns object with all required channel keys', async () => {
    const pipeline = new Pipeline();
    const channels = await pipeline.createProjectChannels('test-project');
    expect(channels).toHaveProperty('director');
    expect(channels).toHaveProperty('managers');
    expect(channels).toHaveProperty('workers');
    expect(channels).toHaveProperty('workersWebhook');
  });
});

describe('Pipeline.spawnWorker', () => {
  test('creates a CoderAgent and calls run()', async () => {
    const pipeline = new Pipeline();
    const issue = makeIssue(1);
    const projectRepo = { owner: 'o', repo: 'r' };

    await pipeline.spawnWorker(issue, {}, projectRepo);

    expect(CoderAgent).toHaveBeenCalledWith(issue, {}, projectRepo);
    expect(mockCoderRun).toHaveBeenCalled();
  });
});

describe('Pipeline.watchIssues', () => {
  let pipeline;

  beforeEach(() => {
    jest.useFakeTimers();
    pipeline = new Pipeline();
    pipeline.activeProjects['test-project'] = { channels: {} };
    pipeline.spawnWorker = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function flushAsync(ticks = 10) {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
  }

  test('spawns a worker for each open issue', async () => {
    mockOctokit.issues.listForRepo.mockResolvedValue({
      data: [makeIssue(1), makeIssue(2)],
    });

    pipeline.watchIssues('test-project', { owner: 'o', repo: 'r' });
    jest.advanceTimersByTime(5001);
    await flushAsync();

    expect(pipeline.spawnWorker).toHaveBeenCalledTimes(2);
  });

  test('filters out pull requests from the issues list', async () => {
    mockOctokit.issues.listForRepo.mockResolvedValue({
      data: [makeIssue(1), makeIssue(2, true)],
    });

    pipeline.watchIssues('test-project', { owner: 'o', repo: 'r' });
    jest.advanceTimersByTime(5001);
    await flushAsync();

    expect(pipeline.spawnWorker).toHaveBeenCalledTimes(1);
    expect(pipeline.spawnWorker).toHaveBeenCalledWith(
      expect.objectContaining({ number: 1 }),
      expect.anything(),
      expect.anything()
    );
  });

  test('does not respawn already-spawned issues on subsequent polls', async () => {
    mockOctokit.issues.listForRepo.mockResolvedValue({
      data: [makeIssue(1)],
    });

    pipeline.watchIssues('test-project', { owner: 'o', repo: 'r' });

    jest.advanceTimersByTime(5001);
    await flushAsync();

    jest.advanceTimersByTime(30001);
    await flushAsync();

    expect(pipeline.spawnWorker).toHaveBeenCalledTimes(1);
  });
});

describe('Pipeline.watchPRs', () => {
  let pipeline;
  let mockTechLead;

  beforeEach(() => {
    jest.useFakeTimers();
    pipeline = new Pipeline();
    mockTechLead = { reviewPR: jest.fn().mockResolvedValue({ approved: true }) };
    pipeline.activeProjects['test-project'] = { channels: {}, techLead: mockTechLead };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function flushAsync(ticks = 10) {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
  }

  test('triggers Tech Lead review for each open PR', async () => {
    mockOctokit.pulls.list.mockResolvedValue({
      data: [{ number: 10 }, { number: 11 }],
    });

    pipeline.watchPRs('test-project', { owner: 'o', repo: 'r' });
    jest.advanceTimersByTime(10001);
    await flushAsync();

    expect(mockTechLead.reviewPR).toHaveBeenCalledTimes(2);
  });

  test('does not re-review already reviewed PRs on subsequent polls', async () => {
    mockOctokit.pulls.list.mockResolvedValue({
      data: [{ number: 10 }],
    });

    pipeline.watchPRs('test-project', { owner: 'o', repo: 'r' });

    jest.advanceTimersByTime(10001);
    await flushAsync();

    jest.advanceTimersByTime(30001);
    await flushAsync();

    expect(mockTechLead.reviewPR).toHaveBeenCalledTimes(1);
  });
});
