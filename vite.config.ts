import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy for the website build (the extension's comes from its manifest).
function webCsp(supabaseUrl: string): Plugin {
  // The database (Supabase) is the only other address the website talks to.
  let db = '';
  try {
    db = supabaseUrl ? ` ${new URL(supabaseUrl).origin}` : '';
  } catch {
    /* not a URL: the app shows that accounts are not set up */
  }
  return {
    name: 'web-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const csp =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
        `connect-src 'self'${db}; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

// `vite build --mode web` → dist/web (installable website)
// `vite build --mode extension` → dist/extension (pages of the browser extension)
// `npm run dev`: serve the website's /api functions too (Vercel runs them in production).
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/calendar', (req, res) => {
        void import('./api/calendar.js').then((m) => m.default(req, res));
      });
    },
  };
}

// Keys come from .env.local (or the host's environment variables) with the names the Next.js
// convention uses, so the same two lines work everywhere: NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
const ENV_PREFIX = ['VITE_', 'NEXT_PUBLIC_'];

export default defineConfig(({ mode }) => {
  const extension = mode === 'extension';
  const env = { ...loadEnv(mode, process.cwd(), ENV_PREFIX), ...process.env };
  // The dev server's /api functions read the same two public values.
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) process.env[k] ??= env[k];
  return {
    // The website has real pages (/, /signup, /login, /app): assets must load from the root.
    base: extension ? './' : '/',
    publicDir: false,
    envPrefix: ENV_PREFIX,
    plugins: [react(), ...(extension ? [] : [webCsp(env.NEXT_PUBLIC_SUPABASE_URL ?? ''), devApi()])],
    build: {
      outDir: extension ? 'dist/extension' : 'dist/web',
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 2500,
      rollupOptions: { input: extension ? { app: 'app.html', popup: 'popup.html' } : { index: 'index.html' } },
    },
    server: { port: 5190, strictPort: false },
  };
});
