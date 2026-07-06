const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const db         = require('./db');
const jira       = require('./jira');
const confluence = require('./confluence');
const genReport  = require('./report-gen');

const SQLiteStore = require('connect-sqlite3')(session);
const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '.';

const JIRA_TOKEN = process.env.JIRA_SERVICE_TOKEN;
if (!JIRA_TOKEN) console.warn('WARNING: JIRA_SERVICE_TOKEN not set — Jira API calls will fail.');
const CONFLUENCE_TOKEN = process.env.CONFLUENCE_SERVICE_TOKEN;
if (!CONFLUENCE_TOKEN) console.warn('WARNING: CONFLUENCE_SERVICE_TOKEN not set — Confluence sync will be unavailable.');

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function uniqueSlug(baseName) {
  const base = slugify(baseName);
  let slug = base, n = 2;
  while (db.prepare('SELECT 1 FROM projects WHERE slug=?').get(slug)) slug = `${base}-${n++}`;
  return slug;
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
  return epics.length;
}

// Refresh status/dates only, for a known set of Jira keys — does not touch the workstream
// list itself. Used for the "Sync Jira" button on Confluence-backed projects, and internally
// after every Confluence sync to keep epics_cache in step with whatever keys it references.
async function refreshEpicStatuses(projectId, jiraKeys) {
  const epics = await jira.getEpicsByKeys(JIRA_TOKEN, jiraKeys);
  epics.forEach(e => insEpicCache.run(projectId, e.key, e.summary, e.team, e.status, e.start, e.end));
  return epics.length;
}

async function syncConfluenceProject(projectId, spaceKey, page, week) {
  const data = await confluence.syncProjectFromConfluence(CONFLUENCE_TOKEN, spaceKey, page, week);
  data.workstreams.forEach((ws, i) => {
    upsertWorkstreamFromConfluence.run(
      projectId, ws.deliverable, ws.name, ws.team, ws.jira_key,
      ws.manual_status ? jira.mapStatus(ws.manual_status) : null, i
    );
  });
  try { await refreshEpicStatuses(projectId, data.workstreams.map(w => w.jira_key)); }
  catch (err) { console.warn(`Epic status refresh failed for project ${projectId}: ${err.message}`); }
  return data;
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
  secret: process.env.SESSION_SECRET || 'ovhcloud-reports-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
}

// ── LOGIN ─────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.render('login', { error: 'Adresse email requise.' });
  try {
    const me = await jira.findUserByEmail(JIRA_TOKEN, email);
    if (!me) return res.render('login', { error: 'Email non trouvé dans Jira OVHcloud.' });
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
    req.session.save(() => res.redirect('/'));
  } catch (err) {
    res.render('login', { error: 'Erreur de connexion Jira : ' + err.message });
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
  const { name, jira_root_epic, eta, confluence_space, confluence_page } = req.body;
  if (!name?.trim() || !jira_root_epic?.trim())
    return res.render('project-new', { error: 'Project name and root epic are required.', userName: req.session.userName });

  const slug = uniqueSlug(name);
  const epic = jira_root_epic.trim().toUpperCase();
  const cSpace = confluence_space?.trim() || null;
  const cPage  = confluence_page?.trim() || null;

  let projId;
  try {
    projId = db.prepare('INSERT INTO projects(user_id,name,slug,jira_root_epic,eta,confluence_space,confluence_page) VALUES(?,?,?,?,?,?,?)')
      .run(req.session.userId, name.trim(), slug, epic, eta?.trim() || null, cSpace, cPage).lastInsertRowid;
  } catch (err) {
    return res.render('project-new', { error: `Could not create project: ${err.message}`, userName: req.session.userName });
  }

  // Project row is committed at this point — sync failures are recoverable via the "Sync" buttons
  // on the project page, so we redirect either way instead of losing the created project.
  // Confluence's "Deliverables status" table (when configured) is the workstream source of
  // truth; the raw Jira tree-walk is only used as a fallback for projects without one, since
  // running both would seed two differently-grouped, duplicate workstream lists.
  const warnings = [];
  if (cSpace && cPage) {
    try { await syncConfluenceProject(projId, cSpace, cPage, null); }
    catch (err) { warnings.push(`confluence:${encodeURIComponent(err.message)}`); }
  } else {
    try { await seedWorkstreamsFromJiraTree(projId, epic); }
    catch (err) { warnings.push(`jira:${encodeURIComponent(err.message)}`); }
  }

  res.redirect(`/projects/${slug}${warnings.length ? '?syncWarning=' + warnings.join(',') : ''}`);
});

app.post('/projects/:slug/delete', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  // Cascades to workstreams, epics_cache and reports (all FK'd with ON DELETE CASCADE).
  db.prepare('DELETE FROM projects WHERE id=?').run(proj.id);
  res.redirect('/');
});

app.get('/projects/:slug', requireAuth, (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  const reports  = db.prepare('SELECT year,week FROM reports WHERE project_id=? ORDER BY year DESC,week DESC LIMIT 10').all(proj.id);
  const wsCount  = db.prepare('SELECT COUNT(*) as n FROM workstreams WHERE project_id=?').get(proj.id).n;
  const epicCount= db.prepare('SELECT COUNT(*) as n FROM epics_cache WHERE project_id=?').get(proj.id).n;
  const syncWarning = (req.query.syncWarning || '').split(',').filter(Boolean).map(w => {
    const [source, msg] = w.split(':');
    return { source, message: decodeURIComponent(msg || '') };
  });
  res.render('project-detail', { proj, reports, wsCount, epicCount, syncWarning, userName: req.session.userName, currentWeek: currentWeekStr() });
});

// ── REPORT GENERATION ────────────────────────────────────────────
// No manual authoring: a report's content is always pulled fresh from Confluence (highlights,
// risks) and Jira (workstream/epic status, dates) at generation time — there is nothing to edit
// or type in by hand. Re-generating an existing week overwrites it with the current page/Jira
// state, which is the intended way to "correct" a report (fix it at the source, then re-pull).
async function generateReportRow(proj, year, week) {
  let highlights = { achievements: [], blockers: [], clarify: [] };
  let risks = [];
  if (proj.confluence_space && proj.confluence_page && CONFLUENCE_TOKEN) {
    const page = await confluence.fetchPageBody(CONFLUENCE_TOKEN, proj.confluence_space, proj.confluence_page);
    highlights = confluence.parseWeekSummary(page.html, week) || highlights;
    risks = confluence.parseRisks(page.html);
  }
  db.prepare(`INSERT INTO reports(project_id,year,week,highlights_json,risks_json,workstream_statuses_json,updated_at)
    VALUES(?,?,?,?,?,'{}',unixepoch())
    ON CONFLICT(project_id,year,week) DO UPDATE SET
      highlights_json=excluded.highlights_json,
      risks_json=excluded.risks_json,
      updated_at=unixepoch()`).run(proj.id, year, week, JSON.stringify(highlights), JSON.stringify(risks));
}

app.post('/projects/:slug/reports/generate', requireAuth, async (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).send('Project not found.');
  const weekStr  = req.body.week || req.query.week || currentWeekStr();
  const [yr, wn] = weekStr.split('-W');
  const year = parseInt(yr), week = parseInt(wn);
  if (isFutureWeek(year, week)) return res.redirect(`/projects/${proj.slug}?syncWarning=confluence:${encodeURIComponent('Cannot generate a report for a future week.')}`);
  try {
    await generateReportRow(proj, year, week);
  } catch (err) {
    return res.redirect(`/projects/${proj.slug}?syncWarning=confluence:${encodeURIComponent(err.message)}`);
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
  // Applies whether or not a row already exists — a future week must never be reachable,
  // even one that got created before this guard existed (e.g. by clicking "next" repeatedly).
  if (isFutureWeek(year, week)) return res.redirect(`/projects/${req.params.slug}`);
  let report = db.prepare('SELECT * FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
  if (!report) {
    // Nothing to edit, so a week with no report yet is generated on the fly from
    // Confluence/Jira the first time its URL is visited (e.g. via the week-nav arrows).
    try { await generateReportRow(proj, year, week); }
    catch (err) { return res.redirect(`/projects/${req.params.slug}?syncWarning=confluence:${encodeURIComponent(err.message)}`); }
    report = db.prepare('SELECT * FROM reports WHERE project_id=? AND year=? AND week=?').get(proj.id, year, week);
  }

  const workstreams = db.prepare(`SELECT w.*,e.status as jira_status FROM workstreams w
    LEFT JOIN epics_cache e ON e.jira_key=w.jira_key AND e.project_id=w.project_id
    WHERE w.project_id=? ORDER BY w.sort_order`).all(proj.id);
  const epics      = db.prepare('SELECT * FROM epics_cache WHERE project_id=? ORDER BY team,jira_key').all(proj.id);
  const wsStatuses = JSON.parse(report.workstream_statuses_json);

  const resolvedWs = workstreams.map(ws => ({
    ...ws,
    status:  wsStatuses[ws.id] || (ws.jira_key ? jira.mapStatus(ws.jira_status) : (ws.default_status || 'ts')),
    no_jira: !ws.jira_key
  }));

  const stats = { done:0, prog:0, blk:0, ts:0, total: resolvedWs.length };
  resolvedWs.forEach(ws => stats[ws.status] = (stats[ws.status]||0)+1);
  const health = stats.blk > 0 || stats.ts > stats.total * 0.6 ? 'at-risk' : 'on-track';

  const html = genReport({
    project: proj, year, week,
    pmName: proj.pm_name,
    highlights:  JSON.parse(report.highlights_json),
    risks:       JSON.parse(report.risks_json),
    workstreams: resolvedWs,
    epics: epics.filter(e => e.start_date && e.end_date).map(e => ({
      key: e.jira_key, label: e.summary, team: e.team,
      status: jira.mapStatus(e.status), start: e.start_date, end: e.end_date
    })),
    stats, health
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── API ───────────────────────────────────────────────────────────
app.post('/api/projects/:slug/sync-epics', requireAuth, async (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).json({ error: 'Not found' });
  try {
    let count;
    if (proj.confluence_space && proj.confluence_page) {
      // Workstream list comes from Confluence — just refresh status/dates for known keys.
      const keys = db.prepare('SELECT jira_key FROM workstreams WHERE project_id=? AND jira_key IS NOT NULL').all(proj.id).map(r => r.jira_key);
      count = await refreshEpicStatuses(proj.id, keys);
    } else {
      count = await seedWorkstreamsFromJiraTree(proj.id, proj.jira_root_epic);
    }
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:slug/sync-confluence', requireAuth, async (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE slug=? AND user_id=?').get(req.params.slug, req.session.userId);
  if (!proj) return res.status(404).json({ error: 'Not found' });
  if (!proj.confluence_space || !proj.confluence_page) return res.status(400).json({ error: 'No Confluence page configured for this project.' });
  try {
    const data = await syncConfluenceProject(proj.id, proj.confluence_space, proj.confluence_page, null);
    res.json({ ok: true, count: data.workstreams.length, pageVersion: data.version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Reports app → http://localhost:${PORT}`));
