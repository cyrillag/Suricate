const fetch = require('node-fetch');
const { AppError, httpErrorCode } = require('./errors');
const BASE = process.env.CONFLUENCE_BASE || 'https://confluence.ovhcloud.tools';

async function confluenceFetch(url, token) {
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeout: 15000 });
  } catch (err) {
    throw new AppError('confluence_unavailable', `Confluence unreachable: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(httpErrorCode('confluence', res.status), `Confluence ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchPageBody(token, spaceKey, title) {
  const url = `${BASE}/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}&expand=body.storage,version`;
  const data = await confluenceFetch(url, token);
  if (!data.results?.length) throw new AppError('confluence_not_found', `Confluence page not found: ${spaceKey} / "${title}"`);
  const page = data.results[0];
  return { id: page.id, version: page.version?.number, html: page.body?.storage?.value || '' };
}

async function fetchContentById(token, id) {
  const data = await confluenceFetch(`${BASE}/rest/api/content/${id}?expand=space`, token);
  return { space: data.space?.key || null, title: data.title || null };
}

// Confluence shows PMs several different URL shapes depending on how they navigate/share a page
// (the pretty "/display/SPACE/Title", or "/pages/viewpage.action?pageId=N" straight from the API
// or a "Copy link" action). Accepting all of them removes a common onboarding stumbling block.
async function resolvePageUrl(token, url) {
  let u;
  try { u = new URL((url || '').trim()); } catch { return null; }

  const displayMatch = u.pathname.match(/\/display\/([^/]+)\/(.+)$/);
  if (displayMatch) {
    const space = decodeURIComponent(displayMatch[1]);
    const page = decodeURIComponent(displayMatch[2].replace(/\+/g, ' '));
    return (space && page) ? { space, page } : null;
  }

  const pageId = u.searchParams.get('pageId') || (u.pathname.match(/\/pages\/(\d+)/) || [])[1];
  if (pageId) {
    try {
      const { space, title } = await fetchContentById(token, pageId);
      // Confluence can 200 on a content lookup while still omitting `space` (e.g. permission
      // edge cases) — treat that the same as "couldn't resolve" rather than storing a broken
      // half-populated reference that only surfaces as a cryptic API error on the next sync.
      return (space && title) ? { space, page: title } : null;
    } catch { return null; }
  }

  return null;
}

// Structural check independent of any single week's content — used to tell "page doesn't match
// the required format" apart from "format is fine, just nothing to report yet this week".
function validatePageFormat(html) {
  return {
    hasDeliverables:     extractTables(extractSection(html, 'Deliverables status')).length > 0,
    hasWeekSummaryTable: extractTables(extractSection(html, 'Week summary')).length > 0,
    hasRiskTable:        extractTables(extractSection(html, 'Risk matrix')).some(t => /R[ée]f[ée]rence/i.test(t))
  };
}

function stripTags(html) {
  return String(html || '')
    // A Confluence "status" macro (colored lozenge) always carries a "colour" parameter
    // alongside "title" — collapsing the whole macro down to just its title (e.g. "done",
    // "HIGH") avoids leaking the colour name as loose text once the other tags are stripped
    // below (a bare `<ac:parameter ac:name="title">` replace would strip the <ac:parameter>
    // tags around "colour" but leave its inner text "Green"/"Yellow"/etc. sitting in the
    // output, corrupting any exact-match status lookup downstream, e.g. "Green done").
    .replace(/<ac:structured-macro ac:name="status"[^>]*>[\s\S]*?<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same as stripTags, but keeps a PM's manual bold/italic/underline emphasis (e.g. on the
// executive summary) instead of discarding it. Real <strong>/<em>/<u> tags are swapped for plain
// text placeholders here — surviving the same tag-stripping this function otherwise does — so
// the caller can safely HTML-escape the rest of the text (protecting against anything else
// Confluence-sourced) before turning the placeholders back into real tags at render time. Never
// return raw HTML directly from here: nothing downstream should have to trust this string as-is.
function stripTagsKeepEmphasis(html) {
  return String(html || '')
    .replace(/<ac:structured-macro ac:name="status"[^>]*>[\s\S]*?<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/gi, ' $1 ')
    .replace(/<(\/?)(strong|b)(?=[\s>])[^>]*>/gi, (_, close) => close ? '{{/STRONG}}' : '{{STRONG}}')
    .replace(/<(\/?)(em|i)(?=[\s>])[^>]*>/gi, (_, close) => close ? '{{/EM}}' : '{{EM}}')
    .replace(/<(\/?)u(?=[\s>])[^>]*>/gi, (_, close) => close ? '{{/U}}' : '{{U}}')
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

// A single "Jira" column cell can embed more than one {jira} macro (e.g. a workstream backed by
// several epics). All of them drive the workstream's status — see parseDeliverables.
function jiraKeysFromCell(html) {
  const re = /ac:name="key">([A-Z][A-Z0-9]*-\d+)</gi;
  const keys = [];
  let m;
  while ((m = re.exec(html))) keys.push(m[1]);
  return keys;
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
  const text = stripTagsKeepEmphasis(section);
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
  let headerColCount = null;
  for (const row of rows) {
    const cells = extractCells(row);
    if (!cells.length) continue;
    if (cells.every(c => c.type === 'th')) { headerColCount = cells.length; continue; } // header row (all-th, no data cells)
    // A deliverable spanning several workstreams uses `rowspan` on its leading cell, and Confluence
    // then omits that cell entirely from every following row of the group — so a row still
    // carrying the full column count is starting a new deliverable, one cell short is another
    // workstream under the previous one. Some pages additionally mark that leading cell as a
    // <th> (an older template convention); checked as a fallback since not every page does.
    let idx = 0;
    let deliverableJustSet = false;
    if (cells[0].type === 'th' || (headerColCount != null && cells.length >= headerColCount)) {
      currentDeliverable = stripTags(cells[0].html); idx = 1; deliverableJustSet = true;
    }
    if (!currentDeliverable) continue;
    // Single-workstream deliverables (e.g. "E2E tests") sometimes leave the workstream-name
    // cell blank, relying on the deliverable label itself — fall back to it in that case.
    const wsName = (cells[idx] ? stripTags(cells[idx].html) : null) || (deliverableJustSet ? currentDeliverable : null);
    const team   = cells[idx + 1] ? stripTags(cells[idx + 1].html) : null;
    const jiraCellHtml = cells[idx + 2] ? cells[idx + 2].html : '';
    // The matrix must mirror the Confluence table exactly — one row in, one row out — but a cell
    // embedding more than one {jira} macro (a workstream backed by several epics) still needs
    // every one of them to drive the row's status, not just the first. jira_key stores all keys
    // comma-joined; the caller aggregates their statuses (done only if ALL are done, etc.).
    const jiraKeys = jiraKeysFromCell(jiraCellHtml);
    const plainStatusText = stripTags(jiraCellHtml); // e.g. "Done" when no jira macro is used
    if (!wsName) continue;
    workstreams.push({
      deliverable: currentDeliverable,
      name: wsName,
      team: team || null,
      jira_key: jiraKeys.length ? jiraKeys.join(',') : null,
      manual_status: !jiraKeys.length && plainStatusText ? plainStatusText : null,
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
    // A risk marked Closed means the issue was already resolved — by definition it no longer
    // belongs in a live weekly report, so it's dropped rather than parsed and shown stale.
    const statusText = stripTags(cells[3]?.html || '').toLowerCase();
    if (/closed/.test(statusText)) continue;
    const ref = stripTags(cells[0].html);
    const desc = stripTags(cells[1].html);
    const scoreText = stripTags(cells[2].html).toLowerCase();
    // Extreme is a step above High, not a synonym for it — folding it into 'high' silently
    // dropped the distinction the Confluence risk matrix's own colour scale (Yellow/Orange/Red)
    // makes, understating the most severe risks on a page as "just High" like everything else.
    let level = 'medium';
    if (/extreme/.test(scoreText)) level = 'extreme';
    else if (/high/.test(scoreText)) level = 'high';
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

module.exports = {
  fetchPageBody, fetchContentById, resolvePageUrl, validatePageFormat,
  parseExecSummary, parseWeekSummary, parseDeliverables, parseRisks, syncProjectFromConfluence
};
