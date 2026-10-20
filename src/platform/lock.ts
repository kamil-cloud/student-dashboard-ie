/**
 * Only one tab may edit the data at a time — two tabs saving independently would overwrite each
 * other's changes. The holder keeps a Web Lock for as long as it is open; another tab can take
 * over ("Use here"), which releases the lock in the first tab and puts it aside.
 *
 * The lock is held once per page (React may run effects twice in development).
 */

const LOCK_NAME = 'student-dashboard-writer';

export type LockState = 'held' | 'busy';

let held = false;
let pending: Promise<LockState> | null = null;
let onLostHandler: (() => void) | null = null;

/**
 * Try to become the writer. Resolves 'held' (this tab is the writer) or 'busy' (another tab is).
 * `onLost` runs if another tab later takes over.
 */
export function acquireWriterLock(onLost: () => void, opts: { steal?: boolean } = {}): Promise<LockState> {
  onLostHandler = onLost;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve('held'); // very old browser: no protection, but still works
  if (held) return Promise.resolve('held');
  if (pending && !opts.steal) return pending;

  pending = new Promise<LockState>((resolve) => {
    const options: LockOptions = opts.steal ? { steal: true } : { ifAvailable: true };
    locks
      .request(LOCK_NAME, options, (lock) => {
        if (!lock) {
          pending = null;
          resolve('busy');
          return undefined;
        }
        held = true;
        resolve('held');
        // Keep the lock until this page goes away.
        return new Promise<void>(() => {});
      })
      .catch((err: unknown) => {
        held = false;
        pending = null;
        // AbortError: another tab took the lock over.
        if (err instanceof DOMException && err.name === 'AbortError') onLostHandler?.();
        else {
          console.warn('[lock]', err);
          resolve('held');
        }
      });
  });
  return pending;
}
