import { lazy, type ComponentType } from "react";

/**
 * Stale page chunks after a deploy.
 *
 * Every page is its own chunk with a hashed name (App.tsx). A tab opened before
 * a deploy still asks for the old names, which the new deployment no longer
 * serves (vercel.json sends /assets/* nowhere else, so they 404). The lazy
 * import then throws, and with no error boundary React unmounted the whole
 * tree: the "entirely blank screen" that came and went with deploys.
 *
 * The cure is to load the new build once: reload the page, at most once a
 * minute per tab, so a chunk that is truly missing can never loop.
 */

const RELOAD_KEY = "gstk_chunk_reload_at";
const RELOAD_WINDOW_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string };
  const text = `${e.name ?? ""} ${e.message ?? String(error)}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    text,
  );
}

/** Reloads the page to fetch the new build, unless this tab did so a moment ago. Returns true when it reloads. */
export function reloadOnceForNewBuild(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0;
  } catch {
    /* storage blocked: still reload once, the guard below falls back to never looping within this page */
  }
  if (Date.now() - last < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    if ((window as unknown as { __gstkReloaded?: boolean }).__gstkReloaded) return false;
    (window as unknown as { __gstkReloaded?: boolean }).__gstkReloaded = true;
  }
  window.location.reload();
  return true;
}

/** Vite's own signal that a preloaded chunk or stylesheet failed to load. */
export function installChunkReloadHandler(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForNewBuild()) event.preventDefault();
  });
}

/**
 * React.lazy that retries a failed import once (a network blip) and, when the
 * chunk is still missing, reloads the page for the new build. If the reload was
 * already tried, the error is thrown to the nearest error boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (first) {
      if (!isChunkLoadError(first)) throw first;
      try {
        return await factory();
      } catch (second) {
        if (reloadOnceForNewBuild()) {
          // The page is reloading; never resolve so nothing renders in between.
          return new Promise<{ default: T }>(() => {});
        }
        throw second;
      }
    }
  });
}
