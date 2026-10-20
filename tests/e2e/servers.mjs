// HTTP servers for the end-to-end tests: the fake Blackboard (on localhost) and the fake
// syllabus tool (on 127.0.0.1, a different site), a static server for the website build, and
// the fake Supabase project the test build talks to.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createFakeBlackboard } from '../fixtures/fake-blackboard.mjs';
import { startFakeSupabase } from '../fixtures/fake-supabase.mjs';

/** Where test builds (build.mjs --test-hosts) expect the database. */
export const TEST_SUPABASE_PORT = 54329;
export const TEST_SUPABASE_KEY = 'sb_publishable_test';
export const startTestSupabase = () => startFakeSupabase({ port: TEST_SUPABASE_PORT, publishableKey: TEST_SUPABASE_KEY });

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function send(res, r) {
  res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store', ...(r.headers ?? {}) });
  res.end(r.body ?? '');
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });

export async function startFakeBlackboard(opts = {}) {
  let bb;
  const tool = await listen(async (req, res) => send(res, bb.handleTool(req.method, req.url, await readBody(req), req.headers.cookie)));
  const toolOrigin = `http://127.0.0.1:${tool.address().port}`;
  bb = createFakeBlackboard({ toolOrigin, ...opts });
  const server = await listen(async (req, res) => {
    await readBody(req);
    send(res, bb.handle(req.method, req.url, req.headers.cookie));
  });
  // Blackboard is reached as "localhost" so its cookies are separate from the tool's.
  const host = `http://localhost:${server.address().port}`;
  return { bb, host, toolOrigin, close: () => Promise.all([new Promise((r) => server.close(r)), new Promise((r) => tool.close(r))]) };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.zip': 'application/zip' };

export async function startStatic(dir) {
  const server = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir)) return send(res, { status: 403, type: 'text/plain', body: 'no' });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    // Like the host (vercel.json): pages such as /signup or /app are the app's index.html.
    if (!fs.existsSync(file) && !path.extname(url.pathname)) file = path.join(dir, 'index.html');
    if (!fs.existsSync(file)) return send(res, { status: 404, type: 'text/plain', body: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return { url: `http://localhost:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
