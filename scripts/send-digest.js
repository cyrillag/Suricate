#!/usr/bin/env node
// Webex digest of "What's new" entries not sent yet (see whats-new.js / FUNCTIONAL_RULES.md
// "What's new"). Sent on demand, whenever a batch is worth announcing — no fixed schedule, so
// news isn't stale by the time it lands. Dry run by default: prints exactly what would be posted.
//
//   docker exec project-reports-app-app-1 node scripts/send-digest.js            # preview
//   docker exec project-reports-app-app-1 node scripts/send-digest.js --send     # post + mark sent
//   ... --only id1,id2      restrict to some entries
//   ... --mark-sent         record entries as sent without posting (e.g. announced by hand)
//
// Env: DIGEST_WEBEX_BOT_TOKEN (a bot dedicated to this, member of the target space),
//      DIGEST_WEBEX_ROOM_ID (the space's API id, or the UUID from a webexteams://im?space=… link),
//      SURICATE_PUBLIC_URL (base for links, default the prod URL).
// Posts one message with every entry, then each screenshot as a reply in its thread (Webex
// attaches one file per message) — files are uploaded to Webex, so nothing needs to be public.
const fs = require('fs');
const path = require('path');
const whatsNew = require('../whats-new');

const args = process.argv.slice(2);
const send = args.includes('--send');
const markOnly = args.includes('--mark-sent');
const onlyArg = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const BASE = (process.env.SURICATE_PUBLIC_URL || 'http://gw.lab.core.ovh.net:31621').replace(/\/$/, '');
const LANG = 'fr'; // the Project Manager Community space is French-speaking

// A webexteams://im?space=<uuid> link carries the raw UUID; the API wants the base64 of its
// "ciscospark://us/ROOM/<uuid>" form.
function roomId(raw) {
  if (!raw) return null;
  return /^[0-9a-f-]{36}$/i.test(raw) ? Buffer.from(`ciscospark://us/ROOM/${raw}`).toString('base64') : raw;
}

let entries = whatsNew.pendingForDigest();
if (onlyArg) entries = entries.filter(e => onlyArg.includes(e.id));
if (!entries.length) { console.log('Nothing new to announce: every entry was already sent.'); process.exit(0); }

const fmtDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const main = [
  '### ✨ Quoi de neuf dans Suricate',
  '',
  ...entries.flatMap(e => [
    `**${e.title[LANG]}**${e.audience === 'creators' ? ' _(créateurs de rapports)_' : ''}`,
    e.body[LANG],
    e.link ? `[→ Voir dans Suricate](${BASE}${e.link})` : '',
    ''
  ]).filter((l, i, a) => l !== '' || a[i - 1] !== ''),
  `Toutes les nouveautés, avec captures : ${BASE}/whats-new`
].join('\n');
const shots = entries.filter(e => e.screenshot).map(e => ({
  entry: e, file: path.join(whatsNew.IMG_DIR, e.screenshot.file), caption: `📸 **${e.title[LANG]}**`
}));

const missing = shots.filter(s => !fs.existsSync(s.file));
if (missing.length) {
  console.error('Missing screenshots (run scripts/capture-whats-new.js first):\n' + missing.map(s => '  ' + s.file).join('\n'));
  process.exit(1);
}

async function post(token, body) {
  const res = await fetch('https://webexapis.com/v1/messages', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  if (!res.ok) throw new Error(`Webex ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

(async () => {
  if (markOnly) {
    whatsNew.markDigestSent(entries.map(e => e.id));
    console.log(`Marked as sent without posting: ${entries.map(e => e.id).join(', ')}`);
    return;
  }
  if (!send) {
    console.log(`── DRY RUN (${entries.length} entr${entries.length > 1 ? 'ies' : 'y'}) — nothing posted. Add --send to post. ──\n`);
    console.log(main);
    console.log(`\n── then ${shots.length} thread repl${shots.length > 1 ? 'ies' : 'y'}, one screenshot each:`);
    shots.forEach(s => console.log(`  ${s.caption}  ←  ${path.relative(process.cwd(), s.file)}`));
    return;
  }
  const token = process.env.DIGEST_WEBEX_BOT_TOKEN;
  const room = roomId(process.env.DIGEST_WEBEX_ROOM_ID);
  if (!token || !room) throw new Error('DIGEST_WEBEX_BOT_TOKEN and DIGEST_WEBEX_ROOM_ID must be set.');

  const parent = await post(token, (() => { const f = new FormData(); f.append('roomId', room); f.append('markdown', main); return f; })());
  for (const s of shots) {
    const f = new FormData();
    f.append('roomId', room);
    f.append('parentId', parent.id);
    f.append('markdown', s.caption);
    f.append('files', new Blob([fs.readFileSync(s.file)], { type: 'image/png' }), path.basename(s.file));
    await post(token, f);
  }
  whatsNew.markDigestSent(entries.map(e => e.id));
  console.log(`Posted: 1 message + ${shots.length} screenshot(s). Marked as sent: ${entries.map(e => e.id).join(', ')}`);
})().catch(err => { console.error(err.message); process.exit(1); });
