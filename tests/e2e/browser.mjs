// Launches Playwright's Chromium with the built extension loaded (branded Chrome no longer
// accepts --load-extension), in a throwaway profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export async function launchWithExtension({ extensionDir, profileDir, headless = true, viewport = { width: 1360, height: 860 } } = {}) {
  const userDataDir = profileDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sdw-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    viewport,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId, userDataDir, appUrl: `chrome-extension://${extensionId}/app.html` };
}
