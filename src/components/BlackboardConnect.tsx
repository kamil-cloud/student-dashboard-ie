import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { CalendarLinkConnect } from './CalendarLink';
import { useConfirm } from './feedback';
import { BookmarkSetup } from './SyncBookmark';
import { Button } from './ui';
import type { BbApplySummary } from '../integrations/blackboard/apply';
import { describeCalendar, type CalendarSummary } from '../integrations/blackboard/calendarFeed';
import { BlackboardError } from '../integrations/blackboard/client';
import { cleanCourseName, parseTerm } from '../integrations/blackboard/parse';
import { syllabusPlacement } from '../integrations/blackboard/syllabus';
import type { BbCourseChoice, SyncProgress } from '../integrations/blackboard/types';
import { IE_BLACKBOARD_HOST } from '../lib/defaults';
import { plural } from '../lib/format';
import { api } from '../lib/storage';
import { useStore } from '../lib/store';
import { describeSummary, useSync } from '../lib/sync';
import {
  checkLogin,
  detectBackend,
  extensionInfo,
  handOffToExtension,
  listCourses,
  normalizeHost,
  openBlackboardTab,
  openLogin,
  readSnapshot,
  requestAccess,
  type Backend,
} from '../platform/blackboard';
import { IS_EXTENSION } from '../platform/env';
import { claimRelay, currentRelay, onRelay, takeSession, tellRelay, type Relay } from '../platform/relay';

type Phase =
  | { name: 'start' }
  | { name: 'checking' }
  | { name: 'login' }
  | { name: 'choose'; choices: BbCourseChoice[] }
  | { name: 'importing' }
  | { name: 'done'; summary: BbApplySummary }
  /** Website: connected with the calendar link. */
  | { name: 'calendar-done'; summary: CalendarSummary }
  | { name: 'error'; message: string };

const STEPS: { key: SyncProgress['step']; label: string }[] = [
  { key: 'session', label: 'Blackboard session' },
  { key: 'courses', label: 'Your courses' },
  { key: 'gradebook', label: 'Deadlines and grades' },
  { key: 'calendar', label: 'Class calendar' },
  { key: 'syllabus', label: 'Syllabus weights' },
];

function termLabel(choice: BbCourseChoice): string {
  const t = parseTerm(choice.term);
  if (!t.academicYear) return choice.term?.name ?? '';
  const y = 2000 + Number(t.academicYear.slice(0, 2));
  const when = t.half === 'S1' ? `Fall ${y}` : t.half === 'S2' ? `Spring ${y + 1}` : `${t.academicYear.replace('/', '–')} (full year)`;
  return t.program ? `${when} · ${t.program}` : when;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Connect Blackboard and choose the courses to follow. In the extension it reads Blackboard
 * directly; on the website, through the extension if installed, or else through the
 * "Sync Student Dashboard" bookmark clicked on a Blackboard tab.
 */
export function BlackboardConnect({
  onDone,
  onSkip,
  skipLabel = 'Skip for now',
  inWizard = false,
}: {
  onDone: (summary: BbApplySummary | null) => void;
  onSkip?: () => void;
  skipLabel?: string;
  /** Part of the setup wizard (a hand-over to the extension resumes it there). */
  inWizard?: boolean;
}) {
  const { data, getData, update } = useStore();
  const { applyFetched } = useSync();
  const confirm = useConfirm();
  const [showSetup, setShowSetup] = useState(false);
  const [backend, setBackend] = useState<Backend | null>(null);
  const isIe = data.settings.university === 'ie';
  const [hostInput, setHostInput] = useState(data.blackboard.host ?? (isIe ? IE_BLACKBOARD_HOST : ''));
  const [host, setHost] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'start' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOthers, setShowOthers] = useState(false);
  const [syllabus, setSyllabus] = useState(data.blackboard.syllabus);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set());
  const polling = useRef<number | null>(null);
  /** Website with a freshly installed extension: move there, or keep using the website. */
  const [stayOnWebsite, setStayOnWebsite] = useState(false);
  const [handoff, setHandoff] = useState<{ state: 'idle' | 'sending' | 'done' } | { state: 'error'; message: string }>({ state: 'idle' });
  /** Website without the extension: Blackboard is read through the bookmark's tab. */
  const viaBookmark = backend === 'none';
  const hostInputRef = useRef(hostInput);
  hostInputRef.current = hostInput;
  /** Website: the calendar link comes first; the bookmark (grades too) is folded away. */
  const website = !IS_EXTENSION;
  const [advanced, setAdvanced] = useState(() => !website || !!data.blackboard.host);
  useEffect(() => {
    if (phase.name !== 'start' && phase.name !== 'calendar-done') setAdvanced(true);
  }, [phase.name]);
  const startish = phase.name === 'start' || phase.name === 'error';

  useEffect(() => {
    void detectBackend().then(setBackend);
  }, []);

  const stopPolling = () => {
    if (polling.current) window.clearInterval(polling.current);
    polling.current = null;
  };
  useEffect(() => stopPolling, []);

  const loadCourses = useCallback(
    async (h: string) => {
      const choices = await listCourses(h);
      const excluded = new Set(getData().blackboard.excludedCourses);
      const ticked = new Set(choices.filter((c) => c.current && !excluded.has(c.course.id)).map((c) => c.course.id));
      setSelected(ticked);
      setPhase({ name: 'choose', choices });
      return { choices, ticked };
    },
    [getData],
  );

  const check = useCallback(
    async (h: string, quiet = false) => {
      if (!quiet) setPhase({ name: 'checking' });
      try {
        await checkLogin(h);
        stopPolling();
        await loadCourses(h);
      } catch (err) {
        if (err instanceof BlackboardError && err.code === 'auth') {
          if (!quiet) setPhase({ name: 'login' });
          return;
        }
        stopPolling();
        setPhase({ name: 'error', message: message(err) });
      }
    },
    [loadCourses],
  );

  const start = async () => {
    const h = normalizeHost(hostInput);
    if (!h) {
      setPhase({ name: 'error', message: 'Enter the address of your Blackboard, e.g. https://yourschool.blackboard.com' });
      return;
    }
    // Ask the browser for access first, while we still have the click (other sites only).
    if (!(await requestAccess(h))) {
      setPhase({ name: 'error', message: 'Access to this Blackboard site was not allowed. Click Connect again and choose “Allow”.' });
      return;
    }
    setHost(h);
    await check(h);
  };

  // While waiting for the student to log in, check every few seconds.
  useEffect(() => {
    if (phase.name !== 'login' || !host) return;
    polling.current = window.setInterval(() => void check(host, true), 3000);
    return stopPolling;
  }, [phase.name, host, check]);

  const runImport = async (choices: BbCourseChoice[], ticked: Set<string> = selected, h: string | null = host) => {
    if (!h) return;
    setPhase({ name: 'importing' });
    setDoneSteps(new Set());
    const withSyllabus = syllabus && !!syllabusPlacement(h) && !viaBookmark;
    try {
      const snapshot = await readSnapshot(h, {
        courseIds: [...ticked],
        syllabus: withSyllabus,
        onProgress: (p) => {
          setProgress(p);
          setDoneSteps((prev) => {
            const next = new Set(prev);
            for (const s of STEPS) {
              if (s.key === p.step) break;
              next.add(s.key);
            }
            if (p.step === 'done') STEPS.forEach((s) => next.add(s.key));
            return next;
          });
          if (viaBookmark && p.step !== 'done') tellRelay(`Student Dashboard: ${p.label}…`);
        },
      });
      const current = getData();
      if (current.courses.length || current.items.length) await api.createBackup('pre-import');
      const summary = applyFetched(snapshot);
      update((d) => {
        d.blackboard.host = h;
        if (!viaBookmark) d.blackboard.syllabus = syllabus;
        // Courses of this year the student left unticked are not synced later either.
        d.blackboard.excludedCourses = choices.filter((c) => c.current && !ticked.has(c.course.id)).map((c) => c.course.id);
      });
      setPhase({ name: 'done', summary });
      if (viaBookmark) {
        const text = describeSummary(summary);
        tellRelay(`✓ Blackboard connected${text ? `: ${text}` : ''}. You can close this tab and go back to Student Dashboard.`);
      }
    } catch (err) {
      const text = err instanceof BlackboardError && err.code === 'auth' ? 'Your Blackboard session ended. Log in again and retry.' : message(err);
      setPhase({ name: 'error', message: text });
      if (viaBookmark) tellRelay(`Student Dashboard could not sync: ${text}`);
    }
  };

  // Bookmark clicked on a Blackboard tab: connect through it.
  const fromBookmark = useRef<(relay: Relay) => Promise<void>>(async () => {});
  fromBookmark.current = async (relay: Relay) => {
    const wanted = normalizeHost(hostInputRef.current);
    if (wanted && wanted !== relay.origin) {
      const text = `The bookmark was clicked on ${relay.origin}, which is not ${isIe ? 'IE’s Blackboard' : 'the Blackboard entered here'} (${wanted}).`;
      setPhase({ name: 'error', message: text });
      tellRelay(`${text} Open your Blackboard and click the bookmark there.`);
      return;
    }
    // A Blackboard never entered here: make sure it is the student's own.
    if (!wanted) {
      tellRelay('Confirm in Student Dashboard to connect this Blackboard.');
      const ok = await confirm({
        title: 'Connect this Blackboard?',
        message: `The bookmark was clicked on ${relay.origin}. Connect Student Dashboard to this Blackboard?`,
        confirmLabel: 'Connect',
      });
      if (!ok) {
        tellRelay('Not connected.');
        return;
      }
    }
    const h = relay.origin;
    setHostInput(h);
    setHost(h);
    setPhase({ name: 'checking' });
    tellRelay('Connected — reading your Blackboard…');
    try {
      await checkLogin(h);
      const { choices, ticked } = await loadCourses(h);
      if (!getData().blackboard.host) {
        // First connection: this year's courses, right away (they can be changed in Settings).
        await runImport(choices, ticked, h);
      } else {
        tellRelay('Connected. Go back to Student Dashboard to choose your courses.');
      }
    } catch (err) {
      const auth = err instanceof BlackboardError && err.code === 'auth';
      const text = auth ? 'That Blackboard tab is not logged in. Log in there, then click the bookmark again.' : message(err);
      setPhase({ name: 'error', message: text });
      tellRelay(auth ? 'Log in to Blackboard, then click the bookmark again.' : `Student Dashboard could not connect: ${text}`);
    }
  };
  useEffect(() => {
    if (backend !== 'none') return;
    const release = claimRelay();
    const handle = (relay: Relay) => {
      if (takeSession(relay)) void fromBookmark.current(relay);
    };
    // A Blackboard tab already linked (e.g. this page was opened by the bookmark, or it is still
    // open from the last sync) is used right away; later clicks on the bookmark too.
    const linked = currentRelay();
    if (linked) {
      takeSession(linked);
      void fromBookmark.current(linked);
    }
    const off = onRelay(handle);
    return () => {
      off();
      release();
    };
  }, [backend]);

  const ie = useMemo(() => normalizeHost(hostInput) === IE_BLACKBOARD_HOST, [hostInput]);

  if (backend === null) {
    return (
      <div className="bb-connect">
        <Loader2 className="spin muted" size={18} />
      </div>
    );
  }

  // (Once handed over, the extension counts as set up: keep showing the outcome here.)
  if (backend === 'bridge' && !IS_EXTENSION && !stayOnWebsite && (handoff.state !== 'idle' || extensionInfo()?.setUp === false)) {
    const bringsData = data.courses.length > 0 || data.items.length > 0;
    const send = async () => {
      setHandoff({ state: 'sending' });
      try {
        await handOffToExtension(getData(), inWizard ? 'blackboard' : 'connect');
        setHandoff({ state: 'done' });
      } catch (err) {
        setHandoff({ state: 'error', message: message(err) });
      }
    };
    return (
      <div className="bb-connect" data-testid="bb-handoff">
        <div className="bb-panel is-success">
          <CheckCircle2 size={22} />
          <div>
            <strong>The extension is installed</strong>
            <p className="muted small">
              Continue in the extension: it syncs Blackboard in the background and reminds you even when this page is closed.
              {bringsData ? ' Your transcript, courses and settings come along.' : ' Your settings come along.'}
            </p>
          </div>
        </div>
        {handoff.state === 'done' ? (
          <p className="bb-handoff-done small" data-testid="bb-handoff-done">
            <CheckCircle2 size={15} /> Your dashboard opened in the extension. You can close this tab.
          </p>
        ) : (
          <>
            {handoff.state === 'error' && (
              <p className="form-error" role="alert">
                <AlertCircle size={15} /> {handoff.message}
              </p>
            )}
            <div className="tx-actions">
              <Button variant="ghost" onClick={() => setStayOnWebsite(true)} data-testid="bb-stay-web">
                Stay on the website
              </Button>
              <Button variant="primary" disabled={handoff.state === 'sending'} onClick={() => void send()} data-testid="bb-handoff-go">
                Continue in the extension
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  const reads = website ? (
    <ul className="bb-reads">
      <li>
        <Check size={14} /> Everything from the calendar link, plus your published grades
      </li>
      <li>
        <Check size={14} /> Your courses with professors, and class sessions with rooms
      </li>
    </ul>
  ) : (
    <ul className="bb-reads">
      <li>
        <Check size={14} /> Your courses, professors and class sessions (with rooms)
      </li>
      <li>
        <Check size={14} /> Deadlines, exams and published grades
      </li>
      {ie && !viaBookmark && (
        <li>
          <Check size={14} /> Grade weights from your syllabi
        </li>
      )}
    </ul>
  );

  return (
    <div className="bb-connect" data-testid="bb-connect">
      {website && startish && (
        <>
          {data.blackboard.calendarUrl ? (
            <div className="bb-panel is-success" data-testid="cal-connected">
              <CheckCircle2 size={22} />
              <div>
                <strong>Your Blackboard calendar is connected</strong>
                <p className="muted small">Deadlines and class times update by themselves. Below, you can also import your grades.</p>
              </div>
            </div>
          ) : (
            <CalendarLinkConnect onConnected={(summary) => setPhase({ name: 'calendar-done', summary })} />
          )}
          <button type="button" className="bb-advanced-toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} data-testid="bb-advanced">
            <ChevronDown size={16} className={advanced ? 'is-open' : ''} />
            <span>
              <strong>Also import your grades, professors and rooms</strong>
              <span className="muted small"> — advanced, with a bookmark in your browser</span>
            </span>
          </button>
        </>
      )}

      {viaBookmark && startish && advanced && (
        <div className="bm-connect" data-testid="bb-bookmark">
          {!isIe && (
            <label className="field">
              <span className="field-label">Blackboard address</span>
              <input className="input" value={hostInput} onChange={(e) => setHostInput(e.target.value)} placeholder="https://yourschool.blackboard.com" spellCheck={false} autoComplete="url" data-testid="bb-host" />
            </label>
          )}
          {reads}
          <ol className="bm-flow">
            {data.blackboard.host && !showSetup ? (
              <li>
                <strong>Your sync bookmark</strong>{' '}
                <button type="button" className="link-button" onClick={() => setShowSetup(true)}>
                  Not on this browser yet?
                </button>
              </li>
            ) : (
              <li>
                <strong>Add the sync bookmark</strong> <span className="muted small">— once</span>
                <BookmarkSetup />
              </li>
            )}
            <li>
              <strong>Open Blackboard and click the bookmark there</strong>
              <p className="muted small">Log in if Blackboard asks. This page continues by itself — come back here afterwards.</p>
              <div className="bm-open">
                <Button
                  variant="primary"
                  icon={<ExternalLink size={15} />}
                  onClick={() => {
                    const h = normalizeHost(hostInput);
                    if (h) openBlackboardTab(h);
                    else setPhase({ name: 'error', message: 'Enter the address of your Blackboard, e.g. https://yourschool.blackboard.com' });
                  }}
                  data-testid="bb-open"
                >
                  Open Blackboard
                </Button>
                <span className="bm-waiting muted small">
                  <Loader2 size={14} className="spin" /> Waiting for the bookmark…
                </span>
              </div>
            </li>
          </ol>
          <p className="muted small bb-note">
            <ShieldCheck size={13} /> The bookmark uses the Blackboard session already open in your browser — no password is asked or stored — and only sends what it reads to this page. Read-only: nothing is ever changed on Blackboard.
          </p>
          {ie && <p className="muted small">Grade weights are not in the data Blackboard shares: copy them from each syllabus into the course page’s Grade breakdown.</p>}
          {phase.name === 'error' && (
            <p className="form-error" role="alert" data-testid="bb-error">
              <AlertCircle size={15} /> {phase.message}
            </p>
          )}
          {onSkip && !website && (
            <div className="tx-actions">
              <Button variant="ghost" onClick={onSkip}>
                {skipLabel}
              </Button>
            </div>
          )}
        </div>
      )}

      {!viaBookmark && startish && advanced && (
        <>
          <label className="field">
            <span className="field-label">Blackboard address</span>
            <input className="input" value={hostInput} onChange={(e) => setHostInput(e.target.value)} placeholder="https://yourschool.blackboard.com" spellCheck={false} autoComplete="url" data-testid="bb-host" />
          </label>
          {reads}
          <p className="muted small bb-note">
            <ShieldCheck size={13} /> Uses the Blackboard session already open in this browser — no password is asked or stored. Read-only: nothing is ever changed on Blackboard.
          </p>
          {phase.name === 'error' && (
            <p className="form-error" role="alert" data-testid="bb-error">
              <AlertCircle size={15} /> {phase.message}
            </p>
          )}
          <div className="tx-actions">
            {onSkip && !website && (
              <Button variant="ghost" onClick={onSkip}>
                {skipLabel}
              </Button>
            )}
            <Button variant="primary" onClick={() => void start()} data-testid="bb-start">
              Connect Blackboard
            </Button>
          </div>
        </>
      )}

      {website && startish && onSkip && (
        <div className="tx-actions">
          <Button variant="ghost" onClick={onSkip}>
            {skipLabel}
          </Button>
        </div>
      )}

      {phase.name === 'calendar-done' && (
        <div className="bb-done" data-testid="cal-done">
          <div className="bb-panel is-success">
            <CheckCircle2 size={22} />
            <div>
              <strong>Blackboard calendar connected</strong>
              <p className="muted small">{describeCalendar(phase.summary) || 'Connected — nothing coming up yet.'}</p>
              <p className="muted small">It updates by itself each time you open Student Dashboard.</p>
            </div>
          </div>
          <div className="tx-actions">
            <Button variant="primary" onClick={() => onDone(null)} data-testid="cal-continue">
              Continue
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'checking' && (
        <div className="bb-status">
          <Loader2 size={18} className="spin" /> Checking your Blackboard session…
        </div>
      )}

      {phase.name === 'login' && host && (
        <div className="bb-login" data-testid="bb-login">
          <div className="bb-panel">
            <LogIn size={22} />
            <div>
              <strong>Log in to Blackboard</strong>
              <p className="muted small">Open Blackboard in a new tab and sign in as usual. This page continues by itself as soon as you are logged in.</p>
            </div>
          </div>
          <div className="bb-waiting muted small">
            <Loader2 size={14} className="spin" /> Waiting for you to log in…
          </div>
          <div className="tx-actions">
            <Button variant="ghost" onClick={() => void check(host)}>
              I’m logged in
            </Button>
            <Button variant="primary" icon={<ExternalLink size={15} />} onClick={() => void openLogin(host)} data-testid="bb-open-login">
              Open Blackboard
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'choose' && (
        <div className="bb-choose" data-testid="bb-choose">
          <p className="muted small">Choose the courses to follow. This year’s courses are ticked.</p>
          <div className="bb-course-list">
            {phase.choices
              .filter((c) => c.current || showOthers)
              .map((c) => (
                <label key={c.course.id} className={`bb-course ${selected.has(c.course.id) ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.course.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.course.id);
                        else next.delete(c.course.id);
                        return next;
                      })
                    }
                    data-testid="bb-course"
                  />
                  <span className="bb-course-name">{cleanCourseName(c.course.name)}</span>
                  <span className="muted small">{termLabel(c)}</span>
                </label>
              ))}
            {phase.choices.length === 0 && <p className="muted small">No courses found on this Blackboard account.</p>}
          </div>
          {phase.choices.some((c) => !c.current) && (
            <div>
              <button type="button" className="link-button" onClick={() => setShowOthers((v) => !v)}>
                {showOthers ? 'Hide older courses' : `Show ${plural(phase.choices.filter((c) => !c.current).length, 'older course')}`}
              </button>
            </div>
          )}
          {host && syllabusPlacement(host) && !viaBookmark && (
            <label className="check-row bb-syllabus">
              <input type="checkbox" checked={syllabus} onChange={(e) => setSyllabus(e.target.checked)} data-testid="bb-syllabus" />
              <span>
                Read grade weights from the syllabi
                <span className="muted small"> — a small window opens for about a minute, then closes</span>
              </span>
            </label>
          )}
          {viaBookmark && <p className="muted small">Keep the Blackboard tab open until the import is finished.</p>}
          <div className="tx-actions">
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                {skipLabel}
              </Button>
            )}
            <Button variant="primary" disabled={selected.size === 0} onClick={() => void runImport(phase.choices)} data-testid="bb-import">
              Import {plural(selected.size, 'course')}
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'importing' && (
        <div className="bb-progress" data-testid="bb-progress">
          {STEPS.filter((s) => s.key !== 'syllabus' || (syllabus && host && syllabusPlacement(host) && !viaBookmark)).map((s) => {
            const active = progress?.step === s.key;
            const done = doneSteps.has(s.key);
            return (
              <div key={s.key} className={`bb-step ${done ? 'is-done' : active ? 'is-active' : ''}`}>
                <span className="bb-step-icon">{done ? <CheckCircle2 size={16} /> : active ? <Loader2 size={16} className="spin" /> : <span className="bb-step-dot" />}</span>
                <span>{active && progress ? progress.label : s.label}</span>
                {active && progress && progress.total > 1 && (
                  <span className="bb-step-bar">
                    <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {phase.name === 'done' && (
        <div className="bb-done" data-testid="bb-done">
          <div className="bb-panel is-success">
            <CheckCircle2 size={22} />
            <div>
              <strong>Blackboard connected</strong>
              <p className="muted small">{describeSummary(phase.summary) || 'Everything is up to date.'}</p>
              {phase.summary.partial.length > 0 && <p className="small text-warning">Partly read: {phase.summary.partial.join(', ')}.</p>}
              {viaBookmark && <p className="muted small">Next time, just click the bookmark on Blackboard to sync.</p>}
            </div>
          </div>
          <div className="tx-actions">
            <Button variant="primary" onClick={() => onDone(phase.summary)} data-testid="bb-continue">
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
