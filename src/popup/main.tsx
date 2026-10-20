/**
 * Toolbar popup: today's classes, what's due next and the sync status — at a glance, without
 * opening the dashboard. Read-only.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, ArrowUpRight, CalendarCheck2, GraduationCap, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { applySnapshot } from '../integrations/blackboard/apply';
import { courseColor } from '../components/common';
import { todayStr } from '../lib/dates';
import { timeAgo } from '../lib/format';
import { classesOn, dueLabel, isOverdue, isTask, sortByDue, upcoming } from '../lib/schedule';
import type { AppData } from '../lib/types';
import { getBackgroundStatus, getInbox, readAppData, type BackgroundStatus } from '../platform/meta';
import '../styles/app.css';
import '../styles/web.css';

function openDashboard(hash = '') {
  chrome.runtime.sendMessage({ type: 'open-app', hash }).catch(() => window.open(chrome.runtime.getURL(`app.html${hash}`)));
  window.close();
}

/** App data plus anything the background sync fetched that the dashboard has not applied yet. */
async function load(): Promise<AppData | null> {
  const data = await readAppData();
  if (!data) return null;
  const inbox = await getInbox().catch(() => undefined);
  if (inbox && data.blackboard.host === inbox.snapshot.host && Date.parse(inbox.snapshot.fetchedAt) > Date.parse(data.blackboard.lastSync ?? '')) {
    return applySnapshot(data, inbox.snapshot).data;
  }
  return data;
}

function Popup() {
  const [data, setData] = useState<AppData | null | undefined>(undefined);
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const now = new Date();

  const refresh = () => {
    void load().then(setData);
    void getBackgroundStatus().then((s) => setStatus(s ?? null));
  };
  useEffect(refresh, []);

  useEffect(() => {
    const pref = data?.settings.theme ?? 'dark';
    const resolved = pref === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
    document.documentElement.dataset.theme = resolved;
  }, [data?.settings.theme]);

  if (data === undefined) {
    return (
      <div className="pp pp-center">
        <Loader2 className="spin muted" size={18} />
      </div>
    );
  }
  if (data === null || (!data.profile.onboardedAt && data.courses.length === 0)) {
    return (
      <div className="pp pp-center pp-empty">
        <div className="brand-mark">
          <GraduationCap size={18} strokeWidth={2.2} />
        </div>
        <strong>Welcome to Student Dashboard</strong>
        <span className="muted small">Set it up in a minute: import your transcript and connect Blackboard.</span>
        <button className="btn btn-primary btn-md" onClick={() => openDashboard()} data-testid="pp-setup">
          Get started
        </button>
      </div>
    );
  }

  const today = todayStr();
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const classes = classesOn(today, data.courses, data.semesters).sort((a, b) => (a.start ?? '99').localeCompare(b.start ?? '99'));
  const tasks = data.items.filter(isTask);
  const overdue = sortByDue(tasks.filter((i) => i.status !== 'completed' && isOverdue(i, now)));
  const next = [...overdue, ...upcoming(tasks, 60, now)].slice(0, 6);
  const bb = data.blackboard;
  const loggedOut = status?.state === 'logged-out' && Date.parse(status.at) > Date.parse(bb.lastSync ?? '');

  const sync = async () => {
    setSyncing(true);
    try {
      await chrome.runtime.sendMessage({ type: 'sync-now' });
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  return (
    <div className="pp" data-testid="popup">
      <header className="pp-head">
        <div className="brand-mark">
          <GraduationCap size={16} strokeWidth={2.2} />
        </div>
        <div className="pp-title">
          <strong>{data.profile.firstName ? `Hi ${data.profile.firstName}` : 'Student Dashboard'}</strong>
          <span className="muted small">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => openDashboard()} data-testid="pp-open">
          Open <ArrowUpRight size={14} />
        </button>
      </header>

      <section className="pp-section">
        <h3>Today</h3>
        {classes.length === 0 ? (
          <p className="pp-none">No classes today.</p>
        ) : (
          classes.map((c) => (
            <button key={c.key} className="pp-row" onClick={() => openDashboard(`#/courses/${c.course.id}`)}>
              <span className="pp-time">{c.start ? c.start : 'Async'}</span>
              <span className="pp-bar" style={{ background: courseColor(c.course.color) }} />
              <span className="pp-main">
                <span className="pp-name">{c.course.name}</span>
                <span className="pp-sub">
                  {c.room ? (
                    <>
                      <MapPin size={11} /> {c.room}
                    </>
                  ) : (
                    c.label
                  )}
                  {c.title ? ` · ${c.title}` : ''}
                </span>
              </span>
            </button>
          ))
        )}
      </section>

      <section className="pp-section">
        <h3>Next up</h3>
        {next.length === 0 ? (
          <p className="pp-none">
            <CalendarCheck2 size={14} /> Nothing due in the next two months.
          </p>
        ) : (
          next.map((it) => {
            const course = it.courseId ? courses.get(it.courseId) : undefined;
            const due = dueLabel(it, now);
            return (
              <button key={it.id} className="pp-row" onClick={() => openDashboard(course ? `#/courses/${course.id}` : '#/assignments')} data-testid="pp-task">
                <span className="pp-dot" style={{ background: course ? courseColor(course.color) : 'var(--text-3)' }} />
                <span className="pp-main">
                  <span className="pp-name">{it.title}</span>
                  <span className="pp-sub">{course ? course.code || course.name : 'No course'}</span>
                </span>
                <span className={`pp-due is-${due.tone}`}>{due.text}</span>
              </button>
            );
          })
        )}
      </section>

      {bb.host && (
        <footer className="pp-foot">
          {loggedOut ? (
            <span className="pp-warn">
              <AlertTriangle size={13} /> Log in to Blackboard to sync
            </span>
          ) : (
            <span className="muted small">Blackboard · synced {timeAgo(bb.lastSync, now)}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => void sync()} disabled={syncing} data-testid="pp-sync">
            <RefreshCw size={13} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </footer>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
