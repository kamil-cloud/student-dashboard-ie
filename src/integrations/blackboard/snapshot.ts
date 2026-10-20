/**
 * Reads everything the dashboard needs from Blackboard for the chosen courses.
 *
 * Endpoints and quirks (verified on IE University's Blackboard Learn Ultra):
 *  - memberships: v1 /users/{id}/courses — `courseId` there is the course PRIMARY KEY;
 *  - courses: v3, organisations (`organization: true`) are not courses;
 *  - gradebook: v2 columns + v2 /gradebook/users/{id} (the value is in `displayGrade.score`);
 *  - calendar: v1 /calendars/items with at most 16 weeks per request and NO `limit` parameter
 *    (Blackboard answers 400 to either); `calendarId` is the course primary key.
 */
import { BlackboardClient, BlackboardError, mapLimit } from './client';
import { academicYearOf, parseTerm } from './parse';
import type { BbCalendarItem, BbColumn, BbCourse, BbCourseChoice, BbCourseData, BbGrade, BbSnapshot, BbTerm, SyncProgress } from './types';

const DAY = 86_400_000;
/** Blackboard refuses calendar ranges over 16 weeks (112 days); stay below. */
const CALENDAR_WINDOW_DAYS = 105;
const STAFF_ROLES = /^(Instructor|TeachingAssistant|CourseBuilder|Grader|Instructor.*)$/i;

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});

export async function whoAmI(client: BlackboardClient): Promise<string> {
  const me = await client.get<Raw>('/learn/api/public/v1/users/me?fields=id');
  const id = str(me.id);
  if (!id) throw new BlackboardError('Blackboard did not say who is logged in.', 'format');
  return id;
}

function toTerm(raw: Raw): BbTerm {
  const duration = obj(obj(raw.availability).duration);
  return {
    id: str(raw.id),
    name: str(raw.name),
    start: str(duration.start) || null,
    end: str(duration.end) || null,
  };
}

function toCourse(raw: Raw): BbCourse {
  return { id: str(raw.id), externalId: str(raw.courseId), name: str(raw.name).trim(), termId: str(raw.termId) || null };
}

/** The student's courses, with the current academic year's ones flagged. */
export async function listCourseChoices(client: BlackboardClient, userId: string, now = new Date()): Promise<BbCourseChoice[]> {
  const memberships = await client.list<Raw>(`/learn/api/public/v1/users/${encodeURIComponent(userId)}/courses?fields=courseId,courseRoleId,availability&limit=200`);
  const ids = memberships
    .filter((m) => str(obj(m.availability).available) === 'Yes' && !STAFF_ROLES.test(str(m.courseRoleId)))
    .map((m) => str(m.courseId))
    .filter(Boolean);
  const rawCourses = await mapLimit([...new Set(ids)], 6, async (id) => {
    try {
      return await client.get<Raw>(`/learn/api/public/v3/courses/${encodeURIComponent(id)}?fields=id,courseId,name,termId,organization,availability`);
    } catch (err) {
      if (err instanceof BlackboardError && err.code === 'auth') throw err;
      return null; // a course we may not open: skip it
    }
  });
  const courses = rawCourses
    .filter((c): c is Raw => !!c && c.organization !== true && str(obj(c.availability).available) !== 'No')
    .map(toCourse)
    .filter((c) => c.id && c.name);

  const termIds = [...new Set(courses.map((c) => c.termId).filter((t): t is string => !!t))];
  const terms = new Map<string, BbTerm>();
  await mapLimit(termIds, 6, async (id) => {
    try {
      terms.set(id, toTerm(await client.get<Raw>(`/learn/api/public/v1/terms/${encodeURIComponent(id)}?fields=id,name,availability`)));
    } catch (err) {
      if (err instanceof BlackboardError && err.code === 'auth') throw err;
    }
  });

  const thisYear = academicYearOf(now);
  return courses
    .map((course) => {
      const term = course.termId ? (terms.get(course.termId) ?? null) : null;
      const info = parseTerm(term);
      const datesCover = !!term?.start && !!term.end && Date.parse(term.start) - 30 * DAY <= now.getTime() && now.getTime() <= Date.parse(term.end) + 30 * DAY;
      return { course, term, current: info.academicYear === thisYear || datesCover };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || a.course.name.localeCompare(b.course.name));
}

function toColumn(raw: Raw): BbColumn {
  const grading = obj(raw.grading);
  const possible = obj(raw.score).possible;
  return {
    id: str(raw.id),
    name: str(raw.name).trim() || str(raw.displayName).trim(),
    description: str(raw.description).slice(0, 4000),
    possible: typeof possible === 'number' && Number.isFinite(possible) ? possible : null,
    due: str(grading.due) || null,
    gradingType: str(grading.type) || null,
    available: str(obj(raw.availability).available) !== 'No',
  };
}

function toGrade(raw: Raw): BbGrade {
  const display = obj(raw.displayGrade);
  const score = typeof display.score === 'number' ? display.score : typeof raw.score === 'number' ? raw.score : null;
  return {
    columnId: str(raw.columnId),
    status: str(raw.status) || null,
    scaleType: str(display.scaleType) || null,
    score: score !== null && Number.isFinite(score) ? score : null,
    text: str(display.text) || str(raw.text) || null,
    exempt: raw.exempt === true,
    date: str(raw.lastRelevantDate) || str(raw.firstRelevantDate) || null,
  };
}

function toCalendarItem(raw: Raw): BbCalendarItem {
  return {
    id: str(raw.id),
    type: str(raw.type),
    calendarId: str(raw.calendarId),
    calendarName: str(raw.calendarName),
    title: str(raw.title),
    description: str(raw.description).slice(0, 2000),
    location: str(raw.location),
    start: str(raw.start),
    end: str(raw.end),
  };
}

/** Default calendar range: from the start of the current half-year to about seven months later. */
export function defaultRange(now = new Date()): { since: string; until: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const halfStart = m >= 7 ? new Date(y, 7, 25) : m === 0 ? new Date(y - 1, 7, 25) : new Date(y, 0, 1);
  const since = new Date(Math.min(halfStart.getTime(), now.getTime() - 14 * DAY));
  const until = new Date(Math.max(since.getTime() + 2 * CALENDAR_WINDOW_DAYS * DAY, now.getTime() + 120 * DAY));
  return { since: since.toISOString(), until: until.toISOString() };
}

export async function readCalendar(client: BlackboardClient, range: { since: string; until: string }): Promise<{ items: BbCalendarItem[]; complete: boolean }> {
  const windows: [number, number][] = [];
  const end = Date.parse(range.until);
  for (let t = Date.parse(range.since); t < end; t += CALENDAR_WINDOW_DAYS * DAY) windows.push([t, Math.min(t + CALENDAR_WINDOW_DAYS * DAY, end)]);
  let complete = true;
  const byId = new Map<string, BbCalendarItem>();
  await mapLimit(windows, 2, async ([a, b]) => {
    const q = `since=${encodeURIComponent(new Date(a).toISOString())}&until=${encodeURIComponent(new Date(b).toISOString())}`;
    try {
      // NB: no `limit` here — Blackboard rejects it on this endpoint.
      const items = await client.list<Raw>(`/learn/api/public/v1/calendars/items?${q}`);
      for (const raw of items) {
        const it = toCalendarItem(raw);
        if (it.id) byId.set(it.id, it);
      }
    } catch (err) {
      if (err instanceof BlackboardError && err.code === 'auth') throw err;
      complete = false;
    }
  });
  return { items: [...byId.values()], complete };
}

export interface SnapshotOptions {
  client: BlackboardClient;
  /** Courses to read (primary keys). Default: this academic year's courses minus `excluded`. */
  courseIds?: string[];
  excluded?: string[];
  range?: { since: string; until: string };
  /** Reads syllabi (extension only); fills `syllabus` on each course. */
  readSyllabi?: (courses: BbCourseData[], progress: (done: number, total: number, label: string) => void) => Promise<void>;
  onProgress?: (p: SyncProgress) => void;
  now?: Date;
}

export async function fetchSnapshot(opts: SnapshotOptions): Promise<BbSnapshot> {
  const { client } = opts;
  const now = opts.now ?? new Date();
  const progress = (p: SyncProgress) => opts.onProgress?.(p);
  const errors: string[] = [];

  progress({ step: 'session', done: 0, total: 1, label: 'Checking your Blackboard session' });
  const userId = await whoAmI(client);

  progress({ step: 'courses', done: 0, total: 1, label: 'Finding your courses' });
  const choices = await listCourseChoices(client, userId, now);
  const excluded = new Set(opts.excluded ?? []);
  const chosen = opts.courseIds
    ? choices.filter((c) => opts.courseIds!.includes(c.course.id))
    : choices.filter((c) => c.current && !excluded.has(c.course.id));

  let done = 0;
  const courses = await mapLimit(chosen, 3, async ({ course, term }): Promise<BbCourseData> => {
    const data: BbCourseData = { course, term, columns: [], grades: [] };
    try {
      data.columns = (await client.list<Raw>(`/learn/api/public/v2/courses/${encodeURIComponent(course.id)}/gradebook/columns?limit=200`)).map(toColumn);
      data.grades = (await client.list<Raw>(`/learn/api/public/v2/courses/${encodeURIComponent(course.id)}/gradebook/users/${encodeURIComponent(userId)}?limit=200`)).map(toGrade);
    } catch (err) {
      if (err instanceof BlackboardError && err.code === 'auth') throw err;
      data.error = err instanceof Error ? err.message : String(err);
      errors.push(`${course.name}: ${data.error}`);
    }
    done += 1;
    progress({ step: 'gradebook', done, total: chosen.length, label: `Reading deadlines and grades (${done}/${chosen.length})` });
    return data;
  });

  progress({ step: 'calendar', done: 0, total: 1, label: 'Reading your class calendar' });
  const range = opts.range ?? defaultRange(now);
  const ids = new Set(courses.map((c) => c.course.id));
  const calendar = await readCalendar(client, range);
  if (!calendar.complete) errors.push('Part of the calendar could not be read.');

  if (opts.readSyllabi && courses.length) {
    await opts.readSyllabi(courses, (d, total, label) => progress({ step: 'syllabus', done: d, total, label }));
  }
  progress({ step: 'done', done: 1, total: 1, label: 'Done' });

  return {
    version: 1,
    host: client.host,
    fetchedAt: new Date().toISOString(),
    range,
    courses,
    calendar: calendar.items.filter((i) => ids.has(i.calendarId)),
    calendarComplete: calendar.complete,
    errors,
  };
}
