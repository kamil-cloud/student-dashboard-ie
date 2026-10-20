/**
 * Small records shared between the dashboard page and the extension's background worker.
 * The background worker never writes the app data itself (the open dashboard is its only
 * writer); it leaves the latest Blackboard snapshot in an "inbox" that the dashboard applies.
 */
import { sanitizeData } from '../lib/sanitize';
import type { AppData } from '../lib/types';
import type { BbSnapshot } from '../integrations/blackboard/types';
import * as db from './db';

export interface Inbox {
  snapshot: BbSnapshot;
  at: string;
}

export interface BackgroundStatus {
  state: 'ok' | 'logged-out' | 'no-permission' | 'error';
  at: string;
  message?: string;
}

export const getInbox = () => db.get<Inbox>('meta', 'inbox');
export const setInbox = (inbox: Inbox) => db.put('meta', inbox, 'inbox');
export const clearInbox = () => db.del('meta', 'inbox');

export const getBackgroundStatus = () => db.get<BackgroundStatus>('meta', 'bgStatus');
export const setBackgroundStatus = (s: BackgroundStatus) => db.put('meta', s, 'bgStatus');

export async function getList(key: string): Promise<string[]> {
  const v = await db.get<string[]>('meta', key);
  return Array.isArray(v) ? v : [];
}

export async function addToList(key: string, values: string[], max = 1000): Promise<void> {
  if (values.length === 0) return;
  const list = await getList(key);
  await db.put('meta', [...list, ...values].slice(-max), key);
}

export const getValue = <T>(key: string) => db.get<T>('meta', key);
export const setValue = (key: string, value: unknown) => db.put('meta', value, key);

/** The saved app data, read-only (null before the first save). */
export async function readAppData(): Promise<AppData | null> {
  const stored = await db.get<{ json: string }>('kv', 'data');
  if (!stored?.json) return null;
  try {
    return sanitizeData(JSON.parse(stored.json)).data;
  } catch {
    return null;
  }
}

/** A dashboard the website handed over to the extension ("Continue in the extension"). */
export interface Handoff {
  data: AppData;
  /** Where to pick up: the setup wizard's Blackboard step, or Settings → Connect Blackboard. */
  resume: 'blackboard' | 'connect' | null;
  at: string;
}

export const setHandoff = (h: Handoff) => db.put('meta', h, 'handoff');

/** The pending hand-over, if the student just asked for it (it is removed either way). */
export async function takeHandoff(): Promise<Handoff | null> {
  const h = await db.get<Handoff>('meta', 'handoff');
  if (!h) return null;
  await db.del('meta', 'handoff');
  return Date.now() - Date.parse(h.at) < 10 * 60 * 1000 ? h : null;
}

/** True until the student starts using this dashboard (nothing that a hand-over would overwrite). */
export function isBlank(d: AppData | null): boolean {
  return !d || (!d.profile.onboardedAt && d.courses.length === 0 && d.items.length === 0);
}
