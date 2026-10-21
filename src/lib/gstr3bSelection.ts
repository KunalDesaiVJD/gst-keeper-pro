// What the GSTR-3B page loads belongs to the client and month it was loaded
// for (round 3 of the review of the push gate, migration 20261021120000).
// The draft, the gate answer and the filing status are each kept with that
// client and month and read back only while the same pair is selected, so a
// switch shows nothing of the pair selected before, and an answer that comes
// back after the switch is dropped. Before, a draft still loading for the
// client selected before could be downloaded as JSON, or pushed, under the
// newly selected client's passing gate, and a late gate answer for the
// earlier client was shown as the new client's.
// docs/2B_RECONCILIATION_FLOW.md §13. Checked by scripts/verify-reco-gate.mjs.

/** A value with the client and month it was loaded for. */
export interface ForSelection<T> {
  clientId: string;
  periodMonth: string;
  value: T;
}

/** "client|MM/YYYY", or '' when either is missing. */
export const selectionKey = (clientId: string | null | undefined, periodMonth: string | null | undefined): string =>
  clientId && periodMonth ? `${clientId}|${periodMonth}` : '';

export const tagForSelection = <T>(clientId: string, periodMonth: string, value: T): ForSelection<T> =>
  ({ clientId, periodMonth, value });

/** The value when it was loaded for this client and month; null for any other pair, or none. */
export function forSelection<T>(
  tagged: ForSelection<T> | null | undefined,
  clientId: string | null | undefined,
  periodMonth: string | null | undefined,
): T | null {
  if (!tagged || !clientId || !periodMonth) return null;
  return tagged.clientId === clientId && tagged.periodMonth === periodMonth ? tagged.value : null;
}

/**
 * Why this GSTR-3B draft cannot go out for this client and month (its GSTIN
 * or its return period is another's), or null when it is theirs. The last
 * check before a JSON file is made or a push message is sent.
 */
export function draftMismatch(json: unknown, gstin: string | null | undefined, periodMonth: string | null | undefined): string | null {
  const draft = json as { gstin?: unknown; ret_period?: unknown } | null | undefined;
  if (!draft || typeof draft !== 'object') return 'The GSTR-3B draft has not loaded yet.';
  const want = String(gstin ?? '').trim().toUpperCase();
  if (!want) return 'The selected client has no GSTIN on file.';
  const has = String(draft.gstin ?? '').trim().toUpperCase();
  if (has !== want) {
    return `The draft on screen is for GSTIN ${has || '(none)'}, not ${want}. Wait for the draft to finish loading and try again.`;
  }
  const [mm, yyyy] = String(periodMonth ?? '').split('/');
  if (!mm || !yyyy || String(draft.ret_period ?? '') !== `${mm}${yyyy}`) {
    return 'The draft on screen is for another month. Wait for the draft to finish loading and try again.';
  }
  return null;
}
