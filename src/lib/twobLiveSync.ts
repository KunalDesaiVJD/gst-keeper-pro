// 2B Reconciliation's live updates (docs/2B_RECONCILIATION_FLOW.md §15,
// verification round 3). Every Import 2B save now writes the ledger at once,
// so the page hears of a change to its month far more often than when only
// Post wrote it. A change never overwrites what the user is editing:
//  - a change to another month (or client) is ignored;
//  - while the page holds unsaved edits or pending deletes, or while it
//    saves, nothing is reloaded: a banner says the ledger changed, and Save
//    sends only the rows the user changed, each guarded by the figures it
//    loaded (findChangedElsewhere), refusing with a reload prompt when any of
//    them changed;
//  - otherwise the month is reloaded once per burst of changes (an import
//    writes many rows), and a reload clears the edits and the pending deletes
//    together.

/** A realtime change of bills_not_in_2b / bills_not_in_books, as supabase-js gives it. */
export interface LedgerChange {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

/** What the page shows: its client, month and the ids of the rows it loaded. */
export interface LedgerView {
  clientId: string;
  period: string;
  ids: ReadonlySet<string>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Whether a change concerns the month shown. A row of another client or
 * month does not; nor does a delete that names only a row id the page never
 * loaded (with the default replica identity a delete carries only the id).
 * A change that names neither its month nor a loaded row is taken as
 * concerning it, never ignored on a guess.
 */
export function ledgerChangeConcerns(change: LedgerChange, view: LedgerView): boolean {
  const rows = [change.new, change.old].filter((r): r is Record<string, unknown> => !!r && Object.keys(r).length > 0);
  if (rows.length === 0) return true;
  let named = false;
  for (const r of rows) {
    const client = str(r.client_id);
    const period = str(r.period_month);
    const id = str(r.id);
    if (client !== null || period !== null) {
      named = true;
      if ((client === null || client === view.clientId) && (period === null || period === view.period)) return true;
    } else if (id !== null) {
      named = true;
      if (view.ids.has(id)) return true;
    }
  }
  return !named;
}

/**
 * What the page does with a change to its month: 'wait' while it saves (the
 * save reloads the month when it ends), 'banner' while it holds unsaved
 * edits or pending deletes (they stay until saved or discarded), otherwise
 * 'reload'.
 */
export function liveChangeAction(state: { saving: boolean; dirty: boolean }): 'wait' | 'banner' | 'reload' {
  if (state.saving) return 'wait';
  if (state.dirty) return 'banner';
  return 'reload';
}

/** The banner shown while the page holds unsaved edits and the ledger changed. */
export const LEDGER_CHANGED_BANNER = 'Someone changed this month\'s ledger; reload to see it; your unsaved changes stay until you save or discard.';

/** Said once per burst when a clean page reloads the month by itself. */
export const LEDGER_RELOADED_MSG = 'This month\'s 2B Reconciliation ledger was changed elsewhere (Import 2B, another tab or another user); the page shows it as it is now.';

/**
 * The rows an open month's Save writes, from the rows as loaded and as
 * edited: the added rows (temp ids), the rows whose cells changed (each
 * with its loaded copy, the figures its write is guarded by) and the
 * deleted rows (as loaded). Rows the user did not touch are not sent.
 */
export function rowsToSave<T extends { id: string }>(local: readonly T[], loaded: readonly T[], deletedIds: readonly string[]): {
  inserts: T[];
  updates: { loaded: T; edited: T }[];
  deletes: T[];
} {
  const byId = new Map(loaded.map((r) => [r.id, r]));
  const gone = new Set(deletedIds);
  const inserts = local.filter((r) => r.id.startsWith('temp-'));
  const updates = local.filter((r) => !r.id.startsWith('temp-') && !gone.has(r.id))
    .map((r) => ({ loaded: byId.get(r.id), edited: r }))
    .filter((x): x is { loaded: T; edited: T } => !!x.loaded && JSON.stringify(x.loaded) !== JSON.stringify(x.edited));
  const deletes = loaded.filter((r) => gone.has(r.id));
  return { inserts, updates, deletes };
}
