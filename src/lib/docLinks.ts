// Short document links: every stored file is shown as /d/<id> (on the site,
// https://gst.vjdesai.com/d/<id>), never by its storage address, which names
// the backend and opens for anyone who has it. The page /d/:id
// (DocumentOpenPage) asks the Edge Function doc-open, which checks who is
// signed in and streams the file. The id is made here, without asking the
// database (supabase/functions/_shared/docLink.ts, migration
// 20261025210000_doc_links.sql).
//
// docHref / openDoc are for the code that renders a link; the rewriter
// (installDocLinkRewriter, started once in App) is the net under them: any
// <a href> on any page that still names a storage address is turned into its
// short link as it appears, so a link added later cannot show the address.
import {
  DOC_LINK_ORIGIN,
  docLinkId,
  docLinkPath,
  parseStorageUrl,
} from '../../supabase/functions/_shared/docLink.ts';
import { currentActorId } from '@/lib/changeLogHeaders';

export { DOC_LINK_ORIGIN };

/** Where the login page goes after signing in, when a document link sent it (sessionStorage). */
export const AFTER_LOGIN_KEY = 'gstk_after_login';

// (import.meta.env is absent when a script loads the export code in Node.)
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const SUPABASE_URL = ENV.VITE_SUPABASE_URL ?? '';
const ANON = ENV.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const FN_URL = `${SUPABASE_URL}/functions/v1/doc-open`;

/** True when the address is one of this project's stored files. */
export const isStoredFileUrl = (url: string | null | undefined): boolean => !!parseStorageUrl(url, SUPABASE_URL);

/** "/d/<id>" for a stored file's address; any other address as it is. */
export function docHref(url: string): string;
export function docHref(url: string | null | undefined): string | undefined;
export function docHref(url: string | null | undefined): string | undefined {
  if (!url) return url ?? undefined;
  return docLinkPath(url, SUPABASE_URL) ?? url;
}

/** https://gst.vjdesai.com/d/<id>, for what leaves the app (exports). */
export function docHrefAbsolute(url: string): string {
  const p = docLinkPath(url, SUPABASE_URL);
  return p ? `${DOC_LINK_ORIGIN}${p}` : url;
}

/** window.open, through the short link. */
export function openDoc(url: string, features = 'noopener,noreferrer'): void {
  window.open(docHref(url), '_blank', features);
}

/**
 * Asks doc-open for the file a short link names, as the signed-in person
 * (the actor and the sign-in's sessions_ended_at, as AuthContext keeps them).
 * A refusal comes back as a Response that is not ok, its JSON { error }.
 */
export function fetchDocById(id: string, download?: string | null,
  who: { id: string | null; sessionsEndedAt?: string | null } = signedIn()): Promise<Response> {
  return fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ id, actorId: who.id, sessionsEndedAt: who.sessionsEndedAt ?? null, download: download ?? null }),
  });
}

/** fetch() for a link that may name a stored file: a stored file comes through doc-open. */
export function fetchStoredFile(url: string): Promise<Response> {
  const f = parseStorageUrl(url, SUPABASE_URL);
  return f ? fetchDocById(docLinkId(f.bucket, f.name)) : fetch(url);
}

function signedIn(): { id: string | null; sessionsEndedAt: string | null } {
  let ended: string | null = null;
  try {
    const u = JSON.parse(localStorage.getItem('vjdesai_user') || 'null') as { sessionsEndedAt?: string | null } | null;
    ended = u?.sessionsEndedAt ?? null;
  } catch { ended = null; }
  return { id: currentActorId(), sessionsEndedAt: ended };
}

const rewrite = (a: HTMLAnchorElement) => {
  const raw = a.getAttribute('href');
  if (!raw || raw.startsWith('/')) return;
  const p = docLinkPath(raw, SUPABASE_URL);
  if (!p) return;
  a.setAttribute('href', p);
  // A storage address's download="name" works only on the same site; the
  // short link carries the name itself.
  const dl = a.getAttribute('download');
  if (dl && !p.includes('?download=')) a.setAttribute('href', `${p}?download=${encodeURIComponent(dl)}`);
};

let installed = false;

/** Rewrites every storage address in an <a href> into its short link. Once. */
export function installDocLinkRewriter(): void {
  if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined' || !SUPABASE_URL) return;
  installed = true;
  const host = (() => { try { return new URL(SUPABASE_URL).host; } catch { return ''; } })();
  if (!host) return;
  const sel = `a[href*="${host}"]`;
  const sweep = (root: ParentNode) => root.querySelectorAll<HTMLAnchorElement>(sel).forEach(rewrite);
  sweep(document);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target instanceof HTMLAnchorElement) rewrite(r.target);
      } else {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLAnchorElement) rewrite(n);
          else if (n instanceof Element) sweep(n);
        });
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  // A click that lands before the observer ran (same task) still goes short.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (a instanceof HTMLAnchorElement) rewrite(a);
  }, true);
}
