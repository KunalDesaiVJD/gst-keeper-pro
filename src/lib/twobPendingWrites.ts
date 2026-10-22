// Writes to the 2B ledger from an open month's screens that must notice when
// the entry they name is no longer there (docs/2B_RECONCILIATION_FLOW.md
// §13). A GST Manager's correction of a filed month reaches the later
// months' carried copies (twob_prior_books_apply), so a page opened before it
// can still show a copy that is gone. An update of a row that is gone changes
// nothing and returns no error, so each write here asks for the row back and
// stops when none comes: a reclaim never flips its 2B document to Reclaim
// without the entry it reclaims (the document's ITC would leave 5.1 without
// reaching 5.4).
import { supabase } from '@/integrations/supabase/client';
import { BOOKKEEPING_COLUMNS, sameLedgerValue } from '@/lib/twobLiveSync';

export const ENTRY_GONE_MSG = 'This entry is no longer in this month. It was changed elsewhere (another tab, or a correction of a filed month that reached this month). Nothing was saved; the page shows the month as it is now.';

/** Said when the entry is still in the month but no longer holds the decision the page showed. */
export const ENTRY_CHANGED_MSG = 'This entry was changed elsewhere since the page showed it (a reclaim, Expense out or book entry recorded in another tab or by someone else). Nothing was saved; the page shows the month as it is now.';

/** ok: written. gone: the entry (or document) is no longer there, nothing written. message: why not. */
export interface PendingWriteResult { ok: boolean; gone: boolean; message: string }

const OK: PendingWriteResult = { ok: true, gone: false, message: '' };

type LedgerTable = 'bills_not_in_2b' | 'bills_not_in_books';

/**
 * A ledger write's filters, typed loosely: filters on columns named at run
 * time instantiate the generated table types too deep for the compiler.
 */
type LooseFilter = {
  eq(c: string, v: unknown): LooseFilter;
  is(c: string, v: null): LooseFilter;
  select(c: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};
const loose = (q: unknown): LooseFilter => q as LooseFilter;

/**
 * What a Pending items decision expects the entry to hold still: the
 * decision columns as the page showed them (null: empty). The write is made
 * only while every one of them is so.
 */
export type PendingExpect = Record<string, string | null>;

/** Expense out (from Awaiting reclaim): the entry holds no reclaim, Expense out or reclaiming document. */
export const EXPECT_AWAITING_RECLAIM: PendingExpect = { reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null };
/** Undo of an Expense out shown under Expensed out with `label`: still that Expense out, no reclaiming document. */
export const expectExpensedOut = (label: string | null | undefined): PendingExpect =>
  ({ reclaim_month: label ?? null, reclaim_subtype: 'EXPENSE_OUT', reclaimed_via_doc_id: null });
/** A book entry recorded (from Awaiting book entry): the entry holds none. */
export const EXPECT_AWAITING_BOOK_ENTRY: PendingExpect = { book_entry_month: null };
/** Undo of a book entry shown under Booked with `label`: still that book entry. */
export const expectBooked = (label: string | null | undefined): PendingExpect => ({ book_entry_month: label ?? null });

/**
 * Updates one pending ledger entry of the (client, month) the page shows,
 * only while it still holds the decision the page showed (`expect`);
 * reports when it does not (nothing written). The entry is written only
 * while it is in that month: a row the page showed from another month (a
 * month switched while a read was in flight) reads as gone, and is never
 * given this month's label (verification round 3: an Expense out stamped
 * Sep-26 on an Oct-26 entry, counted in no month's 4D(1.2)). And never over
 * a decision recorded since the page read it (verification round 4: an
 * Expense out from a stale Awaiting reclaim list wrote over a reclaim
 * another user had just recorded, so the reclaiming document stayed
 * Reclaim with its ITC counted nowhere; an Undo from a stale Expensed out
 * list would have cleared such a reclaim). One conditional write: the
 * database checks the decision on the row it writes, a save landing at the
 * same moment included.
 */
export async function updatePendingEntry(
  table: LedgerTable, id: string, patch: Record<string, string | null>, userId: string | undefined,
  scope: { clientId: string; period: string }, expect: PendingExpect,
): Promise<PendingWriteResult> {
  let q = loose(supabase.from(table)
    .update({ ...patch, updated_by: userId ?? null, updated_at: new Date().toISOString() } as never))
    .eq('id', id).eq('client_id', scope.clientId).eq('period_month', scope.period);
  for (const [k, v] of Object.entries(expect)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select('id');
  if (error) return { ok: false, gone: false, message: error.message };
  if (data && data.length > 0) return OK;
  // Nothing written: gone from the month, or its decision changed meanwhile.
  const { data: still } = await supabase.from(table).select('id')
    .eq('id', id).eq('client_id', scope.clientId).eq('period_month', scope.period);
  return { ok: false, gone: true, message: still && still.length > 0 ? ENTRY_CHANGED_MSG : ENTRY_GONE_MSG };
}

/** Said when the 2B document a reclaim names is no longer in the month. */
export const DOC_GONE_MSG = 'This 2B document is no longer in this month. Nothing was saved; the page shows the month as it is now.';

/**
 * Reclaims a pending Not in 2B entry against a 2B document of the open month
 * (twob_import2b_reclaim): the entry takes this month as its reclaim month
 * and the document becomes Reclaim in one transaction, or neither. The
 * document's write-through can refuse the whole of it (its Not in Books entry
 * holds a book entry, or the user lacks Import 2B & post), and then nothing
 * is written and the message says what to undo. gone: the entry or the
 * document is no longer there (or the entry no longer awaits a reclaim).
 * was: the document's treatment before (its amendments follow it).
 */
export async function recordReclaim(o: {
  actorId: string; clientId: string; period: string; pendingId: string; docId: string;
}): Promise<PendingWriteResult & { was?: string | null }> {
  const { data, error } = await supabase.rpc('twob_import2b_reclaim', {
    p_actor_id: o.actorId, p_client_id: o.clientId, p_period: o.period, p_pending_id: o.pendingId, p_doc_id: o.docId,
  });
  if (error) return { ok: false, gone: false, message: error.message };
  const d = (data || {}) as Record<string, unknown>;
  if (d.ok === true) return { ok: true, gone: false, message: '', was: typeof d.was === 'string' ? d.was : null };
  return { ok: false, gone: true, message: d.what === 'document' ? DOC_GONE_MSG : ENTRY_GONE_MSG };
}

/**
 * A 2B document of the open month taken out of Reclaim (Import 2B's Save of a
 * staged treatment), in one call (twob_import2b_unreclaim): the pending
 * entry it evidences goes back to Awaiting reclaim and the document takes
 * its new treatment, with the document's write-through, or none of it. gone:
 * the document is no longer in the month (nothing written). was: its
 * treatment before (Reclaim, unless changed elsewhere meanwhile).
 */
export async function releaseReclaim(o: {
  actorId: string; clientId: string; period: string; docId: string; action: string;
}): Promise<PendingWriteResult & { was?: string | null; released?: number }> {
  const { data, error } = await supabase.rpc('twob_import2b_unreclaim', {
    p_actor_id: o.actorId, p_client_id: o.clientId, p_period: o.period, p_doc_id: o.docId, p_action: o.action,
  });
  if (error) return { ok: false, gone: false, message: error.message };
  const d = (data || {}) as Record<string, unknown>;
  if (d.ok === true) return { ok: true, gone: false, message: '', was: typeof d.was === 'string' ? d.was : null, released: Number(d.released) || 0 };
  return { ok: false, gone: true, message: DOC_GONE_MSG };
}

/** The ledger columns of an entry the open-month delete reads. */
export interface DeletableRow {
  id: string;
  is_carried_forward: boolean | null;
  period_month?: string | null;
  reclaim_month?: string | null;
  reclaim_subtype?: string | null;
  book_entry_month?: string | null;
}

/** Whether a row holds a reclaim, Expense out or book entry. */
export const holdsDecision = (r: DeletableRow): boolean => !!((r.reclaim_month || '').trim() || r.reclaim_subtype || (r.book_entry_month || '').trim());

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A month label ("Sep 26", "sep-2026", "September 26") as a number that
 * orders months (as periodKey orders "09/2026"); null when it does not read
 * as one month. The database's twob_label_key.
 */
export function labelKey(label: string | null | undefined): number | null {
  const m = /^([A-Za-z]{3})[A-Za-z]*[\s.,'/-]*([0-9]{4}|[0-9]{2})$/.exec((label || '').trim());
  if (!m) return null;
  const mon = MONTH_ABBR.indexOf(m[1].toLowerCase());
  if (mon < 0) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return year * 12 + mon;
}

/** "08/2026" -> its month number (periodKey). */
const periodNumber = (period: string | null | undefined): number | null => {
  const m = /^(0[1-9]|1[0-2])\/([0-9]{4})$/.exec(period || '');
  return m ? Number(m[2]) * 12 + Number(m[1]) - 1 : null;
};

/** "Aug 26" -> "08/2026" (the month a decision label names), or null. */
export function periodOfLabel(label: string | null | undefined): string | null {
  const k = labelKey(label);
  return k === null ? null : `${String((k % 12) + 1).padStart(2, '0')}/${Math.floor(k / 12)}`;
}

/**
 * Whether the decision a ledger row holds (a reclaim or Expense out, a book
 * entry) was made in the row's own month or later, not carried in from an
 * earlier month (the database's twob__decision_is_own): its label names that
 * month or a later one; a reclaim or Expense out without a label counts as
 * the row's own.
 */
export function decisionIsOwn(table: LedgerTable, r: DeletableRow): boolean {
  const own = periodNumber(r.period_month);
  if (table === 'bills_not_in_2b') {
    if (!(r.reclaim_month || '').trim()) return !!r.reclaim_subtype;
    const k = labelKey(r.reclaim_month);
    return k !== null && own !== null && k >= own;
  }
  const k = labelKey(r.book_entry_month);
  return k !== null && own !== null && k >= own;
}

// ---- 2B Reconciliation's open-month Save -----------------------------------------
// A Save writes only the rows the user added, changed or deleted, and each
// update or delete only while the row still holds everything the page
// loaded: its figures and also its months, its reclaim, Expense out, book
// entry, reclaiming document and Import 2B link (verification round 4:
// guarded on the figures alone, a Save wrote the page's stale Expense out
// over a reclaim Import 2B recorded meanwhile, and a pending delete removed
// an entry reclaimed meanwhile, its 2B document left Reclaim with nothing to
// reclaim; 5.4 lost the ITC).

/** Stamped by any write (not what the entry holds): never guarded on. */
const BOOKKEEPING = BOOKKEEPING_COLUMNS;

/** The decision columns of each list, and what a delete's undo of them writes. */
const DECISION_CLEARED: Record<LedgerTable, Record<string, null>> = {
  bills_not_in_2b: { reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null },
  bills_not_in_books: { book_entry_month: null },
};

/**
 * Said of a row the page loaded that was changed or removed elsewhere since
 * (after its name); the caller says what was saved and what the page shows.
 */
export const CHANGED_ELSEWHERE_MSG = 'was changed elsewhere since this page was loaded (another tab, Import 2B, or a correction of a filed month that reached this month).';

type Cell = string | number | boolean | null | undefined | Record<string, unknown>;
/** A ledger row as the page loaded it (select '*'), or as edited there. */
type LedgerRow = { id: string };
const cell = (r: LedgerRow, k: string): Cell => (r as unknown as Record<string, Cell>)[k];

/** The columns of a loaded row a Save is guarded on: all of them but the bookkeeping stamps. */
export const guardColumns = (r: LedgerRow): string[] => Object.keys(r).filter((k) => !BOOKKEEPING.has(k));

/** Whether a row read now still holds everything the page loaded (the bookkeeping stamps aside). */
export const rowUnchanged = (loaded: LedgerRow, now: LedgerRow | undefined): boolean =>
  !!now && guardColumns(loaded).every((k) => sameLedgerValue(k, cell(loaded, k), cell(now, k)));

const entryName = (r: LedgerRow) => [cell(r, 'supplier_name'), cell(r, 'supplier_invoice_number')]
  .map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || 'An entry';

/**
 * A write (update or delete) made only while the row holds every column as
 * `loaded` has it (a JSON column, adopted_from, is checked before writing
 * by checkRowsUnchanged: it changes only with the link, which is here).
 */
function guarded(q: unknown, loaded: LedgerRow): LooseFilter {
  let out = loose(q).eq('id', loaded.id);
  for (const k of guardColumns(loaded)) {
    const v = cell(loaded, k);
    if (v === null || v === undefined) out = out.is(k, null);
    else if (typeof v !== 'object') out = out.eq(k, v);
  }
  return out;
}

/**
 * Before an open month's Save writes anything: the rows it updates or
 * deletes, read again, against the page's loaded copies. A row that is gone,
 * or that holds anything else now (its figures, months, reclaim, Expense
 * out, book entry, reclaiming document, link), is named; the Save then
 * writes nothing. current: the rows as read now (what a Save that goes on
 * decides from: the delete's confirm, the decisions it undoes). Throws when
 * the rows cannot be read.
 */
export async function checkRowsUnchanged<T extends LedgerRow>(table: LedgerTable, loaded: readonly T[]): Promise<{ stale: string[]; current: Map<string, T> }> {
  if (loaded.length === 0) return { stale: [], current: new Map() };
  const ids = loaded.map((r) => r.id);
  const { data, error } = await supabase.from(table).select('*').in('id', ids);
  if (error) throw new Error(`Could not check the entries before saving: ${error.message}`);
  const current = new Map(((data || []) as unknown as T[]).map((r) => [r.id, r]));
  const stale = loaded.filter((r) => !rowUnchanged(r, current.get(r.id))).map((r) => `${entryName(r)} ${CHANGED_ELSEWHERE_MSG}`);
  return { stale, current };
}

/** The names of the loaded rows changed or removed elsewhere since (checkRowsUnchanged). */
export async function findChangedElsewhere(table: LedgerTable, loaded: readonly LedgerRow[]): Promise<string[]> {
  return (await checkRowsUnchanged(table, loaded)).stale;
}

/**
 * Deletes rows of an open month (2B Reconciliation's Save), each only while
 * it holds what `rows` has (the rows as read just before: checkRowsUnchanged).
 * A carried row holding its own month's decision has the decision undone
 * first, in the same Save: the database refuses to delete such a row
 * directly (a page opened before §13 would lose it to the old carry), and a
 * deliberate delete here takes the decision with the row, as before. A
 * decision carried in from an earlier month is not undone (a filed month's
 * stays as filed: the database refuses that), and the row goes with it as
 * before. Rows without period_month are taken as holding their own month's
 * decision. One row at a time, stopping at the first that cannot be
 * deleted: stale, it was changed elsewhere meanwhile; wrote, something was
 * written before the stop.
 */
export async function deleteOpenMonthRows(table: LedgerTable, rows: LedgerRow[]): Promise<{ error: string | null; stale: boolean; wrote: boolean }> {
  let wrote = false;
  for (const row of rows) {
    const r = row as unknown as DeletableRow;
    let guard: LedgerRow = row;
    if (r.is_carried_forward && holdsDecision(r) && (!r.period_month || decisionIsOwn(table, r))) {
      const { data, error } = await guarded(supabase.from(table).update(DECISION_CLEARED[table] as never), row).select('*');
      if (error) return { error: error.message, stale: false, wrote };
      if (!data || data.length === 0) return { error: `${entryName(row)} ${CHANGED_ELSEWHERE_MSG}`, stale: true, wrote };
      wrote = true;
      guard = (data as unknown as LedgerRow[])[0];
    }
    const { data, error } = await guarded(supabase.from(table).delete(), guard).select('id');
    if (error) return { error: error.message, stale: false, wrote };
    if (!data || data.length === 0) return { error: `${entryName(row)} ${CHANGED_ELSEWHERE_MSG}`, stale: true, wrote };
    wrote = true;
  }
  return { error: null, stale: false, wrote };
}

/**
 * Updates one row of an open month with only the columns the user changed
 * (edited against the row as loaded), and only while the row still holds
 * everything as loaded (guarded). gone: the row was changed or removed
 * elsewhere, nothing written. ok with nothing to write when no column
 * differs.
 */
export async function updateOpenMonthRow(
  table: LedgerTable, loaded: LedgerRow, edited: LedgerRow, userId: string | undefined,
): Promise<PendingWriteResult> {
  const patch: Record<string, Cell> = {};
  for (const k of Object.keys(edited)) {
    if (BOOKKEEPING.has(k)) continue;
    if (JSON.stringify(cell(edited, k) ?? null) !== JSON.stringify(cell(loaded, k) ?? null)) patch[k] = cell(edited, k) ?? null;
  }
  if (Object.keys(patch).length === 0) return OK;
  const q = supabase.from(table)
    .update({ ...patch, updated_by: userId ?? null, updated_at: new Date().toISOString() } as never);
  const { data, error } = await guarded(q, loaded).select('id');
  if (error) return { ok: false, gone: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, gone: true, message: `${entryName(loaded)} ${CHANGED_ELSEWHERE_MSG}` };
  return OK;
}

/**
 * Thrown by writeOpenMonthSave. stale: a row was changed or removed
 * elsewhere since it was read; wrote: something of the Save was written
 * before it stopped (the page then shows the month as it is now; otherwise
 * it keeps the edits).
 */
export class OpenMonthSaveError extends Error {
  stale: boolean;
  wrote: boolean;
  constructor(message: string, stale: boolean, wrote: boolean) {
    super(message);
    this.stale = stale;
    this.wrote = wrote;
  }
}

/** A ledger row with the columns a Save's carry clean-up reads. */
type SavedRow = LedgerRow & {
  period_month: string; date?: string | null; supplier_name?: string | null; supplier_invoice_number?: string | null;
  supplier_gstin?: string | null; taxable_value?: number | null; input_igst?: number | null; input_cgst?: number | null;
  input_sgst?: number | null; is_carried_forward?: boolean | null; reclaim_month?: string | null; reclaim_subtype?: string | null;
  book_entry_month?: string | null;
};

/**
 * The writes of 2B Reconciliation's open-month Save, in its order: per list
 * the deleted rows (as read just before: checkRowsUnchanged; each delete
 * guarded, a carried row's own decision undone with it: deleteOpenMonthRows)
 * and the copies the carry-forward made of a deleted own row in later months
 * whose GSTR-3B is not filed (a copy holding its own reclaim, Expense out or
 * book entry stays, said in kept); then the added rows; then the changed
 * rows, each guarded by everything it held when loaded (updateOpenMonthRow).
 * Throws OpenMonthSaveError at the first write that does not go through,
 * saying whether anything was written before it.
 */
export async function writeOpenMonthSave<T extends SavedRow>(o: {
  clientId: string; userId?: string;
  deletes: Record<LedgerTable, T[]>; inserts: Record<LedgerTable, T[]>; updates: Record<LedgerTable, { loaded: T; edited: T }[]>;
}): Promise<{ laterCopies: number; kept: string[] }> {
  let wrote = false;
  const stop = (message: string, stale = false): never => { throw new OpenMonthSaveError(message, stale, wrote); };
  const kept: string[] = [];
  const tables: LedgerTable[] = ['bills_not_in_2b', 'bills_not_in_books'];

  // Deleting an invoice here also removes the copies the carry-forward made
  // of it in later months whose GSTR-3B is not filed: otherwise it would
  // still sit in those months' pending list.
  const removeLaterCopies = async (table: LedgerTable, rows: T[]): Promise<number> => {
    if (!rows.length) return 0;
    const { data: filed } = await supabase.from('filing_status').select('period_month')
      .eq('client_id', o.clientId).in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed');
    const filedSet = new Set(((filed || []) as { period_month: string }[]).map((f) => f.period_month));
    const key = (p: string) => { const [m, y] = p.split('/'); return Number(y) * 100 + Number(m); };
    const { data: copiesData, error } = await supabase.from(table).select('*')
      .eq('client_id', o.clientId).eq('is_carried_forward', true);
    if (error) stop(`Could not read later months: ${error.message}`);
    const copies = (copiesData || []) as unknown as T[];
    const same = (a: T, b: T) => a.date === b.date && a.supplier_name === b.supplier_name
      && (a.supplier_invoice_number || '') === (b.supplier_invoice_number || '')
      && (a.supplier_gstin || '') === (b.supplier_gstin || '')
      && Number(a.taxable_value || 0) === Number(b.taxable_value || 0)
      && Number(a.input_igst || 0) === Number(b.input_igst || 0)
      && Number(a.input_cgst || 0) === Number(b.input_cgst || 0)
      && Number(a.input_sgst || 0) === Number(b.input_sgst || 0);
    // A later copy holding its own month's decision (a reclaim, Expense out,
    // book entry) stays: the database refuses to delete it (docs §13).
    const decided = (c: T | undefined) => !!(c && (c.reclaim_month || c.reclaim_subtype || c.book_entry_month));
    const ids: string[] = [];
    for (const r of rows) {
      const perPeriod = new Map<string, string>();
      for (const c of copies) {
        if (key(c.period_month) <= key(r.period_month) || filedSet.has(c.period_month)) continue;
        if (!perPeriod.has(c.period_month) && same(c, r) && !ids.includes(c.id)) perPeriod.set(c.period_month, c.id);
      }
      const keep = [...perPeriod.values()].filter((id) => decided(copies.find((c) => c.id === id)));
      if (keep.length) kept.push(`${r.supplier_name} ${r.supplier_invoice_number || ''}: ${keep.length} later ${keep.length === 1 ? 'copy holds' : 'copies hold'} its own reclaim or book entry and ${keep.length === 1 ? 'stays' : 'stay'}; undo that there to remove ${keep.length === 1 ? 'it' : 'them'}.`);
      ids.push(...[...perPeriod.values()].filter((id) => !keep.includes(id)));
    }
    if (ids.length) {
      const { error: dErr } = await supabase.from(table).delete().in('id', ids);
      if (dErr) stop(`Could not remove later copies: ${dErr.message}`);
      wrote = true;
    }
    return ids.length;
  };

  let laterCopies = 0;
  for (const table of tables) {
    const rows = o.deletes[table];
    if (rows.length === 0) continue;
    const res = await deleteOpenMonthRows(table, rows);
    wrote = wrote || res.wrote;
    if (res.error) stop(res.stale ? res.error : `Could not delete: ${res.error}`, res.stale);
    laterCopies += await removeLaterCopies(table, rows.filter((b) => !b.is_carried_forward));
  }
  for (const table of tables) {
    for (const bill of o.inserts[table]) {
      const values: Record<string, unknown> = { ...bill };
      delete values.id;
      const { error } = await supabase.from(table).insert([values as never]).select().single();
      if (error) stop(`Could not add a row: ${error.message}`);
      wrote = true;
    }
  }
  for (const table of tables) {
    for (const { loaded, edited } of o.updates[table]) {
      const res = await updateOpenMonthRow(table, loaded, edited, o.userId);
      if (!res.ok) stop(res.message, res.gone);
      wrote = true;
    }
  }
  return { laterCopies, kept };
}
