/**
 * The "Sync Student Dashboard" bookmark (a bookmarklet), for browsers without the extension.
 *
 * Clicked on a Blackboard page, it lets the dashboard — and only the dashboard — make read-only
 * requests to Blackboard's public REST API with the session already open in that tab, the way the
 * Blackboard website itself does. Nothing else goes through it: GET only, /learn/api/public/
 * only, same site only, and answers are only sent to the dashboard's own address. Nothing is sent
 * anywhere else, and it stops when the Blackboard tab is closed or changes page.
 *
 * It finds the dashboard as the tab that opened Blackboard (the dashboard's "Open Blackboard"
 * button), or else opens the dashboard in a new tab.
 *
 * `relayMain` becomes the bookmark's code (see bookmarkletCode): it must stay self-contained.
 */
export function relayMain(site: string): void {
  type Reply = { status: number; contentType: string; body: string };
  const w = window as unknown as { __sdRelay?: { again: () => void } };
  if (w.__sdRelay) {
    w.__sdRelay.again();
    return;
  }

  const opener = window.opener as Window | null;
  let target: Window | null = opener && !opener.closed ? opener : null;
  let opened = false;
  let linked = false;
  let session = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  // A small notice in the corner of Blackboard, so the student knows what is happening.
  const box = document.createElement('div');
  box.setAttribute(
    'style',
    'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:12px 38px 12px 14px;border-radius:12px;' +
      'background:#17181c;color:#f4f4f3;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.35);text-align:left',
  );
  const text = document.createElement('div');
  const action = document.createElement('button');
  action.setAttribute('style', 'display:none;margin-top:8px;padding:6px 12px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font:inherit;cursor:pointer');
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.setAttribute('style', 'position:absolute;top:6px;right:8px;border:0;background:none;color:#a8a8a3;font:20px/1 sans-serif;cursor:pointer');
  close.onclick = () => box.remove();
  box.appendChild(text);
  box.appendChild(action);
  box.appendChild(close);
  (document.body || document.documentElement).appendChild(box);

  const say = (message: string, button?: { label: string; run: () => void }) => {
    if (!box.isConnected) (document.body || document.documentElement).appendChild(box);
    text.textContent = message;
    action.style.display = button ? 'inline-block' : 'none';
    if (button) {
      action.textContent = button.label;
      action.onclick = button.run;
    }
  };

  const openDashboard = (): boolean => {
    target = window.open(site + '/app#/bb-sync', '_blank');
    opened = true;
    if (!target) {
      say('Your browser blocked the new tab. Allow pop-ups for this site, then click the bookmark again.');
      return false;
    }
    return true;
  };

  // Announce this tab to the dashboard until it answers.
  const announce = () => {
    linked = false;
    session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let tries = 0;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      tries++;
      if (linked) {
        clearInterval(timer);
        return;
      }
      if (target && !target.closed) {
        try {
          target.postMessage({ type: 'sd-relay-ready', v: 1, session }, site);
        } catch {
          /* tab gone */
        }
      }
      // The tab that opened Blackboard may not be the dashboard: offer to open it instead.
      if (!opened && tries === 8) {
        clearInterval(timer);
        say('Student Dashboard is not open in this browser.', {
          label: 'Open Student Dashboard',
          run: () => {
            if (openDashboard()) announce();
          },
        });
      }
      if (opened && tries === 80) {
        clearInterval(timer);
        say('Student Dashboard did not answer. Reload it, then click the bookmark again.');
      }
    }, 250);
  };

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== site || !target || e.source !== target) return;
    const m = (e.data || {}) as { type?: string; id?: number; path?: string; text?: string };
    const reply = (r: Reply) => target?.postMessage({ type: 'sd-res', id: m.id, ...r }, site);
    if (m.type === 'sd-hello') {
      if (!linked) say('Connected to Student Dashboard — syncing…');
      linked = true;
    } else if (m.type === 'sd-say') {
      say(String(m.text || ''));
    } else if (m.type === 'sd-get') {
      let url: URL | null = null;
      try {
        url = new URL(String(m.path), location.origin);
      } catch {
        url = null;
      }
      if (!url || url.origin !== location.origin || url.pathname.indexOf('/learn/api/public/') !== 0) {
        reply({ status: 400, contentType: 'text/plain', body: 'Not allowed' });
        return;
      }
      fetch(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(
        (r) => r.text().then((body) => reply({ status: r.status, contentType: r.headers.get('content-type') || '', body })),
        (err) => reply({ status: 0, contentType: '', body: String(err) }),
      );
    }
  });

  w.__sdRelay = {
    // The bookmark clicked again on the same page: sync again.
    again: () => {
      if ((!target || target.closed) && !openDashboard()) return;
      say('Connecting to Student Dashboard…');
      announce();
    },
  };
  if (!target && !openDashboard()) return;
  say('Connecting to Student Dashboard…');
  announce();
}
