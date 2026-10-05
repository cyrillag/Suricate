const { mapStatus, BASE } = require('./jira');

function jiraIssueUrl(key) {
  return `${BASE}/browse/${key}`;
}

const DUE_THIS_WEEK_DAYS = 7;
const DUE_SOON_DAYS = 14;

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// Two groups, not a severity ladder (2026-10, reworked from an earlier high/medium split
// after user feedback: a missing start/end date is just as real a tracking problem as an
// overdue epic — collapsing it into a lesser, count-only tier made it read as less
// important, which isn't the point):
//
// - ANOMALIES: something is actually wrong — overdue, not started despite a past start
//   date, inconsistent dates, or a missing start/end date. All five rules are listed
//   individually, with equal weight, in one table. Missing assignee was tried as a sixth
//   rule, dropped, reinstated, then dropped again for good (all in 2026-10) — a missing
//   assignee isn't itself a tracking problem; back in sync with the sibling Webex bot
//   (jira-hygiene-report), which never had this rule.
// - Due-soon ("this week" / "next 2 weeks"): not an anomaly at all — a perfectly healthy
//   epic lands here purely because its end date is close. Kept in its own section, for
//   planning vigilance, not tracking hygiene.
//
// Reuses jira.mapStatus's own done/in-progress/paused/blocked/to-start buckets (the same
// ones driving the Deliverable matrix and health badge) rather than Jira's raw
// statusCategory — not cached in epics_cache, and this app already has its own considered
// status vocabulary (see FUNCTIONAL_RULES.md: waiting/paused -> paused, on hold -> blocked)
// that a generic new/indeterminate/done split would just re-derive worse.
//
// A Cancelled/Rejected epic is no longer real work — every check below skips it exactly
// like an already-Done one. mapStatus has no bucket for "irrelevant, stop checking" (falls
// through to 'ts'), so this is checked against Jira's raw status text instead, same idea as
// server.js's identical Cancelled exclusion for Planning, extended here to also cover
// Rejected.
const TERMINAL_STATUS = /^(cancel(l)?ed|rejected)$/i;

function checkEpic(epic, today) {
  const findings = [];
  const bucket = mapStatus(epic.status);
  const isDone = bucket === 'done' || TERMINAL_STATUS.test((epic.status || '').trim());
  const { start_date: start, end_date: end } = epic;

  if (!isDone) {
    if (!start) findings.push({ rule: 'no_start' });
    if (!end) findings.push({ rule: 'no_end' });
  }

  if (end && !isDone) {
    const diff = daysBetween(today, new Date(end));
    // Direct, not just a date delta: name the actual contradiction (end date in the past,
    // yet the epic is still in an active status) rather than stating the date alone and
    // leaving the reader to connect it to the status shown elsewhere on the row.
    if (diff < 0) findings.push({ rule: 'overdue', days: -diff, date: end, status: epic.status });
    // Split in two: "this week" is its own, more urgent tier than the general 2-week
    // heads-up — a PM scanning for what needs attention before Friday's status check
    // shouldn't have to pick it out of everything closing in the next 14 days.
    else if (diff <= DUE_THIS_WEEK_DAYS) findings.push({ rule: 'due_this_week', days: diff, date: end });
    else if (diff <= DUE_SOON_DAYS) findings.push({ rule: 'due_soon', days: diff, date: end });
  }

  if (start && bucket === 'ts' && !isDone) {
    const diff = daysBetween(new Date(start), today);
    if (diff > 0) findings.push({ rule: 'not_started', days: diff, date: start, status: epic.status });
  }

  if (start && end && !isDone && new Date(start) > new Date(end)) {
    findings.push({ rule: 'date_inconsistent', start, end });
  }

  return findings;
}

function contact(epic) {
  if (epic.assignee) return { name: epic.assignee, isReporter: false };
  if (epic.reporter) return { name: epic.reporter, isReporter: true };
  return null;
}

const ANOMALY_RULES = ['overdue', 'not_started', 'date_inconsistent', 'no_start', 'no_end'];
const ANOMALY_RULE_SET = new Set(ANOMALY_RULES);
const RULE_RANK = new Map(ANOMALY_RULES.map((r, i) => [r, i]));

function byTeamThenKey(a, b) {
  return (a.epic.team || '').localeCompare(b.epic.team || '') || a.epic.jira_key.localeCompare(b.epic.jira_key);
}

// epics: rows from epics_cache (already excludes Cancelled — see getPortfolioEpics/getChildEpics).
// Every list is flat (not grouped by team in JS) — the view renders "Team" as a real column
// and filters client-side, rather than grouping rows server-side (2026-10: a prior version
// grouped by team with sub-header rows; a real filterable column serves the same scan need
// without hiding anything behind a collapsed group).
function runQualityCheck(epics, today = new Date()) {
  const anomalies = [];
  const thisWeek = [];
  const upcoming = [];
  const teams = new Set();
  const assignees = new Set(); // real names only; "unassigned" is a separate flag, not a name
  const rulesSeen = new Set();
  let hasUnassigned = false;

  for (const epic of epics) {
    const findings = checkEpic(epic, today);
    if (!findings.length) continue;
    teams.add(epic.team || '—');
    if (epic.assignee) assignees.add(epic.assignee); else hasUnassigned = true;

    // One row per epic, not per finding: an epic missing both its start and end date used to
    // produce two near-identical rows (same team/epic/contact, differing only by a small
    // badge in the middle column) — easy to scan past the second one and conclude only the
    // first problem exists (2026-10, user-reported: an epic missing both dates was reported
    // as having "only" a missing start date). All of an epic's anomaly findings are now
    // grouped onto one row, each with its own badge, ordered by RULE_RANK (contradictions
    // before missing fields) regardless of the order checkEpic found them in.
    const anomalyFindings = findings
      .filter(f => ANOMALY_RULE_SET.has(f.rule))
      .sort((a, b) => RULE_RANK.get(a.rule) - RULE_RANK.get(b.rule));
    if (anomalyFindings.length) {
      anomalyFindings.forEach(f => rulesSeen.add(f.rule));
      anomalies.push({ epic, contact: contact(epic), findings: anomalyFindings });
    }

    const due = findings.find(f => f.rule === 'due_this_week' || f.rule === 'due_soon');
    if (due) {
      const item = { epic, contact: contact(epic), ...due };
      if (due.rule === 'due_this_week') thisWeek.push(item);
      else upcoming.push(item);
    }
  }

  anomalies.sort(byTeamThenKey);
  thisWeek.sort(byTeamThenKey);
  upcoming.sort(byTeamThenKey);

  return {
    anomalies,
    thisWeek,
    upcoming,
    teams: [...teams].sort((a, b) => a.localeCompare(b)),
    assignees: [...assignees].sort((a, b) => a.localeCompare(b)),
    hasUnassigned,
    // Fixed, meaningful order (contradiction rules first, then missing-field ones) rather
    // than alphabetical — ANOMALY_RULES is already declared in that order.
    rules: ANOMALY_RULES.filter(r => rulesSeen.has(r)),
    totalEpics: epics.length,
  };
}

module.exports = { runQualityCheck, jiraIssueUrl };
