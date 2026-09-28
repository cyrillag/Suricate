const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const puppeteer  = require('puppeteer-core');
const db         = require('./db');
const jira       = require('./jira');
const bigpicture = require('./bigpicture');
const confluence = require('./confluence');
const genReport  = require('./report-gen');
const { REPORTED_LEVEL_TYPES } = genReport;
const qualityCheck = require('./quality-check');
const { translate, pluralize } = require('./i18n');
const { AppError } = require('./errors');

const SQLiteStore = require('connect-sqlite3')(session);
const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '.';

const JIRA_TOKEN = process.env.JIRA_SERVICE_TOKEN;
if (!JIRA_TOKEN) console.warn('WARNING: JIRA_SERVICE_TOKEN not set — Jira API calls will fail.');
const CONFLUENCE_TOKEN = process.env.CONFLUENCE_SERVICE_TOKEN;
if (!CONFLUENCE_TOKEN) console.warn('WARNING: CONFLUENCE_SERVICE_TOKEN not set — Confluence sync will be unavailable.');
// Only needed by projects that opt into Planning Light (projects.bigpicture_box_id) — most
// projects don't, so this warning is informational, not fatal, unlike the two above.
const BIGPICTURE_TOKEN = process.env.BIGPICTURE_API_TOKEN;
if (!BIGPICTURE_TOKEN) console.warn('WARNING: BIGPICTURE_API_TOKEN not set — Planning Light will be unavailable.');

// No fallback: a hardcoded default here would let anyone who reads this (public) source forge
// session cookies for any deployment that forgot to set the real secret.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) { console.error('FATAL: SESSION_SECRET not set.'); process.exit(1); }

// A headless Chromium instance is expensive to start (hundreds of ms) — one shared instance
// across every PDF export request, launched lazily on first use rather than at boot (most
// deployments may never export a single PDF in a given process lifetime). See FUNCTIONAL_RULES.md
// "Report export" for why this renders the exact live report page instead of a separate template.
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserPromise;
}
process.on('SIGTERM', async () => { if (browserPromise) (await browserPromise).close(); });

// A single optional milestone epic key (Alpha/Beta/GA — see FUNCTIONAL_RULES.md "Milestones") —
// accepts either the bare key ("LVL2-9493") or a full Jira issue URL (e.g.
// "https://jira.ovhcloud.tools/browse/LVL2-9493"), pasted straight from the browser's address bar
// like the Confluence URL field already allows. Blank or malformed input both just mean "not set"
// rather than a validation error, since these fields are always optional — this also reaches a
// REST path segment (jira.getRootEpicMeta), so validating the shape still matters even though
// there's no error path for a bad one.
function parseMilestoneEpic(raw) {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  const keyMatch = trimmed.match(/([A-Z][A-Z0-9]*-\d+)$/i);
  const key = (keyMatch ? keyMatch[1] : trimmed).toUpperCase();
  return /^[A-Z][A-Z0-9]*-\d+$/.test(key) ? key : null;
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function uniqueSlug(baseName) {
  const base = slugify(baseName);
  let slug = base, n = 2;
  while (db.prepare('SELECT 1 FROM projects WHERE slug=?').get(slug)) slug = `${base}-${n++}`;
  return slug;
}

// Two independently-encoded query params rather than one delimited string — Jira/Confluence
// error messages routinely contain ':' and ',' (JSON bodies), which previously corrupted a
// single comma/colon-joined "source:message" param when Express URL-decoded it.
function warningQuery({ source, message }) {
  return new URLSearchParams({ syncSource: source, syncMessage: message }).toString();
}

// Translates any caught error into a human sentence a PM can act on — never the raw
// HTTP status/JSON body a failed Jira/Confluence call throws. AppErrors carry a stable
// `code` (see errors.js) that maps 1:1 to a `detail.err_*` dictionary key; anything else
// (a bug, an unclassified exception) falls back to a generic apologetic message instead
// of leaking a stack trace or API payload into the UI. The raw error is always logged
// server-side so it stays debuggable.
function friendlyError(t, err) {
  console.error(err);
  const code = err instanceof AppError ? err.code : 'generic';
  const translated = t(`detail.err_${code}`, err.vars);
  return translated === `detail.err_${code}` ? t('detail.err_generic') : translated;
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

// workstreams.jira_key holds one or more comma-joined keys (a workstream can be backed by
// several epics — see aggregateEpicStatus).
function splitJiraKeys(raw) {
  return (raw || '').split(',').map(k => k.trim()).filter(Boolean);
}

// A workstream's status is the roll-up of every epic behind it, same precedence as the
// deliverable-level roll-up in report-gen: Done only if ALL its epics are done, otherwise
// Blocked if any is blocked, otherwise In Progress if any is in progress, otherwise To Start.
// Returns null (caller decides the default) if jira_key is empty or none of its keys are cached
// yet.
function aggregateEpicStatus(jiraKeyField, epicsByKey) {
  const keys = splitJiraKeys(jiraKeyField);
  if (!keys.length) return null;
  const statuses = keys.map(k => epicsByKey.get(k)).filter(Boolean).map(e => jira.mapStatus(e.status));
  if (!statuses.length) return null;
  if (statuses.every(s => s === 'done')) return 'done';
  if (statuses.some(s => s === 'blk')) return 'blk';
  if (statuses.some(s => s === 'prog')) return 'prog';
  return 'ts';
}

// A workstream's end date is the farthest (latest) End date among every epic behind it — a
// workstream backed by several epics isn't actually finished until the last one is, so that's
// the one date worth surfacing here. Plain ISO string comparison is safe since Jira's End date
// field is always YYYY-MM-DD. Returns null (never a fabricated fallback) if jira_key is empty, no
// epic behind it has a cached End date yet, or none of its epics have an End date set at all —
// same "no date beats a wrong date" rule as epics themselves (see FUNCTIONAL_RULES.md).
function aggregateEpicEndDate(jiraKeyField, epicsByKey) {
  const keys = splitJiraKeys(jiraKeyField);
  if (!keys.length) return null;
  const endDates = keys.map(k => epicsByKey.get(k)?.end_date).filter(Boolean);
  if (!endDates.length) return null;
  return endDates.reduce((latest, d) => (d > latest ? d : latest));
}

// Resolves the CURRENT live matrix/Planning state — used to freeze a snapshot at report
// generation time, and as a last-resort fallback when viewing a report generated before
// snapshots existed (legacyStatusOverrides is that old report's workstream_statuses_json, kept
// only so those older rows don't regress further than they already have).
function resolveWorkstreamsAndEpics(projectId, legacyStatusOverrides) {
  const workstreams = db.prepare('SELECT * FROM workstreams WHERE project_id=? ORDER BY sort_order').all(projectId);
  const epicRows    = db.prepare('SELECT * FROM epics_cache WHERE project_id=? ORDER BY (end_date IS NULL), end_date').all(projectId);
  const epicsByKey  = new Map(epicRows.map(e => [e.jira_key, e]));

  const resolvedWs = workstreams.map(ws => ({
    ...ws,
    status: (legacyStatusOverrides && legacyStatusOverrides[ws.id])
      || (ws.jira_key ? (aggregateEpicStatus(ws.jira_key, epicsByKey) || 'ts') : (ws.default_status || 'ts')),
    endDate: ws.jira_key ? aggregateEpicEndDate(ws.jira_key, epicsByKey) : null
  }));
  // Planning must never show a cancelled epic (either spelling — see jira.js). Checked here
  // against the raw Jira status, not the done/prog/blk/ts bucket mapStatus produces below: once
  // mapped, "cancelled" is indistinguishable from a plain To Start, which is how this used to
  // silently slip through. epicsByKey (matrix status roll-up) is untouched — a workstream can
  // still reference a cancelled epic's key there; this filter only governs the Planning list.
  const epics = epicRows
    .filter(e => !/^cancel(l)?ed$/i.test((e.status || '').trim()))
    .map(e => ({
      key: e.jira_key, label: e.summary, team: e.team,
      status: jira.mapStatus(e.status), start: e.start_date, end: e.end_date
    }));
  return { resolvedWs, epics };
}

const upsertWorkstreamFromJira = db.prepare(`
  INSERT INTO workstreams(project_id,deliverable,name,team,jira_key,sort_order) VALUES(?,?,?,?,?,?)
  ON CONFLICT(project_id,deliverable,name) DO UPDATE SET
    team=excluded.team, jira_key=excluded.jira_key, sort_order=excluded.sort_order`);

const upsertWorkstreamFromConfluence = db.prepare(`
  INSERT INTO workstreams(project_id,deliverable,name,team,jira_key,default_status,sort_order) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(project_id,deliverable,name) DO UPDATE SET
    team=excluded.team, jira_key=excluded.jira_key, default_status=excluded.default_status, sort_order=excluded.sort_order`);

const insEpicCache = db.prepare('INSERT OR REPLACE INTO epics_cache(project_id,jira_key,summary,team,status,start_date,end_date,assignee,reporter,parent_key,cached_at) VALUES(?,?,?,?,?,?,?,?,?,?,unixepoch())');

// Full tree-walk auto-discovery from a root LVL2 epic — creates BOTH the workstream list
// (grouped by team) AND epics_cache. Used only for projects with no Confluence page: once a
// page is configured, Confluence's curated "Deliverables status" table becomes the workstream
// source of truth instead (otherwise the two sources produce different (deliverable,name)
// groupings for the same tickets and end up duplicated side by side).
async function seedWorkstreamsFromJiraTree(projectId, rootEpic) {
  const epics = await jira.getChildEpics(JIRA_TOKEN, rootEpic);
  epics.forEach((e, i) => {
    insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end, e.assignee, e.reporter, null);
    upsertWorkstreamFromJira.run(projectId, e.deliverable, e.summary, e.team, e.key, i);
  });
  reconcileWorkstreams(projectId, epics.map(e => ({ deliverable: e.deliverable, name: e.summary })));
  return epics.length;
}

// Refresh status/dates only, for a known set of Jira keys — does not touch the workstream
// list itself. Used for the "Sync Jira" button on Confluence-backed projects, and internally
// after every Confluence sync to keep epics_cache in step with whatever keys it references.
// jiraKeyFields are workstreams.jira_key values, each possibly comma-joined (see
// aggregateEpicStatus) — flattened here into individual keys before hitting Jira.
async function refreshEpicStatuses(projectId, jiraKeyFields) {
  const keys = [...new Set(jiraKeyFields.flatMap(splitJiraKeys))];
  const epics = await jira.getEpicsByKeys(JIRA_TOKEN, keys);
  epics.forEach(e => insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end, e.assignee, e.reporter, null));
  return epics.length;
}

// The Deliverable matrix stays Confluence-only by design (see syncConfluenceProject), but the
// Planning/Gantt section is meant to show every epic under the root LVL2 — including ones no PM
// has (yet) added to the Confluence "Deliverables status" table. This walks the full Jira tree
// and writes epics_cache only, never touching workstreams, so it's safe to run alongside a
// Confluence-backed project without duplicating or overriding the matrix. Used only for a project
// with no bigpicture_box_id set — see resolvePlanningTree for the alternative, BigPicture-scoped
// path (FUNCTIONAL_RULES.md "Planning Light").
async function refreshFullEpicTree(projectId, rootEpic) {
  const epics = await jira.getPortfolioEpics(JIRA_TOKEN, rootEpic);
  epics.forEach(e => insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end, e.assignee, e.reporter, null));
  return epics.length;
}

// Planning Light (see FUNCTIONAL_RULES.md): the scope comes from BigPicture's own box
// configuration, not a raw Jira portfolio walk. Fetches the box's narrowingQuery/manuallyAddedTasks
// (bigpicture.js), runs that JQL through the plain Jira search API (jira.js's searchByJql), caches
// the result into epics_cache like every other epic-fetching path here, then builds the tree.
async function resolvePlanningTree(projectId, boxId, rootEpic) {
  const { queries, manualKeys } = await bigpicture.getScopeDefinition(BIGPICTURE_TOKEN, boxId);
  const epics = await jira.searchByJql(JIRA_TOKEN, queries, manualKeys);
  epics.forEach(e => insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end, e.assignee, e.reporter, e.parentKey));
  return buildPlanningTree(epics, rootEpic);
}

// Builds the hierarchy from a freshly-fetched BigPicture-scoped epic set — not re-read from
// epics_cache, which can carry rows from other sync paths sharing that same table (Confluence
// Sync Jira, seedWorkstreamsFromJiraTree, refreshFullEpicTree) that have nothing to do with this
// project's Planning Light scope. Rolls dates up from leaves to root (a parent's own dates are never used, only computed — see
// FUNCTIONAL_RULES.md "level above inherits from below" — except on a Phase/Deliverable, whose own
// Jira dates win when set).
function buildPlanningTree(epics, rootEpic) {
  // A Phase/Deliverable-structured box (BGP Service) is built entirely from "Parent-Child" links —
  // an issue attached only through a leftover Parent Link/Epic Link isn't part of that structure and
  // must not skew a Phase's or Deliverable's rollup (verified on BGP: old NETDC epics still pointing
  // at the ALPHA phase via Parent Link pushed its end from Dec 2025 to Jul 2026). Links only, then.
  // Detected by a Phase linked directly under the project's root epic, not by the mere presence of
  // a Phase/Deliverable issue — Encryption at Rest's box (HYBR-95) carries one stray Deliverable in
  // an otherwise Epic-based tree, and a presence check collapsed its ~35 rows down to 2.
  const structured = epics.some(e => e.type === 'Phase' && e.linkParentKey && e.linkParentKey === rootEpic);

  const byKey = new Map();
  epics.forEach(e => {
    byKey.set(e.key, {
      key: e.key, summary: e.summary, status: jira.mapStatus(e.status),
      type: e.type, start: e.start, end: e.end,
      parentKey: (structured ? e.linkParentKey : e.parentKey) || null,
      // Frozen with the snapshot, so flattenPlanningTree knows which row rule applies — a legacy
      // snapshot without it keeps the Epic-level rule.
      structured,
      children: []
    });
  });

  const roots = [];
  byKey.forEach(node => {
    if (node.parentKey && byKey.has(node.parentKey)) byKey.get(node.parentKey).children.push(node);
    else roots.push(node);
  });

  // Post-order: children first, so a parent always rolls up from already-rolled-up children.
  function rollup(node) {
    if (!node.children.length) return node;
    node.children.forEach(rollup);
    const starts = node.children.map(c => c.start).filter(Boolean);
    const ends   = node.children.map(c => c.end).filter(Boolean);
    // Phases/Deliverables are the levels a PM plans on directly in Jira: their own Start/End date
    // wins, each field independently, and only a missing one is computed from below. Their Jira
    // status, on the other hand, is a workflow placeholder ("Request" on every BGP one) — it's
    // always computed from below.
    const plannedLevel = node.structured && REPORTED_LEVEL_TYPES.has(node.type);
    node.start = (plannedLevel && node.start) || (starts.length ? starts.reduce((a, b) => a < b ? a : b) : null);
    node.end   = (plannedLevel && node.end)   || (ends.length ? ends.reduce((a, b) => a > b ? a : b) : null);
    if (plannedLevel) {
      // Same worst-of precedence as every other status roll-up in this app (deliverable-level,
      // multi-epic workstreams): Done only if every child is, otherwise Blocked beats In Progress
      // beats To Start.
      const statuses = node.children.map(c => c.status);
      node.status = statuses.every(s => s === 'done') ? 'done'
        : statuses.some(s => s === 'blk') ? 'blk'
        : statuses.some(s => s === 'prog') ? 'prog' : 'ts';
    }
    return node;
  }
  roots.forEach(rollup);

  // Chronological order at every level, on the effective (own-or-rolled-up) dates: by end date, or
  // by start for an item with only a start date, then by start; undated items last. End rather
  // than start, per the PM: what reads as "order" in a plan is when things finish. Jira's search
  // order is meaningless here — BGP's GA phase came out above ALPHA/BETA even though it ends last.
  const sortKey = n => n.end || n.start || '9999-12-31';
  const byDate = (a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.start || '9999-12-31').localeCompare(b.start || '9999-12-31');
  (function sortTree(nodes) { nodes.sort(byDate); nodes.forEach(n => sortTree(n.children)); })(roots);
  return roots;
}

// Deletes any workstream row for this project that the current parse no longer produces.
// upsertWorkstreamFrom{Confluence,Jira} only ever inserts/updates — a workstream renamed or
// removed on the source, or a stale row left behind by a since-fixed parser bug, would
// otherwise sit in the table forever instead of the sync actually reconciling to the source.
function reconcileWorkstreams(projectId, currentWorkstreams) {
  const survivors = new Set(currentWorkstreams.map(ws => `${ws.deliverable}|||${ws.name}`));
  const existing = db.prepare('SELECT id, deliverable, name FROM workstreams WHERE project_id=?').all(projectId);
  const staleIds = existing.filter(w => !survivors.has(`${w.deliverable}|||${w.name}`)).map(w => w.id);
  if (staleIds.length) {
    db.prepare(`DELETE FROM workstreams WHERE id IN (${staleIds.map(() => '?').join(',')})`).run(...staleIds);
  }
}

async function syncConfluenceProject(projectId, spaceKey, page) {
  const pageData = await confluence.fetchPageBody(CONFLUENCE_TOKEN, spaceKey, page);
  const format = confluence.validatePageFormat(pageData.html);
  if (!format.hasDeliverables) {
    throw new AppError('confluence_no_deliverables_table', 'Confluence page found, but no "Deliverables status" table could be parsed.');
  }
  const workstreams = confluence.parseDeliverables(pageData.html);
  if (!workstreams.length) {
    throw new AppError('confluence_empty_deliverables', 'The "Deliverables status" table was found but appears empty.');
  }
  workstreams.forEach((ws, i) => {
    upsertWorkstreamFromConfluence.run(
      projectId, ws.deliverable, ws.name, ws.team, ws.jira_key,
      ws.manual_status ? jira.mapStatus(ws.manual_status) : null, i
    );
  });
  reconcileWorkstreams(projectId, workstreams);
  try { await refreshEpicStatuses(projectId, workstreams.map(w => w.jira_key)); }
  catch (err) { console.warn(`Epic status refresh failed for project ${projectId}: ${err.message}`); }
  return { version: pageData.version, workstreams };
}

// ISO week helpers
function isoWeek(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
}
function isoYear(date) {
  const d = new Date(date); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  return d.getFullYear();
}
function currentWeekStr() {
  const n = new Date();
  return `${isoYear(n)}-W${String(isoWeek(n)).padStart(2,'0')}`;
}
function isFutureWeek(year, week) {
  const n = new Date();
  const curYear = isoYear(n), curWeek = isoWeek(n);
  return year > curYear || (year === curYear && week > curWeek);
}
function isPastWeek(year, week) {
  const n = new Date();
  const curYear = isoYear(n), curWeek = isoWeek(n);
  return year < curYear || (year === curYear && week < curWeek);
}
// Same algorithm as report-gen.js's own adjacentWeek (not exported from there, and this module
// already has its own ISO week primitives) — steps a whole number of weeks from the Monday of
// (year,week) and re-derives the resulting ISO (year,week), so it's correct across year
// boundaries (a year can have 52 or 53 ISO weeks) instead of naively adding/subtracting 1.
function adjacentWeek(year, week, delta) {
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - dow + 1 + (week - 1 + delta) * 7);
  return { year: isoYear(mon), week: isoWeek(mon) };
}

// ── App setup ─────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  next();
}

// Never redirect to whatever a query/form param says verbatim — only ever an internal path.
// Guards against an open redirect (returnTo=https://evil.example or the protocol-relative
// returnTo=//evil.example, which browsers treat as a full external URL).
function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('://')) return '/';
  return value;
}

// ── LANGUAGE (FR default) ────────────────────────────────────────
// Plain cookie, no cookie-parser dependency needed just for one value.
function getLang(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)lang=(fr|en)/);
  return m ? m[1] : 'fr';
}
app.use((req, res, next) => {
  req.lang = getLang(req);
  res.locals.lang = req.lang;
  res.locals.t = (key, vars) => translate(req.lang, key, vars);
  res.locals.tPlural = (count, oneKey, otherKey) => pluralize(req.lang, count, oneKey, otherKey);
  next();
});
app.get('/lang/:code', (req, res) => {
  res.cookie('lang', req.params.code === 'en' ? 'en' : 'fr', { maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.redirect(req.get('Referer') || '/');
});

// ── LOGIN ─────────────────────────────────────────────────────────
// A logged-out visitor hitting a shared report link is bounced here by requireAuth with
// ?returnTo=<the link they wanted> — carried through the form as a hidden field, and back out
// via the post-login redirect, so a shared link actually lands where it promised to instead of
// dumping everyone on their own (possibly empty, if they don't own that project) dashboard.
app.get('/login', (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo);
  if (req.session.userId) return res.redirect(returnTo);
  res.render('login', { error: null, returnTo });
});

app.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const returnTo = safeReturnTo(req.body.returnTo);
  if (!email || !email.includes('@')) return res.render('login', { error: res.locals.t('login.err_email_required'), returnTo });
  try {
    const me = await jira.findUserByEmail(JIRA_TOKEN, email);
    if (!me) return res.render('login', { error: res.locals.t('login.err_not_found'), returnTo });
    const accountId   = me.key || me.name;
    const displayName = me.displayName || me.name || email;
    const existing = db.prepare('SELECT id FROM users WHERE jira_account_id=?').get(accountId);
    let uid;
    if (existing) {
      db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(displayName, email, existing.id);
      uid = existing.id;
    } else {
      uid = db.prepare('INSERT INTO users(jira_account_id,name,email,jira_token) VALUES(?,?,?,?)')
        .run(accountId, displayName, email, '').lastInsertRowid;
    }
    req.session.userId   = uid;
    req.session.userName = displayName;
    req.session.save(() => res.redirect(returnTo));
  } catch (err) {
    res.render('login', { error: res.locals.t('login.err_generic') + friendlyError(res.locals.t, err), returnTo });
  }
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ── DASHBOARD ─────────────────────────────────────────────────────
// Every project is visible to every authenticated OVHcloud user (see FUNCTIONAL_RULES.md
// "Visibility & permissions") — only the creator (projects.user_id) can edit/delete/generate.
// The dashboard is a read-only shared listing, not a private "my projects" view.
app.get('/', requireAuth, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, u.name as owner_name,
      (SELECT COUNT(*) FROM reports r WHERE r.project_id=p.id) as report_count,
      (SELECT printf('%d-W%02d', year, week) FROM reports r WHERE r.project_id=p.id ORDER BY year DESC, week DESC LIMIT 1) as last_report
    FROM projects p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC`).all();
  res.render('dashboard', { projects, userName: req.session.userName, userId: req.session.userId, currentWeek: currentWeekStr() });
});

// ── PROJECTS ──────────────────────────────────────────────────────
app.get('/projects/new', requireAuth, (req, res) => {
  res.render('project-new', { error: null, userName: req.session.userName });
});

app.post('/projects', requireAuth, async (req, res) => {
  const { name, jira_root_epic, confluence_url } = req.body;
  if (!name?.trim() || !jira_root_epic?.trim())
    return res.render('project-new', { error: res.locals.t('newProject.err_required'), userName: req.session.userName });

  // Confluence is mandatory: the "Deliverables status", "Week summary" and "Risk matrix"
  // sections it supplies aren't derivable from Jira alone.
  const confPage = await confluence.resolvePageUrl(CONFLUENCE_TOKEN, confluence_url);
  if (!confPage)
    return res.render('project-new', { error: res.locals.t('newProject.err_confluence_url'), userName: req.session.userName });

  const slug = uniqueSlug(name);
  const epic = jira_root_epic.trim().toUpperCase();

  // Target ETA is inherited from the root epic's "End date" — not user-entered.
  let eta = null;
  try { eta = formatDate((await jira.getRootEpicMeta(JIRA_TOKEN, epic)).eta); }
  catch (err) { console.warn(`Could not read ETA from ${epic}: ${err.message}`); }

  let projId;
  try {
    projId = db.prepare('INSERT INTO projects(user_id,name,slug,jira_root_epic,eta,confluence_space,confluence_page) VALUES(?,?,?,?,?,?,?)')
      .run(req.session.userId, name.trim(), slug, epic, eta, confPage.space, confPage.page).lastInsertRowid;
  } catch (err) {
    console.error(err);
    return res.render('project-new', { error: res.locals.t('newProject.err_create_failed'), userName: req.session.userName });
  }

  // Project row is committed at this point — a sync failure is recoverable via the "Sync"
  // buttons on the project page, so we redirect either way instead of losing the created project.
  let warning = null;
  try { await syncConfluenceProject(projId, confPage.space, confPage.page); }
  catch (err) { warning = { source: 'confluence', message: friendlyError(res.locals.t, err) }; }

  // Best-effort: the Planning/Gantt section is independent of the Confluence matrix, so a
  // Jira hiccup here shouldn't block creation or override the (more actionable) Confluence
  // warning above — it's silently recoverable later via the "Sync Jira" button.
  try { await refreshFullEpicTree(projId, epic); }
  catch (err) { console.warn(`Could not sync full epic tree for ${epic}: ${err.message}`); }

  res.redirect(`/projects/${slug}${warning ? '?' + warningQuery(warning) : ''}`);
});

app.post('/projects/:slug/delete', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  // Cascades to workstreams, epics_cache and reports (all FK'd with ON DELETE CASCADE).
  db.prepare('DELETE FROM projects WHERE id=?').run(proj.id);
  res.redirect('/');
});

function confluenceUrlFor(space, page) {
  return `${process.env.CONFLUENCE_BASE || 'https://confluence.ovhcloud.tools'}/display/${encodeURIComponent(space)}/${encodeURIComponent(page).replace(/%20/g, '+')}`;
}

// Renaming a project never changes its slug — the slug is the stable identifier used in URLs
// and by every other route, so keeping it fixed avoids breaking bookmarks/links on rename.
app.get('/projects/:slug/edit', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  res.render('project-edit', { proj, confluenceUrl: confluenceUrlFor(proj.confluence_space, proj.confluence_page), error: null, userName: req.session.userName });
});

app.post('/projects/:slug/edit', requireAuth, async (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  const { name, jira_root_epic, confluence_url, milestone_alpha, milestone_beta, milestone_ga, bigpicture_box_id } = req.body;
  const rerender = error => res.render('project-edit', { proj: { ...proj, name, jira_root_epic, milestone_alpha, milestone_beta, milestone_ga, bigpicture_box_id }, confluenceUrl: confluence_url, error, userName: req.session.userName });

  if (!name?.trim() || !jira_root_epic?.trim()) return rerender(res.locals.t('editProject.err_required'));
  const confPage = await confluence.resolvePageUrl(CONFLUENCE_TOKEN, confluence_url);
  if (!confPage) return rerender(res.locals.t('editProject.err_confluence_url'));

  const epic = jira_root_epic.trim().toUpperCase();
  let eta = proj.eta;
  try { eta = formatDate((await jira.getRootEpicMeta(JIRA_TOKEN, epic)).eta); }
  catch (err) { console.warn(`Could not read ETA from ${epic}: ${err.message}`); }

  // Free-form (no key-shape validation like the milestone fields get): a BigPicture box ID isn't
  // always a Jira-issue-shaped key (see FUNCTIONAL_RULES.md "Planning Light") — just trim it to a
  // plain string, or null out an emptied field.
  const boxId = (bigpicture_box_id || '').trim() || null;

  db.prepare(`UPDATE projects SET name=?,jira_root_epic=?,eta=?,confluence_space=?,confluence_page=?,
      milestone_alpha=?,milestone_beta=?,milestone_ga=?,bigpicture_box_id=? WHERE id=?`)
    .run(name.trim(), epic, eta, confPage.space, confPage.page,
      parseMilestoneEpic(milestone_alpha), parseMilestoneEpic(milestone_beta), parseMilestoneEpic(milestone_ga), boxId, proj.id);

  res.redirect(`/projects/${proj.slug}`);
});

// Fills in any missed week between the earliest existing report and the current week with a
// placeholder (exists:false) row, so a gap like 3 weeks of vacation shows up as visible "No
// report" rows instead of just silently vanishing from the list (the list only ever queried
// existing rows before, so skipped weeks were invisible — the very thing that made the live
// matrix/risks on a since-backfilled report read as a real historical record instead of
// leftover current-day data). Returns at most the most recent `limit` weeks, whether real or gap.
function reportListWithGaps(projectId, limit) {
  const existing = db.prepare('SELECT year,week,backfilled FROM reports WHERE project_id=?').all(projectId);
  if (!existing.length) return [];
  const byKey = new Map(existing.map(r => [`${r.year}-${r.week}`, r]));
  const earliest = existing.reduce((a, b) => (b.year < a.year || (b.year === a.year && b.week < a.week)) ? b : a);
  const now = new Date();
  const current = { year: isoYear(now), week: isoWeek(now) };

  const sequence = [];
  let cur = { year: earliest.year, week: earliest.week };
  while (cur.year < current.year || (cur.year === current.year && cur.week <= current.week)) {
    const found = byKey.get(`${cur.year}-${cur.week}`);
    sequence.push(found ? { year: cur.year, week: cur.week, backfilled: !!found.backfilled, exists: true } : { year: cur.year, week: cur.week, exists: false });
    cur = adjacentWeek(cur.year, cur.week, 1);
  }
  return sequence.reverse().slice(0, limit);
}

// Read-only for anyone authenticated (same reasoning as the dashboard above) — the mutation
// routes below (edit/delete/generate) each re-check ownership independently, so this route being
// open doesn't loosen who can actually change anything.
app.get('/projects/:slug', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT p.*, u.name as owner_name FROM projects p JOIN users u ON u.id=p.user_id WHERE p.slug=?').get(req.params.slug);
  if (!proj) return res.status(404).send('Project not found.');
  const isOwner = proj.user_id === req.session.userId;
  const reports  = reportListWithGaps(proj.id, 10);
  const wsCount  = db.prepare('SELECT COUNT(*) as n FROM workstreams WHERE project_id=?').get(proj.id).n;
  const epicCount= db.prepare('SELECT COUNT(*) as n FROM epics_cache WHERE project_id=?').get(proj.id).n;
  const syncWarning = req.query.syncSource ? [{ source: req.query.syncSource, message: req.query.syncMessage || '' }] : [];
  res.render('project-detail', { proj, reports, wsCount, epicCount, syncWarning, isOwner, userName: req.session.userName, currentWeek: currentWeekStr() });
});

// ── CLEANUP (tracking-quality check) ─────────────────────────────
// Read-only, no ownership check — same visibility rule as the project-detail/report views
// (every authenticated user can see every project). Reads live from epics_cache, which is only
// as fresh as the last "↻ Refresh"/Generate action (refreshFullEpicTree) — there is no separate
// sync button here either, by the same rule that removed the standalone Sync Jira/Confluence
// buttons (see FUNCTIONAL_RULES.md): the Generate/Refresh form is reused as-is on this page.
app.get('/projects/:slug/cleanup', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT p.*, u.name as owner_name FROM projects p JOIN users u ON u.id=p.user_id WHERE p.slug=?').get(req.params.slug);
  if (!proj) return res.status(404).send('Project not found.');
  const isOwner = proj.user_id === req.session.userId;
  const epics = db.prepare('SELECT * FROM epics_cache WHERE project_id=? ORDER BY team, jira_key').all(proj.id);
  const lastSynced = epics.reduce((max, e) => Math.max(max, e.cached_at || 0), 0) || null;
  const result = qualityCheck.runQualityCheck(epics);
  res.render('cleanup', {
    proj, isOwner, result, lastSynced, formatDate,
    issueUrl: qualityCheck.jiraIssueUrl, keysJqlUrl: qualityCheck.jiraKeysJqlUrl,
    userName: req.session.userName, currentWeek: currentWeekStr()
  });
});

// ── REPORT GENERATION ────────────────────────────────────────────
// No manual authoring: a report's content is always pulled fresh from Confluence (highlights,
// risks) and Jira (workstream/epic status, dates) at generation time — there is nothing to edit
// or type in by hand. Re-generating an existing week overwrites it with the current page/Jira
// state, which is the intended way to "correct" a report (fix it at the source, then re-pull).
async function generateReportRow(proj, year, week) {
  let execSummary = null;
  let highlights = { achievements: [], blockers: [], clarify: [] };
  let risks = [];
  if (proj.confluence_space && proj.confluence_page && CONFLUENCE_TOKEN) {
    const page = await confluence.fetchPageBody(CONFLUENCE_TOKEN, proj.confluence_space, proj.confluence_page);
    // Missing table entirely = format problem, worth failing loudly on. No row for THIS week yet
    // is normal/expected (e.g. before the PM has updated the page for the week) — stay silent.
    if (!confluence.validatePageFormat(page.html).hasWeekSummaryTable) {
      throw new AppError('confluence_no_week_summary_table', 'No "Week summary" table could be found on the Confluence page.');
    }
    execSummary = confluence.parseExecSummary(page.html);
    highlights = confluence.parseWeekSummary(page.html, week) || highlights;
    risks = confluence.parseRisks(page.html);
  }
  // Freeze the matrix/Planning state now — this is the one moment a report is allowed to reflect
  // "current" data. From here on, viewing this week must never depend on what workstreams/
  // epics_cache look like later (see FUNCTIONAL_RULES.md).
  const { resolvedWs, epics } = resolveWorkstreamsAndEpics(proj.id);

  // Re-read the root epic's own End date from Jira here too (not just on project create/edit) —
  // otherwise it would only ever change when someone happens to re-save the project, and a
  // week-over-week delay comparison needs it to actually track the source on its own schedule,
  // same as workstreams/epics already do on every generate.
  let etaIso = null;
  try { etaIso = (await jira.getRootEpicMeta(JIRA_TOKEN, proj.jira_root_epic)).eta; }
  catch (err) { console.warn(`Could not read ETA from ${proj.jira_root_epic}: ${err.message}`); }
  db.prepare('UPDATE projects SET eta=? WHERE id=?').run(formatDate(etaIso), proj.id);

  // Same re-read-on-every-generate treatment as the root epic's own ETA above, for each of the up
  // to 3 fixed milestone epics a project optionally names (see FUNCTIONAL_RULES.md "Milestones") —
  // frozen into this report row so a past week's Project Identity chips never silently change if
  // one of these dates moves in Jira after the fact.
  const milestoneEnds = {};
  const milestoneStatuses = {};
  for (const field of ['milestone_alpha', 'milestone_beta', 'milestone_ga']) {
    milestoneEnds[field] = null;
    milestoneStatuses[field] = null;
    if (!proj[field]) continue;
    try {
      const meta = await jira.getRootEpicMeta(JIRA_TOKEN, proj[field]);
      milestoneEnds[field] = meta.eta;
      milestoneStatuses[field] = meta.status;
    }
    catch (err) { console.warn(`Could not read End date from ${proj[field]}: ${err.message}`); }
  }

  // Planning Light (see FUNCTIONAL_RULES.md): when a project has opted in via bigpicture_box_id,
  // the Planning section's tree comes from BigPicture's own configured scope instead of the flat
  // jira_root_epic walk — resolved and frozen here, same re-read-on-every-generate treatment as
  // the ETA/milestones above. Left null (rendering falls back to the existing flat epics_snapshot
  // view) on any failure, so a BigPicture outage doesn't block report generation.
  let planningTree = null;
  if (proj.bigpicture_box_id && BIGPICTURE_TOKEN) {
    try { planningTree = await resolvePlanningTree(proj.id, proj.bigpicture_box_id, proj.jira_root_epic); }
    catch (err) { console.warn(`Could not resolve Planning Light tree for box ${proj.bigpicture_box_id}: ${err.message}`); }
  }

  // Delayed = later than the most recent *existing* prior report's own frozen eta_snapshot —
  // not necessarily literally last week, so backfilling a gap still compares against the right
  // baseline. Never true if either side is unknown (no prior report yet, or no End date set).
  const prevEta = db.prepare(`
    SELECT eta_snapshot FROM reports WHERE project_id=? AND (year<? OR (year=? AND week<?))
    ORDER BY year DESC, week DESC LIMIT 1`).get(proj.id, year, year, week);
  const etaDelayed = !!(prevEta?.eta_snapshot && etaIso && etaIso > prevEta.eta_snapshot);

  // Only ever meaningful on the row's first INSERT — deliberately absent from the ON CONFLICT
  // UPDATE SET below, so an already-backfilled row can't be un-flagged later, and a normal
  // current-week row being refreshed several times doesn't get re-evaluated on every click (it
  // would still always come out false for it anyway, since only the current week can be
  // regenerated at all — but the intent is "set once at creation", not "recomputed every write").
  const backfilled = isPastWeek(year, week) ? 1 : 0;

  db.prepare(`INSERT INTO reports(project_id,year,week,exec_summary,highlights_json,risks_json,workstream_statuses_json,workstreams_snapshot_json,epics_snapshot_json,planning_snapshot_json,eta_snapshot,eta_delayed,milestone_alpha_end,milestone_beta_end,milestone_ga_end,milestone_alpha_status,milestone_beta_status,milestone_ga_status,backfilled,updated_at)
    VALUES(?,?,?,?,?,?,'{}',?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())
    ON CONFLICT(project_id,year,week) DO UPDATE SET
      exec_summary=excluded.exec_summary,
      highlights_json=excluded.highlights_json,
      risks_json=excluded.risks_json,
      workstreams_snapshot_json=excluded.workstreams_snapshot_json,
      epics_snapshot_json=excluded.epics_snapshot_json,
      planning_snapshot_json=excluded.planning_snapshot_json,
      eta_snapshot=excluded.eta_snapshot,
      eta_delayed=excluded.eta_delayed,
      milestone_alpha_end=excluded.milestone_alpha_end,
      milestone_beta_end=excluded.milestone_beta_end,
      milestone_ga_end=excluded.milestone_ga_end,
      milestone_alpha_status=excluded.milestone_alpha_status,
      milestone_beta_status=excluded.milestone_beta_status,
      milestone_ga_status=excluded.milestone_ga_status,
      updated_at=unixepoch()`).run(proj.id, year, week, execSummary, JSON.stringify(highlights), JSON.stringify(risks), JSON.stringify(resolvedWs), JSON.stringify(epics), planningTree ? JSON.stringify(planningTree) : null, etaIso, etaDelayed ? 1 : 0,
      milestoneEnds.milestone_alpha, milestoneEnds.milestone_beta, milestoneEnds.milestone_ga,
      milestoneStatuses.milestone_alpha, milestoneStatuses.milestone_beta, milestoneStatuses.milestone_ga, backfilled);
}

app.post('/projects/:slug/reports/generate', requireAuth, async (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  const weekStr  = req.body.week || req.query.week || currentWeekStr();
  const [yr, wn] = weekStr.split('-W');
  const year = parseInt(yr), week = parseInt(wn);
  if (!Number.isInteger(week) || week < 1 || week > 53 || !Number.isInteger(year)) {
    return res.redirect(`/projects/${proj.slug}?${warningQuery({ source: 'confluence', message: res.locals.t('detail.err_invalid_week', { week: weekStr }) })}`);
  }
  if (isFutureWeek(year, week)) {
    return res.redirect(`/projects/${proj.slug}?${warningQuery({ source: 'confluence', message: res.locals.t('detail.err_future_week') })}`);
  }

  // A past week that already has a report is a frozen snapshot (see FUNCTIONAL_RULES.md) —
  // regenerating it would overwrite real history with today's Confluence/Jira state. Only the
  // current week (still "live") stays freely regenerable; a past week with no report yet can
  // still be generated for the first time (backfilling a missed week), since there is nothing
  // frozen to lose there.
  if (isPastWeek(year, week)) {
    const existing = db.prepare('SELECT 1 FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
    if (existing) {
      return res.redirect(`/projects/${proj.slug}?${warningQuery({ source: 'confluence', message: res.locals.t('detail.err_past_week_locked') })}`);
    }
  }

  // Generate/Regenerate is the single action that refreshes everything — workstreams, epic
  // statuses, Planning, and the week's own content — rather than requiring a separate Sync
  // Jira/Sync Confluence click first. Those buttons worked but had no visible effect on this
  // page (only the button's own text changed for 3s), which read as broken even though the
  // sync itself succeeded — folding it into the one action people actually look for feedback
  // from fixes that.
  let syncFailure = null;
  try {
    if (proj.confluence_space && proj.confluence_page) {
      await syncConfluenceProject(proj.id, proj.confluence_space, proj.confluence_page);
      // Planning Light projects get their epics_cache population from resolvePlanningTree instead
      // (called inside generateReportRow, right below) — running both would just double the Jira
      // calls for a flat epic set the BigPicture-scoped Planning section no longer renders.
      if (!proj.bigpicture_box_id) await refreshFullEpicTree(proj.id, proj.jira_root_epic);
    } else {
      await seedWorkstreamsFromJiraTree(proj.id, proj.jira_root_epic);
    }
  } catch (err) {
    syncFailure = friendlyError(res.locals.t, err);
  }

  try {
    await generateReportRow(proj, year, week);
  } catch (err) {
    return res.redirect(`/projects/${proj.slug}?${warningQuery({ source: 'confluence', message: friendlyError(res.locals.t, err) })}`);
  }

  if (syncFailure) {
    return res.redirect(`/projects/${proj.slug}?${warningQuery({ source: 'confluence', message: syncFailure })}`);
  }
  res.redirect(`/projects/${proj.slug}/${year}-W${String(week).padStart(2,'0')}`);
});

app.post('/projects/:slug/reports/:yearweek(\\d{4}-W\\d{2})/delete', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  const [yr, wn] = req.params.yearweek.split('-W');
  db.prepare('DELETE FROM reports WHERE project_id=? AND year=? AND week=?').run(proj.id, parseInt(yr), parseInt(wn));
  res.redirect(`/projects/${proj.slug}`);
});

// ── REPORT VIEW ───────────────────────────────────────────────────
// Shared by the HTML report view and the PDF export route — a report row plus the project/owner/
// locale context around it is everything genReport() needs, regardless of which one asked for it.
function buildReportHtml(proj, report, year, week, isOwner, lang, userName) {
  // A report is a frozen snapshot from the moment it was generated — never recompute the
  // matrix/Planning from the live workstreams/epics_cache tables for a row that already has one
  // (that live-recompute was the actual bug: a workstream added or changing status *after* a past
  // week was generated used to silently show up in that old week too). Only a legacy row from
  // before this existed falls back to live data, seeded with whatever the old per-ID status
  // override map still applies to.
  let resolvedWs, epicsForView;
  if (report.workstreams_snapshot_json) {
    resolvedWs = JSON.parse(report.workstreams_snapshot_json);
    epicsForView = report.epics_snapshot_json ? JSON.parse(report.epics_snapshot_json) : [];
  } else {
    const legacyOverrides = JSON.parse(report.workstream_statuses_json || '{}');
    const live = resolveWorkstreamsAndEpics(proj.id, legacyOverrides);
    resolvedWs = live.resolvedWs;
    epicsForView = live.epics;
  }
  // Planning Light's tree (see FUNCTIONAL_RULES.md) — frozen alongside everything else above, so
  // an old week's report never changes because a PM hid/renamed/regrouped something afterward.
  // null for every project that hasn't opted in (no bigpicture_box_id) or predates this feature —
  // report-gen.js falls back to the flat epicsForView list in that case.
  const planningTree = report.planning_snapshot_json ? JSON.parse(report.planning_snapshot_json) : null;
  // Up to 3 fixed milestone lines (Alpha/Beta/GA — see FUNCTIONAL_RULES.md "Milestones"), each
  // only included if the project actually named that epic. Dates/statuses come from this report's
  // own frozen snapshot columns, same "never silently change on an old week" rule as eta_snapshot —
  // a legacy row from before these columns existed just has NULL in all three, so nothing shows.
  // "done" is a past-dated milestone whose epic is actually Done — shown as "DONE" instead of a
  // stale-looking expired date. Evaluated against today (not the report's own week) since it's
  // read-time framing, same as the Gantt's own "Today" marker.
  const todayIso = new Date().toISOString().slice(0, 10);
  const milestonesForView = [
    { name: 'Alpha', key: proj.milestone_alpha, end: report.milestone_alpha_end, status: report.milestone_alpha_status },
    { name: 'Beta',  key: proj.milestone_beta,  end: report.milestone_beta_end,  status: report.milestone_beta_status },
    { name: 'GA',    key: proj.milestone_ga,    end: report.milestone_ga_end,    status: report.milestone_ga_status }
  ]
    .filter(m => m.key)
    .map(m => ({ ...m, done: !!(m.end && m.end < todayIso && jira.mapStatus(m.status) === 'done') }));

  const stats = { done:0, prog:0, blk:0, ts:0, total: resolvedWs.length };
  resolvedWs.forEach(ws => stats[ws.status] = (stats[ws.status]||0)+1);
  const risks = JSON.parse(report.risks_json);
  // Workstream progress alone doesn't tell the whole story — a page can list an open HIGH risk
  // while every workstream is still nominally on schedule. Surfacing that risk was the entire
  // point of the Risk matrix section, so it must be able to flip the badge too.
  const hasHighRisk = risks.some(r => r.level === 'high');
  const etaDelayed = !!report.eta_delayed;
  // Delayed is a fact (the date already moved), At Risk is a projection (it might) — not the same
  // thing, so a slip gets its own badge state rather than being folded into "At Risk". Delayed
  // takes precedence when both are true: a confirmed slip is more informative than a risk signal.
  const health = etaDelayed ? 'delayed'
    : (stats.blk > 0 || hasHighRisk) ? 'at-risk'
    : 'on-track';
  let etaDelayedFrom = null;
  if (etaDelayed) {
    const prevEta = db.prepare(`
      SELECT eta_snapshot FROM reports WHERE project_id=? AND (year<? OR (year=? AND week<?))
      ORDER BY year DESC, week DESC LIMIT 1`).get(proj.id, year, year, week);
    etaDelayedFrom = prevEta?.eta_snapshot ? formatDate(prevEta.eta_snapshot) : null;
  }
  // The displayed Target ETA must come from THIS report's own frozen eta_snapshot, never the live
  // projects.eta — that field gets overwritten on every generate (see the At Risk/Delayed rule),
  // so rendering it directly used to make every past week's report silently show today's current
  // date instead of what the target actually was back when that week was generated. A legacy row
  // from before eta_snapshot existed has nothing frozen to show, so it's an honest "TBD" rather
  // than falling back to the live (and by now likely wrong) value.
  const etaDisplay = formatDate(report.eta_snapshot);

  // Not every project is Confluence-backed (a "Jira tree" project has neither field set) — no
  // link to show in that case, never a broken one built from half-empty values.
  const confluenceUrl = (proj.confluence_space && proj.confluence_page)
    ? confluenceUrlFor(proj.confluence_space, proj.confluence_page)
    : null;

  return genReport({
    project: proj, year, week,
    pmName: proj.pm_name,
    execSummary: report.exec_summary,
    highlights:  JSON.parse(report.highlights_json),
    risks, etaDelayed, etaDelayedFrom, etaDisplay,
    workstreams: resolvedWs,
    milestones: milestonesForView,
    epics: epicsForView,
    planningTree,
    stats, health, isOwner,
    backfilled: !!report.backfilled,
    generatedAt: formatDate(new Date(report.created_at * 1000).toISOString()),
    lang, userName, confluenceUrl
  });
}

app.get('/projects/:slug/:yearweek(\\d{4}-W\\d{2})', requireAuth, async (req, res) => {
  const proj = db.prepare(`SELECT p.*,u.name as pm_name FROM projects p JOIN users u ON u.id=p.user_id WHERE p.slug=?`).get(req.params.slug);
  if (!proj) return res.status(404).send('Project not found.');
  const isOwner = proj.user_id === req.session.userId;
  const [yr, wn] = req.params.yearweek.split('-W');
  const year = parseInt(yr), week = parseInt(wn);
  if (week < 1 || week > 53) return res.redirect(`/projects/${req.params.slug}`);
  // Applies whether or not a row already exists — a future week must never be reachable,
  // even one that got created before this guard existed (e.g. by clicking "next" repeatedly).
  if (isFutureWeek(year, week)) return res.redirect(`/projects/${req.params.slug}`);
  let report = db.prepare('SELECT * FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
  if (!report) {
    if (isPastWeek(year, week)) {
      // A past week with no report is never auto-generated by mere navigation anymore — that
      // silently created a permanent, misleading "historical" record built from today's live
      // data (matrix/risks aren't versioned per week, so a report backfilled weeks late looks
      // identical to the current week, not to what was actually true back then). Generating one
      // now is still possible, but only as a deliberate, informed action from this page.
      const prevW = adjacentWeek(year, week, -1);
      const nextW = adjacentWeek(year, week, 1);
      return res.render('report-missing', {
        proj, year, week, userName: req.session.userName,
        weekStr: `${year}-W${String(week).padStart(2, '0')}`,
        prevWeekStr: `${prevW.year}-W${String(prevW.week).padStart(2, '0')}`,
        nextWeekStr: isFutureWeek(nextW.year, nextW.week) ? null : `${nextW.year}-W${String(nextW.week).padStart(2, '0')}`
      });
    }
    // The current week is still "live" — generating it on first visit (e.g. via the week-nav
    // arrows) reflects today's data for today's week, which is simply accurate, not backfilled.
    try { await generateReportRow(proj, year, week); }
    catch (err) { return res.redirect(`/projects/${req.params.slug}?${warningQuery({ source: 'confluence', message: friendlyError(res.locals.t, err) })}`); }
    report = db.prepare('SELECT * FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
  }

  const html = buildReportHtml(proj, report, year, week, isOwner, req.lang, req.session.userName);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── PDF EXPORT ────────────────────────────────────────────────────
// Renders the exact same HTML/CSS the browser shows on-screen (buildReportHtml, unchanged) via a
// headless Chromium page, rather than a separate print-CSS template — that's what makes the PDF
// automatically match the live report instead of being a second thing to keep in sync (see
// FUNCTIONAL_RULES.md "Report export" for why the earlier window.print() attempt was dropped).
app.get('/projects/:slug/:yearweek(\\d{4}-W\\d{2})/pdf', requireAuth, async (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE slug=?').get(req.params.slug);
  if (!proj) return res.status(404).send('Project not found.');
  const [yr, wn] = req.params.yearweek.split('-W');
  const report = db.prepare('SELECT 1 FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, parseInt(yr), parseInt(wn));
  if (!report) return res.status(404).send('Report not found.');

  // Navigates to the app's own live report route (internally, over loopback) rather than
  // re-deriving the HTML in-process — relative asset paths (/app.css, /logo-white.png) only
  // resolve against a real origin, and this way the PDF genuinely cannot drift from whatever the
  // route renders on screen, forever, without any parallel logic to keep in sync.
  const reportUrl = `http://localhost:${PORT}/projects/${req.params.slug}/${req.params.yearweek}`;

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // The Planning/Gantt timeline is a horizontally-scrolling widget on screen
    // (.gantt-outer{overflow-x:auto}) — page.pdf() prints the page's actual layout width, not
    // whatever's scrolled into view, so at the default ~800px viewport every month past the
    // first few got silently clipped rather than scrolled to. A wide viewport lets the whole
    // timeline lay out in full instead of overflowing into a scrollbar; `scale` below then
    // shrinks that wide layout back down to fit a landscape page, the same "shrink to fit" trick
    // a real print dialog does for a wide sheet.
    await page.setViewport({ width: 1600, height: 1000 });
    // Carries the requesting user's own session across — this internal request still goes
    // through requireAuth like any other, so a viewer only ever exports what they're already
    // allowed to see.
    if (req.headers.cookie) await page.setExtraHTTPHeaders({ cookie: req.headers.cookie });
    await page.goto(reportUrl, { waitUntil: 'networkidle0' });
    // The donut chart and the Planning/Gantt timeline both draw themselves via a page-load
    // <script> (canvas + a requestAnimationFrame sweep-in) — 'networkidle0' fires before that
    // animation settles, so the PDF would otherwise capture a half-drawn chart.
    await new Promise(r => setTimeout(r, 1200));
    const pdf = await page.pdf({
      format: 'A4', landscape: true, printBackground: true, scale: 0.72,
      margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}-${req.params.yearweek}.pdf"`);
    // page.pdf() returns a Uint8Array, not a true Node Buffer — express.send() only recognizes
    // Buffer.isBuffer() as "binary payload" and otherwise falls through to JSON-stringifying it
    // (each byte as a numbered object key), silently corrupting the download. Buffer.from() forces
    // the real type regardless of which one puppeteer-core happens to hand back.
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF export failed:', err);
    res.status(500).send(res.locals.t('detail.err_pdf_export'));
  } finally {
    if (page) await page.close();
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Reports app → http://localhost:${PORT}`));
