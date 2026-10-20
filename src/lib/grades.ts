/**
 * Grade maths. Everything is stored as a percentage (0–100) and converted for display
 * using the chosen grade scale (0–10, 0–20 or 0–100) and GPA scale.
 */
import { formatNumber, round } from './format';
import type { Course, GpaBand, GpaScale, GradeScale, Item, Settings } from './types';

export const SCALE_MAX: Record<GradeScale, number> = { ten: 10, twenty: 20, hundred: 100 };
export const GPA_MAX: Record<GpaScale, number> = { four: 4, ten: 10, twenty: 20, hundred: 100 };

export const SCALE_LABEL: Record<GradeScale, string> = { ten: '0–10', twenty: '0–20', hundred: '0–100%' };
export const GPA_LABEL: Record<GpaScale, string> = {
  four: '4.0 scale (letter grades)',
  ten: '10-point weighted average',
  twenty: '20-point weighted average',
  hundred: 'Percentage weighted average',
};

export function toScale(percent: number, scale: GradeScale): number {
  return (percent / 100) * SCALE_MAX[scale];
}

export function fromScale(value: number, scale: GradeScale): number {
  return (value / SCALE_MAX[scale]) * 100;
}

/** "8.35" on 0–10, "16.7" on 0–20, "83.5%" on 0–100. */
export function formatGrade(percent: number | null, scale: GradeScale, withMax = false): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  if (scale === 'hundred') return `${formatNumber(percent, 1)}%`;
  const v = formatNumber(round(toScale(percent, scale), 2), 2);
  return withMax ? `${v}/${SCALE_MAX[scale]}` : v;
}

export function formatGpa(value: number | null, scale: GpaScale): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (scale === 'hundred') return `${formatNumber(value, 1)}%`;
  return formatNumber(round(value, 2), 2, 2);
}

/** Sorted high → low so the first band whose minimum is met wins. */
export function sortBands(table: GpaBand[]): GpaBand[] {
  return [...table].sort((a, b) => b.min - a.min);
}

export function bandFor(percent: number, table: GpaBand[]): GpaBand | null {
  for (const band of sortBands(table)) if (percent + 1e-9 >= band.min) return band;
  return null;
}

/** Grade points for one course on the chosen GPA scale. */
export function toPoints(percent: number, settings: Pick<Settings, 'gpaScale' | 'gpaTable'>): number {
  switch (settings.gpaScale) {
    case 'four':
      return bandFor(percent, settings.gpaTable)?.points ?? 0;
    case 'ten':
      return percent / 10;
    case 'twenty':
      return percent / 5;
    case 'hundred':
      return percent;
  }
}

// ---------------------------------------------------------------------------
// Course grade
// ---------------------------------------------------------------------------

export function itemPercent(item: Pick<Item, 'score' | 'maxScore'>): number | null {
  if (item.score === null || item.maxScore === null || !(item.maxScore > 0)) return null;
  return (item.score / item.maxScore) * 100;
}

export interface CourseGrade {
  /** Weighted average of graded work so far (percent), or null if nothing is graded. */
  current: number | null;
  /** Final grade used for GPA: manual override if set, otherwise `current`. */
  effective: number | null;
  isOverride: boolean;
  /** Weight of graded items (percentage points). */
  gradedWeight: number;
  /** Weight of every weighted item entered so far. */
  enteredWeight: number;
  /** Course total the weights are measured against (100, or more if weights exceed 100). */
  plannedWeight: number;
  /** Weight not graded yet (includes weight not entered yet). */
  remainingWeight: number;
  /** Σ weight × score, in percentage points of the final grade. */
  earned: number;
  /** Final grade if every remaining assessment scored 0 / 100. */
  minPossible: number | null;
  maxPossible: number | null;
  /** True when grades exist but no weights, so items count equally. */
  equalWeighting: boolean;
  gradedCount: number;
  warning: string | null;
}

export function courseItems(courseId: string, items: Item[]): Item[] {
  return items.filter((i) => i.courseId === courseId && i.kind !== 'personal');
}

export function courseGrade(course: Pick<Course, 'id' | 'gradeOverride'>, allItems: Item[]): CourseGrade {
  const items = courseItems(course.id, allItems);
  let gradedWeight = 0;
  let enteredWeight = 0;
  let earned = 0;
  let gradedCount = 0;
  const unweightedPercents: number[] = [];

  for (const it of items) {
    const p = itemPercent(it);
    const w = it.weight ?? 0;
    if (w > 0) enteredWeight += w;
    if (p === null) continue;
    gradedCount += 1;
    if (w > 0) {
      gradedWeight += w;
      earned += (w * p) / 100;
    } else {
      unweightedPercents.push(p);
    }
  }

  const plannedWeight = Math.max(100, enteredWeight);
  const remainingWeight = Math.max(0, plannedWeight - gradedWeight);
  let current: number | null = null;
  let equalWeighting = false;
  if (gradedWeight > 0) current = (earned / gradedWeight) * 100;
  else if (unweightedPercents.length > 0) {
    current = unweightedPercents.reduce((a, b) => a + b, 0) / unweightedPercents.length;
    equalWeighting = true;
  }

  let warning: string | null = null;
  if (enteredWeight > 100 + 1e-9) warning = `Weights add up to ${formatNumber(enteredWeight, 1)}% — they should total 100%.`;
  else if (gradedWeight > 0 && unweightedPercents.length > 0) warning = `${unweightedPercents.length} graded item(s) have no weight and are not counted.`;
  else if (equalWeighting) warning = 'No weights entered — graded items count equally.';

  const isOverride = course.gradeOverride !== null && Number.isFinite(course.gradeOverride);
  const hasWeights = gradedWeight > 0;
  return {
    current,
    effective: isOverride ? course.gradeOverride : current,
    isOverride,
    gradedWeight,
    enteredWeight,
    plannedWeight,
    remainingWeight,
    earned,
    minPossible: hasWeights ? (earned / plannedWeight) * 100 : null,
    maxPossible: hasWeights ? ((earned + remainingWeight) / plannedWeight) * 100 : null,
    equalWeighting,
    gradedCount,
    warning,
  };
}

export type TargetStatus = 'reachable' | 'secured' | 'impossible' | 'final' | 'unknown';

export interface TargetResult {
  status: TargetStatus;
  /** Average needed on all remaining work, as a percentage. */
  required: number | null;
}

/** What average is needed on the remaining (ungraded) weight to finish at `target` percent. */
export function requiredForTarget(g: CourseGrade, target: number): TargetResult {
  if (g.isOverride) return { status: 'final', required: null };
  if (g.gradedWeight <= 0) return { status: g.equalWeighting ? 'unknown' : 'reachable', required: g.equalWeighting ? null : target };
  if (g.remainingWeight <= 1e-9) return { status: (g.current ?? 0) + 1e-9 >= target ? 'secured' : 'final', required: null };
  const required = (((target / 100) * g.plannedWeight - g.earned) / g.remainingWeight) * 100;
  if (required <= 0) return { status: 'secured', required: 0 };
  if (required > 100 + 1e-9) return { status: 'impossible', required };
  return { status: 'reachable', required };
}

// ---------------------------------------------------------------------------
// GPA & averages
// ---------------------------------------------------------------------------

/** A grade is final when entered by hand or when every weighted assessment is graded. */
export function isFinalGrade(g: CourseGrade): boolean {
  return g.isOverride || (g.gradedWeight > 0 && g.remainingWeight <= 1e-9 && !g.equalWeighting);
}

export const CATEGORY_LABEL = { basic: 'Basic', compulsory: 'Compulsory', elective: 'Elective', supplementary: 'Supplementary' } as const;

/** Spanish qualification for a 0–10 grade (Suspenso … Sobresaliente, Matrícula de Honor). */
export function qualification(percent: number | null, honors = false): string | null {
  if (percent === null) return null;
  if (honors) return 'Matrícula de Honor';
  const v = percent / 10;
  if (v < 5 - 1e-9) return 'Suspenso';
  if (v < 7 - 1e-9) return 'Aprobado';
  if (v < 9 - 1e-9) return 'Notable';
  return 'Sobresaliente';
}

export interface GpaResult {
  gpa: number | null;
  credits: number;
  gradedCredits: number;
  courses: number;
}

/**
 * Credit-weighted GPA over courses that count toward it (supplementary training is excluded).
 * `finalOnly` restricts it to courses with a final grade — the official, transcript-style GPA.
 */
export function computeGpa(courses: Course[], items: Item[], settings: Pick<Settings, 'gpaScale' | 'gpaTable'>, opts: { finalOnly?: boolean } = {}): GpaResult {
  let weighted = 0;
  let gradedCredits = 0;
  let credits = 0;
  let n = 0;
  for (const c of courses) {
    if (c.countsInGpa === false) continue;
    credits += c.credits;
    const cg = courseGrade(c, items);
    if (opts.finalOnly && !isFinalGrade(cg)) continue;
    const g = cg.effective;
    if (g === null || !(c.credits > 0)) continue;
    weighted += toPoints(g, settings) * c.credits;
    gradedCredits += c.credits;
    n += 1;
  }
  return { gpa: gradedCredits > 0 ? weighted / gradedCredits : null, credits, gradedCredits, courses: n };
}

/** Simple (unweighted) mean of course grades, as a percentage. */
export function averageGrade(courses: Course[], items: Item[]): number | null {
  const grades = courses
    .filter((c) => c.countsInGpa !== false)
    .map((c) => courseGrade(c, items).effective)
    .filter((g): g is number => g !== null);
  if (grades.length === 0) return null;
  return grades.reduce((a, b) => a + b, 0) / grades.length;
}

export function isPassing(percent: number, settings: Pick<Settings, 'passPercent'>): boolean {
  return percent + 1e-9 >= settings.passPercent;
}

/** ECTS earned (passed) and still in progress, for courses that count toward the degree. */
export function ectsSummary(courses: Course[], items: Item[], settings: Pick<Settings, 'passPercent'>): { passed: number; inProgress: number } {
  let passed = 0;
  let inProgress = 0;
  for (const c of courses) {
    if (c.countsInGpa === false || !(c.credits > 0)) continue;
    const g = courseGrade(c, items);
    if (c.outcome === 'pass' || (isFinalGrade(g) && g.effective !== null && isPassing(g.effective, settings))) passed += c.credits;
    else if (c.outcome !== 'fail' && !(isFinalGrade(g) && g.effective !== null)) inProgress += c.credits;
  }
  return { passed, inProgress };
}
