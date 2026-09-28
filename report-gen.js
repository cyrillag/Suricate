const { translate } = require('./i18n');

// A plain "⚙" (U+2699 GEAR) renders inconsistently across platforms/fonts — on some it reads as a
// ship's helm/wheel rather than a settings cog. An inline SVG (stroke=currentColor, so it inherits
// the button's own text color/hover transition for free) is unambiguous everywhere. Feather Icons'
// "settings" glyph — a well-known, simple outline shape.
const GEAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

function generateReport({ project, year, week, pmName, execSummary, highlights, risks, workstreams, milestones = [], epics, planningTree = null, stats, health, isOwner, etaDelayed, etaDelayedFrom, etaDisplay, lang, userName, backfilled, generatedAt, confluenceUrl = null }) {
  // milestones: up to 3 fixed, manually-configured phases (Alpha/Beta/GA — see
  // FUNCTIONAL_RULES.md "Milestones") as [{name, key, end}], already filtered to only the ones a
  // project actually set. Drives only the Project Identity quick-view chips below — the
  // Deliverable matrix is always flat, never grouped by milestone (an earlier attempt at
  // auto-grouping the matrix by an auto-discovered milestone was retired: on a real project the
  // Jira hierarchy it relied on didn't actually separate the phases a PM has in mind).
  const weekStr = `W${String(week).padStart(2, '0')}`;
  const yearWeek = `${year}-${weekStr}`;
  const dateLabel = isoWeekMonday(year, week);
  const prevW = adjacentWeek(year, week, -1);
  const nextW = adjacentWeek(year, week,  1);
  const today = currentIsoWeek();
  const isCurrentWeek = year === today.year && week === today.week;
  const nextIsFuture = nextW.year > today.year || (nextW.year === today.year && nextW.week > today.week);
  const nextWeekNav = nextIsFuture
    ? `<span class="week-arrow week-arrow-disabled" aria-disabled="true" title="Not available yet">&#x203A;</span>`
    : `<a class="week-arrow" href="/projects/${esc(project.slug)}/${nextW.year}-W${nextW.weekPad}" aria-label="Next week">&#x203A;</a>`;

  // Group workstreams by deliverable
  const deliverables = [];
  const seen = {};
  workstreams.forEach(ws => {
    if (!seen[ws.deliverable]) { seen[ws.deliverable] = []; deliverables.push({ name: ws.deliverable, rows: seen[ws.deliverable] }); }
    seen[ws.deliverable].push(ws);
  });

  const statusLabel = { done: 'Done', prog: 'In Progress', blk: 'Blocked', ts: 'To Start' };
  const delStatus = del => {
    const rows = del.rows;
    if (rows.every(r => r.status === 'done')) return 'done';
    if (rows.some(r => r.status === 'blk'))  return 'blk';
    if (rows.some(r => r.status === 'prog'))  return 'prog';
    return 'ts';
  };

  const matrixRows = deliverables.map(del => {
    const ds = delStatus(del);
    return del.rows.map((ws, i) => {
      const st = ws.status || 'ts';
      return `
        ${i === 0 ? `<tr class="del-first">
          <td class="td-del ${ds}" rowspan="${del.rows.length}">${esc(del.name)}</td>` : '<tr>'}
          <td class="td-ws"><div class="cell-n"><span class="ws-name">${esc(ws.name)}</span></div></td>
          <td class="cell-team">${esc(ws.team || '')}</td>
          <td class="cell-enddate">${ws.endDate ? formatShortDate(ws.endDate) : '<span class="no-enddate">No date</span>'}</td>
          <td class="td-st">
            <span class="st ${st}">${statusLabel[st] || st}</span>
          </td>
        </tr>`;
    }).join('');
  }).join('');

  const abcSection = cat => {
    const items = (highlights[cat] || []);
    if (!items.length) return '<li>Nothing to report this week.</li>';
    return items.map(it => {
      const jiraLink = it.jira_key ? ` <a class="ji" href="https://jira.ovhcloud.tools/browse/${esc(it.jira_key)}" target="_blank" rel="noopener">${esc(it.jira_key)}</a>` : '';
      return `<li>${esc(it.text)}${jiraLink}</li>`;
    }).join('');
  };

  const risksHTML = risks.length
    ? risks.map((r, i) => `
      <div class="risk-item">
        <div class="risk-l">
          <span class="risk-ref">RIS-${String(i + 1).padStart(2, '0')}</span>
          <div class="risk-badge ${r.level || 'high'}">${cap(r.level || 'High')}</div>
        </div>
        <div>
          <div class="risk-desc">${esc(r.desc)}</div>
          <div class="risk-mit">${esc(r.mitigation || '')}</div>
        </div>
      </div>`).join('')
    : '<div style="padding:14px 20px;font-size:13px;color:#636369">No risks recorded this week.</div>';

  // Gantt data — an epic with no Start/End date still gets listed (name/team/status), it just
  // has no bar to draw; excluding it from the section entirely would make it invisible instead
  // of just dateless (see FUNCTIONAL_RULES.md). Cancelled epics are filtered upstream (server.js'
  // resolveWorkstreamsAndEpics), against the raw Jira status — by the time `epics` gets here,
  // status has already been mapped to done/prog/blk/ts, which a cancelled epic is
  // indistinguishable from (this used to be checked here against a 'cancel' bucket that
  // mapStatus can never actually produce, so it silently never filtered anything).
  // An epic that already ended more than 6 months ago is dropped entirely — long-finished history
  // cluttering a weekly status view without adding anything a PM needs *now*, and it was also
  // dragging the timeline's own start further and further into the past the older a project gets.
  // Evaluated against today (view time), same read-time framing as the "Today" marker itself, not
  // frozen to the report's own week — an old report viewed later declutters the same way. Never
  // filters on Start date: an epic still open (no End date) stays regardless of how long ago it
  // started, since it isn't "history" yet.
  const historyFloor = new Date();
  historyFloor.setMonth(historyFloor.getMonth() - 6);
  const historyFloorIso = historyFloor.toISOString().slice(0, 10);
  const ganttEpics = epics.filter(e => !e.end || e.end >= historyFloorIso);
  const hasPartialDates = ganttEpics.some(e => (e.start && !e.end) || (!e.start && e.end));

  // Planning Light (see FUNCTIONAL_RULES.md) — when the project is opted in (planningTree isn't
  // null), it REPLACES the flat ganttEpics section above rather than sitting alongside it. Same
  // fiscal-quarter month axis as the classic Gantt, computed server-side here (not client-side like
  // GANTT_JS below), with no client JS needed beyond collapse/expand. The axis starts 3 months before
  // today (not the classic Gantt's 6) and runs to the end of the month of the latest date shown —
  // at least 3 months ahead — instead of a fixed end: the timeline scrolls horizontally on its own
  // (see renderPlanningSection), so a long plan no longer has to be clipped or squeezed to fit.
  const planningRows = planningTree ? flattenPlanningTree(planningTree) : null;
  const nowUtc = new Date();
  const planningTstart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 3, 1));
  const latestPlanningDate = (planningRows || []).flatMap(r => [r.start, r.end]).filter(Boolean)
    .reduce((a, b) => a > b ? a : b, new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() + 3, 1)).toISOString().slice(0, 10));
  // Exclusive end: the 1st of the month after the latest date, so that whole last month is drawn.
  const planningTend = new Date(Date.UTC(Number(latestPlanningDate.slice(0, 4)), Number(latestPlanningDate.slice(5, 7)), 1));
  const pctDate = d => {
    if (!d) return null;
    const p = (new Date(d) - planningTstart) / (planningTend - planningTstart) * 100;
    return Math.max(0, Math.min(100, p));
  };
  const planningTstartIso = planningTstart.toISOString().slice(0, 10);
  // The Manage mode (hide/rename/group) is retired; a snapshot frozen while it existed can still
  // carry hidden rows, which stay out of that past report for everyone, as they were.
  const visiblePlanningRows = planningRows ? planningRows.filter(r => !r.hidden) : null;
  const hasPartialDatesPlanning = visiblePlanningRows ? visiblePlanningRows.some(r => (r.start && !r.end) || (!r.start && r.end)) : false;
  // buildGanttMonths' end is inclusive — pass the last day of the last month, not the exclusive end.
  const { months: planningMonths, quarterLines: planningQuarterLines } = planningTree ? buildGanttMonths(planningTstart, new Date(planningTend - 86400000)) : { months: [], quarterLines: [] };

  // Donut data
  const donutJSON = JSON.stringify([
    { v: stats.done, c: '#A6D64D' },
    { v: stats.prog, c: '#0050D5' },
    { v: stats.blk,  c: '#ED733D' },
    { v: stats.ts,   c: '#BEC0C6' }
  ]);

  const brandName = esc(translate(lang, 'nav.brand'));
  const tagline = esc(translate(lang, 'nav.tagline'));
  const logoutLabel = esc(translate(lang, 'nav.logout'));
  // Permanent, baked into the frozen snapshot itself (not a today-only warning on the way in) —
  // anyone reading this report later, even as a standalone export/screenshot, needs to know it's
  // not a real point-in-time record (see FUNCTIONAL_RULES.md's backfilled-report rule).
  const backfillNotice = backfilled ? esc(translate(lang, 'detail.backfilled_notice', { date: generatedAt, week: `${weekStr}/${year}` })) : null;

  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(project.name)} — Weekly Report ${weekStr}/${year}</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" type="image/png" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${CSS}</style>
</head>
<body>
<nav class="app-nav">
  <svg class="nav-deco" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 56" preserveAspectRatio="none">
    <polygon points="300,0 300,56 180,56" fill="rgba(255,255,255,0.04)"/>
    <polygon points="300,0 300,32 230,0" fill="rgba(255,255,255,0.05)"/>
    <polygon points="270,0 300,56 300,36" fill="rgba(20,125,232,0.12)"/>
  </svg>
  <a href="/" class="nav-brand">
    <img src="/logo-white.png" height="40" alt="">
    <div class="brand-divider"></div>
    <span class="nav-brand-text">
      <span class="nav-brand-name">${brandName}</span>
      <span class="nav-brand-tagline">${tagline}</span>
    </span>
  </a>
  <div class="nav-user">
    <div class="lang-switch">
      <a href="/lang/fr" class="lang-opt ${lang === 'fr' ? 'active' : ''}">FR</a><span class="lang-sep">/</span><a href="/lang/en" class="lang-opt ${lang === 'en' ? 'active' : ''}">EN</a>
    </div>
    <span class="nav-username">${esc(userName)}</span>
    <form method="POST" action="/logout" style="display:inline">
      <button type="submit" class="btn-ghost btn-sm">${logoutLabel}</button>
    </form>
  </div>
</nav>

<div class="app-body">

  <div class="page-header">
    <div>
      <a href="/projects/${esc(project.slug)}" class="back-link">← All reports</a>
      <h1 class="page-title">${esc(project.name)}</h1>
      <p class="page-sub">Weekly Status Report · ${esc(dateLabel)} · ${esc(pmName || project.name)}${confluenceUrl ? `<span class="confluence-link-wrap"> · <a href="${esc(confluenceUrl)}" target="_blank" rel="noopener" class="confluence-link">Confluence ↗</a></span>` : ''}</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:flex-end">
      <a href="/projects/${esc(project.slug)}/${yearWeek}/pdf" class="btn-ghost btn-sm">⬇ Export PDF</a>
      ${isOwner ? `<a href="/projects/${esc(project.slug)}/edit" class="btn-ghost btn-sm btn-icon" title="${esc(translate(lang, 'detail.configure'))}" aria-label="${esc(translate(lang, 'detail.configure'))}">${GEAR_SVG}</a>` : ''}
      ${isOwner && isCurrentWeek ? `<form method="POST" action="/projects/${esc(project.slug)}/reports/generate" style="display:inline">
        <input type="hidden" name="week" value="${yearWeek}">
        <button type="submit" class="btn-primary btn-sm">↻ Refresh</button>
      </form>` : ''}
      <div class="week-nav">
        <a class="week-arrow" href="/projects/${esc(project.slug)}/${prevW.year}-W${prevW.weekPad}" aria-label="Previous week">&#x2039;</a>
        <div class="ref-week">${weekStr} · ${year}</div>
        ${nextWeekNav}
      </div>
    </div>
  </div>

  ${backfillNotice ? `<div class="backfill-notice">${backfillNotice}</div>` : ''}

  <div class="doc-section">
    <div class="section-label">Project identity</div>
    ${execSummary ? (execSummary.length > 240
      ? `<div class="exec-summary-wrap">
          <div class="exec-summary exec-summary-clamped" id="exec-summary">${escKeepEmphasis(execSummary)}</div>
          <div class="exec-summary-readmore" id="exec-summary-readmore" onclick="var e=document.getElementById('exec-summary'),x=e.classList.toggle('exec-summary-clamped');this.textContent=x?'Read more':'Show less';">Read more</div>
        </div>`
      : `<div class="exec-summary">${escKeepEmphasis(execSummary)}</div>`) : ''}
    <div class="identity-grid">
      <div class="identity-cell"><div class="f-label">Project</div><div class="f-value">${esc(project.name)}</div></div>
      <div class="identity-cell"><div class="f-label">Project Manager</div><div class="f-value">${esc(pmName || '')}</div></div>
      <div class="identity-cell">
        <div class="f-label">Target ETA</div>
        ${milestones.length
          ? `<div class="f-value-list">${milestones.map(m => `<div class="f-value">${esc(m.name)} — ${m.done ? 'DONE' : (m.end ? formatShortDate(m.end) : 'TBD')}</div>`).join('')}</div>`
          : `<div class="f-value">${esc(etaDisplay || 'TBD')}</div>`}
        ${etaDelayed ? `<div class="eta-delayed-note">${etaDelayedFrom ? `⚠ Previous date: ${esc(etaDelayedFrom)}` : '⚠ Delayed'}</div>` : ''}
        <div class="health ${health} health-sub"><div class="health-dot"></div>${health === 'delayed' ? 'Delayed' : health === 'at-risk' ? 'At Risk' : 'On Track'}</div>
      </div>
      <div class="identity-cell">
        <div class="f-label">Epic LVL2</div>
        <div class="f-value mono"><a class="jtag" href="https://jira.ovhcloud.tools/browse/${esc(project.jira_root_epic)}" target="_blank" rel="noopener">${esc(project.jira_root_epic)}</a></div>
      </div>
    </div>
  </div>

  <div class="doc-section doc-section--abc">
    <div class="section-label">${weekStr} highlights</div>
    <div class="abc-grid">
      <div class="abc-col ach"><div class="abc-head">Achievements</div><ul class="abc-items">${abcSection('achievements')}</ul></div>
      <div class="abc-col blk"><div class="abc-head">Blockers</div><ul class="abc-items">${abcSection('blockers')}</ul></div>
      <div class="abc-col clr"><div class="abc-head">Clarify</div><ul class="abc-items">${abcSection('clarify')}</ul></div>
    </div>
  </div>

  <div class="doc-section">
    <div class="sr-grid">
      <div class="sr-left">
        <div class="section-label"><span>Status overview</span><span class="sl-right">${stats.total} ws · ${deliverables.length} del.</span></div>
        <div class="chart-pane">
          <canvas id="donut" width="120" height="120"></canvas>
          <div class="chart-legend">
            <div class="leg-row"><div class="leg-strip done"></div><span class="leg-lbl">Done</span><span class="leg-n">${stats.done}</span><span class="leg-pct">${pct(stats.done, stats.total)}%</span></div>
            <div class="leg-row"><div class="leg-strip prog"></div><span class="leg-lbl">In Progress</span><span class="leg-n">${stats.prog}</span><span class="leg-pct">${pct(stats.prog, stats.total)}%</span></div>
            <div class="leg-row"><div class="leg-strip blk"></div><span class="leg-lbl">Blocked</span><span class="leg-n">${stats.blk}</span><span class="leg-pct">${pct(stats.blk, stats.total)}%</span></div>
            <div class="leg-row"><div class="leg-strip ts"></div><span class="leg-lbl">To Start</span><span class="leg-n">${stats.ts}</span><span class="leg-pct">${pct(stats.ts, stats.total)}%</span></div>
          </div>
        </div>
      </div>
      <div class="sr-right">
        <div class="section-label">Risk register</div>
        <div class="risk-list">${risksHTML}</div>
      </div>
    </div>
  </div>

  <div class="matrix-section">
    <div class="section-label"><span>Deliverable matrix</span></div>
    <div class="matrix-scroll">
      <table class="mx">
        <thead><tr>
          <th style="width:18%">Deliverable</th>
          <th style="width:34%">Workstream</th>
          <th style="width:14%">Team</th>
          <th style="width:17%">End Date</th>
          <th style="width:17%">Status</th>
        </tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
  </div>

  ${planningTree !== null ? renderPlanningSection({ visiblePlanningRows, hasPartialDatesPlanning, planningMonths, planningQuarterLines, pctDate, planningTstartIso }) : (ganttEpics.length ? `
  <div class="matrix-section">
    <div class="section-label">Planning — team epics</div>
    <div class="gantt-mobile-note">📊 The planning timeline needs a wider screen — view this report on a desktop or tablet to see it.</div>
    <div class="gantt-outer">
      <div class="gantt-lcol" id="gantt-lcol"><div class="gantt-lhdr"></div></div>
      <div class="gantt-rcol">
        <div class="gantt-months" id="gantt-months"></div>
        <div class="gantt-body" id="gantt-body"></div>
      </div>
    </div>
    <div class="gantt-legend">
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#A6D64D"></div>Done</div>
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#0050D5"></div>In Progress</div>
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#ED733D"></div>Blocked</div>
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#BEC0C6;border:1px dashed #C8CAD4"></div>To Start</div>
      ${hasPartialDates ? '<div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:linear-gradient(to right,transparent,#87878C)"></div>Only one date known (hover for detail)</div>' : ''}
    </div>
  </div>` : '')}

</div>

<footer class="doc-footer">
  ${esc(project.name)} · Weekly Report ${weekStr}/${year} · OVHcloud Internal — Confidential · ${dateLabel}
</footer>
<script>
(function(){
  var canvas=document.getElementById('donut');
  if(!canvas)return;
  var ctx=canvas.getContext('2d'),cx=60,cy=60,r=52,inner=30;
  var segs=${donutJSON};
  var total=${stats.total},dur=900,start=null;
  function ease(t){return 1-Math.pow(1-t,3);}
  function draw(p){
    ctx.clearRect(0,0,120,120);
    var a=-Math.PI/2,gap=0.025;
    segs.forEach(function(s){
      if(!s.v)return;
      var sl=(s.v/total)*Math.PI*2*p;
      if(sl<.001){a+=sl;return;}
      ctx.beginPath();ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,r,a+gap/2,a+sl-gap/2);
      ctx.closePath();ctx.fillStyle=s.c;ctx.fill();
      a+=sl;
    });
    ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);
    ctx.fillStyle='#FFFFFF';ctx.fill();
    if(p>=1){
      ctx.fillStyle='#00185E';ctx.font='bold 18px \\"Source Sans Pro\\",Arial,sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('${stats.total}',cx,cy-7);
      ctx.fillStyle='#87878C';ctx.font='400 8px \\"Source Sans Pro\\",Arial,sans-serif';
      ctx.fillText('workstreams',cx,cy+9);
    }
  }
  function step(ts){
    if(!start)start=ts;
    var p=Math.min(ease((ts-start)/dur),1);
    draw(p);
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
})();
${planningTree !== null ? (visiblePlanningRows.length ? PLANNING_COLLAPSE_JS() : '') : (ganttEpics.length ? GANTT_JS(ganttEpics) : '')}
</script>
</body>
</html>`;
}

// OVHcloud's fiscal year starts in September (Q1=Sep/Oct/Nov ... Q4=Jun/Jul/Aug); "FYxx" is the
// 2-digit calendar year in which August of that fiscal year falls (e.g. Sep25→Aug26 = FY26).
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function buildGanttMonths(tstart, tend) {
  const months = [];
  const quarterLines = [];
  let cur = new Date(Date.UTC(tstart.getUTCFullYear(), tstart.getUTCMonth(), 1));
  const end = new Date(Date.UTC(tend.getUTCFullYear(), tend.getUTCMonth(), 1));
  while (cur <= end) {
    const cy = cur.getUTCFullYear(), cm = cur.getUTCMonth();
    const fiscalMonthIndex = (cm - 8 + 12) % 12; // 0=Sep...11=Aug
    const isQuarterStart = fiscalMonthIndex % 3 === 0;
    const quarterInFY = Math.floor(fiscalMonthIndex / 3) + 1;
    const fyYear = cm >= 8 ? cy + 1 : cy; // Sep-Dec belong to the FY ending the following year
    months.push({ m: MONTH_NAMES[cm], y: String(cy).slice(-2), q: isQuarterStart ? `Q${quarterInFY} FY${String(fyYear).slice(-2)}` : '' });
    // No gridline at the very first column (position 0%) — nothing to divide there.
    if (isQuarterStart && months.length > 1) quarterLines.push(`${cy}-${String(cm + 1).padStart(2, '0')}-01`);
    cur = new Date(Date.UTC(cy, cm + 1, 1));
  }
  return { months, quarterLines };
}

// Planning Light (see FUNCTIONAL_RULES.md) — pre-order walk of the frozen, already-overridden
// tree resolvePlanningTree/buildPlanningTree produced (server.js), turning it into one flat row
// per visible node with a depth for indentation. Deliberately does NOT skip a hidden node's
// children (see the comment at planningRows' call site above) — only the hidden node's own row is
// left for the caller to filter out.
//
// A BigPicture box's configured scope isn't epic-only — verified against a real box (HYBR-95):
// 246 issues in scope, only 31 of them Epics, the rest Task/Bug/Story/etc. reporting into those
// epics via the classic Epic Link field (see jira.js's searchByJql). Rendering all 246 as rows
// would be the exact opposite of "light" — GRANULAR_TYPES are still fetched and still count
// toward their parent's rollup dates (server.js's buildPlanningTree runs before this, over the
// full set), they just never get their own row here.
const GRANULAR_TYPES = new Set(['Task', 'Sub-task', 'Subtask', 'Bug', 'Story', 'Improvement']);
// A box built on the "Epic LPM > Phase > Deliverable > New Feature > Epic" structure (BGP Service)
// is reported at the Phase/Deliverable levels only — everything above (the Epic LPM root) and below
// (New Feature, delivery-team Epics, their Tasks) is still fetched and still feeds the rollup dates
// and statuses, it just never gets a row. Only on a tree buildPlanningTree (server.js) flagged as
// structured (a Phase linked directly under the root epic) — a box with a plain Epic-based
// hierarchy (HYBR-95, even with a stray Deliverable in it) keeps the GRANULAR_TYPES rule above.
const REPORTED_LEVEL_TYPES = new Set(['Phase', 'Deliverable']);
function flattenPlanningTree(tree) {
  const levelsOnly = tree.some(n => n.structured);
  // GROUP: nodes only exist in snapshots frozen while the retired Manage mode was around.
  const isRow = node => node.key.startsWith('GROUP:')
    || (levelsOnly ? REPORTED_LEVEL_TYPES.has(node.type) : !GRANULAR_TYPES.has(node.type));
  const out = [];
  // depth counts emitted ancestors only, not raw tree depth — a Phase under the skipped Epic LPM
  // root still renders at depth 0, and a Deliverable under it at depth 1.
  (function walk(nodes, depth) {
    nodes.forEach(node => {
      if (!isRow(node)) { walk(node.children, depth); return; }
      const row = {
        key: node.key, summary: node.summary, status: node.status || 'ts',
        start: node.start, end: node.end, depth, hasChildren: false, hidden: !!node.hidden
      };
      out.push(row);
      const before = out.length;
      walk(node.children, depth + 1);
      // Caret only when something actually renders underneath — a Deliverable whose children are
      // all skipped New Features/Epics is a leaf as far as the report is concerned.
      row.hasChildren = out.length > before;
    });
  })(tree, 0);
  return out;
}

const PLANNING_STATUS_LABEL = { done: 'Done', prog: 'In Progress', blk: 'Blocked', ts: 'To Start' };

// Same full/fade-left/fade-right/no-date bar logic as GANTT_JS's client-side version, just
// rendered server-side here (see planningTstart/pctDate at the call site).
function planningBarHtml(r, pctDate, tstartIso) {
  // Entirely before the 3-month window: clamping would leave a meaningless sliver on the left edge.
  if (r.end && r.end < tstartIso) {
    return `<span class="gantt-nodates" title="${esc(r.key)} — ${esc(r.summary)}&#10;${esc(r.start || '?')} → ${esc(r.end)}">◂ Ended ${esc(r.end)}</span>`;
  }
  if (r.start && r.end) {
    const l = pctDate(r.start), w = Math.max(0.5, pctDate(r.end) - l);
    return `<div class="gantt-bar ${r.status}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%" title="${esc(r.key)} — ${esc(r.summary)}&#10;${r.start} → ${r.end}"></div>`;
  }
  if (r.start || r.end) {
    const isEndOnly = !!r.end, PARTIAL_W = 6;
    let l, w;
    if (isEndOnly) { const right = pctDate(r.end); l = Math.max(0, right - PARTIAL_W); w = right - l; }
    else { l = pctDate(r.start); const right = Math.min(100, l + PARTIAL_W); w = right - l; }
    const tip = isEndOnly ? `No start date — ends ${r.end}` : `No end date — starts ${r.start}`;
    return `<div class="gantt-bar ${r.status} ${isEndOnly ? 'fade-left' : 'fade-right'}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%" title="${esc(r.key)} — ${esc(r.summary)}&#10;${esc(tip)}"></div>`;
  }
  return `<span class="gantt-nodates">No dates yet</span>`;
}

// Full Planning Light section (see FUNCTIONAL_RULES.md) — replaces the classic flat Gantt when a
// project has an opted-in bigpicture_box_id. Rows/bars are plain server-rendered HTML (not built
// from a JSON blob client-side like GANTT_JS); only collapse/expand needs any client JS
// (PLANNING_COLLAPSE_JS).
// Fixed width per month: the Summary/Status column stays put while only the timeline scrolls
// horizontally (.planning-rscroll) once the months no longer fit — min-width:100% still stretches a
// short plan to the full available width.
const PLANNING_MONTH_PX = 110;
function renderPlanningSection({ visiblePlanningRows, hasPartialDatesPlanning, planningMonths, planningQuarterLines, pctDate, planningTstartIso }) {
  if (!visiblePlanningRows.length) {
    return `
  <div class="matrix-section planning-section">
    <div class="section-label"><span>Planning</span></div>
    <div style="padding:14px 20px;font-size:13px;color:#636369">No items in the configured BigPicture scope.</div>
  </div>`;
  }
  const monthsHtml = planningMonths.map(m => `<div class="gantt-mcell${m.q ? ' qs' : ''}">${m.q ? `<span class="gantt-mqtr">${esc(m.q)}</span>` : ''}<span class="gantt-mname">${esc(m.m)} ${esc(m.y)}</span></div>`).join('');
  const qtrLinesHtml = planningQuarterLines.map(d => `<div class="gantt-vline qtr" style="left:${pctDate(d).toFixed(2)}%"></div>`).join('');
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayLineHtml = `<div class="gantt-vline vtoday" style="left:${pctDate(todayIso).toFixed(2)}%"><span class="gantt-vlabel" style="color:#ED733D">today</span></div>`;

  const lrows = visiblePlanningRows.map(r => `
    <div class="planning-lrow" data-depth="${r.depth}">
      ${r.hasChildren ? `<span class="pl-caret">▾</span>` : `<span class="pl-caret-spacer"></span>`}
      <span class="pl-summary" style="padding-left:${r.depth * 16}px" title="${esc(r.summary)}">${esc(r.summary)}</span>
      <span class="pl-status st ${r.status}">${PLANNING_STATUS_LABEL[r.status] || r.status}</span>
    </div>`).join('');
  const rrows = visiblePlanningRows.map(r => `
    <div class="planning-row">${planningBarHtml(r, pctDate, planningTstartIso)}</div>`).join('');

  return `
  <div class="matrix-section planning-section">
    <div class="section-label">
      <span>Planning</span>
    </div>
    <div class="gantt-mobile-note">📊 The planning timeline needs a wider screen — view this report on a desktop or tablet to see it.</div>
    <div class="gantt-outer planning-outer">
      <div class="gantt-lcol planning-lcol" id="planning-lcol">
        <div class="gantt-lhdr planning-lhdr"><span class="pl-hdr-summary">Summary</span><span class="pl-hdr-status">Status</span></div>
        ${lrows}
      </div>
      <div class="planning-rscroll">
        <div class="gantt-rcol" style="width:${planningMonths.length * PLANNING_MONTH_PX}px">
          <div class="gantt-months">${monthsHtml}</div>
          <div class="gantt-body" id="planning-body">${qtrLinesHtml}${todayLineHtml}${rrows}</div>
        </div>
      </div>
    </div>
    <div class="gantt-legend">
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#A6D64D"></div>Done</div>
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#0050D5"></div>In Progress</div>
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#ED733D"></div>Blocked</div>
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#BEC0C6;border:1px dashed #C8CAD4"></div>To Start</div>
      ${hasPartialDatesPlanning ? '<div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:linear-gradient(to right,transparent,#87878C)"></div>Only one date known (hover for detail)</div>' : ''}
    </div>
  </div>`;
}

// Collapse/expand only (see FUNCTIONAL_RULES.md "Planning Light") — deliberately not persisted
// (resets on reload). Walks the left/right row lists in lockstep
// by index (both rendered from the exact same visiblePlanningRows array, in the same order, so
// their nth-child positions always line up) and hides every row deeper than the clicked one, up to
// the next row at the same depth or shallower.
function PLANNING_COLLAPSE_JS() {
  return `
(function(){
  var lrows=document.querySelectorAll('#planning-lcol .planning-lrow');
  var rrows=document.querySelectorAll('#planning-body .planning-row');
  document.querySelectorAll('.pl-caret').forEach(function(caret){
    caret.addEventListener('click',function(){
      var row=caret.closest('.planning-lrow');
      var idx=Array.prototype.indexOf.call(lrows,row);
      var depth=parseInt(row.getAttribute('data-depth'),10);
      var collapsed=caret.classList.toggle('pl-collapsed');
      caret.textContent=collapsed?'▸':'▾';
      var i=idx+1;
      while(i<lrows.length){
        var d=parseInt(lrows[i].getAttribute('data-depth'),10);
        if(d<=depth)break;
        lrows[i].style.display=collapsed?'none':'';
        if(rrows[i])rrows[i].style.display=collapsed?'none':'';
        i++;
      }
    });
  });
})();`;
}

function GANTT_JS(epics) {
  // The timeline's own start is always exactly 6 months before today — same rolling-window rule
  // ganttEpics is filtered by above (FUNCTIONAL_RULES.md "Planning / Gantt"), applied to the axis
  // itself rather than just the row list. It no longer extends back to cover an epic's own Start
  // date the way it briefly did (that was to fix a header/marker misalignment bug, not to show more
  // history) — an epic starting earlier than the floor still renders, its bar just runs off the
  // left edge instead of being traceable back to its exact start, which is the intended declutter.
  // Normalized to the 1st of the month so it lines up exactly with buildGanttMonths' own
  // month-column boundaries (a mid-month tstart would desync position 0% from the first column).
  const now = new Date();
  const tstart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));
  // Still a fixed date, not derived from `now` — unrelated to this change, but worth flagging: once
  // "today" gets within ~6 months of this, tstart would overtake it. Whoever bumps this later should
  // check tstart/tend don't invert.
  const tend   = new Date('2026-11-30');
  const ts = tstart.toISOString().slice(0, 10);
  const te = tend.toISOString().slice(0, 10);
  const { months, quarterLines } = buildGanttMonths(tstart, tend);

  return `
(function(){
  var lcol=document.getElementById('gantt-lcol'),months=document.getElementById('gantt-months'),body=document.getElementById('gantt-body');
  if(!lcol||!months||!body)return;
  var TSTART=new Date('${ts}'),TEND=new Date('${te}'),TTOTAL=TEND-TSTART;
  function pct(d){return Math.max(0,Math.min(100,(new Date(d)-TSTART)/TTOTAL*100));}
  var MONTHS=${JSON.stringify(months)};
  var TEAM_BG={NSE:'#0050D5',NSA:'#147DE8',NCC:'#000E9C',CLDAPI:'#4AB0F5',PUBM:'#636369',USRE:'#7BB73C',Manager:'#87878C'};
  var EPICS=${JSON.stringify(epics.map(e => ({ ...e, team: esc(e.team), key: esc(e.key), label: esc(e.label) })))};
  MONTHS.forEach(function(m){
    var c=document.createElement('div');c.className='gantt-mcell'+(m.q?' qs':'');
    if(m.q){var q=document.createElement('span');q.className='gantt-mqtr';q.textContent=m.q;c.appendChild(q);}
    var mn=document.createElement('span');mn.className='gantt-mname';mn.textContent=m.m+' '+m.y;c.appendChild(mn);
    months.appendChild(c);
  });
  ${JSON.stringify(quarterLines)}.forEach(function(d){
    var l=document.createElement('div');l.className='gantt-vline qtr';l.style.left=pct(d).toFixed(2)+'%';body.appendChild(l);
  });
  function mkV(cls,label,color,date){
    var v=document.createElement('div');v.className='gantt-vline '+cls;v.style.left=pct(date).toFixed(2)+'%';
    var sp=document.createElement('span');sp.className='gantt-vlabel';sp.style.color=color;sp.textContent=label;
    v.appendChild(sp);body.appendChild(v);
  }
  mkV('vtoday','today','#ED733D','${new Date().toISOString().slice(0,10)}');
  EPICS.forEach(function(e){
    var lr=document.createElement('div');lr.className='gantt-lrow';
    var bg=TEAM_BG[e.team]||'#636369',tx=(e.team==='CLDAPI')?'#00185E':'#fff';
    lr.innerHTML='<span class="g-team" style="background:'+bg+';color:'+tx+'">'+e.team+'</span>'
      +'<span class="g-key">'+e.key+'</span>'
      +'<span class="g-name" title="'+e.label+'">'+e.label+'</span>';
    lcol.appendChild(lr);
    var row=document.createElement('div');row.className='gantt-row';
    if(e.start&&e.end){
      var l=pct(e.start),w=Math.max(0.5,pct(e.end)-pct(e.start));
      var bar=document.createElement('div');
      bar.className='gantt-bar '+e.status;
      bar.style.left=l.toFixed(2)+'%';bar.style.width=w.toFixed(2)+'%';
      bar.title=e.key+' — '+e.label+'\\n'+e.start+' → '+e.end;
      row.appendChild(bar);
    }else if(e.end||e.start){
      // Only one endpoint known (e.g. an End date with no Start date — see
      // FUNCTIONAL_RULES.md "Planning / Gantt"). Still sorted correctly on whichever date it has.
      // A fixed-width bar anchored on the known date, fading to transparent toward the unknown
      // one, reads as "duration open-ended in that direction" — a point marker (tried first) read
      // instead as a precise one-day milestone, which is wrong: we don't know it's one day, we
      // just don't know the other end.
      var isEndOnly=!!e.end, PARTIAL_W=6;
      var bar=document.createElement('div');
      bar.className='gantt-bar '+e.status+' '+(isEndOnly?'fade-left':'fade-right');
      if(isEndOnly){
        var r=pct(e.end), l=Math.max(0,r-PARTIAL_W);
        bar.style.left=l.toFixed(2)+'%';bar.style.width=(r-l).toFixed(2)+'%';
      }else{
        var l=pct(e.start), r=Math.min(100,l+PARTIAL_W);
        bar.style.left=l.toFixed(2)+'%';bar.style.width=(r-l).toFixed(2)+'%';
      }
      bar.title=e.key+' — '+e.label+'\\n'+(isEndOnly?('No start date — ends '+e.end):('No end date — starts '+e.start));
      row.appendChild(bar);
    }else{
      var nd=document.createElement('span');nd.className='gantt-nodates';nd.textContent='No dates yet';
      row.appendChild(nd);
    }
    body.appendChild(row);
  });
})();`;
}

// ── Helpers ──────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// execSummary carries {{STRONG}}/{{EM}}/{{U}} placeholders (see confluence.js's
// stripTagsKeepEmphasis) for a PM's manual bold/italic/underline emphasis — escape everything
// else first (esc), THEN turn the placeholders into real tags, so nothing from Confluence except
// those specific markers can ever inject actual HTML into the report.
function escKeepEmphasis(s) {
  return esc(s)
    .replace(/\{\{STRONG\}\}/g, '<strong>').replace(/\{\{\/STRONG\}\}/g, '</strong>')
    .replace(/\{\{EM\}\}/g, '<em>').replace(/\{\{\/EM\}\}/g, '</em>')
    .replace(/\{\{U\}\}/g, '<u>').replace(/\{\{\/U\}\}/g, '</u>');
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function pct(n, total) { return total ? Math.round(n / total * 100) : 0; }

function isoWeekMonday(year, week) {
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  return mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function adjacentWeek(year, week, delta) {
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - dow + 1 + (week - 1 + delta) * 7);
  const y = mon.getFullYear();
  const d = new Date(mon); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  const w = 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
  return { year: d.getFullYear(), week: w, weekPad: String(w).padStart(2, '0') };
}

function currentIsoWeek() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
  return { year: d.getFullYear(), week };
}

// ── CSS ──────────────────────────────────────────────────────────

const CSS = `
  @font-face{font-family:'Source Sans Pro';font-weight:300;src:local('Source Sans Pro Light'),local('SourceSansPro-Light'),local('Source Sans 3 Light')}
  @font-face{font-family:'Source Sans Pro';font-weight:400;src:local('Source Sans Pro'),local('SourceSansPro-Regular'),local('Source Sans 3')}
  @font-face{font-family:'Source Sans Pro';font-weight:600;src:local('Source Sans Pro SemiBold'),local('SourceSansPro-SemiBold'),local('Source Sans 3 SemiBold')}
  @font-face{font-family:'Source Sans Pro';font-weight:700;src:local('Source Sans Pro Bold'),local('SourceSansPro-Bold'),local('Source Sans 3 Bold')}
  :root{--mb:#000E9C;--db:#00185E;--cobalt:#0050D5;--royal:#147DE8;--sky:#73E3FF;--yellow:#FFD124;--dyellow:#FFBB22;--orange:#ED733D;--dorange:#D85639;--green:#A6D64D;--dgr:#636369;--mgr:#87878C;--sgr:#BEC0C6;--lgr:#E5E7ED;--done-c:#4A7C1C;--done-bg:#EEF7E0;--done-s:#A6D64D;--prog-c:#0050D5;--prog-bg:#E8EFFF;--prog-s:#0050D5;--blk-c:#D85639;--blk-bg:#FEF0EE;--blk-s:#ED733D;--ts-c:#636369;--ts-bg:#F2F3F7;--ts-s:#BEC0C6;--sur:#FFFFFF;--gnd:#F3F4FA;--bd:#C8CAD4;--bd2:#E5E7ED;--tx:#00185E;--tx2:#636369;--tx3:#87878C;--f:'Source Sans Pro','Segoe UI',Arial,sans-serif;--fm:'Courier New',Courier,monospace;--r:2px}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--gnd);color:var(--tx);font-family:var(--f);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
  /* .week-nav/.week-arrow/.ref-week now live in app.css (shared with report-missing.ejs) — see
     the comment there. var(--bd) (#C8CAD4) as a border against the white page-header computes
     under 1.7:1, nowhere near the 3:1 non-text contrast minimum, which is why the arrows use
     var(--tx2) (~5.9:1) instead. */
  .backfill-notice{background:#fcf4d6;border:1px solid #f1c21b;color:var(--db);border-radius:var(--r);padding:9px 14px;font-size:13px;font-weight:600;margin-bottom:16px}
  .doc-section{background:var(--sur);border:1px solid var(--bd);border-top:3px solid var(--mb);border-radius:var(--r);margin-bottom:16px;overflow:hidden}
  .section-label{font-size:15px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mb);padding:11px 20px 10px;border-bottom:1px solid var(--bd2);background:var(--sur);display:flex;align-items:center;justify-content:space-between}
  .section-label .sl-right{color:var(--tx3);font-weight:400;letter-spacing:.04em}
  .exec-summary{padding:14px 20px;font-size:13px;color:var(--tx2);line-height:1.5;border-bottom:1px solid var(--bd2);font-style:italic}
  .exec-summary-readmore{display:none}
  .identity-grid{display:grid;grid-template-columns:repeat(4,1fr)}
  .identity-cell{padding:16px 20px;border-right:1px solid var(--bd2)}
  .identity-cell:last-child{border-right:none}
  .f-label{font-size:12.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:5px}
  .f-value{font-size:13px;font-weight:600;color:var(--tx);line-height:1.3}
  .f-value.mono{font-family:var(--fm);font-size:13px;font-weight:400;color:var(--cobalt)}
  .f-value-list{display:flex;flex-direction:column;gap:3px}
  .eta-delayed-note{font-size:12px;font-weight:600;color:var(--blk-c);margin-top:4px}
  .health{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .health-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .health.at-risk .health-dot{background:var(--orange)}.health.at-risk{color:var(--blk-c)}
  .health.on-track .health-dot{background:var(--done-s)}.health.on-track{color:var(--done-c)}
  /* A confirmed slip is a fact, not a projection like "At Risk" — a filled pill (borrowed from
     the risk-badge.high treatment) reads as more definite than the plain dot+text the other two
     states use, without needing a brand-new color. */
  .health.delayed{background:var(--blk-bg);color:var(--blk-c);border:1px solid #F4A17D;padding:3px 9px;border-radius:2px}
  .health.delayed .health-dot{display:none}
  .health-sub{margin-top:8px}
  .abc-grid{display:grid;grid-template-columns:repeat(3,1fr)}
  .doc-section--abc{border-top:1px solid var(--bd)}
  .abc-col{padding:18px 20px;border-right:1px solid rgba(0,0,0,.07)}
  .abc-col:last-child{border-right:none}
  .abc-col.ach{background:#EBF5DD}.abc-col.blk{background:#FDEEE9}.abc-col.clr{background:#E5EDFF}
  .abc-head{font-size:15px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid transparent}
  .abc-col.ach .abc-head{color:var(--done-c);border-color:var(--done-s)}
  .abc-col.blk .abc-head{color:var(--blk-c);border-color:var(--blk-s)}
  .abc-col.clr .abc-head{color:var(--cobalt);border-color:var(--cobalt)}
  .abc-items{list-style:none;display:flex;flex-direction:column;gap:8px}
  .abc-items li{font-size:13px;line-height:1.5;color:var(--tx2);padding-left:14px;position:relative}
  .abc-items li::before{content:'–';position:absolute;left:0;color:var(--tx3);font-size:12.5px;top:0}
  .ji{font-family:var(--fm);font-size:12.5px;color:var(--cobalt);background:var(--prog-bg);padding:1px 5px;border-radius:2px;text-decoration:none;margin-left:4px}
  .ji:hover{text-decoration:underline}
  .sr-grid{display:grid;grid-template-columns:1fr 2fr}
  .sr-left{border-right:1px solid var(--bd2)}
  .chart-pane{padding:24px;display:flex;flex-direction:column;align-items:center;gap:20px}
  .chart-legend{display:flex;flex-direction:column;gap:9px;width:100%}
  .leg-row{display:flex;align-items:center;gap:6px}
  .leg-strip{width:4px;height:16px;border-radius:1px;flex-shrink:0}
  .leg-strip.done{background:var(--done-s)}.leg-strip.prog{background:var(--prog-s)}.leg-strip.blk{background:var(--blk-s)}.leg-strip.ts{background:var(--ts-s)}
  .leg-lbl{font-size:15px;color:var(--tx2);flex:1;min-width:0}
  .leg-n{font-size:13px;font-weight:700;color:var(--tx);font-variant-numeric:tabular-nums;min-width:20px;text-align:right;flex-shrink:0}
  .leg-pct{font-size:12.5px;color:var(--tx3);min-width:30px;text-align:right;font-variant-numeric:tabular-nums;flex-shrink:0}
  .risk-list{padding:4px 0}
  .risk-item{display:flex;align-items:flex-start;gap:16px;padding:14px 20px;border-bottom:1px solid var(--bd2)}
  .risk-item:last-child{border-bottom:none}
  .risk-l{display:flex;flex-direction:column;gap:6px;align-items:flex-start;flex-shrink:0;min-width:80px}
  .risk-ref{font-family:var(--fm);font-size:12.5px;color:var(--tx3);letter-spacing:.05em}
  .risk-badge{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:3px 8px;border-radius:2px;white-space:nowrap}
  /* Extreme is a step above High on the Confluence risk matrix's own Yellow/Orange/Red scale, not
     a synonym for it — a filled solid badge (same idea as the Delayed health badge) reads as more
     severe than High's light-fill-plus-border treatment, instead of the two looking identical. */
  .risk-badge.extreme{background:var(--blk-c);color:#fff;border:1px solid var(--blk-c)}
  .risk-badge.high{background:var(--blk-bg);color:var(--blk-c);border:1px solid #F4A17D}
  .risk-badge.medium{background:#FFF6D6;color:var(--db);border:1px solid #FFE16D}
  .risk-badge.low{background:var(--ts-bg);color:var(--ts-c);border:1px solid var(--bd)}
  .risk-desc{font-size:13px;color:var(--tx);font-weight:600;line-height:1.4;margin-bottom:4px}
  .risk-mit{font-size:13px;color:var(--tx2);line-height:1.4}
  .risk-mit::before{content:'→ ';color:var(--tx3)}
  .matrix-section{background:var(--sur);border:1px solid var(--bd);border-top:3px solid var(--mb);border-radius:var(--r);margin-bottom:16px;overflow:hidden}
  .matrix-scroll{overflow-x:auto}
  .mx{width:100%;min-width:640px;border-collapse:collapse;font-size:13px}
  .mx thead th{background:var(--mb);color:#fff;padding:11px 16px;text-align:left;font-size:15px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .td-del{background:var(--gnd);border-right:1px solid var(--bd2);vertical-align:middle;padding:10px 16px;font-weight:700;font-size:13px;color:var(--tx);width:18%}
  .td-ws{padding:5px 12px;border-bottom:1px solid var(--bd2);vertical-align:middle;width:42%}
  .td-st{padding:5px 12px;border-bottom:1px solid var(--bd2);vertical-align:middle;width:18%}
  .cell-team{font-size:15px;color:var(--tx2);white-space:nowrap;padding:5px 12px;border-bottom:1px solid var(--bd2);vertical-align:middle;width:20%}
  .cell-enddate{font-size:13px;color:var(--tx2);white-space:nowrap;padding:5px 12px;border-bottom:1px solid var(--bd2);vertical-align:middle}
  .no-enddate{font-style:italic;color:var(--tx3)}
  tbody tr.del-first:not(:first-child) td{border-top:2px solid var(--mb)}
  tbody tr:last-child td{border-bottom:none}
  tbody tr:nth-child(even) td{background:var(--gnd)}
  tbody tr:hover td{background:#ECEEF8}
  tbody tr:hover .td-del{background:var(--gnd)!important}
  .ws-name{font-size:13px;color:var(--tx);line-height:1.3}
  .cell-n{display:flex;align-items:center}
  .st{font-size:13px;font-weight:700;letter-spacing:.02em;white-space:nowrap}
  .st.done{color:var(--done-c)}.st.prog{color:var(--prog-c)}.st.blk{color:var(--blk-c)}.st.ts{color:var(--ts-c)}
  .jtag{font-family:var(--fm);font-size:13.5px;color:var(--cobalt);background:var(--prog-bg);padding:2px 6px;border-radius:2px;text-decoration:none;display:inline-block}
  .jtag:hover{text-decoration:underline}
  .gantt-outer{display:flex;overflow-x:auto}
  .gantt-lcol{flex-shrink:0;width:228px;border-right:1px solid var(--bd2)}
  .gantt-lhdr{height:40px;background:var(--gnd);border-bottom:2px solid var(--bd)}
  .gantt-lrow{height:24px;display:flex;align-items:center;padding:0 8px 0 12px;border-bottom:1px solid var(--bd2);gap:5px;overflow:hidden}
  .gantt-lrow:last-child{border-bottom:none}
  .g-team{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:1px 5px;border-radius:2px;flex-shrink:0;line-height:1.5}
  .g-key{font-family:var(--fm);font-size:11.5px;color:var(--cobalt);white-space:nowrap;flex-shrink:0}
  .g-name{font-size:13.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .gantt-rcol{flex:1;min-width:680px}
  .gantt-months{height:40px;display:flex;border-bottom:2px solid var(--bd);background:var(--mb)}
  .gantt-mcell{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-right:1px solid rgba(255,255,255,.1);min-width:0}
  .gantt-mcell.qs{border-left:2px solid rgba(255,255,255,.25)}
  .gantt-mqtr{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45)}
  .gantt-mname{font-size:12.5px;color:rgba(255,255,255,.9);font-weight:600}
  .gantt-body{position:relative}
  .gantt-row{height:24px;border-bottom:1px solid var(--bd2);position:relative;overflow:visible}
  .gantt-row:nth-child(odd){background:var(--gnd)}
  .gantt-row:last-child{border-bottom:none}
  .gantt-bar{position:absolute;top:4px;height:16px;border-radius:2px;min-width:2px;cursor:default}
  .gantt-bar:hover{filter:brightness(1.15);z-index:4}
  .gantt-bar.done{background:var(--done-s)}.gantt-bar.prog{background:var(--cobalt)}.gantt-bar.ts{background:var(--sgr);border:1px dashed var(--bd)}.gantt-bar.blk{background:var(--blk-s)}
  .gantt-nodates{position:absolute;left:8px;top:0;bottom:0;display:flex;align-items:center;font-size:12px;font-style:italic;color:var(--tx3)}
  /* A bar built from only one known date (see the JS above) fades toward whichever side the
     missing date would be on — a mask-image works on top of any of the four status colors/border
     above without needing its own duplicate palette. */
  .gantt-bar.fade-left{-webkit-mask-image:linear-gradient(to right,transparent 0%,#000 100%);mask-image:linear-gradient(to right,transparent 0%,#000 100%)}
  .gantt-bar.fade-right{-webkit-mask-image:linear-gradient(to left,transparent 0%,#000 100%);mask-image:linear-gradient(to left,transparent 0%,#000 100%)}
  .gantt-vline{position:absolute;top:0;bottom:0;width:1px;pointer-events:none;z-index:2}
  .gantt-vline.qtr{background:var(--bd2);z-index:1}
  .gantt-vline.vtoday{background:var(--orange);z-index:3;width:2px}
  .gantt-vlabel{position:absolute;top:2px;left:3px;font-size:10px;font-weight:700;letter-spacing:.05em;white-space:nowrap;line-height:1}
  .gantt-legend{display:flex;gap:16px;padding:10px 14px;border-top:1px solid var(--bd2);background:var(--gnd)}
  .gantt-mobile-note{display:none}
  .gantt-leg-item{display:flex;align-items:center;gap:5px;font-size:13.5px;color:var(--tx2)}
  .gantt-leg-swatch{width:14px;height:10px;border-radius:1px;flex-shrink:0}
  /* Planning Light (see FUNCTIONAL_RULES.md) — reuses .gantt-outer/.gantt-rcol/.gantt-months/
     .gantt-body/.gantt-bar/.gantt-vline/.gantt-legend as-is; only the left label column becomes a
     wider 2-sub-column (Summary, Status) tree instead of the classic single team/key/name row. */
  .planning-lcol{width:340px}
  /* Only the timeline scrolls; the label column is outside the scroller, so it stays fixed. */
  .planning-outer{overflow-x:visible}
  .planning-rscroll{flex:1;min-width:0;overflow-x:auto}
  .planning-rscroll .gantt-rcol{min-width:100%}
  .planning-lhdr{display:flex;align-items:center;padding:0 12px;gap:8px}
  .pl-hdr-summary{flex:1;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)}
  .pl-hdr-status{width:84px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3)}
  .planning-lrow{height:24px;display:flex;align-items:center;padding:0 12px 0 8px;border-bottom:1px solid var(--bd2);gap:4px;overflow:visible}
  .planning-lrow:last-child{border-bottom:none}
  .pl-caret{width:14px;flex-shrink:0;cursor:pointer;font-size:10px;color:var(--tx3);text-align:center;user-select:none}
  .pl-caret-spacer{width:14px;flex-shrink:0}
  .pl-summary{flex:1;min-width:0;font-size:13.5px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pl-status{width:84px;flex-shrink:0;font-size:12px}
  .planning-row{height:24px;border-bottom:1px solid var(--bd2);position:relative;overflow:visible}
  .planning-row:nth-child(odd){background:var(--gnd)}
  .planning-row:last-child{border-bottom:none}
  .doc-footer{background:var(--mb);color:rgba(255,255,255,.4);text-align:center;padding:18px 32px;font-size:13.5px;letter-spacing:.04em}
  @media(max-width:700px){
    .identity-grid{grid-template-columns:1fr 1fr}
    .sr-grid{grid-template-columns:1fr}
    .abc-grid{grid-template-columns:1fr}
    .gantt-outer,.gantt-legend{display:none}
    .gantt-mobile-note{display:block;padding:20px;font-size:13px;color:var(--tx2);text-align:center}
    .exec-summary-clamped{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
    .exec-summary-readmore{display:block;text-align:center;font-size:12px;font-weight:700;color:var(--cobalt);padding:8px 20px;cursor:pointer;border-bottom:1px solid var(--bd2);background:var(--sur)}
  }
  @media(max-width:480px){.identity-grid{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  /* PDF export (puppeteer's page.pdf() emulates print media by default) and a browser's own
     Ctrl+P both use this — nothing here is actionable on a static page, so it's noise rather
     than a broken control. Purely cosmetic (visibility only) — never touches layout/page-break
     rules, which is exactly the kind of print-specific logic that caused the earlier PDF attempt
     to drift from the real page (see FUNCTIONAL_RULES.md "Report export"). Only the prev/next
     arrows are hidden here, not the whole .week-nav — .ref-week (the "W35 · 2026" label) is the
     one piece of that widget that's informational rather than an action, and must stay. */
  @media print{.week-arrow,.nav-user,a[href$="/pdf"],a[href$="/edit"],form[action$="/reports/generate"],.confluence-link-wrap{display:none!important}}
  /* A PDF can't scroll: squeeze the whole Planning Light timeline into the page width instead. */
  @media print{.planning-rscroll{overflow:visible}.planning-rscroll .gantt-rcol{width:auto!important;min-width:0}}
  /* Deliberately subtle — a secondary way to reach more detail, not a primary action next to
     Refresh/Export PDF. Underline-on-hover only, inherits the muted .page-sub text color rather
     than getting its own accent treatment. */
  .confluence-link{color:inherit;text-decoration:none;border-bottom:1px dotted var(--tx3)}
  .confluence-link:hover{color:var(--cobalt);border-color:var(--cobalt)}
`;

module.exports = generateReport;
module.exports.REPORTED_LEVEL_TYPES = REPORTED_LEVEL_TYPES;
