/**
 * Helpers shared by the importers (transcript, Blackboard, calendar files).
 */
import type { SyncSource } from '../lib/types';

type Primitive = string | number | boolean | null;

const CODE_STOP = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', '&', '-', '–', '—']);

/** "Data Analysis for Economics" → "DAE", "Career Development 3" → "CD3", "IE Challenge" → "IEC". */
export function abbreviate(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s/:,]+/)
    .map((w) => w.trim())
    .filter((w) => w && !CODE_STOP.has(w.toLowerCase()));
  let code = '';
  for (const w of words) {
    if (/^\d+$/.test(w)) code += w;
    else if (/^[A-Z]{2,4}$/.test(w)) code += w; // keep acronyms ("IE")
    else {
      const parts = w.split('-').filter(Boolean);
      for (const p of parts) code += p[0]?.toLocaleUpperCase('en') ?? '';
    }
    if (code.length >= 6) break;
  }
  return code.slice(0, 6) || name.slice(0, 4).toUpperCase();
}

/** Lower-case words without accents or punctuation, for fuzzy matching. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MATCH_STOP = new Set(['and', 'of', 'for', 'the', 'in', 'to', 'a', 'an', 'with', 'on', 'section', 'group', 'bba', 'grupo']);

/** Similarity of two course names, 0–1 (Dice coefficient over significant words). */
export function nameSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeName(a).split(' ').filter((w) => w && !MATCH_STOP.has(w)));
  const wb = new Set(normalizeName(b).split(' ').filter((w) => w && !MATCH_STOP.has(w)));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return (2 * common) / (wa.size + wb.size);
}

/**
 * Three-way merge of imported fields into a record.
 *
 * For each field: if the record still holds the value we imported last time, the user has not
 * touched it, so take the new imported value; otherwise keep the user's value. Fields imported
 * for the first time only fill empty values. Returns the fields to write (possibly none) and the
 * new `synced` map to store.
 */
export function mergeFields<T extends Record<string, unknown>>(
  current: T,
  previous: SyncSource['synced'] | undefined,
  incoming: Partial<Record<keyof T & string, Primitive>>,
  /** Official fields (grades, deadlines): a change at the source replaces even a value you edited. */
  sourceWins: readonly string[] = [],
): { changes: Partial<T>; synced: SyncSource['synced']; overridden: string[] } {
  const changes: Partial<T> = {};
  const overridden: string[] = [];
  const synced: SyncSource['synced'] = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(incoming) as [keyof T & string, Primitive][]) {
    if (value === undefined) continue;
    const cur = current[key] as unknown;
    const hadPrevious = previous !== undefined && Object.prototype.hasOwnProperty.call(previous, key);
    const untouched = hadPrevious ? cur === previous[key] : cur === null || cur === '' || cur === undefined;
    const sourceChanged = hadPrevious && previous[key] !== value;
    if (cur !== value && (untouched || (sourceChanged && sourceWins.includes(key)))) {
      (changes as Record<string, unknown>)[key] = value;
      if (!untouched) overridden.push(key);
    }
    // Remember what the source says now: a value that differs from it later is a user edit.
    synced[key] = value;
  }
  return { changes, synced, overridden };
}
