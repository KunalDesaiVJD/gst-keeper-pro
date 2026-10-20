// Import 2B — Phase 4: the write-through engine.
//
// Import 2B (twob_import_docs / books_register) is the single place staff
// classify documents. "Post to Reconciliation" syncs the two exception
// buckets into the live bills_not_in_2b / bills_not_in_books running sheets
// that ITC Summary, Suspended Reco and month-to-month carry-forward already
// read from — none of that downstream engine changes.
//
// GST-law mapping (see docs/2B_RECONCILIATION_FLOW.md for the full reasoning):
//  - twob_import_docs.itc_action = NOT_IN_BOOKS  → bills_not_in_books row
//    (in 2B, not yet booked; bill_in_2b_month = this period, book_entry_month
//    left blank until the client's accounts team books it).
//  - books_register.book_treatment = NOT_IN_2B   → bills_not_in_2b row
//    (booked, not in 2B this period → must be reversed now; reversal_month =
//    this period, reclaim_month left blank until it clears via Import 2B's
//    Pending items zone).
//  - MATCHED / MISMATCHED 2B docs are claimed at the GSTR-2B value (the legal
//    ceiling per s.16(2)(aa)) — no ledger row; ITC Summary reads their sum
//    directly. INELIGIBLE / ITC_OF_OTHERS / MISMATCHED / NOT_ELIGIBLE never
//    produce a ledger row — they are not a 2B-vs-books timing gap.
//
// Sync is idempotent and non-destructive to rows this engine doesn't own:
// only bills_not_in_2b/books rows carrying a source_book_id/source_doc_id
// link are inserted/updated/retracted here. Carried-forward copies and
// legacy manually-added rows (no link) are never touched.
//
// Notes and amendments (firm decision, 14 Oct 2026, §10 of the doc): every
// figure is read through src/lib/twobDocs.ts. A supplier debit note counts
// like an invoice (row 5.1, or Not in Books). A supplier credit note reduces
// ITC through row 5.3 (fetchImport2BCreditNotes), or, parked Not in Books
// like an invoice (17 Oct 2026), is posted to the ledger as a negative row.
// An amendment counts only its difference from the version Import 2B already
// counted (effectFigures), in row 5.1 / 5.3 or as a Not in Books row that may
// be negative; a HELD amendment counts nowhere.

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { COUNTED_ACTIONS, effectFigures, signedEffect, type TwobDocLike } from '@/lib/twobDocs';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "08/2026" -> "Aug 26" — the exact label format reversal_month / reclaim_month
// / book_entry_month / bill_in_2b_month already use across the app.
export function periodMonthLabel(periodMonth: string): string {
  const [mmStr, yyyyStr] = (periodMonth || '').split('/');
  const mm = parseInt(mmStr, 10);
  if (!mm || mm < 1 || mm > 12 || !yyyyStr) return '';
  return `${MONTH_SHORT[mm - 1]} ${String(yyyyStr).slice(-2)}`;
}

interface TwoBDocRow extends TwobDocLike {
  id: string;
  date: string | null;
  supplier_name: string | null;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number | null;
  input_igst: number | null;
  input_cgst: number | null;
  input_sgst: number | null;
  itc_action: string;
}

interface BookRegRow {
  id: string;
  date: string | null;
  supplier_name: string | null;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number | null;
  input_igst: number | null;
  input_cgst: number | null;
  input_sgst: number | null;
  book_treatment: string;
}

interface LedgerRow {
  id: string;
  source_book_id?: string | null;
  source_doc_id?: string | null;
  date: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number | null;
  input_igst: number | null;
  input_cgst: number | null;
  input_sgst: number | null;
}

const amountsDiffer = (a: LedgerRow, b: { date: string; supplier_name: string; supplier_invoice_number: string | null; supplier_gstin: string | null; taxable_value: number; input_igst: number; input_cgst: number; input_sgst: number }) =>
  a.date !== b.date ||
  (a.supplier_name || '') !== b.supplier_name ||
  (a.supplier_invoice_number || '') !== (b.supplier_invoice_number || '') ||
  (a.supplier_gstin || '') !== (b.supplier_gstin || '') ||
  Number(a.taxable_value || 0) !== b.taxable_value ||
  Number(a.input_igst || 0) !== b.input_igst ||
  Number(a.input_cgst || 0) !== b.input_cgst ||
  Number(a.input_sgst || 0) !== b.input_sgst;

/** A books row with a minus amount: a supplier credit note, which the books register does not take. */
export const bookHasMinus = (b: { taxable_value?: number | null; input_igst?: number | null; input_cgst?: number | null; input_sgst?: number | null }) =>
  [b.taxable_value, b.input_igst, b.input_cgst, b.input_sgst].some((v) => (Number(v) || 0) < 0);

export const BOOK_MINUS_REASON = 'Minus amount: a credit note from the supplier is not entered in the books register. It reduces ITC from its own 2B row once the supplier reports it (row 5.3); delete this row';

export interface PostPlan {
  insertBills2B: { row: BookRegRow }[];
  updateBills2B: { ledgerId: string; row: BookRegRow }[];
  retractBills2B: { ledgerId: string }[];
  skippedBooks: { row: BookRegRow; reason: string }[];
  insertBillsBooks: { row: TwoBDocRow }[];
  updateBillsBooks: { ledgerId: string; row: TwoBDocRow }[];
  retractBillsBooks: { ledgerId: string }[];
  skippedDocs: { row: TwoBDocRow; reason: string }[];
}

// The figures a 2B document puts in the Not in Books ledger: what it changes
// this month, with its sign (an invoice or debit note its 2B figures, a credit
// note the same negative, an amendment its difference, which may be negative).
const ledgerFiguresOf = (d: TwoBDocRow) => {
  const e = signedEffect(d);
  return { taxable_value: e.taxable, input_igst: e.igst, input_cgst: e.cgst, input_sgst: e.sgst };
};

// Dry-run: compute what a post would do, without writing anything. Used to
// show a confirm dialog with real counts before touching the ledger. Only the
// rows that post are read (books NOT_IN_2B, docs NOT_IN_BOOKS), every page of
// them: PostgREST returns at most 1000 rows a request, and a truncated read
// here would retract or duplicate ledger rows.
export async function planImport2BPost(clientId: string, periodMonth: string): Promise<PostPlan> {
  const LEDGER_COLUMNS = 'id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst';
  const [books, docs, ledger2B, ledgerBooks] = await Promise.all([
    fetchAllRows<BookRegRow>('books_register', '*', (q) => q
      .eq('client_id', clientId).eq('period_month', periodMonth).eq('book_treatment', 'NOT_IN_2B').order('id')),
    fetchAllRows<TwoBDocRow>('twob_import_docs', '*', (q) => q
      .eq('client_id', clientId).eq('period_month', periodMonth).eq('itc_action', 'NOT_IN_BOOKS').order('id')),
    fetchAllRows<LedgerRow>('bills_not_in_2b', `${LEDGER_COLUMNS}, source_book_id`, (q) => q
      .eq('client_id', clientId).eq('period_month', periodMonth).not('source_book_id', 'is', null).order('id')),
    fetchAllRows<LedgerRow>('bills_not_in_books', `${LEDGER_COLUMNS}, source_doc_id`, (q) => q
      .eq('client_id', clientId).eq('period_month', periodMonth).not('source_doc_id', 'is', null).order('id')),
  ]);

  const plan: PostPlan = {
    insertBills2B: [], updateBills2B: [], retractBills2B: [], skippedBooks: [],
    insertBillsBooks: [], updateBillsBooks: [], retractBillsBooks: [], skippedDocs: [],
  };

  // Books not in 2B -> bills_not_in_2b. Books rows are invoices or debit
  // notes, always positive: a supplier credit note the client has booked waits
  // for its own 2B row (row 5.3) and is never posted from books (the firm's
  // decision, 20 Oct 2026; docs §10). A minus row is skipped, and what it
  // posted before is taken back below.
  const notIn2B = books.filter((b) => b.book_treatment === 'NOT_IN_2B');
  const byBookId = new Map(ledger2B.map((l) => [l.source_book_id as string, l]));
  const postable = new Set<string>();
  for (const b of notIn2B) {
    if (bookHasMinus(b)) { plan.skippedBooks.push({ row: b, reason: BOOK_MINUS_REASON }); continue; }
    postable.add(b.id);
    if (!b.date) { plan.skippedBooks.push({ row: b, reason: 'Missing date' }); continue; }
    if (!b.supplier_name || !b.supplier_name.trim()) { plan.skippedBooks.push({ row: b, reason: 'Missing supplier name' }); continue; }
    const existing = byBookId.get(b.id);
    if (!existing) {
      plan.insertBills2B.push({ row: b });
    } else if (amountsDiffer(existing, {
      date: b.date, supplier_name: b.supplier_name, supplier_invoice_number: b.supplier_invoice_number,
      supplier_gstin: b.supplier_gstin, taxable_value: b.taxable_value || 0, input_igst: b.input_igst || 0,
      input_cgst: b.input_cgst || 0, input_sgst: b.input_sgst || 0,
    })) {
      plan.updateBills2B.push({ ledgerId: existing.id, row: b });
    }
  }
  for (const l of ledger2B) {
    if (l.source_book_id && !postable.has(l.source_book_id)) plan.retractBills2B.push({ ledgerId: l.id });
  }

  // 2B docs not in books -> bills_not_in_books, every kind alike: a credit
  // note posts negative (ledgerFiguresOf). A HELD amendment never has this
  // treatment, so it is never posted. An amendment that changes no figure (a
  // number or date correction) has nothing to add beside its original and is
  // not posted.
  const notInBooks = docs.filter((d) => d.itc_action === 'NOT_IN_BOOKS');
  const kept = new Set<string>();
  const byDocId = new Map(ledgerBooks.map((l) => [l.source_doc_id as string, l]));
  for (const d of notInBooks) {
    const fig = ledgerFiguresOf(d);
    if (d.is_amendment && [fig.taxable_value, fig.input_igst, fig.input_cgst, fig.input_sgst].every((v) => Math.abs(v) < 0.005)) continue;
    kept.add(d.id);
    if (!d.date) { plan.skippedDocs.push({ row: d, reason: 'Missing date' }); continue; }
    if (!d.supplier_name || !d.supplier_name.trim()) { plan.skippedDocs.push({ row: d, reason: 'Missing supplier name' }); continue; }
    const existing = byDocId.get(d.id);
    if (!existing) {
      plan.insertBillsBooks.push({ row: d });
    } else if (amountsDiffer(existing, {
      date: d.date, supplier_name: d.supplier_name, supplier_invoice_number: d.supplier_invoice_number,
      supplier_gstin: d.supplier_gstin, ...fig,
    })) {
      plan.updateBillsBooks.push({ ledgerId: existing.id, row: d });
    }
  }
  for (const l of ledgerBooks) {
    if (l.source_doc_id && !kept.has(l.source_doc_id)) plan.retractBillsBooks.push({ ledgerId: l.id });
  }

  return plan;
}

export interface HeadTotals { igst: number; cgst: number; sgst: number }

// The columns effectFigures reads, plus what the totals filter on.
const COUNTED_COLUMNS = 'id, doc_type, is_amendment, original_doc_type, taxable_value, input_igst, input_cgst, input_sgst, cess, '
  + 'base_taxable_value, base_input_igst, base_input_cgst, base_input_sgst, base_cess, '
  + 'ims_reduce_required, declared_igst, declared_cgst, declared_sgst, declared_cess';

// Every counted (MATCHED / MISMATCHED), non-RCM document of one type group,
// summed by what it changes this month (an amendment its difference). Paged,
// since a big month runs past PostgREST's 1000-row response.
async function sumCountedDocs(clientId: string, periodMonth: string, creditNotes: boolean): Promise<HeadTotals> {
  const rows = await fetchAllRows<TwobDocLike>('twob_import_docs', COUNTED_COLUMNS, (q) => {
    const base = q.eq('client_id', clientId).eq('period_month', periodMonth)
      .eq('reverse_charge', false).in('itc_action', [...COUNTED_ACTIONS]);
    return (creditNotes ? base.eq('doc_type', 'CREDIT_NOTE') : base.neq('doc_type', 'CREDIT_NOTE')).order('id');
  });
  const t = rows.reduce((acc, r) => {
    const e = effectFigures(r);
    return { igst: acc.igst + e.igst, cgst: acc.cgst + e.cgst, sgst: acc.sgst + e.sgst };
  }, { igst: 0, cgst: 0, sgst: 0 });
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst) };
}

// The month's eligible ITC as per GSTR-2B — MATCHED (clean match) plus
// MISMATCHED (still genuinely in 2B; claimed at the 2B figure, the legal
// ceiling under s.16(2)(aa) — the books-vs-2B differential is a follow-up
// item, not a claim adjustment). INELIGIBLE and ITC_OF_OTHERS are excluded:
// the former is blocked credit, the latter isn't the taxpayer's ITC at all.
// RCM docs are excluded — RCM ITC is claimed via RCM Summary, not here.
// Invoices and supplier debit notes only (credit notes reduce through row
// 5.3, below); an amendment adds its difference, which may be negative; a
// HELD amendment is not counted.
export async function fetchImport2BEligibleTotal(clientId: string, periodMonth: string): Promise<HeadTotals> {
  return sumCountedDocs(clientId, periodMonth, false);
}

// The month's supplier credit notes as per GSTR-2B, for ITC Summary row 5.3
// "Debit Note": MATCHED and MISMATCHED, non-RCM, by what each reduces (an
// amended note its difference). Positive = the reduction. One parked Not in
// Books is left out: it waits on the ledger until booked. notesRead says
// whether this month's import read the notes at all (any row with full_2b):
// an older, invoices-only import has none, and its row 5.3 stays as typed.
export async function fetchImport2BCreditNotes(
  clientId: string,
  periodMonth: string,
): Promise<{ total: HeadTotals; notesRead: boolean }> {
  const [total, readRes] = await Promise.all([
    sumCountedDocs(clientId, periodMonth, true),
    supabase.from('twob_import_docs').select('id')
      .eq('client_id', clientId).eq('period_month', periodMonth).eq('full_2b', true).limit(1),
  ]);
  if (readRes.error) throw new Error(`Import 2B credit notes: ${readRes.error.message}`);
  return { total, notesRead: (readRes.data || []).length > 0 };
}

// How many of the month's non-RCM amendments are HELD in Import 2B (no
// earlier version found, so counted nowhere until staff decide). A head
// count, so no row limit applies. Throws on a read error.
export async function fetchImport2BHeld(clientId: string, periodMonth: string): Promise<number> {
  const { count, error } = await supabase.from('twob_import_docs').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('period_month', periodMonth)
    .eq('reverse_charge', false).eq('itc_action', 'HELD');
  if (error) throw new Error(`Import 2B held amendments: ${error.message}`);
  return count || 0;
}

// The line ITC Summary and GSTR-3B show while any are held.
export const import2BHeldMessage = (n: number) =>
  `${n} ${n === 1 ? 'amendment' : 'amendments'} held in Import 2B, not counted: settle ${n === 1 ? 'it' : 'them'} there`;

export const isPostPlanEmpty = (p: PostPlan) =>
  p.insertBills2B.length === 0 && p.updateBills2B.length === 0 && p.retractBills2B.length === 0 &&
  p.insertBillsBooks.length === 0 && p.updateBillsBooks.length === 0 && p.retractBillsBooks.length === 0;

export interface PostResult {
  inserted2B: number; updated2B: number; retracted2B: number;
  insertedBooks: number; updatedBooks: number; retractedBooks: number;
  skipped: number;
  versionNumber: number | null;
}

// Execute a previously computed plan, stamp posted_at/posted_by on every
// classified row for the period, and write a twob_versions snapshot so
// "View Versions" on 2B Reconciliation keeps an audit trail of each post.
export async function postImport2BToLedger(
  clientId: string,
  periodMonth: string,
  userId: string | undefined,
  plan: PostPlan,
): Promise<PostResult> {
  const nowIso = new Date().toISOString();
  const currentLabel = periodMonthLabel(periodMonth);

  if (plan.retractBills2B.length > 0) {
    await supabase.from('bills_not_in_2b').delete().in('id', plan.retractBills2B.map((r) => r.ledgerId));
  }
  if (plan.retractBillsBooks.length > 0) {
    await supabase.from('bills_not_in_books').delete().in('id', plan.retractBillsBooks.map((r) => r.ledgerId));
  }

  if (plan.insertBills2B.length > 0) {
    const rows = plan.insertBills2B.map(({ row: b }) => ({
      client_id: clientId,
      period_month: periodMonth,
      date: b.date as string,
      supplier_name: (b.supplier_name || '').trim() || 'Unknown supplier',
      supplier_invoice_number: b.supplier_invoice_number,
      supplier_gstin: b.supplier_gstin,
      taxable_value: b.taxable_value || 0,
      input_igst: b.input_igst || 0,
      input_cgst: b.input_cgst || 0,
      input_sgst: b.input_sgst || 0,
      reversal_month: currentLabel,
      reclaim_month: null,
      is_carried_forward: false,
      source_book_id: b.id,
      updated_by: userId,
      updated_at: nowIso,
    }));
    const { error } = await supabase.from('bills_not_in_2b').insert(rows);
    if (error) throw error;
  }
  for (const { ledgerId, row: b } of plan.updateBills2B) {
    await supabase.from('bills_not_in_2b').update({
      date: b.date as string,
      supplier_name: (b.supplier_name || '').trim() || 'Unknown supplier',
      supplier_invoice_number: b.supplier_invoice_number,
      supplier_gstin: b.supplier_gstin,
      taxable_value: b.taxable_value || 0,
      input_igst: b.input_igst || 0,
      input_cgst: b.input_cgst || 0,
      input_sgst: b.input_sgst || 0,
      updated_by: userId,
      updated_at: nowIso,
    }).eq('id', ledgerId);
  }

  if (plan.insertBillsBooks.length > 0) {
    const rows = plan.insertBillsBooks.map(({ row: d }) => ({
      client_id: clientId,
      period_month: periodMonth,
      date: d.date as string,
      supplier_name: (d.supplier_name || '').trim() || 'Unknown supplier',
      supplier_invoice_number: d.supplier_invoice_number,
      supplier_gstin: d.supplier_gstin,
      ...ledgerFiguresOf(d),
      bill_in_2b_month: currentLabel,
      book_entry_month: null,
      is_carried_forward: false,
      source_doc_id: d.id,
      updated_by: userId,
      updated_at: nowIso,
    }));
    const { error } = await supabase.from('bills_not_in_books').insert(rows);
    if (error) throw error;
  }
  for (const { ledgerId, row: d } of plan.updateBillsBooks) {
    await supabase.from('bills_not_in_books').update({
      date: d.date as string,
      supplier_name: (d.supplier_name || '').trim() || 'Unknown supplier',
      supplier_invoice_number: d.supplier_invoice_number,
      supplier_gstin: d.supplier_gstin,
      ...ledgerFiguresOf(d),
      updated_by: userId,
      updated_at: nowIso,
    }).eq('id', ledgerId);
  }

  // Stamp every classified row for the period as posted (audit trail — even
  // MATCHED/INELIGIBLE/ITC_OF_OTHERS/MISMATCHED rows, which never get a
  // ledger row of their own but are read live by ITC Summary).
  await supabase.from('books_register')
    .update({ posted_at: nowIso, posted_by: userId })
    .eq('client_id', clientId).eq('period_month', periodMonth);
  await supabase.from('twob_import_docs')
    .update({ posted_at: nowIso, posted_by: userId })
    .eq('client_id', clientId).eq('period_month', periodMonth);

  // Version snapshot — same shape TwoBReconciliationPage's old "Save Changes"
  // wrote, so View Versions keeps working unchanged.
  let versionNumber: number | null = null;
  try {
    const { data: existingVersions } = await supabase
      .from('twob_versions').select('version_number')
      .eq('client_id', clientId).eq('period_month', periodMonth);
    const nextVersion = existingVersions && existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version_number || 1)) + 1 : 1;

    await supabase.from('twob_versions').update({ is_current: false })
      .eq('client_id', clientId).eq('period_month', periodMonth);

    const [snap2B, snapBooks] = await Promise.all([
      supabase.from('bills_not_in_2b').select('*').eq('client_id', clientId).eq('period_month', periodMonth),
      supabase.from('bills_not_in_books').select('*').eq('client_id', clientId).eq('period_month', periodMonth),
    ]);
    const toVersionRow2B = (b: Tables<'bills_not_in_2b'>) => ({
      id: b.id, clientId: b.client_id, date: b.date, supplierName: b.supplier_name,
      supplierInvoiceNumber: b.supplier_invoice_number || '', supplierGstin: b.supplier_gstin || '',
      taxableValue: b.taxable_value || 0, inputIgst: b.input_igst || 0, inputCgst: b.input_cgst || 0,
      inputSgst: b.input_sgst || 0, reversalMonth: b.reversal_month || '', reclaimMonth: b.reclaim_month || '',
      periodMonth: b.period_month, isLocked: b.is_locked || false, isCarriedForward: b.is_carried_forward || false,
      updatedBy: b.updated_by || '', updatedAt: b.updated_at || nowIso, version: b.version || 1,
    });
    const toVersionRowBooks = (b: Tables<'bills_not_in_books'>) => ({
      id: b.id, clientId: b.client_id, date: b.date, supplierName: b.supplier_name,
      supplierInvoiceNumber: b.supplier_invoice_number || '', supplierGstin: b.supplier_gstin || '',
      taxableValue: b.taxable_value || 0, inputIgst: b.input_igst || 0, inputCgst: b.input_cgst || 0,
      inputSgst: b.input_sgst || 0, bookEntryMonth: b.book_entry_month || '', billIn2BMonth: b.bill_in_2b_month || '',
      periodMonth: b.period_month, isLocked: b.is_locked || false, isCarriedForward: b.is_carried_forward || false,
      updatedBy: b.updated_by || '', updatedAt: b.updated_at || nowIso, version: b.version || 1,
    });

    const { error: versionError } = await supabase.from('twob_versions').insert([{
      client_id: clientId,
      period_month: periodMonth,
      table_type: 'combined',
      version_number: nextVersion,
      version_data: {
        billsNotIn2B: (snap2B.data || []).map(toVersionRow2B),
        billsNotInBooks: (snapBooks.data || []).map(toVersionRowBooks),
      },
      updated_at: nowIso,
      updated_by: userId || null,
      is_current: true,
      action_type: 'SAVE',
    }]);
    if (!versionError) versionNumber = nextVersion;
  } catch {
    // Versioning is an audit nicety — never fail the post because of it.
  }

  return {
    inserted2B: plan.insertBills2B.length,
    updated2B: plan.updateBills2B.length,
    retracted2B: plan.retractBills2B.length,
    insertedBooks: plan.insertBillsBooks.length,
    updatedBooks: plan.updateBillsBooks.length,
    retractedBooks: plan.retractBillsBooks.length,
    skipped: plan.skippedBooks.length + plan.skippedDocs.length,
    versionNumber,
  };
}
