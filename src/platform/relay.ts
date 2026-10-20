/**
 * Website side of the "Sync Student Dashboard" bookmark (integrations/blackboard/relay.ts).
 * When the student clicks the bookmark on Blackboard, that tab announces itself here; the
 * dashboard then reads Blackboard through it, while that tab stays open.
 */
import { BlackboardError, type Transport } from '../integrations/blackboard/client';
import { relayMain } from '../integrations/blackboard/relay';
import { IS_EXTENSION } from './env';

export interface Relay {
  /** The Blackboard site the bookmark was clicked on, e.g. https://blackboard.ie.edu */
  origin: string;
  /** Changes each time the bookmark is clicked (each click asks for a sync). */
  session: string;
  win: Window;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const acceptable = (origin: string) => /^https:\/\/[^/]+$/.test(origin) || (import.meta.env.VITE_ALLOW_LOCALHOST === '1' && LOCAL_ORIGIN.test(origin));

/** This page was opened by the bookmark (from a Blackboard tab that had no dashboard to talk to). */
export const OPENED_BY_BOOKMARK = !IS_EXTENSION && typeof location !== 'undefined' && location.hash.startsWith('#/bb-sync');
if (OPENED_BY_BOOKMARK) history.replaceState(null, '', `${location.pathname}${location.search}#/`);

let current: Relay | null = null;
const subscribers = new Set<(relay: Relay) => void>();
let nextId = 1;
const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: unknown) => void; timer: number }>();
/** Screens that handle a new bookmark click themselves (then the automatic sync stays out of the way). */
let consumers = 0;

if (typeof window !== 'undefined' && !IS_EXTENSION) {
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type?: string; session?: unknown; id?: number; status?: number; contentType?: unknown; body?: unknown } | null;
    if (!m || typeof m !== 'object' || !e.source || !acceptable(e.origin)) return;
    const source = e.source as Window;
    if (m.type === 'sd-relay-ready' && typeof m.session === 'string') {
      source.postMessage({ type: 'sd-hello' }, e.origin);
      if (current && current.session === m.session && current.win === source) return;
      current = { origin: e.origin, session: m.session, win: source };
      const relay = current;
      subscribers.forEach((fn) => fn(relay));
    } else if (m.type === 'sd-res' && current && source === current.win && e.origin === current.origin && typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      window.clearTimeout(p.timer);
      const status = Number(m.status);
      if (!(status >= 200 && status <= 599)) {
        p.reject(new TypeError('Blackboard could not be reached from its tab.'));
        return;
      }
      const empty = status === 204 || status === 205 || status === 304;
      p.resolve(new Response(empty ? null : String(m.body ?? ''), { status, headers: { 'content-type': String(m.contentType ?? '') } }));
    }
  });
}

/** The Blackboard tab currently linked through the bookmark, if it is still open. */
export function currentRelay(): Relay | null {
  return current && !current.win.closed ? current : null;
}

/** Called on every bookmark click; returns an unsubscribe function. */
export function onRelay(fn: (relay: Relay) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

const taken = new Set<string>();
/** Each bookmark click is acted on once: true for the first caller only. */
export function takeSession(relay: Relay): boolean {
  if (taken.has(relay.session)) return false;
  taken.add(relay.session);
  return true;
}

/** A screen that reacts to bookmark clicks itself (e.g. the Connect Blackboard flow). */
export function claimRelay(): () => void {
  consumers++;
  return () => {
    consumers--;
  };
}
export const relayClaimed = () => consumers > 0;

/** Wait for the bookmark's tab to announce itself (resolves null after `ms`). */
export function waitForRelay(ms: number): Promise<Relay | null> {
  const now = currentRelay();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve(null);
    }, ms);
    const off = onRelay((relay) => {
      window.clearTimeout(timer);
      off();
      resolve(relay);
    });
  });
}

/** Requests to Blackboard, made by the bookmark's tab. */
export function relayTransport(relay: Relay): Transport {
  return (url) =>
    new Promise<Response>((resolve, reject) => {
      const u = new URL(url);
      if (u.origin !== relay.origin) return reject(new BlackboardError('That request is not for this Blackboard.', 'relay'));
      if (relay.win.closed) return reject(new BlackboardError('The Blackboard tab was closed. Open Blackboard and click the bookmark again.', 'relay'));
      const id = nextId++;
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(
          relay.win.closed
            ? new BlackboardError('The Blackboard tab was closed. Open Blackboard and click the bookmark again.', 'relay')
            : new BlackboardError('The Blackboard tab stopped answering (it may have changed page). Click the bookmark again.', 'relay'),
        );
      }, 25_000);
      pending.set(id, { resolve, reject, timer });
      relay.win.postMessage({ type: 'sd-get', id, path: u.pathname + u.search }, relay.origin);
    });
}

/** Show a message in the notice the bookmark put on the Blackboard page. */
export function tellRelay(text: string): void {
  const relay = currentRelay();
  try {
    relay?.win.postMessage({ type: 'sd-say', text }, relay.origin);
  } catch {
    /* tab gone */
  }
}

/** The bookmark's address (a javascript: URL) for this website. */
export function bookmarkletCode(site = location.origin): string {
  return `javascript:${encodeURIComponent(`(${relayMain.toString()})(${JSON.stringify(site)})`)}`;
}
