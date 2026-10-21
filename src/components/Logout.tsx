/** Website: "Log out" — saves what is pending first, then signs out and goes back to the landing page. */
import { useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { Button } from './ui';
import { resetCloudState } from '../lib/cloudStorage';
import { goTo } from '../lib/paths';
import { supabase } from '../platform/supabase';

export async function logOut(beforehand?: () => Promise<void>) {
  try {
    await beforehand?.();
  } finally {
    await supabase().auth.signOut().catch(() => {});
    resetCloudState();
    goTo('landing', { replace: true, hash: '' });
  }
}

/** `saveNow`: the dashboard's pending changes (absent on screens without loaded data). */
export function LogoutButton({ saveNow, className = '' }: { saveNow?: () => Promise<void>; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`logout-btn ${className}`}
      icon={busy ? <Loader2 size={15} className="spin" /> : <LogOut size={15} />}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void logOut(saveNow);
      }}
      title="Log out"
      data-testid="logout"
    >
      <span className="nav-label">Log out</span>
    </Button>
  );
}
