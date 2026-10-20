/**
 * Storage for the web app and the browser extension. Same API everywhere, so the rest of the UI
 * does not care where data is stored:
 *  - website: the student's account in the database (cloudStorage.ts);
 *  - extension: this browser's IndexedDB (below; nothing is sent to a server).
 *
 * Extension storage safety nets:
 *  - every save is a single IndexedDB transaction (atomic);
 *  - when the tab closes with unsaved changes they are written synchronously to localStorage
 *    and picked up on the next launch;
 *  - automatic daily snapshots plus snapshots before every import, restore and reset;
 *  - if the stored data is ever unreadable, the most up-to-date snapshot is restored.
 */
import * as db from '../platform/db';
import { APP_VERSION, IS_EXTENSION, notifyBackground } from '../platform/env';
import { cloudApi } from './cloudStorage';
import { counts, download, errText, latestEdit, pickFile, stamp } from './storageUtil';
import type { ThemePref } from './types';

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: unknown }
  | { status: 'recovered'; data: unknown; from: string; corruptPath: string }
  | { status: 'corrupt'; corruptPath: string };

export interface SaveResult {
  ok: boolean;
  /** The data was changed elsewhere (another device) since it was loaded: nothing was written. */
  conflict?: boolean;
  savedAt?: string;
  error?: string;
}

export interface FileResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  canceled?: boolean;
  content?: string;
  name?: string;
  error?: string;
}

export type BackupKind = 'auto' | 'manual' | 'pre-import' | 'pre-restore' | 'pre-reset' | 'pre-sync';

export interface BackupInfo {
  name: string;
  kind: string;
  createdAt: string;
  size: number;
  courseCount: number | null;
  itemCount: number | null;
}

export interface AppInfo {
  version: string;
  dataFile: string;
  backupDir: string;
  platform: string;
}

export interface StorageApi {
  load(): Promise<LoadResult>;
  /** Newer data saved elsewhere since the last load or save, if any. */
  checkRemote?(): Promise<LoadResult | null>;
  save(json: string): Promise<SaveResult>;
  saveSync(json: string): boolean;
  exportBackup(json: string, defaultName: string): Promise<FileResult>;
  exportCsv(csv: string, defaultName: string): Promise<FileResult>;
  exportFile(content: string, defaultName: string, type: string): Promise<FileResult>;
  importBackup(): Promise<ImportResult>;
  listBackups(): Promise<{ ok: boolean; backups: BackupInfo[]; error?: string }>;
  createBackup(kind: Exclude<BackupKind, 'auto'>): Promise<{ ok: boolean; name?: string | null; error?: string }>;
  readBackup(name: string): Promise<{ ok: boolean; content?: string; error?: string }>;
  revealData(): Promise<boolean>;
  getInfo(): Promise<AppInfo>;
  setTheme(theme: ThemePref): Promise<boolean>;
  onMenu(callback: (action: string) => void): () => void;
}

interface StoredData {
  json: string;
  savedAt: string;
}

interface StoredBackup {
  name: string;
  kind: BackupKind;
  createdAt: string;
  json: string;
  courseCount: number | null;
  itemCount: number | null;
}

const DATA_KEY = 'data';
const PENDING_KEY = 'sd-pending';
const MAX_AUTO_BACKUPS = 10;
const MAX_OTHER_BACKUPS = 15;
const AUTO_BACKUP_EVERY_MS = 20 * 60 * 60 * 1000;

function readPending(): StoredData | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredData;
    return typeof p.json === 'string' && typeof p.savedAt === 'string' ? p : null;
  } catch {
    return null;
  }
}

function clearPending(upTo: string) {
  try {
    const p = readPending();
    if (p && p.savedAt <= upTo) localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function pruneBackups() {
  const all = await db.getAll<StoredBackup>('backups');
  const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const auto = sorted.filter((b) => b.kind === 'auto');
  const other = sorted.filter((b) => b.kind !== 'auto');
  const extra = [...auto.slice(MAX_AUTO_BACKUPS), ...other.slice(MAX_OTHER_BACKUPS)];
  for (const b of extra) await db.del('backups', b.name);
}

async function writeBackup(kind: BackupKind, json: string): Promise<string> {
  const now = new Date();
  let name = `${kind}-${stamp(now)}`;
  const existing = new Set((await db.getAll<StoredBackup>('backups')).map((b) => b.name));
  for (let i = 1; existing.has(name); i++) name = `${kind}-${stamp(now)}-${i}`;
  await db.put('backups', { name, kind, createdAt: now.toISOString(), json, ...counts(json) } satisfies StoredBackup);
  await pruneBackups();
  return name;
}

/** A daily snapshot, taken at launch when there is data and none was taken recently. */
async function maybeAutoBackup(json: string) {
  try {
    const all = await db.getAll<StoredBackup>('backups');
    const lastAuto = all.filter((b) => b.kind === 'auto').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (lastAuto && Date.now() - Date.parse(lastAuto.createdAt) < AUTO_BACKUP_EVERY_MS) return;
    const c = counts(json);
    if (!c.courseCount && !c.itemCount) return;
    await writeBackup('auto', json);
  } catch (err) {
    console.warn('[backup] automatic backup failed:', err);
  }
}

async function recoverFromBackups(): Promise<LoadResult> {
  const all = await db.getAll<StoredBackup>('backups').catch(() => [] as StoredBackup[]);
  const candidates = all
    .map((b) => {
      try {
        return { b, data: JSON.parse(b.json) as unknown, edit: latestEdit(b.json) };
      } catch {
        return null;
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((x, y) => (x.edit === y.edit ? y.b.createdAt.localeCompare(x.b.createdAt) : x.edit < y.edit ? 1 : -1));
  const best = candidates[0];
  if (!best) return { status: 'corrupt', corruptPath: 'browser storage' };
  await db.put('kv', { json: best.b.json, savedAt: new Date().toISOString() } satisfies StoredData, DATA_KEY);
  return { status: 'recovered', data: best.data, from: best.b.name, corruptPath: '' };
}

let lastSavedAt = '';

const localApi: StorageApi = {
  async load() {
    if (!IS_EXTENSION && navigator.storage?.persist) {
      // Ask the browser not to evict our data under storage pressure.
      void navigator.storage.persisted().then((p) => (p ? true : navigator.storage.persist())).catch(() => false);
    }
    const stored = await db.get<StoredData>('kv', DATA_KEY);
    const pending = readPending();
    const candidates = [pending && (!stored || pending.savedAt > stored.savedAt) ? pending : null, stored].filter(
      (c): c is StoredData => !!c,
    );
    if (candidates.length === 0) return { status: 'empty' };
    for (const c of candidates) {
      try {
        const data = JSON.parse(c.json) as unknown;
        if (c === pending) {
          // Changes written while the tab was closing: make them permanent.
          await db.put('kv', { json: c.json, savedAt: c.savedAt } satisfies StoredData, DATA_KEY);
        }
        clearPending(c.savedAt);
        lastSavedAt = c.savedAt;
        void maybeAutoBackup(c.json);
        return { status: 'ok', data };
      } catch {
        console.error('[load] stored data unreadable, trying the next copy');
      }
    }
    return recoverFromBackups();
  },

  async save(json) {
    try {
      // Keep timestamps strictly increasing, even if the clock goes backwards.
      let savedAt = new Date().toISOString();
      if (savedAt <= lastSavedAt) savedAt = new Date(Date.parse(lastSavedAt) + 1).toISOString();
      await db.put('kv', { json, savedAt } satisfies StoredData, DATA_KEY);
      lastSavedAt = savedAt;
      clearPending(savedAt);
      notifyBackground({ type: 'data-saved' });
      return { ok: true, savedAt };
    } catch (err) {
      console.error('[save] failed:', err);
      return { ok: false, error: errText(err) };
    }
  },

  saveSync(json) {
    try {
      let savedAt = new Date().toISOString();
      if (savedAt <= lastSavedAt) savedAt = new Date(Date.parse(lastSavedAt) + 1).toISOString();
      localStorage.setItem(PENDING_KEY, JSON.stringify({ json, savedAt } satisfies StoredData));
      return true;
    } catch {
      return false;
    }
  },

  async exportBackup(json, name) {
    download(json, name, 'application/json');
    return { ok: true, path: name };
  },

  async exportCsv(csv, name) {
    download(csv, name, 'text/csv');
    return { ok: true, path: name };
  },

  async exportFile(content, name, type) {
    download(content, name, type);
    return { ok: true, path: name };
  },

  async importBackup() {
    const file = await pickFile('.json,application/json');
    if (!file) return { ok: false, canceled: true };
    if (file.size > 20 * 1024 * 1024) return { ok: false, error: 'That file is too large to be a Student Dashboard backup.' };
    try {
      return { ok: true, content: await file.text(), name: file.name };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  },

  async listBackups() {
    try {
      const all = await db.getAll<StoredBackup>('backups');
      return {
        ok: true,
        backups: all
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((b) => ({ name: b.name, kind: b.kind, createdAt: b.createdAt, size: b.json.length, courseCount: b.courseCount, itemCount: b.itemCount })),
      };
    } catch (err) {
      return { ok: false, backups: [], error: errText(err) };
    }
  },

  async createBackup(kind) {
    try {
      const stored = await db.get<StoredData>('kv', DATA_KEY);
      if (!stored) return { ok: true, name: null };
      return { ok: true, name: await writeBackup(kind, stored.json) };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  },

  async readBackup(name) {
    try {
      const b = await db.get<StoredBackup>('backups', name);
      return b ? { ok: true, content: b.json } : { ok: false, error: 'Backup not found' };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  },

  async revealData() {
    return false;
  },

  async getInfo() {
    const where = IS_EXTENSION ? 'This browser profile (extension storage)' : `This browser (${location.host || 'local'})`;
    return { version: APP_VERSION, dataFile: where, backupDir: where, platform: IS_EXTENSION ? 'extension' : 'web' };
  },

  async setTheme() {
    return true;
  },

  onMenu() {
    return () => {};
  },
};

export const api: StorageApi = IS_EXTENSION ? localApi : cloudApi;

export const isDesktop = false;
