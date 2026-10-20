/**
 * What we read from Blackboard Learn, reduced to the fields the app uses. A snapshot is a full
 * picture of the chosen courses at one moment; applying it to the app data is a separate,
 * pure step (see apply.ts), so the same snapshot can come from the dashboard page, the
 * extension's background worker or — on the website — from the extension through messaging.
 */

export interface BbTerm {
  id: string;
  name: string;
  /** Only some Blackboard sites give terms dates (IE's terms are "Continuous"). */
  start: string | null;
  end: string | null;
}

export interface BbCourse {
  /** Primary key, e.g. "_123456_1". */
  id: string;
  /** Institution code, e.g. "BBA2026….3.M.M_C1_123456". */
  externalId: string;
  name: string;
  termId: string | null;
}

export interface BbColumn {
  id: string;
  name: string;
  description: string;
  possible: number | null;
  /** ISO date-time (UTC). */
  due: string | null;
  /** "Manual" | "Attempts" | "Calculated" | … */
  gradingType: string | null;
  available: boolean;
}

export interface BbGrade {
  columnId: string;
  /** "Graded" | "NeedsGrading" | null */
  status: string | null;
  /** "Score" | "Percent" | "Tabular" | … */
  scaleType: string | null;
  score: number | null;
  text: string | null;
  exempt: boolean;
  /** When the grade or submission happened (Blackboard's lastRelevantDate), if known. */
  date: string | null;
}

export interface BbCalendarItem {
  id: string;
  /** "Course" (class sessions, events) | "GradebookColumn" (deadlines) | … */
  type: string;
  /** Course primary key for course calendars. */
  calendarId: string;
  calendarName: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
}

export interface BbCriterion {
  name: string;
  /** Percentage of the course grade. */
  weight: number;
  note: string;
}

export interface BbSyllabus {
  professor: string | null;
  credits: number | null;
  sessions: number | null;
  criteria: BbCriterion[];
}

export interface BbCourseData {
  course: BbCourse;
  term: BbTerm | null;
  columns: BbColumn[];
  grades: BbGrade[];
  /** undefined: not read this time (keep what we have); null: the course has no syllabus. */
  syllabus?: BbSyllabus | null;
  /** Set when this course could only be read partly. */
  error?: string;
}

export interface BbSnapshot {
  version: 1;
  host: string;
  fetchedAt: string;
  /** Calendar range read; sessions outside it are left untouched. */
  range: { since: string; until: string };
  courses: BbCourseData[];
  calendar: BbCalendarItem[];
  /** False if part of the calendar could not be read (then nothing is removed). */
  calendarComplete: boolean;
  errors: string[];
}

export interface BbCourseChoice {
  course: BbCourse;
  term: BbTerm | null;
  /** In the current academic year (pre-selected). */
  current: boolean;
}

export interface SyncProgress {
  step: 'session' | 'courses' | 'gradebook' | 'calendar' | 'syllabus' | 'done';
  done: number;
  total: number;
  label: string;
}
