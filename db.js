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

  -- Retired with the Planning Light "Manage" mode (see FUNCTIONAL_RULES.md): planning_groups and
  -- planning_overrides are no longer read or written, only kept so existing rows aren't dropped.
  -- Planning Light (see FUNCTIONAL_RULES.md). A PM-defined aggregate group (e.g. "NCC + ECPROJ +
  -- MANAGER together") — a synthetic parent node. Its own dates are never stored: they roll up
  -- from its members the same way any real Jira parent's do (see resolvePlanningTree), so there's
  -- nothing here to keep in sync. Defined before planning_overrides since that table refers to it.
  CREATE TABLE IF NOT EXISTS planning_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  -- A PM's local presentation decisions on top of the BigPicture-scoped tree, kept in a table of
  -- its own precisely so a re-sync (which fully rewrites epics_cache every time, same as it always
  -- has) never wipes them out. jira_key is a real Jira key for a node inherited from BigPicture's
  -- scope, or a synthetic 'GROUP:<id>' for a manually-created aggregate group (planning_groups
  -- above) — same table, same shape, since both are just "a node the PM can rename/hide/reparent".
  CREATE TABLE IF NOT EXISTS planning_overrides (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    jira_key          TEXT    NOT NULL,
    summary_override  TEXT,
    hidden            INTEGER DEFAULT 0,
    group_id          INTEGER REFERENCES planning_groups(id) ON DELETE SET NULL,
    updated_at        INTEGER DEFAULT (unixepoch()),
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
// Needed for the Cleanup view's "no assignee" check — every epics_cache writer (getChildEpics,
// getEpicsByKeys, getPortfolioEpics) now fetches both, so all three keep this column populated.
ensureColumn('epics_cache', 'assignee', 'assignee TEXT');
ensureColumn('epics_cache', 'reporter', 'reporter TEXT');
ensureColumn('reports', 'exec_summary', 'exec_summary TEXT');

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

// Up to 3 fixed, manually-configured milestone epics (Alpha/Beta/GA — see FUNCTIONAL_RULES.md
// "Milestones") — all optional, since not every project has all three phases. Their own End dates
// are frozen per-report the same way the root epic's own eta_snapshot already is, one column each
// rather than a JSON blob since there are always exactly these three, never a variable list.
ensureColumn('projects', 'milestone_alpha', 'milestone_alpha TEXT');
ensureColumn('projects', 'milestone_beta', 'milestone_beta TEXT');
ensureColumn('projects', 'milestone_ga', 'milestone_ga TEXT');
ensureColumn('reports', 'milestone_alpha_end', 'milestone_alpha_end TEXT');
ensureColumn('reports', 'milestone_beta_end', 'milestone_beta_end TEXT');
ensureColumn('reports', 'milestone_ga_end', 'milestone_ga_end TEXT');
// Raw Jira status alongside each date, frozen the same way — lets a past-dated milestone that's
// actually done show "DONE" instead of a stale-looking expired date (see FUNCTIONAL_RULES.md).
ensureColumn('reports', 'milestone_alpha_status', 'milestone_alpha_status TEXT');
ensureColumn('reports', 'milestone_beta_status', 'milestone_beta_status TEXT');
ensureColumn('reports', 'milestone_ga_status', 'milestone_ga_status TEXT');

// Planning Light (see FUNCTIONAL_RULES.md) — a project opts in by setting its BigPicture box ID;
// projects that leave this unset keep the existing portfolioChildrenOf-based Planning behavior
// completely unchanged (checked at the call site in server.js, not here).
ensureColumn('projects', 'bigpicture_box_id', 'bigpicture_box_id TEXT');
// The Jira key of the node one level up in the BigPicture-scoped tree (resolved from each issue's
// own portfolio-parent field), used for the parent/child date rollup. Null for anything not
// populated via the BigPicture path — existing epics_cache readers (Cleanup, project detail epic
// count) don't look at this column and are unaffected by its presence.
ensureColumn('epics_cache', 'parent_key', 'parent_key TEXT');
// The fully-resolved Planning Light tree (scope + hierarchy + rollup dates + hide/rename/group
// overrides already applied), frozen at report-generation time — same frozen-snapshot rule as
// workstreams_snapshot_json/epics_snapshot_json: a past week's report must never silently change
// because a PM hides a node next week. NULL for a project not using Planning Light, and for any
// report row generated before this column existed.
ensureColumn('reports', 'planning_snapshot_json', 'planning_snapshot_json TEXT');

// A first version of "milestones" auto-discovered them from the Jira epic hierarchy / a Confluence
// heading convention, grouping the Deliverable matrix by whichever ones it found. Retired: on a
// real project (BGP) the Jira hierarchy it relied on didn't actually separate the phases a PM has
// in mind (nearly everything sat under a single "beta" epic regardless of its real phase), so the
// auto-detected grouping was unreliable. Replaced by the three fixed, manually-set fields above.
// Cleans up after that attempt on any database that already ran it — safe/idempotent either way.
db.exec('DROP TABLE IF EXISTS milestones_cache');
if (db.prepare(`PRAGMA table_info(reports)`).all().some(c => c.name === 'milestones_snapshot_json')) {
  db.exec('ALTER TABLE reports DROP COLUMN milestones_snapshot_json');
}

// extra_epics (pinning arbitrary Jira keys into Planning regardless of the automatic portfolio
// walk) is retired — Planning scope is meant to come directly from BigPicture's own scope
// definition for the project instead (a future change), making a manually-typed pin list
// redundant. Not a milestone-related field, but retired at the same time for the same "manual
// workaround superseded by reading the real source of truth" reason.
if (db.prepare(`PRAGMA table_info(projects)`).all().some(c => c.name === 'extra_epics')) {
  db.exec('ALTER TABLE projects DROP COLUMN extra_epics');
}

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

// Reverses the milestone-grouping attempt's widened uniqueness — (project_id, milestone_key,
// deliverable, name) back down to (project_id, deliverable, name) — and drops the now-unused
// milestone_key/milestone_name columns along with it (see the retirement note above). Same
// table-rebuild pattern as the migration above, run only if a database still has the wider index.
const wsUniqueIdx2 = db.prepare(`PRAGMA index_list(workstreams)`).all().find(ix => ix.unique && ix.origin === 'u');
const wsUniqueCols2 = wsUniqueIdx2 ? db.prepare(`PRAGMA index_info(${wsUniqueIdx2.name})`).all().map(c => c.name) : [];
if (wsUniqueCols2.includes('milestone_key')) {
  db.exec(`
    CREATE TABLE workstreams_plain (
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
    INSERT OR IGNORE INTO workstreams_plain(id,project_id,deliverable,name,team,jira_key,default_status,sort_order)
      SELECT id,project_id,deliverable,name,team,jira_key,default_status,sort_order FROM workstreams;
    DROP TABLE workstreams;
    ALTER TABLE workstreams_plain RENAME TO workstreams;
  `);
}

// "What's new" (see whats-new.js): the date of the newest entry a user has seen on the page, and
// which entries already went out in a Webex digest — so a digest never repeats itself.
ensureColumn('users', 'whats_new_seen_at', 'whats_new_seen_at TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS digest_sent (
  entry_id TEXT PRIMARY KEY,
  sent_at  INTEGER DEFAULT (unixepoch())
)`);

module.exports = db;
