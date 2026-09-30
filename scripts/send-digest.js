#!/usr/bin/env node
// Webex digest of "What's new" entries not sent yet (see whats-new.js / FUNCTIONAL_RULES.md
// "What's new"). Sent on demand, whenever a batch is worth announcing — no fixed schedule, so
// news isn't stale by the time it lands. Dry run by default: prints exactly what would be posted.
//
//   docker exec project-reports-app-app-1 node scripts/send-digest.js            # preview
//   docker exec project-reports-app-app-1 node scripts/send-digest.js --send     # post + mark sent
//   ... --only id1,id2      restrict to some entries
//   ... --mark-sent         record entries as sent without posting (e.g. announced by hand)
//   ... --test <space>      post to another space (e.g. your 1:1 with the bot) to see the real
//                           rendering first — nothing is marked as sent
//
// Env: DIGEST_WEBEX_BOT_TOKEN (a bot dedicated to this, member of the target space),
//      DIGEST_WEBEX_ROOM_ID (the space's API id, or the UUID from a webexteams://im?space=… link),
//      SURICATE_PUBLIC_URL (base of the What's new link, default the prod URL).
// One post per entry — its screenshot, its title in bold and its one-line `short` description — the
// first post carrying a one-line header with the only link: the in-app What's new page. Chosen by the PMs after trying the
// alternatives: everything stacked into one image was too dense (lots of zooming), and a Webex
// card can't show our screenshots (Webex's cloud fetches card images itself and can't reach this
// internal server). Screenshots are uploaded to Webex, so nothing needs to be public.
const fs = require('fs');
const path = require('path');
const whatsNew = require('../whats-new');

const args = process.argv.slice(2);
const testRoom = (() => { const i = args.indexOf('--test'); return i >= 0 ? args[i + 1] : null; })();
const send = args.includes('--send') || !!testRoom;
const markOnly = args.includes('--mark-sent');
const onlyArg = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const LANG = 'fr'; // the Project Manager Community space is French-speaking
const BASE = (process.env.SURICATE_PUBLIC_URL || 'http://gw.lab.core.ovh.net:31621').replace(/\/$/, '');

// A webexteams://im?space=<uuid> link carries only the raw UUID; the API id is the base64 of a
// region-specific URI (ours is "ciscospark://urn:TEAM:eu-central-1_k/ROOM/<uuid>", not the US
// "ciscospark://us/ROOM/<uuid>" — guessing it failed with a 404). So a UUID is resolved among the
// spaces the bot actually belongs to, which also catches "the bot wasn't added to that space".
async function resolveRoom(token, raw) {
  if (!raw) return null;
  if (!/^[0-9a-f-]{36}$/i.test(raw)) return raw;
  const res = await fetch('https://webexapis.com/v1/rooms?max=1000', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Webex ${res.status} while listing the bot's spaces: ${(await res.text()).slice(0, 200)}`);
  const room = (await res.json()).items.find(r => Buffer.from(r.id, 'base64').toString().endsWith(`/ROOM/${raw.toLowerCase()}`));
  if (!room) throw new Error(`The bot isn't a member of space ${raw} — add it to the space first.`);
  return room.id;
}

let entries = whatsNew.pendingForDigest();
if (onlyArg) entries = entries.filter(e => onlyArg.includes(e.id));
if (!entries.length) { console.log('Nothing new to announce: every entry was already sent.'); process.exit(0); }

const noShort = entries.filter(e => !(e.short && e.short[LANG]));
if (noShort.length) { console.error(`Entries without a "short" ${LANG} description: ${noShort.map(e => e.id).join(', ')}`); process.exit(1); }

const messages = entries.map((e, i) => ({
  markdown: [i === 0 ? `✨ **Quoi de neuf dans Suricate** · [toutes les nouveautés](${BASE}/whats-new)` : null, `**${e.title[LANG]}**`, e.short[LANG]].filter(Boolean).join('  \n'),
  file: e.screenshot ? path.join(whatsNew.IMG_DIR, e.screenshot.file) : null
}));

const missing = messages.filter(m => m.file && !fs.existsSync(m.file));
if (missing.length) {
  console.error('Missing screenshots (run scripts/capture-whats-new.js first):\n' + missing.map(m => '  ' + m.file).join('\n'));
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
    console.log(`── DRY RUN (${messages.length} post${messages.length > 1 ? 's' : ''}) — nothing posted. Add --send to post. ──`);
    messages.forEach(m => console.log(`\n${m.file ? `[📸 ${path.basename(m.file)}]\n` : ''}${m.markdown}`));
    return;
  }
  const token = process.env.DIGEST_WEBEX_BOT_TOKEN;
  if (!token || !(testRoom || process.env.DIGEST_WEBEX_ROOM_ID)) throw new Error('DIGEST_WEBEX_BOT_TOKEN and DIGEST_WEBEX_ROOM_ID must be set.');
  const room = await resolveRoom(token, testRoom || process.env.DIGEST_WEBEX_ROOM_ID);

  for (const m of messages) {
    const f = new FormData();
    f.append('roomId', room);
    f.append('markdown', m.markdown);
    if (m.file) f.append('files', new Blob([fs.readFileSync(m.file)], { type: 'image/png' }), path.basename(m.file));
    await post(token, f);
  }
  if (testRoom) {
    console.log(`TEST posted to ${testRoom}: ${messages.length} post(s). Nothing marked as sent.`);
    return;
  }
  whatsNew.markDigestSent(entries.map(e => e.id));
  console.log(`Posted ${messages.length} post(s). Marked as sent: ${entries.map(e => e.id).join(', ')}`);
})().catch(err => { console.error(err.message); process.exit(1); });
