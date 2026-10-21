import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarArrowDown, CalendarArrowUp, CheckCircle2, ExternalLink, FileText, Link2Off, ListChecks, Plug, RefreshCw, Smartphone } from 'lucide-react';
import { BlackboardConnect } from './BlackboardConnect';
import { BOOKMARK_NAME, BookmarkSetup } from './SyncBookmark';
import { TranscriptImport } from './TranscriptImport';
import { useNow } from './Notifications';
import { useConfirm, useToast } from './feedback';
import { Button, Card, Modal, Switch } from './ui';
import { syllabusPlacement } from '../integrations/blackboard/syllabus';
import { applyIcs, exportIcs, looksLikeDeadline, parseIcs, type IcsEvent } from '../integrations/ics';
import { formatDate, todayStr } from '../lib/dates';
import { universityPreset } from '../lib/defaults';
import { plural, timeAgo } from '../lib/format';
import { api } from '../lib/storage';
import { handoffState, useStore } from '../lib/store';
import { useSync } from '../lib/sync';
import type { University } from '../lib/types';
import { detectBackend, openLogin } from '../platform/blackboard';
import { IS_EXTENSION } from '../platform/env';

/** The browser's "install this site as an app" prompt (Chromium only). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function useInstallPrompt() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    if (IS_EXTENSION) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  return event;
}

function IcsExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useStore();
  const toast = useToast();
  const [deadlines, setDeadlines] = useState(true);
  const [classes, setClasses] = useState(true);
  const preview = useMemo(() => exportIcs(data, { deadlines, classes }).count, [data, deadlines, classes]);
  const download = async () => {
    const { ics, count } = exportIcs(data, { deadlines, classes });
    await api.exportFile(ics, `student-dashboard-${todayStr()}.ics`, 'text/calendar');
    toast({ tone: 'success', message: `Calendar file saved with ${plural(count, 'event')}. Open it to add them to your calendar app.`, duration: 7000 });
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to your calendar"
      description="Download a calendar file (.ics) and open it with Apple Calendar, Google Calendar or Outlook — on your phone too. Reminders are included."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void download()} disabled={preview === 0} data-testid="ics-download">
            Download {plural(preview, 'event')}
          </Button>
        </>
      }
    >
      <Switch checked={deadlines} onChange={setDeadlines} label="Deadlines and exams" description="Upcoming, not yet done, with their reminders." />
      <Switch checked={classes} onChange={setClasses} label="Classes" description="Upcoming class sessions with rooms." />
      <p className="muted small">The file is a snapshot: download it again after big changes. Importing it twice does not create duplicates in most calendar apps.</p>
    </Modal>
  );
}

function IcsImportModal({ events, onClose }: { events: IcsEvent[] | null; onClose: () => void }) {
  const { getData, replaceData } = useStore();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (events) setPicked(new Set(events.filter(looksLikeDeadline).map((e) => e.uid)));
  }, [events]);
  const apply = async () => {
    if (!events) return;
    await api.createBackup('pre-import');
    const res = applyIcs(getData(), events.filter((e) => picked.has(e.uid)));
    replaceData(res.data);
    toast({ tone: 'success', message: `Calendar imported: ${plural(res.added, 'new task')}${res.updated ? `, ${res.updated} updated` : ''}.` });
    onClose();
  };
  return (
    <Modal
      open={!!events}
      onClose={onClose}
      size="lg"
      title="Import a calendar file"
      description="Pick the events that are deadlines or exams. They are matched to your courses by name."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void apply()} disabled={picked.size === 0} data-testid="ics-import-confirm">
            Import {plural(picked.size, 'event')}
          </Button>
        </>
      }
    >
      <div className="bb-course-list ics-list">
        {(events ?? []).slice(0, 400).map((e) => (
          <label key={e.uid} className={`bb-course ${picked.has(e.uid) ? 'is-on' : ''}`}>
            <input
              type="checkbox"
              checked={picked.has(e.uid)}
              onChange={(ev) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (ev.target.checked) next.add(e.uid);
                  else next.delete(e.uid);
                  return next;
                })
              }
            />
            <span className="bb-course-name">{e.summary}</span>
            <span className="muted small">
              {formatDate.medium(e.date)}
              {e.time ? ` · ${e.time}` : ''}
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

export function ConnectionsCard() {
  const { data, update } = useStore();
  const sync = useSync();
  const confirm = useConfirm();
  const toast = useToast();
  const now = useNow(60_000);
  const install = useInstallPrompt();
  const [connectOpen, setConnectOpen] = useState(() => handoffState.resume === 'connect');
  /** Website without the extension: syncing goes through the bookmark. */
  const [bookmarkMode, setBookmarkMode] = useState(false);
  const [showBookmark, setShowBookmark] = useState(false);
  useEffect(() => {
    if (!IS_EXTENSION) void detectBackend().then((b) => setBookmarkMode(b === 'none'));
  }, []);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importEvents, setImportEvents] = useState<IcsEvent[] | null>(null);
  const bb = data.blackboard;
  const host = bb.host;
  const loggedOut = sync.lastError?.code === 'auth' || (sync.background?.state === 'logged-out' && Date.parse(sync.background.at) > Date.parse(bb.lastSync ?? ''));

  const pickIcs = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ics,text/calendar';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const events = parseIcs(await file.text());
      if (events.length === 0) toast({ tone: 'error', message: 'No events were found in that file.' });
      else setImportEvents(events);
    };
    input.click();
  };

  const removeCalendar = async () => {
    const ok = await confirm({
      title: 'Remove the calendar link?',
      message: 'Deadlines and classes stop updating from your Blackboard calendar. Everything already imported stays in your dashboard.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (ok)
      update((d) => {
        d.blackboard.calendarUrl = null;
        d.blackboard.calendarSync = null;
      });
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Blackboard?',
      message: 'Syncing stops. Everything already imported stays in your dashboard.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (ok) update((d) => void (d.blackboard.host = null));
  };

  return (
    <Card title="Connections" subtitle="Where your courses, deadlines and grades come from">
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">University</span>
          <span className="setting-desc">Sets grading rules and what can be imported.</span>
        </div>
        <select
          className="input select setting-select"
          value={data.settings.university}
          onChange={(e) => update((d) => void Object.assign(d.settings, universityPreset(e.target.value as University)))}
          aria-label="University"
        >
          <option value="ie">IE University</option>
          <option value="other">Another university</option>
        </select>
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <h3>
            <Plug size={15} /> Blackboard
          </h3>
        </div>
        {bb.calendarUrl && (
          <div className="conn-block" data-testid="cal-status">
            <div className="conn-status">
              {sync.lastError?.code === 'calendar' ? <AlertTriangle size={16} className="text-warning" /> : <CheckCircle2 size={16} className="text-success" />}
              <span>
                <strong>Blackboard calendar link</strong>
                <span className="muted small"> · deadlines and classes · last read {timeAgo(bb.calendarSync, now)}</span>
              </span>
            </div>
            {sync.lastError?.code === 'calendar' && <p className="conn-warn small">{sync.lastError.message}</p>}
            <div className="conn-actions">
              <Button variant="primary" size="sm" icon={<RefreshCw size={14} className={sync.running ? 'spin' : ''} />} disabled={sync.running} onClick={() => void sync.syncCalendar()} data-testid="cal-sync">
                {sync.running ? 'Reading…' : 'Update now'}
              </Button>
              <Button variant="ghost" size="sm" icon={<Link2Off size={14} />} onClick={() => void removeCalendar()} data-testid="cal-remove">
                Remove link
              </Button>
            </div>
          </div>
        )}
        {host ? (
          <div className="conn-block" data-testid="bb-connected">
            <div className="conn-status">
              {loggedOut ? <AlertTriangle size={16} className="text-warning" /> : <CheckCircle2 size={16} className="text-success" />}
              <span>
                <strong>{new URL(host).host}</strong>
                <span className="muted small">
                  {' '}
                  · last sync {timeAgo(bb.lastSync, now)}
                  {IS_EXTENSION && bb.autoSync ? ' · checks every 3 hours' : ''}
                </span>
              </span>
            </div>
            {loggedOut && (
              <p className="conn-warn small">
                Your Blackboard session has ended, so syncing is paused.{' '}
                <button type="button" className="link-button" onClick={() => void openLogin(host)}>
                  Log in to Blackboard
                </button>{' '}
                and sync again.
              </p>
            )}
            <div className="conn-actions">
              <Button variant="primary" size="sm" icon={<RefreshCw size={14} className={sync.running ? 'spin' : ''} />} disabled={sync.running} onClick={() => void sync.syncNow({ syllabus: bb.syllabus })} data-testid="sync-now">
                {sync.running ? (sync.progress?.label ?? 'Syncing…') : 'Sync now'}
              </Button>
              <Button variant="secondary" size="sm" icon={<ListChecks size={14} />} onClick={() => setConnectOpen(true)}>
                Choose courses
              </Button>
              <Button variant="ghost" size="sm" icon={<ExternalLink size={14} />} onClick={() => void openLogin(host)}>
                Open Blackboard
              </Button>
              <Button variant="ghost" size="sm" icon={<Link2Off size={14} />} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            {bookmarkMode && (
              <p className="muted small" data-testid="bm-hint">
                To sync, click <strong>{BOOKMARK_NAME}</strong> in your bookmarks while you are on Blackboard.{' '}
                <button type="button" className="link-button" onClick={() => setShowBookmark((v) => !v)}>
                  {showBookmark ? 'Hide' : 'Add the bookmark to this browser'}
                </button>
              </p>
            )}
            {bookmarkMode && showBookmark && <BookmarkSetup />}
            {IS_EXTENSION && <Switch checked={bb.autoSync} onChange={(v) => update((d) => void (d.blackboard.autoSync = v))} label="Sync automatically" description="Every few hours while your browser is open, using your Blackboard session." />}
            {syllabusPlacement(host) && !bookmarkMode && <Switch checked={bb.syllabus} onChange={(v) => update((d) => void (d.blackboard.syllabus = v))} label="Read grade weights from syllabi" description="When you sync by hand: a small window opens briefly for each course." />}
          </div>
        ) : (
          <div className="conn-block">
            <p className="muted small">
              {bb.calendarUrl ? 'Your grades, professors and rooms can come from Blackboard too.' : 'Import your courses, class sessions, deadlines and grades, and keep them up to date.'}
            </p>
            <div className="conn-actions">
              <Button variant={bb.calendarUrl ? 'secondary' : 'primary'} size="sm" icon={<Plug size={14} />} onClick={() => setConnectOpen(true)} data-testid="connect-bb">
                {bb.calendarUrl ? 'Import grades too' : 'Connect Blackboard'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {data.settings.university === 'ie' && (
        <div className="subsection">
          <div className="subsection-head">
            <h3>
              <FileText size={15} /> Transcript
            </h3>
          </div>
          <div className="conn-block">
            <p className="muted small">Import a newer transcript (PDF) at the end of each semester to update final grades. Nothing is duplicated, and your own edits are kept.</p>
            <div className="conn-actions">
              <Button variant="secondary" size="sm" icon={<FileText size={14} />} onClick={() => setTranscriptOpen(true)} data-testid="open-transcript">
                Import transcript
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="subsection">
        <div className="subsection-head">
          <h3>
            <CalendarArrowUp size={15} /> Calendar apps
          </h3>
        </div>
        <div className="conn-block">
          <p className="muted small">Put your deadlines and classes in your phone’s calendar, or bring in deadlines from another calendar (Canvas, Moodle, Google…).</p>
          <div className="conn-actions">
            <Button variant="secondary" size="sm" icon={<CalendarArrowUp size={14} />} onClick={() => setExportOpen(true)} data-testid="ics-export">
              Export to calendar
            </Button>
            <Button variant="ghost" size="sm" icon={<CalendarArrowDown size={14} />} onClick={pickIcs} data-testid="ics-import">
              Import calendar file
            </Button>
          </div>
        </div>
      </div>

      {install && (
        <div className="subsection">
          <div className="conn-block">
            <div className="conn-actions">
              <Button variant="secondary" size="sm" icon={<Smartphone size={14} />} onClick={() => void install.prompt()}>
                Install as an app
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title={host ? 'Blackboard courses' : 'Connect Blackboard'} size="lg" closeOnBackdrop={false}>
        {connectOpen && <BlackboardConnect onDone={() => setConnectOpen(false)} onSkip={() => setConnectOpen(false)} skipLabel="Cancel" />}
      </Modal>
      <Modal open={transcriptOpen} onClose={() => setTranscriptOpen(false)} title="Import transcript" size="lg" closeOnBackdrop={false}>
        {transcriptOpen && <TranscriptImport onDone={() => setTranscriptOpen(false)} onSkip={() => setTranscriptOpen(false)} skipLabel="Cancel" />}
      </Modal>
      <IcsExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <IcsImportModal events={importEvents} onClose={() => setImportEvents(null)} />
    </Card>
  );
}
