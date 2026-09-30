// "What's new" — the single source of user-facing release notes (see FUNCTIONAL_RULES.md
// "What's new"). One entry per visible change in whats-new/entries.json, added in the same change
// as the feature itself; both the in-app "What's new" page (report creators) and the Webex digest
// (scripts/send-digest.js) read from here, so nothing is written twice.
const path = require('path');
const db = require('./db');

const DIR = path.join(__dirname, 'whats-new');
const IMG_DIR = path.join(DIR, 'img');
// Loaded once at startup: entries ship with the code that introduces the feature. The file's own
// order is the editorial one (most important first) — the digest keeps it; the page shows newest
// first (a stable sort, so same-day entries keep that editorial order).
const FILE_ORDER = require('./whats-new/entries.json');
const ENTRIES = FILE_ORDER.slice().sort((a, b) => b.date.localeCompare(a.date));

// Only people who own at least one project get the badge — the audience for functional news is
// report creators; readers mostly don't care (the page itself stays viewable by anyone).
function isCreator(userId) {
  return !!db.prepare('SELECT 1 FROM projects WHERE user_id=? LIMIT 1').get(userId);
}

// Entries newer than the user's last visit of the page. A creator who never opened it only sees
// the last 30 days as "new", not the whole backlog.
function unseenCount(userId) {
  const u = db.prepare('SELECT whats_new_seen_at FROM users WHERE id=?').get(userId);
  const since = (u && u.whats_new_seen_at) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return ENTRIES.filter(e => e.date > since).length;
}

function markSeen(userId) {
  const newest = ENTRIES.length ? ENTRIES[0].date : null;
  if (newest) db.prepare('UPDATE users SET whats_new_seen_at=? WHERE id=?').run(newest, userId);
}

// Entries never included in a sent digest yet (digest_sent), in the file's editorial order.
function pendingForDigest() {
  const sent = new Set(db.prepare('SELECT entry_id FROM digest_sent').all().map(r => r.entry_id));
  return FILE_ORDER.filter(e => !sent.has(e.id));
}

function markDigestSent(ids) {
  const ins = db.prepare('INSERT OR IGNORE INTO digest_sent(entry_id) VALUES(?)');
  ids.forEach(id => ins.run(id));
}

module.exports = { ENTRIES, IMG_DIR, isCreator, unseenCount, markSeen, pendingForDigest, markDigestSent };
