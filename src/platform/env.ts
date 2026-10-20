/**
 * Where the app is running: inside the browser extension (full Blackboard access, background
 * sync and notifications) or as a plain website (sync goes through the extension if installed).
 */

export const IS_EXTENSION =
  typeof location !== 'undefined' && location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && !!chrome.runtime?.id;

/** Fixed id of the unpacked extension (derived from the "key" in its manifest). */
export const EXTENSION_ID: string = import.meta.env.VITE_EXTENSION_ID ?? '';

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

/** Tell the extension's background worker that the app data changed (reschedules reminders). */
export function notifyBackground(message: Record<string, unknown>): void {
  if (!IS_EXTENSION) return;
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      /* background asleep or reloading — it re-reads data when it wakes */
    });
  } catch {
    /* extension context invalidated (being updated) */
  }
}

