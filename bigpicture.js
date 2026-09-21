const fetch = require('node-fetch');
const { AppError, httpErrorCode } = require('./errors');

// BigPicture (SoftwarePlant/Appfire's Jira program-planning plugin) exposes its own REST API on
// the same Jira host, but under a different base path and a different auth scheme from the plain
// Jira API this app otherwise talks to (jira.js) — a separate module, same reasoning as
// confluence.js being separate despite also being Atlassian-adjacent. See FUNCTIONAL_RULES.md
// "Planning Light" for why this exists and how its one endpoint is used.
const JIRA_BASE = 'https://jira.ovhcloud.tools';
// Versions before 8.32 used the old plugin key in the path; newer ones use the short "bigpicture"
// one. Neither this app nor the person configuring it knows which one the instance is on ahead of
// time, so a 404 on the new path falls back to the old one once (see bpFetch).
const BASE_NEW = `${JIRA_BASE}/rest/bigpicture/1.0`;
const BASE_OLD = `${JIRA_BASE}/rest/softwareplant-bigpicture/1.0`;

async function bpFetch(token, path) {
  const tryBase = async (base) => {
    let res;
    try {
      res = await fetch(base + path, {
        headers: { Authorization: `APIToken ${token}`, Accept: 'application/json' },
        timeout: 15000
      });
    } catch (err) {
      throw new AppError('bigpicture_unavailable', `BigPicture unreachable: ${err.message}`);
    }
    return res;
  };

  let res = await tryBase(BASE_NEW);
  if (res.status === 404) res = await tryBase(BASE_OLD);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(httpErrorCode('bigpicture', res.status), `BigPicture ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// The box's own configured scope — what a PM sees under Box Configuration > Tasks > Scope
// definition in BigPicture itself. narrowingQuery is a JQL string; running it through the plain
// Jira search API (jira.js) is how Planning Light gets "the same issues BigPicture shows" without
// needing to understand BigPicture's own task model at all. manuallyAddedTasks are individually
// pinned issues the JQL alone wouldn't match, unioned in the same way extra_epics used to be
// (see jira.js's searchByJql) — the feature this replaces.
async function getScopeDefinition(token, boxId) {
  const data = await bpFetch(token, `/public/ppm/box/area/task/scope/def/own/${boxId}`);
  const platforms = data.extPlatformScopeDefinitions || [];
  // A box can have more than one scope-definition entry (rare, e.g. mixed sources) — every JQL
  // clause gets OR'd together rather than picking just the first, so nothing configured in
  // BigPicture silently drops out here.
  const queries = platforms.map(p => p.narrowingQuery).filter(Boolean);
  const manualKeys = platforms.flatMap(p => (p.manuallyAddedTasks || []).map(t => t.key || t.externalId).filter(Boolean));
  return { queries, manualKeys };
}

module.exports = { getScopeDefinition };
