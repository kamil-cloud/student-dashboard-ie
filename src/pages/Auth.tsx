/** /signup and /login: email and password accounts (Supabase Auth). */
import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '../components/ui';
import { goTo } from '../lib/paths';
import { authMessage, supabase } from '../platform/supabase';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <a className="auth-brand" href="/" onClick={(e) => (e.preventDefault(), goTo('landing'))}>
        <span className="brand-mark">
          <GraduationCap size={18} strokeWidth={2.2} />
        </span>
        Student Dashboard
      </a>
      <main className="card auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </main>
    </div>
  );
}

function useAuthForm(run: (email: string, password: string) => Promise<string | null>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const err = await run(email.trim(), password);
      if (err) setError(err);
    } catch (err) {
      setError(authMessage(err as { message?: string }));
    } finally {
      setBusy(false);
    }
  };
  return { email, setEmail, password, setPassword, error, busy, onSubmit };
}

function ErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="auth-error" role="alert" data-testid="auth-error">
      <AlertCircle size={15} /> {text}
    </p>
  );
}

export function SignupPage() {
  const f = useAuthForm(async (email, password) => {
    const { data, error } = await supabase().auth.signUp({ email, password });
    if (error) return authMessage(error);
    if (!data.session) return 'Your account was created, but it needs an email confirmation before you can log in.';
    goTo('app', { replace: true, hash: '' });
    return null;
  });
  return (
    <AuthShell title="Create your account" subtitle="Free, takes 10 seconds. Your dashboard is private to you.">
      <form className="auth-form" onSubmit={f.onSubmit} noValidate>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input input-lg" type="email" autoComplete="email" required value={f.email} onChange={(e) => f.setEmail(e.target.value)} data-testid="signup-email" />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input input-lg" type="password" autoComplete="new-password" required minLength={6} value={f.password} onChange={(e) => f.setPassword(e.target.value)} placeholder="At least 6 characters" data-testid="signup-password" />
        </label>
        <ErrorLine text={f.error} />
        <Button variant="primary" size="lg" type="submit" className="auth-submit" disabled={f.busy} icon={f.busy ? <Loader2 size={16} className="spin" /> : undefined} data-testid="signup-submit">
          Sign up
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account?{' '}
        <a href="/login" onClick={(e) => (e.preventDefault(), goTo('login'))}>
          Log in
        </a>
      </p>
    </AuthShell>
  );
}

export function LoginPage() {
  const f = useAuthForm(async (email, password) => {
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) return authMessage(error);
    goTo('app', { replace: true });
    return null;
  });
  return (
    <AuthShell title="Log in" subtitle="Welcome back to your dashboard.">
      <form className="auth-form" onSubmit={f.onSubmit} noValidate>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input input-lg" type="email" autoComplete="email" required value={f.email} onChange={(e) => f.setEmail(e.target.value)} data-testid="login-email" />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input input-lg" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => f.setPassword(e.target.value)} data-testid="login-password" />
        </label>
        <ErrorLine text={f.error} />
        <Button variant="primary" size="lg" type="submit" className="auth-submit" disabled={f.busy} icon={f.busy ? <Loader2 size={16} className="spin" /> : undefined} data-testid="login-submit">
          Log in
        </Button>
      </form>
      <p className="auth-switch">
        New here?{' '}
        <a href="/signup" onClick={(e) => (e.preventDefault(), goTo('signup'))}>
          Create an account
        </a>
      </p>
    </AuthShell>
  );
}
