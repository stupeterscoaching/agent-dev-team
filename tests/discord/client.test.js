jest.mock('discord.js', () => ({
  Client: jest.fn(() => ({
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
    login: jest.fn(),
    destroy: jest.fn(),
    channels: { fetch: jest.fn() },
    user: { tag: 'Bot#0000' },
  })),
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8, GuildMessageReactions: 16 },
  WebhookClient: jest.fn(() => ({ send: jest.fn() })),
  Partials: { Message: 'M', Channel: 'C', Reaction: 'R' },
}));

const { waitForApproval } = require('../../src/discord/client');

describe('waitForApproval', () => {
  let mockClient;

  beforeEach(() => {
    jest.useFakeTimers();
    mockClient = {
      on: jest.fn(),
      off: jest.fn(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function getHandler() {
    const call = mockClient.on.mock.calls.find(([event]) => event === 'messageCreate');
    return call ? call[1] : null;
  }

  test('resolves true when "approve" is received in the correct channel', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve' });

    await expect(promise).resolves.toBe(true);
  });

  test('resolves false when "reject" is received', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'reject' });

    await expect(promise).resolves.toBe(false);
  });

  test('rejects on timeout', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 1000);

    jest.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow('Approval timed out');
  });

  test('ignores messages from bots', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 1000);
    const handler = getHandler();

    handler({ author: { bot: true, tag: 'Bot#0000' }, channelId: 'channel-1', content: 'approve' });

    jest.advanceTimersByTime(1001);
    await expect(promise).rejects.toThrow('Approval timed out');
  });

  test('ignores messages from wrong channel', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 1000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-other', content: 'approve' });

    jest.advanceTimersByTime(1001);
    await expect(promise).rejects.toThrow('Approval timed out');
  });

  test('removes listener after resolving', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve' });
    await promise;

    expect(mockClient.off).toHaveBeenCalledWith('messageCreate', handler);
  });

  test('accepts approve with mixed case and surrounding whitespace', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: '  APPROVE  ' });

    await expect(promise).resolves.toBe(true);
  });
});
