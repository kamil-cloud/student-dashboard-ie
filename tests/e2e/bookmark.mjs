// End-to-end test of the website's Blackboard sync without the extension (the "Sync Student
// Dashboard" bookmark), in the engines of Chrome, Safari (WebKit) and Firefox, against the fake
// Blackboard, signed in to the fake Supabase project (the dashboard is saved in the database).
// A bookmark click is simulated by running the bookmark's code in the Blackboard tab.
// Usage:  node scripts/build.mjs --test-hosts && node tests/e2e/bookmark.mjs
// Env:    ENGINES=chromium,webkit,firefox   SDW_E2E_DIR=…   HEADED=1
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// PW_CORE / WEBKIT_PATH: use another Playwright and WebKit build (WebKit builds need a recent macOS).
const { chromium, firefox, webkit } = await import(process.env.PW_CORE || 'playwright-core');
import { startFakeBlackboard, startStatic, startTestSupabase } from './servers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'dist', 'web');
const WORK = fs.mkdtempSync(path.join(process.env.SDW_E2E_DIR || os.tmpdir(), 'sdw-bookmark-'));
const ENGINES = (process.env.ENGINES || 'chromium,webkit,firefox').split(',').map((s) => s.trim());
const LAUNCHERS = { chromium, webkit, firefox };
const headless = !process.env.HEADED;

let failed = 0;
let passed = 0;

async function eventually(fn, msg, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out: ${msg}${last ? ` (${last.message})` : ''}`);
}

let db;
let account;
/** The signed-in student's dashboard as saved in the database (null before the first save). */
const readData = async () => {
  const id = [...db.users.values()].find((u) => u.email === account)?.id;
  const row = db.tables.dashboards.find((r) => r.user_id === id);
  return row ? structuredClone(row.data) : null;
};

/** Create an account on the website and open the setup wizard. */
async function signUpAndSetup(p, siteUrl, email) {
  await p.goto(`${siteUrl}/signup`);
  await p.getByTestId('signup-email').fill(email);
  await p.getByTestId('signup-password').fill('Test-password-1');
  await p.getByTestId('signup-submit').click();
  await p.getByTestId('core-input').waitFor();
  await p.goto(`${siteUrl}/app#/setup`);
}

/** "Click" the bookmark: run its code in that tab, as the browser does for a javascript: bookmark. */
const clickBookmark = (tab, code) => tab.evaluate(decodeURIComponent(code.slice('javascript:'.length)));
const toast = (p, text) => p.locator('.toast', { hasText: text }).first();

async function run(engine) {
  console.log(`\n${engine}`);
  let browser;
  try {
    browser = await LAUNCHERS[engine].launch({ headless, ...(engine === 'webkit' && process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {}) });
  } catch (err) {
    console.log(`  ⚠ ${engine} cannot start on this machine — skipped (${String(err.message).split('\n')[0].slice(0, 80)})`);
    return;
  }
  const fake = await startFakeBlackboard({ renderDelayMs: 0 });
  const site = await startStatic(WEB);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(`${p.url().slice(0, 50)}: ${e.message}`)));
  let page;
  let code = '';
  let bbTab;
  const step = async (name, fn) => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`);
      await page?.screenshot({ path: path.join(WORK, `FAIL-${engine}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`) }).catch(() => {});
      throw err;
    }
  };

  try {
    await step('first connection: bookmark, Blackboard tab, everything imported', async () => {
      page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`dashboard: ${e.message}`));
      account = `bookmark-${engine}-${Date.now()}@example.com`;
      await signUpAndSetup(page, site.url, account);
      await page.getByTestId('wz-start').click();
      await page.getByTestId('wz-uni-other').click();
      await page.getByTestId('wz-next').click();
      await page.getByTestId('bb-bookmark').waitFor();
      await page.getByTestId('bb-host').fill(fake.host);
      code = await page.getByTestId('bm-link').getAttribute('href');
      assert(code?.startsWith('javascript:'), 'the bookmark is a javascript: link');
      await page.screenshot({ path: path.join(WORK, `${engine}-1-bookmark-step.png`) });
      [bbTab] = await Promise.all([context.waitForEvent('page'), page.getByTestId('bb-open').click()]);
      await bbTab.locator('#sign-in').click();
      await bbTab.locator('#courses').waitFor();
      await clickBookmark(bbTab, code);
      await bbTab.getByText('Blackboard connected').waitFor({ timeout: 20000 });
      await page.getByTestId('bb-done').waitFor({ timeout: 20000 });
      await page.getByTestId('bb-continue').click();
      await page.getByTestId('wz-next').click();
      await page.getByTestId('wz-finish').click();
      await page.locator('.app').waitFor();
      let d;
      await eventually(async () => (d = await readData())?.courses.length >= 4, 'dashboard saved');
      assert(d.courses.length >= 4, `courses imported (${d.courses.length})`);
      assert(d.items.some((i) => i.score !== null && i.score !== undefined), 'grades imported');
      assert(d.courses.some((c) => c.sessions.length > 0), 'class sessions imported');
      assert(!fake.bb.state.requests.some((r) => r.includes('launchPlacement')), 'no syllabus window without the extension');
      assert.equal(d.blackboard.host, fake.host);
    });

    await step('"Sync now" syncs right away while the Blackboard tab is still linked', async () => {
      fake.bb.addGrade('_101_1', { columnId: '_9010_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 4.5 }, lastRelevantDate: new Date().toISOString() });
      await page.getByTestId('sync-chip').click();
      await toast(page, 'Blackboard synced').waitFor({ timeout: 20000 });
      assert.equal(await page.getByTestId('bm-prompt').count(), 0, 'no need for the bookmark');
      await eventually(async () => (await readData()).items.some((i) => i.score === 4.5), 'new grade saved');
    });

    await step('"Sync now" asks for the bookmark once Blackboard is closed, then syncs through it', async () => {
      await bbTab.close();
      fake.bb.moveDue('_102_1', '_9102_1', 25);
      const dueOf = async (p) => (await readData()).items.find((i) => i.source?.id?.endsWith(':_9102_1'))?.dueDate;
      const before = await dueOf(page);
      assert(before, 'the deadline was imported');
      await page.getByTestId('sync-chip').click();
      await page.getByTestId('bm-prompt').waitFor();
      [bbTab] = await Promise.all([context.waitForEvent('page'), page.getByTestId('bm-prompt-open').click()]);
      await bbTab.locator('#courses').waitFor();
      await clickBookmark(bbTab, code);
      await toast(page, 'Blackboard synced').waitFor({ timeout: 20000 });
      await bbTab.getByText('Student Dashboard synced').waitFor();
      assert.equal(await page.getByTestId('bm-prompt').count(), 0, 'the prompt closed');
      await eventually(async () => (await dueOf(page)) !== before, 'moved deadline saved');
    });

    await step('clicked on a Blackboard tab opened by hand: a dashboard tab opens and syncs', async () => {
      await bbTab.close();
      fake.bb.addGrade('_101_1', { columnId: '_9010_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 5 }, lastRelevantDate: new Date().toISOString() });
      const own = await context.newPage();
      await own.goto(`${fake.host}/ultra/course`);
      await own.locator('#courses').waitFor();
      const [fresh] = await Promise.all([context.waitForEvent('page'), clickBookmark(own, code)]);
      await toast(fresh, 'Blackboard synced').waitFor({ timeout: 25000 });
      await eventually(async () => (await readData()).items.some((i) => i.score === 5), 'changed grade saved');
      // The older dashboard tab stepped aside instead of overwriting.
      await page.getByTestId('locked-screen').waitFor();
      page = fresh;
      await own.close();
    });

    await step('a bookmark clicked on another site is not trusted', async () => {
      const count = (await readData()).items.length;
      const other = await context.newPage();
      await other.goto(`${fake.toolOrigin}/`);
      const [tab] = await Promise.all([context.waitForEvent('page'), clickBookmark(other, code)]);
      await tab.getByTestId('locked-screen').waitFor({ timeout: 15000 });
      assert.equal(await page.getByTestId('locked-screen').count(), 0, 'the dashboard tab kept its place');
      assert.equal((await readData()).items.length, count);
      await tab.close();
      await other.close();
    });

    await step('phone-sized screen: the bookmark steps fit', async () => {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: engine !== 'firefox', hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      const p = await phone.newPage();
      await signUpAndSetup(p, site.url, `phone-${engine}-${Date.now()}@example.com`);
      await p.getByTestId('wz-start').click();
      await p.getByTestId('wz-uni-other').click();
      await p.getByTestId('wz-next').click();
      await p.getByTestId('bm-copy').waitFor();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `${overflow}px horizontal overflow`);
      await p.screenshot({ path: path.join(WORK, `${engine}-phone-bookmark.png`), fullPage: true });
      await phone.close();
    });

    assert.deepEqual(errors, [], 'no uncaught page errors');
  } catch {
    /* the failing step already printed its error */
  } finally {
    await browser.close().catch(() => {});
    await site.close();
    await fake.close();
  }
}

db = await startTestSupabase();
for (const engine of ENGINES) await run(engine);
await db.close();
console.log(`\n${passed} passed, ${failed} failed — screenshots in ${WORK}`);
process.exitCode = failed ? 1 : 0;
