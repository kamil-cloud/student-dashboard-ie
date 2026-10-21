// A fake Blackboard Learn (Ultra) + IE syllabus tool with invented data, reproducing the real
// formats and quirks seen on IE's Blackboard:
//  - memberships give the course primary key; organisations and stale/disabled duplicates exist;
//  - terms named "BBA 26-27 THIRD Q1" with no dates ("Continuous");
//  - grades in displayGrade.score (Score or Percent); calculated and attendance columns;
//  - calendar: 400 for a `limit` parameter or a range over 16 weeks; sessions titled
//    "<NAME>  (Ses. N) Live in-person " with "<topic>\n<INSTRUCTOR>. ICALUID:…" descriptions,
//    Teams duplicates, asynchronous all-day slots, double sessions;
//  - syllabus via an LTI hand-off (auto-submitting form → tool → /app that renders late);
//  - the calendar link (Calendar settings › Share calendar): an .ics feed of the same calendar
//    plus every due date, at /webapps/calendar/calendarFeed/<token>/learn.ics, no login needed.
// Used by unit tests (as a fetch transport) and by the end-to-end tests (as an HTTP server).

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

export function createFakeBlackboard({ now = new Date(), toolOrigin = 'http://127.0.0.1:0', renderDelayMs = 1200 } = {}) {
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const ay = `${pad(y % 100)}-${pad((y + 1) % 100)}`;
  const pastAy = `${pad((y - 2) % 100)}-${pad((y - 1) % 100)}`;
  const at = (days, hh = 12, mm = 0) => {
    const d = new Date(now.getTime() + days * DAY);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };

  const state = { loggedIn: false, requests: [] };

  const terms = {
    _1_1: { id: '_1_1', name: `BBA ${ay} THIRD Q1`, availability: { available: 'Yes', duration: { type: 'Continuous' } } },
    _2_1: { id: '_2_1', name: `OACT ${ay} PRIMERO Anual`, availability: { available: 'Yes', duration: { type: 'Continuous' } } },
    _3_1: { id: '_3_1', name: `BBA ${pastAy} FIRST Q2`, availability: { available: 'Yes', duration: { type: 'Continuous' } } },
  };

  const courses = {
    _101_1: { id: '_101_1', courseId: `BBA${y}NBA.3.M.M_C1_500001`, name: 'MANAGEMENT CONTROL', termId: '_1_1', organization: false },
    _102_1: { id: '_102_1', courseId: `BBA${y}NBA.3.M.M_C1_500002`, name: 'DATA ANALYSIS FOR ECONOMICS', termId: '_1_1', organization: false },
    _103_1: { id: '_103_1', courseId: `BBA${y}NBA.3.M.M_C1_500003`, name: 'SUPPLY CHAIN MANAGEMENT', termId: '_1_1', organization: false },
    _104_1: { id: '_104_1', courseId: `OACT${y}NBA.OACT.M.M_C1_500004`, name: 'CAREER DEVELOPMENT 3 - SINGLE', termId: '_2_1', organization: false },
    _105_1: { id: '_105_1', courseId: 'BBA_STUDENT_GENERAL', name: 'BBA STUDENT GENERAL', termId: null, organization: true },
    _106_1: { id: '_106_1', courseId: `BBA${y - 2}NBA.1.M.M_C1_500006`, name: 'MICROECONOMICS', termId: '_3_1', organization: false },
    _107_1: { id: '_107_1', courseId: `BBA${y}NBA.3.M.M_C1_500007`, name: 'PRICING STRATEGY', termId: '_1_1', organization: false },
    _108_1: { id: '_108_1', courseId: `BBA${y}NBA.3.M.M_C9_500001`, name: 'MANAGEMENT CONTROL', termId: '_1_1', organization: false },
  };

  const memberships = [
    { courseId: '_101_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    { courseId: '_102_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    { courseId: '_103_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    { courseId: '_104_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    { courseId: '_105_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    { courseId: '_106_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    { courseId: '_107_1', courseRoleId: 'Student', availability: { available: 'Yes' } },
    // A stale duplicate section, disabled.
    { courseId: '_108_1', courseRoleId: 'Student', availability: { available: 'Disabled' } },
  ];

  const col = (id, name, type, possible, due = null, extra = {}) => ({ id, name, score: { possible }, grading: { type, ...(due ? { due } : {}) }, availability: { available: 'Yes' }, includeInCalculations: true, ...extra });

  const columns = {
    _101_1: [
      col('_9001_1', 'QWAttendance', 'Manual', 100),
      col('_9002_1', 'Extraordinary', 'Manual', 100, new Date(now.getTime() - 400 * DAY).toISOString()),
      col('_9003_1', 'Groupal Assignment: White Hills case (20%)', 'Attempts', 10, at(10, 23, 59)),
      col('_9004_1', 'Midterm exam', 'Manual', 10),
      col('_9005_1', 'Overall Grade', 'Calculated', 10),
      col('_9006_1', 'Participation - session 2', 'Manual', 10),
      col('_9007_1', 'Participation - session 3', 'Manual', 10),
      col('_9008_1', 'Participation - session 4', 'Manual', 10),
      col('_9009_1', 'Reading quiz 1', 'Attempts', 5, at(-3, 23, 59)),
      col('_9010_1', 'Reading quiz 2', 'Attempts', 5, at(18, 23, 59)),
    ],
    _102_1: [
      col('_9101_1', 'Problem set 1', 'Attempts', 10, at(5, 23, 59)),
      col('_9102_1', 'Problem set 2', 'Attempts', 10, at(19, 23, 59)),
      col('_9103_1', 'Final exam grade', 'Manual', 10),
      col('_9104_1', 'Mock test', 'Attempts', 0, at(2, 10, 0)),
    ],
    _104_1: [],
    _106_1: [col('_9601_1', 'Final exam', 'Manual', 10)],
    _107_1: [col('_9701_1', 'Pitch presentation', 'Attempts', 20, at(12, 9, 0))],
  };

  const grades = {
    _101_1: [
      { columnId: '_9001_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 100 } },
      { columnId: '_9003_1', status: 'NeedsGrading' },
      { columnId: '_9004_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 7.5 }, lastRelevantDate: at(-6, 18, 30) },
      { columnId: '_9005_1', displayGrade: { scaleType: 'Score', score: 8.1 } },
      { columnId: '_9006_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 8 } },
      { columnId: '_9007_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 9 } },
      { columnId: '_9008_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 10 } },
      { columnId: '_9009_1', status: 'Graded', displayGrade: { scaleType: 'Percent', score: 80 } },
    ],
    _102_1: [],
    _104_1: [],
    _106_1: [{ columnId: '_9601_1', status: 'Graded', displayGrade: { scaleType: 'Score', score: 6 } }],
    _107_1: [],
  };

  // ---- calendar --------------------------------------------------------------
  const calendar = [];
  const session = (id, course, n, days, hh, mm, durMin, kind, room, topic, instructor, n2) => {
    const start = at(days, hh, mm);
    const end = new Date(Date.parse(start) + durMin * 60_000).toISOString();
    const ses = n2 ? `(Ses. ${n}-${n2})` : `(Ses. ${n})`;
    calendar.push({
      id, type: 'Course', calendarId: course, calendarName: `${courses[course].courseId}: ${courses[course].name}`,
      title: `${courses[course].name}  ${ses} ${kind} `,
      description: `${topic ? `${topic}\n` : ''}${instructor}. ICALUID:${id}-uid`,
      location: room, start, end, modified: start, color: '#000', disableResizing: true, createdByUserId: '_1_1',
    });
  };
  // Management Control: in person twice a week, one asynchronous slot, one double session, final exam.
  session('_c1_1', '_101_1', 1, -20, 17, 30, 80, 'Live in-person', 'T-11.02 ', 'Introduction to management control', 'MONTSERRAT DE LA PRUEBA');
  session('_c2_1', '_101_1', 2, -15, 17, 30, 80, 'Live in-person', 'T-11.02 ', 'Responsibility centres', 'MONTSERRAT DE LA PRUEBA');
  session('_c3_1', '_101_1', 3, 0, 17, 30, 80, 'Live in-person', 'T-11.02 ', 'Transfer pricing', 'MONTSERRAT DE LA PRUEBA');
  calendar.push({ ...calendar[calendar.length - 1], id: '_c3t_1', title: 'MANAGEMENT CONTROL', location: 'https://teams.microsoft.com/l/meetup-join/fake', description: '' });
  session('_c4_1', '_101_1', 4, 2, 0, 0, 0, 'Asynchronous', '', 'EXERCISE: BUDGETING', 'MONTSERRAT DE LA PRUEBA');
  {
    // Asynchronous slots run 00:00–23:59 Madrid time (22:00Z the day before → 21:59Z).
    const last = calendar[calendar.length - 1];
    const day = new Date(now.getTime() + 2 * DAY);
    const s = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() - 1, 22, 0));
    last.start = s.toISOString();
    last.end = new Date(s.getTime() + (23 * 60 + 59) * 60_000).toISOString();
  }
  session('_c5_1', '_101_1', 5, 7, 16, 0, 160, 'Live in-person', 'T-11.02 ', 'Balanced scorecard', 'MONTSERRAT DE LA PRUEBA', 6);
  session('_c6_1', '_101_1', 30, 60, 9, 0, 120, 'Live in-person', 'IE TOWER', 'Final exam', 'MONTSERRAT DE LA PRUEBA');
  // Data Analysis: live online, no topic on one session (description is just the instructor).
  session('_d1_1', '_102_1', 1, -10, 10, 0, 80, 'Live online', 'Live online', 'Regression refresher', 'ANA EJEMPLO');
  session('_d2_1', '_102_1', 2, 1, 10, 0, 80, 'Live online', 'Live online', '', 'ANA EJEMPLO');
  session('_d3_1', '_102_1', 3, 8, 10, 0, 80, 'Live in-person', 'T-12.04 ', 'Panel data', 'ANA EJEMPLO');
  // Supply Chain: sessions but its gradebook is not accessible (403).
  session('_s1_1', '_103_1', 1, -5, 15, 0, 80, 'Live in-person', 'T-19.02 ', 'Supply chain basics', 'PEDRO MODELO');
  session('_s2_1', '_103_1', 2, 3, 15, 0, 80, 'Live in-person', 'T-19.02 ', 'Inventory', 'PEDRO MODELO');
  session('_p1_1', '_107_1', 1, 4, 11, 0, 80, 'Live in-person', 'T-01.01 ', 'Value-based pricing', 'LAURA FICTICIA');
  // A deadline that exists only on the calendar.
  calendar.push({
    id: '_g1_1', type: 'GradebookColumn', calendarId: '_102_1', calendarName: `${courses._102_1.courseId}: ${courses._102_1.name}`,
    title: 'Data report submission', description: '<p>Upload your report</p>', location: '', start: at(15, 23, 59), end: at(15, 23, 59),
  });
  // The calendar copy of a gradebook column (must not duplicate it).
  calendar.push({
    id: '_g2_1', type: 'GradebookColumn', calendarId: '_101_1', calendarName: `${courses._101_1.courseId}: ${courses._101_1.name}`,
    title: 'Groupal Assignment: White Hills case (20%)', description: '', location: '', start: at(10, 23, 59), end: at(10, 23, 59),
  });

  // ---- syllabi ------------------------------------------------------------------
  const syllabi = {
    _101_1: {
      lang: 'en', professor: 'MONTSERRAT DE LA PRUEBA', sessions: 30, credits: '5',
      rows: [['Final Exam', '40 %', 'LO1', 'Minimum grade of 3.5 to pass'], ['Intermediate test', '20 %', 'LO2', ''], ['Group Assignment', '20 %', 'LO3', ''], ['Class Participation', '10 %', 'LO4', ''], ['Quizzes', '10 %', 'LO5', ''], ['TOTAL', '100 %', '', '']],
    },
    _102_1: {
      lang: 'es', professor: 'ANA EJEMPLO', sessions: 30, credits: '6',
      rows: [['Examen final', '50 %', 'OA1', ''], ['Ejercicios individuales', '30 %', 'OA2', ''], ['Participación', '20 %', 'OA3', '']],
    },
    _107_1: { lang: 'en', professor: 'LAURA FICTICIA', sessions: 15, credits: '3', rows: [['Pitch presentation', '50%', '', ''], ['Final exam', '50%', '', '']] },
  };

  // ---- calendar link (.ics) --------------------------------------------------------
  const FEED_TOKEN = 'f00dfeedc0ffee42';
  const feedPath = `/webapps/calendar/calendarFeed/${FEED_TOKEN}/learn.ics`;
  const icsStamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsText = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function feedIcs() {
    const events = [
      ...calendar.map((i) => ({ uid: `${i.id}@blackboard`, summary: i.title, description: i.description.replace(/<[^>]+>/g, ''), location: i.location, start: i.start, end: i.end })),
      // Due dates of gradebook columns (those not already on the calendar above).
      ...Object.values(columns)
        .flat()
        .filter((c) => c.grading.due && !calendar.some((i) => i.title === c.name))
        .map((c) => ({ uid: `${c.id}-due@blackboard`, summary: c.name, description: '', location: '', start: c.grading.due, end: c.grading.due })),
    ];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blackboard Inc.//Blackboard Learn//EN', 'X-PUBLISHED-TTL:PT4H'];
    for (const e of events)
      lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsStamp(now.toISOString())}`, `DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(e.end)}`, `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`, `LOCATION:${icsText(e.location)}`, 'END:VEVENT');
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ---- routing ----------------------------------------------------------------------
  const json = (status, body) => ({ status, type: 'application/json', body: JSON.stringify(body) });
  const html = (status, body, headers = {}) => ({ status, type: 'text/html; charset=utf-8', body, headers });
  const results = (list) => json(200, { results: list });
  const pick = (o, fields) => {
    if (!fields) return o;
    const out = {};
    for (const f of fields.split(',')) if (f in o) out[f] = o[f];
    return out;
  };

  /** Blackboard API + pages. `cookie` is the request's Cookie header. */
  function handle(method, rawUrl, cookie = '') {
    const url = new URL(rawUrl, 'http://bb.local');
    const p = url.pathname;
    state.requests.push(`${method} ${p}${url.search}`);
    const authed = state.loggedIn && /bb_session=ok/.test(cookie ?? '');

    // ---- calendar link: a private address, no login needed
    if (p.startsWith('/webapps/calendar/calendarFeed/')) {
      return p === feedPath ? { status: 200, type: 'text/calendar; charset=utf-8', body: feedIcs() } : html(404, 'Not found');
    }

    // ---- pages
    if (p === '/' || p.startsWith('/ultra')) {
      if (authed) return html(200, '<!doctype html><title>Blackboard</title><h1 id="courses">My courses</h1>');
      return html(200, '<!doctype html><title>Sign in</title><form method="post" action="/fake-login"><button id="sign-in">Sign in</button></form>');
    }
    if (p === '/fake-login' && method === 'POST') {
      state.loggedIn = true;
      return html(302, '', { Location: '/ultra/course', 'Set-Cookie': 'bb_session=ok; Path=/; SameSite=Lax; HttpOnly' });
    }
    if (p === '/webapps/blackboard/execute/blti/launchPlacement') {
      if (!authed) return html(302, '', { Location: '/ultra' });
      const course = url.searchParams.get('course_id');
      return html(
        200,
        `<!doctype html><title>Launching…</title><form id="lti" method="post" action="${toolOrigin}/lti/launch"><input type="hidden" name="context_id" value="${course}"><input type="hidden" name="oauth_signature" value="fake"></form><script>document.getElementById('lti').submit()</script>`,
      );
    }

    // ---- API
    if (!p.startsWith('/learn/api/')) return html(404, 'Not found');
    if (!authed) return json(401, { status: 401, message: 'Unauthorized' });
    const fields = url.searchParams.get('fields');
    let m;
    if (p === '/learn/api/public/v1/users/me') return json(200, pick({ id: '_42_1', userName: 'student', name: { given: 'Test', family: 'Student' } }, fields));
    if ((m = /^\/learn\/api\/public\/v1\/users\/([^/]+)\/courses$/.exec(p))) {
      if (m[1] !== '_42_1') return json(403, { status: 403 });
      return results(memberships.map((x) => pick(x, fields)));
    }
    if ((m = /^\/learn\/api\/public\/v3\/courses\/([^/]+)$/.exec(p))) {
      const c = courses[decodeURIComponent(m[1])];
      return c ? json(200, pick({ ...c, availability: { available: 'Yes' } }, fields)) : json(404, { status: 404 });
    }
    if ((m = /^\/learn\/api\/public\/v1\/terms\/([^/]+)$/.exec(p))) {
      const t = terms[decodeURIComponent(m[1])];
      return t ? json(200, pick(t, fields)) : json(404, { status: 404 });
    }
    if ((m = /^\/learn\/api\/public\/v2\/courses\/([^/]+)\/gradebook\/columns$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      if (id === '_103_1') return json(403, { status: 403, message: 'Forbidden' });
      return results(columns[id] ?? []);
    }
    if ((m = /^\/learn\/api\/public\/v2\/courses\/([^/]+)\/gradebook\/users\/([^/]+)$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      return results((grades[id] ?? []).map((g) => ({ userId: '_42_1', exempt: false, ...g })));
    }
    if (p === '/learn/api/public/v1/calendars/items') {
      if (url.searchParams.has('limit')) return json(400, { status: 400, message: 'Invalid parameter: limit' });
      const since = Date.parse(url.searchParams.get('since') ?? '');
      const until = Date.parse(url.searchParams.get('until') ?? '');
      if (!since || !until || until - since > 112 * DAY) return json(400, { status: 400, message: 'Date range too large' });
      return results(calendar.filter((i) => Date.parse(i.start) < until && Date.parse(i.end) >= since));
    }
    return json(404, { status: 404 });
  }

  /** The syllabus tool (served on another origin). */
  function handleTool(method, rawUrl, body = '', cookie = '') {
    const url = new URL(rawUrl, 'http://tool.local');
    if (url.pathname === '/lti/launch' && method === 'POST') {
      const course = new URLSearchParams(body).get('context_id') ?? '';
      return html(302, '', { Location: '/app', 'Set-Cookie': `tool_course=${encodeURIComponent(course)}; Path=/; SameSite=Lax` });
    }
    if (url.pathname === '/app') {
      const course = decodeURIComponent((/tool_course=([^;]+)/.exec(cookie ?? '') ?? [])[1] ?? '');
      const s = syllabi[course];
      if (!s) return html(302, '', { Location: '/app/error?error_description=Syllabus+is+not+available.' });
      const es = s.lang === 'es';
      const table = `<table><tr><th>${es ? 'Concepto' : 'Criteria'}</th><th>${es ? 'Puntuación' : 'Score'}</th><th>${es ? 'Objetivos de Aprendizaje' : 'Learning Objectives'}</th><th>${es ? 'Comentarios' : 'Comments'}</th></tr>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
      const method1 = `<table><tr><th>${es ? 'Metodología de enseñanza' : 'Learning Activity'}</th><th>${es ? 'Peso' : 'Weighting'}</th></tr><tr><td>Lectures</td><td>30%</td></tr></table>`;
      const header = es
        ? `<p>AÑO ACADÉMICO: 26-27</p><p>NÚMERO DE SESIONES: ${s.sessions}</p><p>Nº DE CRÉDITOS (ECTS): ${s.credits}</p><p>Profesor: ${s.professor}</p>`
        : `<p>ACADEMIC YEAR: 26-27</p><p>NUMBER OF SESSIONS: ${s.sessions}</p><p>NUMBER OF CREDITS: ${s.credits}</p><p>Professor: ${s.professor}</p>`;
      // Rendered late, like the real single-page app.
      return html(200, `<!doctype html><title>IE | Syllabus</title><div id="root">Loading Syllabus information…</div><script>setTimeout(() => { document.getElementById('root').innerHTML = ${JSON.stringify(`<h1>Syllabus</h1>${header}${method1}${table}`)}; }, ${renderDelayMs});</script>`);
    }
    if (url.pathname === '/app/error') return html(200, '<!doctype html><title>IE | Syllabus</title><p>Syllabus is not available.</p>');
    return html(404, 'Not found');
  }

  /** fetch-compatible transport for unit tests (always logged in). */
  function transport(urlString) {
    state.loggedIn = true;
    const r = handle('GET', urlString, 'bb_session=ok');
    return Promise.resolve(new Response(r.status === 302 ? null : r.body, { status: r.status === 302 ? 200 : r.status, headers: { 'content-type': r.type } }));
  }

  /** Test helpers: things that happen on Blackboard between two syncs. */
  const addGrade = (courseId, grade) => {
    grades[courseId] = (grades[courseId] ?? []).filter((g) => g.columnId !== grade.columnId).concat(grade);
  };
  const moveDue = (courseId, columnId, days) => {
    const c = (columns[courseId] ?? []).find((x) => x.id === columnId);
    if (c) c.grading.due = at(days, 23, 59);
  };

  /** The local date `days` from now, as the app stores it. */
  const dateIn = (days) => {
    const d = new Date(at(days, 23, 59));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  return { state, handle, handleTool, transport, addGrade, moveDue, feedPath, feedIcs, dateIn, ay: ay.replace('-', '/'), courses, syllabi, now };
}
