/**
 * IE syllabi live in an LTI tool (ie-lti-syllabus.ie.edu) that Blackboard opens with a signed
 * hand-off. The extension opens each course's syllabus in a small background window — exactly
 * what clicking "Syllabus" does — and reads the evaluation table from the displayed page.
 * Nothing but the visible syllabus text is read.
 */
import { normalizeCriteria } from './parse';
import type { BbCourseData, BbSyllabus } from './types';

/** Blackboard sites whose syllabus tool we know how to open. */
const SYLLABUS_PLACEMENTS: Record<string, string> = {
  'https://blackboard.ie.edu': '_1218_1',
};

export function syllabusPlacement(host: string): string | null {
  if (SYLLABUS_PLACEMENTS[host]) return SYLLABUS_PLACEMENTS[host];
  // Local test server (end-to-end tests).
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return '_1218_1';
  return null;
}

export function syllabusLaunchUrl(host: string, coursePk: string): string | null {
  const placement = syllabusPlacement(host);
  if (!placement) return null;
  return `${host}/webapps/blackboard/execute/blti/launchPlacement?blti_placement_id=${encodeURIComponent(placement)}&course_id=${encodeURIComponent(coursePk)}&from_ultra=true`;
}

export type ScrapeResult =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'ok'; professor: string | null; credits: string | null; sessions: string | null; rows: { name: string; weight: string; note: string }[] };

/**
 * Runs inside the syllabus page (injected with chrome.scripting) — must be self-contained.
 * Reads only the rendered text and tables.
 */
export function scrapeSyllabusPage(): ScrapeResult {
  if (/\/error/i.test(location.pathname) || /Syllabus is not available|no est[aá] disponible/i.test(document.body?.innerText ?? '')) return { state: 'none' };
  const cellText = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
  const tables = Array.from(document.querySelectorAll('table')).map((tb) => Array.from(tb.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map(cellText)));
  const isEvaluation = (rows: string[][]) => {
    const head = (rows[0] ?? []).join(' | ');
    return /criteri|concepto/i.test(head) && /score|puntuaci|weight|peso|%/i.test(head);
  };
  const ev = tables.find(isEvaluation);
  const text = document.body?.innerText ?? '';
  const g = (re: RegExp) => ((text.match(re) ?? [])[1] ?? '').trim() || null;
  const header = {
    professor: g(/Profes(?:sor|or|ora)(?:es|as)?\s*(?:\/\s*\w+)?\s*:\s*([^\n]+)/i),
    credits: g(/(?:NUMBER OF CREDITS|N[º°]?\s*DE\s*CR[ÉE]DITOS(?:\s*\(ECTS\))?|CR[ÉE]DITOS(?:\s*\(ECTS\))?)\s*:\s*([\d.,]+)/i),
    sessions: g(/(?:NUMBER OF SESSIONS|N[ÚU]MERO DE SESIONES)\s*:\s*(\d+)/i),
  };
  if (ev) {
    return { state: 'ok', ...header, rows: ev.slice(1).map((r) => ({ name: r[0] ?? '', weight: r[1] ?? '', note: r[3] ?? r[2] ?? '' })) };
  }
  // Fully rendered but without an evaluation table.
  if (header.sessions && tables.length > 0 && document.readyState === 'complete') return { state: 'ok', ...header, rows: [] };
  return { state: 'loading' };
}

export function toSyllabus(r: Extract<ScrapeResult, { state: 'ok' }>): BbSyllabus {
  const credits = r.credits ? Number(r.credits.replace(',', '.')) : NaN;
  const sessions = r.sessions ? Number(r.sessions) : NaN;
  return {
    professor: r.professor ? r.professor.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
    credits: Number.isFinite(credits) && credits > 0 && credits <= 60 ? credits : null,
    sessions: Number.isFinite(sessions) && sessions > 0 && sessions <= 200 ? sessions : null,
    criteria: normalizeCriteria(r.rows),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForSyllabus(tabId: number, host: string, timeoutMs: number): Promise<BbSyllabus | null | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(900);
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return undefined; // window closed by the user
    }
    // Still on Blackboard (the hand-off page) or between pages.
    if (!tab.url || tab.url.startsWith(host) || tab.url === 'about:blank') continue;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeSyllabusPage });
      const r = res?.result as ScrapeResult | undefined;
      if (r?.state === 'none') return null;
      if (r?.state === 'ok') return toSyllabus(r);
    } catch {
      /* page not ready for injection yet */
    }
  }
  return undefined; // gave up: keep whatever weights we had
}

/** Reads the syllabus of each course in a small, unfocused window that closes afterwards. */
export async function readSyllabiInWindow(host: string, courses: BbCourseData[], progress: (done: number, total: number, label: string) => void): Promise<void> {
  if (!syllabusPlacement(host) || courses.length === 0 || typeof chrome === 'undefined' || !chrome.windows) return;
  let windowId: number | undefined;
  try {
    const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'popup', width: 520, height: 420, left: 24, top: 24 });
    windowId = win?.id;
    const tabId = win?.tabs?.[0]?.id;
    if (windowId === undefined || tabId === undefined) return;
    for (let i = 0; i < courses.length; i++) {
      const cd = courses[i];
      progress(i, courses.length, `Reading syllabi (${i + 1}/${courses.length})`);
      const url = syllabusLaunchUrl(host, cd.course.id);
      if (!url) continue;
      await chrome.tabs.update(tabId, { url });
      cd.syllabus = await waitForSyllabus(tabId, host, 40_000);
    }
    progress(courses.length, courses.length, 'Syllabi read');
  } catch (err) {
    console.warn('[syllabus]', err);
  } finally {
    if (windowId !== undefined) await chrome.windows.remove(windowId).catch(() => {});
  }
}
