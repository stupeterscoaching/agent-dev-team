const path = require('path');
const AgentDB = require('../../src/state/db');

const makeSpec = (overrides = {}) => ({
  projectName: 'test-project',
  projectType: 'web-app',
  ...overrides,
});

const makeChannels = () => ({
  director: 'ch-director',
  managers: 'ch-managers',
  workers: 'ch-workers',
  workersWebhook: 'https://hooks/test',
});

describe('AgentDB', () => {
  let db;

  beforeEach(() => {
    db = new AgentDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('saveProject / getProject', () => {
    test('round-trips spec and channels', () => {
      const spec = makeSpec();
      const channels = makeChannels();
      db.saveProject('test-project', { spec, channels });

      const row = db.getProject('test-project');
      expect(row.name).toBe('test-project');
      expect(row.spec).toEqual(spec);
      expect(row.channels).toEqual(channels);
      expect(row.status).toBe('active');
    });

    test('returns null for unknown project', () => {
      expect(db.getProject('nope')).toBeNull();
    });

    test('stores projectRepo and estimate when provided', () => {
      const projectRepo = { owner: 'o', repo: 'r', url: 'https://github.com/o/r' };
      const estimate = { hours: 10, cost: 200, currency: 'CAD' };
      db.saveProject('test-project', { spec: makeSpec(), channels: makeChannels(), projectRepo, estimate });

      const row = db.getProject('test-project');
      expect(row.projectRepo).toEqual(projectRepo);
      expect(row.estimate).toEqual(estimate);
    });

    test('projectRepo and estimate are null when not provided', () => {
      db.saveProject('test-project', { spec: makeSpec(), channels: makeChannels() });
      const row = db.getProject('test-project');
      expect(row.projectRepo).toBeNull();
      expect(row.estimate).toBeNull();
    });

    test('INSERT OR REPLACE overwrites existing row', () => {
      const spec1 = makeSpec({ projectType: 'cli' });
      const spec2 = makeSpec({ projectType: 'api-service' });
      db.saveProject('test-project', { spec: spec1, channels: makeChannels() });
      db.saveProject('test-project', { spec: spec2, channels: makeChannels() });
      expect(db.getProject('test-project').spec.projectType).toBe('api-service');
    });
  });

  describe('getOpenProjects', () => {
    test('returns only active projects', () => {
      db.saveProject('active-one', { spec: makeSpec(), channels: makeChannels() });
      db.saveProject('active-two', { spec: makeSpec(), channels: makeChannels() });
      db.saveProject('closed-one', { spec: makeSpec(), channels: makeChannels(), status: 'closed' });

      const open = db.getOpenProjects();
      expect(open).toHaveLength(2);
      expect(open.map(p => p.name)).toEqual(expect.arrayContaining(['active-one', 'active-two']));
    });

    test('returns empty array when no active projects', () => {
      expect(db.getOpenProjects()).toEqual([]);
    });
  });

  describe('closeProject', () => {
    test('sets status to closed', () => {
      db.saveProject('test-project', { spec: makeSpec(), channels: makeChannels() });
      db.closeProject('test-project');
      expect(db.getProject('test-project').status).toBe('closed');
    });

    test('removes project from getOpenProjects', () => {
      db.saveProject('test-project', { spec: makeSpec(), channels: makeChannels() });
      db.closeProject('test-project');
      expect(db.getOpenProjects()).toHaveLength(0);
    });
  });

  describe('updateProject', () => {
    beforeEach(() => {
      db.saveProject('test-project', { spec: makeSpec(), channels: makeChannels() });
    });

    test('sets projectRepo', () => {
      const repo = { owner: 'o', repo: 'r', url: 'https://github.com/o/r' };
      db.updateProject('test-project', { projectRepo: repo });
      expect(db.getProject('test-project').projectRepo).toEqual(repo);
    });

    test('sets estimate', () => {
      const estimate = { hours: 8, cost: 160, currency: 'CAD' };
      db.updateProject('test-project', { estimate });
      expect(db.getProject('test-project').estimate).toEqual(estimate);
    });

    test('sets status', () => {
      db.updateProject('test-project', { status: 'closed' });
      expect(db.getProject('test-project').status).toBe('closed');
    });

    test('is a no-op when no recognised fields are passed', () => {
      db.updateProject('test-project', {});
      expect(db.getProject('test-project').status).toBe('active');
    });
  });

  describe('migrations', () => {
    test('applies 001_init.sql exactly once', () => {
      const db2 = new AgentDB(':memory:');
      db2.saveProject('p', { spec: makeSpec(), channels: makeChannels() });
      db2.close();
    });
  });
});
