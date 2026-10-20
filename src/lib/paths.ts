/**
 * Website pages by address: / (landing), /signup, /login and /app (the dashboard; its own
 * screens use the #/… part of the address, see router.ts).
 */
import { useEffect, useState } from 'react';

export type Page = 'landing' | 'signup' | 'login' | 'app';

export function pageOf(pathname: string): Page {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/signup') return 'signup';
  if (p === '/login') return 'login';
  if (p === '/app' || p.startsWith('/app/')) return 'app';
  return 'landing';
}

const PATH: Record<Page, string> = { landing: '/', signup: '/signup', login: '/login', app: '/app' };

export function goTo(page: Page, opts: { replace?: boolean; hash?: string } = {}) {
  const url = PATH[page] + (opts.hash ?? (page === 'app' ? location.hash : ''));
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePage(): Page {
  const [page, setPage] = useState<Page>(() => pageOf(location.pathname));
  useEffect(() => {
    const onChange = () => setPage(pageOf(location.pathname));
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return page;
}
