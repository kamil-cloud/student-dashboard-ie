# Student Dashboard

**Student Dashboard helps IE University students see deadlines, classes and grades in one place so
they never miss a submission.**

A web app (React + Vite, hosted on Vercel) with accounts and a database (Supabase). Built for the
EdTech Challenge at IE University; the grading contract is in [CLAUDE.md](CLAUDE.md).

- **Add a deadline** in two seconds on `/app` (title, optional due date): it is saved to your
  account and listed with all your other deadlines, on every device you log in from.
- **Blackboard calendar link** (the easiest way): in Blackboard, Calendar › Calendar settings ›
  Share calendar, copy the link and paste it once. Every course's deadlines and class sessions
  come in and stay up to date (re-read on opening and on "Sync now"), on any device.
- **Blackboard sync with the bookmark** (advanced; IE preset, any Blackboard Learn site): also
  professors, rooms and published grades, with the student's own Blackboard session, read-only,
  through the "Sync Student Dashboard" bookmark clicked on Blackboard.
- **Transcript import** (IE "Expediente Académico" PDF): every course, grade, ECTS, Matrícula de
  Honor, pass/fail and exchange semester; the GPA is computed like IE's. The PDF is read in the
  browser and never uploaded; identity details are never extracted.
- Reminders, calendar export (.ics) for phones, calendar import, backups, dark/light themes.

## Pages

| Address   | What it is                                                              |
| --------- | ----------------------------------------------------------------------- |
| `/`       | Public landing page: what it is, who it is for, one "Sign up" button     |
| `/signup` | Create an account (email + password, no email confirmation)              |
| `/login`  | Log in (a wrong password is refused)                                     |
| `/app`    | The dashboard (logged-in only). Its screens use `#/…` (`/app#/calendar`) |

## Data and privacy

- Accounts: Supabase Auth, email + password.
- Data: Supabase tables (`supabase/schema.sql`), **Row Level Security on every table**:
  - `dashboards`: one row per student (their dashboard as JSON, plus a revision number so two
    devices never silently overwrite each other);
  - `backups`: snapshots (daily, and before imports, restores and resets).
  Each student reads and writes only their own rows (`auth.uid() = user_id`); logged-out visitors
  have no access at all. Nothing personal is kept in the browser (only the login session).
- Settings → "Delete my account" erases the account and everything saved with it.
- `api/calendar.js` (a Vercel function) reads the Blackboard calendar link for the browser, which
  cannot read another site's file itself: signed-in students only (Supabase session checked),
  https `.ics` addresses only, no private network addresses, 5 MB / 10 s at most, nothing stored.
- Only the Supabase URL and the publishable key reach the browser (`.env.local`, Vercel env vars).
  The secret key is never used by this app.

## Set up your own copy

1. **Supabase** (supabase.com → New project, a European region):
   - Authentication → Sign In / Providers → Email: keep Email on, turn **Confirm email OFF**.
   - SQL Editor → New query: paste `supabase/schema.sql`, Run.
   - Connect (or Project Settings → API Keys): copy the Project URL and the publishable key.
2. **Locally**: copy `.env.example` to `.env.local` and paste the two values. `npm install`,
   `npm run dev`, open http://localhost:5190.
3. **Vercel**: Add New… → Project → import the GitHub repository. Environment Variables:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (same as `.env.local`).
   Deploy. `vercel.json` sets the build, the page rewrites and security headers.
4. **Supabase again**: Authentication → URL Configuration → Site URL = your
   `https://<project>.vercel.app` (add it to Redirect URLs too).

Every push to GitHub then updates the site.

## How the Blackboard calendar link works

The link (`https://<blackboard>/webapps/calendar/calendarFeed/<private id>/learn.ics`) is an
iCalendar feed of all the student's courses, one year back and ahead. `src/integrations/blackboard/calendarFeed.ts`
turns it into data: IE's sessions ("MANAGEMENT CONTROL (Ses. 3) Live in-person") become that
course's class sessions (course created if needed, read like the bookmark reads them: room, mode,
topic), short events and events named like deadlines become tasks from today on. Dates the
student changed are kept, and when the bookmark is used too, Blackboard's own records win and
nothing is duplicated. The link is saved in the student's dashboard row (RLS).

## How the Blackboard bookmark works

Browsers do not let a website read another site (Blackboard) by itself. The bookmark runs in the
student's own Blackboard tab and lets this website — and nothing else — make GET requests to
Blackboard's public REST API (`/learn/api/public/` only), with answers sent only to this
website's address. No Blackboard password is asked or stored.

```
 Student Dashboard (/app) ◀─postMessage─▶ bookmark in the Blackboard tab ──▶ Blackboard REST API
        │                                                                    (GET only, the
        ▼                                                                     student's session)
 Supabase (Auth + tables with RLS)
```

- `src/integrations/blackboard` — REST client, snapshot of the chosen courses, and a pure,
  idempotent merge into the app data: imported records keep a `source` with the values last
  imported, so the student's own edits always win, except official fields (dates, grades).
- `src/integrations/blackboard/relay.ts` — the bookmark's code (self-contained), and
  `src/platform/relay.ts` — the website side.
- `src/integrations/transcript` — PDF text (pdf.js) → courses (`ie.ts`) → semesters/courses.
- `src/lib/cloudStorage.ts` — the website's storage (Supabase); `src/platform/supabase.ts` — client
  and session; `src/lib/paths.ts` — the page addresses; `src/pages/Landing.tsx`, `Auth.tsx`.
- `src/components/QuickAdd.tsx` — the main feature (`core-input`, `core-submit`, `core-item`).

Blackboard quirks handled (verified on IE's Blackboard): the calendar endpoint rejects a `limit`
parameter and ranges over 16 weeks; grades live in `displayGrade.score` (Score or Percent);
calculated, attendance and resit columns are not tasks; terms have no dates (semester dates come
from the first and last class); Teams duplicates and double sessions in the calendar.

The optional Chrome extension (`npm run package` → `dist/Student-Dashboard.zip`, "Load unpacked")
still exists for background sync and syllabus weights; it keeps its data in the browser and is not
part of the website flow.

## Development

```bash
npm install
npm run dev          # website with hot reload (http://localhost:5190), uses .env.local
npm run typecheck
npm test             # unit tests: transcript parser, Blackboard parsing/merge, calendar files, grades
npm run test:db      # supabase/schema.sql on a local PostgreSQL: RLS keeps every student to their rows
npm run e2e:bot      # the grading bot's journey (sign up, add, log out, wrong password, 2nd user…)
npm run e2e          # bot journey + extension + bookmark sync (Chromium, Firefox, WebKit)
npm run live-check   # the bot's journey on the published site: SITE_URL=https://….vercel.app
```

`npx playwright-core install chromium firefox webkit` once before the end-to-end tests. They use
invented data only — a generated fake transcript, a fake Blackboard and a fake Supabase project
(`tests/fixtures`). `npm run live-check` creates two test accounts on the real site.

Independent student project · not affiliated with IE University or Blackboard.
