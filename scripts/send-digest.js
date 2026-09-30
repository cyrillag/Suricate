#!/usr/bin/env node
// Webex digest of "What's new" entries not sent yet (see whats-new.js / FUNCTIONAL_RULES.md
// "What's new"). Sent on demand, whenever a batch is worth announcing — no fixed schedule, so
// news isn't stale by the time it lands. Dry run by default: prints what would be posted and
// writes the image next to the entries for a look.
//
//   docker exec project-reports-app-app-1 node scripts/send-digest.js            # preview
//   docker exec project-reports-app-app-1 node scripts/send-digest.js --send     # post + mark sent
//   ... --only id1,id2      restrict to some entries
//   ... --mark-sent         record entries as sent without posting (e.g. announced by hand)
//   ... --test <space>      post to another space (e.g. your 1:1 with the bot) to see the real
//                           rendering first — nothing is marked as sent
//
// Env: DIGEST_WEBEX_BOT_TOKEN (a bot dedicated to this, member of the target space),
//      DIGEST_WEBEX_ROOM_ID (the space's API id, or the UUID from a webexteams://im?space=… link).
// Deliberately terse, as asked by the PMs: ONE message — a header, then each entry's title in bold
// and its one-line `short` description, no links — with ONE image. Webex only takes one file per
// message, so the entries' screenshots are stacked into a single image (each under its title),
// rendered with the same headless Chromium as the PDF export. Uploaded to Webex, so nothing needs
// to be public.
const fs = require('fs');
const path = require('path');
const whatsNew = require('../whats-new');

const args = process.argv.slice(2);
const testRoom = (() => { const i = args.indexOf('--test'); return i >= 0 ? args[i + 1] : null; })();
const send = args.includes('--send') || !!testRoom;
const markOnly = args.includes('--mark-sent');
const onlyArg = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const LANG = 'fr'; // the Project Manager Community space is French-speaking

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

const markdown = ['✨ **Quoi de neuf dans Suricate**', '', ...entries.map(e => `**${e.title[LANG]}**  \n${e.short[LANG]}`)].join('\n\n');
const shots = entries.filter(e => e.screenshot).map(e => ({ title: e.title[LANG], file: path.join(whatsNew.IMG_DIR, e.screenshot.file) }));

const missing = shots.filter(s => !fs.existsSync(s.file));
if (missing.length) {
  console.error('Missing screenshots (run scripts/capture-whats-new.js first):\n' + missing.map(s => '  ' + s.file).join('\n'));
  process.exit(1);
}

// The screenshots are already 2x captures; laid out at 1000 CSS px wide and rendered at 2x, they
// keep their full sharpness. Titles in the app's own navy/Source Sans stack, on white.
async function buildImage(outFile) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#FFFFFF;font-family:'Source Sans Pro','Segoe UI',Arial,sans-serif;width:1000px}
    .wrap{padding:28px 32px 8px}
    h2{font-size:24px;font-weight:700;color:#00185E;margin:0 0 12px}
    img{display:block;width:100%;height:auto;border:1px solid #E5E7ED;border-radius:2px;margin-bottom:32px}
  </style></head><body><div class="wrap">${shots.map(s => `<h2>${esc(s.title)}</h2><img src="file://${s.file}">`).join('')}</div></body></html>`;
  const tmpHtml = path.join(whatsNew.IMG_DIR, '.digest.html');
  fs.writeFileSync(tmpHtml, html);
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 2 });
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'load' });
    await page.screenshot({ path: outFile, fullPage: true });
  } finally {
    await browser.close();
    fs.unlinkSync(tmpHtml);
  }
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
  const imageFile = shots.length ? path.join(whatsNew.IMG_DIR, '.digest.png') : null;
  if (imageFile) await buildImage(imageFile);
  if (!send) {
    console.log('── DRY RUN — nothing posted. Add --send to post. ──\n');
    console.log(markdown);
    if (imageFile) console.log(`\n[+ 1 image: ${shots.map(s => s.title).join(' / ')} — written to ${path.relative(process.cwd(), imageFile)}]`);
    return;
  }
  const token = process.env.DIGEST_WEBEX_BOT_TOKEN;
  if (!token || !(testRoom || process.env.DIGEST_WEBEX_ROOM_ID)) throw new Error('DIGEST_WEBEX_BOT_TOKEN and DIGEST_WEBEX_ROOM_ID must be set.');
  const room = await resolveRoom(token, testRoom || process.env.DIGEST_WEBEX_ROOM_ID);

  const f = new FormData();
  f.append('roomId', room);
  f.append('markdown', markdown);
  if (imageFile) f.append('files', new Blob([fs.readFileSync(imageFile)], { type: 'image/png' }), 'suricate-nouveautes.png');
  await post(token, f);
  if (imageFile) fs.unlinkSync(imageFile);
  if (testRoom) {
    console.log(`TEST posted to ${testRoom}: 1 message${imageFile ? ' + 1 image' : ''}. Nothing marked as sent.`);
    return;
  }
  whatsNew.markDigestSent(entries.map(e => e.id));
  console.log(`Posted 1 message${imageFile ? ' + 1 image' : ''}. Marked as sent: ${entries.map(e => e.id).join(', ')}`);
})().catch(err => { console.error(err.message); process.exit(1); });
