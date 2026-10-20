/**
 * Blackboard access for the dashboard page.
 *  - In the extension, the page talks to Blackboard directly (it has host permission).
 *  - On the website, a website cannot read another site's data by itself, so requests go
 *    through the extension if it is installed, or else through the "Sync Student Dashboard"
 *    bookmark clicked on a Blackboard tab (see relay.ts).
 */
import { BlackboardClient, BlackboardError } from '../integrations/blackboard/client';
import { fetchSnapshot, listCourseChoices, whoAmI } from '../integrations/blackboard/snapshot';
import { readSyllabiInWindow } from '../integrations/blackboard/syllabus';
import type { BbCourseChoice, BbSnapshot, SyncProgress } from '../integrations/blackboard/types';
import { EXTENSION_ID, IS_EXTENSION } from './env';
import { currentRelay, relayTransport } from './relay';

export type Backend = 'extension' | 'bridge' | 'none';

export interface SnapshotRequest {
  courseIds?: string[];
  excluded?: string[];
  syllabus?: boolean;
  onProgress?: (p: SyncProgress) => void;
}

/** "blackboard.ie.edu/ultra/course" → "https://blackboard.ie.edu". */
export function normalizeHost(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bridge (website → extension)
// ---------------------------------------------------------------------------

function bridgeCall<T>(request: Record<string, unknown>, onProgress?: (p: SyncProgress) => void, timeoutMs = 300_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect(EXTENSION_ID);
    } catch {
      reject(new BlackboardError('The Student Dashboard extension is not installed in this browser.', 'network'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new BlackboardError('The extension took too long to answer.', 'network'));
      port.disconnect();
    }, timeoutMs);
    port.onMessage.addListener((m: { type: string; value?: unknown; code?: string; message?: string }) => {
      if (m.type === 'progress') onProgress?.(m.value as SyncProgress);
      else if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (m.type === 'result') resolve(m.value as T);
        else reject(new BlackboardError(m.message ?? 'The extension reported an error.', (m.code as BlackboardError['code']) ?? 'http'));
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new BlackboardError('The Student Dashboard extension is not installed in this browser.', 'network'));
    });
    port.postMessage(request);
  });
}

let backendPromise: Promise<Backend> | null = null;

export interface ExtensionInfo {
  version: string;
  /** The extension's own dashboard is in use (then nothing is handed over to it). */
  setUp: boolean;
}
let info: ExtensionInfo | null = null;

/** What the installed extension said when it was detected (website only). */
export const extensionInfo = (): ExtensionInfo | null => info;

export function detectBackend(): Promise<Backend> {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (IS_EXTENSION) return 'extension';
    if (!EXTENSION_ID || typeof chrome === 'undefined' || !chrome.runtime?.connect) return 'none';
    try {
      const pong = await bridgeCall<Partial<ExtensionInfo>>({ type: 'ping' }, undefined, 1500);
      info = { version: String(pong?.version ?? ''), setUp: pong?.setUp !== false };
      return 'bridge';
    } catch {
      return 'none';
    }
  })();
  return backendPromise;
}

/**
 * Move this website's dashboard into the freshly installed extension, which then opens it
 * (and picks up at `resume`). Refused by the extension if its own dashboard is in use.
 */
export async function handOffToExtension(data: unknown, resume: 'blackboard' | 'connect' | null): Promise<void> {
  await bridgeCall({ type: 'handoff', data, resume }, undefined, 15000);
  if (info) info = { ...info, setUp: true };
}

// ---------------------------------------------------------------------------
// Permissions (extension)
// ---------------------------------------------------------------------------

export async function hasAccess(host: string): Promise<boolean> {
  if (!IS_EXTENSION) return true;
  return chrome.permissions.contains({ origins: [`${host}/*`] });
}

/** Must be called from a click: Chrome asks the student to allow this Blackboard site. */
export async function requestAccess(host: string): Promise<boolean> {
  if (!IS_EXTENSION) return true;
  if (await hasAccess(host)) return true;
  try {
    return await chrome.permissions.request({ origins: [`${host}/*`] });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Website without the extension: through the Blackboard tab where the bookmark was clicked. */
function bookmarkClient(host: string): BlackboardClient {
  const relay = currentRelay();
  if (!relay) throw new BlackboardError('Click the “Sync Student Dashboard” bookmark on a Blackboard page to sync.', 'relay');
  if (relay.origin !== host) throw new BlackboardError(`The bookmark was clicked on ${relay.origin}, which is not your Blackboard (${host}).`, 'relay');
  return new BlackboardClient(host, relayTransport(relay));
}

export async function checkLogin(host: string): Promise<void> {
  const backend = await detectBackend();
  if (backend === 'bridge') return void (await bridgeCall({ type: 'bb:check', host }));
  await whoAmI(backend === 'none' ? bookmarkClient(host) : new BlackboardClient(host));
}

export async function listCourses(host: string): Promise<BbCourseChoice[]> {
  const backend = await detectBackend();
  if (backend === 'bridge') return bridgeCall<BbCourseChoice[]>({ type: 'bb:courses', host });
  const client = backend === 'none' ? bookmarkClient(host) : new BlackboardClient(host);
  return listCourseChoices(client, await whoAmI(client));
}

export async function readSnapshot(host: string, req: SnapshotRequest): Promise<BbSnapshot> {
  const backend = await detectBackend();
  if (backend === 'bridge') return bridgeCall<BbSnapshot>({ type: 'bb:snapshot', host, courseIds: req.courseIds, excluded: req.excluded, syllabus: req.syllabus }, req.onProgress);
  const viaBookmark = backend === 'none';
  return fetchSnapshot({
    client: viaBookmark ? bookmarkClient(host) : new BlackboardClient(host),
    courseIds: req.courseIds,
    excluded: req.excluded,
    onProgress: req.onProgress,
    // The syllabus tool is another site: only the extension can read it.
    readSyllabi: req.syllabus && !viaBookmark ? (courses, progress) => readSyllabiInWindow(host, courses, progress) : undefined,
  });
}

/** Can syllabus weights be read with the way this page reaches Blackboard? */
export async function canReadSyllabi(): Promise<boolean> {
  return (await detectBackend()) !== 'none';
}

export async function openLogin(host: string): Promise<void> {
  const url = `${host}/ultra/course`;
  if (IS_EXTENSION) {
    await chrome.tabs.create({ url, active: true });
    return;
  }
  const backend = await detectBackend();
  if (backend === 'bridge') {
    await bridgeCall({ type: 'bb:open-login', host });
    return;
  }
  openBlackboardTab(host);
}

/**
 * Website: open Blackboard in a new tab that keeps a link back to this page, so the bookmark
 * clicked there finds the dashboard without opening another tab. Call it from a click.
 */
export function openBlackboardTab(host: string): void {
  window.open(`${host}/ultra/course`, 'sd-blackboard');
}
