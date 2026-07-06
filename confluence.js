const fetch = require('node-fetch');
const BASE = process.env.CONFLUENCE_BASE || 'https://confluence.ovhcloud.tools';

async function fetchPageBody(token, spaceKey, title) {
  const url = `${BASE}/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}&expand=body.storage,version`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeout: 15000 });
  if (!res.ok) throw new Error(`Confluence ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  if (!data.results?.length) throw new Error(`Confluence page not found: ${spaceKey} / "${title}"`);
  const page = data.results[0];
  return { id: page.id, version: page.version?.number, html: page.body?.storage?.value || '' };
}

function stripTags(html) {
  return String(html || '')
    .replace(/<ac:parameter[^>]*ac:name="title">([^<]*)<\/ac:parameter>/gi, ' $1 ') // keep status-macro titles (e.g. HIGH)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSection(html, heading) {
  // Grabs everything between an <h1>N. Heading</h1> marker and the next <h1> (or end of doc)
  const re = new RegExp(`<h1[^>]*>\\s*\\d+\\.\\s*${heading}\\s*<\\/h1>([\\s\\S]*?)(?=<h1[^>]*>|$)`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

function extractTables(sectionHtml) {
  const tables = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(sectionHtml))) tables.push(m[0]);
  return tables;
}

function extractRows(tableHtml) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tableHtml))) rows.push(m[1]);
  return rows;
}

function extractCells(rowHtml) {
  // Returns { header: [th htmls], data: [td htmls] } preserving order via a combined list tagged with type
  const cells = [];
  const re = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const rowspanM = m[2].match(/rowspan="(\d+)"/i);
    cells.push({ type: m[1].toLowerCase(), attrs: m[2], html: m[3], rowspan: rowspanM ? parseInt(rowspanM[1]) : 1 });
  }
  return cells;
}

function jiraKeyFromCell(html) {
  const m = html.match(/ac:name="key">([A-Z][A-Z0-9]*-\d+)</i);
  return m ? m[1] : null;
}

function liItems(html) {
  const items = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[1]);
    const jira = jiraKeyFromCell(m[1]);
    if (text) items.push({ text, jira_key: jira });
  }
  return items;
}

function categoryItems(cellHtml) {
  const items = liItems(cellHtml);
  if (items.length) return items;
  const text = stripTags(cellHtml);
  if (!text || /^nothing to report$/i.test(text)) return [];
  return [{ text, jira_key: jiraKeyFromCell(cellHtml) }];
}

// ── Executive summary ────────────────────────────────────────────────
function parseExecSummary(html) {
  const section = extractSection(html, 'Executive summary');
  const text = stripTags(section);
  return text || null;
}

// ── Week summary (Achievements / Blockers / Clarify) ────────────────
function parseWeekSummary(html, week) {
  const section = extractSection(html, 'Week summary');
  const tables = extractTables(section);
  if (!tables.length) return null;
  const rows = extractRows(tables[0]);
  for (const row of rows) {
    const cells = extractCells(row);
    if (!cells.length) continue;
    const label = stripTags(cells[0].html);
    const wm = label.match(/w(\d+)/i);
    if (!wm || parseInt(wm[1]) !== week) continue;
    const [, achCell, blkCell, clrCell] = cells;
    return {
      achievements: achCell ? categoryItems(achCell.html) : [],
      blockers:     blkCell ? categoryItems(blkCell.html) : [],
      clarify:      clrCell ? categoryItems(clrCell.html) : []
    };
  }
  return null;
}

// ── Deliverables status → workstreams ────────────────────────────────
function parseDeliverables(html) {
  const section = extractSection(html, 'Deliverables status');
  const tables = extractTables(section);
  if (!tables.length) return [];
  const rows = extractRows(tables[0]);
  const workstreams = [];
  let currentDeliverable = null;
  let sortOrder = 0;
  for (const row of rows) {
    const cells = extractCells(row);
    if (!cells.length) continue;
    if (cells.every(c => c.type === 'th')) continue; // header row (all-th, no data cells)
    let idx = 0;
    let deliverableJustSet = false;
    if (cells[0].type === 'th') { currentDeliverable = stripTags(cells[0].html); idx = 1; deliverableJustSet = true; }
    if (!currentDeliverable) continue;
    // Single-workstream deliverables (e.g. "E2E tests") sometimes leave the workstream-name
    // cell blank, relying on the deliverable label itself — fall back to it in that case.
    const wsName = (cells[idx] ? stripTags(cells[idx].html) : null) || (deliverableJustSet ? currentDeliverable : null);
    const team   = cells[idx + 1] ? stripTags(cells[idx + 1].html) : null;
    const jiraCellHtml = cells[idx + 2] ? cells[idx + 2].html : '';
    const jiraKey = jiraKeyFromCell(jiraCellHtml);
    const plainStatusText = stripTags(jiraCellHtml); // e.g. "Done" when no jira macro is used
    if (!wsName) continue;
    workstreams.push({
      deliverable: currentDeliverable,
      name: wsName,
      team: team || null,
      jira_key: jiraKey,
      manual_status: !jiraKey && plainStatusText ? plainStatusText : null,
      sort_order: sortOrder++
    });
  }
  return workstreams;
}

// ── Risk matrix ──────────────────────────────────────────────────────
function parseRisks(html) {
  const section = extractSection(html, 'Risk matrix');
  const tables = extractTables(section);
  // The legend table is nested first; the actual risk register is the table with a "Référence" header.
  const riskTable = tables.find(t => /R[ée]f[ée]rence/i.test(t));
  if (!riskTable) return [];
  const rows = extractRows(riskTable);
  const risks = [];
  for (const row of rows) {
    const cells = extractCells(row);
    if (cells.length < 5 || /R[ée]f[ée]rence/i.test(stripTags(cells[0]?.html || ''))) continue;
    const ref = stripTags(cells[0].html);
    const desc = stripTags(cells[1].html);
    const scoreText = stripTags(cells[2].html).toLowerCase();
    let level = 'medium';
    if (/high|extreme/.test(scoreText)) level = 'high';
    else if (/very low|^low/.test(scoreText)) level = 'low';
    const mitigation = liItems(cells[4].html).map(i => i.text).join('; ') || stripTags(cells[4].html);
    if (desc) risks.push({ ref, level, desc, mitigation });
  }
  return risks;
}

async function syncProjectFromConfluence(token, spaceKey, title, week) {
  const page = await fetchPageBody(token, spaceKey, title);
  return {
    version: page.version,
    workstreams: parseDeliverables(page.html),
    weekSummary: week != null ? parseWeekSummary(page.html, week) : null,
    risks: parseRisks(page.html)
  };
}

module.exports = { fetchPageBody, parseExecSummary, parseWeekSummary, parseDeliverables, parseRisks, syncProjectFromConfluence };
