/**
 * Turns a parsed transcript into semesters and courses. Importing again (e.g. a newer transcript
 * with this semester's grades) updates the same courses instead of duplicating them.
 */
import { produce } from 'immer';
import { todayStr } from '../../lib/dates';
import { newCourse, newSemester, universityPreset } from '../../lib/defaults';
import type { AppData, Course, CourseCategory, Semester } from '../../lib/types';
import { abbreviate, mergeFields, nameSimilarity } from '../common';
import type { Period, TranscriptCourse, TranscriptResult } from './ie';

export interface TranscriptImportSummary {
  semestersAdded: number;
  coursesAdded: number;
  coursesUpdated: number;
}

const CATEGORY: Record<string, CourseCategory | null> = { B: 'basic', O: 'compulsory', OP: 'elective', TFG: 'compulsory', FC: 'supplementary', OTHER: null };

/** "24/25" + S1 → "24/25-S1". Year-long courses are filed under the second semester. */
export function semesterKey(academicYear: string, period: Period): string {
  return `${academicYear}-${period === 'annual' ? 'S2' : period}`;
}

/**
 * Semester a course belongs to. Finished year-long courses go to the second semester (when they
 * are graded); one still in progress goes to the half of the year we are in, so it shows up
 * with this semester's courses.
 */
export function courseSemesterKey(c: Pick<TranscriptCourse, 'academicYear' | 'period' | 'inProgress'>, today = todayStr()): string {
  if (c.period !== 'annual') return semesterKey(c.academicYear, c.period);
  if (c.inProgress) return today <= `${firstYear(c.academicYear)}-12-31` ? `${c.academicYear}-S1` : `${c.academicYear}-S2`;
  return `${c.academicYear}-S2`;
}

function firstYear(academicYear: string): number {
  const yy = Number(academicYear.slice(0, 2));
  return 2000 + yy;
}

/** Approximate dates; a Blackboard sync replaces them with the real term dates. */
export function semesterDates(key: string): { startDate: string; endDate: string } {
  const [ay, p] = key.split('-');
  const y = firstYear(ay);
  return p === 'S1' ? { startDate: `${y}-09-01`, endDate: `${y}-12-31` } : { startDate: `${y + 1}-01-01`, endDate: `${y + 1}-06-30` };
}

export function semesterName(key: string, program: string | null, yearOfStudy: number | null, exchange: boolean): string {
  const [ay, p] = key.split('-');
  const y = firstYear(ay);
  const season = p === 'S1' ? `Fall ${y}` : `Spring ${y + 1}`;
  const prefix = [program, yearOfStudy ? `Y${yearOfStudy}` : null].filter(Boolean).join(' ');
  return `${prefix ? `${prefix} · ` : ''}${season}${exchange ? ' · Exchange' : ''}`;
}

function courseFields(c: TranscriptCourse, exchangeUniversity: string | null) {
  const failed = c.outcome === 'fail';
  const shortUni = exchangeUniversity ? exchangeUniversity.split(/\s+-\s+/)[0] : null;
  const name = shortUni && /abroad|exchange|intercambio|extranjero/i.test(`${c.name} ${c.nameEs}`) ? `${c.name} · ${shortUni}` : c.name;
  return {
    name,
    credits: c.ects,
    category: CATEGORY[c.type] ?? null,
    countsInGpa: !c.supplementary && !failed,
    honors: c.honors,
    outcome: c.grade === null ? c.outcome : null,
    gradeOverride: c.grade !== null ? Math.round(c.grade * 1000) / 100 : null,
  };
}

export function applyTranscript(data: AppData, result: TranscriptResult, today = todayStr()): { data: AppData; summary: TranscriptImportSummary } {
  const summary: TranscriptImportSummary = { semestersAdded: 0, coursesAdded: 0, coursesUpdated: 0 };
  const exchangeByKey = new Map(result.exchanges.map((e) => [semesterKey(e.academicYear, e.period), e.university]));

  const next = produce(data, (d) => {
    if (d.settings.university !== 'ie') Object.assign(d.settings, universityPreset('ie'));
    if (!d.profile.program && result.program) d.profile.program = result.program;

    // ---- semesters --------------------------------------------------------
    const keys = [...new Set(result.courses.map((c) => courseSemesterKey(c, today)))].sort();
    const semByKey = new Map<string, Semester>();
    for (const key of keys) {
      const inSem = result.courses.filter((c) => courseSemesterKey(c, today) === key);
      const years = inSem.map((c) => c.yearOfStudy).filter((y): y is number => y !== null);
      const yearOfStudy = years.length ? Math.max(...years) : null;
      let sem = d.semesters.find((s) => s.extKey === key);
      if (!sem) {
        const dates = semesterDates(key);
        // A semester created by hand or by Blackboard that covers the same period.
        sem = d.semesters.find((s) => !s.extKey?.includes('-S') && s.startDate && s.startDate >= dates.startDate && s.startDate <= dates.endDate);
        if (sem) sem.extKey = key;
      }
      if (!sem) {
        const dates = semesterDates(key);
        // Approximate dates: recorded as "imported" so real dates (from Blackboard) can replace them.
        sem = newSemester({
          name: semesterName(key, result.program, yearOfStudy, exchangeByKey.has(key)),
          ...dates,
          extKey: key,
          source: { kind: 'transcript', id: `ie:sem:${key}`, synced: { ...dates } },
        });
        d.semesters.push(sem);
        summary.semestersAdded += 1;
      }
      semByKey.set(key, sem);
    }

    // ---- courses ----------------------------------------------------------
    for (const tc of result.courses) {
      const key = courseSemesterKey(tc, today);
      const sem = semByKey.get(key)!;
      const sourceId = `ie:${tc.code}:${tc.academicYear}`;
      const fields = courseFields(tc, exchangeByKey.get(key) ?? null);

      let course: Course | undefined =
        d.courses.find((c) => c.sources.transcript?.id === sourceId) ??
        d.courses.find((c) => c.subjectCode === tc.code && c.semesterId === sem.id) ??
        d.courses.find((c) => !c.subjectCode && c.semesterId === sem.id && nameSimilarity(c.name, fields.name) >= 0.75);

      if (course) {
        const { changes, synced } = mergeFields(course as unknown as Record<string, unknown>, course.sources.transcript?.synced, fields, [
          'credits',
          'category',
          'countsInGpa',
          'honors',
          'outcome',
          'gradeOverride',
        ]);
        if (Object.keys(changes).length > 0) {
          Object.assign(course, changes);
          course.updatedAt = new Date().toISOString();
          summary.coursesUpdated += 1;
        }
        course.subjectCode = tc.code;
        course.sources.transcript = { kind: 'transcript', id: sourceId, synced };
      } else {
        const used = new Set(d.courses.filter((c) => c.semesterId === sem.id).map((c) => c.color));
        let color = 0;
        while (used.has(color) && color < 7) color += 1;
        if (used.has(color)) color = d.courses.filter((c) => c.semesterId === sem.id).length % 8;
        course = newCourse({
          ...fields,
          code: abbreviate(fields.name),
          semesterId: sem.id,
          color,
          subjectCode: tc.code,
          notes: tc.call === 'extraordinary' ? 'Passed in the extraordinary call.' : tc.outcome === 'fail' ? `Not passed in ${tc.academicYear} — not counted in the GPA.` : '',
          sources: { transcript: { kind: 'transcript', id: sourceId, synced: { ...fields } } },
        });
        d.courses.push(course);
        summary.coursesAdded += 1;
      }
    }
  });
  return { data: next, summary };
}
