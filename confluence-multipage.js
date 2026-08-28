// POC — see FUNCTIONAL_RULES.md "Multi-page Confluence discovery (POC)". Some project spaces
// (e.g. "WordPress Managed - Summary") don't put everything on one page with numbered headings —
// they're a hub page (often just a `pagetree` macro) whose real content lives on numbered child
// pages ("02 - Actions Log", "06 - Risk Register", etc.), each with its own, often differently
// shaped, tables. This module is a separate, disposable code path deliberately kept out of
// confluence.js: it reuses that file's low-level HTML helpers but must never be wired into the
// real single-page sync flow (syncConfluenceProject) unless this POC is promoted for real.
const confluence = require('./confluence');
const { AppError } = require('./errors');
const {
  confluenceFetch, extractTables, extractRows, extractCells, stripTags, liItems
} = confluence;
const BASE = process.env.CONFLUENCE_BASE || 'https://confluence.ovhcloud.tools';

// Title -> category, by keyword rather than a strict numbered prefix ("NN - ") since that
// numbering convention isn't guaranteed to be identical across every project's space.
const CATEGORY_PATTERNS = {
  risks:      [/risk/i],
  decisions:  [/decision/i],
  actions:    [/action/i],
  planning:   [/planning/i],
  weekly:     [/weekly|flash/i],
  governance: [/governance/i],
  launch:     [/launch/i],
  goNoGo:     [/go.?no.?go/i],
  rex:        [/\brex\b|retro/i],
  links:      [/useful.?links/i],
  misc:       [/\bmisc\b/i],
  deprecated: [/deprecat/i]
};

function classifyTitle(title) {
  for (const [cat, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some(p => p.test(title))) return cat;
  }
  return null;
}

async function fetchChildren(token, pageId) {
  const data = await confluenceFetch(`${BASE}/rest/api/content/${pageId}?expand=children.page`, token);
  return (data.children?.page?.results || []).map(p => ({ id: p.id, title: p.title }));
}

async function fetchBodyById(token, id) {
  const data = await confluenceFetch(`${BASE}/rest/api/content/${id}?expand=body.storage`, token);
  return data.body?.storage?.value || '';
}

// ── Week-over-week diff (POC idea: derive the ABC highlights from what actually changed on the
// Actions Log / Risk Register / Decisions register pages, using Confluence's own version history,
// instead of requiring a dedicated "Week summary" table this project doesn't have). ────────────
async function fetchVersionHistory(token, pageId) {
  const data = await confluenceFetch(`${BASE}/rest/experimental/content/${pageId}/version?limit=200&start=0`, token);
  return (data.results || []).map(v => ({ number: v.number, when: v.when })).sort((a, b) => new Date(a.when) - new Date(b.when));
}

// The page's real content as it stood at (or immediately before) a given instant — i.e. "what
// this page said as of that week's Monday" — via Confluence's own historical-version API rather
// than a snapshot we'd have to maintain ourselves.
async function fetchBodyAtOrBefore(token, pageId, isoDate) {
  const history = await fetchVersionHistory(token, pageId);
  const cutoff = new Date(isoDate).getTime();
  const candidates = history.filter(v => new Date(v.when).getTime() <= cutoff);
  if (!candidates.length) return null; // page didn't exist yet at that point
  const version = candidates[candidates.length - 1].number;
  const data = await confluenceFetch(`${BASE}/rest/api/content/${pageId}?status=historical&version=${version}&expand=body.storage`, token);
  return data.body?.storage?.value || '';
}

function findCol(headerCells, patterns) {
  for (let i = 0; i < headerCells.length; i++) {
    const text = stripTags(headerCells[i].html).toLowerCase();
    if (patterns.some(p => p.test(text))) return i;
  }
  return -1;
}

// The header row is whichever all-th (or all-non-empty) row comes first; every table style seen
// so far puts column labels on row 0.
function headerAndDataRows(tableHtml) {
  const rows = extractRows(tableHtml).map(extractCells);
  return { header: rows[0] || [], dataRows: rows.slice(1) };
}

function scoreToLevel(score) {
  if (score >= 9) return 'extreme';
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

// A page like this one strings multiple dated status updates into a single cell (bullet points,
// or ";"/newline-separated points) — the report's risk description/mitigation slots expect one
// short line, same as a normal single-page project's risk table, not the whole update history.
// Take just the first point rather than joining everything.
function firstPoint(cellHtml, maxLen = 160) {
  const items = liItems(cellHtml);
  // Split on a bullet-like ";", a line break, or a sentence boundary (period + space) — whichever
  // convention this particular cell happens to use to string multiple points together.
  const raw = items.length ? items[0].text : stripTags(cellHtml).split(/;|\n|\.\s+/)[0];
  const text = raw.trim();
  return text.length > maxLen ? text.slice(0, maxLen).trim() + '…' : text;
}

// Two risk-register shapes seen in the wild:
//  - "legacy": Référence | Description | Score (a status-lozenge title: High/Medium/Low/Extreme)
//    | Status | Mitigation — see confluence.js's parseRisks, same convention.
//  - "numeric": adds separate Impact/Probability columns and a plain-number Score (their product,
//    against a 3x3 Impact x Probability legend grid elsewhere on the page) instead of a lozenge.
// Both normalize to the same { ref, level, desc, mitigation } shape the report already expects.
function parseRiskRegisterPage(html) {
  const tables = extractTables(html);
  let best = null, bestCount = 0;
  for (const t of tables) {
    const { header, dataRows } = headerAndDataRows(t);
    if (findCol(header, [/r[ée]f[ée]rence/]) === -1) continue;
    const refCount = dataRows.filter(r => /^[A-Za-z]+[_-]?\d+$/.test(stripTags(r[0]?.html || ''))).length;
    if (refCount > bestCount) { best = t; bestCount = refCount; }
  }
  if (!best) return { status: 'no_table', risks: [] };

  const { header, dataRows } = headerAndDataRows(best);
  const refIdx = findCol(header, [/r[ée]f[ée]rence/]);
  const descIdx = findCol(header, [/risk linked to|description/]);
  const statusIdx = findCol(header, [/status/]);
  const impactIdx = findCol(header, [/impact/]);
  const probIdx = findCol(header, [/probability/]);
  const scoreIdx = findCol(header, [/score/]);
  const mitigationIdx = findCol(header, [/action.*comment|mitigation/]);
  const numericSchema = impactIdx !== -1 && probIdx !== -1 && scoreIdx !== -1;

  const risks = [];
  for (const cells of dataRows) {
    const ref = stripTags(cells[refIdx]?.html || '');
    if (!/^[A-Za-z]+[_-]?\d+$/.test(ref)) continue; // skip blank/scaffold rows
    const statusText = stripTags(cells[statusIdx]?.html || '').toLowerCase();
    if (/closed/.test(statusText)) continue;
    // The legacy schema's desc/mitigation are already short one-liners (same convention as every
    // single-page project) — only the numeric schema's cells have been seen holding a whole
    // running history, so only that branch needs trimming to the first point.
    const desc = numericSchema ? firstPoint(cells[descIdx]?.html || '') : stripTags(cells[descIdx]?.html || '');
    const mitigation = mitigationIdx === -1 ? '' : numericSchema ? firstPoint(cells[mitigationIdx].html) : (liItems(cells[mitigationIdx].html).map(i => i.text).join('; ') || stripTags(cells[mitigationIdx].html));
    let level;
    if (numericSchema) {
      const score = parseInt(stripTags(cells[scoreIdx]?.html || ''), 10);
      level = Number.isFinite(score) ? scoreToLevel(score) : 'medium';
    } else {
      const scoreText = stripTags(cells[scoreIdx]?.html || '').toLowerCase();
      level = /extreme/.test(scoreText) ? 'extreme' : /high/.test(scoreText) ? 'high' : /very low|^low/.test(scoreText) ? 'low' : 'medium';
    }
    if (desc) risks.push({ ref, level, desc, mitigation });
  }
  return { status: 'parsed', schema: numericSchema ? 'numeric' : 'legacy', risks };
}

// Decisions register: ID | Description | Status | Requested by | Decided by... | Decision(s) |
// Details | Date. A brand-new category the app has no concept of today.
function parseDecisionsPage(html) {
  const tables = extractTables(html);
  let best = null, bestCount = 0;
  for (const t of tables) {
    const { header, dataRows } = headerAndDataRows(t);
    if (findCol(header, [/^id$/]) === -1 || findCol(header, [/decision/]) === -1) continue;
    const idCount = dataRows.filter(r => stripTags(r[0]?.html || '').trim()).length;
    if (idCount > bestCount) { best = t; bestCount = idCount; }
  }
  if (!best) return { status: 'no_table', decisions: [] };

  const { header, dataRows } = headerAndDataRows(best);
  const idIdx = findCol(header, [/^id$/]);
  const descIdx = findCol(header, [/description/]);
  const statusIdx = findCol(header, [/status/]);
  const decisionIdx = findCol(header, [/decisions?$/]);
  const dateIdx = findCol(header, [/date/]);

  const decisions = [];
  for (const cells of dataRows) {
    const id = stripTags(cells[idIdx]?.html || '');
    if (!id) continue;
    decisions.push({
      id,
      desc: stripTags(cells[descIdx]?.html || ''),
      status: stripTags(cells[statusIdx]?.html || ''),
      decision: stripTags(cells[decisionIdx]?.html || ''),
      date: dateIdx !== -1 ? stripTags(cells[dateIdx]?.html || '') : null
    });
  }
  return { status: 'parsed', decisions };
}

// Actions Log pages have been seen carrying a giant day-by-day calendar/Gantt table alongside the
// actual register — skip anything with an implausible number of columns for a register (>8) so
// that scratch/planning tables don't get mistaken for it.
function parseActionsPage(html) {
  const tables = extractTables(html);
  let best = null, bestCount = 0;
  for (const t of tables) {
    const { header, dataRows } = headerAndDataRows(t);
    if (header.length > 8) continue;
    if (findCol(header, [/owner/]) === -1 || findCol(header, [/status/]) === -1) continue;
    const rowCount = dataRows.filter(r => stripTags(r[0]?.html || '').trim()).length;
    if (rowCount > bestCount) { best = t; bestCount = rowCount; }
  }
  if (!best) return { status: 'no_table', actions: [] };

  const { header, dataRows } = headerAndDataRows(best);
  const whatIdx = findCol(header, [/deliverable|action|what/]);
  const ownerIdx = findCol(header, [/owner|who/]);
  const commentIdx = findCol(header, [/comment|followup|how/]);
  const statusIdx = findCol(header, [/status/]);
  const etaIdx = findCol(header, [/eta|when/]);
  // Not present on this page, but checked for generally (see groupActionsByWorkstream's signal
  // 1) — a differently-authored log might dedicate its own column to the workstream instead of
  // using a divider row.
  const workstreamColIdx = findCol(header, [/^workstream$/, /^track$/, /^category$/]);

  const actions = [];
  for (const cells of dataRows) {
    const what = stripTags(cells[whatIdx]?.html || '');
    if (!what) continue;
    actions.push({
      what,
      owner: ownerIdx !== -1 ? stripTags(cells[ownerIdx]?.html || '') : null,
      comment: commentIdx !== -1 ? stripTags(cells[commentIdx]?.html || '') : null,
      status: statusIdx !== -1 ? stripTags(cells[statusIdx]?.html || '') : null,
      eta: etaIdx !== -1 ? stripTags(cells[etaIdx]?.html || '') : null,
      workstreamCol: workstreamColIdx !== -1 ? stripTags(cells[workstreamColIdx]?.html || '') : null
    });
  }
  return { status: 'parsed', actions, header };
}

// Best-effort reuse of the existing single-page parsers for Planning/Weekly child pages, in case
// a project actually did put a real "Deliverables status"-shaped or "Week summary"-shaped table
// there instead of just linking out to an external tool.
function parseGenericTablePage(html) {
  if (!extractTables(html).length) return { status: 'external_only', text: stripTags(html).slice(0, 300) };
  return { status: 'has_table_untyped', tableCount: extractTables(html).length };
}

// "On going"/"on pause" (space-separated, unlike Jira's own status vocabulary) show up here, not
// just the usual "WIP"/"In Progress" — same underlying idea as jira.js's mapStatus, and "on pause"
// gets the same treatment FUNCTIONAL_RULES.md documents for a paused Jira epic (In Progress, not
// blocked or To Start — the work started and is merely paused, not stalled on an impediment).
function mapActionStatus(status) {
  const s = (status || '').toLowerCase();
  if (/done|closed/.test(s)) return 'done';
  if (/block|impediment|on.?hold/.test(s)) return 'blk';
  if (/wip|progress|on.?going|on.?pause/.test(s)) return 'prog';
  return 'ts';
}

// ── Workstream/deliverable identification (general rule, not specific to this one page) ────────
// Definition (given by the user, corrected from this POC's earlier — backwards — usage): a
// WORKSTREAM is a functional track/parallel thread that organizes a group of related tasks; a
// DELIVERABLE is one concrete, tangible-or-not output produced within it. A deliverable is a
// subset of a workstream, never the other way round.
//
// A source table's own structural grouping is what tells us which rows are "one workstream", in
// order of reliability:
//   1. An explicit column already named for it (Workstream/Team/Track/Category), distinct from
//      the item/action name column — use it directly, no inference needed.
//   2. A rowspan-merged leading cell (see confluence.js's parseDeliverables — the single-page
//      "Deliverables status" table already works this way): the merged label is the workstream,
//      each row it spans is one deliverable under it.
//   3. A "divider" row carrying only the item-name cell with every other cell on that row blank
//      (seen on this Actions Log: a bare "Legal"/"Marketing"/"PU" row with no status/comment/ETA)
//      — same grouping idea expressed without rowspan. The divider's text is the workstream;
//      every populated row until the next divider is a deliverable under it.
// A deliverable that no signal groups at all becomes its own single-deliverable workstream (same
// "ungrouped" fallback confluence.js's parseDeliverables already applies), rather than being
// dropped or mislabeled as something it isn't.
//
// This Actions Log only exercises signal 3 in practice (its columns are What/Owner/Comments/
// Status/ETA — no dedicated Workstream column, and rowspan isn't how this particular page's
// author expressed grouping), but the check order is written generally so a differently-authored
// project's log can be plugged in without rewriting this function.
function groupActionsByWorkstream(actions) {
  const groups = [];
  let current = null;
  for (const a of actions) {
    if (!a.what) continue;

    if (a.workstreamCol) {
      // Signal 1: an explicit column already says which workstream this row belongs to.
      if (!current || current.workstream !== a.workstreamCol) {
        current = { workstream: a.workstreamCol, deliverables: [] };
        groups.push(current);
      }
      current.deliverables.push(a);
      continue;
    }

    // Signal 3: a divider row (only the item-name cell populated) names the workstream for every
    // deliverable row that follows, until the next divider.
    const isDividerRow = !a.status && !a.comment && !a.eta;
    if (isDividerRow) { current = { workstream: a.what, deliverables: [] }; groups.push(current); continue; }

    if (!current) { current = { workstream: a.what, deliverables: [] }; groups.push(current); }
    current.deliverables.push(a);
  }
  return groups;
}

// Adapts the grouped {workstream, deliverables[]} shape onto report-gen.js's existing, unmodified
// matrix row shape — which still names its own fields `deliverable` (the rowspan-grouped column)
// and `name` (the individual row) from this POC's earlier, backwards usage of those terms. Scope
// decision: fix the identification logic above, but don't rename report-gen.js's template/columns
// or the app's shipped `workstreams` DB schema — those are today's real, in-use production
// terminology and out of scope for this POC. So yes, `deliverable: g.workstream` below really is
// putting a workstream's name into the field literally called `deliverable` — deliberate, not a
// regression of the fix.
function groupsToMatrixRows(groups) {
  return groups.flatMap(g => g.deliverables.map(a => ({
    deliverable: g.workstream,
    name: a.what,
    team: a.owner || null,
    status: mapActionStatus(a.status),
    // ETA is free text on this page ("11 décembre", empty, etc.) — no reliable parse without
    // guessing a date format per project, and a wrong date is worse than none (see
    // FUNCTIONAL_RULES.md's "no date beats a wrong date" rule), so this stays unset for now.
    endDate: null
  })));
}

function actionsToWorkstreams(actions) {
  return groupsToMatrixRows(groupActionsByWorkstream(actions));
}

function computeStats(workstreams) {
  const stats = { done: 0, prog: 0, blk: 0, ts: 0, total: workstreams.length };
  workstreams.forEach(w => { stats[w.status] = (stats[w.status] || 0) + 1; });
  return stats;
}

// ── Diff-based ABC synthesis ─────────────────────────────────────────────────────────────────
// This project has no "Week summary" table anywhere in Confluence — the user's own hypothesis:
// derive Achievements/Blockers/Clarify from what actually changed on the Actions Log/Risk
// Register/Decisions register between last week and this week, using their real edit history
// (fetchBodyAtOrBefore) rather than inventing content. Matched by `what`/ref/id — best-effort,
// since none of these pages have a stable per-row identity beyond their own text/reference.
function diffActionsToAchievements(prevActions, currActions) {
  const key = a => a.what.trim().toLowerCase();
  const prevByKey = new Map(prevActions.map(a => [key(a), a]));
  const out = [];
  currActions.forEach(a => {
    if (!a.what) return;
    const prev = prevByKey.get(key(a));
    const doneNow = /done|closed/i.test(a.status || '');
    const doneBefore = prev && /done|closed/i.test(prev.status || '');
    if (doneNow && !doneBefore) out.push({ text: a.what, jira_key: null });
  });
  return out;
}

function diffRisksToBlockers(prevRisks, currRisks) {
  const prevRefs = new Set(prevRisks.map(r => r.ref));
  return currRisks
    .filter(r => !prevRefs.has(r.ref))
    .map(r => ({ text: `New ${r.level} risk: ${r.desc}`, jira_key: null }));
}

// A brand-new decision entry already marked Taken this week, or one that flips from
// Submitted/pending to Taken, both read as an Achievement (a call got made); a brand-new entry
// still pending reads as Clarify (an open question the report should surface, not hide).
function diffDecisionsToAchievementsAndClarify(prevDecisions, currDecisions) {
  const prevByKey = new Map(prevDecisions.map(d => [d.id, d]));
  const achievements = [];
  const clarify = [];
  currDecisions.forEach(d => {
    const prev = prevByKey.get(d.id);
    const takenNow = /taken|d[ée]cid/i.test(d.status || '');
    const takenBefore = prev && /taken|d[ée]cid/i.test(prev.status || '');
    if (!prev) {
      if (takenNow) achievements.push({ text: `Decision taken: ${d.desc}`, jira_key: null });
      else clarify.push({ text: `Decision pending: ${d.desc}`, jira_key: null });
    } else if (takenNow && !takenBefore) {
      achievements.push({ text: `Decision taken: ${d.desc}`, jira_key: null });
    }
  });
  return { achievements, clarify };
}

// Full pipeline for one project: discover its child pages, pull the Actions Log/Risk Register/
// Decisions register as they stood at two points in time, diff them into ABC highlights, and map
// the current Actions Log straight onto the deliverable matrix — everything genReport() (the
// real, unmodified report-gen.js) already expects, so the rendered report matches the existing
// template exactly.
async function buildWeeklyReportInputs(token, spaceKey, hubTitle, prevDate, currDate) {
  const hub = await confluence.fetchPageBody(token, spaceKey, hubTitle);
  if (!hub.id) throw new AppError('confluence_not_found', `Hub page not found: ${spaceKey} / "${hubTitle}"`);
  const children = (await fetchChildren(token, hub.id)).map(c => ({ ...c, category: classifyTitle(c.title) }));
  const findChild = cat => children.find(c => c.category === cat);
  const actionsPage = findChild('actions');
  const riskPage = findChild('risks');
  const decisionsPage = findChild('decisions');

  const [prevActionsHtml, currActionsHtml] = await Promise.all([
    actionsPage ? fetchBodyAtOrBefore(token, actionsPage.id, prevDate) : null,
    actionsPage ? fetchBodyAtOrBefore(token, actionsPage.id, currDate) : null
  ]);
  const [prevRiskHtml, currRiskHtml] = await Promise.all([
    riskPage ? fetchBodyAtOrBefore(token, riskPage.id, prevDate) : null,
    riskPage ? fetchBodyAtOrBefore(token, riskPage.id, currDate) : null
  ]);
  const [prevDecHtml, currDecHtml] = await Promise.all([
    decisionsPage ? fetchBodyAtOrBefore(token, decisionsPage.id, prevDate) : null,
    decisionsPage ? fetchBodyAtOrBefore(token, decisionsPage.id, currDate) : null
  ]);

  const prevActions = prevActionsHtml ? (parseActionsPage(prevActionsHtml).actions || []) : [];
  const currActions = currActionsHtml ? (parseActionsPage(currActionsHtml).actions || []) : [];
  const prevRisks = prevRiskHtml ? (parseRiskRegisterPage(prevRiskHtml).risks || []) : [];
  const currRisks = currRiskHtml ? (parseRiskRegisterPage(currRiskHtml).risks || []) : [];
  const prevDecisions = prevDecHtml ? (parseDecisionsPage(prevDecHtml).decisions || []) : [];
  const currDecisions = currDecHtml ? (parseDecisionsPage(currDecHtml).decisions || []) : [];

  const decDiff = diffDecisionsToAchievementsAndClarify(prevDecisions, currDecisions);
  const highlights = {
    achievements: [...diffActionsToAchievements(prevActions, currActions), ...decDiff.achievements],
    blockers: diffRisksToBlockers(prevRisks, currRisks),
    clarify: decDiff.clarify
  };

  const workstreams = actionsToWorkstreams(currActions);
  const stats = computeStats(workstreams);

  return {
    highlights, risks: currRisks, workstreams, stats,
    meta: {
      actionsPage: actionsPage?.title, riskPage: riskPage?.title, decisionsPage: decisionsPage?.title,
      prevActionsCount: prevActions.length, currActionsCount: currActions.length,
      prevRisksCount: prevRisks.length, currRisksCount: currRisks.length,
      prevDecisionsCount: prevDecisions.length, currDecisionsCount: currDecisions.length
    }
  };
}

async function discoverAndParse(token, spaceKey, hubTitle) {
  const hub = await confluence.fetchPageBody(token, spaceKey, hubTitle);
  if (!hub.id) throw new AppError('confluence_not_found', `Hub page not found: ${spaceKey} / "${hubTitle}"`);
  const children = await fetchChildren(token, hub.id);
  const classified = children.map(c => ({ ...c, category: classifyTitle(c.title) }));

  const categories = {};
  for (const cat of ['risks', 'decisions', 'actions', 'planning', 'weekly']) {
    const match = classified.find(c => c.category === cat);
    if (!match) { categories[cat] = { status: 'no_child_page' }; continue; }
    const html = await fetchBodyById(token, match.id);
    let parsed;
    if (cat === 'risks') parsed = parseRiskRegisterPage(html);
    else if (cat === 'decisions') parsed = parseDecisionsPage(html);
    else if (cat === 'actions') parsed = parseActionsPage(html);
    else parsed = parseGenericTablePage(html);
    categories[cat] = { childPage: match.title, childId: match.id, ...parsed };
  }

  return { hub: { id: hub.id, title: hubTitle }, children: classified, categories };
}

module.exports = {
  classifyTitle, fetchChildren, fetchBodyById, fetchVersionHistory, fetchBodyAtOrBefore,
  parseRiskRegisterPage, parseDecisionsPage, parseActionsPage, parseGenericTablePage,
  groupActionsByWorkstream, groupsToMatrixRows, actionsToWorkstreams, computeStats,
  diffActionsToAchievements, diffRisksToBlockers, diffDecisionsToAchievementsAndClarify,
  buildWeeklyReportInputs, discoverAndParse
};
