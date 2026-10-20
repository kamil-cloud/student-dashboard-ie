const nfCache = new Map<string, Intl.NumberFormat>();
function nf(maxFrac: number, minFrac = 0): Intl.NumberFormat {
  const key = `${maxFrac}-${minFrac}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac });
    nfCache.set(key, f);
  }
  return f;
}

export function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function formatNumber(n: number, maxFrac = 1, minFrac = 0): string {
  if (!Number.isFinite(n)) return '0';
  return nf(maxFrac, minFrac).format(n);
}

/** Value shown inside an input — trimmed decimals, no grouping. */
export function inputNumber(n: number | null, maxFrac = 2): string {
  if (n === null || !Number.isFinite(n)) return '';
  return String(round(n, maxFrac));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n, 0)} ${n === 1 ? one : many}`;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

export function formatHours(h: number): string {
  if (h <= 0) return '0 h';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${formatNumber(h, 1)} h`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function timeAgo(iso: string | null, now = new Date()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const min = Math.round((now.getTime() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'yesterday';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
