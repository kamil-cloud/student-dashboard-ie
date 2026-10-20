/**
 * Extension service worker.
 *  - Syncs Blackboard every few hours with the student's own session and leaves the result in
 *    the "inbox" for the dashboard to apply (it never writes the app data itself).
 *  - Shows reminder and new-grade notifications, and a badge with what is due today.
 *  - Optionally saves a weekly backup file to Downloads.
 *  - Lets the website version reach Blackboard through the extension (externally_connectable).
 */
import { BlackboardClient, BlackboardError } from '../integrations/blackboard/client';
import { applySnapshot } from '../integrations/blackboard/apply';
import { fetchSnapshot, listCourseChoices, whoAmI } from '../integrations/blackboard/snapshot';
import { readSyllabiInWindow } from '../integrations/blackboard/syllabus';
import type { BbSnapshot, SyncProgress } from '../integrations/blackboard/types';
import { todayStr } from '../lib/dates';
import { dueLabel, dueReminders, isOverdue, isTask } from '../lib/schedule';
import { sanitizeData } from '../lib/sanitize';
import type { AppData } from '../lib/types';
import { addToList, getBackgroundStatus, getInbox, getList, getValue, isBlank, readAppData, setBackgroundStatus, setHandoff, setInbox, setValue } from '../platform/meta';

const SYNC_EVERY_MIN = 180;
const APP_URL = chrome.runtime.getURL('app.html');
const ICON = chrome.runtime.getURL('icons/icon-128.png');
/** Websites allowed to use the bridge (also enforced by Chrome via externally_connectable). */
const WEB_ORIGINS: string[] = JSON.parse(import.meta.env.VITE_WEB_ORIGINS ?? '[]');
/** Test and development builds only: local servers (fake Blackboard, local website). */
const ALLOW_LOCALHOST = import.meta.env.VITE_ALLOW_LOCALHOST === '1';
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAllowedHost(host: string): boolean {
  try {
    const u = new URL(host);
    return (u.protocol === 'https:' || (ALLOW_LOCALHOST && LOCAL_ORIGIN.test(u.origin))) && u.origin === host;
  } catch {
    return false;
  }
}

async function hasHostPermission(host: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [`${host}/*`] }).catch(() => false);
}

/** Focus the dashboard if it is open (our own pages are listed without the "tabs" permission), else open it. */
/** Show the dashboard tab (reloaded with `reload`, e.g. so it picks up handed-over data). */
async function openApp(hash = '', reload = false): Promise<void> {
  const url = `${APP_URL}${hash}`;
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] }).catch(() => []);
  const open = contexts.find((c) => c.documentUrl?.startsWith(APP_URL) && c.tabId >= 0);
  if (open) {
    await chrome.tabs.update(open.tabId, { active: true, ...(hash ? { url } : {}) });
    if (reload) await chrome.tabs.reload(open.tabId);
    if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/** Tell open dashboard pages that something changed (they ignore it if irrelevant). */
function broadcast(message: Record<string, unknown>) {
  chrome.runtime.sendMessage(message).catch(() => {
    /* no page open */
  });
}

// ---------------------------------------------------------------------------
// Badge and reminders
// ---------------------------------------------------------------------------

async function updateBadge(data: AppData | null) {
  if (!data) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const today = todayStr();
  const now = new Date();
  const open = data.items.filter((i) => isTask(i) && i.status !== 'completed' && i.dueDate);
  const overdue = open.filter((i) => isOverdue(i, now)).length;
  const dueToday = open.filter((i) => i.dueDate === today && !isOverdue(i, now)).length;
  const n = overdue + dueToday;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: overdue ? '#e5484d' : '#3e63dd' });
  await chrome.action.setTitle({ title: n ? `Student Dashboard — ${overdue ? `${overdue} overdue, ` : ''}${dueToday} due today` : 'Student Dashboard' });
}

async function notify(id: string, title: string, message: string) {
  try {
    await chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 1 });
  } catch (err) {
    console.warn('[notify]', err);
  }
}

async function checkReminders() {
  const data = await readAppData();
  await updateBadge(data);
  if (!data || !data.settings.systemNotifications) return;
  const notified = await getList('osNotified');
  const now = new Date();
  const due = dueReminders({ items: data.items, notified }, now);
  if (due.length === 0) return;
  await addToList('osNotified', due.map((r) => r.key));
  // A reminder whose time had already passed when the task was created stays silent.
  const fresh = due.filter((r) => Date.parse(r.item.createdAt) <= r.at.getTime());
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  for (const r of fresh.slice(0, 4)) {
    const course = r.item.courseId ? courses.get(r.item.courseId) : undefined;
    await notify(`rem|${r.item.id}|${r.at.getTime()}`, r.item.title, `${course ? `${course.code || course.name} · ` : ''}due ${dueLabel(r.item, now).text.toLowerCase()}`);
  }
  if (fresh.length > 4) await notify(`rem|many|${now.getTime()}`, 'Student Dashboard', `${fresh.length - 4} more reminders — open the dashboard to see them.`);
}

// ---------------------------------------------------------------------------
// Background Blackboard sync
// ---------------------------------------------------------------------------

let syncing: Promise<void> | null = null;

async function backgroundSync(force = false): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    const data = await readAppData();
    const host = data?.blackboard.host;
    if (!data || !host || (!data.blackboard.autoSync && !force) || !isAllowedHost(host)) return;
    const now = new Date();
    if (!(await hasHostPermission(host))) {
      await setBackgroundStatus({ state: 'no-permission', at: now.toISOString() });
      return;
    }
    try {
      const snapshot = await fetchSnapshot({ client: new BlackboardClient(host), excluded: data.blackboard.excludedCourses, now });
      // What would change — used for "new grade" notifications only; the dashboard applies it.
      const inbox = await getInbox();
      const base = inbox && Date.parse(inbox.snapshot.fetchedAt) > Date.parse(data.blackboard.lastSync ?? '') ? applySnapshot(data, inbox.snapshot, now).data : data;
      const { summary } = applySnapshot(base, snapshot, now);
      await setInbox({ snapshot, at: now.toISOString() });
      await setBackgroundStatus({ state: 'ok', at: now.toISOString() });
      if (data.settings.systemNotifications && summary.newGrades.length) {
        const seen = new Set(await getList('gradeNotified'));
        const fresh = summary.newGrades.filter((g) => !seen.has(`${g.course}|${g.title}`));
        await addToList('gradeNotified', fresh.map((g) => `${g.course}|${g.title}`));
        for (const g of fresh.slice(0, 3)) await notify(`grade|${g.course}|${g.title}|${now.getTime()}`, `New grade: ${g.title}`, `${g.course} — open Student Dashboard to see it.`);
      }
      broadcast({ type: 'inbox-updated' });
    } catch (err) {
      const auth = err instanceof BlackboardError && err.code === 'auth';
      await setBackgroundStatus({ state: auth ? 'logged-out' : 'error', at: now.toISOString(), message: err instanceof Error ? err.message : String(err) });
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

// ---------------------------------------------------------------------------
// Weekly backup file
// ---------------------------------------------------------------------------

async function maybeDownloadBackup() {
  const data = await readAppData();
  if (!data?.settings.backupDownloads || (data.courses.length === 0 && data.items.length === 0)) return;
  const last = await getValue<string>('lastBackupDownload');
  if (last && Date.now() - Date.parse(last) < 7 * 86_400_000) return;
  const json = JSON.stringify(data, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  try {
    await chrome.downloads.download({ url, filename: `Student Dashboard backups/student-dashboard-${todayStr()}.json`, conflictAction: 'overwrite', saveAs: false });
    await setValue('lastBackupDownload', new Date().toISOString());
  } catch (err) {
    console.warn('[backup download]', err);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function ensureAlarms() {
  if (!(await chrome.alarms.get('sync'))) await chrome.alarms.create('sync', { periodInMinutes: SYNC_EVERY_MIN, delayInMinutes: 5 });
  if (!(await chrome.alarms.get('reminders'))) await chrome.alarms.create('reminders', { periodInMinutes: 1 });
  if (!(await chrome.alarms.get('daily'))) await chrome.alarms.create('daily', { periodInMinutes: 12 * 60, delayInMinutes: 2 });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureAlarms();
  if (details.reason === 'install') await openApp();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await checkReminders();
  const status = await getBackgroundStatus();
  if (!status || Date.now() - Date.parse(status.at) > 60 * 60_000) void backgroundSync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') void backgroundSync();
  else if (alarm.name === 'reminders') void checkReminders();
  else if (alarm.name === 'daily') void maybeDownloadBackup();
});

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const [kind, itemId] = id.split('|');
  if (kind === 'rem' && itemId && itemId !== 'many') {
    const data = await readAppData();
    const item = data?.items.find((i) => i.id === itemId);
    await openApp(item?.courseId ? `#/courses/${item.courseId}` : '#/assignments');
  } else if (kind === 'grade') await openApp('#/grades');
  else await openApp();
});

// Messages from the extension's own pages.
chrome.runtime.onMessage.addListener((msg: { type?: string }, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'data-saved') {
    void checkReminders();
  } else if (msg.type === 'sync-now') {
    void backgroundSync(true).then(() => reply({ ok: true }));
    return true;
  } else if (msg.type === 'open-app') {
    void openApp(typeof (msg as { hash?: string }).hash === 'string' ? (msg as { hash: string }).hash : '');
  }
  return undefined;
});

// ---------------------------------------------------------------------------
// Bridge for the website version
// ---------------------------------------------------------------------------

type BridgeRequest =
  | { type: 'ping' }
  | { type: 'open-app' }
  | { type: 'handoff'; data: unknown; resume?: string }
  | { type: 'bb:check'; host: string }
  | { type: 'bb:courses'; host: string }
  | { type: 'bb:snapshot'; host: string; courseIds?: string[]; excluded?: string[]; syllabus?: boolean }
  | { type: 'bb:open-login'; host: string };

chrome.runtime.onConnectExternal.addListener((port) => {
  const origin = port.sender?.origin ?? '';
  if (!WEB_ORIGINS.includes(origin) && !(ALLOW_LOCALHOST && LOCAL_ORIGIN.test(origin))) {
    port.disconnect();
    return;
  }
  port.onMessage.addListener(async (req: BridgeRequest) => {
    const send = (m: Record<string, unknown>) => {
      try {
        port.postMessage(m);
      } catch {
        /* page went away */
      }
    };
    try {
      if (req.type === 'ping') {
        const setUp = !isBlank(await readAppData().catch(() => null));
        return send({ type: 'result', value: { ok: true, version: chrome.runtime.getManifest().version, setUp } });
      }
      if (req.type === 'handoff') {
        // Only into an extension that has not been used yet: nothing of the student's is overwritten.
        if (!isBlank(await readAppData())) return send({ type: 'error', code: 'set-up', message: 'The extension already has its own dashboard.' });
        const resume = req.resume === 'blackboard' || req.resume === 'connect' ? req.resume : null;
        await setHandoff({ data: sanitizeData(req.data).data, resume, at: new Date().toISOString() });
        await openApp(resume === 'connect' ? '#/settings' : '', true);
        return send({ type: 'result', value: true });
      }
      if (req.type === 'open-app') {
        await openApp();
        return send({ type: 'result', value: true });
      }
      if (!isAllowedHost(req.host)) return send({ type: 'error', code: 'host', message: 'That Blackboard address is not valid.' });
      if (!(await hasHostPermission(req.host))) return send({ type: 'error', code: 'no-permission', message: 'Open the extension’s dashboard once to allow access to this Blackboard site.' });
      const client = new BlackboardClient(req.host);
      if (req.type === 'bb:open-login') {
        await chrome.tabs.create({ url: `${req.host}/ultra/course` });
        return send({ type: 'result', value: true });
      }
      if (req.type === 'bb:check') {
        await whoAmI(client);
        return send({ type: 'result', value: { ok: true } });
      }
      if (req.type === 'bb:courses') {
        const choices = await listCourseChoices(client, await whoAmI(client));
        return send({ type: 'result', value: choices });
      }
      if (req.type === 'bb:snapshot') {
        const snapshot: BbSnapshot = await fetchSnapshot({
          client,
          courseIds: req.courseIds,
          excluded: req.excluded,
          readSyllabi: req.syllabus ? (courses, progress) => readSyllabiInWindow(req.host, courses, progress) : undefined,
          onProgress: (p: SyncProgress) => send({ type: 'progress', value: p }),
        });
        return send({ type: 'result', value: snapshot });
      }
    } catch (err) {
      send({ type: 'error', code: err instanceof BlackboardError ? err.code : 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
});

void ensureAlarms();
