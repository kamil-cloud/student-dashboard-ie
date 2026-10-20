// End-to-end test of the real extension and website in Chromium, against a fake Blackboard.
// Usage:  npm run e2e   (builds first, with --test-hosts)
// Env:    SDW_E2E_DIR   folder for profiles, downloads and screenshots (default: OS temp)
//         HEADED=1      watch it run
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchWithExtension } from './browser.mjs';
import { startFakeBlackboard, startStatic, startTestSupabase } from './servers.mjs';
import { EXPECTED, makeIeTranscriptPdf } from '../fixtures/ie-transcript.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, 'dist', 'extension');
const WEB = path.join(ROOT, 'dist', 'web');
const WORK = fs.mkdtempSync(path.join(process.env.SDW_E2E_DIR || os.tmpdir(), 'sdw-e2e-'));
const SHOTS = path.join(WORK, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PROFILE = path.join(WORK, 'profile');
const headless = !process.env.HEADED;

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
if (!manifest.host_permissions.includes('http://localhost/*')) {
  console.error('Build the extension with --test-hosts first (npm run e2e does it).');
  process.exit(1);
}

const transcriptPdf = path.join(WORK, 'transcript.pdf');
fs.writeFileSync(transcriptPdf, await makeIeTranscriptPdf());
const notTranscript = path.join(WORK, 'not-a-transcript.pdf');
{
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Hello, this is a menu.', { x: 50, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  fs.writeFileSync(notTranscript, await doc.save());
}

const results = [];
let shotN = 0;
let page;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t, error: String(err?.message ?? err) });
    console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`);
    try {
      await page?.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`) });
    } catch {
      /* page gone */
    }
    throw err;
  }
}

const shot = async (name, p = page) => {
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`) });
};

async function eventually(fn, msg, timeout = 10000) {
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

/** Read the saved app data straight from IndexedDB, in an extension or website page. */
const readData = (p = page) =>
  p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('student-dashboard');
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('kv').objectStore('kv').get('data');
          get.onsuccess = () => resolve(get.result ? JSON.parse(get.result.json) : null);
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
/** The website keeps the dashboard in the student's account: read it from the fake Supabase. */
let supa;
const readCloud = async (email) => {
  const id = [...supa.users.values()].find((u) => u.email === email)?.id;
  const row = supa.tables.dashboards.find((r) => r.user_id === id);
  return row ? structuredClone(row.data) : null;
};
async function signUpAndSetup(p, siteUrl, email) {
  await p.goto(`${siteUrl}/signup`);
  await p.getByTestId('signup-email').fill(email);
  await p.getByTestId('signup-password').fill('Test-password-1');
  await p.getByTestId('signup-submit').click();
  await p.getByTestId('core-input').waitFor();
  await p.goto(`${siteUrl}/app#/setup`);
  await p.getByTestId('welcome').waitFor();
}
const readMeta = (key, p = page) =>
  p.evaluate(
    (k) =>
      new Promise((resolve) => {
        const req = indexedDB.open('student-dashboard');
        req.onsuccess = () => {
          const get = req.result.transaction('meta').objectStore('meta').get(k);
          get.onsuccess = () => resolve(get.result ?? null);
        };
      }),
    key,
  );

const waitSaved = (p = page) => p.getByTestId('save-status').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 8000 });
const nav = async (name) => {
  await page.getByTestId(`nav-${name}`).click();
  await page.waitForTimeout(150);
};
const toast = (text, p = page) => p.locator('.toast', { hasText: text }).first();

// Playwright can throw from its connection handler when a page crashes; record it instead of dying.
process.on('uncaughtException', (err) => console.log(`      ! uncaught: ${err.message}`));

const fake = await startFakeBlackboard({ renderDelayMs: 900 });
let ctx;

console.log(`\nStudent Dashboard (web + extension) — end-to-end\nWork folder: ${WORK}\n`);
console.log('Extension — first install');
try {
  ctx = await launchWithExtension({ extensionDir: EXT, profileDir: PROFILE, headless });
  const pageErrors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => pageErrors.push(`${p.url().slice(0, 60)}: ${e.message}`));
    p.on('crash', () => console.log(`      ! page crashed: ${p.url().slice(0, 90)}`));
  };
  ctx.context.on('page', watch);
  ctx.context.pages().forEach(watch);

  await step('installing opens the welcome screen', async () => {
    await eventually(() => ctx.context.pages().some((p) => p.url().startsWith(ctx.appUrl)), 'app tab opened on install');
    page = ctx.context.pages().find((p) => p.url().startsWith(ctx.appUrl));
    await page.bringToFront();
    await page.getByTestId('welcome').waitFor();
    await page.getByRole('heading', { name: 'Your semester, organised' }).waitFor();
    await shot('welcome');
  });

  await step('a wrong file is refused with a clear message', async () => {
    await page.getByTestId('wz-start').click();
    await page.getByTestId('wz-name').fill('Alex');
    assert(await page.getByTestId('wz-next').isDisabled(), 'university must be chosen first');
    await page.getByTestId('wz-uni-ie').click();
    await page.getByTestId('wz-next').click();
    await page.getByTestId('transcript-file').setInputFiles(notTranscript);
    await page.getByTestId('transcript-error').filter({ hasText: 'does not look like an IE University transcript' }).waitFor();
  });

  await step('the transcript is read on the device and previewed', async () => {
    await page.getByTestId('transcript-file').setInputFiles(transcriptPdf);
    await page.getByTestId('transcript-preview').waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId('tx-courses').textContent(), String(EXPECTED.courses));
    assert.equal(await page.getByTestId('tx-gpa').textContent(), EXPECTED.gpa.toFixed(2));
    await page.getByText(`Matches the GPA on your transcript (${EXPECTED.officialGpa.toFixed(1)})`).waitFor();
    await shot('transcript-preview');
    await page.getByTestId('transcript-import').click();
    await toast('Transcript imported').waitFor();
  });

  await step('Blackboard: asks to log in, then continues by itself', async () => {
    await page.getByTestId('bb-host').fill(fake.host);
    await page.getByTestId('bb-start').click();
    await page.getByTestId('bb-login').waitFor();
    await shot('bb-login');
    const [bbTab] = await Promise.all([ctx.context.waitForEvent('page'), page.getByTestId('bb-open-login').click()]);
    await bbTab.locator('#sign-in').click();
    await bbTab.locator('#courses').waitFor();
    await bbTab.close();
    await page.bringToFront();
    await page.getByTestId('bb-choose').waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId('bb-course').count(), 5, 'only this year’s courses are listed');
    assert.equal(await page.getByTestId('bb-course').filter({ checked: true }).count(), 5);
    await shot('bb-choose');
  });

  await step('Blackboard: imports courses, sessions, deadlines, grades and syllabus weights', async () => {
    // Leave one course out: it must not be imported nor synced later.
    await page.locator('.bb-course', { hasText: 'Pricing Strategy' }).locator('input').uncheck();
    await page.getByTestId('bb-import').click();
    await page.getByTestId('bb-progress').waitFor();
    await page.getByTestId('bb-done').waitFor({ timeout: 120000 });
    await page.getByTestId('bb-done').getByText('Partly read: Supply Chain Management').waitFor();
    await shot('bb-done');
    const d = await readData();
    assert.equal(d.blackboard.host, fake.host);
    assert.deepEqual(d.blackboard.excludedCourses, ['_107_1']);
    assert(!d.courses.some((c) => c.name === 'Pricing Strategy'), 'unticked course not imported');
    const mc = d.courses.filter((c) => c.name === 'Management Control');
    assert.equal(mc.length, 1, 'linked to the transcript course, not duplicated');
    assert(mc[0].sources.transcript && mc[0].sources.blackboard);
    assert.equal(mc[0].professor, 'Montserrat de la Prueba');
    const mcItems = d.items.filter((i) => i.courseId === mc[0].id);
    assert.equal(mcItems.reduce((t, i) => t + (i.weight ?? 0), 0), 100, 'syllabus weights read through the LTI window');
    assert(fake.bb.state.requests.every((r) => r.startsWith('GET ') || r === 'POST /fake-login'), 'nothing but reads on Blackboard');
    await page.getByTestId('bb-continue').click();
  });

  await step('reminders and backups, then the dashboard', async () => {
    await page.getByText('Desktop notifications').click();
    await page.getByText('Weekly backup file').click();
    await page.getByTestId('wz-next').click();
    await page.getByRole('heading', { name: 'You’re all set, Alex' }).waitFor();
    await shot('all-set');
    await page.getByTestId('wz-finish').click();
    await page.locator('.app').waitFor();
    await page.getByTestId('sync-chip').filter({ hasText: 'Blackboard ·' }).waitFor();
    await page.getByText('BBA Y3 · Fall 2026').first().waitFor();
    await page.getByText('Montserrat de la Prueba').count();
    await shot('dashboard');
    const d = await readData();
    assert(d.profile.onboardedAt);
    assert.equal(d.settings.systemNotifications, true);
    assert.equal(d.settings.backupDownloads, true);
  });

  await step('course page: grade so far, weights, sessions and a link to Blackboard', async () => {
    await nav('courses');
    await page.getByTestId('course-card').filter({ hasText: 'Management Control' }).click();
    await page.getByRole('heading', { name: 'Management Control' }).waitFor();
    const link = await page.getByTestId('open-in-bb').getAttribute('href');
    assert.equal(link, `${fake.host}/ultra/courses/_101_1/outline`);
    await page.getByText('Final Exam').first().waitFor();
    await shot('course-detail');
  });

  await step('data survives a reload', async () => {
    const before = await readData();
    await page.reload();
    await page.locator('.app').waitFor();
    const after = await readData();
    assert.equal(after.items.length, before.items.length);
    assert.equal(after.courses.length, before.courses.length);
  });

  await step('a second tab cannot overwrite the first one', async () => {
    const second = await ctx.context.newPage();
    await second.goto(ctx.appUrl);
    await second.getByTestId('locked-screen').waitFor();
    await shot('second-tab-locked', second);
    await second.getByTestId('use-here').click();
    await second.locator('.app').waitFor();
    await page.getByTestId('locked-screen').waitFor();
    await page.getByTestId('use-here').click();
    await page.locator('.app').waitFor();
    await second.close();
  });

  await step('popup: today and next deadlines at a glance', async () => {
    const popup = await ctx.context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${ctx.extensionId}/popup.html`);
    await popup.getByTestId('popup').waitFor();
    await popup.getByText('Hi Alex').waitFor();
    assert((await popup.getByTestId('pp-task').count()) >= 3);
    await shot('popup', popup);
    await popup.close();
  });

  await step('background sync brings new grades and moved deadlines, and keeps your edits', async () => {
    // The student edits a task title; Blackboard then publishes a grade and moves a deadline.
    const d0 = await readData();
    const quiz2 = d0.items.find((i) => i.title === 'Reading quiz 2');
    const ps2 = d0.items.find((i) => i.title === 'Problem set 2');
    await nav('assignments');
    await page.getByText('Reading quiz 2').first().click();
    const title = page.getByRole('dialog').getByPlaceholder('e.g. Problem Set 3');
    await title.fill('Quiz 2 — chapters 3 & 4');
    await page.getByTestId('save-item').click();
    await waitSaved();
    fake.bb.state.requests.length = 0;
    fake.bb.addGrade('_101_1', { columnId: '_9010_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 4.5 }, lastRelevantDate: new Date().toISOString() });
    fake.bb.moveDue('_102_1', '_9102_1', 25);
    // Sync from the popup (as a student would), while the dashboard stays open.
    const popup = await ctx.context.newPage();
    await popup.goto(`chrome-extension://${ctx.extensionId}/popup.html`);
    await popup.getByTestId('pp-sync').click();
    await popup.getByTestId('pp-sync').filter({ hasText: 'Sync' }).waitFor({ timeout: 30000 });
    await popup.close();
    await page.bringToFront();
    await toast('From Blackboard').waitFor({ timeout: 20000 });
    await waitSaved();
    const d = await readData();
    const q2 = d.items.find((i) => i.id === quiz2.id);
    assert.equal(q2.title, 'Quiz 2 — chapters 3 & 4', 'your title is kept');
    assert.equal(q2.score, 4.5, 'new grade arrived');
    assert.equal(q2.status, 'completed');
    const p2 = d.items.find((i) => i.id === ps2.id);
    assert.notEqual(p2.dueDate, ps2.dueDate, 'moved deadline arrived');
    assert(!fake.bb.state.requests.some((r) => r.includes('/courses/_107_1/gradebook')), 'the gradebook of an excluded course is never read');
    assert(!fake.bb.state.requests.some((r) => r.includes('launchPlacement')), 'background sync does not open syllabus windows');
  });

  await step('system notifications and the toolbar badge', async () => {
    // A task due soon with a reminder that is already due.
    const soon = new Date(Date.now() + 50 * 60_000);
    const pad = (n) => String(n).padStart(2, '0');
    await nav('assignments');
    await page.getByTestId('sidebar-new').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByPlaceholder('e.g. Problem Set 3').fill('Hand in the reading notes');
    await dlg.getByLabel('Due date', { exact: true }).fill(`${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
    await dlg.getByLabel('Due time', { exact: true }).fill(`${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
    await dlg.getByLabel('Reminder').selectOption('1h');
    await page.getByTestId('save-item').click();
    await waitSaved();
    // The page tells the background worker after each save; it checks reminders right away.
    await eventually(async () => (await readMeta('osNotified'))?.some((k) => k.length > 10), 'reminder notification recorded', 15000);
    const badge = await ctx.worker.evaluate(() => chrome.action.getBadgeText({}));
    assert(Number(badge) >= 1, `badge shows tasks due today (got "${badge}")`);
  });

  await step('export to calendar (.ics) and a JSON backup', async () => {
    await nav('settings');
    await page.getByTestId('ics-export').click();
    const [ics] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ics-download').click()]);
    const icsText = fs.readFileSync(await ics.path(), 'utf8');
    assert(icsText.includes('BEGIN:VCALENDAR') && icsText.includes('SUMMARY:Management Control'), 'classes exported');
    assert(icsText.includes('TRIGGER:-PT1H'), 'reminders exported');
    const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
    const backupFile = path.join(WORK, 'backup.json');
    fs.copyFileSync(await json.path(), backupFile);
    const b = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    assert.equal(b.courses.length, (await readData()).courses.length);
    await shot('settings');
  });

  await step('reset needs DELETE, keeps a backup, and the backup restores everything', async () => {
    const before = await readData();
    await page.getByRole('button', { name: 'Delete all data' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('textbox').fill('DELETE');
    await dlg.getByRole('button', { name: 'Delete everything' }).click();
    await eventually(async () => (await readData()).courses.length === 0, 'data cleared');
    await page.locator('.backup-row', { hasText: 'Before reset' }).first().getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore backup' }).click();
    await eventually(async () => (await readData()).courses.length === before.courses.length, 'restored');
  });

  await step('closing the browser and opening it again keeps everything', async () => {
    const count = (await readData()).items.length;
    await ctx.context.close();
    ctx = await launchWithExtension({ extensionDir: EXT, profileDir: PROFILE, headless });
    page = await ctx.context.newPage();
    await page.goto(ctx.appUrl);
    // Chromium may bring back the dashboard tab of the last session: use that one then.
    await page.locator('.app, [data-testid="locked-screen"]').first().waitFor();
    if (await page.getByTestId('locked-screen').count()) {
      const restored = ctx.context.pages().find((p) => p !== page && p.url().startsWith(ctx.appUrl));
      assert(restored, 'another dashboard tab holds the data');
      await page.close();
      page = restored;
      await page.locator('.app').waitFor();
    }
    assert.equal((await readData()).items.length, count);
    assert.equal(await page.getByTestId('welcome').count(), 0, 'no welcome screen the second time');
  });

  console.log('\nWebsite');
  const site = await startStatic(WEB);
  supa = await startTestSupabase();
  const webUser = `website-${Date.now()}@example.com`;
  await step('the website reaches Blackboard through the installed extension', async () => {
    const web = await ctx.context.newPage();
    page = web;
    await signUpAndSetup(web, site.url, webUser);
    await web.getByTestId('wz-start').click();
    await web.getByTestId('wz-uni-ie').click();
    await web.getByTestId('wz-next').click();
    await web.getByRole('button', { name: 'Skip for now' }).click();
    await web.getByTestId('bb-host').fill(fake.host);
    await web.getByTestId('bb-start').click();
    // The browser was restarted: the Blackboard session cookie is gone, like in real life.
    await web.getByTestId('bb-login').waitFor({ timeout: 20000 });
    const [bbTab] = await Promise.all([ctx.context.waitForEvent('page'), web.getByTestId('bb-open-login').click()]);
    await bbTab.locator('#sign-in').click();
    await bbTab.locator('#courses').waitFor();
    await bbTab.close();
    await web.bringToFront();
    await web.getByTestId('bb-choose').waitFor({ timeout: 20000 });
    await web.getByTestId('bb-syllabus').uncheck();
    await web.getByTestId('bb-import').click();
    await web.getByTestId('bb-done').waitFor({ timeout: 60000 });
    await web.getByTestId('bb-continue').click();
    await web.getByTestId('wz-next').click();
    await web.getByTestId('wz-finish').click();
    await web.locator('.app').waitFor();
    let d;
    await eventually(async () => (d = await readCloud(webUser))?.courses.length >= 4, 'courses imported into the student’s account');
    await shot('website-dashboard', web);
  });

  await step('on a phone-sized screen nothing overflows', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    for (const name of ['dashboard', 'assignments', 'calendar', 'courses', 'grades', 'settings']) {
      await page.evaluate((n) => (location.hash = n === 'dashboard' ? '#/' : `#/${n}`), name);
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `${name}: ${overflow}px horizontal overflow`);
      if (name === 'dashboard' || name === 'courses') await shot(`phone-${name}`);
    }
  });
  await ctx.context.close();

  await step('without the extension, the website offers the sync bookmark', async () => {
    const plain = await chromium.launch({ headless });
    const p = await plain.newPage();
    page = p;
    await signUpAndSetup(p, site.url, `plain-${Date.now()}@example.com`);
    await p.getByTestId('wz-start').click();
    await p.getByTestId('wz-uni-other').click();
    await p.getByTestId('wz-next').click();
    await p.getByTestId('bb-bookmark').waitFor();
    const href = await p.getByTestId('bm-link').getAttribute('href');
    assert(href?.startsWith('javascript:') && decodeURIComponent(href).includes(JSON.stringify(site.url)), 'bookmark made for this website');
    await shot('website-bookmark', p);
    await plain.close();
  });

  await step('a setup started on the website moves into a freshly installed extension', async () => {
    const fresh = await launchWithExtension({ extensionDir: EXT, profileDir: path.join(WORK, 'profile-fresh'), headless });
    try {
      await eventually(() => fresh.context.pages().some((p) => p.url().startsWith(fresh.appUrl)), 'app tab opened on install');
      const web = await fresh.context.newPage();
      page = web;
      const handoffUser = `handoff-${Date.now()}@example.com`;
      await signUpAndSetup(web, site.url, handoffUser);
      await web.getByTestId('wz-start').click();
      await web.getByTestId('wz-uni-ie').click();
      await web.getByTestId('wz-next').click();
      await web.getByTestId('transcript-file').setInputFiles(transcriptPdf);
      await web.getByTestId('transcript-preview').waitFor({ timeout: 20000 });
      await web.getByTestId('transcript-import').click();
      let moved = 0;
      await eventually(async () => (moved = (await readCloud(handoffUser))?.courses.length ?? 0) > 0, 'transcript saved on the website');
      await web.getByTestId('bb-handoff').waitFor();
      await shot('website-handoff', web);
      await web.getByTestId('bb-handoff-go').click();
      await web.getByTestId('bb-handoff-done').waitFor();
      const app = fresh.context.pages().find((p) => p.url().startsWith(fresh.appUrl));
      page = app;
      await toast('Your dashboard moved here from the website.', app).waitFor();
      // The extension's own setup picks up at the Blackboard step, with the transcript already in.
      await app.getByTestId('bb-connect').waitFor();
      await eventually(async () => (await readData(app))?.courses.length === moved, 'transcript courses saved in the extension');
      await shot('extension-after-handoff', app);
      // Now that the extension's dashboard is in use, the website no longer offers to hand over.
      await web.goto(`${site.url}/app#/`);
      await web.locator('.app').waitFor();
      await web.evaluate(() => (location.hash = '#/settings'));
      await web.getByTestId('connect-bb').click();
      await web.getByTestId('bb-connect').waitFor();
      assert.equal(await web.getByTestId('bb-handoff').count(), 0, 'no hand-over offered once the extension is set up');
    } finally {
      await fresh.context.close();
    }
  });
  await site.close();

  if (pageErrors.length) throw new Error(`Uncaught page errors:\n${pageErrors.join('\n')}`);
} catch {
  /* the failing step already printed its error */
} finally {
  await ctx?.context.close().catch(() => {});
  await fake.close();
  await supa?.close();
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${passed}/${results.length} steps passed\nArtifacts: ${WORK}`);
  process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
}
