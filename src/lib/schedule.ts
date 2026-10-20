import { addDays, diffDays, formatDate, parseDateStr, startOfWeek, toDateStr, todayStr } from './dates';
import type { AppData, ClassSlot, Course, Item, ReminderOffset, Semester, Weekday } from './types';

export const WEEKDAYS: { id: Weekday; short: string; long: string }[] = [
  { id: 1, short: 'Mon', long: 'Monday' },
  { id: 2, short: 'Tue', long: 'Tuesday' },
  { id: 3, short: 'Wed', long: 'Wednesday' },
  { id: 4, short: 'Thu', long: 'Thursday' },
  { id: 5, short: 'Fri', long: 'Friday' },
  { id: 6, short: 'Sat', long: 'Saturday' },
  { id: 0, short: 'Sun', long: 'Sunday' },
];
export const WEEKDAY_SHORT: Record<Weekday, string> = Object.fromEntries(WEEKDAYS.map((d) => [d.id, d.short])) as Record<Weekday, string>;

export function orderedWeekdays(weekStartsOn: 0 | 1) {
  return weekStartsOn === 1 ? WEEKDAYS : [WEEKDAYS[6], ...WEEKDAYS.slice(0, 6)];
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

export function isValidTime(t: unknown): t is string {
  if (typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function slotMinutes(s: Pick<ClassSlot, 'start' | 'end'>): number {
  return Math.max(0, timeToMinutes(s.end) - timeToMinutes(s.start));
}

/** Moment an item is due: its time, or the end of the day when no time is set. */
export function dueMoment(item: Pick<Item, 'dueDate' | 'dueTime'>): Date | null {
  if (!item.dueDate) return null;
  const d = parseDateStr(item.dueDate);
  if (item.dueTime && isValidTime(item.dueTime)) {
    const [h, m] = item.dueTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(23, 59, 59, 0);
  }
  return d;
}

export function isOverdue(item: Item, now = new Date()): boolean {
  if (item.status === 'completed') return false;
  const due = dueMoment(item);
  return !!due && due.getTime() < now.getTime();
}

/** "Overdue · 2 days", "Today 14:00", "Tomorrow", "In 5 days", "Oct 12". */
export function dueLabel(item: Pick<Item, 'dueDate' | 'dueTime' | 'status'>, now = new Date()): { text: string; tone: 'overdue' | 'soon' | 'normal' | 'done' | 'none' } {
  if (!item.dueDate) return { text: 'No due date', tone: 'none' };
  const today = toDateStr(now);
  const days = diffDays(today, item.dueDate);
  const time = item.dueTime ? ` ${item.dueTime}` : '';
  if (item.status === 'completed') return { text: formatDate.short(item.dueDate), tone: 'done' };
  const due = dueMoment(item)!;
  if (due.getTime() < now.getTime()) {
    const late = Math.max(0, -days);
    return { text: late === 0 ? `Overdue · today${time}` : late === 1 ? 'Overdue · yesterday' : `Overdue · ${late} days`, tone: 'overdue' };
  }
  if (days === 0) return { text: `Today${time}`, tone: 'soon' };
  if (days === 1) return { text: `Tomorrow${time}`, tone: 'soon' };
  if (days < 7) return { text: `In ${days} days`, tone: days <= 3 ? 'soon' : 'normal' };
  return { text: formatDate.short(item.dueDate), tone: 'normal' };
}

// ---------------------------------------------------------------------------
// Semesters
// ---------------------------------------------------------------------------

export function sortSemesters(semesters: Semester[]): Semester[] {
  return [...semesters].sort((a, b) => {
    const ka = a.startDate ?? a.createdAt.slice(0, 10);
    const kb = b.startDate ?? b.createdAt.slice(0, 10);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * The chosen current semester, else the one containing today, else the most recently started
 * one (between terms), else the next upcoming one, else the latest.
 */
export function currentSemester(data: Pick<AppData, 'semesters' | 'settings'>, today = todayStr()): Semester | null {
  const chosen = data.semesters.find((s) => s.id === data.settings.currentSemesterId);
  if (chosen) return chosen;
  const containing = data.semesters.find((s) => s.startDate && s.endDate && s.startDate <= today && today <= s.endDate);
  if (containing) return containing;
  const sorted = sortSemesters(data.semesters);
  const started = sorted.filter((s) => s.startDate && s.startDate <= today);
  if (started.length) return started[started.length - 1];
  const upcoming = sorted.find((s) => s.startDate && s.startDate > today);
  return upcoming ?? sorted[sorted.length - 1] ?? null;
}

export function semesterProgress(s: Semester, today = todayStr()): { week: number; weeks: number; fraction: number; status: 'upcoming' | 'active' | 'finished' } | null {
  if (!s.startDate || !s.endDate || s.endDate < s.startDate) return null;
  const total = diffDays(s.startDate, s.endDate) + 1;
  const weeks = Math.max(1, Math.ceil(total / 7));
  if (today < s.startDate) return { week: 0, weeks, fraction: 0, status: 'upcoming' };
  if (today > s.endDate) return { week: weeks, weeks, fraction: 1, status: 'finished' };
  const elapsed = diffDays(s.startDate, today);
  return { week: Math.floor(elapsed / 7) + 1, weeks, fraction: (elapsed + 1) / total, status: 'active' };
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export interface ClassOccurrence {
  key: string;
  date: string;
  course: Course;
  /** HH:MM, null for asynchronous sessions. */
  start: string | null;
  end: string | null;
  room: string;
  /** "Lecture", "Seminar", "Live online", "Asynchronous"… */
  label: string;
  /** Session topic, when known. */
  title: string;
  async: boolean;
}

const MODE_LABEL = { in_person: 'In person', online: 'Live online', async: 'Asynchronous' } as const;

/** Classes on a date. Dated sessions win over the weekly schedule; weekly slots respect semester dates. */
export function classesOn(date: string, courses: Course[], semesters: Semester[]): ClassOccurrence[] {
  const day = parseDateStr(date).getDay() as Weekday;
  const semById = new Map(semesters.map((s) => [s.id, s]));
  const out: ClassOccurrence[] = [];
  for (const c of courses) {
    if (c.sessions.length > 0) {
      for (const s of c.sessions) {
        if (s.date !== date) continue;
        out.push({
          key: `${c.id}:${s.id}`,
          date,
          course: c,
          start: s.start,
          end: s.end,
          room: s.room || c.room,
          label: MODE_LABEL[s.mode],
          title: s.title,
          async: s.mode === 'async' || !s.start,
        });
      }
      continue;
    }
    const sem = c.semesterId ? semById.get(c.semesterId) : undefined;
    if (sem?.startDate && date < sem.startDate) continue;
    if (sem?.endDate && date > sem.endDate) continue;
    for (const slot of c.schedule) {
      if (slot.day !== day) continue;
      out.push({
        key: `${c.id}:${slot.id}:${date}`,
        date,
        course: c,
        start: slot.start,
        end: slot.end,
        room: slot.room || c.room,
        label: slot.type.charAt(0).toUpperCase() + slot.type.slice(1),
        title: '',
        async: false,
      });
    }
  }
  return out.sort((a, b) => (a.start === null ? 1 : b.start === null ? -1 : timeToMinutes(a.start) - timeToMinutes(b.start)));
}

export function occurrenceMinutes(o: Pick<ClassOccurrence, 'start' | 'end'>): number {
  return o.start && o.end ? Math.max(0, timeToMinutes(o.end) - timeToMinutes(o.start)) : 0;
}

/** Short description of when a course meets. */
export function courseScheduleText(course: Course, today = todayStr()): string {
  if (course.sessions.length > 0) {
    const next = [...course.sessions].filter((s) => s.date >= today).sort((a, b) => (a.date + (a.start ?? '') < b.date + (b.start ?? '') ? -1 : 1))[0];
    const done = course.sessions.filter((s) => s.date < today).length;
    const base = `${done}/${course.sessions.length} sessions`;
    return next ? `${base} · next ${formatDate.weekday(next.date)} ${formatDate.short(next.date)}${next.start ? ` ${next.start}` : ' (async)'}` : `${base} · finished`;
  }
  return scheduleSummary(course.schedule);
}

export function weekDates(anchor: Date, weekStartsOn: 0 | 1): string[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(start, i)));
}

export function scheduleSummary(schedule: ClassSlot[]): string {
  if (schedule.length === 0) return 'No schedule';
  const order = [1, 2, 3, 4, 5, 6, 0];
  return [...schedule]
    .sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day) || timeToMinutes(a.start) - timeToMinutes(b.start))
    .map((s) => `${WEEKDAY_SHORT[s.day]} ${s.start}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Reminders & notifications
// ---------------------------------------------------------------------------

export const REMINDER_LABEL: Record<ReminderOffset, string> = {
  none: 'No reminder',
  at_time: 'When due',
  '1h': '1 hour before',
  '3h': '3 hours before',
  '1d': '1 day before',
  '2d': '2 days before',
  '1w': '1 week before',
};

/** When the reminder for an item should fire. Date-only items remind at 09:00. */
export function reminderMoment(item: Pick<Item, 'dueDate' | 'dueTime' | 'reminder'>): Date | null {
  if (!item.dueDate || item.reminder === 'none') return null;
  const hasTime = !!item.dueTime && isValidTime(item.dueTime);
  const base = parseDateStr(item.dueDate);
  if (hasTime) {
    const [h, m] = item.dueTime!.split(':').map(Number);
    base.setHours(h, m, 0, 0);
  } else {
    base.setHours(9, 0, 0, 0);
  }
  const t = base.getTime();
  const H = 3600_000;
  switch (item.reminder) {
    case 'at_time':
      return new Date(t);
    case '1h':
      return new Date(hasTime ? t - H : t);
    case '3h':
      return new Date(hasTime ? t - 3 * H : t);
    case '1d':
      return new Date(t - 24 * H);
    case '2d':
      return new Date(t - 48 * H);
    case '1w':
      return new Date(t - 7 * 24 * H);
  }
}

export type NoticeKind = 'overdue' | 'today' | 'tomorrow' | 'reminder' | 'exam';

export interface Notice {
  key: string;
  kind: NoticeKind;
  item: Item;
  title: string;
  detail: string;
}

const NOTICE_RANK: Record<NoticeKind, number> = { overdue: 0, today: 1, tomorrow: 2, reminder: 3, exam: 4 };

/** One notice per open item, the most urgent that applies; dismissed notices are left out. */
export function computeNotices(data: Pick<AppData, 'items' | 'dismissed'>, now = new Date()): Notice[] {
  const dismissed = new Set(data.dismissed);
  const today = toDateStr(now);
  const out: Notice[] = [];
  for (const item of data.items) {
    if (item.status === 'completed' || !item.dueDate) continue;
    const due = dueMoment(item)!;
    const days = diffDays(today, item.dueDate);
    let kind: NoticeKind | null = null;
    if (due.getTime() < now.getTime()) kind = 'overdue';
    else if (days === 0) kind = 'today';
    else if (days === 1) kind = 'tomorrow';
    else {
      const r = reminderMoment(item);
      if (r && r.getTime() <= now.getTime()) kind = 'reminder';
      else if (item.kind === 'exam' && days <= 7) kind = 'exam';
    }
    if (!kind) continue;
    const key = `${item.id}:${kind}:${item.dueDate}${item.dueTime ?? ''}`;
    if (dismissed.has(key)) continue;
    const label = dueLabel(item, now).text;
    const detail =
      kind === 'overdue' ? label : kind === 'exam' ? `Exam in ${days} days · ${formatDate.short(item.dueDate)}` : kind === 'reminder' ? `Due ${formatDate.short(item.dueDate)}${item.dueTime ? ` at ${item.dueTime}` : ''}` : `Due ${label.toLowerCase()}`;
    out.push({ key, kind, item, title: item.title, detail });
  }
  return out.sort((a, b) => NOTICE_RANK[a.kind] - NOTICE_RANK[b.kind] || (a.item.dueDate! < b.item.dueDate! ? -1 : 1));
}

/** Reminders whose time has come and that haven't popped up yet. */
export function dueReminders(data: Pick<AppData, 'items' | 'notified'>, now = new Date()): { key: string; item: Item; at: Date }[] {
  const notified = new Set(data.notified);
  const out: { key: string; item: Item; at: Date }[] = [];
  for (const item of data.items) {
    if (item.status === 'completed') continue;
    const at = reminderMoment(item);
    const due = dueMoment(item);
    if (!at || !due) continue;
    if (at.getTime() > now.getTime()) continue;
    if (due.getTime() < now.getTime() - 24 * 3600_000) continue; // long past — don't nag
    const key = `${item.id}:${at.toISOString()}`;
    if (!notified.has(key)) out.push({ key, item, at });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

/** Participation marks are grade components, not to-dos. */
export function isTask(item: Pick<Item, 'kind'>): boolean {
  return item.kind !== 'participation';
}

export function itemsDueOn(items: Item[], date: string): Item[] {
  return items.filter((i) => i.dueDate === date);
}

export function sortByDue(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const da = dueMoment(a)?.getTime() ?? Infinity;
    const db = dueMoment(b)?.getTime() ?? Infinity;
    return da - db || a.title.localeCompare(b.title);
  });
}

export function upcoming(items: Item[], days: number, now = new Date()): Item[] {
  const today = toDateStr(now);
  const end = toDateStr(addDays(now, days));
  return sortByDue(items.filter((i) => i.status !== 'completed' && i.dueDate && i.dueDate >= today && i.dueDate <= end && !isOverdue(i, now)));
}
