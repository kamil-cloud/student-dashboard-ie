// The "Sync Student Dashboard" bookmark runs inside the student's Blackboard tab: check what it
// lets the dashboard do (and refuse), with a minimal fake browser around it.
import { afterEach, describe, expect, it } from 'vitest';
import { relayMain } from '../../src/integrations/blackboard/relay';

const SITE = 'https://student-dashboard.example';
const BB = 'https://blackboard.example.edu';

interface Posted {
  message: Record<string, unknown>;
  targetOrigin: string;
}

function fakeBrowser({ opener }: { opener: boolean }) {
  const posted: Posted[] = [];
  const fetched: string[] = [];
  const dashboard = {
    closed: false,
    postMessage: (message: Record<string, unknown>, targetOrigin: string) => posted.push({ message, targetOrigin }),
  };
  const listeners: ((e: { origin: string; source: unknown; data: unknown }) => void)[] = [];
  const opened: string[] = [];
  const el = () => {
    const node: Record<string, unknown> = {
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      remove: () => {},
      isConnected: true,
      textContent: '',
    };
    return node;
  };
  const g = globalThis as Record<string, unknown>;
  g.window = {
    opener: opener ? dashboard : null,
    open: (url: string) => {
      opened.push(url);
      return dashboard;
    },
    addEventListener: (type: string, fn: (e: { origin: string; source: unknown; data: unknown }) => void) => {
      if (type === 'message') listeners.push(fn);
    },
  };
  g.document = { createElement: el, body: el(), documentElement: el() };
  g.location = { origin: BB };
  g.fetch = async (url: string) => {
    fetched.push(url);
    return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true}' };
  };
  const send = (data: unknown, origin = SITE, source: unknown = dashboard) => listeners.forEach((fn) => fn({ origin, source, data }));
  return { posted, fetched, opened, send, dashboard };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  for (const k of ['window', 'document', 'location', 'fetch']) delete (globalThis as Record<string, unknown>)[k];
});

describe('sync bookmark (relay)', () => {
  it('answers the dashboard’s GET requests to the public REST API, only to the dashboard', async () => {
    const b = fakeBrowser({ opener: true });
    relayMain(SITE);
    b.send({ type: 'sd-get', id: 1, path: '/learn/api/public/v1/users/me' });
    await tick();
    await tick();
    expect(b.fetched).toEqual([`${BB}/learn/api/public/v1/users/me`]);
    const res = b.posted.find((p) => p.message.type === 'sd-res');
    expect(res?.message).toMatchObject({ id: 1, status: 200, body: '{"ok":true}' });
    expect(res?.targetOrigin).toBe(SITE);
  });

  it('refuses anything outside /learn/api/public/ (including ../ tricks and other sites)', async () => {
    const b = fakeBrowser({ opener: true });
    relayMain(SITE);
    for (const path of ['/webapps/blackboard/execute/x', '/learn/api/public/../../../webapps/x', 'https://evil.example/learn/api/public/v1/users/me', '//evil.example/learn/api/public/x', '/learn/api/v1/users/me']) {
      b.send({ type: 'sd-get', id: 2, path });
    }
    await tick();
    expect(b.fetched).toEqual([]);
    expect(b.posted.filter((p) => p.message.type === 'sd-res').every((p) => p.message.status === 400)).toBe(true);
  });

  it('ignores messages from other sites or other windows', async () => {
    const b = fakeBrowser({ opener: true });
    relayMain(SITE);
    b.send({ type: 'sd-get', id: 3, path: '/learn/api/public/v1/users/me' }, 'https://evil.example');
    b.send({ type: 'sd-get', id: 4, path: '/learn/api/public/v1/users/me' }, SITE, { postMessage: () => {} });
    await tick();
    expect(b.fetched).toEqual([]);
  });

  it('announces itself to the tab that opened Blackboard, or opens the dashboard', async () => {
    const withOpener = fakeBrowser({ opener: true });
    relayMain(SITE);
    expect(withOpener.opened).toEqual([]);
    await new Promise((r) => setTimeout(r, 300));
    expect(withOpener.posted.some((p) => p.message.type === 'sd-relay-ready' && p.targetOrigin === SITE)).toBe(true);

    const alone = fakeBrowser({ opener: false });
    relayMain(SITE);
    expect(alone.opened).toEqual([`${SITE}/app#/bb-sync`]);
  });
});
