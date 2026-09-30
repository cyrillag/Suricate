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
// Deliberately terse, as asked by the PMs: ONE message with ONE image in which every entry reads
// as its own block — screenshot, then title, then one-line `short` description — so each capture
// sits right next to the text explaining it. Webex takes one file per message and can't interleave
// text and images, hence the text living in the image; stacking bare screenshots with the text in
// the message instead read as a montage of isolated pieces. The message text itself is just the
// header and the list of titles (for notifications and Webex search). No links. Rendered with the
// PDF export's headless Chromium; uploaded to Webex, so nothing needs to be public.
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

const markdown = `✨ **Quoi de neuf dans Suricate** — ${entries.map(e => e.title[LANG]).join(' · ')}`;
const blocks = entries.map(e => ({ title: e.title[LANG], short: e.short[LANG], file: e.screenshot ? path.join(whatsNew.IMG_DIR, e.screenshot.file) : null }));
const shots = blocks.filter(b => b.file);

const missing = shots.filter(s => !fs.existsSync(s.file));
if (missing.length) {
  console.error('Missing screenshots (run scripts/capture-whats-new.js first):\n' + missing.map(s => '  ' + s.file).join('\n'));
  process.exit(1);
}

// One block per entry: screenshot (if any), title, one-line description, blocks separated by a
// rule. Screenshots are already 2x captures; laid out at 1000 CSS px and rendered at 2x they keep
// their sharpness. App colours and font stack (navy titles, grey text) on white, under a header.
async function buildImage(outFile) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#FFFFFF;font-family:'Source Sans Pro','Segoe UI',Arial,sans-serif;width:1000px}
    .head{background:#000E9C;color:#FFFFFF;padding:22px 32px;font-size:26px;font-weight:700;letter-spacing:.01em}
    .wrap{padding:8px 32px 4px}
    .block{padding:28px 0;border-bottom:1px solid #E5E7ED}
    .block:last-child{border-bottom:none}
    img{display:block;width:100%;height:auto;border:1px solid #E5E7ED;border-radius:2px;margin-bottom:16px}
    h2{font-size:24px;font-weight:700;color:#00185E;margin:0 0 6px}
    p{font-size:19px;line-height:1.45;color:#3F3F46;margin:0}
  </style></head><body><div class="head">Quoi de neuf dans Suricate</div><div class="wrap">${blocks.map(b => `<div class="block">${b.file ? `<img src="file://${b.file}">` : ''}<h2>${esc(b.title)}</h2><p>${esc(b.short)}</p></div>`).join('')}</div></body></html>`;
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
  const imageFile = path.join(whatsNew.IMG_DIR, '.digest.png');
  await buildImage(imageFile);
  if (!send) {
    console.log('── DRY RUN — nothing posted. Add --send to post. ──\n');
    console.log(markdown);
    console.log(`\n[+ 1 image, ${blocks.length} blocks (${shots.length} with a screenshot) — written to ${path.relative(process.cwd(), imageFile)}]`);
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
