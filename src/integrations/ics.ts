/**
 * Calendar files (.ics, RFC 5545).
 *  - Export: deadlines, exams and classes, with reminders, for any calendar app (phone included).
 *  - Import: events from another calendar (e.g. Canvas or Moodle's export) as deadlines.
 */
import { produce } from 'immer';
import { addDays, toDateStr } from '../lib/dates';
import { newItem } from '../lib/defaults';
import { KIND_LABEL } from '../lib/defaults';
import type { AppData, Item, ReminderOffset } from '../lib/types';
import { nameSimilarity, normalizeName } from './common';
import { classifyKind } from './blackboard/parse';

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold long lines at 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');
const utcStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
/** Floating local time: calendar apps show it at the same clock time. */
const localStamp = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

const TRIGGER: Partial<Record<ReminderOffset, string>> = { at_time: 'PT0M', '1h': '-PT1H', '3h': '-PT3H', '1d': '-P1D', '2d': '-P2D', '1w': '-P7D' };

export function exportIcs(data: AppData, opts: { deadlines: boolean; classes: boolean }, now = new Date()): { ics: string; count: number } {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Student Dashboard//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Student Dashboard'];
  const stamp = utcStamp(now);
  const today = toDateStr(now);
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  let count = 0;

  if (opts.deadlines) {
    for (const it of data.items) {
      if (!it.dueDate || it.status === 'completed' || it.kind === 'participation' || it.dueDate < today) continue;
      const course = it.courseId ? courses.get(it.courseId) : undefined;
      const label = course ? ` · ${course.code || course.name}` : '';
      lines.push('BEGIN:VEVENT', `UID:${it.id}@student-dashboard`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(`${it.title}${label}`)}`);
      if (it.dueTime) lines.push(`DTSTART:${localStamp(it.dueDate, it.dueTime)}`, 'DURATION:PT30M');
      else lines.push(`DTSTART;VALUE=DATE:${it.dueDate.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${toDateStr(addDays(new Date(`${it.dueDate}T12:00:00`), 1)).replace(/-/g, '')}`);
      const details = [KIND_LABEL[it.kind], course?.name, it.weight !== null ? `${it.weight}% of the grade` : null].filter(Boolean).join(' · ');
      lines.push(`DESCRIPTION:${esc(details)}`, `CATEGORIES:${esc(KIND_LABEL[it.kind])}`, 'TRANSP:TRANSPARENT');
      const trigger = TRIGGER[it.reminder];
      if (trigger) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)}`, `TRIGGER:${trigger}`, 'END:VALARM');
      lines.push('END:VEVENT');
      count += 1;
    }
  }
  if (opts.classes) {
    for (const c of data.courses) {
      for (const s of c.sessions) {
        if (s.date < today || !s.start || !s.end) continue;
        lines.push(
          'BEGIN:VEVENT',
          `UID:${c.id}-${s.id}@student-dashboard`,
          `DTSTAMP:${stamp}`,
          `SUMMARY:${esc(c.name)}`,
          `DTSTART:${localStamp(s.date, s.start)}`,
          `DTEND:${localStamp(s.date, s.end)}`,
          ...(s.room ? [`LOCATION:${esc(s.room)}`] : s.mode === 'online' ? ['LOCATION:Online'] : []),
          ...(s.title ? [`DESCRIPTION:${esc(s.title)}`] : []),
          'END:VEVENT',
        );
        count += 1;
      }
    }
  }
  lines.push('END:VCALENDAR');
  return { ics: `${lines.map(fold).join('\r\n')}\r\n`, count };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  /** Local date "YYYY-MM-DD". */
  date: string;
  /** Local "HH:MM", or null for all-day events. */
  time: string | null;
  durationMin: number | null;
}

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([\\;,])/g, '$1');

function parseDate(value: string, params: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  if (!m[4] || /VALUE=DATE(?!-TIME)/i.test(params)) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  if (m[7]) {
    // UTC → the student's local time.
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
    return { date: toDateStr(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  // Floating or TZID: keep the clock time (good enough for deadlines).
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const start = cur.DTSTART ? parseDate(cur.DTSTART.value, cur.DTSTART.params) : null;
      const end = cur.DTEND ? parseDate(cur.DTEND.value, cur.DTEND.params) : null;
      if (start && cur.SUMMARY) {
        let durationMin: number | null = null;
        if (start.time && end?.time && end.date === start.date) {
          const [h1, m1] = start.time.split(':').map(Number);
          const [h2, m2] = end.time.split(':').map(Number);
          durationMin = h2 * 60 + m2 - (h1 * 60 + m1);
        }
        events.push({
          uid: cur.UID?.value || `${cur.SUMMARY.value}-${start.date}`,
          summary: unescape(cur.SUMMARY.value).trim().slice(0, 200),
          description: unescape(cur.DESCRIPTION?.value ?? '').slice(0, 2000),
          location: unescape(cur.LOCATION?.value ?? '').slice(0, 120),
          date: start.date,
          time: start.time,
          durationMin,
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const [name, ...params] = line.slice(0, idx).split(';');
      cur[name.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(';') };
    }
  }
  return events;
}

const DEADLINE_WORDS = /due|deadline|assignment|exam|quiz|test|submission|submit|project|presentation|essay|report|entrega|examen|tarea|prueba|trabajo/i;

/** Events that look like deadlines are pre-selected; long recurring lectures are not. */
export function looksLikeDeadline(e: IcsEvent): boolean {
  return DEADLINE_WORDS.test(e.summary) || e.durationMin === null || e.durationMin <= 15;
}

export function applyIcs(data: AppData, events: IcsEvent[]): { data: AppData; added: number; updated: number } {
  let added = 0;
  let updated = 0;
  const next = produce(data, (d) => {
    for (const e of events) {
      const id = `ics:${e.uid}`;
      // Course: the one whose name or code appears in the event title.
      const course =
        d.courses.find((c) => c.code.length >= 2 && new RegExp(`\\b${c.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(e.summary)) ??
        d.courses
          .map((c) => ({ c, score: normalizeName(e.summary).includes(normalizeName(c.name)) ? 1 : nameSimilarity(c.name, e.summary) }))
          .filter((x) => x.score >= 0.5)
          .sort((a, b) => b.score - a.score)[0]?.c;
      const existing = d.items.find((i) => i.source?.id === id);
      if (existing) {
        if (existing.dueDate !== e.date || existing.dueTime !== e.time) {
          existing.dueDate = e.date;
          existing.dueTime = e.time;
          existing.updatedAt = new Date().toISOString();
          updated += 1;
        }
        continue;
      }
      const item: Item = newItem({
        kind: classifyKind(e.summary),
        courseId: course?.id ?? null,
        title: e.summary,
        description: [e.description, e.location].filter(Boolean).join('\n').trim(),
        dueDate: e.date,
        dueTime: e.time,
        reminder: d.settings.defaultReminder,
        source: { kind: 'ics', id, synced: { dueDate: e.date, dueTime: e.time } },
      });
      d.items.push(item);
      added += 1;
    }
  });
  return { data: next, added, updated };
}
