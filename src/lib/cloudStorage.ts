/**
 * Website storage: the signed-in student's data lives in the database (Supabase), so it is the
 * same on every browser and device, and nothing personal is kept in this browser.
 *
 *  - `dashboards`: one row per student (their whole dashboard as JSON) with a revision number.
 *    A save only succeeds if nobody saved since this tab last read it (another device), so one
 *    device never silently overwrites the other: the newer data is loaded instead.
 *  - `backups`: snapshots (daily, and before imports, restores and resets).
 * Row Level Security on both tables limits every request to the student's own rows.
 */
import { supabase } from '../platform/supabase';
import { APP_VERSION } from '../platform/env';
import type { BackupKind, LoadResult, StorageApi } from './storage';
import { counts, download, errText, pickFile, stamp } from './storageUtil';

const MAX_AUTO_BACKUPS = 10;
const MAX_OTHER_BACKUPS = 15;
const AUTO_BACKUP_EVERY_MS = 20 * 60 * 60 * 1000;

interface DashboardRow {
  data: unknown;
  revision: number;
}

interface BackupRow {
  name: string;
  kind: string;
  created_at: string;
  data: unknown;
  course_count: number | null;
  item_count: number | null;
}

/** Revision of the row as last read or written by this tab (null: no row yet). */
let revision: number | null = null;
let lastJson = '';

async function userId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are logged out. Log in again to save your changes.');
  return id;
}

async function readRow(): Promise<DashboardRow | null> {
  const { data, error } = await supabase().from('dashboards').select('data, revision').maybeSingle<DashboardRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function pruneBackups() {
  const { data, error } = await supabase().from('backups').select('name, kind').order('created_at', { ascending: false });
  if (error || !data) return;
  const auto = data.filter((b) => b.kind === 'auto');
  const other = data.filter((b) => b.kind !== 'auto');
  const extra = [...auto.slice(MAX_AUTO_BACKUPS), ...other.slice(MAX_OTHER_BACKUPS)].map((b) => b.name as string);
  if (extra.length) await supabase().from('backups').delete().in('name', extra);
}

async function writeBackup(kind: BackupKind, json: string): Promise<string> {
  const now = new Date();
  const name = `${kind}-${stamp(now)}-${Math.random().toString(36).slice(2, 6)}`;
  const c = counts(json);
  const { error } = await supabase()
    .from('backups')
    .insert({ user_id: await userId(), name, kind, created_at: now.toISOString(), data: JSON.parse(json), course_count: c.courseCount, item_count: c.itemCount });
  if (error) throw new Error(error.message);
  await pruneBackups();
  return name;
}

async function maybeAutoBackup(json: string) {
  try {
    const c = counts(json);
    if (!c.courseCount && !c.itemCount) return;
    const { data } = await supabase().from('backups').select('created_at').eq('kind', 'auto').order('created_at', { ascending: false }).limit(1);
    const last = data?.[0]?.created_at as string | undefined;
    if (last && Date.now() - Date.parse(last) < AUTO_BACKUP_EVERY_MS) return;
    await writeBackup('auto', json);
  } catch (err) {
    console.warn('[backup] automatic backup failed:', err);
  }
}

function toResult(row: DashboardRow | null): LoadResult {
  revision = row?.revision ?? null;
  if (!row) {
    lastJson = '';
    return { status: 'empty' };
  }
  lastJson = JSON.stringify(row.data);
  return { status: 'ok', data: row.data };
}

export const cloudApi: StorageApi = {
  async load() {
    const res = toResult(await readRow());
    if (res.status === 'ok') void maybeAutoBackup(lastJson);
    return res;
  },

  async checkRemote() {
    const { data, error } = await supabase().from('dashboards').select('revision').maybeSingle<{ revision: number }>();
    if (error || !data || data.revision === revision) return null;
    return toResult(await readRow());
  },

  async save(json) {
    if (json === lastJson) return { ok: true, savedAt: new Date().toISOString() };
    try {
      const sb = supabase();
      const data = JSON.parse(json) as unknown;
      const savedAt = new Date().toISOString();
      if (revision === null) {
        const { data: rows, error } = await sb.from('dashboards').insert({ user_id: await userId(), data, revision: 1, updated_at: savedAt }).select('revision');
        if (error?.code === '23505') return { ok: false, conflict: true };
        if (error) return { ok: false, error: error.message };
        revision = (rows?.[0]?.revision as number | undefined) ?? 1;
      } else {
        const { data: rows, error } = await sb
          .from('dashboards')
          .update({ data, revision: revision + 1, updated_at: savedAt })
          .eq('revision', revision)
          .select('revision');
        if (error) return { ok: false, error: error.message };
        if (!rows?.length) return { ok: false, conflict: true };
        revision = rows[0].revision as number;
      }
      lastJson = json;
      return { ok: true, savedAt };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  },

  // The tab is closing: nothing can be sent reliably any more. Changes are saved 0.3 s after each
  // edit and when the tab is hidden, so at most the very last keystrokes can be lost.
  saveSync() {
    return false;
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
    const { data, error } = await supabase()
      .from('backups')
      .select('name, kind, created_at, course_count, item_count')
      .order('created_at', { ascending: false });
    if (error) return { ok: false, backups: [], error: error.message };
    return {
      ok: true,
      backups: (data as Omit<BackupRow, 'data'>[]).map((b) => ({
        name: b.name,
        kind: b.kind,
        createdAt: b.created_at,
        size: 0,
        courseCount: b.course_count,
        itemCount: b.item_count,
      })),
    };
  },

  async createBackup(kind) {
    try {
      const row = await readRow();
      if (!row) return { ok: true, name: null };
      return { ok: true, name: await writeBackup(kind, JSON.stringify(row.data)) };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  },

  async readBackup(name) {
    const { data, error } = await supabase().from('backups').select('data').eq('name', name).maybeSingle<{ data: unknown }>();
    if (error) return { ok: false, error: error.message };
    return data ? { ok: true, content: JSON.stringify(data.data) } : { ok: false, error: 'Backup not found' };
  },

  async revealData() {
    return false;
  },

  async getInfo() {
    return { version: APP_VERSION, dataFile: 'Your account (online)', backupDir: 'Your account (online)', platform: 'web' };
  },

  async setTheme() {
    return true;
  },

  onMenu() {
    return () => {};
  },
};

/** Forget what this tab knows about the signed-in student's data (on log out). */
export function resetCloudState(): void {
  revision = null;
  lastJson = '';
}
