#!/usr/bin/env node
// Screenshots for "What's new" entries (whats-new/entries.json → screenshot {page, selector, file}),
// taken with the same headless Chromium the PDF export uses, from the real running app — so they
// always match what people actually see, with no manual cropping. Run inside the app container:
//
//   docker exec project-reports-app-preview-app-1 node scripts/capture-whats-new.js --as you@ovhcloud.com [--only <entry-id>]
//
// then copy whats-new/img/*.png out of the container and commit them with the entries.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const fetch = require('node-fetch');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const email = opt('--as');
const base = opt('--base') || 'http://localhost:3000';
const only = opt('--only');
if (!email) { console.error('Usage: capture-whats-new.js --as <email> [--base URL] [--only <entry-id>]'); process.exit(1); }

const entries = require('../whats-new/entries.json').filter(e => e.screenshot && (!only || e.id === only));
const outDir = path.join(__dirname, '..', 'whats-new', 'img');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  // Same login as a person (the app has no service login); the pages are visible to any user.
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', timeout: 30000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, returnTo: '/' }).toString()
  });
  const cookies = (res.headers.raw()['set-cookie'] || []).map(c => { const [pair] = c.split(';'); const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base }; });
  if (!cookies.length) throw new Error(`Login failed for ${email} (HTTP ${res.status})`);

  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // 2x for crisp images on high-density screens and in Webex.
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
    await page.setCookie(...cookies);
    for (const e of entries) {
      const { page: url, selector, file } = e.screenshot;
      await page.goto(base + url, { waitUntil: 'networkidle0', timeout: 60000 });
      const el = await page.waitForSelector(selector, { timeout: 15000 });
      await new Promise(r => setTimeout(r, 1500)); // let the donut/Gantt draw-in animations settle
      await el.screenshot({ path: path.join(outDir, file) });
      console.log(`✓ ${e.id} → whats-new/img/${file}`);
    }
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err.message); process.exit(1); });
