// Builds both targets:
//   dist/web        the installable website (PWA, works offline)
//   dist/extension  the browser extension (Chrome, Edge, Brave, Arc…)
// Options:
//   --zip          also write dist/Student-Dashboard.zip (the optional Chrome extension, to share)
//   --test-hosts   let the extension reach http://localhost / 127.0.0.1 (end-to-end tests and development only)
//   WEB_ORIGIN=https://you.vercel.app  where the website is hosted, so it can talk to the extension
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { extensionKey } from './extension-id.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const key = extensionKey();
const testHosts = args.has('--test-hosts');
if (testHosts && args.has('--zip')) throw new Error('Do not package a test build (--test-hosts) for sharing.');
const ZIP_NAME = 'Student-Dashboard.zip';
const GUIDE = path.join(ROOT, 'static', 'install-guide.html');
// On Vercel, the production address is known at build time.
const vercelOrigin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
const webOrigins = (process.env.WEB_ORIGIN ?? vercelOrigin)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter((s) => /^https:\/\/[^/]+$/.test(s));

process.env.VITE_EXTENSION_ID = key.id;
process.env.VITE_APP_VERSION = pkg.version;
process.env.VITE_WEB_ORIGINS = JSON.stringify(webOrigins);
process.env.VITE_ALLOW_LOCALHOST = testHosts ? '1' : '';
if (testHosts) {
  // Test builds talk to the fake Supabase of the end-to-end tests (tests/e2e/servers.mjs).
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54329';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
}

const ICONS = path.join(ROOT, 'static', 'icons');
const copyIcons = (dest) => fs.cpSync(ICONS, path.join(dest, 'icons'), { recursive: true });
const write = (file, content) => fs.writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

// ---- website -----------------------------------------------------------------
const WEB = path.join(ROOT, 'dist', 'web');
await build({ root: ROOT, mode: 'web', logLevel: 'warn' });
copyIcons(WEB);
write(path.join(WEB, 'manifest.webmanifest'), {
  name: 'Student Dashboard',
  short_name: 'Student',
  description: 'Your deadlines, classes, grades and GPA in one place, for IE University students.',
  start_url: '/app',
  scope: '/',
  display: 'standalone',
  background_color: '#0e0f13',
  theme_color: '#0e0f13',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});
const assets = listFiles(WEB).filter((f) => f !== 'sw.js');
const cacheName = `sd-${crypto.createHash('sha256').update(assets.join('|') + pkg.version).digest('hex').slice(0, 12)}`;
write(
  path.join(WEB, 'sw.js'),
  `// Offline support: only the app shell is cached; your data is never stored here.
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ${JSON.stringify(['./', ...assets.map((f) => `./${f}`)])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`,
);
// Read by Netlify and Cloudflare Pages (written after the precache list: it is not served itself).
write(
  path.join(WEB, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  X-Robots-Tag: noindex
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Content-Type: application/manifest+json
`,
);

// ---- extension ---------------------------------------------------------------
const EXT = path.join(ROOT, 'dist', 'extension');
await build({ root: ROOT, mode: 'extension', logLevel: 'warn' });
await build({
  root: ROOT,
  configFile: false,
  mode: 'extension',
  logLevel: 'warn',
  publicDir: false,
  // Library mode leaves process.env.NODE_ENV alone, and service workers have no `process`.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: EXT,
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    lib: { entry: path.join(ROOT, 'src/background/index.ts'), formats: ['es'], fileName: () => 'background.js' },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
copyIcons(EXT);
const localHosts = testHosts ? ['http://localhost/*', 'http://127.0.0.1/*'] : [];
write(path.join(EXT, 'manifest.json'), {
  manifest_version: 3,
  name: 'Student Dashboard',
  short_name: 'Student Dashboard',
  version: pkg.version,
  description: 'Courses, deadlines, grades and GPA in one place, synced with Blackboard. Your data stays in your browser.',
  key: key.key,
  minimum_chrome_version: '116',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_popup: 'popup.html', default_title: 'Student Dashboard', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['alarms', 'notifications', 'scripting', 'unlimitedStorage', 'downloads'],
  host_permissions: ['https://blackboard.ie.edu/*', 'https://ie-lti-syllabus.ie.edu/*', ...localHosts],
  optional_host_permissions: ['https://*/*'],
  // Only the hosted website may talk to the extension (plus local servers in test builds).
  externally_connectable: { matches: [...localHosts, ...webOrigins.map((o) => `${o}/*`)] },
});

if (args.has('--zip')) {
  // dist/package/
  //   Student Dashboard/        ← the folder to choose in "Load unpacked"
  //   How to install.html
  const PKG = path.join(ROOT, 'dist', 'package');
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.mkdirSync(PKG, { recursive: true });
  fs.cpSync(EXT, path.join(PKG, 'Student Dashboard'), { recursive: true });
  fs.copyFileSync(GUIDE, path.join(PKG, 'How to install.html'));
  const zip = path.join(ROOT, 'dist', ZIP_NAME);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-r', '-q', '-X', zip, 'Student Dashboard', 'How to install.html'], { cwd: PKG });
  console.log(`✓ ${path.relative(ROOT, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
}
console.log(`✓ dist/web and dist/extension (extension id ${key.id}${webOrigins.length ? `, website ${webOrigins.join(', ')}` : ''}${testHosts ? ', TEST BUILD' : ''})`);
