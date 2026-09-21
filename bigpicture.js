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
// definition in BigPicture itself. Verified empirically against a real box (HYBR-95): the actual
// payload is wrapped in a currentVersion/latestVersion/cargo envelope (undocumented anywhere
// obvious) — the scope data itself is at `cargo`, not the response root. And a box's scope is
// usually expressed via one or more `scopeDefinitionElements` (a saved Jira filter, project, or
// Agile board picked in BigPicture's own UI) rather than as free JQL — `narrowingQuery` is a
// separate, optional raw-JQL override on top, most often left blank (HYBR-95 itself has
// narrowingQuery:"" with its real ~260-issue scope coming entirely from one JIRA_FILTER element).
async function getScopeDefinition(token, boxId) {
  const data = await bpFetch(token, `/public/ppm/box/area/task/scope/def/own/${boxId}`);
  const cargo = data.cargo || data;
  const platforms = cargo.extPlatformScopeDefinitions || [];
  const queries = [];
  const manualKeys = [];
  // A box can have more than one scope-definition entry (rare, e.g. mixed sources), and each entry
  // can itself have several elements — every clause gets OR'd together (via jira.js's searchByJql)
  // rather than picking just the first, so nothing configured in BigPicture silently drops out.
  platforms.forEach(p => {
    (p.scopeDefinitionElements || []).forEach(el => {
      // isAvailable/isAccessible false means the referenced filter/project/board no longer exists
      // or the service account can't see it — skip rather than send Jira a JQL clause referencing
      // something it will just reject.
      if (el.isAvailable === false || el.isAccessible === false) return;
      if (el.type === 'JIRA_FILTER') queries.push(`filter = ${el.value}`);
      else if (el.type === 'JIRA_PROJECT') queries.push(`project = ${el.value}`);
      // Unverified against a real board-scoped box — Jira Software's JQL registers `board =` when
      // the Agile plugin is present, which it is here, but this specific clause hasn't been tested
      // end-to-end the way JIRA_FILTER has.
      else if (el.type === 'JIRA_AGILE_BOARD') queries.push(`board = ${el.value}`);
    });
    if (p.narrowingQuery) queries.push(p.narrowingQuery);
    (p.manuallyAddedTasks || []).forEach(t => {
      const k = t.key || t.externalId;
      if (k) manualKeys.push(k);
    });
  });
  return { queries, manualKeys };
}

module.exports = { getScopeDefinition };
