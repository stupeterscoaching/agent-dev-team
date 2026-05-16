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
    channels: {
      fetch: jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
      }),
    },
    user: { tag: 'Director#0000' },
  })),
  createWebhookClient: jest.fn(),
  postAsWorker: jest.fn().mockResolvedValue(undefined),
  postToChannel: jest.fn().mockResolvedValue(undefined),
  waitForApproval: jest.fn().mockResolvedValue(true),
}));

const Director = require('../../../src/agents/director/index');
const { postToChannel } = require('../../../src/discord/client');

describe('Director.handleMessage', () => {
  let director;

  beforeEach(() => {
    director = new Director();
    director.startBriefConversation = jest.fn().mockResolvedValue(undefined);
    director.think = jest.fn().mockResolvedValue('I can help with that');
  });

  test('calls startBriefConversation when message starts with "brief:"', async () => {
    const message = { content: 'brief: Build a calculator', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.startBriefConversation).toHaveBeenCalledWith('Build a calculator', message, null);
  });

  test('trims whitespace from brief content', async () => {
    const message = { content: 'brief:   Build a todo app   ', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.startBriefConversation).toHaveBeenCalledWith('Build a todo app', message, null);
  });

  test('is case-insensitive for the brief: prefix', async () => {
    const message = { content: 'BRIEF: Build something', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.startBriefConversation).toHaveBeenCalled();
  });

  test('extracts project name from [name] prefix in brief', async () => {
    const message = { content: 'brief: [my-calculator] Build a web calculator', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.startBriefConversation).toHaveBeenCalledWith('Build a web calculator', message, 'my-calculator');
  });

  test('sanitizes project name extracted from brief', async () => {
    const message = { content: 'brief: [My Calculator!!!] Build it', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.startBriefConversation).toHaveBeenCalledWith('Build it', message, 'my-calculator');
  });

  test('passes null projectName when no [name] prefix given', async () => {
    const message = { content: 'brief: Build a calculator', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.startBriefConversation).toHaveBeenCalledWith(expect.any(String), message, null);
  });

  test('calls think for non-brief messages when no active brief', async () => {
    const message = { content: 'What can you build?', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.think).toHaveBeenCalledWith('What can you build?');
    expect(director.startBriefConversation).not.toHaveBeenCalled();
  });

  test('truncates think response to 1900 chars when over limit', async () => {
    director.think = jest.fn().mockResolvedValue('x'.repeat(2000));
    const message = { content: 'Say something long', channelId: 'test-channel-director' };
    await director.handleMessage(message);

    const posted = postToChannel.mock.calls[0][2];
    expect(posted.length).toBeLessThanOrEqual(1903); // 1900 + '...'
    expect(posted.endsWith('...')).toBe(true);
  });

  test('routes non-brief message to refineSpec when active brief exists', async () => {
    director.refineSpec = jest.fn().mockResolvedValue(undefined);
    director.activeBriefs['test-channel-director'] = { spec: {}, brief: '' };

    const message = { content: 'Make it Python instead', channelId: 'test-channel-director' };
    await director.handleMessage(message);

    expect(director.refineSpec).toHaveBeenCalledWith('test-channel-director', 'Make it Python instead');
    expect(director.think).not.toHaveBeenCalled();
  });

  test('routes "confirm" to confirmSpec when active brief exists', async () => {
    director.confirmSpec = jest.fn().mockResolvedValue(undefined);
    director.activeBriefs['test-channel-director'] = { spec: {}, brief: '' };

    const message = { content: 'confirm', channelId: 'test-channel-director' };
    await director.handleMessage(message);

    expect(director.confirmSpec).toHaveBeenCalledWith('test-channel-director');
  });

  test('"confirm" is case-insensitive', async () => {
    director.confirmSpec = jest.fn().mockResolvedValue(undefined);
    director.activeBriefs['test-channel-director'] = { spec: {}, brief: '' };

    const message = { content: 'CONFIRM', channelId: 'test-channel-director' };
    await director.handleMessage(message);

    expect(director.confirmSpec).toHaveBeenCalled();
  });

  test('clears active brief and posts message on "cancel"', async () => {
    director.activeBriefs['test-channel-director'] = { spec: {}, brief: '' };

    const message = { content: 'cancel', channelId: 'test-channel-director' };
    await director.handleMessage(message);

    expect(director.activeBriefs['test-channel-director']).toBeUndefined();
    expect(postToChannel).toHaveBeenCalled();
  });
});

describe('Director.startBriefConversation', () => {
  let director;

  beforeEach(() => {
    director = new Director();
    director.buildSpec = jest.fn().mockResolvedValue({
      spec: {
        projectName: 'test-project',
        brief: { desiredOutcome: 'A test outcome' },
        architecture: {
          techStack: { language: 'javascript', runtime: 'node', packages: ['express'] }
        },
        deliverables: [{ name: 'test-project-frontend' }]
      }
    });
  });

  test('calls buildSpec and stores result in activeBriefs', async () => {
    const message = { channelId: 'test-channel-director' };
    await director.startBriefConversation('Build a test app', message, null);

    expect(director.buildSpec).toHaveBeenCalledWith('Build a test app', null);
    expect(director.activeBriefs['test-channel-director']).toBeDefined();
    expect(director.activeBriefs['test-channel-director'].spec).toBeDefined();
  });

  test('posts draft spec to director channel', async () => {
    const message = { channelId: 'test-channel-director' };
    await director.startBriefConversation('Build a test app', message, null);

    const calls = postToChannel.mock.calls;
    const draftCall = calls.find(c => c[2].includes('Draft Spec'));
    expect(draftCall).toBeDefined();
    expect(draftCall[2]).toContain('confirm');
    expect(draftCall[2]).toContain('cancel');
  });
});

describe('Director.refineSpec', () => {
  let director;

  beforeEach(() => {
    director = new Director();
    director._refineSpecWithModel = jest.fn().mockResolvedValue({
      spec: {
        projectName: 'test-project',
        brief: { desiredOutcome: 'Updated outcome' },
        architecture: {
          techStack: { language: 'python', runtime: 'python3', packages: ['flask'] }
        },
        deliverables: [{ name: 'test-project-cli' }]
      }
    });
    director.activeBriefs['test-channel-director'] = {
      spec: { spec: { projectName: 'test-project', brief: {}, architecture: { techStack: {} }, deliverables: [] } },
      brief: 'original brief'
    };
  });

  test('calls _refineSpecWithModel with current spec and instruction', async () => {
    await director.refineSpec('test-channel-director', 'Make it Python');
    expect(director._refineSpecWithModel).toHaveBeenCalledWith(
      director.activeBriefs['test-channel-director'] ? expect.anything() : expect.anything(),
      'Make it Python'
    );
  });

  test('updates activeBriefs with refined spec', async () => {
    const originalSpec = director.activeBriefs['test-channel-director'].spec;
    await director.refineSpec('test-channel-director', 'Make it Python');

    expect(director.activeBriefs['test-channel-director'].spec).not.toBe(originalSpec);
  });

  test('posts updated draft spec after refinement', async () => {
    await director.refineSpec('test-channel-director', 'Make it Python');

    const calls = postToChannel.mock.calls;
    const draftCall = calls.find(c => c[2] && c[2].includes('Draft Spec'));
    expect(draftCall).toBeDefined();
  });
});

describe('Director.confirmSpec', () => {
  let director;
  const { waitForApproval } = require('../../../src/discord/client');

  beforeEach(() => {
    director = new Director();
    director.spawnManagers = jest.fn().mockResolvedValue(undefined);
    director.activeBriefs['test-channel-director'] = {
      spec: {
        spec: {
          projectName: 'test-project',
          brief: { desiredOutcome: 'A working test app' },
          architecture: { techStack: { language: 'javascript', packages: ['express'] } },
          deliverables: [{ name: 'test-project-frontend', description: 'Frontend' }]
        }
      },
      brief: 'Build a test app'
    };
  });

  test('clears activeBriefs on confirm', async () => {
    await director.confirmSpec('test-channel-director');
    expect(director.activeBriefs['test-channel-director']).toBeUndefined();
  });

  test('sends spec to #approvals channel', async () => {
    await director.confirmSpec('test-channel-director');

    const sendCall = director.client.channels.fetch.mock.results[0];
    expect(director.client.channels.fetch).toHaveBeenCalledWith('test-channel-approvals');
  });

  test('calls spawnManagers when approved', async () => {
    waitForApproval.mockResolvedValueOnce(true);
    await director.confirmSpec('test-channel-director');
    expect(director.spawnManagers).toHaveBeenCalled();
  });

  test('does not call spawnManagers when rejected', async () => {
    waitForApproval.mockResolvedValueOnce(false);
    await director.confirmSpec('test-channel-director');
    expect(director.spawnManagers).not.toHaveBeenCalled();
  });

  test('does nothing when no active brief exists', async () => {
    delete director.activeBriefs['test-channel-director'];
    await director.confirmSpec('test-channel-director');
    expect(director.spawnManagers).not.toHaveBeenCalled();
  });
});

describe('Director._formatDraftSpec', () => {
  let director;

  beforeEach(() => {
    director = new Director();
  });

  test('includes project name, goal, stack, and deliverables', () => {
    const spec = {
      spec: {
        projectName: 'my-project',
        brief: { desiredOutcome: 'A working app' },
        architecture: {
          techStack: { language: 'python', runtime: 'python3', packages: ['flask', 'pytest'] }
        },
        deliverables: [
          { name: 'my-project-cli' },
          { name: 'my-project-tests' }
        ]
      }
    };

    const result = director._formatDraftSpec(spec);
    expect(result).toContain('my-project');
    expect(result).toContain('A working app');
    expect(result).toContain('python');
    expect(result).toContain('flask');
    expect(result).toContain('my-project-cli');
    expect(result).toContain('confirm');
    expect(result).toContain('cancel');
  });

  test('truncates to 1900 chars when spec is very long', () => {
    const longOutcome = 'x'.repeat(2000);
    const spec = {
      spec: {
        projectName: 'test',
        brief: { desiredOutcome: longOutcome },
        architecture: { techStack: { language: 'js', runtime: 'node', packages: [] } },
        deliverables: []
      }
    };

    const result = director._formatDraftSpec(spec);
    expect(result.length).toBeLessThanOrEqual(1903);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('Director.buildSpec', () => {
  let director;

  beforeEach(() => {
    director = new Director();
  });

  test('returns spec with correct top-level shape', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'web-calculator' }) })
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'A working calculator' }) });

    const result = await director.buildSpec('Build a web calculator');
    expect(result.spec).toMatchObject({
      projectName: expect.any(String),
      version: '1.0.0',
      brief: expect.objectContaining({ problemStatement: 'Build a web calculator' }),
      architecture: expect.objectContaining({ techStack: expect.any(Object) }),
      deliverables: expect.arrayContaining([expect.objectContaining({ name: expect.any(String) })]),
    });
  });

  test('sanitizes project name to lowercase kebab-case', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'Web Calculator App!!!' }) })
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'A calculator' }) });

    const result = await director.buildSpec('Build a web calculator');
    expect(result.spec.projectName).toMatch(/^[a-z0-9-]+$/);
  });

  test('falls back to "new-project" when model returns empty name', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: '' }) })
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'outcome' }) });

    const result = await director.buildSpec('Build something');
    expect(result.spec.projectName).toBe('new-project');
  });

  test('project name is at most 30 characters', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'a'.repeat(50) }) })
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'outcome' }) });

    const result = await director.buildSpec('Build something');
    expect(result.spec.projectName.length).toBeLessThanOrEqual(30);
  });

  test('uses provided projectName and skips name inference call', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'A working calculator' }) });

    const result = await director.buildSpec('Build a web calculator', 'exec-chosen-name');
    expect(result.spec.projectName).toBe('exec-chosen-name');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Director with Claude API', () => {
  let director;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.DIRECTOR_MODEL; // let constructor pick the Claude default
    director = new Director();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.DIRECTOR_MODEL = 'llama3.1:8b'; // restore setup.js value
  });

  test('useClaudeApi is true when ANTHROPIC_API_KEY is set', () => {
    expect(director.useClaudeApi).toBe(true);
  });

  test('defaults model to claude-opus-4-7 when using Claude API', () => {
    expect(director.model).toBe('claude-opus-4-7');
  });

  test('buildSpec returns correct shape via Claude API', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{"projectName":"test-app","desiredOutcome":"A working test application"}' }],
    });

    const result = await director.buildSpec('Build a test app');
    expect(result.spec.projectName).toBe('test-app');
    expect(result.spec.brief.desiredOutcome).toBe('A working test application');
  });

  test('buildSpec caches the system prompt', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{"projectName":"test-app","desiredOutcome":"A test app"}' }],
    });

    await director.buildSpec('Build a test app');

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('buildSpec sanitizes project name from Claude response', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{"projectName":"My App Name!!!","desiredOutcome":"A great app"}' }],
    });

    const result = await director.buildSpec('Build an app');
    expect(result.spec.projectName).toMatch(/^[a-z0-9-]+$/);
  });

  test('buildSpec falls back to new-project when Claude returns invalid JSON', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'Sure! Here is a great project for you.' }],
    });

    const result = await director.buildSpec('Build something');
    expect(result.spec.projectName).toBe('new-project');
  });

  test('think uses Claude API and returns response text', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'I can build that for you.' }],
    });

    const result = await director._thinkWithClaude('What can you build?');
    expect(result).toBe('I can build that for you.');
  });

  test('think caches the system prompt', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'response' }],
    });

    await director._thinkWithClaude('A question');

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('buildSpec uses provided projectName over Claude response name', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{"projectName":"claude-chosen-name","desiredOutcome":"A great app"}' }],
    });

    const result = await director.buildSpec('Build an app', 'exec-chosen-name');
    expect(result.spec.projectName).toBe('exec-chosen-name');
  });

  test('_refineSpecWithClaude returns updated spec from model response', async () => {
    const currentSpec = { spec: { projectName: 'my-app', brief: {}, architecture: { techStack: {} }, deliverables: [] } };
    const updatedSpec = { spec: { projectName: 'my-app', brief: { desiredOutcome: 'Updated' }, architecture: { techStack: { language: 'python' } }, deliverables: [] } };

    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: JSON.stringify(updatedSpec) }],
    });

    const result = await director._refineSpecWithClaude(currentSpec, 'Make it Python');
    expect(result).toEqual(updatedSpec);
  });

  test('_refineSpecWithClaude returns currentSpec unchanged when model returns invalid JSON', async () => {
    const currentSpec = { spec: { projectName: 'my-app' } };

    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'Sorry, I could not update the spec.' }],
    });

    const result = await director._refineSpecWithClaude(currentSpec, 'Make it Python');
    expect(result).toBe(currentSpec);
  });

  test('_refineSpecWithClaude caches the system prompt', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: '{}' }],
    });

    await director._refineSpecWithClaude({}, 'change something');

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
