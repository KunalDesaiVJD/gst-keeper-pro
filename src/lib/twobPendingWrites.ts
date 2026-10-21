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

export const ENTRY_GONE_MSG = 'This entry is no longer in this month. It was changed elsewhere (another tab, or a correction of a filed month that reached this month). Nothing was saved; the page shows the month as it is now.';

/** ok: written. gone: the entry (or document) is no longer there, nothing written. message: why not. */
export interface PendingWriteResult { ok: boolean; gone: boolean; message: string }

const OK: PendingWriteResult = { ok: true, gone: false, message: '' };

type LedgerTable = 'bills_not_in_2b' | 'bills_not_in_books';

/** Updates one pending ledger entry; reports when the entry is gone (nothing written). */
export async function updatePendingEntry(
  table: LedgerTable, id: string, patch: Record<string, string | null>, userId: string | undefined,
): Promise<PendingWriteResult> {
  const { data, error } = await supabase.from(table)
    .update({ ...patch, updated_by: userId ?? null, updated_at: new Date().toISOString() })
    .eq('id', id).select('id');
  if (error) return { ok: false, gone: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, gone: true, message: ENTRY_GONE_MSG };
  return OK;
}

/**
 * Reclaims a pending Not in 2B entry against a 2B document: the entry first,
 * and the document becomes Reclaim only when the entry was still there.
 */
export async function recordReclaim(o: {
  pendingId: string; docId: string; label: string; userId: string | undefined;
}): Promise<PendingWriteResult> {
  const entry = await updatePendingEntry('bills_not_in_2b', o.pendingId,
    { reclaim_month: o.label, reclaim_subtype: null, reclaimed_via_doc_id: o.docId }, o.userId);
  if (!entry.ok) return entry;
  const { data, error } = await supabase.from('twob_import_docs').update({
    itc_action: 'RECLAIM', updated_by: o.userId ?? null, updated_at: new Date().toISOString(),
  }).eq('id', o.docId).select('id');
  if (error) return { ok: false, gone: false, message: error.message };
  if (!data || data.length === 0) {
    // The document went meanwhile: the entry is put back as it was.
    await supabase.from('bills_not_in_2b').update({ reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null })
      .eq('id', o.pendingId);
    return { ok: false, gone: true, message: 'This 2B document is no longer in this month. Nothing was saved; the page shows the month as it is now.' };
  }
  return OK;
}

/** The ledger columns of an entry the open-month delete reads. */
export interface DeletableRow {
  id: string;
  is_carried_forward: boolean | null;
  reclaim_month?: string | null;
  reclaim_subtype?: string | null;
  book_entry_month?: string | null;
}

/** Whether a row holds a reclaim, Expense out or book entry. */
export const holdsDecision = (r: DeletableRow): boolean => !!((r.reclaim_month || '').trim() || r.reclaim_subtype || (r.book_entry_month || '').trim());

/**
 * Deletes rows of an open month (2B Reconciliation's Save). A carried row
 * holding a decision has the decision undone first, in the same Save: the
 * database refuses to delete a carried row holding its own month's decision
 * directly (a page opened before §13 would lose it to the old carry), and a
 * deliberate delete here takes the decision with the row, as before.
 */
export async function deleteOpenMonthRows(table: LedgerTable, rows: DeletableRow[]): Promise<{ error: string | null }> {
  if (rows.length === 0) return { error: null };
  const decided = rows.filter((r) => r.is_carried_forward && holdsDecision(r)).map((r) => r.id);
  if (decided.length > 0) {
    const { error } = table === 'bills_not_in_2b'
      ? await supabase.from('bills_not_in_2b').update({ reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null }).in('id', decided)
      : await supabase.from('bills_not_in_books').update({ book_entry_month: null }).in('id', decided);
    if (error) return { error: error.message };
  }
  const { error } = await supabase.from(table).delete().in('id', rows.map((r) => r.id));
  return { error: error ? error.message : null };
}

// ---- 2B Reconciliation's open-month Save -----------------------------------------

/** The columns a GST Manager's correction of a filed month can change on a later month's copy (twob_prior_books_apply). */
export const DOOR_COLUMNS = ['date', 'supplier_name', 'supplier_invoice_number', 'supplier_gstin',
  'taxable_value', 'input_igst', 'input_cgst', 'input_sgst'] as const;

/** Said when a row the page loaded was changed or removed elsewhere since: nothing of the Save is written. */
export const CHANGED_ELSEWHERE_MSG = 'was changed elsewhere since this page was loaded (another tab, or a correction of a filed month that reached this month). Nothing was saved; the page shows the month as it is now.';

type Cell = string | number | boolean | null | undefined;
/** A ledger row as the page loaded it (select '*'), or as edited there. */
type LedgerRow = { id: string };
const cell = (r: LedgerRow, k: string): Cell => (r as unknown as Record<string, Cell>)[k];

const sameDoorValue = (k: string, a: Cell, b: Cell): boolean => {
  if (k === 'date' || k === 'supplier_name' || k === 'supplier_invoice_number' || k === 'supplier_gstin') {
    return String(a ?? '').trim() === String(b ?? '').trim();
  }
  return Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100);
};

const entryName = (r: LedgerRow) => [cell(r, 'supplier_name'), cell(r, 'supplier_invoice_number')]
  .map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || 'An entry';

/**
 * Before an open month's Save writes anything: the rows it updates or
 * deletes, read again, against the page's loaded copies. A row that is gone,
 * or whose date, supplier, number, GSTIN or amounts differ (a filed month's
 * correction reached it meanwhile), is named; the Save then writes nothing.
 * Throws when the rows cannot be read.
 */
export async function findChangedElsewhere(table: LedgerTable, loaded: readonly LedgerRow[]): Promise<string[]> {
  if (loaded.length === 0) return [];
  const ids = loaded.map((r) => r.id);
  const { data, error } = await supabase.from(table).select(`id, ${DOOR_COLUMNS.join(', ')}`).in('id', ids);
  if (error) throw new Error(`Could not check the entries before saving: ${error.message}`);
  const now = new Map(((data || []) as unknown as LedgerRow[]).map((r) => [r.id, r]));
  return loaded.filter((r) => {
    const cur = now.get(r.id);
    return !cur || DOOR_COLUMNS.some((k) => !sameDoorValue(k, cell(r, k), cell(cur, k)));
  }).map((r) => `${entryName(r)} ${CHANGED_ELSEWHERE_MSG}`);
}

/**
 * Updates one row of an open month with only the columns the user changed
 * (edited against the row as loaded), and only while the row still holds the
 * loaded date, supplier, number, GSTIN and amounts. gone: the row was changed
 * or removed elsewhere, nothing written. ok with nothing to write when no
 * column differs.
 */
export async function updateOpenMonthRow(
  table: LedgerTable, loaded: LedgerRow, edited: LedgerRow, userId: string | undefined,
): Promise<PendingWriteResult> {
  const skip = new Set(['id', 'created_at', 'updated_at', 'updated_by', 'version']);
  const patch: Record<string, Cell> = {};
  for (const k of Object.keys(edited)) {
    if (skip.has(k)) continue;
    if (JSON.stringify(cell(edited, k) ?? null) !== JSON.stringify(cell(loaded, k) ?? null)) patch[k] = cell(edited, k) ?? null;
  }
  if (Object.keys(patch).length === 0) return OK;
  let q = supabase.from(table)
    .update({ ...patch, updated_by: userId ?? null, updated_at: new Date().toISOString() } as never)
    .eq('id', loaded.id);
  for (const k of DOOR_COLUMNS) {
    const v = cell(loaded, k);
    q = v === null || v === undefined ? q.is(k, null) : q.eq(k, v as string);
  }
  const { data, error } = await q.select('id');
  if (error) return { ok: false, gone: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, gone: true, message: `${entryName(loaded)} ${CHANGED_ELSEWHERE_MSG}` };
  return OK;
}
