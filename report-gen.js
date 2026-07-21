function generateReport({ project, year, week, pmName, execSummary, highlights, risks, workstreams, epics, stats, health, isOwner }) {
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
          <span class="risk-ref">RIS_${String(i + 1).padStart(2, '0')}</span>
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
  const ganttEpics = epics;

  // Donut data
  const donutJSON = JSON.stringify([
    { v: stats.done, c: '#A6D64D' },
    { v: stats.prog, c: '#0050D5' },
    { v: stats.blk,  c: '#ED733D' },
    { v: stats.ts,   c: '#BEC0C6' }
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(project.name)} — Weekly Report ${weekStr}/${year}</title>
<link rel="icon" type="image/png" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${CSS}</style>
</head>
<body>
<header class="doc-header">
  <svg class="hdr-deco" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 80" preserveAspectRatio="none">
    <polygon points="500,0 500,80 240,80" fill="rgba(255,255,255,0.04)"/>
    <polygon points="500,0 500,50 370,0" fill="rgba(255,255,255,0.05)"/>
    <polygon points="450,0 500,80 500,55" fill="rgba(20,125,232,0.12)"/>
  </svg>
  <div class="doc-header-brand">
    <img src="/logo-white.png" height="32" alt="">
    <div class="brand-divider"></div>
    <div class="brand-ctx">
      <a class="back-link-hdr" href="/projects/${esc(project.slug)}">&#x2039; All reports</a>
      <span class="proj-name">${esc(project.name)}</span>
      <span class="brand-sub">Weekly Status Report</span>
    </div>
  </div>
  <div class="hdr-right">
    ${isOwner && isCurrentWeek ? `<form method="POST" action="/projects/${esc(project.slug)}/reports/generate" style="display:inline">
      <input type="hidden" name="week" value="${yearWeek}">
      <button type="submit" class="btn-export-pdf">↻ Refresh</button>
    </form>` : ''}
    <button type="button" class="btn-export-pdf" onclick="window.print()">⬇ Export PDF</button>
    <div>
      <div class="week-nav">
        <a class="week-arrow" href="/projects/${esc(project.slug)}/${prevW.year}-W${prevW.weekPad}" aria-label="Previous week">&#x2039;</a>
        <div class="ref-week">${weekStr} · ${year}</div>
        ${nextWeekNav}
      </div>
      <div class="ref-meta">${dateLabel} · ${esc(pmName || project.name)}</div>
    </div>
  </div>
</header>

<div class="doc-body">

  <div class="doc-section">
    <div class="section-label">Project identity</div>
    ${execSummary ? `<div class="exec-summary">${escKeepEmphasis(execSummary)}</div>` : ''}
    <div class="identity-grid">
      <div class="identity-cell"><div class="f-label">Project</div><div class="f-value">${esc(project.name)}</div></div>
      <div class="identity-cell"><div class="f-label">Project Manager</div><div class="f-value">${esc(pmName || '')}</div></div>
      <div class="identity-cell">
        <div class="f-label">Target ETA</div>
        <div class="f-value">${esc(project.eta || 'TBD')}</div>
        <div class="health ${health} health-sub"><div class="health-dot"></div>${health === 'at-risk' ? 'At Risk' : 'On Track'}</div>
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
          <th style="width:20%">Deliverable</th>
          <th style="width:42%">Workstream</th>
          <th style="width:20%">Team</th>
          <th style="width:18%">Status</th>
        </tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
  </div>

  ${ganttEpics.length ? `
  <div class="matrix-section">
    <div class="section-label">Planning — team epics</div>
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
      <div class="gantt-leg-item"><div class="gantt-leg-swatch" style="background:#BEC0C6;border:1px dashed #C8CAD4"></div>To Start</div>
    </div>
  </div>` : ''}

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
  // The animation may still be mid-flight (or the print dialog opened before it even started)
  // when the browser's native Ctrl+P/Export-PDF print pass fires — force the finished frame so
  // the PDF never captures a half-drawn or blank donut.
  window.addEventListener('beforeprint', function(){ draw(1); });
})();
${ganttEpics.length ? GANTT_JS(ganttEpics) : ''}
</script>
</body>
</html>`;
}

function GANTT_JS(epics) {
  const datedStarts = epics.map(e => e.start).filter(Boolean);
  const TSTART_DATE = datedStarts.length ? datedStarts.reduce((m, s) => s < m ? s : m) : '2025-09-01';
  const tstart = new Date(Math.min(new Date(TSTART_DATE), new Date('2025-09-01')));
  const tend   = new Date('2026-11-30');
  const ts = tstart.toISOString().slice(0, 10);
  const te = tend.toISOString().slice(0, 10);

  return `
(function(){
  var lcol=document.getElementById('gantt-lcol'),months=document.getElementById('gantt-months'),body=document.getElementById('gantt-body');
  if(!lcol||!months||!body)return;
  var TSTART=new Date('${ts}'),TEND=new Date('${te}'),TTOTAL=TEND-TSTART;
  function pct(d){return Math.max(0,Math.min(100,(new Date(d)-TSTART)/TTOTAL*100));}
  var MONTHS=[
    {m:'Sep',y:'25',q:'Q1 FY26'},{m:'Oct',y:'25',q:''},{m:'Nov',y:'25',q:''},
    {m:'Dec',y:'25',q:'Q2 FY26'},{m:'Jan',y:'26',q:''},{m:'Feb',y:'26',q:''},
    {m:'Mar',y:'26',q:'Q3 FY26'},{m:'Apr',y:'26',q:''},{m:'May',y:'26',q:''},
    {m:'Jun',y:'26',q:'Q4 FY26'},{m:'Jul',y:'26',q:''},{m:'Aug',y:'26',q:''},
    {m:'Sep',y:'26',q:'Q1 FY27'},{m:'Oct',y:'26',q:''},{m:'Nov',y:'26',q:''}
  ];
  var TEAM_BG={NSE:'#0050D5',NSA:'#147DE8',NCC:'#000E9C',CLDAPI:'#4AB0F5',PUBM:'#636369',USRE:'#7BB73C',Manager:'#87878C'};
  var EPICS=${JSON.stringify(epics.map(e => ({ ...e, team: esc(e.team), key: esc(e.key), label: esc(e.label) })))};
  MONTHS.forEach(function(m){
    var c=document.createElement('div');c.className='gantt-mcell'+(m.q?' qs':'');
    if(m.q){var q=document.createElement('span');q.className='gantt-mqtr';q.textContent=m.q;c.appendChild(q);}
    var mn=document.createElement('span');mn.className='gantt-mname';mn.textContent=m.m+' '+m.y;c.appendChild(mn);
    months.appendChild(c);
  });
  ['2025-12-01','2026-03-01','2026-06-01','2026-09-01'].forEach(function(d){
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
  .doc-header{background:var(--mb);color:#fff;padding:18px 40px;display:flex;align-items:center;justify-content:space-between;gap:20px;position:relative;overflow:hidden}
  .hdr-deco{position:absolute;right:0;top:0;width:50%;height:100%;pointer-events:none}
  .doc-header-brand{display:flex;align-items:center;position:relative;z-index:1}
  .brand-divider{width:1px;height:28px;background:rgba(255,255,255,.2);margin:0 18px;flex-shrink:0}
  .brand-ctx{display:flex;flex-direction:column;gap:4px}
  .proj-name{font-size:15px;font-weight:700;color:#fff;letter-spacing:.01em}
  .brand-sub{font-size:12.5px;color:rgba(255,255,255,.35);letter-spacing:.04em}
  .hdr-right{display:flex;align-items:center;gap:20px;flex-shrink:0;position:relative;z-index:1}
  /* Yellow is reserved for primary CTAs (see FUNCTIONAL_RULES.md brand section) — also gives
     this button real contrast against the navy header, unlike a translucent white fill that
     barely differs from the background it sits on. */
  .btn-export-pdf{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 12px;border-radius:var(--r);color:var(--db);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--yellow);border:1px solid var(--yellow);cursor:pointer;font-family:var(--f);transition:background .15s;white-space:nowrap}
  .btn-export-pdf:hover{background:var(--dyellow);border-color:var(--dyellow)}
  .back-link-hdr{display:inline-flex;align-items:center;gap:2px;color:rgba(255,255,255,.85);font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}
  .back-link-hdr:hover{color:#fff;text-decoration:underline}
  .week-nav{display:flex;align-items:center;gap:3px;justify-content:flex-end}
  /* A translucent-white fill this faint (.18/.28) reads as barely-there against the navy header —
     boosted so the button's own boundary is actually visible, not just its (already-legible)
     white glyph. */
  .week-arrow{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:var(--r);color:#fff;font-size:18px;line-height:1;text-decoration:none;background:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.5);transition:background .15s,border-color .15s;flex-shrink:0;user-select:none}
  .week-arrow:hover{background:rgba(255,255,255,.45);border-color:rgba(255,255,255,.7)}
  .week-arrow.week-arrow-disabled{color:rgba(255,255,255,.35);background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);cursor:default}
  .week-arrow.week-arrow-disabled:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)}
  .ref-week{font-family:var(--fm);font-size:23px;color:#fff;letter-spacing:-.5px;line-height:1;text-align:center;min-width:80px}
  .ref-meta{font-size:13.5px;color:rgba(255,255,255,.4);margin-top:4px;letter-spacing:.03em;text-align:right}
  .doc-body{max-width:1100px;margin:0 auto;padding:28px 32px 48px}
  .doc-section{background:var(--sur);border:1px solid var(--bd);border-top:3px solid var(--mb);border-radius:var(--r);margin-bottom:16px;overflow:hidden}
  .section-label{font-size:15px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mb);padding:11px 20px 10px;border-bottom:1px solid var(--bd2);background:var(--sur);display:flex;align-items:center;justify-content:space-between}
  .section-label .sl-right{color:var(--tx3);font-weight:400;letter-spacing:.04em}
  .exec-summary{padding:14px 20px;font-size:13px;color:var(--tx2);line-height:1.5;border-bottom:1px solid var(--bd2);font-style:italic}
  .identity-grid{display:grid;grid-template-columns:repeat(4,1fr)}
  .identity-cell{padding:16px 20px;border-right:1px solid var(--bd2)}
  .identity-cell:last-child{border-right:none}
  .f-label{font-size:12.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:5px}
  .f-value{font-size:13px;font-weight:600;color:var(--tx);line-height:1.3}
  .f-value.mono{font-family:var(--fm);font-size:13px;font-weight:400;color:var(--cobalt)}
  .health{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .health-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .health.at-risk .health-dot{background:var(--orange)}.health.at-risk{color:var(--blk-c)}
  .health.on-track .health-dot{background:var(--done-s)}.health.on-track{color:var(--done-c)}
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
  .abc-items li{font-size:13px;line-height:1.5;color:var(--tx2);padding-left:12px;position:relative}
  .abc-items li::before{content:'—';position:absolute;left:0;color:var(--tx3);font-size:12.5px;top:3px}
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
  .gantt-bar.done{background:var(--done-s)}.gantt-bar.prog{background:var(--cobalt)}.gantt-bar.ts{background:var(--sgr);border:1px dashed var(--bd)}
  .gantt-nodates{position:absolute;left:8px;top:0;bottom:0;display:flex;align-items:center;font-size:12px;font-style:italic;color:var(--tx3)}
  .gantt-vline{position:absolute;top:0;bottom:0;width:1px;pointer-events:none;z-index:2}
  .gantt-vline.qtr{background:var(--bd2);z-index:1}
  .gantt-vline.vtoday{background:var(--orange);z-index:3;width:2px}
  .gantt-vlabel{position:absolute;top:2px;left:3px;font-size:10px;font-weight:700;letter-spacing:.05em;white-space:nowrap;line-height:1}
  .gantt-legend{display:flex;gap:16px;padding:10px 14px;border-top:1px solid var(--bd2);background:var(--gnd)}
  .gantt-leg-item{display:flex;align-items:center;gap:5px;font-size:13.5px;color:var(--tx2)}
  .gantt-leg-swatch{width:14px;height:10px;border-radius:1px;flex-shrink:0}
  .doc-footer{background:var(--mb);color:rgba(255,255,255,.4);text-align:center;padding:18px 32px;font-size:13.5px;letter-spacing:.04em}
  @media(max-width:768px){.doc-header{padding:14px 16px}.brand-divider{display:none}.doc-body{padding:16px}.identity-grid{grid-template-columns:1fr 1fr}.sr-grid{grid-template-columns:1fr}.abc-grid{grid-template-columns:1fr}}
  /* Portrait, not landscape: a landscape A4 page has ~40% LESS usable height (only its short
     edge), so a vertically long report (many workstream/epic rows) needs MORE pages in landscape
     despite the extra width — the opposite of what "fewer pages" wants. Matrix/Gantt just get a
     bit more compressed horizontally instead; see the width-oriented rules below. */
  @page{size:A4 portrait;margin:8mm}
  @media print{
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
    body{background:#fff;font-size:11.5px}
    .doc-body{max-width:none;padding:8px 12px 14px}
    .btn-export-pdf,.back-link-hdr,.week-arrow,.hdr-deco{display:none!important}
    .doc-header{overflow:visible;padding:9px 16px}
    .matrix-scroll{overflow:visible}
    .doc-section,.matrix-section,.risk-item,.identity-cell,tr{break-inside:avoid;page-break-inside:avoid}
    .gantt-lrow,.gantt-row{break-inside:avoid;page-break-inside:avoid}

    /* Condensed spacing/sizing throughout — the matrix and Gantt repeat this per row across
       dozens of rows, so even small per-row savings compound into whole fewer pages. Screen
       styles are untouched; all of this is scoped to print only. */
    .doc-section{margin-bottom:6px}
    .matrix-section{margin-bottom:6px}
    .section-label{padding:5px 12px 5px;font-size:12.5px}
    .exec-summary{padding:6px 12px}
    .identity-cell{padding:6px 12px}
    .abc-col{padding:7px 12px}
    .abc-items{gap:3px}
    .abc-items li{font-size:11px}
    .chart-pane{padding:8px;gap:6px}
    #donut{width:80px;height:80px}
    .leg-row{gap:5px}
    .risk-item{padding:6px 12px;gap:8px}
    .risk-desc,.risk-mit{font-size:11.5px}
    .td-ws,.td-st,.cell-team{padding:2px 10px!important}
    .td-del{padding:4px 10px!important}
    .ws-name,.cell-team,.st{font-size:11.5px}
    .mx thead th{padding:5px 14px;font-size:12.5px}
    .g-team,.g-key,.g-name{font-size:10.5px;line-height:1.2}
    .g-team{padding:0 4px}

    /* The Gantt's right column is hard-pinned to a 680px minimum for screen/landscape use —
       unconstrained here so flex can actually shrink it to the portrait page width instead of
       silently overflowing past the right edge (previously: the Planning section got cut off
       rather than fitting, since overflow:visible alone doesn't shrink anything, it just stops
       clipping — the content still has to fit the box it's given). Bar/gridline positions are
       already percentage-based, so they rescale correctly at any container width. */
    .gantt-outer{overflow:hidden}
    .gantt-lcol{width:145px}
    .gantt-rcol{min-width:0}
    .gantt-lrow,.gantt-row{height:16px!important}
    .gantt-lhdr,.gantt-months{height:22px}
    .gantt-mqtr,.gantt-mname{line-height:1.1}
    .gantt-mqtr{font-size:8px}
    .gantt-mname{font-size:9.5px}
    .gantt-vlabel{font-size:8px}
  }
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

module.exports = generateReport;
