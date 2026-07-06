const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.env.DATA_DIR || '.', 'reports.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    jira_account_id TEXT    UNIQUE NOT NULL,
    name            TEXT,
    email           TEXT,
    jira_token      TEXT    NOT NULL,
    created_at      INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS projects (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    name              TEXT    NOT NULL,
    slug              TEXT    UNIQUE NOT NULL,
    jira_root_epic    TEXT    NOT NULL,
    eta               TEXT,
    confluence_space  TEXT,
    confluence_page   TEXT,
    created_at        INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS workstreams (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    deliverable    TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    team           TEXT,
    jira_key       TEXT,
    default_status TEXT,
    sort_order     INTEGER DEFAULT 0,
    UNIQUE(project_id, deliverable, name)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                    INTEGER NOT NULL,
    week                    INTEGER NOT NULL,
    exec_summary            TEXT,
    highlights_json         TEXT    DEFAULT '{"achievements":[],"blockers":[],"clarify":[]}',
    risks_json              TEXT    DEFAULT '[]',
    workstream_statuses_json TEXT   DEFAULT '{}',
    created_at              INTEGER DEFAULT (unixepoch()),
    updated_at              INTEGER DEFAULT (unixepoch()),
    UNIQUE(project_id, year, week)
  );

  CREATE TABLE IF NOT EXISTS epics_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    jira_key    TEXT    NOT NULL,
    summary     TEXT,
    team        TEXT,
    status      TEXT,
    start_date  TEXT,
    end_date    TEXT,
    cached_at   INTEGER DEFAULT (unixepoch()),
    UNIQUE(project_id, jira_key)
  );
`);

// ── Migrations (idempotent: add columns introduced after initial deploy) ──
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('projects', 'confluence_space', 'confluence_space TEXT');
ensureColumn('projects', 'confluence_page', 'confluence_page TEXT');
ensureColumn('reports', 'exec_summary', 'exec_summary TEXT');

// workstreams had no UNIQUE constraint pre-v2, so every "Sync Jira" click duplicated all rows.
// Rebuild the table with UNIQUE(project_id,deliverable,name) so syncs upsert instead of duplicating.
// Safe to do unconditionally at startup: reports.workstream_statuses_json (keyed by workstream id)
// was empty in production at the time this migration was written (no historical id references to preserve).
const wsInfo = db.prepare(`PRAGMA table_info(workstreams)`).all();
const hasUnique = db.prepare(`PRAGMA index_list(workstreams)`).all().some(ix => ix.unique && ix.origin === 'u');
if (wsInfo.length && !hasUnique) {
  db.exec(`
    CREATE TABLE workstreams_new (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      deliverable    TEXT    NOT NULL,
      name           TEXT    NOT NULL,
      team           TEXT,
      jira_key       TEXT,
      default_status TEXT,
      sort_order     INTEGER DEFAULT 0,
      UNIQUE(project_id, deliverable, name)
    );
    INSERT OR IGNORE INTO workstreams_new(id,project_id,deliverable,name,team,jira_key,sort_order)
      SELECT id,project_id,deliverable,name,team,jira_key,sort_order FROM workstreams;
    DROP TABLE workstreams;
    ALTER TABLE workstreams_new RENAME TO workstreams;
  `);
}

module.exports = db;
