import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EXPECTED, FAKE_IDENTITY, makeIeTranscriptPdf } from '../fixtures/ie-transcript.mjs';
import { parseIeTranscript, titleCase, transcriptGpa, TranscriptError, type PdfTextItem } from '../../src/integrations/transcript/ie';
import { applyTranscript, semesterKey } from '../../src/integrations/transcript/apply';
import { abbreviate, mergeFields, nameSimilarity } from '../../src/integrations/common';
import { emptyData } from '../../src/lib/defaults';
import { computeGpa, ectsSummary, formatGpa } from '../../src/lib/grades';

async function pdfItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const doc = await getDocument({ data: bytes, verbosity: 0 }).promise;
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const it of content.items) {
      if ('str' in it && it.str.trim()) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
    }
  }
  return items;
}

const parsed = (async () => parseIeTranscript(await pdfItems(await makeIeTranscriptPdf())))();

describe('IE transcript parser', () => {
  it('reads every course with its name, ECTS, type, year and period', async () => {
    const r = await parsed;
    expect(r.courses).toHaveLength(EXPECTED.courses);
    expect(r.courses.map((c) => c.name)).toEqual(EXPECTED.names);
    expect(r.program).toBe(EXPECTED.program);
    expect(r.programName).toBe('Bachelor in Business Administration');
    const fa = r.courses[0];
    expect(fa).toMatchObject({ code: '810000', ects: 6, type: 'B', academicYear: '24/25', period: 'S1', grade: 9.6, qualification: 'S', yearOfStudy: 1 });
    expect(r.courses.find((c) => c.code === '29071')).toMatchObject({ ects: 30, type: 'OP', period: 'S2', inProgress: true, grade: null });
    expect(r.courses.find((c) => c.code === '760044')).toMatchObject({ period: 'annual', outcome: 'pass', grade: null, supplementary: true });
    expect(r.warnings).toEqual([]);
  });

  it('handles honours, waived calls, failed attempts and courses in progress', async () => {
    const r = await parsed;
    expect(r.courses.filter((c) => c.honors)).toHaveLength(EXPECTED.honors);
    expect(r.courses.filter((c) => c.inProgress)).toHaveLength(EXPECTED.inProgress);
    expect(r.courses.filter((c) => c.outcome === 'fail')).toHaveLength(EXPECTED.failed);
    expect(r.courses.filter((c) => c.outcome === 'pass')).toHaveLength(EXPECTED.passNoGrade);
    const cost = r.courses.find((c) => c.code === '810006')!;
    expect(cost).toMatchObject({ grade: 7.5, call: 'extraordinary', qualification: 'N' });
    const micro = r.courses.filter((c) => c.code === '810010');
    expect(micro.map((c) => [c.academicYear, c.grade, c.outcome])).toEqual([
      ['24/25', 4.2, 'fail'],
      ['25/26', 6.5, null],
    ]);
  });

  it('computes the same GPA as the one printed on the transcript', async () => {
    const r = await parsed;
    expect(r.officialGpa).toBe(EXPECTED.officialGpa);
    expect(transcriptGpa(r.courses)).toBeCloseTo(EXPECTED.gpa, 6);
    expect(Math.round(transcriptGpa(r.courses)! * 10) / 10).toBe(EXPECTED.officialGpa);
    expect(r.exchanges).toEqual([EXPECTED.exchange]);
  });

  it('never extracts identity details', async () => {
    const text = JSON.stringify(await parsed);
    for (const v of Object.values(FAKE_IDENTITY)) expect(text).not.toContain(v);
    expect(text).not.toMatch(/JANE|TESTER/);
  });

  it('rejects documents that are not IE transcripts', () => {
    expect(() => parseIeTranscript([{ str: 'Hello world', x: 10, y: 10, w: 40, page: 1 }])).toThrow(TranscriptError);
  });

  it('title-cases names sensibly', () => {
    expect(titleCase('TECH TOOLS: FUNDAMENTALS OF EXCEL')).toBe('Tech Tools: Fundamentals of Excel');
    expect(titleCase('IE-CHALLENGE')).toBe('IE-Challenge');
    expect(titleCase('RESEARCH & ACADEMIC WRITING SKILLS')).toBe('Research & Academic Writing Skills');
    expect(titleCase('HOW TO PICK AND EXECUTE COMPETITIVE STRATEGY FOR SUCCESS')).toBe('How to Pick and Execute Competitive Strategy for Success');
    expect(titleCase('BUSINESS-DRIVEN INFORMATION TECHNOLOGIES')).toBe('Business-Driven Information Technologies');
  });
});

describe('importing a transcript', () => {
  it('creates semesters and courses whose GPA matches the transcript', async () => {
    const r = await parsed;
    const { data, summary } = applyTranscript(emptyData(), r);
    expect(summary).toEqual({ semestersAdded: 6, coursesAdded: 12, coursesUpdated: 0 });
    expect(data.settings).toMatchObject({ university: 'ie', gradeScale: 'ten', gpaScale: 'ten', creditUnit: 'ECTS' });
    expect(data.profile.program).toBe('BBA');
    expect(data.semesters.map((s) => s.name).sort()).toEqual(
      ['BBA Y1 · Fall 2024', 'BBA Y1 · Spring 2025', 'BBA Y2 · Fall 2025', 'BBA Y2 · Spring 2026', 'BBA Y3 · Fall 2026', 'BBA Y3 · Spring 2027 · Exchange'].sort(),
    );
    const gpa = computeGpa(data.courses, data.items, data.settings, { finalOnly: true });
    expect(formatGpa(gpa.gpa, 'ten')).toBe(formatGpa(EXPECTED.gpa, 'ten'));
    expect(gpa.gradedCredits).toBe(EXPECTED.degreeCreditsGraded);
    expect(ectsSummary(data.courses, data.items, data.settings)).toEqual({ passed: 34, inProgress: 35 });

    const abroad = data.courses.find((c) => c.subjectCode === '29071')!;
    expect(abroad.name).toBe('Electives Abroad · University of Testing');
    expect(abroad.category).toBe('elective');
    const failed = data.courses.find((c) => c.subjectCode === '810010' && c.countsInGpa === false)!;
    expect(failed.notes).toMatch(/not counted/);
    const spanish = data.courses.find((c) => c.subjectCode === '42095')!;
    expect(spanish).toMatchObject({ category: 'supplementary', countsInGpa: false, gradeOverride: 81 });
    expect(data.courses.find((c) => c.subjectCode === '790036')).toMatchObject({ honors: true, gradeOverride: 100, code: 'EMP' });
    // Courses in one semester get distinct colours.
    const fall26 = data.courses.filter((c) => c.semesterId === data.semesters.find((s) => s.extKey === semesterKey('26/27', 'S1'))!.id);
    expect(new Set(fall26.map((c) => c.color)).size).toBe(fall26.length);
  });

  it('importing again updates grades without duplicates and keeps your edits', async () => {
    const r = await parsed;
    const first = applyTranscript(emptyData(), r).data;
    const again = applyTranscript(first, r);
    expect(again.summary).toEqual({ semestersAdded: 0, coursesAdded: 0, coursesUpdated: 0 });
    expect(again.data.courses).toHaveLength(12);

    // The user renames a course; a later transcript grades a course that was in progress.
    const edited = structuredClone(first);
    const mc = edited.courses.find((c) => c.subjectCode === '810027')!;
    mc.name = 'Mgmt Control (Prof. X)';
    const newer = structuredClone(r);
    const mcT = newer.courses.find((c) => c.code === '810027')!;
    Object.assign(mcT, { grade: 8.4, qualification: 'N', inProgress: false, call: 'ordinary' });
    const res = applyTranscript(edited, newer);
    const mc2 = res.data.courses.find((c) => c.subjectCode === '810027')!;
    expect(mc2.name).toBe('Mgmt Control (Prof. X)');
    expect(mc2.gradeOverride).toBe(84);
    expect(res.summary.coursesUpdated).toBe(1);
  });
});

describe('import helpers', () => {
  it('abbreviates course names', () => {
    expect(abbreviate('Data Analysis for Economics')).toBe('DAE');
    expect(abbreviate('Career Development 3')).toBe('CD3');
    expect(abbreviate('IE Challenge')).toBe('IEC');
    expect(abbreviate('Strengths-Based Mindset')).toBe('SBM');
  });

  it('matches names despite accents, case and punctuation', () => {
    expect(nameSimilarity('Strategies for Competing in Industries & Markets', 'STRATEGIES FOR COMPETING IN INDUSTRIES AND MARKETS')).toBe(1);
    expect(nameSimilarity('Gestión de operaciones', 'Gestion de Operaciones')).toBe(1);
    expect(nameSimilarity('Microeconomics', 'Macroeconomics')).toBe(0);
  });

  it('merges imported fields: your edits win, official changes win where they should', () => {
    const prev = { title: 'Essay', score: null, dueDate: '2026-10-10' };
    // Untouched: take the new value.
    expect(mergeFields({ title: 'Essay', score: null, dueDate: '2026-10-10' }, prev, { title: 'Essay 1', dueDate: '2026-10-10', score: 8 }).changes).toEqual({ title: 'Essay 1', score: 8 });
    // Renamed by the user: keep the user's title even if the source renames it.
    const r = mergeFields({ title: 'My essay', score: null, dueDate: '2026-10-12' }, prev, { title: 'Essay 1', dueDate: '2026-10-10' }, ['dueDate']);
    expect(r.changes).toEqual({});
    // …but an official date change replaces a date the user moved.
    const r2 = mergeFields({ title: 'My essay', score: null, dueDate: '2026-10-12' }, prev, { title: 'Essay', dueDate: '2026-10-15' }, ['dueDate']);
    expect(r2.changes).toEqual({ dueDate: '2026-10-15' });
    expect(r2.overridden).toEqual(['dueDate']);
    expect(r2.synced.dueDate).toBe('2026-10-15');
  });
});
