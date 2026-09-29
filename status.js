// This app's own status vocabulary (see jira.js's mapStatus for how raw Jira/Confluence statuses
// land in it) and the single roll-up rule shared by every level that combines statuses:
// workstream (several epics), deliverable (several workstreams) and Planning Light parents.
const STATUS_LABEL = { done: 'Done', prog: 'In Progress', paus: 'Paused', blk: 'Blocked', ts: 'To Start' };

// Done only if every child is; otherwise the most telling state wins: Blocked > In Progress >
// Paused > To Start. Paused ranks below In Progress (a deliverable with one paused and one active
// workstream is still moving) but above To Start (something did start).
function rollupStatus(statuses) {
  if (statuses.every(s => s === 'done')) return 'done';
  for (const s of ['blk', 'prog', 'paus']) if (statuses.includes(s)) return s;
  return 'ts';
}

module.exports = { STATUS_LABEL, rollupStatus };
