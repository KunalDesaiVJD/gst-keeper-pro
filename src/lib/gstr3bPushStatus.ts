/**
 * What a GSTR-3B push result means, whichever extension version sent it.
 *
 * From 0.8.6 the extension says itself how complete the fill was (`status`:
 * 'filled' / 'partial' / 'failed') and lists 3.1(a)/(b) under `portalFilled`.
 * Older versions sent only `ok` and a free-text `skipped` list, and reported
 * ok: true however much was skipped, so the same rule is applied here to
 * their words (classifyGstr3bSkips in extension/content.js). Tolerated, so
 * the push still counts:
 *  - a column the portal locks ('portal-locked');
 *  - the 2nd / 3rd column of 4A(1) / 4A(2), which have no such input ('no
 *    input at that position');
 *  - 3.1(a) / (b) not found on the form ('row not found'): those rows carry
 *    what the portal filled from GSTR-1, so they go to portalFilled.
 * Anything else skipped makes the push 'partial', which is not recorded as
 * Pushed (the database trigger counts only 'ok').
 *
 * Matched with startsWith / includes, never equality: 0.8.6 appends the
 * form's row labels to a 3.1(a)/(b) entry, and its portalFilled entries read
 * "… — not typed; the portal keeps the value it filled from GSTR-1 …".
 */

export type Gstr3bPushOutcome = 'ok' | 'partial' | 'failed';

export interface Gstr3bPushStatus {
  status: Gstr3bPushOutcome;
  /** 3.1(a) / (b): not typed, the portal keeps the value it filled from GSTR-1. */
  portalFilled: string[];
  /** Skips that are not tolerated: what the staffer has to enter by hand. */
  realSkips: string[];
}

/** The fields this reads; every one is optional, as older results lack most. */
export interface Gstr3bPushResultLike {
  ok?: boolean;
  status?: string;
  skipped?: unknown;
  portalFilled?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((s) => String(s)) : []);

/** 3.1(a) / (b) left to the portal: 'row not found' (any version), or 0.8.6's own wording. */
export const isPortalFilledSkip = (s: string): boolean =>
  (s.startsWith('3.1(a)') || s.startsWith('3.1(b)'))
  && (s.includes('row not found') || s.includes('the portal keeps the value'));

/** A locked column, or a 4A(1) / 4A(2) column the row does not have. */
export const isToleratedSkip = (s: string): boolean =>
  s.includes('portal-locked')
  || ((s.startsWith('4A(1)') || s.startsWith('4A(2)'))
    && (s.includes(' col 2 ') || s.includes(' col 3 '))
    && s.includes('no input at that position'));

const EXTENSION_STATUS: Record<string, Gstr3bPushOutcome> = { filled: 'ok', partial: 'partial', failed: 'failed' };

export function classifyGstr3bPush(r: Gstr3bPushResultLike | null | undefined): Gstr3bPushStatus {
  const skipped = strings(r?.skipped);
  const realSkips = skipped.filter((s) => !isPortalFilledSkip(s) && !isToleratedSkip(s));
  const own = typeof r?.status === 'string' ? EXTENSION_STATUS[r.status] : undefined;
  if (own) {
    // 0.8.6+: the extension's own call. Its skipped list never holds 3.1(a)/(b),
    // but a stored history row (skipped + portalFilled together) does.
    return { status: own, portalFilled: [...strings(r?.portalFilled), ...skipped.filter(isPortalFilledSkip)], realSkips };
  }
  const portalFilled = skipped.filter(isPortalFilledSkip);
  if (!r?.ok) return { status: 'failed', portalFilled, realSkips };
  return { status: realSkips.length ? 'partial' : 'ok', portalFilled, realSkips };
}

/** "3.1(a) Outward taxable supplies" out of any entry about it. */
export const skipLabel = (s: string): string => s.split(' — ')[0];
