/**
 * Blackboard sync in the dashboard: "Sync now", applying what the extension's background
 * worker fetched while the dashboard was closed (the "inbox"), and — on the website — the
 * Blackboard calendar link (re-read on opening and on "Sync now") and the bookmark (syncing
 * whenever the student clicks it on Blackboard).
 */
import { produce } from 'immer';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applySnapshot, type BbApplySummary } from '../integrations/blackboard/apply';
import { applyCalendarFeed, describeCalendar, type CalendarSummary } from '../integrations/blackboard/calendarFeed';
import { BlackboardError } from '../integrations/blackboard/client';
import type { BbSnapshot, SyncProgress } from '../integrations/blackboard/types';
import { BookmarkPrompt } from '../components/SyncBookmark';
import { detectBackend, readSnapshot } from '../platform/blackboard';
import { currentRelay, onRelay, relayClaimed, takeSession, tellRelay, type Relay } from '../platform/relay';
import { fetchCalendarFeed } from '../platform/calendarFeed';
import { IS_EXTENSION } from '../platform/env';
import { clearInbox, getBackgroundStatus, getInbox, type BackgroundStatus } from '../platform/meta';
import { useToast } from '../components/feedback';
import { plural } from './format';
import { api } from './storage';
import { useStore } from './store';

/** Website only: the extension cannot sync in the background for it, so it catches up on opening. */
const WEB_SYNC_AFTER_MS = 60 * 60 * 1000;
/** The calendar link is re-read on opening when it was last read longer ago than this. */
const CALENDAR_SYNC_AFTER_MS = 2 * 60 * 60 * 1000;

export interface SyncState {
  running: boolean;
  progress: SyncProgress | null;
  lastSummary: BbApplySummary | null;
  lastError: { message: string; code: string } | null;
  background: BackgroundStatus | null;
}

interface SyncApi extends SyncState {
  /** Read Blackboard now and apply it. Resolves with the summary, or null on error. */
  syncNow: (opts?: { syllabus?: boolean; courseIds?: string[]; quiet?: boolean }) => Promise<BbApplySummary | null>;
  /** Apply a snapshot read elsewhere (e.g. by the setup wizard). */
  applyFetched: (snapshot: BbSnapshot) => BbApplySummary;
  /** Read the Blackboard calendar link (`url`: connect a new one) and apply it. */
  syncCalendar: (opts?: { url?: string; quiet?: boolean }) => Promise<CalendarSummary | null>;
}

const SyncContext = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

/** "3 new deadlines · 1 new grade · 2 dates changed" */
export function describeSummary(s: BbApplySummary): string {
  const parts: string[] = [];
  if (s.coursesAdded) parts.push(plural(s.coursesAdded, 'new course'));
  if (s.itemsAdded) parts.push(plural(s.itemsAdded, 'new task'));
  if (s.newGrades.length) parts.push(plural(s.newGrades.length, 'new grade'));
  if (s.dueChanges.length) parts.push(plural(s.dueChanges.length, 'date change'));
  if (s.itemsRemoved) parts.push(`${plural(s.itemsRemoved, 'task')} removed`);
  return parts.join(' · ');
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data, getData, replaceData } = useStore();
  const toast = useToast();
  const [state, setState] = useState<SyncState>({ running: false, progress: null, lastSummary: null, lastError: null, background: null });
  const running = useRef(false);
  /** Website without the extension: "Sync now" asks for a click on the bookmark. */
  const [askBookmark, setAskBookmark] = useState(false);
  const host = data.blackboard.host;

  const apply = useCallback(
    (snapshot: BbSnapshot) => {
      // Read-modify-write on the very latest data, synchronously: no edit can slip in between.
      const { data: next, summary } = applySnapshot(getData(), snapshot);
      replaceData(next);
      setState((s) => ({ ...s, lastSummary: summary, lastError: null }));
      return summary;
    },
    [getData, replaceData],
  );

  const syncCalendar = useCallback<SyncApi['syncCalendar']>(
    async (opts = {}) => {
      const url = opts.url ?? getData().blackboard.calendarUrl;
      if (!url || running.current) {
        if (opts.url) throw new Error('A sync is already running. Try again in a moment.');
        return null;
      }
      running.current = true;
      setState((s) => ({ ...s, running: true, progress: { step: 'calendar', label: 'Reading your Blackboard calendar', done: 0, total: 1 }, lastError: null }));
      try {
        const events = await fetchCalendarFeed(url);
        const { data: next, summary } = applyCalendarFeed(getData(), events);
        replaceData(
          produce(next, (d) => {
            d.blackboard.calendarUrl = url;
          }),
        );
        const text = describeCalendar(summary);
        if (!opts.quiet && !opts.url) toast({ tone: 'success', message: text ? `Blackboard calendar: ${text}.` : 'Blackboard calendar — everything is up to date.', duration: 7000 });
        if (opts.quiet && (summary.itemsAdded || summary.itemsUpdated)) toast({ tone: 'success', message: `From your Blackboard calendar: ${describeCalendar({ ...summary, sessions: 0, coursesAdded: 0 })}.`, duration: 8000 });
        return summary;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, lastError: { message, code: 'calendar' } }));
        if (opts.url) throw err;
        if (!opts.quiet) toast({ tone: 'error', message: `Blackboard calendar: ${message}`, duration: 9000 });
        return null;
      } finally {
        running.current = false;
        setState((s) => ({ ...s, running: false, progress: null }));
      }
    },
    [getData, replaceData, toast],
  );

  const syncNow = useCallback<SyncApi['syncNow']>(
    async (opts = {}) => {
      const current = getData();
      const h = current.blackboard.host;
      const calendar = !IS_EXTENSION && !!current.blackboard.calendarUrl;
      if (running.current) return null;
      if (!h) {
        if (calendar) await syncCalendar({ quiet: opts.quiet });
        return null;
      }
      const viaBookmark = !IS_EXTENSION && (await detectBackend()) === 'none';
      if (viaBookmark && currentRelay()?.origin !== h) {
        // With the calendar link, "Sync now" needs no bookmark (grades come with the next click).
        if (calendar) await syncCalendar({ quiet: opts.quiet });
        else setAskBookmark(true);
        return null;
      }
      running.current = true;
      setState((s) => ({ ...s, running: true, progress: null, lastError: null }));
      try {
        // Snapshot first, so the "before sync" backup only happens when there is something to apply.
        const snapshot = await readSnapshot(h, {
          excluded: opts.courseIds ? undefined : current.blackboard.excludedCourses,
          courseIds: opts.courseIds,
          syllabus: opts.syllabus ?? current.blackboard.syllabus,
          onProgress: (p) => {
            setState((s) => ({ ...s, progress: p }));
            if (viaBookmark && p.step !== 'done') tellRelay(`Student Dashboard: ${p.label}…`);
          },
        });
        await api.createBackup('pre-sync');
        const summary = apply(snapshot);
        // The calendar link may hold the same deadlines: let it drop its copies now.
        if (calendar) window.setTimeout(() => void syncCalendar({ quiet: true }), 0);
        if (IS_EXTENSION) void clearInbox().catch(() => {});
        const text = describeSummary(summary);
        if (viaBookmark) tellRelay(`✓ Student Dashboard synced${text ? `: ${text}` : ' — everything is up to date'}. You can close this tab.`);
        if (!opts.quiet) {
          toast({ tone: 'success', message: text ? `Blackboard synced: ${text}.` : 'Blackboard synced — everything is up to date.', duration: 7000 });
          if (summary.partial.length) toast({ tone: 'warning', message: `Some of ${summary.partial.join(', ')} could not be read from Blackboard.`, duration: 9000 });
        }
        return summary;
      } catch (err) {
        const code = err instanceof BlackboardError ? err.code : 'error';
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, lastError: { message, code } }));
        if (viaBookmark) tellRelay(code === 'auth' ? 'Log in to Blackboard, then click the bookmark again.' : `Student Dashboard could not sync: ${message}`);
        if (!opts.quiet) toast({ tone: code === 'auth' ? 'warning' : 'error', message: code === 'auth' ? 'Log in to Blackboard, then sync again.' : `Sync failed: ${message}`, duration: 8000 });
        return null;
      } finally {
        running.current = false;
        setState((s) => ({ ...s, running: false, progress: null }));
      }
    },
    [apply, getData, syncCalendar, toast],
  );

  // Website: the calendar link is re-read on opening (and when the tab comes back after a while).
  const calendarUrl = data.blackboard.calendarUrl;
  useEffect(() => {
    if (IS_EXTENSION || !calendarUrl) return;
    const maybe = () => {
      const last = Date.parse(getData().blackboard.calendarSync ?? '') || 0;
      if (Date.now() - last > CALENDAR_SYNC_AFTER_MS) void syncCalendar({ quiet: true });
    };
    maybe();
    const onVisible = () => document.visibilityState === 'visible' && maybe();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [calendarUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply what the background worker fetched (extension), at launch and whenever it finishes.
  const applyInbox = useCallback(async () => {
    if (!IS_EXTENSION || running.current) return;
    try {
      const [inbox, background] = await Promise.all([getInbox(), getBackgroundStatus()]);
      setState((s) => ({ ...s, background: background ?? null }));
      const current = getData();
      if (!inbox || !current.blackboard.host || inbox.snapshot.host !== current.blackboard.host) return;
      if (current.blackboard.lastSync && Date.parse(inbox.snapshot.fetchedAt) <= Date.parse(current.blackboard.lastSync)) {
        await clearInbox();
        return;
      }
      const summary = apply(inbox.snapshot);
      await clearInbox();
      const text = describeSummary(summary);
      if (text) toast({ tone: 'success', message: `From Blackboard: ${text}.`, duration: 8000 });
    } catch (err) {
      console.warn('[inbox]', err);
    }
  }, [apply, getData, toast]);

  useEffect(() => {
    if (!host) return;
    void applyInbox();
    if (!IS_EXTENSION) return;
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === 'inbox-updated') void applyInbox();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [host, applyInbox]);

  useEffect(() => {
    if (IS_EXTENSION || !host) return;
    const { autoSync, lastSync } = getData().blackboard;
    if (!autoSync || Date.now() - (Date.parse(lastSync ?? '') || 0) < WEB_SYNC_AFTER_MS) return;
    let cancelled = false;
    void detectBackend().then(async (backend) => {
      if (cancelled || backend !== 'bridge') return;
      const summary = await syncNow({ syllabus: false, quiet: true });
      const text = summary ? describeSummary(summary) : '';
      if (text) toast({ tone: 'success', message: `From Blackboard: ${text}.`, duration: 8000 });
    });
    return () => {
      cancelled = true;
    };
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  // Website: a click on the bookmark on Blackboard syncs, unless a Connect Blackboard screen is
  // open (it handles the click) or the setup is not finished yet.
  useEffect(() => {
    if (IS_EXTENSION) return;
    const handle = (relay: Relay) => {
      if (relayClaimed()) return;
      const d = getData();
      if (!d.profile.onboardedAt || !d.blackboard.host) {
        tellRelay('Connected. Go back to Student Dashboard to finish setting it up.');
        return;
      }
      if (!takeSession(relay)) return;
      if (relay.origin !== d.blackboard.host) {
        tellRelay(`This is not the Blackboard Student Dashboard syncs with (${d.blackboard.host}).`);
        toast({ tone: 'warning', message: `The bookmark was clicked on ${relay.origin}, not on your Blackboard.`, duration: 8000 });
        return;
      }
      setAskBookmark(false);
      void syncNow();
    };
    const linked = currentRelay();
    if (linked) handle(linked);
    return onRelay(handle);
  }, [getData, syncNow, toast]);

  const value = useMemo<SyncApi>(() => ({ ...state, syncNow, applyFetched: apply, syncCalendar }), [state, syncNow, apply, syncCalendar]);
  return (
    <SyncContext.Provider value={value}>
      {children}
      {askBookmark && host && <BookmarkPrompt host={host} onClose={() => setAskBookmark(false)} />}
    </SyncContext.Provider>
  );
}
