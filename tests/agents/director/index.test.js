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
    director.processBrief = jest.fn().mockResolvedValue(undefined);
    director.think = jest.fn().mockResolvedValue('I can help with that');
  });

  test('calls processBrief when message starts with "brief:"', async () => {
    const message = { content: 'brief: Build a calculator', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.processBrief).toHaveBeenCalledWith('Build a calculator', message);
  });

  test('trims whitespace from brief content', async () => {
    const message = { content: 'brief:   Build a todo app   ', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.processBrief).toHaveBeenCalledWith('Build a todo app', message);
  });

  test('is case-insensitive for the brief: prefix', async () => {
    const message = { content: 'BRIEF: Build something', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.processBrief).toHaveBeenCalled();
  });

  test('calls think for non-brief messages', async () => {
    const message = { content: 'What can you build?', channelId: 'test-channel-director' };
    await director.handleMessage(message);
    expect(director.think).toHaveBeenCalledWith('What can you build?');
    expect(director.processBrief).not.toHaveBeenCalled();
  });

  test('truncates think response to 1900 chars when over limit', async () => {
    director.think = jest.fn().mockResolvedValue('x'.repeat(2000));
    const message = { content: 'Say something long', channelId: 'test-channel-director' };
    await director.handleMessage(message);

    const posted = postToChannel.mock.calls[0][2];
    expect(posted.length).toBeLessThanOrEqual(1903); // 1900 + '...'
    expect(posted.endsWith('...')).toBe(true);
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

  test('deliverables include both frontend and backend', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'test-project' }) })
      .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ response: 'a test project' }) });

    const result = await director.buildSpec('Build something');
    const names = result.spec.deliverables.map(d => d.name);
    expect(names.some(n => n.includes('frontend'))).toBe(true);
    expect(names.some(n => n.includes('backend'))).toBe(true);
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
});
