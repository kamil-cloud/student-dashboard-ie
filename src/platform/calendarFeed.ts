/**
 * Reads the student's Blackboard calendar link through this website's /api/calendar (a browser
 * cannot read another site's calendar file directly). Signed-in students only.
 */
import { parseIcs, type IcsEvent } from '../integrations/ics';
import { supabase } from './supabase';

export async function fetchCalendarFeed(url: string): Promise<IcsEvent[]> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are logged out. Log in again, then retry.');
  let res: Response;
  try {
    res = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The calendar could not be read (error ${res.status}).`);
  }
  return parseIcs(await res.text());
}
