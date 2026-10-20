export type ItemKind = 'assignment' | 'exam' | 'project' | 'quiz' | 'participation' | 'personal';
export type ItemStatus = 'not_started' | 'in_progress' | 'completed';
export type Priority = 'low' | 'medium' | 'high';
export type ReminderOffset = 'none' | 'at_time' | '1h' | '3h' | '1d' | '2d' | '1w';

export type SourceKind = 'blackboard' | 'transcript' | 'ics';

/**
 * Where an imported record came from. Re-syncing matches records by `id`, and a field is only
 * updated when its current value still equals the value last imported (`synced`) — so your
 * own edits always win over the source.
 */
export interface SyncSource {
  kind: SourceKind;
  /** Stable external id, e.g. "bb:col:_123_1:_456_1" or "ie:810027:26/27". */
  id: string;
  /** Field values as last imported. */
  synced: Record<string, string | number | boolean | null>;
  /** The record disappeared from the source but was kept because you had changed it. */
  removed?: boolean;
}

/**
 * Anything with a deadline or a grade: assignments, exams, projects, quizzes,
 * participation marks and personal tasks. Graded items (weight + score) feed the
 * course grade; items with a due date feed the calendar, deadlines and reminders.
 */
export interface Item {
  id: string;
  kind: ItemKind;
  courseId: string | null;
  title: string;
  description: string;
  /** Local date YYYY-MM-DD. */
  dueDate: string | null;
  /** 24h HH:MM, optional. */
  dueTime: string | null;
  status: ItemStatus;
  priority: Priority;
  notes: string;
  /** Percentage of the course grade (0–100). */
  weight: number | null;
  score: number | null;
  maxScore: number | null;
  reminder: ReminderOffset;
  estimatedHours: number | null;
  completedAt: string | null;
  /** Set for records imported from Blackboard, a transcript or a calendar file. */
  source: SyncSource | null;
  createdAt: string;
  updatedAt: string;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SlotType = 'lecture' | 'lab' | 'seminar' | 'tutorial' | 'other';

export interface ClassSlot {
  id: string;
  day: Weekday;
  /** HH:MM */
  start: string;
  end: string;
  room: string;
  type: SlotType;
}

export type SessionMode = 'in_person' | 'online' | 'async';

/** A dated class session (e.g. imported from Blackboard). */
export interface ClassSession {
  id: string;
  date: string;
  /** HH:MM, null for asynchronous sessions. */
  start: string | null;
  end: string | null;
  room: string;
  title: string;
  mode: SessionMode;
  /** External id when imported (re-syncs replace imported sessions, never ones you added). */
  extId: string | null;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id: string;
  date: string;
  status: AttendanceStatus;
}

export type CourseCategory = 'basic' | 'compulsory' | 'elective' | 'supplementary';

export interface Course {
  id: string;
  name: string;
  code: string;
  professor: string;
  credits: number;
  semesterId: string | null;
  /** Index into the 8-colour course palette. */
  color: number;
  room: string;
  schedule: ClassSlot[];
  /** Dated sessions; when present they replace the weekly schedule in the calendar. */
  sessions: ClassSession[];
  /** Final grade entered by hand, as a percentage. Overrides the calculated grade. */
  gradeOverride: number | null;
  /** Target grade as a percentage. */
  targetGrade: number | null;
  /** Official degree subjects count toward GPA; supplementary training does not. */
  countsInGpa: boolean;
  /** Matrícula de Honor / honours distinction. */
  honors: boolean;
  /** Pass/fail result for courses graded "Apto / No apto". */
  outcome: 'pass' | 'fail' | null;
  category: CourseCategory | null;
  totalSessions: number | null;
  attendance: AttendanceRecord[];
  notes: string;
  /** Official subject code from the transcript (e.g. "810027"). */
  subjectCode: string;
  /** Links to the transcript and/or Blackboard course this one was imported from. */
  sources: CourseSources;
  createdAt: string;
  updatedAt: string;
}

export interface CourseSources {
  transcript?: SyncSource;
  blackboard?: SyncSource;
}

export interface Semester {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  /** e.g. "26/27-S1": the academic period, shared by transcript and Blackboard imports. */
  extKey: string | null;
  /** Dates derived from Blackboard (first and last class); your own edits are kept. */
  source: SyncSource | null;
  createdAt: string;
  updatedAt: string;
}

export type ThemePref = 'dark' | 'light' | 'system';
/** How grades are entered and displayed. */
export type GradeScale = 'ten' | 'twenty' | 'hundred';
/** How GPA is expressed. */
export type GpaScale = 'four' | 'ten' | 'twenty' | 'hundred';

export interface GpaBand {
  letter: string;
  /** Minimum percentage for this band. */
  min: number;
  points: number;
}

export interface Settings {
  theme: ThemePref;
  gradeScale: GradeScale;
  gpaScale: GpaScale;
  gpaTable: GpaBand[];
  /** Pass mark as a percentage. */
  passPercent: number;
  defaultTargetPercent: number;
  weekStartsOn: 0 | 1;
  /** Minimum attendance required, in percent. */
  minAttendance: number;
  currentSemesterId: string | null;
  inAppReminders: boolean;
  systemNotifications: boolean;
  reminderSound: boolean;
  defaultReminder: ReminderOffset;
  /** Preset for grading rules and imports. */
  university: University;
  /** "ECTS" or "credits". */
  creditUnit: 'ECTS' | 'credits';
  /** Extension: save a backup file to the Downloads folder once a week. */
  backupDownloads: boolean;
}

export type University = 'ie' | 'other';

export interface Profile {
  firstName: string;
  /** Short programme name, e.g. "BBA". */
  program: string;
  /** Set once the welcome setup has been completed or skipped. */
  onboardedAt: string | null;
}

export interface BlackboardConnection {
  /** e.g. "https://blackboard.ie.edu"; null when not connected. */
  host: string | null;
  autoSync: boolean;
  /** Last successful sync applied to this data. */
  lastSync: string | null;
  /** Blackboard course ids the user chose not to import. */
  excludedCourses: string[];
  /** Import syllabus weights (IE only). */
  syllabus: boolean;
}

export interface AppData {
  version: 1;
  settings: Settings;
  profile: Profile;
  blackboard: BlackboardConnection;
  semesters: Semester[];
  courses: Course[];
  items: Item[];
  /** Reminder keys that already produced a pop-up. */
  notified: string[];
  /** Notification keys the user dismissed from the notification centre. */
  dismissed: string[];
}
