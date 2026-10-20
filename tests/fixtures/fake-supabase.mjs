// A small stand-in for a Supabase project, for the end-to-end tests: email + password accounts
// (Auth, "Confirm email" off) and the REST API for the `dashboards` and `backups` tables, with the
// same rules as supabase/schema.sql (each user only reaches their own rows; logged-out requests
// are refused). The rules themselves are tested on a real PostgreSQL by tests/db/rls.mjs.
import crypto from 'node:crypto';
import http from 'node:http';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function createFakeSupabase({ publishableKey = 'sb_publishable_test' } = {}) {
  const users = new Map(); // email -> { id, email, password }
  const tokens = new Map(); // access token -> user id
  const refresh = new Map(); // refresh token -> user id
  const tables = { dashboards: [], backups: [] };
  const log = [];
  let nextBackupId = 1;

  const userById = (id) => [...users.values()].find((u) => u.id === id);
  const publicUser = (u) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.createdAt,
    confirmed_at: u.createdAt,
    created_at: u.createdAt,
    updated_at: u.createdAt,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  });
  function session(u) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600, session_id: crypto.randomUUID() })}.${b64url(crypto.randomBytes(16))}`;
    const rt = crypto.randomBytes(12).toString('hex');
    tokens.set(access, u.id);
    refresh.set(rt, u.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user: publicUser(u) };
  }

  const json = (status, body, headers = {}) => ({ status, body: body === undefined ? '' : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
  const authError = (status, code, msg) => json(status, { code: status, error_code: code, msg });

  function caller(headers) {
    if (headers.apikey !== publishableKey) return { error: json(401, { message: 'Invalid API key' }) };
    const bearer = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const uid = tokens.get(bearer);
    return { uid: uid && userById(uid) ? uid : null };
  }

  function handleAuth(method, url, body, headers) {
    const c = caller(headers);
    if (c.error) return c.error;
    const p = url.pathname.replace('/auth/v1', '');
    if (method === 'POST' && p === '/signup') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(400, 'validation_failed', 'Unable to validate email address: invalid format');
      if (password.length < 6) return authError(422, 'weak_password', 'Password should be at least 6 characters.');
      if (users.has(email)) return authError(422, 'user_already_exists', 'User already registered');
      const u = { id: crypto.randomUUID(), email, password, createdAt: new Date().toISOString() };
      users.set(email, u);
      return json(200, session(u));
    }
    if (method === 'POST' && p === '/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(String(body.email ?? '').trim().toLowerCase());
        if (!u || u.password !== body.password) return authError(400, 'invalid_credentials', 'Invalid login credentials');
        return json(200, session(u));
      }
      if (grant === 'refresh_token') {
        const uid = refresh.get(body.refresh_token);
        const u = uid && userById(uid);
        if (!u) return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refresh.delete(body.refresh_token);
        return json(200, session(u));
      }
    }
    if (method === 'GET' && p === '/user') {
      const u = c.uid && userById(c.uid);
      return u ? json(200, publicUser(u)) : authError(401, 'bad_jwt', 'invalid JWT');
    }
    if (method === 'POST' && p === '/logout') {
      const bearer = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      tokens.delete(bearer);
      return { status: 204, body: '', headers: {} };
    }
    return authError(404, 'not_found', `Not found: ${method} ${p}`);
  }

  // PostgREST filters used by the app: col=eq.v, col=in.(a,b), order=col.desc, limit=n.
  function matches(row, params) {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
      const m = /^(eq|in)\.(.*)$/.exec(v);
      if (!m) throw new Error(`Unsupported filter ${k}=${v}`);
      if (m[1] === 'eq' && String(row[k]) !== m[2]) return false;
      if (m[1] === 'in') {
        const list = m[2].replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
        if (!list.includes(String(row[k]))) return false;
      }
    }
    return true;
  }
  function project(rows, params) {
    const select = params.get('select');
    let out = rows;
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    const limit = Number(params.get('limit') || 0);
    if (limit) out = out.slice(0, limit);
    if (!select || select === '*') return out.map((r) => structuredClone(r));
    const cols = select.split(',').map((s) => s.trim());
    return out.map((r) => Object.fromEntries(cols.map((col) => [col, structuredClone(r[col])])));
  }
  function respond(rows, headers, status = 200) {
    const accept = headers.accept ?? '';
    if (accept.includes('vnd.pgrst.object')) {
      if (rows.length !== 1) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
      return json(status, rows[0]);
    }
    return json(status, rows);
  }

  function handleRest(method, url, body, headers) {
    const c = caller(headers);
    if (c.error) return c.error;
    const name = url.pathname.replace('/rest/v1/', '');
    if (name === 'rpc/delete_my_account') {
      if (!c.uid) return json(401, { code: '42501', message: 'permission denied for function delete_my_account' });
      const u = userById(c.uid);
      users.delete(u.email);
      for (const t of Object.keys(tables)) tables[t] = tables[t].filter((r) => r.user_id !== c.uid);
      return { status: 204, body: '', headers: {} };
    }
    const table = tables[name];
    if (!table) return json(404, { code: '42P01', message: `relation "public.${name}" does not exist` });
    // Like the real database: logged-out visitors have no rights on these tables.
    if (!c.uid) return json(401, { code: '42501', message: `permission denied for table ${name}` });
    const params = url.searchParams;
    const mine = table.filter((r) => r.user_id === c.uid);
    const wantRows = (headers.prefer ?? '').includes('return=representation');
    if (method === 'GET') return respond(project(mine.filter((r) => matches(r, params)), params), headers);
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const added = [];
      for (const input of list) {
        const row = { ...input, user_id: input.user_id ?? c.uid };
        if (row.user_id !== c.uid) return json(403, { code: '42501', message: `new row violates row-level security policy for table "${name}"` });
        if (name === 'dashboards') {
          if (table.some((r) => r.user_id === row.user_id)) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "dashboards_pkey"' });
          row.revision ??= 1;
          row.updated_at ??= new Date().toISOString();
        } else {
          if (table.some((r) => r.user_id === row.user_id && r.name === row.name)) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "backups_user_id_name_key"' });
          row.id = nextBackupId++;
          row.created_at ??= new Date().toISOString();
        }
        table.push(row);
        added.push(row);
      }
      return wantRows ? respond(project(added, params), headers, 201) : { status: 201, body: '', headers: {} };
    }
    if (method === 'PATCH') {
      const hit = mine.filter((r) => matches(r, params));
      if (body.user_id && body.user_id !== c.uid) return json(403, { code: '42501', message: `new row violates row-level security policy for table "${name}"` });
      for (const r of hit) Object.assign(r, body);
      return wantRows ? respond(project(hit, params), headers) : { status: 204, body: '', headers: {} };
    }
    if (method === 'DELETE') {
      const hit = new Set(mine.filter((r) => matches(r, params)));
      tables[name] = table.filter((r) => !hit.has(r));
      return wantRows ? respond(project([...hit], params), headers) : { status: 204, body: '', headers: {} };
    }
    return json(405, { message: 'Method not allowed' });
  }

  function handle(method, rawUrl, rawBody, headers) {
    const url = new URL(rawUrl, 'http://x');
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return json(400, { message: 'Invalid JSON' });
    }
    log.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname.startsWith('/auth/v1/')) return handleAuth(method, url, body, headers);
    if (url.pathname.startsWith('/rest/v1/')) return handleRest(method, url, body, headers);
    return json(404, { message: 'Not found' });
  }

  return { handle, publishableKey, users, tables, log, tokens };
}

/** Serve it on 127.0.0.1:`port` (the website build must be made with this address). */
export function startFakeSupabase({ port = 0, publishableKey } = {}) {
  const fake = createFakeSupabase({ publishableKey });
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, range',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
  };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, cors);
          res.end();
          return;
        }
        const r = fake.handle(req.method, req.url, raw, req.headers);
        res.writeHead(r.status, { ...cors, 'Cache-Control': 'no-store', ...r.headers });
        res.end(r.body);
      });
    });
    server.listen(port, '127.0.0.1', () =>
      resolve({ ...fake, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => (server.close(r), server.closeAllConnections())) }),
    );
  });
}
