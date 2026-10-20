/**
 * Pure helpers that interpret Blackboard data: term names, class sessions in the calendar,
 * gradebook columns, grades and syllabus criteria. Formats are those seen on IE University's
 * Blackboard Learn (Ultra); everything degrades gracefully on other Blackboard sites.
 */
import type { ItemKind, SessionMode } from '../../lib/types';
import { normalizeName, nameSimilarity } from '../common';
import { titleCase } from '../transcript/ie';
import type { BbCalendarItem, BbColumn, BbCriterion, BbGrade, BbTerm } from './types';

type Half = 'S1' | 'S2' | 'annual';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant → local "YYYY-MM-DD" and "HH:MM" (the student's own time zone). */
export function localParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** "26/27" for a date between September 2026 and August 2027. */
export function academicYearOf(date: Date): string {
  const y = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return `${pad(y % 100)}/${pad((y + 1) % 100)}`;
}

/** First day of the half-year a period covers (for spotting stale dates copied from old courses). */
export function periodStart(academicYear: string, half: Half): string {
  const y = 2000 + Number(academicYear.slice(0, 2));
  return half === 'S2' ? `${y + 1}-01-01` : `${y}-09-01`;
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

const ORDINALS: Record<string, number> = {
  first: 1, primero: 1, primer: 1, second: 2, segundo: 2, third: 3, tercero: 3, tercer: 3,
  fourth: 4, cuarto: 4, fifth: 5, quinto: 5, sixth: 6, sexto: 6,
};

export interface TermInfo {
  program: string | null;
  academicYear: string | null;
  half: Half | null;
  yearOfStudy: number | null;
}

/** "BBA 26-27 THIRD Q1" → { program: "BBA", academicYear: "26/27", half: "S1", yearOfStudy: 3 }. */
export function parseTerm(term: BbTerm | null, fallbackDate?: Date): TermInfo {
  const empty: TermInfo = { program: null, academicYear: null, half: null, yearOfStudy: null };
  if (!term) return empty;
  const m = /^(.*?)\s*(\d{2})\s*[-/]\s*(\d{2})\s+(\S+)?\s*(Q1|Q2|S1|S2|1Q|2Q|Anual|Annual|Full Year|Year)\b/i.exec(term.name.trim());
  if (m) {
    const half = /^(Q1|S1|1Q)$/i.test(m[5]) ? 'S1' : /^(Q2|S2|2Q)$/i.test(m[5]) ? 'S2' : 'annual';
    return {
      program: m[1].trim() || null,
      academicYear: `${m[2]}/${m[3]}`,
      half,
      yearOfStudy: m[4] ? (ORDINALS[m[4].toLowerCase()] ?? null) : null,
    };
  }
  // Other Blackboard sites: fall back to the term's dates.
  const start = term.start ? new Date(term.start) : fallbackDate;
  if (!start || Number.isNaN(start.getTime())) return empty;
  const month = start.getMonth();
  return { program: null, academicYear: academicYearOf(start), half: month >= 7 || month <= 0 ? 'S1' : 'S2', yearOfStudy: null };
}

/** Programs whose courses are supplementary training, not degree subjects (IE). */
export function isSupplementaryProgram(program: string | null): boolean {
  return !!program && /^(OACT|LANG|Seminarios|SEMINARIOS)/i.test(program);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** "CAREER DEVELOPMENT 3 - SINGLE" → "Career Development 3"; "IE-CHALLENGE" → "IE Challenge". */
export function cleanCourseName(name: string): string {
  const base = name
    .replace(/\s*-\s*(SINGLE|DOUBLE|GRADO SIMPLE|DOBLE GRADO)\s*$/i, '')
    .replace(/^IE-(?=[A-Z])/, 'IE ')
    .replace(/\s+/g, ' ')
    .trim();
  return base === base.toUpperCase() ? titleCase(base) : base;
}

const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'dos', 'das', 'van', 'von', 'di', 'du', 'le']);

/** "MARÍA DE LA TORRE SANZ" → "María de la Torre Sanz". */
export function personName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  if (!cleaned) return '';
  const looksShouted = cleaned === cleaned.toUpperCase();
  if (!looksShouted) return cleaned;
  return cleaned
    .toLocaleLowerCase('es')
    .split(' ')
    .map((w, i) => (i > 0 && NAME_PARTICLES.has(w) ? w : w.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase('es'))))
    .join(' ');
}

/** Column titles: drop weight/points notes, fix "Groupal". */
export function cleanItemTitle(name: string): string {
  return name
    .replace(/\(\s*\d+(?:[.,]\d+)?\s*(?:%|pts?|points?|puntos)\s*\)/gi, ' ')
    .replace(/\bGroupal\b/g, 'Group')
    .replace(/\s+/g, ' ')
    .replace(/[\s:–-]+$/, '')
    .trim();
}

/** Plain text from a short HTML description. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Class sessions (calendar items of type "Course")
// ---------------------------------------------------------------------------

export interface ParsedSession {
  date: string;
  start: string | null;
  end: string | null;
  mode: SessionMode;
  room: string;
  /** "Session 5" / "Sessions 5–6", or '' */
  label: string;
  /** Number of class sessions this slot counts for (double sessions count 2). */
  count: number;
  topic: string;
  instructor: string;
}

const NOISE = /^(?:topic|tema|lecture|clase|class|session|sesi[oó]n|computer class)\s*(?:\d+\s*[:.\-–]?|[:.\-–])\s*/i;
const ONLY_NOISE = /^(?:class|clase|lecture|session|sesi[oó]n|computer class)\s*\d*$/i;

function sentenceCase(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s;
  const lower = s.toLocaleLowerCase('en');
  return lower.charAt(0).toLocaleUpperCase('en') + lower.slice(1);
}

/**
 * Session descriptions look like "<topic>\n<INSTRUCTOR>. ICALUID:…"; without a topic just
 * "<Instructor> ." or "<Instructor> . CONTENT: .".
 */
export function parseDescription(description: string): { topic: string; instructor: string } {
  const lines = description
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { topic: '', instructor: '' };
  const last = lines[lines.length - 1];
  const ical = last.search(/ICALUID/i);
  let instructor = '';
  let topicLines = lines;
  if (ical >= 0) {
    instructor = last.slice(0, ical);
    topicLines = lines.slice(0, -1);
  } else if (/\s\.\s*$|CONTENT:/i.test(last)) {
    instructor = last;
    topicLines = lines.slice(0, -1);
  }
  instructor = instructor.replace(/CONTENT:\s*\.?/gi, '').replace(/[\s.]+$/, '').trim();
  let topic = topicLines.join(' ').replace(/ICALUID:\S*/gi, '').trim();
  for (let i = 0; i < 3 && NOISE.test(topic); i++) topic = topic.replace(NOISE, '');
  topic = topic.replace(/^[\s:.\-–]+|[\s:.\-–]+$/g, '');
  if (ONLY_NOISE.test(topic) || (instructor && normalizeName(topic) === normalizeName(instructor))) topic = '';
  return { topic: sentenceCase(topic).slice(0, 140), instructor };
}

/** A class session, or null for items that are not sessions (e.g. the Teams duplicate). */
export function parseSession(item: BbCalendarItem): ParsedSession | null {
  if (item.type !== 'Course') return null;
  const title = item.title ?? '';
  const location = (item.location ?? '').trim();
  const ses = /\(\s*Ses\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*\)/i.exec(title);
  // Teams/Zoom duplicates carry the meeting link as location and no session number.
  if (/^https?:\/\//i.test(location) && !ses) return null;
  const startP = localParts(item.start);
  const endP = localParts(item.end);
  if (!startP || !endP) return null;
  const mode: SessionMode = /asynchron|as[ií]ncron/i.test(title) ? 'async' : /live online|online|remote|zoom|teams|en l[ií]nea/i.test(title) || /^live online$/i.test(location) ? 'online' : 'in_person';
  let date = startP.date;
  if (mode === 'async') {
    // Asynchronous slots run 00:00–23:59 Madrid time; the midpoint gives the right day anywhere.
    const mid = new Date((Date.parse(item.start) + Date.parse(item.end)) / 2).toISOString();
    date = localParts(mid)?.date ?? date;
  }
  const { topic, instructor } = parseDescription(item.description ?? '');
  const a = ses ? Number(ses[1]) : null;
  const b = ses?.[2] ? Number(ses[2]) : null;
  return {
    date,
    start: mode === 'async' ? null : startP.time,
    end: mode === 'async' ? null : endP.date === startP.date ? endP.time : '23:59',
    mode,
    room: mode === 'in_person' && !/^https?:/i.test(location) ? location : '',
    label: a === null ? '' : b !== null && b !== a ? `Sessions ${a}–${b}` : `Session ${a}`,
    count: a !== null && b !== null && b > a ? b - a + 1 : 1,
    topic,
    instructor,
  };
}

export type ExamKind = 'final' | 'midterm' | null;

export function examKindOf(text: string): ExamKind {
  if (/final\s*(exam|test|examination)|examen\s*final|prueba\s*final/i.test(text)) return 'final';
  if (/mid-?\s*term|intermediate\s*(exam|test)|partial\s*exam|parcial|examen\s*intermedio/i.test(text)) return 'midterm';
  return null;
}

// ---------------------------------------------------------------------------
// Gradebook
// ---------------------------------------------------------------------------

const IGNORED_COLUMN =
  /attendance|qw\s*attendance|asistencia|overall|\btotal\b|weighted|running|extraordinar|retake|resit|recuperaci[oó]n|re-?sit|mock|test your settings|practice (test|quiz|exam)|cumulative|\baverage\b|\bmedia\b/i;

/** Calculated totals, attendance trackers, resit placeholders and 0-point practice items are not tasks. */
export function isIgnoredColumn(c: BbColumn): boolean {
  return c.gradingType === 'Calculated' || !c.available || !(c.possible !== null && c.possible > 0) || IGNORED_COLUMN.test(c.name);
}

export function isParticipationName(name: string): boolean {
  return /participa|engagement|contribution|class contribution/i.test(name);
}

export function classifyKind(name: string): ItemKind {
  if (examKindOf(name) || /\bexam\b|examen|final test/i.test(name)) return 'exam';
  if (/quiz|\btest\b|cuestionario|kahoot/i.test(name)) return 'quiz';
  if (isParticipationName(name)) return 'participation';
  if (/group|team|equipo|grupo|project|proyecto|presentation|presentaci[oó]n|poster|pitch|competition|challenge/i.test(name)) return 'project';
  return 'assignment';
}

/** A Blackboard grade as a score on the column's own scale. */
export function gradeScore(g: BbGrade | undefined, possible: number | null): number | null {
  if (!g || g.score === null || !Number.isFinite(g.score) || !possible || possible <= 0) return null;
  const raw = g.scaleType === 'Percent' ? (g.score / 100) * possible : g.score;
  return Math.round(Math.min(Math.max(raw, 0), possible) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Syllabus criteria ↔ gradebook columns
// ---------------------------------------------------------------------------

export type CriterionClass = 'final' | 'midterm' | 'exam' | 'quiz' | 'participation' | 'group' | 'individual' | 'other';

export function criterionClass(name: string): CriterionClass {
  const ek = examKindOf(name);
  if (ek) return ek;
  if (/\bexam|examen/i.test(name)) return 'exam';
  if (/quiz|\btest\b|cuestionario/i.test(name)) return 'quiz';
  if (isParticipationName(name) || /attendance|asistencia/i.test(name)) return 'participation';
  if (/group|team|groupal|equipo|grupo|project|proyecto|presentation|presentaci[oó]n|poster|competition/i.test(name)) return 'group';
  if (/individual|assignment|essay|report|homework|exercise|case|tarea|trabajo|ensayo|ejercicio|journal|reflection|paper/i.test(name)) return 'individual';
  return 'other';
}

function compatible(crit: CriterionClass, col: CriterionClass): boolean {
  if (crit === col) return true;
  if (crit === 'exam') return col === 'final' || col === 'midterm' || col === 'exam';
  if (crit === 'individual') return col === 'other';
  return false;
}

/**
 * Assign syllabus criteria to gradebook columns. Returns, for each criterion, the columns it
 * covers (possibly none). A column belongs to at most one criterion.
 */
export function matchCriteria(criteria: BbCriterion[], columns: BbColumn[]): Map<number, BbColumn[]> {
  const result = new Map<number, BbColumn[]>();
  const used = new Set<string>();
  const colClass = new Map(columns.map((c) => [c.id, criterionClass(c.name)]));
  const sameKind = (a: CriterionClass, b: CriterionClass) => compatible(a, b) || compatible(b, a);
  // A column can serve a criterion of the same kind, or (for generic names) one with a close name.
  // Different specific kinds never match: a "Midterm exam" column is not the "Final exam".
  const eligible = (cls: CriterionClass, crit: BbCriterion, col: BbColumn) => {
    const cc = colClass.get(col.id)!;
    if (sameKind(cls, cc)) return true;
    return (cls === 'other' || cc === 'other') && nameSimilarity(col.name, crit.name) >= 0.5;
  };
  // Most specific criteria first, so "Final exam" grabs its column before a generic "Exams".
  const order = criteria.map((c, i) => ({ c, i, cls: criterionClass(c.name) })).sort((a, b) => Number(a.cls === 'other') - Number(b.cls === 'other'));
  for (const { c, i, cls } of order) {
    const free = columns.filter((col) => !used.has(col.id) && eligible(cls, c, col));
    let chosen = free.filter((col) => nameSimilarity(col.name, c.name) >= 0.5);
    if (chosen.length === 0 && cls !== 'other') {
      // Fall back on the kind alone when no other criterion competes for it.
      const competing = criteria.filter((x) => sameKind(criterionClass(x.name), cls)).length;
      if (competing === 1) chosen = free.filter((col) => sameKind(cls, colClass.get(col.id)!));
    }
    for (const col of chosen) used.add(col.id);
    result.set(i, chosen);
  }
  return result;
}

/** "40 %" → 40; "12,5%" → 12.5. */
export function parseWeight(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*%?/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Combine duplicate criteria and drop all-zero tables. */
export function normalizeCriteria(rows: { name: string; weight: string; note?: string }[]): BbCriterion[] {
  const out = new Map<string, BbCriterion>();
  for (const r of rows) {
    const name = r.name.replace(/\s+/g, ' ').trim();
    if (!name || /^total/i.test(name)) continue;
    const weight = parseWeight(r.weight);
    if (weight === null) continue;
    const key = normalizeName(name);
    const prev = out.get(key);
    const note = /minim|mínim|mandatory|obligator|required|pass/i.test(r.note ?? '') ? (r.note ?? '').trim() : '';
    if (prev) prev.weight += weight;
    else out.set(key, { name, weight, note });
  }
  const list = [...out.values()];
  return list.reduce((t, c) => t + c.weight, 0) > 0 ? list : [];
}
