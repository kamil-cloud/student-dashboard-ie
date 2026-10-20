/**
 * Public landing page (/): what it is, who it is for and one button to sign up, readable in a
 * few seconds. The preview uses invented example data.
 */
import { ArrowRight, BellRing, CalendarClock, GraduationCap, Lock, LogOut, RefreshCw } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Button } from '../components/ui';
import { goTo } from '../lib/paths';

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
          <h1>Every Blackboard deadline in one list.</h1>
          <p className="landing-sub">
            Student Dashboard collects your assignments, exams and classes from Blackboard, reminds you before each one and tracks your grades — so you never miss a
            submission.
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

        <section className="landing-preview card" aria-label="Example of the deadline list (invented data)">
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
            <h2>All in one place</h2>
            <p>Add a deadline in two seconds, or import every course, class and deadline from Blackboard in one click.</p>
          </div>
          <div>
            <BellRing size={20} />
            <h2>Reminded in time</h2>
            <p>A reminder before each deadline, and a calendar you can add to your phone.</p>
          </div>
          <div>
            <RefreshCw size={20} />
            <h2>On every device</h2>
            <p>Log in from your laptop or phone: your dashboard is the same everywhere.</p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">Independent student project · not affiliated with IE University or Blackboard</footer>
    </div>
  );
}
