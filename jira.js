const fetch = require('node-fetch');
const BASE = 'https://jira.ovhcloud.tools';

async function api(token, path, params = {}) {
  const url = new URL(BASE + '/rest/api/2' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getMe(token) {
  return api(token, '/myself');
}

async function findUserByEmail(token, email) {
  const results = await api(token, '/user/search', { username: email, maxResults: 5 });
  // Jira Server returns array; match on emailAddress
  return results.find(u => (u.emailAddress || '').toLowerCase() === email.toLowerCase())
      || results[0]
      || null;
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

function dateOnly(iso) { return iso ? iso.slice(0, 10) : null; }

function mapStatus(jiraStatus) {
  if (!jiraStatus) return 'ts';
  const s = jiraStatus.toLowerCase();
  if (s === 'done' || s === 'closed' || s === 'resolved' || s === 'complete') return 'done';
  if (s.includes('progress') || s.includes('review') || s.includes('dev')) return 'prog';
  if (s === 'blocked' || s === 'impediment') return 'blk';
  return 'ts';
}

async function getChildEpics(token, rootEpic) {
  // customfield_10110/10111 = "Start date"/"End date" (BigPicture Gantt fields, authoritative).
  // customfield_10107/10108 = "Baseline start/end date" (fallback only, plan not live tracking).
  const EPIC_FIELDS = 'summary,status,customfield_10110,customfield_10111,customfield_10107,customfield_10108,duedate,created,resolutiondate,issuetype';

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
    // Fall back to created/resolutiondate when neither Jira Gantt field nor duedate is set —
    // otherwise items like a Done ticket with no explicit dates never appear on the Gantt at all.
    start:      i.fields.customfield_10110 || i.fields.customfield_10107 || dateOnly(i.fields.created),
    end:        i.fields.customfield_10111 || i.fields.duedate || i.fields.customfield_10108 || dateOnly(i.fields.resolutiondate)
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
  const EPIC_FIELDS = 'summary,status,customfield_10110,customfield_10111,customfield_10107,customfield_10108,duedate,created,resolutiondate,issuetype';
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
      start:   i.fields.customfield_10110 || i.fields.customfield_10107 || dateOnly(i.fields.created),
      end:     i.fields.customfield_10111 || i.fields.duedate || i.fields.customfield_10108 || dateOnly(i.fields.resolutiondate)
    }));
  }
  return results;
}

module.exports = { getMe, findUserByEmail, getChildEpics, getEpicsByKeys, getRootEpicMeta, mapStatus };
