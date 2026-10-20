import { describe, expect, it } from 'vitest';
import { createFakeBlackboard } from '../fixtures/fake-blackboard.mjs';
import { makeIeTranscriptPdf } from '../fixtures/ie-transcript.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { BlackboardClient } from '../../src/integrations/blackboard/client';
import { fetchSnapshot, listCourseChoices, whoAmI } from '../../src/integrations/blackboard/snapshot';
import { applySnapshot } from '../../src/integrations/blackboard/apply';
import {
  classifyKind,
  cleanCourseName,
  gradeScore,
  matchCriteria,
  normalizeCriteria,
  parseDescription,
  parseSession,
  parseTerm,
  personName,
} from '../../src/integrations/blackboard/parse';
import { toSyllabus } from '../../src/integrations/blackboard/syllabus';
import type { BbSnapshot } from '../../src/integrations/blackboard/types';
import { parseIeTranscript, type PdfTextItem } from '../../src/integrations/transcript/ie';
import { applyTranscript } from '../../src/integrations/transcript/apply';
import { emptyData } from '../../src/lib/defaults';
import { courseGrade } from '../../src/lib/grades';
import type { AppData } from '../../src/lib/types';

const NOW = new Date('2026-10-01T10:00:00+02:00');

function fakeClient() {
  const bb = createFakeBlackboard({ now: NOW });
  return { bb, client: new BlackboardClient('https://bb.test', (url: string) => bb.transport(url)) };
}

/** A snapshot with syllabi filled in from the fake syllabus tool's data. */
async function snapshotWithSyllabi(): Promise<{ snap: BbSnapshot; bb: ReturnType<typeof createFakeBlackboard> }> {
  const { bb, client } = fakeClient();
  const snap = await fetchSnapshot({
    client,
    now: NOW,
    readSyllabi: async (courses) => {
      for (const cd of courses) {
        const s = (bb.syllabi as Record<string, { professor: string; sessions: number; credits: string; rows: string[][] }>)[cd.course.id];
        cd.syllabus = s ? toSyllabus({ state: 'ok', professor: s.professor, credits: s.credits, sessions: String(s.sessions), rows: s.rows.map((r) => ({ name: r[0], weight: r[1], note: r[3] ?? '' })) }) : null;
      }
    },
  });
  return { snap, bb };
}

const items = (d: AppData, course: string) => d.items.filter((i) => i.courseId === d.courses.find((c) => c.name === course)?.id);

describe('Blackboard parsing', () => {
  it('reads IE term names', () => {
    expect(parseTerm({ id: 't', name: 'BBA 26-27 THIRD Q1', start: null, end: null })).toEqual({ program: 'BBA', academicYear: '26/27', half: 'S1', yearOfStudy: 3 });
    expect(parseTerm({ id: 't', name: 'OACT 26-27 PRIMERO Anual', start: null, end: null })).toMatchObject({ program: 'OACT', half: 'annual', yearOfStudy: 1 });
    expect(parseTerm({ id: 't', name: 'IE-IMPACT 25-26 FIRST Q2', start: null, end: null })).toMatchObject({ program: 'IE-IMPACT', academicYear: '25/26', half: 'S2' });
    expect(parseTerm({ id: 't', name: 'Fall term', start: '2026-09-07T00:00:00Z', end: null })).toMatchObject({ academicYear: '26/27', half: 'S1' });
  });

  it('cleans names', () => {
    expect(cleanCourseName('CAREER DEVELOPMENT 3 - SINGLE')).toBe('Career Development 3');
    expect(cleanCourseName('IE-CHALLENGE')).toBe('IE Challenge');
    expect(cleanCourseName('STRATEGIES FOR COMPETING IN INDUSTRIES AND MARKETS')).toBe('Strategies for Competing in Industries and Markets');
    expect(personName('MARÍA DE LA TORRE SANZ')).toBe('María de la Torre Sanz');
    expect(personName('Already Fine')).toBe('Already Fine');
  });

  it('parses session descriptions', () => {
    expect(parseDescription('Transfer pricing\nMONTSERRAT DE LA PRUEBA. ICALUID:x')).toEqual({ topic: 'Transfer pricing', instructor: 'MONTSERRAT DE LA PRUEBA' });
    expect(parseDescription('Ana Ejemplo .')).toEqual({ topic: '', instructor: 'Ana Ejemplo' });
    expect(parseDescription('Ana Ejemplo . CONTENT: .')).toEqual({ topic: '', instructor: 'Ana Ejemplo' });
    expect(parseDescription('Topic 3: Budgets\nX Y. ICALUID:1').topic).toBe('Budgets');
    expect(parseDescription('Class participation debate\nX Y. ICALUID:1').topic).toBe('Class participation debate');
    expect(parseDescription('EXERCISE: BUDGETING\nX. ICALUID:1').topic).toBe('Exercise: budgeting');
  });

  it('classifies and scores gradebook columns', () => {
    expect(classifyKind('Midterm exam')).toBe('exam');
    expect(classifyKind('Reading quiz 2')).toBe('quiz');
    expect(classifyKind('Group Assignment: White Hills case')).toBe('project');
    expect(classifyKind('Problem set 1')).toBe('assignment');
    expect(gradeScore({ columnId: 'c', status: 'Graded', scaleType: 'Percent', score: 80, text: null, exempt: false, date: null }, 5)).toBe(4);
    expect(gradeScore({ columnId: 'c', status: 'Graded', scaleType: 'Score', score: 7.5, text: null, exempt: false, date: null }, 10)).toBe(7.5);
    expect(gradeScore(undefined, 10)).toBeNull();
  });

  it('normalises syllabus criteria and matches them to columns', () => {
    const crit = normalizeCriteria([
      { name: 'Final Exam', weight: '40 %' },
      { name: 'Quizzes', weight: '10%' },
      { name: 'Quizzes', weight: '5%' },
      { name: 'TOTAL', weight: '100 %' },
    ]);
    expect(crit.map((c) => [c.name, c.weight])).toEqual([
      ['Final Exam', 40],
      ['Quizzes', 15],
    ]);
    expect(normalizeCriteria([{ name: 'A', weight: '0%' }])).toEqual([]);
    const cols = ['Final exam grade', 'Reading quiz 1', 'Reading quiz 2', 'Essay'].map((name, i) => ({ id: String(i), name, description: '', possible: 10, due: null, gradingType: 'Manual', available: true }));
    const m = matchCriteria(crit, cols);
    expect(m.get(0)!.map((c) => c.name)).toEqual(['Final exam grade']);
    expect(m.get(1)!.map((c) => c.name)).toEqual(['Reading quiz 1', 'Reading quiz 2']);
  });

  it('recognises sessions, modes, rooms and duplicates', async () => {
    const bb = createFakeBlackboard({ now: NOW });
    const { snap } = await snapshotWithSyllabi();
    const mc = snap.calendar.filter((i) => i.calendarId === '_101_1');
    const parsed = mc.map(parseSession);
    expect(parsed.filter(Boolean)).toHaveLength(6); // the Teams duplicate is dropped
    const asyncS = parsed.find((s) => s?.mode === 'async')!;
    expect(asyncS.start).toBeNull();
    expect(asyncS.date).toBe(new Date(NOW.getTime() + 2 * 86_400_000).toLocaleDateString('sv-SE'));
    expect(asyncS.topic).toBe('Exercise: budgeting');
    const double = parsed.find((s) => s?.label === 'Sessions 5–6')!;
    expect(double.count).toBe(2);
    expect(parsed.find((s) => s?.topic === 'Transfer pricing')).toMatchObject({ room: 'T-11.02', start: '17:30', end: '18:50', mode: 'in_person' });
    expect(bb.ay).toBe('26/27');
  });
});

describe('reading a Blackboard snapshot', () => {
  it('lists this year’s courses, without organisations, staff roles or disabled sections', async () => {
    const { client } = fakeClient();
    const choices = await listCourseChoices(client, await whoAmI(client), NOW);
    expect(choices.filter((c) => c.current).map((c) => c.course.name)).toEqual(['CAREER DEVELOPMENT 3 - SINGLE', 'DATA ANALYSIS FOR ECONOMICS', 'MANAGEMENT CONTROL', 'PRICING STRATEGY', 'SUPPLY CHAIN MANAGEMENT']);
    expect(choices.find((c) => c.course.name === 'MICROECONOMICS')!.current).toBe(false);
    expect(choices.some((c) => c.course.name === 'BBA STUDENT GENERAL')).toBe(false);
    expect(choices.filter((c) => c.course.name === 'MANAGEMENT CONTROL')).toHaveLength(1);
  });

  it('respects Blackboard’s calendar limits and reports partial courses', async () => {
    const { bb, client } = fakeClient();
    const snap = await fetchSnapshot({ client, now: NOW });
    const calls = (bb.state.requests as string[]).filter((r) => r.includes('/calendars/items'));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      expect(c).not.toMatch(/limit=/);
      const q = new URL(`http://x${c.slice(4)}`).searchParams;
      expect(Date.parse(q.get('until')!) - Date.parse(q.get('since')!)).toBeLessThanOrEqual(105 * 86_400_000);
    }
    expect(snap.calendarComplete).toBe(true);
    expect(snap.courses).toHaveLength(5);
    expect(snap.courses.find((c) => c.course.id === '_103_1')!.error).toMatch(/did not allow/);
    expect(snap.errors).toHaveLength(1);
    // Only GET requests, never anything that changes Blackboard.
    expect((bb.state.requests as string[]).every((r) => r.startsWith('GET '))).toBe(true);
  });
});

describe('applying a snapshot', () => {
  it('creates courses, sessions, deadlines and grades from Blackboard', async () => {
    const { snap } = await snapshotWithSyllabi();
    const { data, summary } = applySnapshot(emptyData(), snap, NOW);
    expect(summary).toMatchObject({ coursesAdded: 5, coursesLinked: 0, semestersAdded: 1 });
    expect(summary.partial).toEqual(['Supply Chain Management']);
    const mc = data.courses.find((c) => c.name === 'Management Control')!;
    expect(mc).toMatchObject({ professor: 'Montserrat de la Prueba', room: 'T-11.02', totalSessions: 30, credits: 5, code: 'MC' });
    expect(mc.sessions).toHaveLength(6);
    expect(data.courses.find((c) => c.name === 'Career Development 3')).toMatchObject({ category: 'supplementary', countsInGpa: false, credits: 0 });

    const mcItems = items(data, 'Management Control');
    const byTitle = (t: string) => mcItems.find((i) => i.title === t)!;
    expect(mcItems.map((i) => i.title).sort()).toEqual(['Class Participation', 'Final Exam', 'Group Assignment: White Hills case', 'Midterm exam', 'Reading quiz 1', 'Reading quiz 2'].sort());
    expect(byTitle('Group Assignment: White Hills case')).toMatchObject({ kind: 'project', status: 'completed', score: null, weight: 20 });
    expect(byTitle('Midterm exam')).toMatchObject({ kind: 'exam', score: 7.5, maxScore: 10, weight: 20, status: 'completed' });
    // Completed when Blackboard says it was graded, not "today".
    expect(new Date(byTitle('Midterm exam').completedAt!).toLocaleDateString('sv-SE')).toBe(new Date(NOW.getTime() - 6 * 86_400_000).toLocaleDateString('sv-SE'));
    expect(byTitle('Reading quiz 1')).toMatchObject({ kind: 'quiz', score: 4, maxScore: 5, weight: 5 });
    expect(byTitle('Class Participation')).toMatchObject({ kind: 'participation', score: 9, maxScore: 10, weight: 10 });
    const final = byTitle('Final Exam');
    expect(final).toMatchObject({ kind: 'exam', weight: 40, priority: 'high', dueTime: '09:00' });
    expect(final.dueDate).toBe(new Date(NOW.getTime() + 60 * 86_400_000).toLocaleDateString('sv-SE'));
    expect(mcItems.reduce((t, i) => t + (i.weight ?? 0), 0)).toBe(100);
    // Grade so far: (7.5·20 + 9·10 + 8·5) / 35 weighted points.
    expect(courseGrade(mc, data.items).current).toBeCloseTo(((0.75 * 20 + 0.9 * 10 + 0.8 * 5) / 35) * 100, 6);

    const dae = items(data, 'Data Analysis for Economics');
    expect(dae.map((i) => [i.title, i.weight]).sort()).toEqual(
      [
        ['Data report submission', null],
        ['Final exam grade', 50],
        ['Participación', 20],
        ['Problem set 1', 15],
        ['Problem set 2', 15],
      ].sort(),
    );
    expect(items(data, 'Supply Chain Management')).toHaveLength(0);
    // The semester gets real dates from the first and last class.
    const sem = data.semesters[0];
    expect(sem.name).toBe('BBA Y3 · Fall 2026');
    expect(sem.startDate).toBe(new Date(NOW.getTime() - 20 * 86_400_000).toLocaleDateString('sv-SE'));
  });

  it('is idempotent', async () => {
    const { snap } = await snapshotWithSyllabi();
    const first = applySnapshot(emptyData(), snap, NOW).data;
    const second = applySnapshot(first, snap, NOW);
    expect(second.summary).toMatchObject({ coursesAdded: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0 });
    expect(second.data).toEqual(first);
  });

  it('keeps your edits, takes official changes and removes only untouched items', async () => {
    const { snap } = await snapshotWithSyllabi();
    let data = applySnapshot(emptyData(), snap, NOW).data;
    const q2 = data.items.find((i) => i.title === 'Reading quiz 2')!;
    const ps1 = data.items.find((i) => i.title === 'Problem set 1')!;
    const ps2 = data.items.find((i) => i.title === 'Problem set 2')!;
    data = {
      ...data,
      items: data.items.map((i) => (i.id === q2.id ? { ...i, title: 'Quiz 2 (chapters 3–4)', dueDate: '2026-10-15' } : i.id === ps2.id ? { ...i, notes: 'Started with Ana' } : i)),
    };
    const changed: BbSnapshot = structuredClone(snap);
    const mc = changed.courses.find((c) => c.course.id === '_101_1')!;
    mc.columns.find((c) => c.name === 'Reading quiz 2')!.due = '2026-10-25T21:59:00.000Z';
    mc.grades.push({ columnId: '_9010_1', status: 'Graded', scaleType: 'Score', score: 5, text: null, exempt: false, date: null });
    const dae = changed.courses.find((c) => c.course.id === '_102_1')!;
    dae.columns = dae.columns.filter((c) => !c.name.startsWith('Problem set'));
    // Weights come from the syllabus; this sync did not read it, so they must stay.
    for (const c of changed.courses) delete c.syllabus;

    const { data: after, summary } = applySnapshot(data, changed, NOW);
    const q2b = after.items.find((i) => i.id === q2.id)!;
    expect(q2b.title).toBe('Quiz 2 (chapters 3–4)');
    expect(q2b.dueDate).toBe('2026-10-25');
    expect(q2b).toMatchObject({ score: 5, status: 'completed' });
    expect(summary.newGrades).toEqual([{ title: 'Quiz 2 (chapters 3–4)', course: 'Management Control' }]);
    expect(summary.dueChanges).toEqual([{ title: 'Quiz 2 (chapters 3–4)', course: 'Management Control', to: '2026-10-25' }]);
    expect(after.items.find((i) => i.id === ps1.id)).toBeUndefined();
    expect(after.items.find((i) => i.id === ps2.id)!.source!.removed).toBe(true);
    expect(after.items.find((i) => i.title === 'Final Exam')!.weight).toBe(40);
  });

  it('adopts a semester made by hand (e.g. imported from the desktop app) instead of duplicating', async () => {
    const d = emptyData();
    d.semesters.push({ id: 'mine', name: 'My fall', startDate: '2026-09-07', endDate: '2026-12-18', extKey: null, source: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    d.courses.push({ ...d.courses[0], ...(await import('../../src/lib/defaults')).newCourse({ name: 'Management Control', semesterId: 'mine' }) });
    const { snap } = await snapshotWithSyllabi();
    const { data, summary } = applySnapshot(d, snap, NOW);
    expect(data.semesters.map((s) => s.id)).toEqual(['mine']);
    expect(data.semesters[0].extKey).toBe('26/27-S1');
    expect(data.courses.filter((c) => c.name === 'Management Control')).toHaveLength(1);
    expect(summary.coursesLinked).toBe(1);
  });

  it('links Blackboard courses to the transcript instead of duplicating them', async () => {
    const doc = await getDocument({ data: await makeIeTranscriptPdf(), verbosity: 0 }).promise;
    const pdfItems: PdfTextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      for (const it of (await (await doc.getPage(p)).getTextContent()).items) {
        if ('str' in it && it.str.trim()) pdfItems.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
      }
    }
    const withTranscript = applyTranscript(emptyData(), parseIeTranscript(pdfItems), '2026-10-01').data;
    const before = withTranscript.courses.length;
    const { snap } = await snapshotWithSyllabi();
    const { data, summary } = applySnapshot(withTranscript, snap, NOW);
    expect(summary.coursesLinked).toBe(1);
    expect(data.courses).toHaveLength(before + 4);
    const mc = data.courses.filter((c) => c.name === 'Management Control');
    expect(mc).toHaveLength(1);
    expect(mc[0]).toMatchObject({ subjectCode: '810027', credits: 5, professor: 'Montserrat de la Prueba' });
    expect(mc[0].sources.transcript && mc[0].sources.blackboard).toBeTruthy();
    const sem = data.semesters.find((s) => s.id === mc[0].semesterId)!;
    expect(sem.name).toBe('BBA Y3 · Fall 2026');
    expect(sem.startDate).not.toBe('2026-09-01'); // approximate date replaced by the first class
  });
});
