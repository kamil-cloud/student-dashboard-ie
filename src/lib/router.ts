import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'calendar'; date?: string }
  | { name: 'assignments' }
  | { name: 'courses' }
  | { name: 'course'; id: string }
  | { name: 'grades' }
  | { name: 'analytics' }
  | { name: 'settings' }
  /** The optional setup wizard (transcript, Blackboard, reminders). */
  | { name: 'setup' };

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'calendar':
      return { name: 'calendar', date: params.get('date') ?? undefined };
    case 'assignments':
      return { name: 'assignments' };
    case 'courses':
      return parts[1] ? { name: 'course', id: parts[1] } : { name: 'courses' };
    case 'grades':
      return { name: 'grades' };
    case 'analytics':
      return { name: 'analytics' };
    case 'settings':
      return { name: 'settings' };
    case 'setup':
      return { name: 'setup' };
    default:
      return { name: 'dashboard' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '#/';
    case 'calendar':
      return route.date ? `#/calendar?date=${route.date}` : '#/calendar';
    case 'course':
      return `#/courses/${encodeURIComponent(route.id)}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const hash = routeToHash(route);
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
