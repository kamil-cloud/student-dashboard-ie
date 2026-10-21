/**
 * The easiest way to connect Blackboard on the website: paste the Blackboard calendar link once
 * (Calendar › Calendar settings › Share calendar). Deadlines and class times then stay up to
 * date by themselves, on every device.
 */
import { useState, type FormEvent } from 'react';
import { AlertCircle, CalendarDays, ExternalLink, Link2, Loader2, Lock, MoreHorizontal, Settings } from 'lucide-react';
import { Button } from './ui';
import { normalizeFeedUrl, type CalendarSummary } from '../integrations/blackboard/calendarFeed';
import { IE_BLACKBOARD_HOST } from '../lib/defaults';
import { useStore } from '../lib/store';
import { useSync } from '../lib/sync';

const NOT_A_LINK = 'That is not a Blackboard calendar link. It looks like https://…/learn.ics — copy it with “Share calendar” in Blackboard’s calendar settings.';

/** A picture of where to click in Blackboard (Ultra calendar). */
function WhereToClick() {
  return (
    <div className="cal-mock" aria-hidden="true">
      <div className="cal-mock-bar">
        <span className="cal-mock-title">
          <CalendarDays size={14} /> Calendar
        </span>
        <span className="cal-mock-btn is-hl">
          <Settings size={13} /> Calendar settings
        </span>
      </div>
      <div className="cal-mock-menu">
        <span className="cal-mock-btn is-hl">
          <MoreHorizontal size={14} />
        </span>
        <span className="cal-mock-item is-hl">
          <Link2 size={13} /> Share calendar
        </span>
      </div>
    </div>
  );
}

export function CalendarLinkConnect({ onConnected }: { onConnected: (summary: CalendarSummary) => void }) {
  const { data } = useStore();
  const { syncCalendar } = useSync();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isIe = data.settings.university === 'ie';
  const host = data.blackboard.host ?? (isIe ? IE_BLACKBOARD_HOST : null);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeFeedUrl(value);
    if (!url) {
      setError(NOT_A_LINK);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const summary = await syncCalendar({ url });
      if (summary) onConnected(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="cal-connect" onSubmit={connect} noValidate data-testid="cal-connect">
      <div className="cal-head">
        <strong>Paste your Blackboard calendar link</strong>
        <span className="cal-badge">Easiest · works on your phone too</span>
      </div>
      <p className="muted small">Your deadlines and class times from all your courses, kept up to date automatically. You do this once.</p>
      <ol className="cal-steps">
        <li>
          <span className="cal-num">1</span>
          <div className="cal-step">
            <span>
              Open Blackboard and click <strong>Calendar</strong> in the menu on the left.
            </span>
            {host && (
              <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(`${host}/ultra/calendar`, 'sd-blackboard')} data-testid="cal-open">
                Open Blackboard Calendar
              </Button>
            )}
          </div>
        </li>
        <li>
          <span className="cal-num">2</span>
          <div className="cal-step">
            <span>
              Click <strong>Calendar settings</strong> (top right), then <strong>⋯</strong> › <strong>Share calendar</strong>, and copy the link.
            </span>
            <WhereToClick />
          </div>
        </li>
        <li>
          <span className="cal-num">3</span>
          <div className="cal-step">
            <span>Come back here and paste the link:</span>
            <div className="cal-input-row">
              <input
                className="input input-lg"
                type="url"
                inputMode="url"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="https://blackboard…/learn.ics"
                spellCheck={false}
                autoComplete="off"
                aria-label="Blackboard calendar link"
                data-testid="cal-url"
              />
              <Button variant="primary" type="submit" disabled={busy || !value.trim()} icon={busy ? <Loader2 size={15} className="spin" /> : undefined} data-testid="cal-submit">
                {busy ? 'Reading…' : 'Connect'}
              </Button>
            </div>
          </div>
        </li>
      </ol>
      {error && (
        <p className="form-error" role="alert" data-testid="cal-error">
          <AlertCircle size={15} /> {error}
        </p>
      )}
      <p className="muted small bb-note">
        <Lock size={13} /> This private link only lets Student Dashboard read your calendar. It is saved in your account and never shown to anyone.
      </p>
    </form>
  );
}
