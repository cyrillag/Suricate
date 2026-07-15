const fetch = require('node-fetch');
const { AppError, httpErrorCode } = require('./errors');
const BASE = 'https://jira.ovhcloud.tools';

async function api(token, path, params = {}) {
  const url = new URL(BASE + '/rest/api/2' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  let res;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });
  } catch (err) {
    throw new AppError('jira_unavailable', `Jira unreachable: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(httpErrorCode('jira', res.status), `Jira ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getMe(token) {
  return api(token, '/myself');
}

async function findUserByEmail(token, email) {
  const results = await api(token, '/user/search', { username: email, maxResults: 5 });
  // Jira Server's username search is fuzzy — it can return OTHER accounts that merely look
  // similar to the query. Since login has no password, only an exact emailAddress match may
  // succeed; falling back to results[0] would log the caller in as an arbitrary matched user.
  return results.find(u => (u.emailAddress || '').toLowerCase() === email.toLowerCase()) || null;
}

const TEAM_MAP = {
  NSE: 'NSE', NSA: 'NSA', NCC: 'NCC',
  CLDAPI: 'CLDAPI', PUBM: 'PUBM', USRE: 'USRE',
  ECX: 'Manager', PFR: 'Product', LVL2: 'Cross'
};

function extractTeam(key) {
  const proj = key.split('-')[0];
  return TEAM_MAP[proj] || proj;
}

function mapStatus(jiraStatus) {
  if (!jiraStatus) return 'ts';
  const s = jiraStatus.toLowerCase();
  if (s === 'done' || s === 'closed' || s === 'resolved' || s === 'complete') return 'done';
  // "ongoing" covers PMs typing a manual status directly on a no-Jira workstream's Confluence
  // cell (a status-macro lozenge) rather than a real Jira issue status.
  if (s.includes('progress') || s.includes('review') || s.includes('dev') || s.includes('ongoing')) return 'prog';
  if (s === 'blocked' || s === 'impediment') return 'blk';
  return 'ts';
}

async function getChildEpics(token, rootEpic) {
  // customfield_10110/10111 = "Start date"/"End date" (BigPicture Gantt fields, authoritative).
  const EPIC_FIELDS = 'summary,status,customfield_10110,customfield_10111,issuetype';

  const notCancelled = i => {
    const s = (i.fields.status?.name || '').toLowerCase();
    return s !== 'canceled' && s !== 'cancelled';
  };
  const mapEpic = (i, deliverable) => ({
    key:        i.key,
    summary:    i.fields.summary,
    team:       extractTeam(i.key),
    deliverable,
    status:     i.fields.status?.name || 'To Do',
    // No fallback to duedate/created/resolutiondate: an epic with no Start/End date filled in
    // on its Gantt fields is left with no date at all rather than an invented one — the
    // report simply omits it from the Planning timeline (see report-gen's epics filter).
    start:      i.fields.customfield_10110 || null,
    end:        i.fields.customfield_10111 || null
  });

  // Level 1: direct children (any type)
  const level1 = await api(token, '/search', {
    jql: `cf[16100]=${rootEpic}`,
    fields: EPIC_FIELDS,
    maxResults: 50
  });

  const results = [];
  const directEpics  = level1.issues.filter(i => i.fields.issuetype.name === 'Epic');
  const nonEpics     = level1.issues.filter(i => i.fields.issuetype.name !== 'Epic');

  // Case A: direct epics → deliverable = team name (e.g. Private boot M1)
  directEpics.filter(notCancelled).forEach(i => {
    results.push(mapEpic(i, extractTeam(i.key)));
  });

  // Case B: non-epics (New Features) → get their Epic children one level down
  for (const nf of nonEpics.filter(notCancelled)) {
    const sub = await api(token, '/search', {
      jql: `cf[16100]=${nf.key} AND issuetype=Epic`,
      fields: EPIC_FIELDS,
      maxResults: 50
    });
    sub.issues.filter(notCancelled).forEach(i => {
      results.push(mapEpic(i, nf.fields.summary));
    });
  }

  return results;
}

// Exhaustive epic set for the Planning/Gantt section. portfolioChildrenOf walks the full
// Advanced Roadmaps/BigPicture portfolio hierarchy at any depth, unlike getChildEpics' manual
// cf[16100] walk above (kept as-is for matrix generation on Confluence-less projects) which only
// ever looks 2 levels down. extraKeys are epics/features pinned in even though they sit under a
// completely different LVL2 root with no hierarchy link to derive them from automatically —
// callers are responsible for validating each key against /^[A-Z][A-Z0-9]*-\d+$/ before it
// reaches this JQL string.
async function getPortfolioEpics(token, rootEpic, extraKeys = []) {
  const EPIC_FIELDS = 'summary,status,customfield_10110,customfield_10111,issuetype';
  let jql = `(issuekey in (${rootEpic}) OR issueFunction in portfolioChildrenOf("issuekey in (${rootEpic})")) and issuetype = Epic`;
  if (extraKeys.length) jql = `(${jql} OR issuekey in (${extraKeys.join(',')}))`;
  // Jira workflows in this instance use both the British ("Cancelled") and American ("Canceled")
  // spelling depending on the project — excluding only one lets the other slip straight through
  // (see getChildEpics' notCancelled below, which already had to check both).
  jql += ' and status not in (Cancelled, Canceled)';
  const data = await api(token, '/search', { jql, fields: EPIC_FIELDS, maxResults: 300 });
  return data.issues.map(i => ({
    key:     i.key,
    summary: i.fields.summary,
    team:    extractTeam(i.key),
    status:  i.fields.status?.name || 'To Do',
    start:   i.fields.customfield_10110 || null,
    end:     i.fields.customfield_10111 || null
  }));
}

async function getRootEpicMeta(token, epicKey) {
  const data = await api(token, `/issue/${epicKey}`, { fields: 'summary,customfield_10110,customfield_10111,status' });
  return {
    summary: data.fields.summary,
    start:   data.fields.customfield_10110 || null,
    eta:     data.fields.customfield_10111 || null,
    status:  data.fields.status?.name || ''
  };
}

// Batch status/date lookup for a known list of Jira keys (e.g. the jira_key column of
// Confluence-sourced workstreams) — used instead of getChildEpics' tree-walk when the
// workstream list itself already comes from Confluence, so we don't rediscover a
// different/duplicate set of epics via the raw Jira hierarchy.
async function getEpicsByKeys(token, keys) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!uniqueKeys.length) return [];
  const EPIC_FIELDS = 'summary,status,customfield_10110,customfield_10111,issuetype';
  const results = [];
  // Jira JQL "in" clauses have a practical size limit — chunk to be safe.
  for (let i = 0; i < uniqueKeys.length; i += 50) {
    const chunk = uniqueKeys.slice(i, i + 50);
    const data = await api(token, '/search', {
      jql: `key in (${chunk.join(',')})`,
      fields: EPIC_FIELDS,
      maxResults: chunk.length
    });
    data.issues.forEach(i => results.push({
      key:     i.key,
      summary: i.fields.summary,
      team:    extractTeam(i.key),
      status:  i.fields.status?.name || 'To Do',
      // Same "no invented dates" rule as getChildEpics — leave blank if unset.
      start:   i.fields.customfield_10110 || null,
      end:     i.fields.customfield_10111 || null
    }));
  }
  return results;
}

module.exports = { getMe, findUserByEmail, getChildEpics, getPortfolioEpics, getEpicsByKeys, getRootEpicMeta, mapStatus };
