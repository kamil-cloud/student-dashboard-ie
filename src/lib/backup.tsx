import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { FileJson, GitMerge, Replace } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { useConfirm, useToast } from '../components/feedback';
import { itemsToCsv } from './csv';
import { formatDate, todayStr } from './dates';
import { emptyData } from './defaults';
import { plural } from './format';
import { ImportError, mergeData, parseBackupText } from './sanitize';
import { api } from './storage';
import { useStore } from './store';
import type { AppData } from './types';

interface BackupActions {
  exportJson: () => Promise<void>;
  exportCsv: () => Promise<void>;
  startImport: () => Promise<void>;
  restoreBackup: (name: string, label: string) => Promise<void>;
  resetAll: () => Promise<void>;
  createManualBackup: () => Promise<void>;
  /** Bumped whenever the backup list may have changed. */
  version: number;
}

const BackupContext = createContext<BackupActions | null>(null);

export function useBackup(): BackupActions {
  const ctx = useContext(BackupContext);
  if (!ctx) throw new Error('useBackup must be used inside <BackupProvider>');
  return ctx;
}

interface PendingImport {
  data: AppData;
  issues: string[];
  name: string;
}

function describe(data: AppData) {
  const dates = data.items.map((i) => i.dueDate).filter((d): d is string => !!d).sort();
  return {
    semesters: data.semesters.length,
    courses: data.courses.length,
    items: data.items.length,
    range: dates.length ? `Deadlines ${formatDate.medium(dates[0])} – ${formatDate.medium(dates[dates.length - 1])}` : 'No deadlines',
  };
}

export function BackupProvider({ children }: { children: ReactNode }) {
  const { data, replaceData } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const exportJson = useCallback(async () => {
    const res = await api.exportBackup(JSON.stringify(data, null, 2), `student-dashboard-backup-${todayStr()}.json`);
    if (res.ok) toast({ tone: 'success', message: `Backup exported${res.path ? ` to ${res.path}` : ''}`, duration: 6000 });
    else if (!res.canceled) toast({ tone: 'error', message: `Export failed: ${res.error ?? 'unknown error'}` });
  }, [data, toast]);

  const exportCsv = useCallback(async () => {
    if (data.items.length === 0) {
      toast({ tone: 'warning', message: 'There are no assignments or tasks to export yet.' });
      return;
    }
    const res = await api.exportCsv(itemsToCsv(data), `student-dashboard-tasks-${todayStr()}.csv`);
    if (res.ok) toast({ tone: 'success', message: `CSV exported${res.path ? ` to ${res.path}` : ''}`, duration: 6000 });
    else if (!res.canceled) toast({ tone: 'error', message: `Export failed: ${res.error ?? 'unknown error'}` });
  }, [data, toast]);

  const startImport = useCallback(async () => {
    const res = await api.importBackup();
    if (res.canceled) return;
    if (!res.ok || res.content === undefined) {
      toast({ tone: 'error', message: `Could not open that file: ${res.error ?? 'unknown error'}` });
      return;
    }
    try {
      const parsed = parseBackupText(res.content);
      setMode(data.courses.length === 0 && data.items.length === 0 ? 'replace' : 'merge');
      setPending({ ...parsed, name: res.name ?? 'backup.json' });
    } catch (err) {
      toast({ tone: 'error', message: err instanceof ImportError ? err.message : `That file could not be imported: ${String(err)}`, duration: 7000 });
    }
  }, [data.courses.length, data.items.length, toast]);

  const applyImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const backup = await api.createBackup('pre-import');
      if (!backup.ok) {
        const go = await confirm({
          title: 'Couldn’t back up your current data',
          message: `Student Dashboard normally saves a safety backup before importing, but it failed (${backup.error}). Import anyway?`,
          confirmLabel: 'Import anyway',
          tone: 'danger',
        });
        if (!go) return;
      }
      if (mode === 'replace') {
        replaceData(pending.data);
        toast({ tone: 'success', message: `Imported ${plural(pending.data.courses.length, 'course')} and ${plural(pending.data.items.length, 'task')}. Your previous data was backed up.`, duration: 6000 });
      } else {
        const { data: merged, summary } = mergeData(data, pending.data);
        replaceData(merged);
        toast({
          tone: 'success',
          message: `Merged: ${summary.added} new, ${summary.updated} updated, ${summary.unchanged} unchanged records.`,
          duration: 7000,
        });
      }
      setPending(null);
      bump();
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = useCallback(
    async (name: string, label: string) => {
      const ok = await confirm({
        title: 'Restore this backup?',
        message: `Your current data will be replaced with the backup from ${label}. A copy of your current data is saved first, so you can switch back.`,
        confirmLabel: 'Restore backup',
      });
      if (!ok) return;
      const res = await api.readBackup(name);
      if (!res.ok || !res.content) {
        toast({ tone: 'error', message: `Could not read that backup: ${res.error ?? 'unknown error'}` });
        return;
      }
      try {
        const parsed = parseBackupText(res.content);
        await api.createBackup('pre-restore');
        replaceData(parsed.data);
        toast({ tone: 'success', message: `Restored backup from ${label}.` });
        bump();
      } catch (err) {
        toast({ tone: 'error', message: err instanceof ImportError ? err.message : String(err) });
      }
    },
    [confirm, replaceData, toast],
  );

  const resetAll = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete all courses, grades and tasks?',
      message: 'This clears your semesters, courses, grades, attendance and tasks from this computer. A backup is saved first and can be restored from the list of automatic backups.',
      confirmLabel: 'Delete everything',
      tone: 'danger',
      requireText: 'DELETE',
    });
    if (!ok) return;
    const backup = await api.createBackup('pre-reset');
    if (!backup.ok) {
      toast({ tone: 'error', message: `Reset cancelled — the safety backup failed: ${backup.error}` });
      return;
    }
    replaceData({ ...emptyData(), settings: { ...data.settings, currentSemesterId: null } });
    toast({ tone: 'success', message: 'All data cleared. A backup was saved just in case.' });
    bump();
  }, [confirm, data.settings, replaceData, toast]);

  const createManualBackup = useCallback(async () => {
    const res = await api.createBackup('manual');
    if (res.ok && res.name) toast({ tone: 'success', message: 'Backup created.' });
    else if (res.ok) toast({ message: 'Nothing to back up yet.' });
    else toast({ tone: 'error', message: `Backup failed: ${res.error}` });
    bump();
  }, [toast]);

  const incoming = pending ? describe(pending.data) : null;
  const current = describe(data);

  return (
    <BackupContext.Provider value={{ exportJson, exportCsv, startImport, restoreBackup, resetAll, createManualBackup, version }}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title="Import backup"
        description={pending?.name}
        closeOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={() => void applyImport()} disabled={busy} data-testid="confirm-import">
              {mode === 'replace' ? 'Replace my data' : 'Merge into my data'}
            </Button>
          </>
        }
      >
        {incoming && (
          <>
            <div className="import-summary">
              <FileJson size={20} />
              <div>
                <strong>{plural(incoming.courses, 'course')}</strong> · {plural(incoming.items, 'task')} · {plural(incoming.semesters, 'semester')}
                <div className="muted small">{incoming.range}</div>
              </div>
            </div>
            {pending && pending.issues.length > 0 && (
              <div className="import-issues">
                Some entries were invalid and will be skipped: {pending.issues.join('; ')}.
              </div>
            )}
            <div className="import-options" role="radiogroup" aria-label="Import mode">
              <label className={`import-option ${mode === 'merge' ? 'is-active' : ''}`}>
                <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <GitMerge size={18} />
                <span>
                  <span className="import-option-title">Merge (recommended)</span>
                  <span className="import-option-desc">Add what’s new from the backup and keep everything you already have ({plural(current.courses, 'course')}, {plural(current.items, 'task')}).</span>
                </span>
              </label>
              <label className={`import-option ${mode === 'replace' ? 'is-active' : ''}`}>
                <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <Replace size={18} />
                <span>
                  <span className="import-option-title">Replace</span>
                  <span className="import-option-desc">Swap your current data (and settings) for the backup’s contents.</span>
                </span>
              </label>
            </div>
            <p className="muted small">A safety backup of your current data is created automatically before importing.</p>
          </>
        )}
      </Modal>
    </BackupContext.Provider>
  );
}
