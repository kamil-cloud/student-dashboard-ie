/**
 * The website's accounts and database (Supabase). Only the project URL and the publishable key
 * reach the browser; every table is protected by Row Level Security, so a signed-in student only
 * ever reads and writes their own rows.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

const URL_ = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const SUPABASE_CONFIGURED = /^https?:\/\/.+/.test(URL_) && KEY.length > 0;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!SUPABASE_CONFIGURED) throw new Error('Accounts are not set up on this site yet (missing Supabase URL or key).');
  client ??= createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return client;
}

/** The signed-in session: undefined while it is being read, null when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(SUPABASE_CONFIGURED ? undefined : null);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const sb = supabase();
    let alive = true;
    void sb.auth.getSession().then(({ data }) => alive && setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return session;
}

/** Plain-English messages for the errors students actually hit. */
export function authMessage(err: { message?: string; code?: string } | null | undefined): string {
  const m = err?.message ?? '';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/already registered|already exists/i.test(m)) return 'An account with this email already exists. Log in instead.';
  if (/password should be at least|weak password/i.test(m)) return 'Choose a longer password (at least 6 characters).';
  if (/email not confirmed/i.test(m)) return 'This account is waiting for an email confirmation.';
  if (/valid email|invalid email|unable to validate email/i.test(m)) return 'Enter a valid email address.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
  return m || 'Something went wrong. Try again.';
}
