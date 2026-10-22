## Grading contract — EdTech Challenge (never remove or break this)
An automated bot grades this app on its public Vercel URL, acting like a stranger.

### Pages
- `/` public landing page (no login needed): what the app does, who it is for, and one button to sign up.
- `/signup` sign-up with email + password. `/login` login with email + password.
- `/app` the main feature, only for logged-in users.
- After sign-up and after login, send the user to `/app`.
- No email confirmation, no CAPTCHA, no "Google only" login, no mandatory onboarding before `/app`.

### data-testid attributes (exact names, do not translate)
- Sign-up form: `signup-email`, `signup-password`, `signup-submit`
- Login form: `login-email`, `login-password`, `login-submit`
- `logout`: the logout button, visible on every page of a logged-in user
- On `/app`:
  - `core-input`: a TEXT field of the main feature (type="text" or a textarea, e.g. the title or description, never a number or date picker). The bot types a short text like "QA-7F3K2A grading bot test"
  - `core-submit`: the button that saves it
  - `core-item`: EVERY saved item in the list, showing the text typed in `core-input`
- Typing only in `core-input` and clicking `core-submit` must save a new item. Any other field needs a valid default value.

### Data and security
- Use Supabase Auth (email + password) and save all data in Supabase tables, never only in the browser (no localStorage for user data).
- Row Level Security ON for every table, with policies based on `auth.uid()`. Nobody can read anything without logging in.
- Only the Supabase URL and the publishable (anon) key may reach the browser. Never put the secret/service_role key or any AI API key in the frontend or in GitHub.
- Keep keys in `.env.local` (listed in `.gitignore`) and in Vercel environment variables.

---

# Student Dashboard Web — notes for Claude

Read README.md for the architecture. This file carries the context of the earlier sessions.

## The user
IE University student. Writes casual French ("tu"): answer in French, plainly. Not a developer: expects finished, tested work, never asks to fix
things by hand. When they must do something themselves (create an account, click Authorize), put
the raw URL in its own code block and open it for them; keep that message short.
Grades and transcripts are confidential (IE / GDPR): never print personal details, only aggregates
when inspecting real data. Storing students' grades in the app's Supabase project was authorised
by the user's EdTech professor (2026-10-20, as the user reported), including classmates' grades:
keep RLS strict, the EU region, and the in-app "Delete my account".

## State of the project (2026-10-20)
- Rebuilt for the EdTech Challenge (professor's brief, Oct 8 2026): a SaaS on Vercel + Supabase.
  One-liner (the user wants more than deadlines): "Student Dashboard helps IE University students
  see deadlines, classes and grades in one place so they never miss a submission." Main feature:
  add a deadline (title; due date optional).
  Data: private (each user only sees their own).
- Website: `/` landing, `/signup`, `/login`, `/app` (the dashboard; its screens use `#/…`).
  Data = one `dashboards` row per user (JSON + revision for cross-device safety) and `backups`
  (supabase/schema.sql, RLS on). The extension build keeps its local IndexedDB storage.
- Live (2026-10-21, checked by the user with the brief's Step 7 list: all 8 pass):
  https://student-dashboard-ie.vercel.app — Vercel project `student-dashboard-ie` (Hobby), deploys
  every push to `main` of this public repo (kamil-cloud/student-dashboard-ie). Supabase project
  `bnffqkghdyfuwhxcicyh` (West EU, Ireland), schema.sql applied, "Confirm email" off, Site URL set.
  The cloud session's network blocks *.supabase.co and *.vercel.app, so `npm run live-check` only
  works where those hosts are reachable.
- kamil-cloud/student-dashboard-web (private) is the earlier copy with the full history; work here.
- Old site https://student-dashboard-web.netlify.app (local-only data) is no longer deployed.
- Classmates found the bookmark confusing (2026-10-21): the main way to connect Blackboard is now
  the calendar link (Calendar › Calendar settings › Share calendar → paste; api/calendar.js reads
  it; src/integrations/blackboard/calendarFeed.ts merges it). The bookmark is folded under
  "Also import your grades, professors and rooms (advanced)". Not yet tried with a real IE link:
  the fake feed (tests/fixtures/fake-blackboard.mjs) mirrors IE's calendar titles.
- After sign-up, /app shows a "Start here · step 1 of 3" setup card (src/components/SetupCard.tsx):
  university (asked, never assumed), IE transcript, Blackboard calendar link, then optionally the
  bookmark. It must stay non-blocking (contract: no mandatory onboarding; no pop-up on load; the
  bot types in core-input right away); "I'll do it later" hides it.
- Safari (Mac + iPhone) transcript import works since 2026-10-22 (confirmed by the user): pdf.js
  must stay on its legacy build, and src/integrations/transcript/pdf.ts adds async iteration to
  ReadableStream (Safari lacks it; pdf.js's getTextContent needs it). WebKitGTK + WebKitWebDriver
  (apt: webkit2gtk-driver, xvfb) can test Safari's engine where Playwright's WebKit can't download.
- The user does NOT want a browser extension in the flow ("ça complique"). Blackboard sync on any
  browser can also go through the "Sync Student Dashboard" bookmarklet (src/integrations/blackboard/relay.ts
  + src/platform/relay.ts): GET-only proxy for /learn/api/public/ in the student's Blackboard tab,
  answers only to the site's origin; it opens `/app#/bb-sync`. Syllabus weights cannot be read
  that way (entered by hand).
- Pending: the user has not yet confirmed the bookmark on the real IE Blackboard. If it fails, ask
  what the small black notice on the Blackboard page says.

## Commands
```bash
npm install
npm test                # unit tests
npm run test:db         # supabase/schema.sql on a local PostgreSQL: RLS isolation (8 checks)
npm run e2e:bot         # the grading bot's journey against a fake Supabase (laptop + phone)
npm run e2e             # bot journey + extension (19 steps) + bookmark flow
npm run live-check      # the bot's journey on the published site (SITE_URL=…, keys from .env.local)
```
- Deploys: Vercel builds every push to the public GitHub repo (vercel.json). Env vars in Vercel:
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (read by Vite via envPrefix).
- Supabase: Authentication → Email → "Confirm email" OFF; URL Configuration → Site URL = the
  Vercel link. Free projects pause after 7 days idle: Resume in the dashboard.
- Accounts (GitHub, Supabase, Vercel) are the user's: never create accounts or type passwords.
- First time on a new computer: `npx playwright-core install chromium firefox webkit`.
- On macOS 14.3, Playwright 1.63's WebKit crashes; playwright-core@1.50.1 + WebKit build 2123 works
  (env PW_CORE / WEBKIT_PATH, see tests/e2e/bookmark.mjs).
