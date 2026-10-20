import { produce, type Draft } from 'immer';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../components/feedback';
import { IE_BLACKBOARD_HOST, emptyData } from './defaults';
import { sanitizeData } from './sanitize';
import { IS_EXTENSION } from '../platform/env';
import { acquireWriterLock } from '../platform/lock';
import { isBlank, readAppData, takeHandoff, type Handoff } from '../platform/meta';
import { OPENED_BY_BOOKMARK, waitForRelay } from '../platform/relay';
import { api } from './storage';
import type { AppData, Course, Item } from './types';

export type SaveStatus = 'saved' | 'saving' | 'error';
export type Recipe = (draft: Draft<AppData>) => void;

export interface UpdateOptions {
  /** Show an "Undo" toast; `recipe` must restore what was removed. */
  undo?: { label: string; recipe: Recipe };
}

interface Store {
  data: AppData;
  courseMap: Map<string, Course>;
  update: (recipe: Recipe, opts?: UpdateOptions) => void;
  updateItem: (id: string, recipe: (i: Draft<Item>) => void, opts?: UpdateOptions) => void;
  updateCourse: (id: string, recipe: (c: Draft<Course>) => void, opts?: UpdateOptions) => void;
  replaceData: (next: AppData) => void;
  /** The latest data, including changes not yet rendered (for read-modify-write imports). */
  getData: () => AppData;
  saveStatus: SaveStatus;
  retrySave: () => void;
  /** Save pending changes now (resolves once written, or once saving failed). */
  saveNow: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <DataProvider>');
  return ctx;
}

const SAVE_DELAY_MS = 300;

/**
 * Website: this tab was opened by the bookmark clicked on the student's own Blackboard, so it
 * becomes the dashboard (another dashboard tab steps aside, as with "Use it here").
 */
async function openedByOwnBookmark(): Promise<boolean> {
  if (!OPENED_BY_BOOKMARK) return false;
  const saved = IS_EXTENSION
    ? readAppData()
    : api.load().then((r) => (r.status === 'ok' ? sanitizeData(r.data).data : null));
  const [relay, stored] = await Promise.all([waitForRelay(4000), saved.catch(() => null)]);
  if (!relay) return false;
  const expected = stored?.blackboard.host ?? (stored?.settings.university === 'ie' ? IE_BLACKBOARD_HOST : null);
  return !expected || relay.origin === expected;
}

/** Extension: where this page load picks up after the website handed its dashboard over. */
export const handoffState: { resume: Handoff['resume'] } = { resume: null };
const RETRY_DELAY_MS = 4000;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: AppData }
  | { status: 'failed'; message: string; corruptPath?: string }
  /** Another tab is editing the data (this one has not taken over). */
  | { status: 'locked'; reason: 'busy' | 'lost' };

export interface FallbackActions {
  startFresh: () => void;
  importText: (text: string) => void;
  /** Take over editing from another tab. */
  takeOver: () => void;
}

export function DataProvider({ children, fallback }: { children: ReactNode; fallback: (s: LoadState, actions: FallbackActions) => ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const toast = useToast();

  const dataRef = useRef<AppData | null>(null);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(0);
  /** False once another tab has taken over: this tab must not write any more. */
  const writable = useRef(true);
  const [loadNonce, setLoadNonce] = useState(0);

  // ---- saving -------------------------------------------------------------
  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const data = dataRef.current;
    if (!dirty.current || !data || !writable.current) return;
    dirty.current = false;
    inFlight.current += 1;
    let ok = false;
    let conflict = false;
    try {
      const res = await api.save(JSON.stringify(data));
      ok = res.ok;
      conflict = !!res.conflict;
    } catch {
      ok = false;
    }
    inFlight.current -= 1;
    if (conflict) {
      // Saved meanwhile on another device: show that version rather than overwrite it.
      dirty.current = false;
      setSaveStatus('saved');
      const fresh = await api.load().catch(() => null);
      if (fresh?.status === 'ok' && writable.current) {
        const next = sanitizeData(fresh.data).data;
        dataRef.current = next;
        setState({ status: 'ready', data: next });
      }
      toast({ tone: 'warning', message: 'Your dashboard was changed on another device, so that version was loaded. Your last change here was not saved: please make it again.', duration: 12000 });
      return;
    }
    if (!ok) {
      dirty.current = true;
      setSaveStatus('error');
      timer.current = window.setTimeout(() => void flush(), RETRY_DELAY_MS);
    } else if (!dirty.current && inFlight.current === 0) {
      setSaveStatus('saved');
    }
  }, [toast]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveStatus((s) => (s === 'error' ? s : 'saving'));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  // Save right away when the tab is hidden, and synchronously as a last resort when it closes.
  useEffect(() => {
    const onUnload = () => {
      if (dirty.current && dataRef.current && writable.current) api.saveSync(JSON.stringify(dataRef.current));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
      else if (api.checkRemote && !dirty.current && inFlight.current === 0 && writable.current && dataRef.current) {
        // Back to this tab: pick up what was saved meanwhile on another device.
        void api.checkRemote().then((res) => {
          if (res?.status !== 'ok' || dirty.current || inFlight.current > 0 || !writable.current) return;
          const next = sanitizeData(res.data).data;
          dataRef.current = next;
          setState({ status: 'ready', data: next });
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);

  // ---- loading ------------------------------------------------------------
  const setReady = useCallback((data: AppData) => {
    dataRef.current = data;
    setState({ status: 'ready', data });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const steal = loadNonce > 0 || (await openedByOwnBookmark());
        const lock = await acquireWriterLock(
          () => {
            // Another tab took over: stop writing and step aside.
            writable.current = false;
            if (timer.current) window.clearTimeout(timer.current);
            dataRef.current = null;
            setState({ status: 'locked', reason: 'lost' });
          },
          { steal },
        );
        if (cancelled) return;
        if (lock === 'busy') {
          setState({ status: 'locked', reason: 'busy' });
          return;
        }
        writable.current = true;
        dirty.current = false;
        const res = await api.load();
        if (cancelled) return;
        // Extension: the website handed its dashboard over ("Continue in the extension").
        const handoff = IS_EXTENSION ? await takeHandoff().catch(() => null) : null;
        if (cancelled) return;
        if (handoff) {
          const stored = res.status === 'ok' || res.status === 'recovered' ? sanitizeData(res.data).data : null;
          if (res.status === 'empty' || isBlank(stored)) {
            const { data } = sanitizeData(handoff.data);
            handoffState.resume = handoff.resume;
            setReady(data);
            scheduleSave();
            toast({ tone: 'success', message: 'Your dashboard moved here from the website.', duration: 8000 });
            return;
          }
          toast({ tone: 'warning', message: 'The website’s dashboard was not moved here: this one already has your data.', duration: 10000 });
        }
        if (res.status === 'empty') {
          setReady(emptyData());
          return;
        }
        if (res.status === 'corrupt') {
          setState({
            status: 'failed',
            message: 'Your data file could not be read and no backup was found.',
            corruptPath: res.corruptPath,
          });
          return;
        }
        const { data, issues } = sanitizeData(res.data);
        setReady(data);
        if (res.status === 'recovered') {
          toast({
            tone: 'warning',
            message:
              res.from === 'safety-copy'
                ? 'Your data file was damaged or missing, so Student Dashboard restored it from its safety copy of your last save.'
                : `Your data file was damaged, so Student Dashboard restored the most recent backup (${res.from}).`,
            duration: 10000,
          });
        } else if (issues.length) {
          console.warn('[load] repaired data issues:', issues);
        }
      } catch (err) {
        if (!cancelled) setState({ status: 'failed', message: `Could not load your data: ${String(err)}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setReady, scheduleSave, toast, loadNonce]);

  // ---- mutations ----------------------------------------------------------
  const update = useCallback(
    (recipe: Recipe, opts?: UpdateOptions) => {
      const current = dataRef.current;
      if (!current) return;
      let next: AppData;
      try {
        next = produce(current, recipe);
      } catch (err) {
        console.error('[update] failed:', err);
        toast({ tone: 'error', message: 'Something went wrong — that change was not applied.' });
        return;
      }
      if (next === current) return;
      dataRef.current = next;
      setState({ status: 'ready', data: next });
      scheduleSave();
      if (opts?.undo) {
        const undo = opts.undo;
        toast({ message: undo.label, action: { label: 'Undo', onClick: () => update(undo.recipe) } });
      }
    },
    [scheduleSave, toast],
  );

  const updateItem = useCallback(
    (id: string, recipe: (i: Draft<Item>) => void, opts?: UpdateOptions) => {
      update((d) => {
        const it = d.items.find((x) => x.id === id);
        if (!it) return;
        recipe(it);
        it.updatedAt = new Date().toISOString();
      }, opts);
    },
    [update],
  );

  const updateCourse = useCallback(
    (id: string, recipe: (c: Draft<Course>) => void, opts?: UpdateOptions) => {
      update((d) => {
        const c = d.courses.find((x) => x.id === id);
        if (!c) return;
        recipe(c);
        c.updatedAt = new Date().toISOString();
      }, opts);
    },
    [update],
  );

  const replaceData = useCallback(
    (next: AppData) => {
      dataRef.current = next;
      setState({ status: 'ready', data: next });
      scheduleSave();
    },
    [scheduleSave],
  );

  const getData = useCallback(() => dataRef.current!, []);

  const retrySave = useCallback(() => {
    dirty.current = true;
    void flush();
  }, [flush]);

  const saveNow = useCallback(async () => {
    await flush();
    // A save already on its way: wait for it.
    for (let i = 0; i < 100 && inFlight.current > 0; i++) await new Promise((r) => setTimeout(r, 50));
  }, [flush]);

  const data = state.status === 'ready' ? state.data : null;
  const courses = data?.courses;
  const courseMap = useMemo(() => new Map((courses ?? []).map((c) => [c.id, c])), [courses]);

  const value = useMemo<Store | null>(
    () => (data ? { data, courseMap, update, updateItem, updateCourse, replaceData, getData, saveStatus, retrySave, saveNow } : null),
    [data, courseMap, update, updateItem, updateCourse, replaceData, getData, saveStatus, retrySave, saveNow],
  );

  if (!value) {
    return (
      <>
        {fallback(state, {
          takeOver: () => {
            setState({ status: 'loading' });
            setLoadNonce((n) => n + 1);
          },
          startFresh: () => {
            const fresh = emptyData();
            setReady(fresh);
            dirty.current = true;
            void flush();
          },
          importText: (text: string) => {
            try {
              const { data: imported } = sanitizeData(JSON.parse(text));
              setReady(imported);
              dirty.current = true;
              void flush();
              toast({ tone: 'success', message: 'Backup restored.' });
            } catch (err) {
              toast({ tone: 'error', message: `That backup could not be read: ${String(err)}` });
            }
          },
        })}
      </>
    );
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export type { LoadState };
