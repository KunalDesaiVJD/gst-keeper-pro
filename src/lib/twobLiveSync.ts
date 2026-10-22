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
// Verification round 4: a change the page already shows as it is (the
// page's own Save, heard after the Save reloaded the month) is not news;
// every other change is, whoever made it and from whichever tab (before, any
// change stamped by the same user was ignored for 5 s after a Save). A
// change heard while the page saves is kept and looked at again when the
// Save ends (before, it was dropped, and the page went on showing the month
// without it). Save guards every column a row holds (its months, reclaim,
// Expense out, book entry, reclaiming document and link with the figures).

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
  ids: { has(id: string): boolean };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Stamped by any write (not what an entry holds): never compared. */
export const BOOKKEEPING_COLUMNS: ReadonlySet<string> = new Set(['id', 'created_at', 'updated_at', 'updated_by', 'version']);
const AMOUNTS = new Set(['taxable_value', 'input_igst', 'input_cgst', 'input_sgst']);

const asJson = (v: unknown): unknown => {
  if (typeof v === 'string' && /^\s*[{[]/.test(v)) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
};
const canonical = (v: unknown): string => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v ?? null));

/**
 * Whether two reads of one ledger column hold the same: amounts to the
 * paisa (a number or its text), text trimmed (an empty text and none alike),
 * a JSON value by its content.
 */
export function sameLedgerValue(k: string, a: unknown, b: unknown): boolean {
  if (AMOUNTS.has(k)) return Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100);
  const x = asJson(a);
  const y = asJson(b);
  if ((x && typeof x === 'object') || (y && typeof y === 'object')) return canonical(x) === canonical(y);
  return String(x ?? '').trim() === String(y ?? '').trim();
}

/**
 * Whether the page already shows a change as it is (rows: the rows it
 * loaded, by id): a row deleted, or moved to another month, that it no
 * longer holds; a row added or changed that it holds with the same content
 * (the bookkeeping stamps, and columns the change does not carry, aside).
 * The page's own Save, heard after its reload, reads as shown: nothing to
 * reload or say.
 */
export function changeShown(change: LedgerChange, view: { clientId: string; period: string },
  rows: ReadonlyMap<string, object>): boolean {
  const n = change.new && Object.keys(change.new).length > 0 ? change.new : null;
  const o = change.old && Object.keys(change.old).length > 0 ? change.old : null;
  const id = str(n?.id) ?? str(o?.id);
  if (id === null) return false;
  const elsewhere = n !== null && ((str(n.client_id) !== null && n.client_id !== view.clientId)
    || (str(n.period_month) !== null && n.period_month !== view.period));
  if (change.eventType === 'DELETE' || n === null || elsewhere) return !rows.has(id);
  const cur = rows.get(id) as Record<string, unknown> | undefined;
  if (!cur) return false;
  return Object.keys(n).every((k) => BOOKKEEPING_COLUMNS.has(k) || sameLedgerValue(k, n[k], cur[k]));
}

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
 * change is kept, and looked at again against the month the Save reloads
 * when it ends), 'banner' while it holds unsaved edits or pending deletes
 * (they stay until saved or discarded), otherwise 'reload'.
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
