/**
 * Defensive parsing of stored / imported data. Anything malformed is repaired or
 * dropped (and reported) instead of crashing the app.
 */
import { isValidDateStr } from './dates';
import { DEFAULT_BLACKBOARD, DEFAULT_SETTINGS, US_GPA_TABLE, uid } from './defaults';
import { LIMITS } from './parse';
import { isValidTime } from './schedule';
import type {
  AppData,
  AttendanceRecord,
  BlackboardConnection,
  CourseSources,
  Profile,
  SyncSource,
  ClassSession,
  ClassSlot,
  Course,
  GpaBand,
  Item,
  ItemKind,
  ItemStatus,
  Priority,
  ReminderOffset,
  Semester,
  Settings,
  SlotType,
  Weekday,
} from './types';

export class ImportError extends Error {}

const KINDS = new Set<ItemKind>(['assignment', 'exam', 'project', 'quiz', 'participation', 'personal']);
const STATUSES = new Set<ItemStatus>(['not_started', 'in_progress', 'completed']);
const PRIORITIES = new Set<Priority>(['low', 'medium', 'high']);
const REMINDERS = new Set<ReminderOffset>(['none', 'at_time', '1h', '3h', '1d', '2d', '1w']);
const SLOT_TYPES = new Set<SlotType>(['lecture', 'lab', 'seminar', 'tutorial', 'other']);
const ATTENDANCE = new Set(['present', 'absent', 'late', 'excused']);

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function str(v: unknown, fallback: string, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function num(v: unknown, min: number, max: number, integer = false): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < min) return null;
  const clamped = Math.min(n, max);
  return integer ? Math.round(clamped) : clamped;
}

function iso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function id(v: unknown): string {
  return typeof v === 'string' && v.trim() && v.length <= 100 ? v : uid();
}

function oneOf<T extends string>(v: unknown, set: Set<T>, fallback: T): T {
  return set.has(v as T) ? (v as T) : fallback;
}

const SOURCE_KINDS = new Set(['blackboard', 'transcript', 'ics']);

function sanitizeSource(raw: unknown): SyncSource | null {
  if (!isObj(raw) || !SOURCE_KINDS.has(raw.kind as string) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 300) return null;
  const synced: SyncSource['synced'] = {};
  if (isObj(raw.synced)) {
    for (const [k, v] of Object.entries(raw.synced).slice(0, 40)) {
      if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) synced[k] = v;
      else if (typeof v === 'string') synced[k] = v.slice(0, LIMITS.notesLength);
    }
  }
  return { kind: raw.kind as SyncSource['kind'], id: raw.id, synced, ...(raw.removed === true ? { removed: true } : {}) };
}

function sanitizeCourseSources(raw: unknown): CourseSources {
  const r = isObj(raw) ? raw : {};
  const out: CourseSources = {};
  const t = sanitizeSource(r.transcript);
  const b = sanitizeSource(r.blackboard);
  if (t) out.transcript = t;
  if (b) out.blackboard = b;
  return out;
}

function sanitizeProfile(raw: unknown): Profile {
  const p = isObj(raw) ? raw : {};
  return {
    firstName: str(p.firstName, '', 60).trim(),
    program: str(p.program, '', 40).trim(),
    onboardedAt: iso(p.onboardedAt),
  };
}

function sanitizeHost(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.origin : null;
  } catch {
    return null;
  }
}

function sanitizeBlackboard(raw: unknown): BlackboardConnection {
  const b = isObj(raw) ? raw : {};
  return {
    host: sanitizeHost(b.host),
    autoSync: typeof b.autoSync === 'boolean' ? b.autoSync : DEFAULT_BLACKBOARD.autoSync,
    lastSync: iso(b.lastSync),
    excludedCourses: arr(b.excludedCourses).filter((x): x is string => typeof x === 'string' && x.length < 100).slice(0, 200),
    syllabus: typeof b.syllabus === 'boolean' ? b.syllabus : DEFAULT_BLACKBOARD.syllabus,
  };
}

function sanitizeSettings(raw: unknown): Settings {
  const s = isObj(raw) ? raw : {};
  const table = arr(s.gpaTable)
    .filter(isObj)
    .map((b): GpaBand | null => {
      const letter = str(b.letter, '', 8).trim();
      const min = num(b.min, 0, 100);
      const points = num(b.points, 0, 100);
      return letter && min !== null && points !== null ? { letter, min, points } : null;
    })
    .filter((b): b is GpaBand => b !== null);
  return {
    theme: s.theme === 'light' || s.theme === 'system' ? s.theme : 'dark',
    gradeScale: s.gradeScale === 'twenty' || s.gradeScale === 'hundred' ? s.gradeScale : 'ten',
    gpaScale: s.gpaScale === 'ten' || s.gpaScale === 'twenty' || s.gpaScale === 'hundred' ? s.gpaScale : 'four',
    gpaTable: table.length >= 2 ? table : US_GPA_TABLE.map((b) => ({ ...b })),
    passPercent: num(s.passPercent, 0, 100) ?? DEFAULT_SETTINGS.passPercent,
    defaultTargetPercent: num(s.defaultTargetPercent, 0, 100) ?? DEFAULT_SETTINGS.defaultTargetPercent,
    weekStartsOn: s.weekStartsOn === 0 ? 0 : 1,
    minAttendance: num(s.minAttendance, 0, 100) ?? DEFAULT_SETTINGS.minAttendance,
    currentSemesterId: typeof s.currentSemesterId === 'string' ? s.currentSemesterId : null,
    inAppReminders: typeof s.inAppReminders === 'boolean' ? s.inAppReminders : true,
    systemNotifications: s.systemNotifications === true,
    reminderSound: typeof s.reminderSound === 'boolean' ? s.reminderSound : true,
    defaultReminder: oneOf(s.defaultReminder, REMINDERS, '1d'),
    university: s.university === 'ie' ? 'ie' : 'other',
    creditUnit: s.creditUnit === 'credits' ? 'credits' : 'ECTS',
    backupDownloads: s.backupDownloads === true,
  };
}

function sanitizeSemester(raw: unknown): Semester | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, '', LIMITS.nameLength).trim();
  if (!name) return null;
  const now = new Date().toISOString();
  let startDate = isValidDateStr(raw.startDate) ? raw.startDate : null;
  let endDate = isValidDateStr(raw.endDate) ? raw.endDate : null;
  if (startDate && endDate && endDate < startDate) [startDate, endDate] = [endDate, startDate];
  const createdAt = iso(raw.createdAt) ?? now;
  const extKey = typeof raw.extKey === 'string' && raw.extKey.length <= 100 ? raw.extKey : null;
  return { id: id(raw.id), name, startDate, endDate, extKey, source: sanitizeSource(raw.source), createdAt, updatedAt: iso(raw.updatedAt) ?? createdAt };
}

function sanitizeSlot(raw: unknown): ClassSlot | null {
  if (!isObj(raw)) return null;
  const day = num(raw.day, 0, 6, true);
  if (day === null || !isValidTime(raw.start) || !isValidTime(raw.end) || raw.end <= raw.start) return null;
  return {
    id: id(raw.id),
    day: day as Weekday,
    start: raw.start,
    end: raw.end,
    room: str(raw.room, '', LIMITS.shortText),
    type: oneOf(raw.type, SLOT_TYPES, 'lecture'),
  };
}

function sanitizeSession(raw: unknown): ClassSession | null {
  if (!isObj(raw) || !isValidDateStr(raw.date)) return null;
  const mode = raw.mode === 'online' || raw.mode === 'async' ? raw.mode : 'in_person';
  const timed = mode !== 'async' && isValidTime(raw.start) && isValidTime(raw.end) && (raw.end as string) > (raw.start as string);
  return {
    id: id(raw.id),
    date: raw.date,
    start: timed ? (raw.start as string) : null,
    end: timed ? (raw.end as string) : null,
    room: str(raw.room, '', LIMITS.shortText).trim(),
    title: str(raw.title, '', LIMITS.titleLength).trim(),
    mode: timed ? mode : 'async',
    extId: typeof raw.extId === 'string' && raw.extId.length <= 300 ? raw.extId : null,
  };
}

function sanitizeAttendance(raw: unknown): AttendanceRecord | null {
  if (!isObj(raw) || !isValidDateStr(raw.date) || !ATTENDANCE.has(raw.status as string)) return null;
  return { id: id(raw.id), date: raw.date, status: raw.status as AttendanceRecord['status'] };
}

function sanitizeCourse(raw: unknown): Course | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, '', LIMITS.nameLength).trim();
  if (!name) return null;
  const now = new Date().toISOString();
  const createdAt = iso(raw.createdAt) ?? now;
  return {
    id: id(raw.id),
    name,
    code: str(raw.code, '', LIMITS.shortText).trim(),
    professor: str(raw.professor, '', LIMITS.nameLength).trim(),
    credits: num(raw.credits, 0, LIMITS.credits) ?? 0,
    semesterId: typeof raw.semesterId === 'string' ? raw.semesterId : null,
    color: num(raw.color, 0, 7, true) ?? 0,
    room: str(raw.room, '', LIMITS.shortText).trim(),
    schedule: arr(raw.schedule).map(sanitizeSlot).filter((s): s is ClassSlot => s !== null),
    sessions: arr(raw.sessions)
      .map(sanitizeSession)
      .filter((s): s is ClassSession => s !== null)
      .slice(0, 400),
    gradeOverride: num(raw.gradeOverride, 0, 100),
    targetGrade: num(raw.targetGrade, 0, 100),
    countsInGpa: raw.countsInGpa !== false,
    honors: raw.honors === true,
    outcome: raw.outcome === 'pass' || raw.outcome === 'fail' ? raw.outcome : null,
    category: raw.category === 'basic' || raw.category === 'compulsory' || raw.category === 'elective' || raw.category === 'supplementary' ? raw.category : null,
    totalSessions: num(raw.totalSessions, 1, LIMITS.sessions, true),
    attendance: arr(raw.attendance).map(sanitizeAttendance).filter((a): a is AttendanceRecord => a !== null),
    notes: str(raw.notes, '', LIMITS.notesLength),
    subjectCode: str(raw.subjectCode, '', 20).trim(),
    sources: sanitizeCourseSources(raw.sources),
    createdAt,
    updatedAt: iso(raw.updatedAt) ?? createdAt,
  };
}

function sanitizeItem(raw: unknown, courseIds: Set<string>): Item | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title, '', LIMITS.titleLength).trim();
  if (!title) return null;
  const now = new Date().toISOString();
  const createdAt = iso(raw.createdAt) ?? now;
  const kind = oneOf(raw.kind, KINDS, 'assignment');
  const status = oneOf(raw.status, STATUSES, 'not_started');
  const maxScore = num(raw.maxScore, 0.01, LIMITS.maxScore);
  let score = num(raw.score, 0, LIMITS.maxScore);
  if (score !== null && maxScore !== null && score > maxScore) score = maxScore;
  const courseId = typeof raw.courseId === 'string' && courseIds.has(raw.courseId) ? raw.courseId : null;
  return {
    id: id(raw.id),
    kind,
    courseId,
    title,
    description: str(raw.description, '', LIMITS.notesLength),
    dueDate: isValidDateStr(raw.dueDate) ? raw.dueDate : null,
    dueTime: isValidTime(raw.dueTime) ? raw.dueTime : null,
    status,
    priority: oneOf(raw.priority, PRIORITIES, 'medium'),
    notes: str(raw.notes, '', LIMITS.notesLength),
    weight: num(raw.weight, 0, 100),
    score: maxScore === null ? null : score,
    maxScore,
    reminder: oneOf(raw.reminder, REMINDERS, 'none'),
    estimatedHours: num(raw.estimatedHours, 0, LIMITS.hours),
    completedAt: status === 'completed' ? (iso(raw.completedAt) ?? iso(raw.updatedAt) ?? createdAt) : null,
    source: sanitizeSource(raw.source),
    createdAt,
    updatedAt: iso(raw.updatedAt) ?? createdAt,
  };
}

function dedupe<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.map((x) => {
    if (seen.has(x.id)) x = { ...x, id: uid() };
    seen.add(x.id);
    return x;
  });
}

export interface SanitizeResult {
  data: AppData;
  issues: string[];
}

export function sanitizeData(raw: unknown): SanitizeResult {
  if (!isObj(raw)) throw new ImportError('This file does not contain Student Dashboard data.');
  if (!Array.isArray(raw.courses) && !Array.isArray(raw.items)) {
    throw new ImportError('This file has no courses or tasks — it is not a Student Dashboard backup.');
  }
  if (typeof raw.version === 'number' && raw.version > 1) throw new ImportError('This backup was made by a newer version of Student Dashboard.');

  const issues: string[] = [];
  const count = (label: string, before: number, after: number) => {
    if (after < before) issues.push(`${before - after} invalid ${label} skipped`);
  };

  const rawSem = arr(raw.semesters);
  const semesters = dedupe(rawSem.map(sanitizeSemester).filter((s): s is Semester => s !== null));
  count('semester(s)', rawSem.length, semesters.length);
  const semIds = new Set(semesters.map((s) => s.id));

  const rawCourses = arr(raw.courses);
  const courses = dedupe(rawCourses.map(sanitizeCourse).filter((c): c is Course => c !== null)).map((c) =>
    c.semesterId && !semIds.has(c.semesterId) ? { ...c, semesterId: null } : c,
  );
  count('course(s)', rawCourses.length, courses.length);
  const courseIds = new Set(courses.map((c) => c.id));

  const rawItems = arr(raw.items);
  const items = dedupe(rawItems.map((i) => sanitizeItem(i, courseIds)).filter((i): i is Item => i !== null));
  count('task(s)', rawItems.length, items.length);

  const settings = sanitizeSettings(raw.settings);
  if (settings.currentSemesterId && !semIds.has(settings.currentSemesterId)) settings.currentSemesterId = null;

  const itemIds = new Set(items.map((i) => i.id));
  const keys = (v: unknown) =>
    arr(v)
      .filter((k): k is string => typeof k === 'string' && itemIds.has(k.split(':')[0]))
      .slice(-1000);

  return {
    data: {
      version: 1,
      settings,
      profile: sanitizeProfile(raw.profile),
      blackboard: sanitizeBlackboard(raw.blackboard),
      semesters,
      courses,
      items,
      notified: keys(raw.notified),
      dismissed: keys(raw.dismissed),
    },
    issues,
  };
}

export function parseBackupText(text: string): SanitizeResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError('This file is not valid JSON. Choose a backup exported from Student Dashboard.');
  }
  return sanitizeData(json);
}

export interface MergeSummary {
  added: number;
  updated: number;
  unchanged: number;
}

function mergeList<T extends { id: string; updatedAt: string }>(current: T[], incoming: T[], summary: MergeSummary): T[] {
  const byId = new Map(current.map((x) => [x.id, x]));
  for (const x of incoming) {
    const existing = byId.get(x.id);
    if (!existing) {
      byId.set(x.id, x);
      summary.added += 1;
    } else if (Date.parse(x.updatedAt) > Date.parse(existing.updatedAt)) {
      byId.set(x.id, x);
      summary.updated += 1;
    } else summary.unchanged += 1;
  }
  return [...byId.values()];
}

/** Add what's new from a backup; for records in both, keep the most recently edited copy. Settings stay. */
export function mergeData(current: AppData, incoming: AppData): { data: AppData; summary: MergeSummary } {
  const summary: MergeSummary = { added: 0, updated: 0, unchanged: 0 };
  const data: AppData = {
    ...current,
    semesters: mergeList(current.semesters, incoming.semesters, summary),
    courses: mergeList(current.courses, incoming.courses, summary),
    items: mergeList(current.items, incoming.items, summary),
    notified: [...new Set([...current.notified, ...incoming.notified])].slice(-1000),
    dismissed: [...new Set([...current.dismissed, ...incoming.dismissed])].slice(-1000),
  };
  return { data, summary };
}
