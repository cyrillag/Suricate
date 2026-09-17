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

  -- A milestone (Beta / GA / a new region...) groups several deliverables/workstreams under one
  -- target date — see FUNCTIONAL_RULES.md "Milestones". jira_key is null for a Confluence
  -- milestone heading with no Jira key attached (no automatic date/status in that case, same
  -- "no manual authoring" rule as everything else this app pulls from source systems). Rewritten
  -- wholesale on every sync (see writeMilestonesCache in server.js) rather than upserted, since a
  -- key-less milestone has nothing stable to upsert against.
  CREATE TABLE IF NOT EXISTS milestones_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    jira_key    TEXT,
    name        TEXT    NOT NULL,
    status      TEXT,
    start_date  TEXT,
    end_date    TEXT,
    cached_at   INTEGER DEFAULT (unixepoch())
  );
`);

// ── Migrations (idempotent: add columns introduced after initial deploy) ──
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('projects', 'confluence_space', 'confluence_space TEXT');
ensureColumn('projects', 'confluence_page', 'confluence_page TEXT');
// Needed for the Cleanup view's "no assignee" check — every epics_cache writer (getChildEpics,
// getEpicsByKeys, getPortfolioEpics) now fetches both, so all three keep this column populated.
ensureColumn('epics_cache', 'assignee', 'assignee TEXT');
ensureColumn('epics_cache', 'reporter', 'reporter TEXT');
ensureColumn('reports', 'exec_summary', 'exec_summary TEXT');
// Space/comma-separated Jira keys pinned to Planning regardless of the automatic portfolio
// walk from jira_root_epic — for epics/features that live under a different LVL2 root entirely
// and so have no hierarchy link to derive them from automatically.
ensureColumn('projects', 'extra_epics', 'extra_epics TEXT');

// A past report must stay a true frozen snapshot — the matrix/Planning were being recomputed
// live from the CURRENT workstreams/epics_cache tables on every view, so a workstream added (or
// its status changing) after the fact silently changed what an old report showed. These freeze
// the fully-resolved workstream list (with status) and epic list at generation time; NULL on
// rows generated before this fix (no way to reconstruct their true historical state after the
// fact — the report route falls back to live computation only for those).
ensureColumn('reports', 'workstreams_snapshot_json', 'workstreams_snapshot_json TEXT');
ensureColumn('reports', 'epics_snapshot_json', 'epics_snapshot_json TEXT');

// eta_snapshot is the root epic's raw ISO End date at generation time (not the display-formatted
// projects.eta) so week-over-week comparisons are plain string comparisons. eta_delayed is frozen
// alongside it — whether that date is later than the previous existing report's eta_snapshot —
// so the health badge (see report-gen.js/server.js) reads the same way on every future view
// instead of silently changing if the epic's date moves again after this report was generated.
// Both NULL on rows generated before this existed; there's no way to reconstruct what the target
// date was back then, so those rows just never trigger the delayed state.
ensureColumn('reports', 'eta_snapshot', 'eta_snapshot TEXT');
ensureColumn('reports', 'eta_delayed', 'eta_delayed INTEGER DEFAULT 0');

// Set once, at the row's first INSERT, never touched again (a past week can never be
// regenerated, so this is never re-evaluated): whether the ISO week being generated was already
// in the past *at generation time*. True means this report cannot be a real point-in-time record
// — the matrix/risks/highlights all reflect whatever Confluence/Jira looked like on the
// generation date, not the actual conditions during that week (there is no historical snapshot
// of workstream status to reconstruct from). report-gen.js renders a permanent banner whenever
// this is set, so nobody mistakes a backfilled report for a real weekly record. 0/NULL on rows
// generated during their own current week — the normal case — and on legacy rows predating this
// column, which is the safe default (no false "this was backfilled" claim on old normal reports).
ensureColumn('reports', 'backfilled', 'backfilled INTEGER DEFAULT 0');

// Milestone grouping for a workstream (see the milestones_cache comment above). milestone_key
// defaults to '' rather than NULL specifically so the UNIQUE index rebuilt just below still
// dedupes correctly for the (overwhelming majority of) projects with no milestones at all — a
// SQLite UNIQUE index treats every NULL as distinct from every other NULL, which would silently
// stop ON CONFLICT upserts from matching existing "no milestone" rows against themselves and
// start duplicating them on every sync instead.
ensureColumn('workstreams', 'milestone_key', "milestone_key TEXT NOT NULL DEFAULT ''");
ensureColumn('workstreams', 'milestone_name', 'milestone_name TEXT');
ensureColumn('reports', 'milestones_snapshot_json', 'milestones_snapshot_json TEXT');

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

// Widen the uniqueness to (project_id, milestone_key, deliverable, name) — the same deliverable
// name (e.g. "Core") can legitimately repeat under two different milestones (Beta and GA both
// having one), and without milestone_key in the key, syncing one would silently overwrite the
// other's row instead of the two staying distinct. Same table-rebuild pattern as the migration
// just above, since SQLite can't ALTER an existing UNIQUE constraint in place.
const wsUniqueIdx = db.prepare(`PRAGMA index_list(workstreams)`).all().find(ix => ix.unique && ix.origin === 'u');
const wsUniqueCols = wsUniqueIdx ? db.prepare(`PRAGMA index_info(${wsUniqueIdx.name})`).all().map(c => c.name) : [];
if (wsUniqueIdx && !wsUniqueCols.includes('milestone_key')) {
  db.exec(`
    CREATE TABLE workstreams_ms (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      deliverable    TEXT    NOT NULL,
      name           TEXT    NOT NULL,
      team           TEXT,
      jira_key       TEXT,
      default_status TEXT,
      milestone_key  TEXT    NOT NULL DEFAULT '',
      milestone_name TEXT,
      sort_order     INTEGER DEFAULT 0,
      UNIQUE(project_id, milestone_key, deliverable, name)
    );
    INSERT INTO workstreams_ms(id,project_id,deliverable,name,team,jira_key,default_status,milestone_key,milestone_name,sort_order)
      SELECT id,project_id,deliverable,name,team,jira_key,default_status,milestone_key,milestone_name,sort_order FROM workstreams;
    DROP TABLE workstreams;
    ALTER TABLE workstreams_ms RENAME TO workstreams;
  `);
}

module.exports = db;
