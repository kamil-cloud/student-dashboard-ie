import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, AlertTriangle, Bell, BellOff, Check, GraduationCap, Sun, X } from 'lucide-react';
import { CourseTag } from './common';
import { useEditors } from './editors';
import { useToast } from './feedback';
import { useItemActions } from './ItemRow';
import { computeNotices, dueLabel, dueReminders, type Notice, type NoticeKind } from '../lib/schedule';
import { useStore } from '../lib/store';
import { IS_EXTENSION } from '../platform/env';

const NOTICE_META: Record<NoticeKind, { label: string; icon: typeof Bell }> = {
  overdue: { label: 'Overdue', icon: AlertTriangle },
  today: { label: 'Due today', icon: Sun },
  tomorrow: { label: 'Due tomorrow', icon: AlarmClock },
  reminder: { label: 'Reminders', icon: Bell },
  exam: { label: 'Exams this week', icon: GraduationCap },
};

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i ? 1320 : 990;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.3);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    /* no audio */
  }
}

/** Ticks every 30 s, pops up reminders once, and keeps the "now" used by the notification list fresh. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function ReminderEngine() {
  const { data, update } = useStore();
  const toast = useToast();
  const { openItem } = useEditors();
  const now = useNow(30_000);
  const { inAppReminders, systemNotifications, reminderSound } = data.settings;

  useEffect(() => {
    const all = dueReminders(data, now);
    if (all.length === 0) return;
    update((d) => {
      d.notified = [...d.notified, ...all.map((r) => r.key)].slice(-1000);
    });
    // A reminder whose time had already passed when the task was created is recorded silently.
    const due = all.filter((r) => Date.parse(r.item.createdAt) <= r.at.getTime());
    if (due.length === 0) return;
    if (!inAppReminders) return;
    if (due.length > 3) {
      toast({ tone: 'warning', message: `You have ${due.length} reminders — open the notification bell to see them.`, duration: 8000 });
    } else {
      for (const r of due) {
        toast({
          tone: 'warning',
          message: `Reminder: ${r.item.title} — ${dueLabel(r.item, now).text.toLowerCase()}`,
          duration: 9000,
          action: { label: 'Open', onClick: () => openItem(r.item) },
        });
      }
    }
    if (reminderSound) chime();
    // In the extension, the background worker shows system notifications (even with the tab closed).
    if (systemNotifications && !IS_EXTENSION && typeof Notification !== 'undefined') {
      try {
        for (const r of due.slice(0, 3)) new Notification(r.item.title, { body: `Due ${dueLabel(r.item, now).text.toLowerCase()}`, silent: true });
      } catch {
        /* notifications unavailable */
      }
    }
  }, [now, data.items]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export function NotificationBell() {
  const { data, update, courseMap } = useStore();
  const { openItem } = useEditors();
  const { setStatus } = useItemActions();
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const notices = useMemo(() => computeNotices(data, now), [data, now]);
  const groups = useMemo(() => {
    const map = new Map<NoticeKind, Notice[]>();
    for (const n of notices) map.set(n.kind, [...(map.get(n.kind) ?? []), n]);
    return [...map.entries()];
  }, [notices]);
  const urgent = notices.some((n) => n.kind === 'overdue' || n.kind === 'today');

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      // Clicks inside modals/menus opened from the panel shouldn't close it abruptly.
      if ((t as HTMLElement).closest?.('.modal-backdrop, .menu, .toast')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dismiss = (keys: string[]) =>
    update((d) => {
      d.dismissed = [...new Set([...d.dismissed, ...keys])].slice(-1000);
    });

  return (
    <>
      <button ref={btnRef} className={`bell ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={`Notifications${notices.length ? `, ${notices.length} unread` : ''}`} aria-expanded={open} title="Notifications" data-testid="bell">
        <Bell size={17} />
        {notices.length > 0 && <span className={`bell-badge ${urgent ? 'is-urgent' : ''}`}>{notices.length > 9 ? '9+' : notices.length}</span>}
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={panelRef} className="notif-panel" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Notifications" data-testid="notif-panel">
            <header className="notif-head">
              <h2>Notifications</h2>
              {notices.length > 0 && (
                <button className="link-btn" onClick={() => dismiss(notices.map((n) => n.key))}>
                  Dismiss all
                </button>
              )}
            </header>
            {notices.length === 0 ? (
              <div className="notif-empty">
                <BellOff size={22} />
                <p>You’re all caught up.</p>
                <span className="muted small">Overdue work, today’s deadlines and reminders show up here.</span>
              </div>
            ) : (
              <div className="notif-list">
                {groups.map(([kind, list]) => {
                  const Meta = NOTICE_META[kind];
                  const Icon = Meta.icon;
                  return (
                    <section key={kind} className={`notif-group notif-${kind}`}>
                      <h3>
                        <Icon size={13} /> {Meta.label}
                      </h3>
                      {list.map((n) => (
                        <div key={n.key} className="notif-item" data-testid="notice">
                          <button className="notif-main" onClick={() => openItem(n.item)}>
                            <span className="notif-title">{n.title}</span>
                            <span className="notif-detail">
                              {n.item.courseId && <CourseTag course={courseMap.get(n.item.courseId)} compact />}
                              {n.detail}
                            </span>
                          </button>
                          <button className="notif-action" onClick={() => setStatus(n.item, 'completed')} title="Mark as completed" aria-label={`Mark ${n.title} as completed`}>
                            <Check size={15} />
                          </button>
                          <button className="notif-action" onClick={() => dismiss([n.key])} title="Dismiss" aria-label={`Dismiss ${n.title}`}>
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </section>
                  );
                })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
