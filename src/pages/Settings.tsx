import { useEffect, useState } from 'react';
import { Archive, CalendarRange, Download, FileSpreadsheet, HardDrive, Monitor, Moon, Plus, RotateCcw, ShieldCheck, Sun, Trash2, Upload } from 'lucide-react';
import { Button, Card, IconButton, PageHeader, Segmented, Switch } from '../components/ui';
import { NumberField } from '../components/NumberField';
import { useEditors } from '../components/editors';
import { useToast } from '../components/feedback';
import { useBackup } from '../lib/backup';
import { formatDate } from '../lib/dates';
import { SIMPLE_GPA_TABLE, US_GPA_TABLE } from '../lib/defaults';
import { formatSize, inputNumber, round } from '../lib/format';
import { formatGrade, fromScale, GPA_LABEL, SCALE_LABEL, SCALE_MAX, sortBands, toScale } from '../lib/grades';
import { parseNumber } from '../lib/parse';
import { REMINDER_LABEL } from '../lib/schedule';
import { api, type AppInfo, type BackupInfo } from '../lib/storage';
import { ConnectionsCard } from '../components/Connections';
import { SafariStorageTip } from '../components/StorageTip';
import { IS_EXTENSION } from '../platform/env';
import { useStore } from '../lib/store';
import { useConfirm } from '../components/feedback';
import { resetCloudState } from '../lib/cloudStorage';
import { goTo } from '../lib/paths';
import { supabase } from '../platform/supabase';

/** GDPR: the student erases their account and everything saved with it, by themselves. */
function DeleteAccount() {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      message: 'This permanently erases your account and everything saved with it: courses, grades, deadlines and backups. Export a backup first if you want to keep a copy.',
      confirmLabel: 'Delete my account',
      tone: 'danger',
      requireText: 'DELETE',
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase().rpc('delete_my_account');
    if (error) {
      setBusy(false);
      toast({ tone: 'error', message: `Your account could not be deleted: ${error.message}` });
      return;
    }
    await supabase().auth.signOut({ scope: 'local' }).catch(() => {});
    resetCloudState();
    goTo('landing', { replace: true, hash: '' });
  };
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">Delete my account</span>
        <span className="setting-desc">Erases your account and all your data for good, backups included.</span>
      </div>
      <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void run()} disabled={busy} data-testid="delete-account">
        Delete my account
      </Button>
    </div>
  );
}
import type { GpaScale, GradeScale, ReminderOffset, Settings as SettingsT, ThemePref } from '../lib/types';

const KIND_LABEL: Record<string, string> = {
  auto: 'Automatic',
  session: 'After session',
  manual: 'Manual',
  'pre-import': 'Before import',
  'pre-restore': 'Before restore',
  'pre-reset': 'Before reset',
  'pre-sync': 'Before sync',
};

const fmtNum = (v: number | null) => inputNumber(v);

function GpaTableEditor() {
  const { data, update } = useStore();
  const toast = useToast();
  const table = sortBands(data.settings.gpaTable);
  const setBand = (index: number, patch: Partial<{ letter: string; min: number; points: number }>) =>
    update((d) => {
      const sorted = sortBands(d.settings.gpaTable);
      Object.assign(sorted[index], patch);
      d.settings.gpaTable = sorted;
    });
  return (
    <div className="gpa-table">
      <div className="gpa-row gpa-head muted small">
        <span>Letter</span>
        <span>From (%)</span>
        <span>Points</span>
        <span />
      </div>
      {table.map((b, i) => (
        <div key={`${i}-${b.letter}`} className="gpa-row" data-testid="gpa-band">
          <input className="input input-sm" value={b.letter} maxLength={8} aria-label={`Band ${i + 1} letter`} onChange={(e) => e.target.value.trim() && setBand(i, { letter: e.target.value.trim() })} />
          <NumberField className="input-sm-num" value={b.min} ariaLabel={`${b.letter} minimum percent`} parse={(raw) => { const r = parseNumber(raw, { label: 'Minimum', max: 100 }); return r.ok && r.value === null ? { ok: false, error: 'Required' } : r; }} format={fmtNum} onCommit={(v) => v !== null && setBand(i, { min: v })} />
          <NumberField className="input-sm-num" value={b.points} ariaLabel={`${b.letter} points`} parse={(raw) => { const r = parseNumber(raw, { label: 'Points', max: 10 }); return r.ok && r.value === null ? { ok: false, error: 'Required' } : r; }} format={fmtNum} onCommit={(v) => v !== null && setBand(i, { points: v })} />
          <IconButton
            label={`Remove ${b.letter}`}
            size="sm"
            tone="danger"
            disabled={table.length <= 2}
            onClick={() =>
              update((d) => {
                d.settings.gpaTable = sortBands(d.settings.gpaTable).filter((_, j) => j !== i);
              })
            }
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <div className="gpa-actions">
        <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => update((d) => void d.settings.gpaTable.push({ letter: 'New', min: 0, points: 0 }))}>
          Add band
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            update((d) => void (d.settings.gpaTable = US_GPA_TABLE.map((b) => ({ ...b }))));
            toast({ message: 'US standard table restored' });
          }}
        >
          US standard
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            update((d) => void (d.settings.gpaTable = SIMPLE_GPA_TABLE.map((b) => ({ ...b }))));
            toast({ message: 'Simple A/B/C/D/F table applied' });
          }}
        >
          Simple A–F
        </Button>
      </div>
    </div>
  );
}

export function Settings() {
  const { data, update } = useStore();
  const backup = useBackup();
  const { openSemesters } = useEditors();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const s = data.settings;
  const scale = s.gradeScale;

  const set = <K extends keyof SettingsT>(key: K, value: SettingsT[K]) =>
    update((d) => {
      d.settings[key] = value;
    });

  useEffect(() => {
    void api.getInfo().then(setInfo);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void api.listBackups().then((r) => !cancelled && setBackups(r.backups));
    return () => {
      cancelled = true;
    };
  }, [backup.version]);

  const scaleParse = (label: string) => (raw: string) => {
    const r = parseNumber(raw, { label, max: SCALE_MAX[scale] });
    return r.ok && r.value === null ? ({ ok: false, error: `Enter a ${label.toLowerCase()}` } as const) : r;
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" subtitle="Connections, grading, reminders and backups" />

      <ConnectionsCard />

      <Card title="Appearance">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Theme</span>
            <span className="setting-desc">Dark by default; System follows your device.</span>
          </div>
          <Segmented<ThemePref>
            label="Theme"
            value={s.theme}
            onChange={(v) => set('theme', v)}
            options={[
              { value: 'dark', label: <><Moon size={14} /> Dark</> },
              { value: 'light', label: <><Sun size={14} /> Light</> },
              { value: 'system', label: <><Monitor size={14} /> System</> },
            ]}
          />
        </div>
      </Card>

      <Card title="Grading">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Grade scale</span>
            <span className="setting-desc">How grades are entered and shown. Existing grades convert automatically.</span>
          </div>
          <Segmented<GradeScale>
            label="Grade scale"
            value={scale}
            onChange={(v) => set('gradeScale', v)}
            options={(['ten', 'twenty', 'hundred'] as GradeScale[]).map((v) => ({ value: v, label: SCALE_LABEL[v] }))}
          />
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">GPA scale</span>
            <span className="setting-desc">{GPA_LABEL[s.gpaScale]} — weighted by credits.</span>
          </div>
          <select className="input select setting-select" value={s.gpaScale} onChange={(e) => set('gpaScale', e.target.value as GpaScale)} aria-label="GPA scale">
            {(['four', 'ten', 'twenty', 'hundred'] as GpaScale[]).map((v) => (
              <option key={v} value={v}>
                {GPA_LABEL[v]}
              </option>
            ))}
          </select>
        </div>
        {s.gpaScale === 'four' && (
          <div className="setting-block">
            <div className="setting-text">
              <span className="setting-label">Grade-point conversion</span>
              <span className="setting-desc">Course percentage → letter and points. Adjust it to match your university’s official table.</span>
            </div>
            <GpaTableEditor />
          </div>
        )}
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Passing grade</span>
            <span className="setting-desc">Grades below this are highlighted.</span>
          </div>
          <div className="setting-input-row">
            <NumberField className="setting-input" value={round(toScale(s.passPercent, scale), 2)} ariaLabel="Passing grade" parse={scaleParse('Passing grade')} format={fmtNum} onCommit={(v) => v !== null && set('passPercent', fromScale(v, scale))} />
            <span className="muted small">/ {SCALE_MAX[scale]}</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Default target grade</span>
            <span className="setting-desc">Used for courses without their own target.</span>
          </div>
          <div className="setting-input-row">
            <NumberField className="setting-input" value={round(toScale(s.defaultTargetPercent, scale), 2)} ariaLabel="Default target grade" parse={scaleParse('Target')} format={fmtNum} onCommit={(v) => v !== null && set('defaultTargetPercent', fromScale(v, scale))} />
            <span className="muted small">/ {SCALE_MAX[scale]}</span>
          </div>
        </div>
      </Card>

      <Card title="Calendar & attendance">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Week starts on</span>
          </div>
          <Segmented<0 | 1>
            label="Week starts on"
            value={s.weekStartsOn}
            onChange={(v) => set('weekStartsOn', v)}
            options={[
              { value: 1, label: 'Monday' },
              { value: 0, label: 'Sunday' },
            ]}
          />
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Minimum attendance</span>
            <span className="setting-desc">You’ll be warned when a course drops below it.</span>
          </div>
          <div className="setting-input-row">
            <NumberField
              className="setting-input"
              value={s.minAttendance}
              ariaLabel="Minimum attendance"
              parse={(raw) => {
                const r = parseNumber(raw, { label: 'Attendance', max: 100 });
                return r.ok && r.value === null ? { ok: false, error: 'Enter a percentage' } : r;
              }}
              format={fmtNum}
              onCommit={(v) => v !== null && set('minAttendance', v)}
            />
            <span className="muted small">%</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Semesters</span>
            <span className="setting-desc">Rename semesters, set dates and choose the current one.</span>
          </div>
          <Button variant="secondary" icon={<CalendarRange size={16} />} onClick={openSemesters}>
            Manage semesters
          </Button>
        </div>
      </Card>

      <Card title="Reminders">
        <Switch checked={s.inAppReminders} onChange={(v) => set('inAppReminders', v)} label="In-app reminders" description="Pop up a reminder inside the app when a deadline’s reminder time arrives." />
        <Switch checked={s.reminderSound} onChange={(v) => set('reminderSound', v)} label="Reminder sound" description="Play a short chime with reminders." />
        <Switch
          checked={s.systemNotifications}
          onChange={(v) => {
            set('systemNotifications', v);
            if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
          }}
          label="Desktop notifications"
          description={IS_EXTENSION ? 'Reminders and new grades as system notifications, even when the dashboard is closed.' : 'Reminders as system notifications while the dashboard is open.'}
        />
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Default reminder</span>
            <span className="setting-desc">Pre-selected for new deadlines.</span>
          </div>
          <select className="input select setting-select" value={s.defaultReminder} onChange={(e) => set('defaultReminder', e.target.value as ReminderOffset)} aria-label="Default reminder">
            {(Object.keys(REMINDER_LABEL) as ReminderOffset[]).map((r) => (
              <option key={r} value={r}>
                {REMINDER_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card
        title="Backup & data"
        subtitle={IS_EXTENSION ? 'Everything is stored in this browser — no account, no server. Export a backup to move your data to another device.' : 'Everything is saved to your private account, on every device you log in from. Only you can see it.'}
      >
        {IS_EXTENSION && <SafariStorageTip />}
        <div className="backup-actions">
          <Button variant="primary" icon={<Download size={16} />} onClick={() => void backup.exportJson()} data-testid="export-backup">
            Export backup
          </Button>
          <Button variant="secondary" icon={<Upload size={16} />} onClick={() => void backup.startImport()} data-testid="import-backup">
            Import backup
          </Button>
          <Button variant="secondary" icon={<FileSpreadsheet size={16} />} onClick={() => void backup.exportCsv()}>
            Export CSV
          </Button>
          <Button variant="ghost" icon={<Archive size={16} />} onClick={() => void backup.createManualBackup()}>
            Back up now
          </Button>
        </div>
        {IS_EXTENSION && (
          <Switch
            checked={s.backupDownloads}
            onChange={(v) => set('backupDownloads', v)}
            label="Weekly backup file"
            description="Save a copy to Downloads › Student Dashboard backups once a week, in case this browser profile is ever lost."
          />
        )}
        <div className="subsection">
          <div className="subsection-head">
            <h3>
              <ShieldCheck size={15} /> Automatic backups
            </h3>
            <span className="muted small">Saved daily and before imports, restores and resets</span>
          </div>
          {backups === null ? (
            <p className="muted small">Loading…</p>
          ) : backups.length === 0 ? (
            <p className="muted small">No backups yet — one is created automatically the next time the app starts with data.</p>
          ) : (
            <ul className="backup-list">
              {backups.slice(0, 8).map((b) => {
                const label = formatDate.dateTime(b.createdAt);
                return (
                  <li key={b.name} className="backup-row">
                    <span className="backup-date">{label}</span>
                    <span className="backup-kind">{KIND_LABEL[b.kind] ?? b.kind}</span>
                    <span className="backup-meta">
                      {b.courseCount !== null ? `${b.courseCount} courses · ${b.itemCount ?? 0} tasks` : ''}
                      {b.size > 0 ? ` · ${formatSize(b.size)}` : ''}
                    </span>
                    <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => void backup.restoreBackup(b.name, label)}>
                      Restore
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {info && (
          <div className="subsection">
            <div className="subsection-head">
              <h3>
                <HardDrive size={15} /> Data location
              </h3>
            </div>
            <div className="path-row">
              <code className="path">{info.dataFile}</code>
            </div>
            {IS_EXTENSION && <p className="muted small">Removing the extension deletes this data — export a backup first.</p>}
          </div>
        )}
      </Card>

      <Card title="Danger zone" className="danger-card">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Delete all data</span>
            <span className="setting-desc">Removes every semester, course, grade and task. A backup is saved first.</span>
          </div>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void backup.resetAll()} disabled={data.courses.length === 0 && data.items.length === 0 && data.semesters.length === 0}>
            Delete all data
          </Button>
        </div>
        {!IS_EXTENSION && <DeleteAccount />}
      </Card>

      <p className="footnote">
        Student Dashboard {info?.version ?? ''} · {IS_EXTENSION ? 'Browser extension' : 'Web app'} · {IS_EXTENSION ? 'Works offline · ' : ''}Pass mark {formatGrade(s.passPercent, scale, true)}
      </p>
    </div>
  );
}
