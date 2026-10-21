/**
 * Public landing page (/): what it is, who it is for and one button to sign up, readable in a
 * few seconds. The preview uses invented example data.
 */
import { Award, ArrowRight, BellRing, CalendarClock, GraduationCap, Lock, LogOut } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Button } from '../components/ui';
import { goTo } from '../lib/paths';

const STATS = [
  { label: 'Due this week', value: '3' },
  { label: 'GPA', value: '8.6', unit: '/ 10' },
  { label: 'Next class', value: '10:00', unit: 'Finance' },
];

const PREVIEW = [
  { title: 'Marketing Management · Case study', course: 'Marketing', due: 'Today, 23:59', tone: 'soon' },
  { title: 'Corporate Finance · Midterm exam', course: 'Finance', due: 'Thu, 10:00', tone: 'normal' },
  { title: 'Business Analytics · Group project', course: 'Analytics', due: 'Next Mon', tone: '' },
  { title: 'Organizational Behavior · Reflection', course: 'OB', due: 'Next Wed', tone: '' },
];

export function Landing({ signedIn, onLogout }: { signedIn: boolean; onLogout: () => void }) {
  const link = (page: 'signup' | 'login' | 'app') => (e: MouseEvent) => {
    e.preventDefault();
    goTo(page);
  };
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-brand">
          <span className="brand-mark">
            <GraduationCap size={18} strokeWidth={2.2} />
          </span>
          Student Dashboard
        </span>
        <nav className="landing-nav-links">
          {signedIn ? (
            <>
              <a href="/app" onClick={link('app')} className="landing-link">
                Open my dashboard
              </a>
              <Button variant="ghost" size="sm" icon={<LogOut size={15} />} onClick={onLogout} data-testid="logout">
                Log out
              </Button>
            </>
          ) : (
            <a href="/login" onClick={link('login')} className="landing-link">
              Log in
            </a>
          )}
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <p className="landing-kicker">For IE University students</p>
          <h1>Your deadlines, classes and grades in one place.</h1>
          <p className="landing-sub">
            Student Dashboard brings together your Blackboard assignments and exams, your class schedule, your grades and your GPA — calculated like IE does — and
            reminds you before every deadline, so you never miss a submission.
          </p>
          <div className="landing-cta">
            {signedIn ? (
              <a href="/app" onClick={link('app')} className="btn btn-primary btn-lg">
                <span className="btn-label">Open my dashboard</span>
                <span className="btn-icon">
                  <ArrowRight size={18} />
                </span>
              </a>
            ) : (
              <a href="/signup" onClick={link('signup')} className="btn btn-primary btn-lg" data-testid="landing-signup">
                <span className="btn-label">Sign up free</span>
                <span className="btn-icon">
                  <ArrowRight size={18} />
                </span>
              </a>
            )}
            <span className="landing-note">
              <Lock size={13} /> Free · email and password · your data is private to you
            </span>
          </div>
        </section>

        <section className="landing-preview card" aria-label="Example of a dashboard (invented data)">
          <div className="landing-stats">
            {STATS.map((t) => (
              <div key={t.label} className="landing-stat">
                <span className="muted small">{t.label}</span>
                <span className="landing-stat-value">
                  {t.value}
                  {t.unit && <span className="muted small"> {t.unit}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="landing-preview-head">
            <span>Your deadlines</span>
            <span className="muted small">4 to do</span>
          </div>
          {PREVIEW.map((p) => (
            <div key={p.title} className="landing-preview-row">
              <span className="item-check" aria-hidden />
              <span className="landing-preview-title">
                {p.title}
                <span className="muted small">{p.course}</span>
              </span>
              <span className={`due due-${p.tone || 'normal'}`}>{p.due}</span>
            </div>
          ))}
        </section>

        <section className="landing-points">
          <div>
            <CalendarClock size={20} />
            <h2>Deadlines and classes</h2>
            <p>Add a deadline in two seconds, or import every course, class and deadline from Blackboard in one click.</p>
          </div>
          <div>
            <Award size={20} />
            <h2>Grades and GPA</h2>
            <p>Import your transcript: your GPA calculated like IE does, and the grade you need on the rest of each course.</p>
          </div>
          <div>
            <BellRing size={20} />
            <h2>Reminders, on every device</h2>
            <p>A reminder before each deadline, and the same dashboard on your laptop and your phone.</p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">Independent student project · not affiliated with IE University or Blackboard</footer>
    </div>
  );
}
