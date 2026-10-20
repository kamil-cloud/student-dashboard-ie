const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d && y >= 1900 && y <= 2200;
}

/** Parse YYYY-MM-DD as a local date (never UTC — that shifts days). */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function startOfWeek(d: Date, weekStartsOn: 0 | 1): Date {
  const day = d.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  return addDays(d, -diff);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Whole days from a to b (b − a). */
export function diffDays(a: string, b: string): number {
  const ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
  return Math.round(ms / 86_400_000);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', opts);
    fmtCache.set(key, f);
  }
  return f;
}

export const formatDate = {
  /** Thursday, September 25 */
  long: (s: string) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(parseDateStr(s)),
  /** Sep 25 */
  short: (s: string) => fmt({ month: 'short', day: 'numeric' }).format(parseDateStr(s)),
  /** Sep 25, 2026 */
  medium: (s: string) => fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(parseDateStr(s)),
  /** Thu */
  weekday: (s: string) => fmt({ weekday: 'short' }).format(parseDateStr(s)),
  /** September 2026 */
  monthYear: (s: string) => fmt({ month: 'long', year: 'numeric' }).format(parseDateStr(s)),
  /** Sep '26 */
  monthShort: (s: string) => {
    const d = parseDateStr(s);
    return `${fmt({ month: 'short' }).format(d)} '${String(d.getFullYear()).slice(2)}`;
  },
  /** 18:42 */
  time: (iso: string) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
  /** Sep 25, 2026, 18:42 */
  dateTime: (iso: string) =>
    fmt({ month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(
      new Date(iso),
    ),
};

/** "Today", "Yesterday", "Tuesday" (within a week) or "Sep 12". */
export function relativeDay(s: string, today = todayStr()): string {
  const diff = diffDays(s, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return fmt({ weekday: 'long' }).format(parseDateStr(s));
  const sameYear = parseDateStr(s).getFullYear() === parseDateStr(today).getFullYear();
  return sameYear ? formatDate.short(s) : formatDate.medium(s);
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
