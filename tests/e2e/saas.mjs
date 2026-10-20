// End-to-end test of the website exactly as the EdTech Challenge grading bot uses it (see the
// grading contract in CLAUDE.md), against the fake Supabase project, on a laptop-sized and a
// phone-sized screen, in the engines of Chrome, Safari (WebKit) and Firefox.
// Usage:  node scripts/build.mjs --test-hosts && node tests/e2e/saas.mjs
//         node tests/e2e/saas.mjs --live      the published site, like the bot after the deadline
//                                              (creates two test accounts there; reads .env.local)
// Env:    ENGINES=chromium,webkit,firefox   SDW_E2E_DIR=…   HEADED=1
//         SITE_URL=https://….vercel.app (--live; or a "site" line in .env.local)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, firefox, webkit } = await import(process.env.PW_CORE || 'playwright-core');
import { startStatic, startTestSupabase } from './servers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'dist', 'web');
const WORK = fs.mkdtempSync(path.join(process.env.SDW_E2E_DIR || os.tmpdir(), 'sdw-saas-'));
const ENGINES = (process.env.ENGINES || 'chromium,webkit,firefox').split(',').map((s) => s.trim());
const LAUNCHERS = { chromium, webkit, firefox };
const headless = !process.env.HEADED;
const LIVE = process.argv.includes('--live');
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };

let failed = 0;
let passed = 0;

async function step(name, page, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`);
    await page?.screenshot({ path: path.join(WORK, `FAIL-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`) }).catch(() => {});
  }
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);

async function run(engine, site, db) {
  console.log(`\n${engine}`);
  let browser;
  try {
    browser = await LAUNCHERS[engine].launch({ headless, ...(engine === 'webkit' && process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {}) });
  } catch (err) {
    console.log(`  ⚠ ${engine} cannot start on this machine — skipped (${String(err.message).split('\n')[0].slice(0, 100)})`);
    return;
  }
  const tag = `${engine}-${Date.now().toString(36)}`;
  const userA = { email: `qa-a-${tag}@example.com`, password: 'Correct-horse-42' };
  const userB = { email: `qa-b-${tag}@example.com`, password: 'Another-pass-77' };
  const TEXT = `QA-7F3K2A grading bot test ${engine}`;
  let page;
  try {
    // 1. A stranger opens the link, on a laptop and on a phone.
    const laptop = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    page = await laptop.newPage();
    await step('landing page: what it is, who it is for and one sign-up button, without logging in', page, async () => {
      await page.goto(`${site.url}/`);
      await page.getByRole('heading', { level: 1 }).waitFor();
      const h1 = await page.getByRole('heading', { level: 1 }).innerText();
      assert.match(h1, /deadline/i);
      assert.match(await page.locator('.landing-kicker').innerText(), /IE University students/i);
      assert.equal(await page.getByRole('link', { name: /sign up/i }).count(), 1, 'exactly one sign-up button');
      await page.screenshot({ path: path.join(WORK, `${engine}-landing-laptop.png`) });
    });
    const phoneCtx = await browser.newContext({ ...PHONE, isMobile: engine !== 'firefox' });
    const phone = await phoneCtx.newPage();
    await step('landing page on a phone: readable, nothing scrolls sideways', phone, async () => {
      await phone.goto(`${site.url}/`);
      await phone.getByRole('link', { name: /sign up/i }).waitFor();
      assert.ok(await noSideScroll(phone), 'no horizontal scroll');
      await phone.screenshot({ path: path.join(WORK, `${engine}-landing-phone.png`), fullPage: true });
    });
    await step('the sign-up button leads to /signup', page, async () => {
      await page.getByRole('link', { name: /sign up/i }).click();
      await page.waitForURL(/\/signup$/);
    });

    // 2. Sign up at /signup with email and password: straight to /app (no email, no onboarding).
    await step('sign up at /signup lands on /app right away', page, async () => {
      await page.goto(`${site.url}/signup`);
      await page.getByTestId('signup-email').fill(userA.email);
      await page.getByTestId('signup-password').fill(userA.password);
      await page.getByTestId('signup-submit').click();
      await page.waitForURL(/\/app(#.*)?$/);
      await page.getByTestId('core-input').waitFor();
      assert.equal(await page.getByTestId('welcome').count(), 0, 'no mandatory onboarding');
    });

    // 3. Type a short text in the main feature, save, and see it in the list.
    await step('/app: typing only in core-input and clicking core-submit saves an item', page, async () => {
      assert.equal(await page.getByTestId('core-input').getAttribute('type'), 'text');
      await page.getByTestId('core-input').fill(TEXT);
      await page.getByTestId('core-submit').click();
      await page.getByTestId('core-item').filter({ hasText: TEXT }).waitFor({ timeout: 5000 });
      assert.equal(await page.getByTestId('core-input').inputValue(), '', 'the field is cleared');
    });
    if (!LIVE) await step('the item is saved in the database, not only in the browser', page, async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !db.tables.dashboards.some((r) => JSON.stringify(r.data).includes(TEXT))) await page.waitForTimeout(100);
      const row = db.tables.dashboards.find((r) => JSON.stringify(r.data).includes(TEXT));
      assert.ok(row, 'a dashboards row holds the item');
      assert.equal(row.user_id, [...db.users.values()].find((u) => u.email === userA.email).id);
    });
    await step('logout is visible on every page of a logged-in user', page, async () => {
      for (const nav of ['calendar', 'assignments', 'courses', 'grades', 'analytics', 'settings', 'dashboard']) {
        await page.getByTestId(`nav-${nav}`).click();
        assert.ok(await page.getByTestId('logout').isVisible(), `logout visible on ${nav}`);
      }
    });
    await step('reloading /app keeps the student logged in, with the item', page, async () => {
      await page.reload();
      await page.getByTestId('core-item').filter({ hasText: TEXT }).waitFor();
    });

    // 4. Log out; in a different, clean browser a wrong password is refused, the right one works.
    await step('log out: back to the public page, and /app asks to log in', page, async () => {
      await page.getByTestId('logout').click();
      await page.waitForURL((u) => new URL(u).pathname === '/');
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      assert.ok(!stored.includes(TEXT), 'no user data left in localStorage');
      await page.goto(`${site.url}/app`);
      await page.waitForURL(/\/login$/);
    });
    await laptop.close();

    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await other.newPage();
    await step('another browser: a wrong password is rejected', page, async () => {
      await page.goto(`${site.url}/login`);
      await page.getByTestId('login-email').fill(userA.email);
      await page.getByTestId('login-password').fill('wrong-password-123');
      await page.getByTestId('login-submit').click();
      await page.getByTestId('auth-error').waitFor();
      assert.match(await page.getByTestId('auth-error').innerText(), /wrong email or password/i);
      assert.match(page.url(), /\/login$/);
      assert.equal(await page.getByTestId('core-input').count(), 0);
    });
    await step('another browser: the right password opens /app with the item still there', page, async () => {
      await page.getByTestId('login-password').fill(userA.password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/app(#.*)?$/);
      await page.getByTestId('core-item').filter({ hasText: TEXT }).waitFor();
    });
    await step('items added in this browser are there on the phone too', page, async () => {
      await page.getByTestId('core-input').fill(`${TEXT} second`);
      await page.getByTestId('core-submit').click();
      await page.getByTestId('core-item').filter({ hasText: `${TEXT} second` }).waitFor();
      await page.getByTestId('logout').click();
      await page.waitForURL((u) => new URL(u).pathname === '/');
      await phone.goto(`${site.url}/login`);
      await phone.getByTestId('login-email').fill(userA.email);
      await phone.getByTestId('login-password').fill(userA.password);
      await phone.getByTestId('login-submit').click();
      await phone.getByTestId('core-item').filter({ hasText: `${TEXT} second` }).waitFor();
      assert.ok(await phone.getByTestId('logout').isVisible(), 'logout visible on the phone');
      assert.ok(await noSideScroll(phone), 'no horizontal scroll on /app');
      await phone.screenshot({ path: path.join(WORK, `${engine}-app-phone.png`) });
      await phone.getByTestId('logout').click();
      await phone.waitForURL((u) => new URL(u).pathname === '/');
    });
    await other.close();

    // 5. A second user cannot see the first user's item.
    const second = await browser.newContext();
    page = await second.newPage();
    await step('a second user does not see the first user’s items', page, async () => {
      await page.goto(`${site.url}/signup`);
      await page.getByTestId('signup-email').fill(userB.email);
      await page.getByTestId('signup-password').fill(userB.password);
      await page.getByTestId('signup-submit').click();
      await page.getByTestId('core-input').waitFor();
      await page.waitForTimeout(500);
      assert.equal(await page.getByTestId('core-item').count(), 0);
      assert.ok(!(await page.content()).includes(TEXT));
    });
    await step('signing up again with the same email is refused clearly', page, async () => {
      await page.getByTestId('logout').click();
      await page.waitForURL((u) => new URL(u).pathname === '/');
      await page.goto(`${site.url}/signup`);
      await page.getByTestId('signup-email').fill(userA.email);
      await page.getByTestId('signup-password').fill('whatever-123');
      await page.getByTestId('signup-submit').click();
      await page.getByTestId('auth-error').filter({ hasText: /already exists/i }).waitFor();
    });
    await second.close();

    // 6. Nobody can read data without logging in.
    await step('without logging in, the database answers nothing', null, async () => {
      for (const table of ['dashboards', 'backups']) {
        const res = await fetch(`${db.url}/rest/v1/${table}?select=*`, { headers: { apikey: db.publishableKey, Authorization: `Bearer ${db.publishableKey}` } });
        assert.ok(res.status === 401 || (res.ok && (await res.json()).length === 0), `${table}: ${res.status}`);
      }
    });
    await phoneCtx.close();
  } finally {
    await browser.close();
  }
}

/** --live: the published site and its Supabase project, from the environment or .env.local. */
function liveTargets() {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  const url = (env.SITE_URL ?? '').replace(/\/+$/, '');
  const dbUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  assert(/^https:\/\//.test(url), 'Set SITE_URL=https://<your-app>.vercel.app');
  assert(dbUrl && key, 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are needed (.env.local)');
  return { site: { url, close: async () => {} }, db: { url: dbUrl, publishableKey: key, close: async () => {} } };
}

const { site, db } = LIVE ? liveTargets() : { db: await startTestSupabase(), site: await startStatic(WEB) };
console.log(`${LIVE ? site.url : 'Website'} as the grading bot sees it — screenshots in ${WORK}`);
try {
  for (const engine of ENGINES) await run(engine, site, db);
} finally {
  await site.close();
  await db.close();
}
console.log(`\n${passed} passed, ${failed} failed — screenshots in ${WORK}`);
process.exitCode = failed ? 1 : 0;
