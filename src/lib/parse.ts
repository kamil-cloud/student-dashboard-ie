/**
 * Input parsing for the number fields. Every parser returns either a clean value
 * (null means "left empty") or a human-readable error — invalid input is never stored.
 */

export type Parsed = { ok: true; value: number | null } | { ok: false; error: string };

const DECIMAL_RE = /^(\d+([.,]\d*)?|[.,]\d+)$/;

export interface NumberRules {
  min?: number;
  max: number;
  integer?: boolean;
  /** Short noun used in error messages, e.g. "Reps". */
  label: string;
}

export function parseNumber(raw: string, rules: NumberRules): Parsed {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  if (text.startsWith('-')) return { ok: false, error: `${rules.label} can't be negative` };
  if (!DECIMAL_RE.test(text)) return { ok: false, error: 'Enter a number' };
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter a number' };
  if (rules.integer && !Number.isInteger(value)) return { ok: false, error: `${rules.label} must be a whole number` };
  const min = rules.min ?? 0;
  if (value < min) return { ok: false, error: `${rules.label} must be at least ${min}` };
  if (value > rules.max) return { ok: false, error: `${rules.label} must be ${rules.max} or less` };
  return { ok: true, value };
}

/**
 * Parse a time value into seconds.
 * - "1:30" → 90, "1:02:05" → 3725
 * - a plain number uses `plainUnit` ("90" as seconds for rest, "30" as minutes for cardio)
 */
export function parseClock(raw: string, opts: { plainUnit: 'sec' | 'min'; maxSec: number; label: string }): Parsed {
  const text = raw.trim().toLowerCase();
  if (text === '') return { ok: true, value: null };
  if (text.startsWith('-')) return { ok: false, error: `${opts.label} can't be negative` };

  let seconds: number;
  const unitMatch = /^(\d+(?:[.,]\d+)?)\s*(s|sec|m|min|h)$/.exec(text);
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return { ok: false, error: 'Use mm:ss (seconds below 60)' };
    seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  } else if (unitMatch) {
    const n = Number(unitMatch[1].replace(',', '.'));
    const u = unitMatch[2];
    seconds = u.startsWith('h') ? n * 3600 : u.startsWith('m') ? n * 60 : n;
  } else if (DECIMAL_RE.test(text)) {
    const n = Number(text.replace(',', '.'));
    seconds = opts.plainUnit === 'min' ? n * 60 : n;
  } else {
    return { ok: false, error: opts.plainUnit === 'min' ? 'Use minutes or mm:ss' : 'Use seconds or m:ss' };
  }
  if (!Number.isFinite(seconds)) return { ok: false, error: 'Enter a valid time' };
  seconds = Math.round(seconds);
  if (seconds > opts.maxSec) {
    const maxMin = Math.round(opts.maxSec / 60);
    return { ok: false, error: `${opts.label} must be ${maxMin} min or less` };
  }
  return { ok: true, value: seconds };
}

export const LIMITS = {
  nameLength: 80,
  titleLength: 120,
  shortText: 40,
  notesLength: 10000,
  credits: 60,
  maxScore: 1000,
  sessions: 500,
  hours: 500,
} as const;
