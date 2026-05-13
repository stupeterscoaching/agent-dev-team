const { createMessage, MESSAGE_TYPES, PRIORITY_LEVELS, TIERS, AGENTS } = require('../../src/contracts/base');

const validBase = () => ({
  from: { agent: AGENTS.DIRECTOR, tier: TIERS.DIRECTOR },
  to: { agent: AGENTS.PM, tier: TIERS.MANAGER },
  type: MESSAGE_TYPES.TASK,
});

describe('createMessage', () => {
  test('returns correct shape', () => {
    const msg = createMessage(validBase());
    expect(msg).toMatchObject({
      from: { agent: AGENTS.DIRECTOR, tier: TIERS.DIRECTOR },
      to: { agent: AGENTS.PM, tier: TIERS.MANAGER },
      type: MESSAGE_TYPES.TASK,
      priority: PRIORITY_LEVELS.MEDIUM,
      payload: {},
      context: {},
      discord: { channel: null, threadId: null },
    });
  });

  test('id is a valid UUID', () => {
    const msg = createMessage(validBase());
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('timestamp is a valid ISO string', () => {
    const msg = createMessage(validBase());
    expect(() => new Date(msg.timestamp)).not.toThrow();
    expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
  });

  test('each call returns a unique id', () => {
    const a = createMessage(validBase());
    const b = createMessage(validBase());
    expect(a.id).not.toBe(b.id);
  });

  test('defaults priority to medium when omitted', () => {
    const msg = createMessage(validBase());
    expect(msg.priority).toBe(PRIORITY_LEVELS.MEDIUM);
  });

  test('defaults payload and context to empty objects', () => {
    const msg = createMessage(validBase());
    expect(msg.payload).toEqual({});
    expect(msg.context).toEqual({});
  });

  test('defaults discord fields to null', () => {
    const msg = createMessage(validBase());
    expect(msg.discord.channel).toBeNull();
    expect(msg.discord.threadId).toBeNull();
  });

  test('passes through custom payload and context', () => {
    const payload = { task: 'build something' };
    const context = { projectName: 'test-project' };
    const msg = createMessage({ ...validBase(), payload, context });
    expect(msg.payload).toEqual(payload);
    expect(msg.context).toEqual(context);
  });

  test('passes through discord channel and threadId', () => {
    const msg = createMessage({ ...validBase(), discord: { channel: 'ch-1', threadId: 'th-1' } });
    expect(msg.discord.channel).toBe('ch-1');
    expect(msg.discord.threadId).toBe('th-1');
  });

  test('accepts all message types', () => {
    for (const type of Object.values(MESSAGE_TYPES)) {
      expect(() => createMessage({ ...validBase(), type })).not.toThrow();
    }
  });

  test('accepts all priority levels', () => {
    for (const priority of Object.values(PRIORITY_LEVELS)) {
      expect(() => createMessage({ ...validBase(), priority })).not.toThrow();
    }
  });

  test('throws when from.agent is missing', () => {
    expect(() => createMessage({ ...validBase(), from: { tier: TIERS.DIRECTOR } }))
      .toThrow('from.agent and from.tier are required');
  });

  test('throws when from.tier is missing', () => {
    expect(() => createMessage({ ...validBase(), from: { agent: AGENTS.DIRECTOR } }))
      .toThrow('from.agent and from.tier are required');
  });

  test('throws when to.agent is missing', () => {
    expect(() => createMessage({ ...validBase(), to: { tier: TIERS.MANAGER } }))
      .toThrow('to.agent and to.tier are required');
  });

  test('throws when to.tier is missing', () => {
    expect(() => createMessage({ ...validBase(), to: { agent: AGENTS.PM } }))
      .toThrow('to.agent and to.tier are required');
  });

  test('throws on invalid message type', () => {
    expect(() => createMessage({ ...validBase(), type: 'invalid-type' }))
      .toThrow('Invalid message type: invalid-type');
  });

  test('throws on invalid priority', () => {
    expect(() => createMessage({ ...validBase(), priority: 'urgent' }))
      .toThrow('Invalid priority: urgent');
  });
});

describe('exported constants', () => {
  test('MESSAGE_TYPES has all five types', () => {
    expect(Object.values(MESSAGE_TYPES)).toEqual(
      expect.arrayContaining(['task', 'result', 'insight', 'escalation', 'feedback'])
    );
  });

  test('PRIORITY_LEVELS has all four levels', () => {
    expect(Object.values(PRIORITY_LEVELS)).toEqual(
      expect.arrayContaining(['low', 'medium', 'high', 'critical'])
    );
  });

  test('TIERS has director, manager, worker', () => {
    expect(Object.values(TIERS)).toEqual(
      expect.arrayContaining(['director', 'manager', 'worker'])
    );
  });

  test('AGENTS includes all core agents', () => {
    expect(Object.values(AGENTS)).toEqual(
      expect.arrayContaining(['director', 'pm', 'techlead', 'coder'])
    );
  });
});
