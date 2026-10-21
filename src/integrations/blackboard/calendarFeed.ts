/**
 * The Blackboard calendar link (Blackboard › Calendar › Calendar settings › Share calendar): an
 * iCalendar feed of every course's due dates and class schedule, one year back and ahead. It is
 * the simplest way to connect Blackboard — paste a link once, on any device — and it is re-read
 * whenever the dashboard opens. It has no grades (those come from the bookmark or the transcript).
 *
 * Merge rules (pure, idempotent):
 *  - Short or all-day events, and events named like deadlines, become tasks (`bbcal:<uid>`);
 *    from today on only, so last year's due dates do not show up as overdue.
 *  - Longer events repeated under the same name are a course's classes: they become that
 *    course's sessions (the course is created if needed). Courses already synced through the
 *    bookmark keep Blackboard's own sessions.
 *  - Dates the student changed are kept; tasks Blackboard also gave through the bookmark are
 *    not duplicated.
 */
import { produce, type Draft } from 'immer';
import { addDays, toDateStr } from '../../lib/dates';
import { newCourse, newItem, uid } from '../../lib/defaults';
import type { AppData, ClassSession, Course, Item, SessionMode } from '../../lib/types';
import { nameSimilarity, normalizeName } from '../common';
import { type IcsEvent } from '../ics';
import { classifyKind, cleanCourseName, parseSession } from './parse';
import type { BbCalendarItem } from './types';

const ID_PREFIX = 'bbcal:';
/** Sessions this long ago are not kept (the schedule is for what is coming). */
const SESSIONS_FROM_DAYS = -60;

/**
 * The calendar link as pasted (webcal:// or https://), or null if it is not one. Only https
 * addresses of a calendar file (.ics) are accepted (http://localhost too in test builds).
 */
export function normalizeFeedUrl(input: string): string | null {
  const text = input.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!text || text.length > 600) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname) && import.meta.env?.VITE_ALLOW_LOCALHOST === '1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  if (!/\.ics$/i.test(url.pathname)) return null;
  url.hash = '';
  return url.toString();
}

export interface CalendarSummary {
  itemsAdded: number;
  itemsUpdated: number;
  coursesAdded: number;
  sessions: number;
}

const DEADLINE_WORDS = /due|deadline|assignment|exam|quiz|test|submission|submit|upload|project|presentation|essay|report|case|problem set|homework|entrega|examen|tarea|prueba|trabajo/i;
/** IE's class sessions: "MANAGEMENT CONTROL  (Ses. 3) Live in-person ". */
const SESSION_MARK = /\(\s*Ses\.?\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/i;
const MODE_WORDS = /\b(?:live in-person|live online|in-person|online|asynchronous|as[ií]ncron[oa]|presencial)\b/gi;

type Kind = 'class' | 'deadline' | 'other';

function kindOf(e: IcsEvent): Kind {
  if (SESSION_MARK.test(e.summary) || /\b(?:live in-person|live online|asynchronous)\b/i.test(e.summary)) return 'class';
  if (e.time !== null && (e.durationMin ?? 0) >= 30 && !DEADLINE_WORDS.test(e.summary)) return 'class';
  if (e.time !== null && (e.durationMin === null || e.durationMin <= 15)) return 'deadline';
  // All-day events: deadlines only when named like one (holidays and events are not tasks).
  return DEADLINE_WORDS.test(e.summary) ? 'deadline' : 'other';
}

/** The course a class session is for: its title without the session number and mode. */
function courseNameOf(e: IcsEvent): string {
  return cleanCourseName(e.summary.replace(SESSION_MARK, ' ').replace(MODE_WORDS, ' ').replace(/[\s:·|-]+$/g, '').replace(/\s+/g, ' ').trim());
}

/** The calendar event in Blackboard's own shape, to read it like the bookmark does. */
function asCalendarItem(e: IcsEvent): BbCalendarItem {
  const start = new Date(`${e.date}T${e.time ?? '00:00'}:00`);
  const end = e.endDate ? new Date(`${e.endDate}T${e.endTime ?? '23:59'}:00`) : new Date(start.getTime() + (e.time === null ? 23 * 60 + 59 : (e.durationMin ?? 60)) * 60_000);
  return { id: e.uid, type: 'Course', calendarId: '', calendarName: '', title: e.summary, description: e.description, location: e.location, start: start.toISOString(), end: end.toISOString() };
}

/** The course a calendar event belongs to: its code or name appears in the event. */
function courseFor(courses: Draft<Course>[], e: IcsEvent): Draft<Course> | undefined {
  const text = `${e.summary}\n${e.description}`;
  const byCode = courses.find((c) => c.code.length >= 2 && new RegExp(`\\b${c.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  if (byCode) return byCode;
  const norm = normalizeName(text);
  return courses
    .map((c) => ({ c, score: normalizeName(c.name).length >= 4 && norm.includes(normalizeName(c.name)) ? 1 : Math.max(nameSimilarity(c.name, e.summary), nameSimilarity(c.name, e.description.split('\n')[0] ?? '')) }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)[0]?.c;
}

/** The same task, already brought by Blackboard itself (the bookmark). */
function blackboardTwin(items: Draft<Item>[], title: string, date: string | null): Draft<Item> | undefined {
  return items.find((i) => i.source?.kind === 'blackboard' && i.dueDate === date && nameSimilarity(i.title, title) >= 0.8);
}

export function applyCalendarFeed(data: AppData, events: IcsEvent[], now = new Date()): { data: AppData; summary: CalendarSummary } {
  const summary: CalendarSummary = { itemsAdded: 0, itemsUpdated: 0, coursesAdded: 0, sessions: 0 };
  const today = toDateStr(now);
  const sessionsFrom = toDateStr(addDays(now, SESSIONS_FROM_DAYS));
  const stamp = now.toISOString();

  const next = produce(data, (d) => {
    // ---- classes: grouped by course name ---------------------------------------------------
    const groups = new Map<string, { name: string; events: IcsEvent[]; marked: boolean }>();
    for (const e of events) {
      if (kindOf(e) !== 'class') continue;
      const name = courseNameOf(e);
      const key = normalizeName(name);
      if (!key) continue;
      const g = groups.get(key) ?? { name, events: [], marked: false };
      g.events.push(e);
      g.marked ||= SESSION_MARK.test(e.summary);
      groups.set(key, g);
    }
    for (const group of groups.values()) {
      let course = courseFor(d.courses, { ...group.events[0], summary: group.name, description: '' });
      if (!course) {
        if (group.events.length < 2 && !group.marked) continue; // a one-off event is not a course
        d.courses.push(newCourse({ name: group.name, color: d.courses.length % 8, credits: 0 }));
        course = d.courses[d.courses.length - 1];
        summary.coursesAdded += 1;
      }
      // Blackboard's own sessions (bookmark) are richer: keep those.
      const kept = course.sessions.filter((x) => !x.extId?.startsWith(ID_PREFIX));
      if (kept.some((x) => x.extId)) {
        if (kept.length !== course.sessions.length) course.sessions = kept;
        continue;
      }
      const fresh: ClassSession[] = [];
      for (const e of group.events) {
        const parsed = parseSession(asCalendarItem(e));
        // Teams/Zoom copies of a session (a link as location, no session number) are dropped.
        if (!parsed || parsed.date < sessionsFrom) continue;
        fresh.push({
          id: uid(),
          date: parsed.date,
          start: parsed.start,
          end: parsed.end,
          room: parsed.room,
          title: parsed.topic || (parsed.mode === 'online' ? 'Live online' : parsed.label),
          mode: parsed.mode as SessionMode,
          extId: `${ID_PREFIX}${e.uid}`,
        });
      }
      fresh.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
      const sig = (list: ClassSession[]) => list.map((x) => `${x.extId}|${x.date}|${x.start}|${x.end}|${x.room}|${x.title}`).join(',');
      if (sig(course.sessions.filter((x) => x.extId?.startsWith(ID_PREFIX))) !== sig(fresh)) {
        course.sessions = [...kept, ...fresh].slice(0, 400);
        course.updatedAt = stamp;
      }
      if (!course.room) course.room = fresh.find((x) => x.room)?.room ?? '';
      summary.sessions += fresh.length;
    }

    // ---- deadlines -------------------------------------------------------------------------
    for (const e of events) {
      if (kindOf(e) !== 'deadline') continue;
      const id = `${ID_PREFIX}${e.uid}`;
      const existing = d.items.find((i) => i.source?.id === id);
      if (existing) {
        const twin = blackboardTwin(d.items, existing.title, existing.dueDate);
        if (twin) {
          // The bookmark brought the same task: keep that one, with what was done on this one.
          if (existing.status === 'completed' && twin.status !== 'completed') {
            twin.status = 'completed';
            twin.completedAt = existing.completedAt ?? stamp;
          }
          if (!twin.notes && existing.notes) twin.notes = existing.notes;
          d.items.splice(d.items.indexOf(existing), 1);
          continue;
        }
        const synced = existing.source!.synced;
        // Dates the student changed are theirs.
        if (existing.dueDate === synced.dueDate && existing.dueTime === synced.dueTime && (existing.dueDate !== e.date || existing.dueTime !== e.time)) {
          existing.dueDate = e.date;
          existing.dueTime = e.time;
          existing.updatedAt = stamp;
          summary.itemsUpdated += 1;
        }
        existing.source!.synced = { dueDate: e.date, dueTime: e.time };
        continue;
      }
      if (e.date < today || blackboardTwin(d.items, e.summary, e.date)) continue;
      const course = courseFor(d.courses, e);
      d.items.push(
        newItem({
          kind: classifyKind(e.summary),
          courseId: course?.id ?? null,
          title: e.summary,
          description: e.description.trim(),
          dueDate: e.date,
          dueTime: e.time,
          reminder: d.settings.defaultReminder,
          source: { kind: 'ics', id, synced: { dueDate: e.date, dueTime: e.time } },
        }),
      );
      summary.itemsAdded += 1;
    }
    d.blackboard.calendarSync = stamp;
  });
  return { data: next, summary };
}

/** "3 new deadlines · 2 new courses · 48 classes" */
export function describeCalendar(s: CalendarSummary): string {
  const parts: string[] = [];
  const n = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;
  if (s.itemsAdded) parts.push(n(s.itemsAdded, 'new deadline'));
  if (s.itemsUpdated) parts.push(n(s.itemsUpdated, 'date change'));
  if (s.coursesAdded) parts.push(n(s.coursesAdded, 'new course'));
  if (s.sessions) parts.push(n(s.sessions, 'class', 'classes'));
  return parts.join(' · ');
}
