import { useEffect, useState } from 'react';
import { ArrowLeft, BellRing, BookOpenCheck, CalendarClock, FileText, GraduationCap, Lock, Plug, RotateCcw, Sparkles } from 'lucide-react';
import { BlackboardConnect } from '../components/BlackboardConnect';
import { SafariStorageTip, askToKeepData } from '../components/StorageTip';
import { TranscriptImport } from '../components/TranscriptImport';
import { Button, Segmented, Switch } from '../components/ui';
import { useBackup } from '../lib/backup';
import { universityPreset } from '../lib/defaults';
import { plural } from '../lib/format';
import { GPA_LABEL, SCALE_LABEL } from '../lib/grades';
import { REMINDER_LABEL } from '../lib/schedule';
import { handoffState, useStore } from '../lib/store';
import type { AppData, GpaScale, GradeScale, ReminderOffset, University } from '../lib/types';
import { IS_EXTENSION } from '../platform/env';
import { OPENED_BY_BOOKMARK } from '../platform/relay';

type Step = 'welcome' | 'you' | 'transcript' | 'blackboard' | 'reminders' | 'done';

/** Where the setup wizard starts, or null when the dashboard is already set up. */
export function wizardStart(data: AppData): 'welcome' | 'blackboard' | null {
  if (data.profile.onboardedAt) return null;
  const empty = data.courses.length === 0 && data.items.length === 0;
  // Mid-setup: handed over by the website, or reopened by the Blackboard bookmark.
  if (handoffState.resume === 'blackboard' || (OPENED_BY_BOOKMARK && !empty)) return 'blackboard';
  return empty ? 'welcome' : null;
}

function StepDots({ steps, current }: { steps: Step[]; current: Step }) {
  const i = steps.indexOf(current);
  return (
    <div className="wz-dots" aria-label={`Step ${i + 1} of ${steps.length}`}>
      {steps.map((s, j) => (
        <span key={s} className={`wz-dot ${j < i ? 'is-done' : j === i ? 'is-current' : ''}`} />
      ))}
    </div>
  );
}

export function Welcome({ startAt = 'welcome' }: { startAt?: 'welcome' | 'blackboard' }) {
  const { data, update } = useStore();
  const backup = useBackup();
  const resumed = startAt === 'blackboard';
  const [step, setStep] = useState<Step>(startAt);
  /** The university must be picked explicitly (the default preset is generic). */
  const [picked, setPicked] = useState(resumed);
  const [history, setHistory] = useState<Step[]>(() => (resumed ? ['welcome', 'you', ...(data.settings.university === 'ie' ? (['transcript'] as Step[]) : [])] : []));
  const s = data.settings;
  const ie = s.university === 'ie';
  const steps: Step[] = ['welcome', 'you', ...(ie ? (['transcript'] as Step[]) : []), 'blackboard', 'reminders', 'done'];

  const go = (next: Step) => {
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const back = () => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) setStep(prev);
      return h.slice(0, -1);
    });
  };
  const after = (current: Step): Step => steps[steps.indexOf(current) + 1] ?? 'done';

  const finish = () => {
    askToKeepData();
    update((d) => {
      d.profile.onboardedAt = new Date().toISOString();
    });
  };

  // A backup restored from the first screen completes the setup.
  useEffect(() => {
    if (step === 'welcome' && (data.courses.length > 0 || data.items.length > 0) && history.length === 0 && backup.version > 0) finish();
  }, [backup.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickUniversity = (u: University) => {
    setPicked(true);
    update((d) => {
      Object.assign(d.settings, universityPreset(u));
      d.profile.universityChosen = true;
    });
  };

  const courses = data.courses.length;
  const tasks = data.items.filter((i) => i.kind !== 'participation').length;
  const sessions = data.courses.reduce((t, c) => t + c.sessions.length, 0);

  return (
    <div className="wz" data-testid="welcome">
      <div className="wz-card">
        <div className="wz-top">
          {history.length > 0 && step !== 'done' ? (
            <button type="button" className="wz-back" onClick={back} aria-label="Back">
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <span />
          )}
          <StepDots steps={steps} current={step} />
        </div>

        {step === 'welcome' && (
          <div className="wz-body wz-hero">
            <div className="brand-mark brand-mark-lg">
              <GraduationCap size={30} strokeWidth={2.2} />
            </div>
            <h1>Your semester, organised</h1>
            <p className="wz-lead">Courses, deadlines, classes, grades and GPA in one calm place — filled in for you.</p>
            <ul className="wz-features">
              <li>
                <CalendarClock size={18} />
                <span>
                  <strong>{IS_EXTENSION ? 'Deadlines and classes from Blackboard' : 'Deadlines, classes and grades from Blackboard'}</strong>
                  <span className="muted">{IS_EXTENSION ? 'kept up to date automatically' : 'synced in one click, in any browser'}</span>
                </span>
              </li>
              <li>
                <FileText size={18} />
                <span>
                  <strong>Grades and GPA from your transcript</strong>
                  <span className="muted">plus what you need on the rest of each course</span>
                </span>
              </li>
              <li>
                <BellRing size={18} />
                <span>
                  <strong>Reminders before every deadline</strong>
                  <span className="muted">so nothing slips</span>
                </span>
              </li>
            </ul>
            <p className="wz-privacy">
              <Lock size={13} />{' '}
              {IS_EXTENSION ? 'Everything stays in this browser. No account, no server — nobody else sees your grades.' : 'Saved privately to your account — only you can see your grades.'}
            </p>
            <div className="wz-actions">
              <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={() => void backup.startImport()} data-testid="wz-restore">
                Restore a backup
              </Button>
              <Button variant="primary" size="lg" onClick={() => go('you')} data-testid="wz-start">
                Get started
              </Button>
            </div>
          </div>
        )}

        {step === 'you' && (
          <div className="wz-body">
            <h2>About you</h2>
            <label className="field">
              <span className="field-label">First name (optional)</span>
              <input className="input" value={data.profile.firstName} maxLength={40} onChange={(e) => update((d) => void (d.profile.firstName = e.target.value))} placeholder="For the greeting on your dashboard" data-testid="wz-name" />
            </label>
            <div className="field">
              <span className="field-label">University</span>
              <div className="wz-options" role="radiogroup" aria-label="University">
                {(
                  [
                    ['ie', 'IE University', 'Imports your transcript and IE Blackboard, with Spanish 0–10 grading and IE’s GPA rules.'],
                    ['other', 'Another university', 'Choose your grading scale. Connect Blackboard if your university uses it.'],
                  ] as [University, string, string][]
                ).map(([value, title, desc]) => (
                  <label key={value} className={`wz-option ${picked && s.university === value ? 'is-active' : ''}`} data-testid={`wz-uni-${value}`}>
                    <input type="radio" name="university" checked={picked && s.university === value} onChange={() => pickUniversity(value)} />
                    <span className="wz-option-title">{title}</span>
                    <span className="wz-option-desc">{desc}</span>
                  </label>
                ))}
              </div>
            </div>
            {picked && !ie && (
              <div className="wz-grid">
                <div className="field">
                  <span className="field-label">Grades are out of</span>
                  <Segmented<GradeScale> label="Grade scale" value={s.gradeScale} onChange={(v) => update((d) => void (d.settings.gradeScale = v))} options={(['ten', 'twenty', 'hundred'] as GradeScale[]).map((v) => ({ value: v, label: SCALE_LABEL[v] }))} />
                </div>
                <label className="field">
                  <span className="field-label">GPA</span>
                  <select className="input select" value={s.gpaScale} onChange={(e) => update((d) => void (d.settings.gpaScale = e.target.value as GpaScale))}>
                    {(['four', 'ten', 'twenty', 'hundred'] as GpaScale[]).map((v) => (
                      <option key={v} value={v}>
                        {GPA_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span className="field-label">Credits are called</span>
                  <Segmented<'ECTS' | 'credits'> label="Credit unit" value={s.creditUnit} onChange={(v) => update((d) => void (d.settings.creditUnit = v))} options={[{ value: 'ECTS', label: 'ECTS' }, { value: 'credits', label: 'Credits' }]} />
                </div>
              </div>
            )}
            <div className="wz-actions">
              <Button variant="primary" onClick={() => go(after('you'))} disabled={!picked} data-testid="wz-next">
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'transcript' && (
          <div className="wz-body">
            <h2>
              <BookOpenCheck size={20} /> Your transcript
            </h2>
            <p className="wz-lead small">Add your official transcript (Expediente Académico, PDF) to fill in every course and grade you already have — your GPA is calculated exactly like IE does.</p>
            <TranscriptImport onDone={() => go(after('transcript'))} onSkip={() => go(after('transcript'))} />
          </div>
        )}

        {step === 'blackboard' && (
          <div className="wz-body">
            <h2>
              <Plug size={20} /> Connect Blackboard
            </h2>
            <BlackboardConnect onDone={() => go(after('blackboard'))} onSkip={() => go(after('blackboard'))} skipLabel={ie ? 'Skip for now' : 'My university doesn’t use Blackboard'} inWizard />
          </div>
        )}

        {step === 'reminders' && (
          <div className="wz-body">
            <h2>
              <BellRing size={20} /> Reminders and safety
            </h2>
            <div className="setting-row">
              <div className="setting-text">
                <span className="setting-label">Remind me</span>
                <span className="setting-desc">Before each deadline (you can change it per task).</span>
              </div>
              <select className="input select setting-select" value={s.defaultReminder} onChange={(e) => update((d) => void (d.settings.defaultReminder = e.target.value as ReminderOffset))} aria-label="Default reminder">
                {(Object.keys(REMINDER_LABEL) as ReminderOffset[]).map((r) => (
                  <option key={r} value={r}>
                    {REMINDER_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <Switch
              checked={s.systemNotifications}
              onChange={(v) => {
                update((d) => void (d.settings.systemNotifications = v));
                if (v && !IS_EXTENSION && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
              }}
              label="Desktop notifications"
              description={IS_EXTENSION ? 'Reminders and new grades, even when the dashboard is closed.' : 'Reminders while the dashboard is open.'}
            />
            {IS_EXTENSION && (
              <Switch
                checked={s.backupDownloads}
                onChange={(v) => update((d) => void (d.settings.backupDownloads = v))}
                label="Weekly backup file"
                description="Saves a copy of your data to Downloads › Student Dashboard backups once a week. Your data otherwise lives only in this browser."
              />
            )}
            <div className="wz-actions">
              <Button variant="primary" onClick={() => go('done')} data-testid="wz-next">
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="wz-body wz-hero">
            <div className="wz-done-icon">
              <Sparkles size={26} />
            </div>
            <h1>{data.profile.firstName ? `You’re all set, ${data.profile.firstName}` : 'You’re all set'}</h1>
            <p className="wz-lead">
              {courses
                ? `${plural(courses, 'course')}, ${plural(tasks, 'task')} and ${plural(sessions, 'class session')} are ready.`
                : 'Add your first course or task whenever you like.'}
            </p>
            {IS_EXTENSION && <SafariStorageTip />}
            <div className="wz-actions">
              <Button variant="primary" size="lg" onClick={finish} data-testid="wz-finish">
                Open my dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
      {step === 'welcome' && (
        <button type="button" className="wz-skip link-button" onClick={finish}>
          Skip setup
        </button>
      )}
      <p className="wz-disclaimer">Independent student project · not affiliated with IE University or Blackboard</p>
    </div>
  );
}
