const { v4: uuidv4 } = require('uuid');

/**
 * Base message contract for all agent communication.
 * Every message passed between agents uses this structure.
 */

const MESSAGE_TYPES = {
  TASK: 'task',
  RESULT: 'result',
  INSIGHT: 'insight',
  ESCALATION: 'escalation',
  FEEDBACK: 'feedback'
};

const PRIORITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

const TIERS = {
  DIRECTOR: 'director',
  MANAGER: 'manager',
  WORKER: 'worker'
};

const AGENTS = {
  DIRECTOR: 'director',
  PM: 'pm',
  TECHLEAD: 'techlead',
  RESEARCHER: 'researcher',
  WRITER: 'writer',
  CODER: 'coder',
  AUDITOR: 'auditor',
  EFFICIENCY_DIRECTOR: 'efficiency-director'
};

/**
 * Creates a base message contract.
 * @param {object} options
 * @returns {object} message
 */
function createMessage({
  from,
  to,
  type,
  priority = PRIORITY_LEVELS.MEDIUM,
  payload = {},
  context = {},
  discord = {}
}) {
  if (!from?.agent || !from?.tier) throw new Error('from.agent and from.tier are required');
  if (!to?.agent || !to?.tier) throw new Error('to.agent and to.tier are required');
  if (!Object.values(MESSAGE_TYPES).includes(type)) throw new Error(`Invalid message type: ${type}`);
  if (!Object.values(PRIORITY_LEVELS).includes(priority)) throw new Error(`Invalid priority: ${priority}`);

  return {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    from,
    to,
    type,
    priority,
    payload,
    context,
    discord: {
      channel: discord.channel || null,
      threadId: discord.threadId || null
    }
  };
}

module.exports = {
  createMessage,
  MESSAGE_TYPES,
  PRIORITY_LEVELS,
  TIERS,
  AGENTS
};