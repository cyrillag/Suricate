const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const db         = require('./db');
const jira       = require('./jira');
const confluence = require('./confluence');
const genReport  = require('./report-gen');
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

// No fallback: a hardcoded default here would let anyone who reads this (public) source forge
// session cookies for any deployment that forgot to set the real secret.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) { console.error('FATAL: SESSION_SECRET not set.'); process.exit(1); }

// The raw value reaches a JQL string built server-side (jira.getPortfolioEpics) — only
// well-formed Jira keys pass through, both for correctness and so a project owner can't smuggle
// arbitrary JQL into a query run with the shared service token.
function parseExtraEpics(raw) {
  return (raw || '')
    .split(/[\s,]+/)
    .map(k => k.trim().toUpperCase())
    .filter(k => /^[A-Z][A-Z0-9]*-\d+$/.test(k));
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
      || (ws.jira_key ? (aggregateEpicStatus(ws.jira_key, epicsByKey) || 'ts') : (ws.default_status || 'ts'))
  }));
  const epics = epicRows.map(e => ({
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

const insEpicCache = db.prepare('INSERT OR REPLACE INTO epics_cache(project_id,jira_key,summary,team,status,start_date,end_date,cached_at) VALUES(?,?,?,?,?,?,?,unixepoch())');

// Full tree-walk auto-discovery from a root LVL2 epic — creates BOTH the workstream list
// (grouped by team) AND epics_cache. Used only for projects with no Confluence page: once a
// page is configured, Confluence's curated "Deliverables status" table becomes the workstream
// source of truth instead (otherwise the two sources produce different (deliverable,name)
// groupings for the same tickets and end up duplicated side by side).
async function seedWorkstreamsFromJiraTree(projectId, rootEpic) {
  const epics = await jira.getChildEpics(JIRA_TOKEN, rootEpic);
  epics.forEach((e, i) => {
    insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end);
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
  epics.forEach(e => insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end));
  return epics.length;
}

// The Deliverable matrix stays Confluence-only by design (see syncConfluenceProject), but the
// Planning/Gantt section is meant to show every epic under the root LVL2 — including ones no PM
// has (yet) added to the Confluence "Deliverables status" table. This walks the full Jira tree
// and writes epics_cache only, never touching workstreams, so it's safe to run alongside a
// Confluence-backed project without duplicating or overriding the matrix.
async function refreshFullEpicTree(projectId, rootEpic, extraKeys = []) {
  const epics = await jira.getPortfolioEpics(JIRA_TOKEN, rootEpic, extraKeys);
  epics.forEach(e => insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end));
  return epics.length;
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
app.get('/', requireAuth, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM reports r WHERE r.project_id=p.id) as report_count,
      (SELECT printf('%d-W%02d', year, week) FROM reports r WHERE r.project_id=p.id ORDER BY year DESC, week DESC LIMIT 1) as last_report
    FROM projects p WHERE p.user_id=? ORDER BY p.created_at DESC`).all(req.session.userId);
  res.render('dashboard', { projects, userName: req.session.userName, currentWeek: currentWeekStr() });
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
  const { name, jira_root_epic, confluence_url, extra_epics } = req.body;
  const rerender = error => res.render('project-edit', { proj: { ...proj, name, jira_root_epic, extra_epics }, confluenceUrl: confluence_url, error, userName: req.session.userName });

  if (!name?.trim() || !jira_root_epic?.trim()) return rerender(res.locals.t('editProject.err_required'));
  const confPage = await confluence.resolvePageUrl(CONFLUENCE_TOKEN, confluence_url);
  if (!confPage) return rerender(res.locals.t('editProject.err_confluence_url'));

  const epic = jira_root_epic.trim().toUpperCase();
  let eta = proj.eta;
  try { eta = formatDate((await jira.getRootEpicMeta(JIRA_TOKEN, epic)).eta); }
  catch (err) { console.warn(`Could not read ETA from ${epic}: ${err.message}`); }

  // Silently drops anything that isn't a well-formed Jira key rather than rejecting the whole
  // save — this is a convenience field (paste a few keys, possibly with typos or stray text),
  // not a validated form input.
  const cleanExtraEpics = parseExtraEpics(extra_epics).join(', ');

  db.prepare('UPDATE projects SET name=?,jira_root_epic=?,eta=?,confluence_space=?,confluence_page=?,extra_epics=? WHERE id=?')
    .run(name.trim(), epic, eta, confPage.space, confPage.page, cleanExtraEpics || null, proj.id);

  res.redirect(`/projects/${proj.slug}`);
});

app.get('/projects/:slug', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  const reports  = db.prepare('SELECT year,week FROM reports WHERE project_id=? ORDER BY year DESC,week DESC LIMIT 10').all(proj.id);
  const wsCount  = db.prepare('SELECT COUNT(*) as n FROM workstreams WHERE project_id=?').get(proj.id).n;
  const epicCount= db.prepare('SELECT COUNT(*) as n FROM epics_cache WHERE project_id=?').get(proj.id).n;
  const syncWarning = req.query.syncSource ? [{ source: req.query.syncSource, message: req.query.syncMessage || '' }] : [];
  res.render('project-detail', { proj, reports, wsCount, epicCount, syncWarning, userName: req.session.userName, currentWeek: currentWeekStr() });
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
  db.prepare(`INSERT INTO reports(project_id,year,week,exec_summary,highlights_json,risks_json,workstream_statuses_json,workstreams_snapshot_json,epics_snapshot_json,updated_at)
    VALUES(?,?,?,?,?,?,'{}',?,?,unixepoch())
    ON CONFLICT(project_id,year,week) DO UPDATE SET
      exec_summary=excluded.exec_summary,
      highlights_json=excluded.highlights_json,
      risks_json=excluded.risks_json,
      workstreams_snapshot_json=excluded.workstreams_snapshot_json,
      epics_snapshot_json=excluded.epics_snapshot_json,
      updated_at=unixepoch()`).run(proj.id, year, week, execSummary, JSON.stringify(highlights), JSON.stringify(risks), JSON.stringify(resolvedWs), JSON.stringify(epics));
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
  const now = new Date();
  const isPastWeek = year < isoYear(now) || (year === isoYear(now) && week < isoWeek(now));
  if (isPastWeek) {
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
      await refreshFullEpicTree(proj.id, proj.jira_root_epic, parseExtraEpics(proj.extra_epics));
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
app.get('/projects/:slug/:yearweek(\\d{4}-W\\d{2})', requireAuth, async (req, res) => {
  const proj = db.prepare(`SELECT p.*,u.name as pm_name FROM projects p JOIN users u ON u.id=p.user_id WHERE p.slug=?`).get(req.params.slug);
  if (!proj) return res.status(404).send('Project not found.');
  const [yr, wn] = req.params.yearweek.split('-W');
  const year = parseInt(yr), week = parseInt(wn);
  if (week < 1 || week > 53) return res.redirect(`/projects/${req.params.slug}`);
  // Applies whether or not a row already exists — a future week must never be reachable,
  // even one that got created before this guard existed (e.g. by clicking "next" repeatedly).
  if (isFutureWeek(year, week)) return res.redirect(`/projects/${req.params.slug}`);
  let report = db.prepare('SELECT * FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
  if (!report) {
    // Nothing to edit, so a week with no report yet is generated on the fly from
    // Confluence/Jira the first time its URL is visited (e.g. via the week-nav arrows).
    try { await generateReportRow(proj, year, week); }
    catch (err) { return res.redirect(`/projects/${req.params.slug}?${warningQuery({ source: 'confluence', message: friendlyError(res.locals.t, err) })}`); }
    report = db.prepare('SELECT * FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
  }

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

  const stats = { done:0, prog:0, blk:0, ts:0, total: resolvedWs.length };
  resolvedWs.forEach(ws => stats[ws.status] = (stats[ws.status]||0)+1);
  const risks = JSON.parse(report.risks_json);
  // Workstream progress alone doesn't tell the whole story — a page can list an open HIGH risk
  // while every workstream is still nominally on schedule. Surfacing that risk was the entire
  // point of the Risk matrix section, so it must be able to flip the badge too.
  const hasHighRisk = risks.some(r => r.level === 'high');
  const health = stats.blk > 0 || stats.ts > stats.total * 0.6 || hasHighRisk ? 'at-risk' : 'on-track';

  const html = genReport({
    project: proj, year, week,
    pmName: proj.pm_name,
    execSummary: report.exec_summary,
    highlights:  JSON.parse(report.highlights_json),
    risks,
    workstreams: resolvedWs,
    epics: epicsForView,
    stats, health
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Reports app → http://localhost:${PORT}`));
