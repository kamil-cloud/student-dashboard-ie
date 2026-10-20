// Builds a fake IE University transcript PDF with the real document's layout (column positions,
// wrapped bilingual names, grade rows) for an invented student. Used by unit and E2E tests so the
// suite never needs a real person's transcript.
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Identity details printed on the fake transcript; the parser must never extract them. */
export const FAKE_IDENTITY = { name: 'JANE TESTER DOE', id: '12345678Z', birth: '01/01/2005', file: '99999' };

export const EXPECTED = {
  courses: 12,
  program: 'BBA',
  officialGpa: 8.6,
  /** (9.6·6 + 7.5·6 + 10·6 + 6.5·6 + 8.8·6 + 9.2·4) / 34 — the failed attempt is excluded. */
  gpa: 291.2 / 34,
  degreeCreditsGraded: 34,
  honors: 1,
  passNoGrade: 1,
  failed: 1,
  inProgress: 3,
  extraordinary: 1,
  exchange: { academicYear: '26/27', period: 'S2', university: 'University of Testing - Business School' },
  names: [
    'Financial Accounting',
    'Cost Accounting',
    'Entrepreneurial Mindset and Practice',
    'Microeconomics',
    'Microeconomics',
    'Statistics & Data Analysis',
    'Organizational Behavior',
    'Electives Abroad',
    'Management Control',
    'Strengths-Based Mindset',
    'Career Development 1',
    'Spanish Intermediate 1',
  ],
};

const MAIN = { ects: 305, tipo: 323, curso: 341, ord: 401, extr: 435, matr: 517 };
const MAIN_HEADER = [
  [287, 'ECTS'],
  [317, 'Tipo'],
  [352, 'Curso'],
  [398, 'Ord.'],
  [429, 'Extr.'],
  [463, 'Conv.'],
  [509, 'Matr.'],
];
const FC = { ects: 301, tipo: 317, curso: 338, ord: 398, extr: 432, matr: 514 };
const FC_HEADER = [
  [284, 'ECTS'],
  [314, 'Tipo'],
  [348, 'Curso'],
  [395, 'Ord.'],
  [426, 'Extr.'],
  [458, 'Recon.'],
  [506, 'Matr.'],
];

export async function makeIeTranscriptPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page;
  const t = (x, y, s, f = font, size = 7.5) => page.drawText(s, { x, y, size, font: f });

  const newPage = (n) => {
    page = pdf.addPage([595, 842]);
    t(73, 811, 'IE Universidad', bold, 9);
    t(73, 789, '1 de octubre de 2026');
    t(506, 789, 'Segovia');
    t(433, 775, 'C/CARDENAL ZÚÑIGA, 12');
    t(73, 761, FAKE_IDENTITY.file);
    t(471, 761, '40003 - Segovia');
    t(73, 739, `DNI/Pasaporte: ${FAKE_IDENTITY.id}`);
    t(499, 46, `Pág. ${n} de 5`);
  };

  const header = (y, title, cols, left = 72) => {
    t(left, y, title, bold);
    for (const [x, s] of cols) t(x, y, s, bold);
    t(cols[2][0] + 1, y - 8, 'Acad.', bold);
  };

  /**
   * One course block: `lines` is the wrapped name text; the data row (ECTS/type/year) goes next to
   * `dataLine`; `ord`/`extr` are [value, qualification]; `enrolled` adds the "*".
   */
  const course = (y, c, cols = MAIN, left = 72) => {
    const step = 8.5;
    c.lines.forEach((line, i) => t(left, y - i * step, line));
    const dy = y - (c.dataLine ?? 1) * step + 4;
    t(cols.ects - (String(c.ects).length > 1 ? 5 : 0), dy, String(c.ects));
    t(cols.tipo - (c.type.length > 1 ? 3 : 0), dy, c.type);
    t(cols.curso, dy, c.year);
    if (c.enrolled) t(cols.matr, dy, '*');
    const gy = y - 4;
    const [ov, oq] = c.ord ?? ['--', null];
    const [ev, eq] = c.extr ?? ['--', null];
    t(cols.ord + (ov === '--' ? 2 : 0), gy, ov);
    t(cols.extr, gy, ev);
    if (oq) t(cols.ord - (oq.length > 3 ? 6 : 0), gy - 9, `(${oq})`);
    if (eq) t(cols.extr - 2, gy - 9, `(${eq})`);
    return y - Math.max(c.lines.length, 3) * step - 12;
  };

  // ---- page 1: first year ---------------------------------------------------
  newPage(1);
  t(67, 712, 'Facultad de Ciencias Humanas, Sociales y de la Comunicación');
  t(308, 712, FAKE_IDENTITY.name);
  t(67, 691, 'Grado en Administración de Empresas / Bachelor in Business');
  t(308, 691, `Nº de Expediente:${FAKE_IDENTITY.file}`);
  t(67, 681, 'Administration (BBA-Madrid)');
  t(93, 652, 'Grado en Administración de Empresas / Bachelor in Business Administration (BBA-Madrid)', bold);
  header(637, '1st Bachelor in Business Administration', MAIN_HEADER);
  let y = 613;
  y = course(y, {
    lines: ['(810000) CONTABILIDAD FINANCIERA/FINANCIAL', 'ACCOUNTING (Cursada en Inglés/Taken in English) - 1st', 'semester'],
    ects: 6, type: 'B', year: '24/25', ord: ['9.6', 'S'],
  });
  y = course(y, {
    lines: ['(810006) CONTABILIDAD DE COSTES/COST ACCOUNTING', '(Cursada en Inglés/Taken in English) - 2nd semester'],
    ects: 6, type: 'B', year: '24/25', ord: ['--', 'DIS'], extr: ['7.5', 'N'],
  });
  y = course(y, {
    lines: ['(790036) MENTALIDAD Y PRÁCTICA', 'EMPRENDEDORA/ENTREPRENEURIAL MINDSET AND', 'PRACTICE (Cursada en Inglés/Taken in English) - 2nd', 'semester'],
    ects: 6, type: 'O', year: '24/25', ord: ['10', 'SMH'], dataLine: 2,
  });
  course(y, {
    lines: ['(810010) MICROECONOMÍA/MICROECONOMICS (Cursada', 'en Inglés/Taken in English) - 2nd semester'],
    ects: 6, type: 'B', year: '24/25', ord: ['4.2', 'SUS'],
  });

  // ---- page 2: second year --------------------------------------------------
  newPage(2);
  header(726, '2nd Bachelor in Business Administration', MAIN_HEADER);
  y = 705;
  y = course(y, {
    lines: ['(810010) MICROECONOMÍA/MICROECONOMICS (Cursada', 'en Inglés/Taken in English) - 1st semester'],
    ects: 6, type: 'B', year: '25/26', ord: ['6.5', 'AP'],
  });
  y = course(y, {
    lines: ['(810017) ESTADÍSTICA Y ANÁLISIS DE', 'DATOS/STATISTICS & DATA ANALYSIS (Cursada en', 'Inglés/Taken in English) - 1st semester'],
    ects: 6, type: 'B', year: '25/26', ord: ['8.8', 'N'],
  });
  course(y, {
    lines: ['(810360) COMPORTAMIENTO', 'ORGANIZACIONAL/ORGANIZATIONAL BEHAVIOR (Cursada', 'en Inglés/Taken in English) - 2nd semester'],
    ects: 4, type: 'O', year: '25/26', ord: ['9.2', 'S'],
  });

  // ---- page 3: third year, summary, study abroad ------------------------------
  newPage(3);
  header(726, '3rd Bachelor in Business Administration', MAIN_HEADER);
  y = 701;
  y = course(y, {
    lines: ['(29071) OPTATIVAS EXTRANJERO/ELECTIVES ABROAD', '(Cursada en Inglés/Taken in English) - 2nd semester'],
    ects: 30, type: 'OP', year: '26/27', enrolled: true,
  });
  course(y, {
    lines: ['(810027) CONTROL DE GESTIÓN/MANAGEMENT CONTROL', '(Cursada en Inglés/Taken in English) - 1st semester'],
    ects: 5, type: 'O', year: '26/27', enrolled: true,
  });
  t(111, 487, 'Tipo de Asignatura', bold);
  t(234, 487, 'ECTS superados', bold);
  t(333, 487, 'Matriculados y por Superar', bold);
  t(466, 487, 'TOTALES', bold);
  t(114, 469, 'Formación Básica');
  t(259, 469, '30');
  t(478, 469, '30');
  t(212, 375, 'GPA', bold);
  t(270, 375, 'Bachelor Score', bold);
  t(214, 350, '8,6');
  t(291, 350, '8,6');
  t(74, 311, 'ECTS oficiales matriculados en el último curso: 35 Creditos');
  t(267, 247, 'Study Abroad', bold);
  t(59, 232, 'Periodo', bold);
  t(356, 232, 'Universidad', bold);
  t(59, 216, '2do semestre (26/27)');
  t(218, 216, 'UNIVERSITY OF TESTING - BUSINESS SCHOOL');

  // ---- page 4: supplementary training -----------------------------------------
  newPage(4);
  t(156, 679, 'FORMACIÓN COMPLEMENTARIA/SUPPLEMENTARY TRAINING', bold);
  header(665, 'Actividades Formativas/Training Activities', FC_HEADER, 69);
  y = 644;
  y = course(
    y,
    {
      lines: ['(32078) STRENGTHS-BASED MINDSET/STRENGTHS-', 'BASED MINDSET (Cursada en Inglés/Taken in English) -', '1st semester'],
      ects: 0, type: 'FC', year: '26/27', enrolled: true,
    },
    FC,
    69,
  );
  y = course(
    y,
    {
      lines: ['(760044) DESARROLLO PROFESIONAL 1 - GRADO', 'SIMPLE/CAREER DEVELOPMENT 1 - SINGLE (Cursada en', 'Inglés/Taken in English) - Annual'],
      ects: 0, type: 'FC', year: '24/25', ord: ['APT', 'APT'],
    },
    FC,
    69,
  );
  course(
    y,
    {
      lines: ['(42095) ESPAÑOL INTERMEDIO 1/SPANISH', 'INTERMEDIATE 1 (Cursada en Español/Taken in Spanish)', '- 1st semester'],
      ects: 3, type: 'FC', year: '24/25', ord: ['8.1', 'N'],
    },
    FC,
    69,
  );
  // Identity block right under the last course: must not be glued to it.
  t(96, 248, FAKE_IDENTITY.file);
  t(252, 248, `${FAKE_IDENTITY.birth} ${FAKE_IDENTITY.name}`);
  t(59, 203, 'Fec. Mat', bold);
  t(173, 203, 'Curso', bold);

  // ---- page 5: legend ----------------------------------------------------------
  newPage(5);
  t(59, 727, 'B: BASICA | O: OBLIGATORIA | OP: OPTATIVA | TFG: Trabajo fin de grado');
  t(59, 704, 'Abreviatura de calificación:', bold);
  t(59, 691, 'AP: Aprobado | APT: Apto | DIS: Dispensa | N: Notable | S: Sobresaliente | SMH: Sobresaliente y Matrícula de Honor | SUS: Suspenso');

  return pdf.save();
}
