import { todayStr } from './dates';
import type { AppData, BlackboardConnection, Course, GpaBand, Item, ItemKind, Profile, Semester, Settings, University } from './types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Standard US percentage → 4.0 conversion. Editable in Settings. */
export const US_GPA_TABLE: GpaBand[] = [
  { letter: 'A', min: 93, points: 4.0 },
  { letter: 'A-', min: 90, points: 3.7 },
  { letter: 'B+', min: 87, points: 3.3 },
  { letter: 'B', min: 83, points: 3.0 },
  { letter: 'B-', min: 80, points: 2.7 },
  { letter: 'C+', min: 77, points: 2.3 },
  { letter: 'C', min: 73, points: 2.0 },
  { letter: 'C-', min: 70, points: 1.7 },
  { letter: 'D+', min: 67, points: 1.3 },
  { letter: 'D', min: 63, points: 1.0 },
  { letter: 'D-', min: 60, points: 0.7 },
  { letter: 'F', min: 0, points: 0.0 },
];

/** A simpler 10-point-style conversion (A ≥ 90, B ≥ 80, …). */
export const SIMPLE_GPA_TABLE: GpaBand[] = [
  { letter: 'A', min: 90, points: 4.0 },
  { letter: 'B', min: 80, points: 3.0 },
  { letter: 'C', min: 70, points: 2.0 },
  { letter: 'D', min: 60, points: 1.0 },
  { letter: 'F', min: 0, points: 0.0 },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  gradeScale: 'ten',
  gpaScale: 'four',
  gpaTable: US_GPA_TABLE,
  passPercent: 50,
  defaultTargetPercent: 70,
  weekStartsOn: 1,
  minAttendance: 80,
  currentSemesterId: null,
  inAppReminders: true,
  systemNotifications: false,
  reminderSound: true,
  defaultReminder: '1d',
  university: 'other',
  creditUnit: 'ECTS',
  backupDownloads: false,
};

export const IE_BLACKBOARD_HOST = 'https://blackboard.ie.edu';

/** Grading rules for a university preset (Spanish 0–10 system for IE). */
export function universityPreset(university: University): Partial<Settings> {
  if (university === 'ie') {
    return { university, gradeScale: 'ten', gpaScale: 'ten', passPercent: 50, defaultTargetPercent: 80, creditUnit: 'ECTS' };
  }
  return { university };
}

export const DEFAULT_PROFILE: Profile = { firstName: '', program: '', onboardedAt: null };

export const DEFAULT_BLACKBOARD: BlackboardConnection = {
  host: null,
  autoSync: true,
  lastSync: null,
  excludedCourses: [],
  syllabus: true,
};

export function emptyData(): AppData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, gpaTable: DEFAULT_SETTINGS.gpaTable.map((b) => ({ ...b })) },
    profile: { ...DEFAULT_PROFILE },
    blackboard: { ...DEFAULT_BLACKBOARD, excludedCourses: [] },
    semesters: [],
    courses: [],
    items: [],
    notified: [],
    dismissed: [],
  };
}

export function newItem(partial: Partial<Item> = {}): Item {
  const now = new Date().toISOString();
  return {
    id: uid(),
    kind: 'assignment',
    courseId: null,
    title: '',
    description: '',
    dueDate: null,
    dueTime: null,
    status: 'not_started',
    priority: 'medium',
    notes: '',
    weight: null,
    score: null,
    maxScore: null,
    reminder: '1d',
    estimatedHours: null,
    completedAt: null,
    source: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newCourse(partial: Partial<Course> = {}): Course {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: '',
    code: '',
    professor: '',
    credits: 6,
    semesterId: null,
    color: 0,
    room: '',
    schedule: [],
    sessions: [],
    gradeOverride: null,
    targetGrade: null,
    countsInGpa: true,
    honors: false,
    outcome: null,
    category: null,
    totalSessions: null,
    attendance: [],
    notes: '',
    subjectCode: '',
    sources: {},
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Suggest a semester name and dates from today's date. */
export function suggestSemester(today = new Date()): Pick<Semester, 'name' | 'startDate' | 'endDate'> {
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-based
  if (m >= 7) return { name: `Fall ${y}`, startDate: `${y}-09-01`, endDate: `${y}-12-20` };
  if (m <= 4) return { name: `Spring ${y}`, startDate: `${y}-01-12`, endDate: `${y}-05-22` };
  return { name: `Summer ${y}`, startDate: `${y}-06-15`, endDate: `${y}-07-31` };
}

export function newSemester(partial: Partial<Semester> = {}): Semester {
  const now = new Date().toISOString();
  return { id: uid(), ...suggestSemester(), extKey: null, source: null, createdAt: now, updatedAt: now, ...partial };
}

export const KIND_LABEL: Record<ItemKind, string> = {
  assignment: 'Assignment',
  exam: 'Exam',
  project: 'Project',
  quiz: 'Quiz',
  participation: 'Participation',
  personal: 'Personal task',
};

export const KIND_ORDER: ItemKind[] = ['assignment', 'exam', 'project', 'quiz', 'participation', 'personal'];

export function isGradedKind(kind: ItemKind): boolean {
  return kind !== 'personal';
}

export function defaultDueDate(): string {
  return todayStr();
}

/** "ECTS" or "credits", as chosen in Settings. */
export function creditUnit(settings: Pick<Settings, 'creditUnit'>): string {
  return settings.creditUnit;
}
