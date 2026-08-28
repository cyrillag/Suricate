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
    const desc = stripTags(cells[descIdx]?.html || '');
    const mitigation = mitigationIdx !== -1 ? (liItems(cells[mitigationIdx].html).map(i => i.text).join('; ') || stripTags(cells[mitigationIdx].html)) : '';
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

  const actions = [];
  for (const cells of dataRows) {
    const what = stripTags(cells[whatIdx]?.html || '');
    if (!what) continue;
    actions.push({
      what,
      owner: ownerIdx !== -1 ? stripTags(cells[ownerIdx]?.html || '') : null,
      comment: commentIdx !== -1 ? stripTags(cells[commentIdx]?.html || '') : null,
      status: statusIdx !== -1 ? stripTags(cells[statusIdx]?.html || '') : null,
      eta: etaIdx !== -1 ? stripTags(cells[etaIdx]?.html || '') : null
    });
  }
  return { status: 'parsed', actions };
}

// Best-effort reuse of the existing single-page parsers for Planning/Weekly child pages, in case
// a project actually did put a real "Deliverables status"-shaped or "Week summary"-shaped table
// there instead of just linking out to an external tool.
function parseGenericTablePage(html) {
  if (!extractTables(html).length) return { status: 'external_only', text: stripTags(html).slice(0, 300) };
  return { status: 'has_table_untyped', tableCount: extractTables(html).length };
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
  classifyTitle, fetchChildren, fetchBodyById,
  parseRiskRegisterPage, parseDecisionsPage, parseActionsPage, parseGenericTablePage,
  discoverAndParse
};
