/**
 * Website, right after signing up: "Start here" — the steps that fill the dashboard, at the top
 * of /app. Clearly the next thing to do, but never in the way (the grading contract allows no
 * mandatory onboarding): a deadline can be added straight away, and "Later" puts it off.
 *  1. the university, 2. the IE transcript (grades and GPA; IE only), 3. the Blackboard calendar
 *  link (deadlines and classes), then optionally the bookmark (Blackboard grades, professors, rooms).
 */
import { useState, type ReactNode } from 'react';
import { ArrowRight, Award, CalendarClock, Check, GraduationCap, Plug } from 'lucide-react';
import { BlackboardConnect } from './BlackboardConnect';
import { CalendarLinkConnect } from './CalendarLink';
import { TranscriptImport } from './TranscriptImport';
import { useToast } from './feedback';
import { Button, Modal } from './ui';
import { describeCalendar } from '../integrations/blackboard/calendarFeed';
import { universityPreset } from '../lib/defaults';
import { useStore } from '../lib/store';
import type { University } from '../lib/types';

type Open = 'transcript' | 'calendar' | 'bookmark' | null;

interface Step {
  key: 'university' | 'transcript' | 'calendar';
  done: boolean;
  icon: ReactNode;
  title: string;
  text: string;
  /** What is shown on the right: a button, or the university choice. */
  action: ReactNode;
  doneLabel?: string;
}

export function SetupCard() {
  const { data, update } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  if (data.profile.onboardedAt) return null;

  const chosen = data.profile.universityChosen;
  const ie = chosen && data.settings.university === 'ie';
  const pick = (u: University) =>
    update((d) => {
      Object.assign(d.settings, universityPreset(u));
      d.profile.universityChosen = true;
    });

  const steps: Step[] = [
    {
      key: 'university',
      done: chosen,
      icon: <GraduationCap size={18} />,
      title: 'Your university',
      text: 'It sets how grades and GPA are calculated, and what can be imported.',
      doneLabel: data.settings.university === 'ie' ? 'IE University' : 'Another university',
      action: (
        <div className="setup-choice">
          <Button variant="primary" size="sm" onClick={() => pick('ie')} data-testid="setup-uni-ie">
            IE University
          </Button>
          <Button variant="secondary" size="sm" onClick={() => pick('other')} data-testid="setup-uni-other">
            Another university
          </Button>
        </div>
      ),
    },
    ...(chosen && !ie
      ? []
      : [
          {
            key: 'transcript' as const,
            done: data.courses.some((c) => !!c.sources.transcript),
            icon: <Award size={18} />,
            title: 'Your grades and GPA',
            text: 'Add your IE transcript (PDF): every course and grade, and your GPA calculated like IE does.',
            action: null,
          },
        ]),
    {
      key: 'calendar',
      done: !!data.blackboard.calendarUrl,
      icon: <CalendarClock size={18} />,
      title: 'Your deadlines and classes',
      text: 'Paste your Blackboard calendar link once: every course’s deadlines and class times, kept up to date.',
      action: null,
    },
  ];
  const CTA: Record<'transcript' | 'calendar', string> = { transcript: 'Add transcript', calendar: 'Connect calendar' };
  const current = steps.find((s) => !s.done) ?? null;
  const doneCount = steps.filter((s) => s.done).length;
  const finish = (message?: string) => {
    update((d) => void (d.profile.onboardedAt = new Date().toISOString()));
    if (message) toast({ message, duration: 7000 });
  };

  return (
    <section className="card setup-card" data-testid="setup-card" aria-labelledby="setup-title">
      <div className="setup-head">
        <div className="setup-head-text">
          <span className="setup-kicker">{current ? `Start here · step ${steps.indexOf(current) + 1} of ${steps.length}` : 'All set'}</span>
          <h2 id="setup-title">{current ? 'Set up your dashboard — 2 minutes' : 'Your dashboard is set up'}</h2>
          <p className="muted small">
            {current ? 'Do it once: then your courses, grades and deadlines fill in by themselves.' : 'It now updates by itself. You can change all this in Settings › Connections.'}
          </p>
        </div>
        {current ? (
          <Button variant="ghost" size="sm" onClick={() => finish('No problem — it’s all in Settings › Connections whenever you want.')} data-testid="setup-later">
            I’ll do it later
          </Button>
        ) : (
          <Button variant="primary" onClick={() => finish()} data-testid="setup-done">
            Done
          </Button>
        )}
      </div>
      <div className="setup-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="setup-steps">
        {steps.map((s, i) => {
          const isCurrent = s === current;
          return (
            <li key={s.key} className={`setup-step ${s.done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`} data-testid={`setup-step-${s.key}`} aria-current={isCurrent ? 'step' : undefined}>
              <span className="setup-num">{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
              <span className="setup-text">
                <strong>
                  {s.icon} {s.title}
                  {isCurrent && <span className="setup-next">Next step</span>}
                </strong>
                <span className="muted small">{s.text}</span>
              </span>
              {s.done ? (
                <span className="setup-ok small">
                  <Check size={13} /> {s.doneLabel ?? 'Done'}
                </span>
              ) : s.action ? (
                isCurrent ? (
                  s.action
                ) : null
              ) : (
                <Button
                  variant={isCurrent ? 'primary' : 'secondary'}
                  size={isCurrent ? 'md' : 'sm'}
                  iconRight={isCurrent ? <ArrowRight size={15} /> : undefined}
                  disabled={!chosen}
                  onClick={() => setOpen(s.key as 'transcript' | 'calendar')}
                  data-testid={`setup-${s.key}`}
                >
                  {CTA[s.key as 'transcript' | 'calendar']}
                </Button>
              )}
            </li>
          );
        })}
        <li className={`setup-step is-optional ${data.blackboard.host ? 'is-done' : ''}`} data-testid="setup-step-bookmark">
          <span className="setup-num">{data.blackboard.host ? <Check size={14} strokeWidth={3} /> : <Plug size={13} />}</span>
          <span className="setup-text">
            <strong>Optional, to go further: grades straight from Blackboard</strong>
            <span className="muted small">A bookmark in your browser also brings published grades, professors and rooms.</span>
          </span>
          {data.blackboard.host ? (
            <span className="setup-ok small">
              <Check size={13} /> Done
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setOpen('bookmark')} data-testid="setup-bookmark">
              Set up
            </Button>
          )}
        </li>
      </ol>

      <Modal open={open === 'transcript'} onClose={() => setOpen(null)} title="Add your transcript" size="lg" closeOnBackdrop={false}>
        {open === 'transcript' && <TranscriptImport onDone={() => setOpen(null)} onSkip={() => setOpen(null)} skipLabel="Cancel" />}
      </Modal>
      <Modal open={open === 'calendar'} onClose={() => setOpen(null)} title="Connect your Blackboard calendar" size="lg" closeOnBackdrop={false}>
        {open === 'calendar' && (
          <CalendarLinkConnect
            onConnected={(summary) => {
              setOpen(null);
              const text = describeCalendar(summary);
              toast({ tone: 'success', message: `Blackboard calendar connected${text ? `: ${text}` : ''}.`, duration: 8000 });
            }}
          />
        )}
      </Modal>
      <Modal open={open === 'bookmark'} onClose={() => setOpen(null)} title="Grades from Blackboard" size="lg" closeOnBackdrop={false}>
        {open === 'bookmark' && <BlackboardConnect bookmarkOnly onDone={() => setOpen(null)} onSkip={() => setOpen(null)} skipLabel="Cancel" />}
      </Modal>
    </section>
  );
}
