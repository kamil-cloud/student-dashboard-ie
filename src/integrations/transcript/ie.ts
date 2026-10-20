/**
 * Parser for IE University's official transcript ("Expediente Académico", PDF).
 *
 * Works on positioned text (as extracted by pdf.js), not on raw lines, because course names wrap
 * over several lines while the ECTS / type / year / grade columns sit at fixed x positions:
 *
 *   (810000) CONTABILIDAD FINANCIERA/FINANCIAL              9.6   --
 *   ACCOUNTING (Cursada en Inglés/Taken in English) - 1st   6  B  24/25
 *   semester                                                (S)
 *
 * Only course data and the official GPA are read. Identity details printed on the transcript
 * (name, ID numbers, dates of birth, addresses) are never extracted.
 */

export interface PdfTextItem {
  str: string;
  /** Left edge, PDF units. */
  x: number;
  /** Baseline, PDF units (grows upwards). */
  y: number;
  /** Width, PDF units. */
  w: number;
  page: number;
}

export type CourseType = 'B' | 'O' | 'OP' | 'FC' | 'TFG' | 'OTHER';
export type Period = 'S1' | 'S2' | 'annual';

export interface TranscriptCourse {
  /** Official subject code, e.g. "810027". */
  code: string;
  /** English name in title case. */
  name: string;
  /** Spanish name as printed. */
  nameEs: string;
  ects: number;
  type: CourseType;
  /** e.g. "24/25". */
  academicYear: string;
  period: Period;
  /** 1 for "1st Bachelor…", null for supplementary training. */
  yearOfStudy: number | null;
  /** 0–10, null when not graded with a number. */
  grade: number | null;
  /** Abbreviation from the transcript legend, e.g. "S", "N", "SMH", "APT". */
  qualification: string | null;
  honors: boolean;
  outcome: 'pass' | 'fail' | null;
  /** Enrolled this year and not graded yet. */
  inProgress: boolean;
  call: 'ordinary' | 'extraordinary' | null;
  /** "Formación complementaria" — shown on the transcript but not part of the degree GPA. */
  supplementary: boolean;
  language: string | null;
}

export interface Exchange {
  academicYear: string;
  period: Period;
  university: string;
}

export interface TranscriptResult {
  format: 'ie';
  /** Short programme code, e.g. "BBA". */
  program: string | null;
  /** e.g. "Bachelor in Business Administration". */
  programName: string | null;
  courses: TranscriptCourse[];
  /** GPA printed on the transcript (0–10). */
  officialGpa: number | null;
  exchanges: Exchange[];
  warnings: string[];
}

export class TranscriptError extends Error {}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface Cell {
  x: number;
  w: number;
  s: string;
  /** Horizontal centre. */
  c: number;
}

interface Row {
  page: number;
  y: number;
  cells: Cell[];
  /** Text of the cells left of the data columns. */
  left: string;
}

/** Text left of this x is the course name; right of it, the data columns. */
const LEFT_MAX = 282;

function buildRows(items: PdfTextItem[]): Row[] {
  const rows: Row[] = [];
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const pageItems = items.filter((i) => i.page === page && i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
    const pageRows: Row[] = [];
    for (const it of pageItems) {
      let row = pageRows.find((r) => Math.abs(r.y - it.y) <= 2.5);
      if (!row) {
        row = { page, y: it.y, cells: [], left: '' };
        pageRows.push(row);
      }
      row.cells.push({ x: it.x, w: it.w, s: it.str.trim(), c: it.x + it.w / 2 });
    }
    for (const r of pageRows) {
      r.cells.sort((a, b) => a.x - b.x);
      r.left = r.cells
        .filter((c) => c.x < LEFT_MAX)
        .map((c) => c.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    rows.push(...pageRows.sort((a, b) => b.y - a.y));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

interface Columns {
  tipo: number;
  curso: number;
  ord: number;
  extr: number;
  conv: number;
}

const DEFAULT_COLUMNS: Columns = { tipo: 326, curso: 362, ord: 406, extr: 437, conv: 470 };

function isHeaderRow(r: Row): boolean {
  const texts = r.cells.map((c) => c.s);
  return texts.includes('ECTS') && texts.includes('Tipo');
}

function columnsFrom(r: Row): Columns {
  const at = (re: RegExp, fallback: number) => r.cells.find((c) => re.test(c.s))?.c ?? fallback;
  return {
    tipo: at(/^Tipo$/, DEFAULT_COLUMNS.tipo),
    curso: at(/^Curso$/, DEFAULT_COLUMNS.curso),
    ord: at(/^Ord\.?$/, DEFAULT_COLUMNS.ord),
    extr: at(/^Extr\.?$/, DEFAULT_COLUMNS.extr),
    conv: at(/^(Conv|Recon)\.?$/, DEFAULT_COLUMNS.conv),
  };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'vs', 'via']);
const ACRONYMS = new Set(['IE', 'AI', 'HR', 'ESG', 'CSR', 'BBA', 'PPE', 'UX', 'UI', 'EU', 'UK', 'ICT', 'R&D', 'M&A', 'SQL', 'TFG', 'CFO', 'CEO', 'ERP', 'CRM', 'II', 'III', 'IV']);

/** "FINANCIAL ACCOUNTING & ANALYSIS" → "Financial Accounting & Analysis". */
export function titleCase(text: string): string {
  const words = text.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((word, i) =>
      word
        .split('-')
        .map((part, j) => {
          const upper = part.toUpperCase();
          if (ACRONYMS.has(upper.replace(/[^A-Z&]/g, ''))) return upper;
          const lower = part.toLocaleLowerCase('en');
          if (i > 0 && j === 0 && SMALL_WORDS.has(lower.replace(/[^a-z]/g, ''))) return lower;
          // Keep a leading punctuation mark, capitalise the first letter.
          return lower.replace(/^([^\p{L}]*)(\p{L})/u, (_, p: string, l: string) => p + l.toLocaleUpperCase('en'));
        })
        .join('-'),
    )
    .join(' ')
    .replace(/:\s*(\p{Ll})/gu, (_, l: string) => `: ${l.toLocaleUpperCase('en')}`);
}

/** Join wrapped name lines: "STRENGTHS-" + "BASED" → "STRENGTHS-BASED". */
function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[-/]$/.test(out) && /^\p{L}/u.test(line)) out += line;
    else out += ` ${line}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Split "SPANISH NAME/ENGLISH NAME" at the slash that best balances both halves. */
function splitBilingual(text: string): { es: string; en: string } {
  const slashes = [...text.matchAll(/\//g)].map((m) => m.index ?? -1).filter((i) => i > 0);
  if (slashes.length === 0) return { es: text, en: text };
  let best = slashes[0];
  for (const i of slashes) {
    const score = Math.abs(i - (text.length - i - 1));
    if (score < Math.abs(best - (text.length - best - 1))) best = i;
  }
  return { es: text.slice(0, best).trim(), en: text.slice(best + 1).trim() };
}

const NUM = /^\d+(?:[.,]\d+)?$/;
const toNum = (s: string) => Number(s.replace(',', '.'));

/** Qualifications that mean "passed" without a numeric grade. */
const PASS_NO_GRADE = new Set(['APT', 'SUP', 'REC', 'APR', 'AP', 'APC', 'NPR', 'SPR', 'MHR']);
const FAIL = new Set(['SUS', 'NAP', 'NP']);
const HONORS = new Set(['SMH', 'MHR']);
/** Not a result: the call was waived ("Dispensa") or left without a grade. */
const NO_RESULT = new Set(['DIS', 'SC', '--', '-', 'NP']);

interface CallResult {
  grade: number | null;
  qualification: string | null;
}

function readCall(cells: Cell[]): CallResult {
  let grade: number | null = null;
  let qualification: string | null = null;
  for (const c of cells) {
    const t = c.s.replace(/\s/g, '');
    if (NUM.test(t)) {
      const n = toNum(t);
      if (n >= 0 && n <= 10) grade = n;
    } else {
      const q = t.replace(/^\((.*)\)$/, '$1').toUpperCase();
      if (/^[A-Z]{1,4}$/.test(q) && !NO_RESULT.has(q)) qualification = q;
    }
  }
  return { grade, qualification };
}

const hasResult = (r: CallResult) => r.grade !== null || r.qualification !== null;

// ---------------------------------------------------------------------------
// Course blocks
// ---------------------------------------------------------------------------

const COURSE_START = /^\((\d{3,8})\)\s*(.*)$/;
const TERMINATOR =
  /^(Tipo de Asignatura|Tipo de asignatura|Formaci[oó]n B[aá]sica|Materias Obligatorias|Asignaturas Optativas|Total ECTS|GPA|ECTS oficiales|ECTS totales|Notas Contabilizadas|Study Abroad|Periodo|Fec\. Mat|Abreviatura|Tipos de Asignatura|Pág\.|P[aá]g\.)/;
/** Rows of one course are close together; a bigger gap ends the course. */
const MAX_ROW_GAP = 24;

interface Block {
  rows: Row[];
  columns: Columns;
  yearOfStudy: number | null;
  supplementary: boolean;
}

function parseBlock(b: Block, warnings: string[]): TranscriptCourse | null {
  const nameText = joinLines(b.rows.map((r) => r.left));
  const m = COURSE_START.exec(nameText);
  if (!m) return null;
  const code = m[1];
  let rest = m[2];

  let language: string | null = null;
  rest = rest.replace(/\(Cursada en [^/()]+\/Taken in ([^)]+)\)/i, (_, lang: string) => {
    language = lang.trim();
    return ' ';
  });

  let period: Period = 'S1';
  const periodMatch = /\s-\s*(1st semester|2nd semester|annual|1er semestre|2[º°o]? semestre|anual)\s*$/i.exec(rest);
  if (periodMatch) {
    const p = periodMatch[1].toLowerCase();
    period = p.startsWith('2') ? 'S2' : p.startsWith('annual') || p.startsWith('anual') ? 'annual' : 'S1';
    rest = rest.slice(0, periodMatch.index);
  } else {
    warnings.push(`(${code}) has no semester; assumed 1st semester`);
  }
  rest = rest.replace(/\s+/g, ' ').trim();

  const { es, en } = splitBilingual(rest);
  const cleanEn = en.replace(/\s*-\s*(SINGLE|DOUBLE|GRADO SIMPLE|DOBLE GRADO)\s*$/i, '').trim();
  const cleanEs = es.replace(/\s*-\s*(GRADO SIMPLE|DOBLE GRADO|SINGLE|DOUBLE)\s*$/i, '').trim();

  const right = b.rows.flatMap((r) => r.cells.filter((c) => c.x >= LEFT_MAX));
  const { columns: col } = b;
  const ordExtrSplit = (col.ord + col.extr) / 2;
  const extrConvSplit = (col.extr + col.conv) / 2;
  const gradeStart = (col.curso + col.ord) / 2;

  let ects: number | null = null;
  let type: CourseType = 'OTHER';
  let academicYear = '';
  let enrolled = false;
  const ordCells: Cell[] = [];
  const extrCells: Cell[] = [];

  for (const c of right) {
    const t = c.s.trim();
    if (t === '*') enrolled = true;
    else if (/^\d{2}\/\d{2}$/.test(t) && c.c < gradeStart) academicYear = t;
    else if (/^(B|O|OP|FC|TFG|T)$/.test(t) && c.c < col.curso) type = t === 'T' ? 'TFG' : (t as CourseType);
    else if (NUM.test(t) && c.c < (col.tipo + col.curso) / 2 && c.c < col.tipo - 4) ects = toNum(t);
    else if (c.c >= gradeStart && c.c < ordExtrSplit) ordCells.push(c);
    else if (c.c >= ordExtrSplit && c.c < extrConvSplit) extrCells.push(c);
  }

  if (!academicYear) {
    warnings.push(`(${code}) skipped: no academic year found`);
    return null;
  }
  if (ects === null) {
    warnings.push(`(${code}) has no ECTS; assumed 0`);
    ects = 0;
  }

  const ord = readCall(ordCells);
  const extr = readCall(extrCells);
  const final = hasResult(extr) ? extr : hasResult(ord) ? ord : null;
  const call = final === extr && hasResult(extr) ? 'extraordinary' : final ? 'ordinary' : null;

  let grade = final?.grade ?? null;
  const qualification = final?.qualification ?? null;
  let outcome: TranscriptCourse['outcome'] = null;
  if (qualification && FAIL.has(qualification)) outcome = 'fail';
  else if (grade !== null && grade < 5) outcome = 'fail';
  else if (grade === null && qualification && PASS_NO_GRADE.has(qualification)) outcome = 'pass';
  if (grade !== null && qualification === 'APT') grade = null; // "Apto" is pass/fail only

  return {
    code,
    name: titleCase(cleanEn || cleanEs),
    nameEs: cleanEs,
    ects,
    type,
    academicYear,
    period,
    yearOfStudy: b.supplementary ? null : b.yearOfStudy,
    grade,
    qualification,
    honors: !!qualification && HONORS.has(qualification),
    outcome,
    inProgress: !final && enrolled,
    call,
    supplementary: b.supplementary || type === 'FC',
    language,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function looksLikeIeTranscript(items: PdfTextItem[]): boolean {
  const text = items.map((i) => i.str).join(' ');
  return /IE Universidad|IE University/i.test(text) && /\(Cursada en|Taken in English|Expediente/i.test(text);
}

export function parseIeTranscript(items: PdfTextItem[]): TranscriptResult {
  if (!looksLikeIeTranscript(items)) {
    throw new TranscriptError('This does not look like an IE University transcript (Expediente Académico).');
  }
  const rows = buildRows(items);
  const warnings: string[] = [];
  const courses: TranscriptCourse[] = [];

  let columns = DEFAULT_COLUMNS;
  let yearOfStudy: number | null = null;
  let supplementary = false;
  let block: Block | null = null;
  let program: string | null = null;
  let programName: string | null = null;
  let officialGpa: number | null = null;
  const exchanges: Exchange[] = [];

  const close = () => {
    if (block) {
      const course = parseBlock(block, warnings);
      if (course) courses.push(course);
    }
    block = null;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const text = r.cells.map((c) => c.s).join(' ');

    if (!program) {
      const pm = /\(([A-Z]{2,6})(?:-[A-Za-zÀ-ÿ ]+)?\)/.exec(text);
      if (pm && /Bachelor|Grado|Master|Degree/i.test(text)) {
        program = pm[1];
        const nm = /\/\s*([^/(]*?(?:Bachelor|Master|Degree)[^/(]*?)\s*\(/i.exec(text);
        programName = nm ? nm[1].trim() : null;
      }
    }

    if (isHeaderRow(r)) {
      close();
      columns = columnsFrom(r);
      const ym = /^(\d+)(?:st|nd|rd|th|º|°)\b/i.exec(r.left);
      if (ym) {
        yearOfStudy = Number(ym[1]);
        supplementary = false;
      } else if (/Actividades Formativas|Training Activities|Complementar/i.test(r.left)) {
        supplementary = true;
      }
      continue;
    }
    if (/FORMACI[OÓ]N COMPLEMENTARIA|SUPPLEMENTARY TRAINING/i.test(text)) {
      close();
      supplementary = true;
      continue;
    }

    // Official GPA: a "GPA" header row followed by a row of numbers ("9,2").
    if (/^GPA\b/.test(text.trim()) || r.cells.some((c) => c.s === 'GPA')) {
      close();
      const next = rows[i + 1];
      const val = next?.cells.map((c) => c.s.trim()).find((s) => NUM.test(s));
      if (next && next.page === r.page && val) {
        const n = toNum(val);
        if (n >= 0 && n <= 10) officialGpa = n;
      }
      continue;
    }

    // Exchange periods: "2do semestre (26/27) | NATIONAL UNIVERSITY OF SINGAPORE - BUSINESS SCHOOL".
    const ex = /^(\d)\s*(?:er|ro|do|º|°|st|nd)?\s*(?:semestre|semester)\s*\((\d{2}\/\d{2})\)\s*(.+)$/i.exec(text.trim());
    if (ex) {
      close();
      exchanges.push({ academicYear: ex[2], period: ex[1] === '2' ? 'S2' : 'S1', university: titleCase(ex[3].trim()) });
      continue;
    }

    if (TERMINATOR.test(r.left) || TERMINATOR.test(text.trim())) {
      close();
      continue;
    }

    if (COURSE_START.test(r.left)) {
      close();
      block = { rows: [r], columns, yearOfStudy, supplementary };
      continue;
    }

    if (block) {
      const prev = (block as Block).rows[(block as Block).rows.length - 1];
      if (prev.page === r.page && prev.y - r.y <= MAX_ROW_GAP) (block as Block).rows.push(r);
      else close();
    }
  }
  close();

  if (courses.length === 0) throw new TranscriptError('No courses were found in this transcript.');

  // The same subject can appear twice (e.g. failed, then passed in a later year): keep both,
  // the earlier failed attempt simply does not count toward the GPA.
  return { format: 'ie', program, programName, courses, officialGpa, exchanges, warnings };
}

/** Credit-weighted GPA of graded degree subjects (how IE computes the "Bachelor Score"). */
export function transcriptGpa(courses: TranscriptCourse[]): number | null {
  let sum = 0;
  let credits = 0;
  for (const c of courses) {
    if (c.supplementary || c.grade === null || c.outcome === 'fail' || !(c.ects > 0)) continue;
    sum += c.grade * c.ects;
    credits += c.ects;
  }
  return credits > 0 ? sum / credits : null;
}
