/**
 * Minimal Blackboard Learn REST client. Requests are made with the student's own Blackboard
 * session (the browser sends its cookies), exactly like the Blackboard website itself does — no
 * password or token is ever handled by the app. Only GET requests are made: nothing is ever
 * changed on Blackboard.
 */

export type BbErrorCode = 'auth' | 'network' | 'permission' | 'http' | 'format' | 'relay';

export class BlackboardError extends Error {
  constructor(
    message: string,
    readonly code: BbErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BlackboardError';
  }
}

export type Transport = (url: string) => Promise<Response>;

export const fetchTransport: Transport = (url) =>
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export class BlackboardClient {
  constructor(
    readonly host: string,
    private readonly transport: Transport = fetchTransport,
  ) {}

  async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.transport(this.host + path);
    } catch (err) {
      if (err instanceof BlackboardError) throw err;
      const timeout = err instanceof DOMException && err.name === 'TimeoutError';
      throw new BlackboardError(timeout ? 'Blackboard took too long to answer.' : 'Could not reach Blackboard. Check your internet connection.', 'network');
    }
    if (res.status === 401) throw new BlackboardError('You are not logged in to Blackboard.', 'auth', 401);
    if (res.status === 403) throw new BlackboardError('Blackboard did not allow access to this information.', 'permission', 403);
    if (!res.ok) throw new BlackboardError(`Blackboard answered with an error (${res.status}).`, 'http', res.status);
    const type = res.headers.get('content-type') ?? '';
    // A logged-out request can be redirected to the (HTML) sign-in page.
    if (!type.includes('json')) throw new BlackboardError('You are not logged in to Blackboard.', 'auth', res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new BlackboardError('Blackboard sent an answer that could not be read.', 'format');
    }
  }

  /** GET a paged collection, following `paging.nextPage`. */
  async list<T>(path: string, maxPages = 25): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    for (let i = 0; next && i < maxPages; i++) {
      const page: { results?: T[]; paging?: { nextPage?: string } } = await this.get(next);
      out.push(...(Array.isArray(page.results) ? page.results : []));
      const np = page.paging?.nextPage;
      next = typeof np === 'string' && np.startsWith('/') ? np : null;
    }
    return out;
  }
}
