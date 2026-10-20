import { describe, expect, it } from 'vitest';
import { attendanceStats, overallAttendance } from '../../src/lib/attendance';
import { itemsToCsv } from '../../src/lib/csv';
import { emptyData, newCourse, newItem, newSemester, US_GPA_TABLE } from '../../src/lib/defaults';
import { averageGrade, bandFor, computeGpa, courseGrade, ectsSummary, formatGpa, formatGrade, fromScale, isFinalGrade, qualification, requiredForTarget, toPoints } from '../../src/lib/grades';
import { round } from '../../src/lib/format';
import { parseNumber } from '../../src/lib/parse';
import { ImportError, mergeData, parseBackupText, sanitizeData } from '../../src/lib/sanitize';
import { classesOn, computeNotices, courseScheduleText, currentSemester, dueLabel, dueReminders, isOverdue, occurrenceMinutes, reminderMoment, semesterProgress } from '../../src/lib/schedule';
import type { AppData, Item } from '../../src/lib/types';

const settings = { ...emptyData().settings };

function graded(courseId: string, weight: number | null, score: number | null, maxScore: number | null = 10, extra: Partial<Item> = {}) {
  return newItem({ courseId, kind: 'exam', title: `w${weight}`, weight, score, maxScore, ...extra });
}

// The worked example used in the end-to-end test as well.
const micro = newCourse({ name: 'Microeconomics', credits: 6 });
const da = newCourse({ name: 'Data Analytics', credits: 4, gradeOverride: 90 });
const mkt = newCourse({ name: 'Marketing', credits: 3 });
const items: Item[] = [
  graded(micro.id, 30, 7),
  graded(micro.id, 20, 8.5),
  graded(micro.id, 10, 9),
  graded(micro.id, 40, null),
  graded(mkt.id, 50, 6),
  graded(mkt.id, 50, 8),
];

describe('course grade', () => {
  it('weights graded work and ignores ungraded weight', () => {
    const g = courseGrade(micro, items);
    expect(round(g.current!, 4)).toBe(78.3333);
    expect(g.gradedWeight).toBe(60);
    expect(g.enteredWeight).toBe(100);
    expect(g.remainingWeight).toBe(40);
    expect(round(g.minPossible!, 2)).toBe(47);
    expect(round(g.maxPossible!, 2)).toBe(87);
    expect(g.warning).toBeNull();
  });

  it('uses the manual final grade when set', () => {
    const g = courseGrade(da, items);
    expect(g.effective).toBe(90);
    expect(g.isOverride).toBe(true);
    expect(requiredForTarget(g, 70).status).toBe('final');
  });

  it('falls back to equal weighting when no weights are entered', () => {
    const c = newCourse();
    const g = courseGrade(c, [graded(c.id, null, 6), graded(c.id, null, 8)]);
    expect(g.current).toBe(70);
    expect(g.equalWeighting).toBe(true);
    expect(requiredForTarget(g, 70).status).toBe('unknown');
  });

  it('warns when weights exceed 100%', () => {
    const c = newCourse();
    const g = courseGrade(c, [graded(c.id, 70, 5), graded(c.id, 50, null)]);
    expect(g.warning).toMatch(/120%/);
    expect(g.plannedWeight).toBe(120);
  });

  it('assumes unentered weight is still to come', () => {
    const c = newCourse();
    const g = courseGrade(c, [graded(c.id, 30, 8)]);
    expect(g.remainingWeight).toBe(70);
    const r = requiredForTarget(g, 70);
    expect(r.status).toBe('reachable');
    expect(round(r.required!, 2)).toBe(65.71);
  });
});

describe('required grade for a target', () => {
  it('computes the average needed on the rest', () => {
    const r = requiredForTarget(courseGrade(micro, items), 70);
    expect(r.status).toBe('reachable');
    expect(round(r.required!, 2)).toBe(57.5);
    expect(formatGrade(r.required, 'ten')).toBe('5.75');
  });
  it('reports secured and impossible targets', () => {
    const g = courseGrade(micro, items);
    expect(requiredForTarget(g, 45).status).toBe('secured');
    const imp = requiredForTarget(g, 95);
    expect(imp.status).toBe('impossible');
    expect(imp.required!).toBeGreaterThan(100);
  });
  it('handles a fully graded course', () => {
    const c = newCourse();
    const g = courseGrade(c, [graded(c.id, 100, 6)]);
    expect(requiredForTarget(g, 50).status).toBe('secured');
    expect(requiredForTarget(g, 70).status).toBe('final');
  });
});

describe('GPA', () => {
  it('computes a credit-weighted 4.0 GPA with the US table', () => {
    const r = computeGpa([micro, da, mkt], items, settings);
    // Micro 78.3% → C+ 2.3, DA 90% → A- 3.7, Marketing 70% → C- 1.7
    expect(round(r.gpa!, 4)).toBe(round((2.3 * 6 + 3.7 * 4 + 1.7 * 3) / 13, 4));
    expect(formatGpa(r.gpa, 'four')).toBe('2.59');
    expect(r.gradedCredits).toBe(13);
  });
  it('computes a 10-point weighted average', () => {
    const r = computeGpa([micro, da, mkt], items, { ...settings, gpaScale: 'ten' });
    expect(round(r.gpa!, 4)).toBe(8);
    expect(formatGpa(r.gpa, 'ten')).toBe('8.00');
  });
  it('skips ungraded and zero-credit courses', () => {
    const empty = newCourse({ credits: 6 });
    const pf = newCourse({ credits: 0, gradeOverride: 20 });
    const r = computeGpa([micro, empty, pf], items, settings);
    expect(r.gpa).toBe(2.3);
    expect(r.courses).toBe(1);
    expect(computeGpa([empty], items, settings).gpa).toBeNull();
  });
  it('averages course grades without weights', () => {
    expect(round(averageGrade([micro, da, mkt], items)!, 2)).toBe(79.44);
  });
  it('maps percentages to bands at the boundaries', () => {
    expect(bandFor(93, US_GPA_TABLE)?.letter).toBe('A');
    expect(bandFor(92.99, US_GPA_TABLE)?.letter).toBe('A-');
    expect(bandFor(59.9, US_GPA_TABLE)?.letter).toBe('F');
    expect(toPoints(85, { gpaScale: 'twenty', gpaTable: US_GPA_TABLE })).toBe(17);
  });
  it('converts between scales', () => {
    expect(formatGrade(78.3333, 'ten')).toBe('7.83');
    expect(formatGrade(78.3333, 'twenty')).toBe('15.67');
    expect(formatGrade(78.3333, 'hundred')).toBe('78.3%');
    expect(fromScale(7, 'ten')).toBe(70);
  });
});

describe('transcript rules', () => {
  it('excludes supplementary training and counts only final grades when asked', () => {
    const spanish = newCourse({ name: 'Español', credits: 3, gradeOverride: 50, countsInGpa: false });
    const all = computeGpa([micro, da, mkt, spanish], items, { ...settings, gpaScale: 'ten' });
    expect(round(all.gpa!, 4)).toBe(8); // Spanish ignored
    const final = computeGpa([micro, da, mkt, spanish], items, { ...settings, gpaScale: 'ten' }, { finalOnly: true });
    // Micro is only 60% graded → excluded: (9×4 + 7×3) / 7
    expect(round(final.gpa!, 4)).toBe(round((9 * 4 + 7 * 3) / 7, 4));
    expect(isFinalGrade(courseGrade(mkt, items))).toBe(true);
    expect(isFinalGrade(courseGrade(micro, items))).toBe(false);
  });
  it('reproduces an official 10-point GPA', () => {
    const cs = [
      [9.2, 6], [9.6, 6], [8.8, 6], [9.3, 5], [9.2, 3], [8.2, 6], [9.0, 6], [9.8, 6], [9.6, 6], [9.8, 6], [8.6, 4],
      [9.2, 3], [9.9, 6], [8.7, 5], [9.1, 6], [8.8, 6], [9.2, 3], [9.4, 3], [8.5, 5], [9.9, 6], [8.8, 5], [9.4, 4], [9.4, 4], [9.2, 4],
    ].map(([g, cr]) => newCourse({ credits: cr, gradeOverride: g * 10 }));
    const r = computeGpa(cs, [], { ...settings, gpaScale: 'ten' }, { finalOnly: true });
    expect(r.gradedCredits).toBe(120);
    expect(formatGpa(r.gpa, 'ten')).toBe('9.20');
  });
  it('labels Spanish qualifications', () => {
    expect(qualification(49, false)).toBe('Suspenso');
    expect(qualification(65, false)).toBe('Aprobado');
    expect(qualification(88, false)).toBe('Notable');
    expect(qualification(90, false)).toBe('Sobresaliente');
    expect(qualification(99, true)).toBe('Matrícula de Honor');
  });
  it('sums passed and in-progress ECTS', () => {
    const pass = newCourse({ credits: 0, outcome: 'pass', countsInGpa: false });
    const e = ectsSummary([micro, da, mkt, pass], items, settings);
    expect(e).toEqual({ passed: 7, inProgress: 6 });
  });
});

describe('attendance', () => {
  it('counts late as attended and ignores excused', () => {
    const c = newCourse({
      totalSessions: 30,
      attendance: [
        { id: '1', date: '2026-09-01', status: 'present' },
        { id: '2', date: '2026-09-02', status: 'late' },
        { id: '3', date: '2026-09-03', status: 'absent' },
        { id: '4', date: '2026-09-04', status: 'excused' },
      ],
    });
    const s = attendanceStats(c, 80);
    expect(round(s.rate!, 2)).toBe(66.67);
    expect(s.belowMinimum).toBe(true);
    expect(s.maxAbsences).toBe(6);
    expect(s.remainingAbsences).toBe(5);
    expect(round(overallAttendance([c])!, 2)).toBe(66.67);
  });
});

describe('deadlines & reminders', () => {
  const now = new Date(2026, 8, 28, 12, 0); // Mon 28 Sep 2026, 12:00
  it('labels due dates', () => {
    expect(dueLabel({ dueDate: '2026-09-28', dueTime: '18:00', status: 'not_started' }, now).text).toBe('Today 18:00');
    expect(dueLabel({ dueDate: '2026-09-28', dueTime: '09:00', status: 'not_started' }, now).tone).toBe('overdue');
    expect(dueLabel({ dueDate: '2026-09-29', dueTime: null, status: 'not_started' }, now).text).toBe('Tomorrow');
    expect(dueLabel({ dueDate: '2026-09-25', dueTime: null, status: 'not_started' }, now).text).toBe('Overdue · 3 days');
    expect(dueLabel({ dueDate: '2026-10-02', dueTime: null, status: 'not_started' }, now).text).toBe('In 4 days');
  });
  it('date-only items are due at the end of the day', () => {
    expect(isOverdue(newItem({ dueDate: '2026-09-28' }), now)).toBe(false);
    expect(isOverdue(newItem({ dueDate: '2026-09-27' }), now)).toBe(true);
    expect(isOverdue(newItem({ dueDate: '2026-09-27', status: 'completed' }), now)).toBe(false);
  });
  it('computes reminder times', () => {
    expect(reminderMoment({ dueDate: '2026-10-01', dueTime: '14:00', reminder: '1h' })!.getHours()).toBe(13);
    expect(reminderMoment({ dueDate: '2026-10-01', dueTime: null, reminder: '1d' })!.getDate()).toBe(30);
    expect(reminderMoment({ dueDate: '2026-10-01', dueTime: null, reminder: 'none' })).toBeNull();
  });
  it('builds notices and respects dismissals', () => {
    const overdue = newItem({ title: 'Late', dueDate: '2026-09-27' });
    const today = newItem({ title: 'Today', dueDate: '2026-09-28' });
    const exam = newItem({ title: 'Exam', kind: 'exam', dueDate: '2026-10-03', reminder: 'none' });
    const later = newItem({ title: 'Later', dueDate: '2026-11-30', reminder: '1w' });
    const data = { items: [overdue, today, exam, later], dismissed: [] as string[] };
    const notices = computeNotices(data, now);
    expect(notices.map((n) => n.kind)).toEqual(['overdue', 'today', 'exam']);
    const again = computeNotices({ ...data, dismissed: [notices[0].key] }, now);
    expect(again.map((n) => n.title)).toEqual(['Today', 'Exam']);
  });
  it('pops each reminder once', () => {
    const it1 = newItem({ dueDate: '2026-09-29', reminder: '1d', createdAt: '2026-09-01T00:00:00.000Z' });
    const first = dueReminders({ items: [it1], notified: [] }, now);
    expect(first).toHaveLength(1);
    expect(dueReminders({ items: [it1], notified: [first[0].key] }, now)).toHaveLength(0);
  });
});

describe('semesters & classes', () => {
  it('finds the current semester and progress', () => {
    const fall = newSemester({ name: 'Fall 2026', startDate: '2026-09-01', endDate: '2026-12-20' });
    const spring = newSemester({ name: 'Spring 2026', startDate: '2026-01-10', endDate: '2026-05-20' });
    const data = { semesters: [spring, fall], settings: { ...settings, currentSemesterId: null } };
    expect(currentSemester(data, '2026-09-28')?.name).toBe('Fall 2026');
    expect(currentSemester({ ...data, settings: { ...settings, currentSemesterId: spring.id } }, '2026-09-28')?.name).toBe('Spring 2026');
    const p = semesterProgress(fall, '2026-09-28')!;
    expect(p.status).toBe('active');
    expect(p.week).toBe(4);
  });
  it('lists classes only within semester dates', () => {
    const fall = newSemester({ startDate: '2026-09-01', endDate: '2026-12-20' });
    const c = newCourse({ semesterId: fall.id, schedule: [{ id: 's', day: 1, start: '09:00', end: '10:30', room: '', type: 'lecture' }] });
    expect(classesOn('2026-09-28', [c], [fall])).toHaveLength(1); // Monday
    expect(classesOn('2026-09-29', [c], [fall])).toHaveLength(0); // Tuesday
    expect(classesOn('2027-01-04', [c], [fall])).toHaveLength(0); // Monday after semester
  });
});

describe('dated sessions', () => {
  const c = newCourse({
    room: 'Main room',
    schedule: [{ id: 'w', day: 1, start: '08:00', end: '09:00', room: '', type: 'lecture' }],
    sessions: [
      { id: 'a', date: '2026-09-28', start: '18:00', end: '19:20', room: 'T-11.02', title: 'Transfer pricing', mode: 'in_person', extId: null },
      { id: 'b', date: '2026-09-28', start: null, end: null, room: '', title: 'Exercise', mode: 'async', extId: null },
      { id: 'c', date: '2026-10-02', start: '17:30', end: '18:50', room: '', title: '', mode: 'in_person', extId: null },
    ],
  });
  it('replace the weekly schedule and sort async last', () => {
    const occ = classesOn('2026-09-28', [c], []);
    expect(occ.map((o) => o.title)).toEqual(['Transfer pricing', 'Exercise']);
    expect(occ[0]).toMatchObject({ start: '18:00', room: 'T-11.02', async: false, label: 'In person' });
    expect(occ[1]).toMatchObject({ async: true, label: 'Asynchronous' });
    expect(occurrenceMinutes(occ[0])).toBe(80);
    expect(occurrenceMinutes(occ[1])).toBe(0);
    expect(classesOn('2026-10-02', [c], [])[0].room).toBe('Main room');
  });
  it('summarise progress and the next session', () => {
    expect(courseScheduleText(c, '2026-09-29')).toBe('2/3 sessions · next Fri Oct 2 17:30');
    expect(courseScheduleText(c, '2026-10-03')).toBe('3/3 sessions · finished');
  });
  it('are sanitised on import', () => {
    const { data } = sanitizeData({ courses: [{ name: 'X', sessions: [{ date: '2026-09-01', start: '10:00', end: '09:00', mode: 'in_person' }, { date: 'bad' }, { date: '2026-09-02', mode: 'async', start: '10:00', end: '11:00' }] }], items: [] });
    expect(data.courses[0].sessions).toHaveLength(2);
    expect(data.courses[0].sessions[0]).toMatchObject({ start: null, mode: 'async' });
    expect(data.courses[0].sessions[1]).toMatchObject({ start: null, end: null, mode: 'async' });
  });
});

describe('input parsing', () => {
  it('accepts comma decimals and rejects junk', () => {
    expect(parseNumber('8,5', { label: 'Score', max: 10 })).toEqual({ ok: true, value: 8.5 });
    expect(parseNumber('11', { label: 'Score', max: 10 }).ok).toBe(false);
    expect(parseNumber('abc', { label: 'Score', max: 10 }).ok).toBe(false);
    expect(parseNumber('-1', { label: 'Score', max: 10 }).ok).toBe(false);
  });
});

describe('import / export', () => {
  function sample(): AppData {
    const sem = newSemester({ name: 'Fall 2026' });
    const c = newCourse({ name: 'Micro', semesterId: sem.id });
    return { ...emptyData(), semesters: [sem], courses: [c], items: [graded(c.id, 30, 7)] };
  }
  it('rejects files that are not backups', () => {
    expect(() => parseBackupText('nope')).toThrow(ImportError);
    expect(() => parseBackupText('{"a":1}')).toThrow(/not a Student Dashboard backup/);
    expect(() => parseBackupText('{"version":5,"courses":[]}')).toThrow(/newer version/);
  });
  it('round-trips through JSON unchanged', () => {
    const d = sample();
    expect(parseBackupText(JSON.stringify(d)).data).toEqual(d);
  });
  it('repairs broken fields', () => {
    const { data, issues } = sanitizeData({
      semesters: [{ id: 's1', name: 'S1', startDate: '2026-12-01', endDate: '2026-09-01' }],
      courses: [{ id: 'c1', name: 'Course', credits: 'abc', semesterId: 'missing', schedule: [{ day: 1, start: '10:00', end: '09:00' }, { day: 2, start: '09:00', end: '10:00' }] }, { name: '' }],
      items: [{ title: 'T', courseId: 'c1', score: 12, maxScore: 10, weight: 150, dueDate: 'soon', status: 'weird' }, { title: '' }],
      settings: { gpaScale: 'nine', gradeScale: 'twenty', minAttendance: 500 },
    });
    expect(data.semesters[0]).toMatchObject({ startDate: '2026-09-01', endDate: '2026-12-01' });
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0]).toMatchObject({ credits: 0, semesterId: null });
    expect(data.courses[0].schedule).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ score: 10, maxScore: 10, weight: 100, dueDate: null, status: 'not_started' });
    expect(data.settings).toMatchObject({ gpaScale: 'four', gradeScale: 'twenty', minAttendance: 100 });
    expect(issues.length).toBe(2);
  });
  it('merges without duplicates and keeps the newest edit', () => {
    const d = sample();
    const incoming = structuredClone(d);
    incoming.items[0].title = 'Renamed';
    incoming.items[0].updatedAt = new Date(Date.now() + 60_000).toISOString();
    incoming.items.push(newItem({ title: 'New one' }));
    const { data, summary } = mergeData(d, incoming);
    expect(summary).toEqual({ added: 1, updated: 1, unchanged: 2 });
    expect(data.items.map((i) => i.title).sort()).toEqual(['New one', 'Renamed']);
    expect(mergeData(data, incoming).summary.added).toBe(0);
  });
  it('exports CSV rows', () => {
    const d = sample();
    d.items[0].title = 'Essay, "draft"';
    const csv = itemsToCsv(d).trim().split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('"Essay, ""draft"""');
    expect(csv[1]).toContain('Micro');
  });
});
