import { Info } from 'lucide-react';
import { browserKind } from './SyncBookmark';
import { IS_EXTENSION } from '../platform/env';

/** Running as an app from the Dock / Home Screen (Safari keeps its data). */
function installedAsApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Ask the browser to keep this site's data (call from a click; some browsers ask the student). */
export function askToKeepData(): void {
  if (IS_EXTENSION) return;
  void navigator.storage?.persist?.().catch(() => false);
}

/**
 * Safari deletes a website's storage after 7 days without a visit, unless the site was added to
 * the Dock or Home Screen. Explain how to avoid it (Safari only).
 */
export function SafariStorageTip() {
  const kind = browserKind();
  if (IS_EXTENSION || (kind !== 'safari' && kind !== 'iphone') || installedAsApp()) return null;
  return (
    <p className="storage-tip small" data-testid="safari-tip">
      <Info size={14} />
      <span>
        Safari erases a website’s data if you don’t open it for 7 days. Keep it safe:{' '}
        {kind === 'iphone' ? (
          <>
            tap the Share button, then <strong>Add to Home Screen</strong>, and open Student Dashboard from there
          </>
        ) : (
          <>
            choose <strong>File › Add to Dock</strong> in Safari and open Student Dashboard from the Dock
          </>
        )}
        . Exporting a backup now and then is a good idea too.
      </span>
    </p>
  );
}
