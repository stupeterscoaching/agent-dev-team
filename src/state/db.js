const BetterSQLite = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class AgentDB {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(process.cwd(), 'state', 'agent-dev-team.db');
    this._init();
  }

  _init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new BetterSQLite(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this._runMigrations();
  }

  _runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const already = this.db.prepare('SELECT 1 FROM _migrations WHERE filename = ?').get(file);
      if (already) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      this.db.exec(sql);
      this.db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
    }
  }

  saveProject(name, { spec, channels, projectRepo = null, estimate = null, status = 'active' }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO projects (name, status, spec, channels, project_repo, estimate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      name,
      status,
      JSON.stringify(spec),
      JSON.stringify(channels),
      projectRepo ? JSON.stringify(projectRepo) : null,
      estimate ? JSON.stringify(estimate) : null
    );
  }

  updateProject(name, { projectRepo, estimate, status } = {}) {
    const fields = [];
    const values = [];

    if (projectRepo !== undefined) { fields.push('project_repo = ?'); values.push(JSON.stringify(projectRepo)); }
    if (estimate !== undefined) { fields.push('estimate = ?'); values.push(JSON.stringify(estimate)); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }

    if (!fields.length) return;
    fields.push("updated_at = datetime('now')");
    values.push(name);

    this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE name = ?`).run(...values);
  }

  getProject(name) {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
    return row ? this._deserialize(row) : null;
  }

  getOpenProjects() {
    return this.db.prepare("SELECT * FROM projects WHERE status = 'active'").all().map(r => this._deserialize(r));
  }

  closeProject(name) {
    this.db.prepare("UPDATE projects SET status = 'closed', updated_at = datetime('now') WHERE name = ?").run(name);
  }

  _deserialize(row) {
    return {
      name: row.name,
      status: row.status,
      spec: JSON.parse(row.spec),
      channels: JSON.parse(row.channels),
      projectRepo: row.project_repo ? JSON.parse(row.project_repo) : null,
      estimate: row.estimate ? JSON.parse(row.estimate) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = AgentDB;
