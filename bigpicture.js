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
// definition in BigPicture itself. Verified empirically against two real boxes: the actual payload
// is wrapped in a currentVersion/latestVersion/cargo envelope (undocumented anywhere obvious) — the
// scope data itself is at `cargo`, not the response root.
async function getScopeDefinition(token, boxId) {
  const data = await bpFetch(token, `/public/ppm/box/area/task/scope/def/own/${boxId}`);
  const cargo = data.cargo || data;
  const platforms = cargo.extPlatformScopeDefinitions || [];
  const queries = [];
  const manualKeys = [];
  // A box can have more than one scope-definition entry (rare, e.g. mixed sources) — every clause
  // gets OR'd together (via jira.js's searchByJql) rather than picking just the first, so nothing
  // configured in BigPicture silently drops out.
  platforms.forEach(p => {
    // A non-empty narrowingQuery is the PM's actual configured scope for this entry, full stop —
    // verified against two real boxes. HYBR-95 had narrowingQuery:"" and its whole ~250-issue scope
    // came from a single scopeDefinitionElements entry (a saved filter) instead — so that's the
    // fallback when there's no narrowingQuery. HYBR-89 had BOTH a real narrowingQuery AND nine
    // scopeDefinitionElements entries naming entire connected Jira projects (IPAM, NCC, MANAGER,
    // CLDAPI, LVL2...) — those are the projects the box is *allowed to pull from*, not literal
    // scope-additive elements; OR'ing their raw `project = <id>` clauses in on top of the
    // narrowingQuery would have pulled in every issue in every one of those projects instead of the
    // ~500-issue portfolio the narrowingQuery alone correctly resolves to (confirmed by running
    // both against Jira directly). So: narrowingQuery wins outright when present; only fall back to
    // scopeDefinitionElements when it's blank.
    if (p.narrowingQuery && p.narrowingQuery.trim()) {
      queries.push(p.narrowingQuery);
    } else {
      (p.scopeDefinitionElements || []).forEach(el => {
        // isAvailable/isAccessible false means the referenced filter/project/board no longer
        // exists or the service account can't see it — skip rather than send Jira a JQL clause
        // referencing something it will just reject.
        if (el.isAvailable === false || el.isAccessible === false) return;
        if (el.type === 'JIRA_FILTER') queries.push(`filter = ${el.value}`);
        else if (el.type === 'JIRA_PROJECT') queries.push(`project = ${el.value}`);
        // Unverified against a real board-scoped box — Jira Software's JQL registers `board =`
        // when the Agile plugin is present, which it is here, but this specific clause hasn't
        // been tested end-to-end the way JIRA_FILTER has.
        else if (el.type === 'JIRA_AGILE_BOARD') queries.push(`board = ${el.value}`);
      });
    }
    (p.manuallyAddedTasks || []).forEach(t => {
      const k = t.key || t.externalId;
      if (k) manualKeys.push(k);
    });
  });
  return { queries, manualKeys };
}

module.exports = { getScopeDefinition };
