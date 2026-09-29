const { mapStatus, BASE } = require('./jira');

function jiraIssueUrl(key) {
  return `${BASE}/browse/${key}`;
}

function jiraKeysJqlUrl(keys) {
  const jql = `key in (${keys.join(',')})`;
  return `${BASE}/issues/?jql=${encodeURIComponent(jql)}`;
}

const DUE_SOON_DAYS = 14;

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// Same 3-tier severity model as the "JIRA Cleanup" Webex bot (jira-hygiene-report, a sibling
// tool): "high" = an actual tracking problem, and time-sensitive (overdue, stalled, inconsistent
// dates) — worth naming individually. "upcoming" = not a problem at all, just a heads-up that an
// otherwise healthy epic is closing soon — kept apart so it never reads as something to fix.
// "medium" = real hygiene debt (missing metadata) — not urgent, fine to collapse into a count.
//
// Reuses jira.mapStatus's own done/in-progress/blocked/to-start buckets (the same ones driving
// the Deliverable matrix and health badge) rather than Jira's raw statusCategory — not cached in
// epics_cache, and this app already has its own considered status vocabulary (see
// FUNCTIONAL_RULES.md: waiting/paused → paused, on hold → blocked, etc.) that a generic
// new/indeterminate/done split would just re-derive worse.
// A Cancelled/Rejected epic is no longer real work — every check below skips it exactly like an
// already-Done one. mapStatus's own done/in-progress/blocked/to-start vocabulary (built for the
// Deliverable matrix's visible status pill) has no bucket for "irrelevant, stop checking" — a
// cancelled epic falls through to its default 'ts', which is how an overdue/never-started
// cancelled epic used to get flagged as a live tracking problem. Checked against Jira's raw
// status text instead, same idea as server.js's identical Cancelled exclusion for Planning,
// extended here to also cover Rejected.
const TERMINAL_STATUS = /^(cancel(l)?ed|rejected)$/i;

function checkEpic(epic, today) {
  const findings = [];
  const bucket = mapStatus(epic.status);
  const isDone = bucket === 'done' || TERMINAL_STATUS.test((epic.status || '').trim());
  const { start_date: start, end_date: end } = epic;

  if (!isDone) {
    if (!start) findings.push({ rule: 'no_start', severity: 'medium' });
    if (!end) findings.push({ rule: 'no_end', severity: 'medium' });
  }

  if (end && !isDone) {
    const diff = daysBetween(today, new Date(end));
    if (diff < 0) findings.push({ rule: 'overdue', severity: 'high', days: -diff, date: end });
    else if (diff <= DUE_SOON_DAYS) findings.push({ rule: 'due_soon', severity: 'upcoming', days: diff, date: end });
  }

  if (start && bucket === 'ts' && !isDone) {
    const diff = daysBetween(new Date(start), today);
    if (diff > 0) findings.push({ rule: 'not_started', severity: 'high', days: diff, date: start });
  }

  if (start && end && !isDone && new Date(start) > new Date(end)) {
    findings.push({ rule: 'date_inconsistent', severity: 'high', start, end });
  }

  return findings;
}

function contact(epic) {
  if (epic.assignee) return { name: epic.assignee, isReporter: false };
  if (epic.reporter) return { name: epic.reporter, isReporter: true };
  return null;
}

// epics: rows from epics_cache (already excludes Cancelled — see getPortfolioEpics/getChildEpics).
function runQualityCheck(epics, today = new Date()) {
  const high = [];
  const upcoming = [];
  const mediumByTeam = new Map(); // team -> { keys: Set<jira_key>, ruleCounts: Map<rule, number> }

  for (const epic of epics) {
    for (const f of checkEpic(epic, today)) {
      const item = { epic, contact: contact(epic), ...f };
      if (f.severity === 'high') high.push(item);
      else if (f.severity === 'upcoming') upcoming.push(item);
      else {
        const team = epic.team || '—';
        if (!mediumByTeam.has(team)) mediumByTeam.set(team, { keys: new Set(), ruleCounts: new Map() });
        const b = mediumByTeam.get(team);
        b.keys.add(epic.jira_key);
        b.ruleCounts.set(f.rule, (b.ruleCounts.get(f.rule) || 0) + 1);
      }
    }
  }

  return { high, upcoming, mediumByTeam, totalEpics: epics.length };
}

module.exports = { runQualityCheck, jiraIssueUrl, jiraKeysJqlUrl };
