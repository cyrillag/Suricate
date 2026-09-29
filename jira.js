const fetch = require('node-fetch');
const { AppError, httpErrorCode, networkErrorCode } = require('./errors');
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
    throw new AppError(networkErrorCode('jira', err), `Jira unreachable: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw jiraHttpError(res, body, path);
  }
  return res.json();
}

// Refines httpErrorCode with what Jira's own responses say. Two traps seen for real:
// - an expired/revoked token isn't always a 401 — Jira silently treats the call as anonymous, and a
//   JQL search then fails with a 400 "...cannot be viewed by anonymous users" (Sept 2026: the
//   service token expired and every Planning Light refresh failed that way);
// - after too many failed logins Jira answers 403 with an X-Authentication-Denied-Reason header
//   (CAPTCHA) — the token may be fine, the account is locked until someone logs in via the web UI.
function jiraHttpError(res, body, path) {
  const log = `Jira ${res.status} on ${path}: ${body.slice(0, 200)}`;
  if (res.status === 401 || (res.status === 400 && /anonymous users/i.test(body))) {
    return new AppError('jira_token_invalid', log);
  }
  if (res.status === 403 && res.headers.get('x-authentication-denied-reason')) {
    return new AppError('jira_captcha', log);
  }
  const issueKey = (path.match(/^\/issue\/([A-Z][A-Z0-9_]*-\d+)/) || [])[1];
  if (res.status === 404 && issueKey) return new AppError('jira_issue_not_found', log, { key: issueKey });
  if (res.status === 400) {
    // Jira's own errorMessages are already human-readable ("The value 'X' does not exist for the
    // field 'project'.") — passing them through tells the PM which part of their query is wrong.
    let detail = '';
    try { detail = (JSON.parse(body).errorMessages || []).join(' '); } catch (e) { /* not JSON */ }
    return new AppError('jira_bad_query', log, { detail: detail || body.slice(0, 200) });
  }
  return new AppError(httpErrorCode('jira', res.status), log);
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
  // A paused epic has already started — bucketing it under "To Start" would misreport work
  // that's underway as not yet begun.
  if (s.includes('pause')) return 'prog';
  // "On Hold" reads as stalled/waiting-on-something rather than a work-in-progress pause —
  // closer to Blocked than to In Progress.
  if (s === 'blocked' || s === 'impediment' || s.includes('hold')) return 'blk';
  return 'ts';
}

async function getChildEpics(token, rootEpic) {
  // customfield_10110/10111 = "Start date"/"End date" (BigPicture Gantt fields, authoritative).
  const EPIC_FIELDS = 'summary,status,assignee,reporter,customfield_10110,customfield_10111,issuetype';

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
    assignee:   i.fields.assignee?.displayName || null,
    reporter:   i.fields.reporter?.displayName || null,
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
// ever looks 2 levels down.
async function getPortfolioEpics(token, rootEpic) {
  const EPIC_FIELDS = 'summary,status,assignee,reporter,customfield_10110,customfield_10111,issuetype';
  let jql = `(issuekey in (${rootEpic}) OR issueFunction in portfolioChildrenOf("issuekey in (${rootEpic})")) and issuetype = Epic`;
  // Jira workflows in this instance use both the British ("Cancelled") and American ("Canceled")
  // spelling depending on the project — excluding only one lets the other slip straight through
  // (see getChildEpics' notCancelled below, which already had to check both).
  jql += ' and status not in (Cancelled, Canceled)';
  const data = await api(token, '/search', { jql, fields: EPIC_FIELDS, maxResults: 300 });
  return data.issues.map(i => ({
    key:      i.key,
    summary:  i.fields.summary,
    team:     extractTeam(i.key),
    status:   i.fields.status?.name || 'To Do',
    assignee: i.fields.assignee?.displayName || null,
    reporter: i.fields.reporter?.displayName || null,
    start:    i.fields.customfield_10110 || null,
    end:      i.fields.customfield_10111 || null
  }));
}

// Planning Light (see FUNCTIONAL_RULES.md) — runs the JQL a BigPicture box's own scope definition
// resolves to (bigpicture.js) rather than this file's own portfolioChildrenOf walk, unioning in a
// set of individually-pinned keys (BigPicture's manuallyAddedTasks) the same way extra_epics used
// to (the retired feature this replaces).
// A box's scope isn't epic-only (verified against a real box: 246 issues — 31 Epics, the rest
// Task/Bug/Story/etc.) — those lower-level issues carry their parent Epic in the classic "Epic
// Link" field (customfield_10000), not customfield_16100 (portfolio parent, JQL shorthand
// cf[16100] — the field Epic-and-above levels use, and the same one getChildEpics already walks).
// Only 37/246 issues on that real box had customfield_16100 set at all; the other 209 all had
// customfield_10000 instead. A third real box (custom "Epic LPM"/"Phase"/"Deliverable" issue types,
// hand-built for a multi-level Planning Light test) additionally used a plain Jira issue-link type
// named "Parent-Child" for its top level, instead of either custom field — so that's checked too.
// All three are merged into a single parentKey per issue so the hierarchy/rollup pass (server.js's
// buildPlanningTree) doesn't need to know which mechanism applies.
// The "Parent-Child" link wins when present: BGP Service was restructured on purpose as
// "Epic LPM > Phase > Deliverable > New Feature > Epic" entirely through these links, while many of
// the same issues still carry a customfield_16100 from the older Advanced Roadmaps structure
// (typically pointing a New Feature straight at the Epic LPM root) — letting that stale field win
// would attach nodes to the wrong level and skew the Phase/Deliverable rollups.
async function searchByJql(token, jqlClauses, extraKeys = []) {
  if (!jqlClauses.length && !extraKeys.length) return [];
  const EPIC_FIELDS = 'summary,status,assignee,reporter,customfield_10110,customfield_10111,customfield_16100,customfield_10000,issuelinks,issuetype';
  const parts = jqlClauses.map(q => `(${q})`);
  if (extraKeys.length) parts.push(`issuekey in (${extraKeys.join(',')})`);
  let jql = `(${parts.join(' OR ')}) and status not in (Cancelled, Canceled)`;
  // Paginated — a box scope can exceed one page (BGP's is ~500 issues), and a silently truncated
  // page would drop arbitrary nodes, possibly a whole Phase or Deliverable.
  const issues = [];
  for (let startAt = 0; ; ) {
    const data = await api(token, '/search', { jql, fields: EPIC_FIELDS, maxResults: 500, startAt });
    issues.push(...data.issues);
    startAt += data.issues.length;
    if (!data.issues.length || startAt >= data.total) break;
  }
  return issues.map(i => {
    // A "Parent-Child" link only counts when it's the INWARD side (this issue "is child of" the
    // linked one) — the OUTWARD side ("is parent of") means the linked issue is this one's CHILD,
    // not its parent, and must never be read backwards into a parentKey.
    const parentLink = (i.fields.issuelinks || []).find(l =>
      (l.type?.name === 'Parent-Child' || l.type?.inward === 'is child of') && l.inwardIssue);
    return {
      key:       i.key,
      summary:   i.fields.summary,
      team:      extractTeam(i.key),
      type:      i.fields.issuetype?.name || null,
      status:    i.fields.status?.name || 'To Do',
      assignee:  i.fields.assignee?.displayName || null,
      reporter:  i.fields.reporter?.displayName || null,
      // Server sometimes returns customfield_16100 as a plain key string, sometimes as an object
      // with a `.key` — observed inconsistently across custom field configs; normalize both.
      // customfield_10000 (Epic Link) is always a plain key string.
      parentKey: (parentLink && parentLink.inwardIssue.key)
        || (i.fields.customfield_16100 && i.fields.customfield_16100.key) || i.fields.customfield_16100
        || i.fields.customfield_10000 || null,
      // The link alone, without the custom-field fallbacks — a Phase/Deliverable-structured box
      // follows links only (see buildPlanningTree).
      linkParentKey: (parentLink && parentLink.inwardIssue.key) || null,
      start:     i.fields.customfield_10110 || null,
      end:       i.fields.customfield_10111 || null
    };
  });
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
  const EPIC_FIELDS = 'summary,status,assignee,reporter,customfield_10110,customfield_10111,issuetype';
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
      key:      i.key,
      summary:  i.fields.summary,
      team:     extractTeam(i.key),
      status:   i.fields.status?.name || 'To Do',
      assignee: i.fields.assignee?.displayName || null,
      reporter: i.fields.reporter?.displayName || null,
      // Same "no invented dates" rule as getChildEpics — leave blank if unset.
      start:    i.fields.customfield_10110 || null,
      end:      i.fields.customfield_10111 || null
    }));
  }
  return results;
}

module.exports = { getMe, findUserByEmail, getChildEpics, getPortfolioEpics, getEpicsByKeys, searchByJql, getRootEpicMeta, mapStatus, BASE };
