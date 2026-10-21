// POST /api/calendar  { "url": "<the student's Blackboard calendar link>" }
// Reads a Blackboard calendar link (an .ics feed) for the website: browsers cannot read it
// directly from another site. Only for signed-in students (their Supabase session token), only
// calendar files (https, ending in .ics, answering BEGIN:VCALENDAR), never private network
// addresses, at most 5 MB and 10 seconds. Nothing is stored or logged here.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Test builds read the fake Blackboard on localhost (tests/e2e). Never set in production. */
const allowLocal = () => process.env.SDW_ALLOW_LOCAL_FEEDS === '1';

/** The calendar link as pasted (webcal:// or https://), or null if it is not one. */
export function feedUrl(input, local = allowLocal()) {
  if (typeof input !== 'string') return null;
  const text = input.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!text || text.length > 600) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const isLocal = local && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  if (url.port && !isLocal && url.port !== '443') return null;
  if (!/\.ics$/i.test(url.pathname)) return null;
  url.hash = '';
  return url;
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  }
  return true;
}

async function publicHost(url) {
  if (allowLocal() && /^(localhost|127\.0\.0\.1)$/.test(url.hostname)) return true;
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
}

async function signedIn(req) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const auth = String(req.headers.authorization ?? '');
  if (!base || !key || !/^Bearer \S+$/.test(auth)) return false;
  const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } }).catch(() => null);
  return !!res?.ok;
}

function readJsonBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 10_000) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const fail = (res, status, error) => send(res, status, { error });

const NOT_A_LINK = 'That is not a Blackboard calendar link. In Blackboard: Calendar › Calendar settings › Share calendar, then copy the link (it ends in .ics).';
const RECOPY = 'Blackboard did not accept this link. Copy it again from Blackboard (Calendar › Calendar settings › Share calendar).';

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return fail(res, 400, 'Invalid request.');
  }
  if (!(await signedIn(req))) return fail(res, 401, 'You are logged out. Log in again, then retry.');
  let url = feedUrl(body?.url);
  if (!url) return fail(res, 400, NOT_A_LINK);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response;
    for (let hop = 0; ; hop++) {
      if (!(await publicHost(url))) return fail(res, 400, NOT_A_LINK);
      response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'StudentDashboard/1.0 (+calendar import)' } });
      if (response.status < 300 || response.status >= 400) break;
      const next = response.headers.get('location');
      let nextUrl = null;
      try {
        const u = next ? new URL(next, url) : null;
        // The same site (any path, e.g. a storage address) or another calendar file.
        nextUrl = u && (u.protocol === 'https:' || (allowLocal() && u.protocol === 'http:')) && !u.username && !u.password && (u.hostname === url.hostname || feedUrl(u.toString())) ? u : null;
      } catch {
        nextUrl = null;
      }
      // Too many hops, or a redirect elsewhere (e.g. a login page): the link is not valid any more.
      if (!nextUrl || hop >= MAX_REDIRECTS) return fail(res, 502, RECOPY);
      url = nextUrl;
    }
    if (!response.ok) return fail(res, 502, response.status === 404 || response.status === 401 || response.status === 403 ? RECOPY : `Blackboard could not be reached (error ${response.status}). Try again in a moment.`);
    const text = await readLimited(response);
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4000))) return fail(res, 502, RECOPY);
    return send(res, 200, text, 'text/calendar; charset=utf-8');
  } catch (err) {
    if (err?.message === 'too large') return fail(res, 502, 'That calendar is too large to import.');
    return fail(res, 504, 'Blackboard took too long to answer. Try again in a moment.');
  } finally {
    clearTimeout(timer);
  }
}
