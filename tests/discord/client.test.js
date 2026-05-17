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
  ChannelType: { GuildText: 0 },
}));

const { waitForApproval, createProjectChannel, archiveProjectChannel } = require('../../src/discord/client');

describe('waitForApproval', () => {
  let mockClient;

  beforeEach(() => {
    jest.useFakeTimers();
    mockClient = {
      on: jest.fn(),
      off: jest.fn(),
      channels: {
        fetch: jest.fn().mockResolvedValue({ send: jest.fn().mockResolvedValue(undefined) }),
      },
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
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve' });

    await expect(promise).resolves.toBe(true);
  });

  test('resolves false when "reject" is received', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'reject' });

    await expect(promise).resolves.toBe(false);
  });

  test('resolves false on timeout', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 1000);

    jest.advanceTimersByTime(1001);

    await expect(promise).resolves.toBe(false);
  });

  test('ignores messages from bots', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 1000);
    const handler = getHandler();

    handler({ author: { bot: true, tag: 'Bot#0000' }, channelId: 'channel-1', content: 'approve' });

    jest.advanceTimersByTime(1001);
    await expect(promise).resolves.toBe(false);
  });

  test('ignores messages from wrong channel', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 1000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-other', content: 'approve' });

    jest.advanceTimersByTime(1001);
    await expect(promise).resolves.toBe(false);
  });

  test('removes listener after resolving', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve' });
    await promise;

    expect(mockClient.off).toHaveBeenCalledWith('messageCreate', handler);
  });

  test('removes listener on timeout', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 1000);
    const handler = getHandler();

    jest.advanceTimersByTime(1001);
    await promise;

    expect(mockClient.off).toHaveBeenCalledWith('messageCreate', handler);
  });

  test('posts timeout message to the approvals channel', async () => {
    const mockSend = jest.fn().mockResolvedValue(undefined);
    mockClient.channels.fetch.mockResolvedValue({ send: mockSend });

    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 1000);
    jest.advanceTimersByTime(1001);
    await promise;
    await Promise.resolve(); // flush the fire-and-forget channel.send

    expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-1');
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('Approval window closed'));
  });

  test('accepts approve with mixed case and surrounding whitespace', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', null, 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: '  APPROVE  ' });

    await expect(promise).resolves.toBe(true);
  });

  test('accepts "approve: project-name" when projectName is set', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 'my-project', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve: my-project' });

    await expect(promise).resolves.toBe(true);
  });

  test('accepts "reject: project-name" when projectName is set', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 'my-project', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'reject: my-project' });

    await expect(promise).resolves.toBe(false);
  });

  test('still accepts plain "approve" even when projectName is set', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 'my-project', 5000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve' });

    await expect(promise).resolves.toBe(true);
  });

  test('ignores "approve: other-project" when waiting for a different project', async () => {
    const promise = waitForApproval(mockClient, 'msg-1', 'channel-1', 'my-project', 1000);
    const handler = getHandler();

    handler({ author: { bot: false, tag: 'User#1234' }, channelId: 'channel-1', content: 'approve: other-project' });

    jest.advanceTimersByTime(1001);
    await expect(promise).resolves.toBe(false);
  });
});

describe('createProjectChannel', () => {
  let mockClient;
  let mockChannel;
  let mockWebhook;

  beforeEach(() => {
    mockWebhook = { url: 'https://discord.com/api/webhooks/test/token' };
    mockChannel = {
      id: 'channel-abc123',
      createWebhook: jest.fn().mockResolvedValue(mockWebhook),
    };
    mockClient = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          channels: {
            create: jest.fn().mockResolvedValue(mockChannel),
          },
        }),
      },
    };
  });

  test('creates a channel with proj- prefix', async () => {
    await createProjectChannel(mockClient, 'guild-1', 'my-app');
    const guild = await mockClient.guilds.fetch.mock.results[0].value;
    expect(guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'proj-my-app' })
    );
  });

  test('creates a webhook in the new channel', async () => {
    await createProjectChannel(mockClient, 'guild-1', 'my-app');
    expect(mockChannel.createWebhook).toHaveBeenCalledWith({ name: 'Workers' });
  });

  test('returns channelId and webhookUrl on success', async () => {
    const result = await createProjectChannel(mockClient, 'guild-1', 'my-app');
    expect(result).toEqual({ channelId: 'channel-abc123', webhookUrl: mockWebhook.url });
  });

  test('returns null values when channel creation fails', async () => {
    mockClient.guilds.fetch.mockRejectedValue(new Error('Missing permissions'));
    const result = await createProjectChannel(mockClient, 'guild-1', 'my-app');
    expect(result).toEqual({ channelId: null, webhookUrl: null });
  });

  test('truncates channel name to 100 characters', async () => {
    await createProjectChannel(mockClient, 'guild-1', 'a'.repeat(100));
    const guild = await mockClient.guilds.fetch.mock.results[0].value;
    const name = guild.channels.create.mock.calls[0][0].name;
    expect(name.length).toBeLessThanOrEqual(100);
  });
});

describe('archiveProjectChannel', () => {
  let mockClient;
  let mockChannel;

  beforeEach(() => {
    mockChannel = {
      name: 'proj-my-app',
      permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
      setName: jest.fn().mockResolvedValue(undefined),
    };
    mockClient = {
      channels: { fetch: jest.fn().mockResolvedValue(mockChannel) },
    };
  });

  test('denies SendMessages for @everyone', async () => {
    await archiveProjectChannel(mockClient, 'channel-1', 'guild-1');
    expect(mockChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      'guild-1',
      { SendMessages: false }
    );
  });

  test('renames channel with archived- prefix', async () => {
    await archiveProjectChannel(mockClient, 'channel-1', 'guild-1');
    expect(mockChannel.setName).toHaveBeenCalledWith('archived-proj-my-app');
  });

  test('does not double-prefix already archived channels', async () => {
    mockChannel.name = 'archived-proj-my-app';
    await archiveProjectChannel(mockClient, 'channel-1', 'guild-1');
    expect(mockChannel.setName).not.toHaveBeenCalled();
  });

  test('handles errors without throwing', async () => {
    mockClient.channels.fetch.mockRejectedValue(new Error('Unknown channel'));
    await expect(archiveProjectChannel(mockClient, 'bad-id', 'guild-1')).resolves.not.toThrow();
  });
});
