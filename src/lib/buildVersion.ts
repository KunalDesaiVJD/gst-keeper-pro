/**
 * Is a newer build of the app deployed than the one this tab is running?
 *
 * Every deploy removes the previous build's page files (/assets/* answer 404,
 * checked live 23 Nov 2026), and the firm deploys several times a day. A tab
 * left open keeps the old build, so its next visit to a page it has not opened
 * yet asks for a file that is gone. chunkReload.ts mends that after the fact;
 * this finds out before: it reads the live index.html now and then, and when
 * its entry script differs from this tab's, the next page change loads the new
 * build in full (MainLayout) instead of failing.
 */

const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;
const CHECK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

let running: string | null | undefined;
let newer = false;
let lastCheck = 0;

/** This tab's entry script, e.g. /assets/index-Cq-6Z_b5.js; null in development. */
const runningEntry = (): string | null => {
  if (running !== undefined) return running;
  const src = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((s) => s.getAttribute('src') ?? '')
    .find((s) => ENTRY_RE.test(s));
  running = src ? (src.match(ENTRY_RE)?.[0] ?? null) : null;
  return running;
};

export const newBuildAvailable = (): boolean => newer;

export async function checkForNewBuild(force = false): Promise<boolean> {
  if (newer) return true;
  const mine = runningEntry();
  if (!mine) return false;
  const now = Date.now();
  if (!force && now - lastCheck < MIN_GAP_MS) return false;
  lastCheck = now;
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!res.ok) return false;
    const live = (await res.text()).match(ENTRY_RE)?.[0];
    if (live && live !== mine) newer = true;
  } catch {
    /* offline or blocked: try again later */
  }
  return newer;
}

let installed = false;

/** Checks every few minutes and whenever the tab comes back into view. */
export function installBuildWatcher(): void {
  if (installed || !runningEntry()) return;
  installed = true;
  window.setInterval(() => void checkForNewBuild(), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewBuild();
  });
  window.addEventListener('focus', () => void checkForNewBuild());
}
