import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Upload, Loader2, Trash2, Plus, Lock, X, RefreshCw, Inbox, FileSpreadsheet, Send, Clock, ChevronDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { ChangeHistoryButton } from '@/components/history/ChangeHistoryButton';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { parseGstr2bFile } from '@/utils/parseGstr2b';
import { classifyBookAgainst2b, invoiceSimilar, TwoBLite, ClassifyResult } from '@/utils/matchTwob';
import { periodMonthLabel, planImport2BPost, postImport2BToLedger, isPostPlanEmpty, fetchImport2BCreditNotes, bookHasMinus, bookIsPurchaseReturn } from '@/lib/postImport2B';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  docTypeOf, isCreditNote, fullFigures, effectFigures, signedEffect, docLabel, docTone, DOC_TYPE_LABEL,
  TONE_LABEL, TONE_ROW, TONE_STRIPE, TONE_BADGE, TWOB_ACTION_LABEL, allowedActions, canEvidenceReclaim,
  defaultAction, docKey, findEarlierVersion, baseFrom, isCountedAction, countedNothing, periodOrder,
  sameBase, treatmentsGiving, refollowAction, actionInputOf, EARLIER_VERSION_COLUMNS,
  type TwobTone, type EarlierVersionCandidate, type DefaultActionInput,
} from '@/lib/twobDocs';
import ReclaimMatchDialog, { ReclaimInvoiceLite } from '@/components/dialogs/ReclaimMatchDialog';
import EmailBillsNotInBooksDialog from '@/components/import2b/EmailBillsNotInBooksDialog';
import { cn } from '@/lib/utils';
import { KpiTile, Note } from '@/components/gstr9/ui';
import {
  WS_PAGE, WS_BTN, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_TR_TOTAL, WS_FILTER_LABEL, WS_CONTROL,
} from '@/components/workspace/theme';

// The "Import 2B" tab. Import the portal's GSTR-2B .xlsx into the
// twob_import_docs staging table (the whole B2B family: invoices, supplier
// debit and credit notes, their amendments, and the Rule 37A reversal and IMS
// rejected sheets; RCM rows are kept but hidden here), let staff classify each
// document, and enter books invoices and debit notes missing from 2B. "Post to
// Reconciliation" writes the exceptions through to bills_not_in_2b /
// bills_not_in_books (src/lib/postImport2B.ts).
//
// What each kind of document does (src/lib/twobDocs.ts, firm's positions of
// 14 Oct 2026): a debit note is claimed like an invoice; a credit note reduces
// ITC (row 5.3), or waits Not in Books like an invoice until the client books
// it (17 Oct 2026); an amendment counts only its difference over the version
// already counted and follows that version's treatment, and is HELD when no
// earlier version is in Import 2B. Every amount on this page is the document's
// net ITC effect (signedEffect), so totals add up the way ITC Summary reads them.
//
// A re-import MERGES into the month: a document already here (same docKey)
// keeps its id, treatment, books pairing and posting stamp, so classifications,
// ledger rows and reclaim links survive. A document no longer in the file is
// deleted only when nothing depends on it.

interface Client { id: string; name: string; gstin: string }

interface TwoBDoc {
  id: string;
  date: string | null;
  supplier_name: string | null;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number;
  input_igst: number;
  input_cgst: number;
  input_sgst: number;
  cess: number | null;
  bucket: string;
  reverse_charge: boolean;
  itc_available: boolean | null;
  itc_reason: string | null;
  itc_action: string;
  matched_book_id: string | null;
  imported_at: string | null;
  imported_by: string | null;
  doc_type: string;
  is_amendment: boolean;
  original_doc_number: string | null;
  original_doc_date: string | null;
  original_doc_type: string | null;
  amends_doc_id: string | null;
  amends_period: string | null;
  base_taxable_value: number | null;
  base_input_igst: number | null;
  base_input_cgst: number | null;
  base_input_sgst: number | null;
  base_cess: number | null;
  ims_reduce_required: string | null;
  declared_igst: number | null;
  declared_cgst: number | null;
  declared_sgst: number | null;
  declared_cess: number | null;
  full_2b: boolean;
}

interface BookRow {
  id: string;
  date: string | null;
  supplier_name: string | null;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number;
  input_igst: number;
  input_cgst: number;
  input_sgst: number;
  book_treatment: string;
  matched_2b_id: string | null;
  doc_type: string; // INVOICE / DEBIT_NOTE
}

// Zone 4 — pending items still open on the live ledger (reclaim not yet
// assigned / not yet booked), regardless of which period first posted them.
interface PendingBill2B {
  id: string;
  date: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number;
  input_igst: number;
  input_cgst: number;
  input_sgst: number;
  reversal_month: string | null;
  reclaim_month: string | null;
  reclaim_subtype: string | null;
  source_book_id: string | null;
  doc_type?: string | null; // from the books row that posted it, when known
}

interface PendingBillBooks {
  id: string;
  date: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  supplier_gstin: string | null;
  taxable_value: number;
  input_igst: number;
  input_cgst: number;
  input_sgst: number;
  book_entry_month: string | null;
  bill_in_2b_month: string | null;
  source_doc_id: string | null;
  // from the 2B document that posted it, when known
  doc_type?: string | null;
  is_amendment?: boolean | null;
}

// Reclaim always goes through a matching dialog — 'fromDoc' starts from a
// freshly imported 2B document (picking which pending reversed item it
// evidences the return of); 'fromPending' starts from a pending reversed
// item (picking which freshly imported document matches it).
interface ReclaimDialogState {
  mode: 'fromDoc' | 'fromPending';
  anchor: ReclaimInvoiceLite;
  anchorLabel: string;
  candidates: ReclaimInvoiceLite[];
  candidateLabel: string;
  docId?: string;
  pendingId?: string;
}

type DocInsert = TablesInsert<'twob_import_docs'>;
/** The version an amendment was counted against, as it stands now, for the line under it. */
type EarlierInfo = EarlierVersionCandidate;
type ExistingDoc = Tables<'twob_import_docs'>;

const TWOB_ACTIONS = ['MATCHED', 'INELIGIBLE', 'ITC_OF_OTHERS', 'MISMATCHED', 'NOT_IN_BOOKS', 'RECLAIM', 'HELD']
  .map((value) => ({ value, label: TWOB_ACTION_LABEL[value] }));
// RECLAIM always goes through the matching dialog (Link & Reclaim) — never a
// blind bulk-apply, since each one has to be paired to a specific pending item.
// HELD is set only by the import.
const BULK_TWOB_ACTIONS = TWOB_ACTIONS.filter((a) => a.value !== 'RECLAIM' && a.value !== 'HELD');

const BOOK_TREATMENTS = [
  { value: 'NOT_IN_2B', label: 'Not in 2B' },
  { value: 'MISMATCHED', label: 'Mismatched' },
  { value: 'NOT_ELIGIBLE', label: 'Not Eligible' },
];

// A books row is a purchase (an invoice, or a supplier's debit note booked as
// a purchase) or the client's own debit note, a purchase return. A purchase
// return has no effect until the supplier's credit note is in 2B; that 2B row
// then reduces ITC (row 5.3), so it is never posted (the firm's decision,
// 20 Oct 2026; docs §10).
const BOOK_DOC_TYPES = [
  { value: 'INVOICE', label: DOC_TYPE_LABEL.INVOICE },
  { value: 'DEBIT_NOTE', label: 'Debit note (purchase return)' },
];

const BOOK_DEBIT_NOTE_MSG = 'Debit note (purchase return): no effect on ITC until the supplier\'s credit note is in 2B. That 2B row then reduces ITC (row 5.3); Post to Reconciliation leaves this row out.';

const TONES: TwobTone[] = ['invoice', 'debit', 'credit', 'amendment'];

// The sheets that hold supplier credit notes the month counts (ITC available).
const CREDIT_NOTE_SHEETS = ['B2B-CDNR', 'B2B-CDNRA'];

const LOCKED_MSG = 'The return is filed, so this sheet is locked.';
const UNSAVED_MSG = 'Save or discard your row-action changes before importing.';

const num = (v: number | null | undefined) =>
  (v || v === 0) ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
/** Rounds to paise and drops float noise (and a negative zero) before display. */
const clean = (v: number) => (Math.abs(v) < 0.005 ? 0 : Math.round(v * 100) / 100);
const isoToDisplay = (iso: string | null) => {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const toNum = (v: string) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The first five of a list of document numbers, and how many more. */
const listNos = (nos: string[]) => `${nos.slice(0, 5).join(', ')}${nos.length > 5 ? ` and ${nos.length - 5} more` : ''}`;
/** Split a list for `.in()` filters, so a long id list never overflows the request URL. */
const chunk = <T,>(list: T[], size = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const taxOf = (f: { igst: number; cgst: number; sgst: number }) => f.igst + f.cgst + f.sgst;
type BaseField = 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess';
/** An amendment that has a base: the version Import 2B found, or counted figures staff entered. */
const hasBase = (d: TwoBDoc) => !!d.amends_doc_id
  || [d.base_taxable_value, d.base_input_igst, d.base_input_cgst, d.base_input_sgst, d.base_cess].some((v) => v !== null && v !== undefined);
/**
 * A note amendment whose earlier note type the 2B does not give, or gives as
 * the other type (a credit note revised into a debit note, or the reverse).
 * Counted figures entered for it could count with the wrong sign, so Enter
 * counted is refused and the row stays Held. Invoices and same-type notes
 * take entered figures as usual.
 */
const baseSignUnsure = (d: TwoBDoc) => d.is_amendment && docTypeOf(d) !== 'INVOICE'
  && (!d.original_doc_type || docTypeOf({ doc_type: d.original_doc_type }) !== docTypeOf(d));
const BASE_SIGN_MSG = 'Enter counted is not offered for this note amendment: the 2B does not give the earlier note\'s type, or gives the other type '
  + '(a credit note revised into a debit note, or the reverse), so figures entered here could count with the wrong sign. '
  + 'Keep it Held and adjust the difference by hand, or choose a treatment to count its full revised value.';
/** A new row id made here, so a row can be pointed at before it is written. */
const newDocId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
/** The message of a thrown Error or Supabase error. */
const errMsg = (err: unknown) => (err as { message?: string } | null)?.message || 'Unknown error';

interface Totals { count: number; taxable: number; igst: number; cgst: number; sgst: number }
const sumRows = (rows: { taxable_value: number; input_igst: number; input_cgst: number; input_sgst: number }[], sign = 1): Totals =>
  rows.reduce((a, r) => ({
    count: a.count + 1,
    taxable: a.taxable + sign * (r.taxable_value || 0),
    igst: a.igst + sign * (r.input_igst || 0),
    cgst: a.cgst + sign * (r.input_cgst || 0),
    sgst: a.sgst + sign * (r.input_sgst || 0),
  }), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 });
/** Books entries net: a debit note (purchase return) reduces the purchases. */
const sumBooksNet = (rows: BookRow[]): Totals => {
  const plus = sumRows(rows.filter((b) => !bookIsPurchaseReturn(b)));
  const less = sumRows(rows.filter(bookIsPurchaseReturn), -1);
  return { count: plus.count + less.count, taxable: plus.taxable + less.taxable, igst: plus.igst + less.igst, cgst: plus.cgst + less.cgst, sgst: plus.sgst + less.sgst };
};
/** Net ITC effect of 2B documents: a credit note subtracts, an amendment counts its difference. */
const sumDocs = (rows: TwoBDoc[]): Totals =>
  rows.reduce((a, d) => {
    const e = signedEffect(d);
    return { count: a.count + 1, taxable: a.taxable + e.taxable, igst: a.igst + e.igst, cgst: a.cgst + e.cgst, sgst: a.sgst + e.sgst };
  }, { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 });

/** A pending ledger item as its type badge reads it. */
type PendingItemLike = {
  doc_type?: string | null; is_amendment?: boolean | null;
  taxable_value?: number | null; input_igst?: number | null; input_cgst?: number | null; input_sgst?: number | null;
};
/** A ledger entry that takes ITC away (a credit note, or an amendment that cut a document's tax): negative. */
const takesItcAway = (r: PendingItemLike) => (Number(r.taxable_value) || 0) < 0
  || (Number(r.input_igst) || 0) + (Number(r.input_cgst) || 0) + (Number(r.input_sgst) || 0) < 0;

/** Dense workspace table; the last column drops its right rule (the wrapper draws it). */
const TABLE_CLS = cn(WS_TABLE, '[&_tr>*:last-child]:border-r-0');
/** Bordered horizontal scroll area around a table. */
const SCROLL_CLS = 'w-full rounded-md border bg-card';

/** A 2B document as the books matcher sees it: its type, and an amendment at its revised (full) figures. */
const toTwoBLite = (d: TwoBDoc): TwoBLite => {
  const f = fullFigures(d);
  return {
    id: d.id, supplierGstin: d.supplier_gstin, supplierInvoiceNumber: d.supplier_invoice_number,
    inputIgst: f.igst, inputCgst: f.cgst, inputSgst: f.sgst, docType: d.doc_type,
  };
};

/**
 * Where a books row should stand after matching: Not in 2B (unpaired), or
 * Mismatched and paired to that 2B document. A row that matches within ₹10
 * (ALREADY_IN_2B) keeps what it has; the caller warns.
 */
const nextPairing = (b: BookRow, res: ClassifyResult) => {
  if (res.classification === 'NOT_IN_2B') return { treatment: 'NOT_IN_2B', matched2bId: null as string | null };
  if (res.classification === 'MISMATCHED') return { treatment: 'MISMATCHED', matched2bId: res.match?.id ?? null };
  return { treatment: b.book_treatment, matched2bId: b.matched_2b_id };
};

/** "2B has credit note CN/12 from this supplier; is this row your debit note for it?" */
const otherTypeMessage = (b: BookRow, other: TwoBDoc) => {
  const otherType = docTypeOf(other);
  const what = DOC_TYPE_LABEL[otherType].toLowerCase();
  const no = other.supplier_invoice_number || '';
  if (otherType === 'CREDIT_NOTE') {
    return `2B has credit note ${no} from this supplier. If this row is your debit note (purchase return) for it, change its Type to Debit note (purchase return) to pair it.`;
  }
  if (docTypeOf(b) === 'DEBIT_NOTE') {
    return `2B has ${what} ${no} from this supplier, which adds ITC. A debit note (purchase return) pairs only with the supplier's credit note; if this row is that purchase, change its Type to Invoice.`;
  }
  return `2B has the supplier's debit note ${no}; if this row is that debit note, enter its number exactly as 2B shows it to pair it.`;
};

/** Which KPI tone each 2B action reads as (same meaning as the classification). */
const ACTION_TONE: Record<string, 'ok' | 'warn' | 'error' | 'neutral'> = {
  MATCHED: 'ok',
  MISMATCHED: 'warn',
  NOT_IN_BOOKS: 'error',
  INELIGIBLE: 'neutral',
  ITC_OF_OTHERS: 'neutral',
  RECLAIM: 'neutral',
  HELD: 'warn',
};

/** A KPI tile that also acts as a filter toggle. */
const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);

const Import2BTab: React.FC = () => {
  const { user, isStaffRole, canWork2BImport, canDelete2BRows } = useAuth();
  const { selectedClientId: selectedClient, setSelectedClientId: setSelectedClient } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();

  const [clients, setClients] = useState<Client[]>([]);
  const [twoBDocs, setTwoBDocs] = useState<TwoBDoc[]>([]);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [rcmHidden, setRcmHidden] = useState(0);
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [importerName, setImporterName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The earlier versions this month's amendments amend (by id): their period
  // and current treatment, for the line under each amendment.
  const [earlierById, setEarlierById] = useState<Record<string, EarlierInfo>>({});

  // Zone 4 — items already posted to the ledger, still awaiting a reclaim /
  // book-entry decision for this client + month.
  const [pendingBills2B, setPendingBills2B] = useState<PendingBill2B[]>([]);
  const [pendingBillsBooks, setPendingBillsBooks] = useState<PendingBillBooks[]>([]);
  const [expensedOutItems, setExpensedOutItems] = useState<PendingBill2B[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [lastPosted, setLastPosted] = useState<{ at: string; version: number | null } | null>(null);
  const [reclaimDialog, setReclaimDialog] = useState<ReclaimDialogState | null>(null);
  // Zone 4's three sub-tables can each run to dozens of rows — collapsible,
  // open by default.
  const [zone4Open, setZone4Open] = useState({ reclaim: true, bookEntry: true, expensedOut: true });
  // Zone 1 (imported 2B) and Zone 2 (books register) are the biggest tables
  // on this page — collapsible for the same reason as Zone 4.
  const [zone1Open, setZone1Open] = useState(true);
  const [zone2Open, setZone2Open] = useState(true);

  // Multi-select + bulk apply (2B table)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState('');
  // Column header filters (2B table); type is a kind of document (the legend chips toggle it too).
  const [filters, setFilters] = useState<{ supplier: string; invoice: string; gstin: string; action: string; type: '' | TwobTone }>(
    { supplier: '', invoice: '', gstin: '', action: '', type: '' },
  );

  // Row-action edits are staged here (docId -> new itc_action) rather than
  // written on every dropdown change — "Save changes" below commits the
  // batch. RECLAIM is the one exception: it always goes straight through the
  // matching dialog (see handleDocActionChange), since that's a deliberate,
  // evidence-confirmed action, not a routine classification pick.
  const [pendingActions, setPendingActions] = useState<Record<string, string>>({});
  const [isSavingActions, setIsSavingActions] = useState(false);
  const pendingActionsRef = useRef(pendingActions);
  pendingActionsRef.current = pendingActions;

  const isStaff = isStaffRole();
  // The superadmin may add, edit and delete on every working sheet (firm's
  // decision, 13 Oct 2026), a filed period included.
  const isSuperadmin = user?.role === 'superadmin';
  const editLocked = isLocked && !isSuperadmin;
  const readOnly = editLocked || !isStaff;
  // While an import runs, every control that writes is off (and each write
  // checks again, importRunning): the merge must not undo a change made since
  // it read the month.
  const writeLocked = readOnly || isImporting;
  const confirm = useConfirm();

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let d = new Date(startDate);
    while (d <= endDate) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      months.push({ value: `${mm}/${d.getFullYear()}`, label: `${names[d.getMonth()]} ${d.getFullYear()}` });
      d.setMonth(d.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  const fetchClients = useCallback(async () => {
    const { data } = await supabase.from('clients').select('id, name, gstin').order('name');
    setClients(data || []);
  }, []);

  // The selection as of the latest render, and a counter of loads: a load
  // asked for by work that began under another client or month (an import
  // still running when the selection changed) is dropped, and so is a reply
  // overtaken by a newer load, so one client's rows never show under another.
  const selectionRef = useRef({ client: selectedClient, month: selectedMonth });
  selectionRef.current = { client: selectedClient, month: selectedMonth };
  const loadSeq = useRef(0);

  const fetchAll = useCallback(async () => {
    if (selectionRef.current.client !== selectedClient || selectionRef.current.month !== selectedMonth) return;
    const seq = ++loadSeq.current;
    const overtaken = () => seq !== loadSeq.current;
    setSelected(new Set());
    setBulkValue('');
    if (!selectedClient || !selectedMonth) {
      setTwoBDocs([]); setBooks([]); setRcmHidden(0); setLastImportedAt(null); setImporterName(null); setIsLocked(false);
      setPendingBills2B([]); setPendingBillsBooks([]); setExpensedOutItems([]); setLastPosted(null); setEarlierById({});
      return;
    }
    setIsLoading(true);
    try {
      const [docs, rcmRes, booksRes, filingRes, pending2BRes, pendingBooksRes, expensedOutRes, lastVersionRes] = await Promise.all([
        // Paged: a large client's month can pass PostgREST's 1000-row cap.
        fetchAllRows<TwoBDoc>('twob_import_docs', '*', (q) => q
          .eq('client_id', selectedClient).eq('period_month', selectedMonth)
          .eq('reverse_charge', false).order('date').order('id')),
        supabase.from('twob_import_docs').select('id', { count: 'exact', head: true })
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).eq('reverse_charge', true),
        supabase.from('books_register').select('*')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).order('created_at'),
        supabase.from('filing_status').select('is_locked')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth)
          .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed').maybeSingle(),
        // Zone 4 — still-open ledger items for this period (reclaim not yet
        // assigned / not yet booked), whichever period first posted them.
        supabase.from('bills_not_in_2b').select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype, source_book_id')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).is('reclaim_month', null).order('date'),
        supabase.from('bills_not_in_books').select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, book_entry_month, bill_in_2b_month, source_doc_id')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).is('book_entry_month', null).order('date'),
        // Expensed out — kept separately so a mistaken write-off can be undone.
        supabase.from('bills_not_in_2b').select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype, source_book_id')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).eq('reclaim_subtype', 'EXPENSE_OUT').order('date'),
        supabase.from('twob_versions').select('updated_at, version_number')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).eq('is_current', true).maybeSingle(),
      ]);

      // The type of each pending reversed item, from the books row that posted
      // it (carried-forward copies have none, and read as invoices).
      const pending2B = (pending2BRes.data || []) as PendingBill2B[];
      const expensedOut = (expensedOutRes.data || []) as PendingBill2B[];
      const bookIds = [...new Set([...pending2B, ...expensedOut].map((r) => r.source_book_id).filter((v): v is string => !!v))];
      const bookType = new Map<string, string>();
      for (const part of chunk(bookIds)) {
        const { data } = await supabase.from('books_register').select('id, doc_type').in('id', part);
        (data || []).forEach((b) => bookType.set(b.id, b.doc_type));
      }
      const withType = (r: PendingBill2B): PendingBill2B => ({ ...r, doc_type: r.source_book_id ? bookType.get(r.source_book_id) ?? null : null });
      // And of each item awaiting book entry, from the 2B document that posted
      // it (a debit note, a credit note, or an amendment's difference).
      const pendingBooks = (pendingBooksRes.data || []) as PendingBillBooks[];
      const sourceDocIds = [...new Set(pendingBooks.map((r) => r.source_doc_id).filter((v): v is string => !!v))];
      const sourceType = new Map<string, { doc_type: string; is_amendment: boolean }>();
      for (const part of chunk(sourceDocIds)) {
        const { data } = await supabase.from('twob_import_docs').select('id, doc_type, is_amendment').in('id', part);
        (data || []).forEach((d) => sourceType.set(d.id, { doc_type: d.doc_type, is_amendment: d.is_amendment }));
      }

      // The earlier versions this month's amendments amend, as they stand now.
      const amendsIds = [...new Set(docs.map((d) => d.amends_doc_id).filter((v): v is string => !!v))];
      const earlier: Record<string, EarlierInfo> = {};
      try {
        for (const part of chunk(amendsIds)) {
          const rows = await fetchAllRows<EarlierInfo>('twob_import_docs', EARLIER_VERSION_COLUMNS, (q) => q.in('id', part).order('id'));
          rows.forEach((e) => { earlier[e.id] = e; });
        }
      } catch {
        // Only the lines under the amendments read these; the rows still load.
      }

      if (overtaken()) return;
      setTwoBDocs(docs);
      setEarlierById(earlier);
      setRcmHidden(rcmRes.count || 0);
      setBooks((booksRes.data || []) as BookRow[]);
      // A merge keeps rows from earlier imports, so the latest stamp is the last import.
      const latest = docs.reduce<TwoBDoc | null>((a, d) => (!a || (d.imported_at || '') > (a.imported_at || '') ? d : a), null);
      setLastImportedAt(latest?.imported_at ?? null);
      setIsLocked(!!filingRes.data?.is_locked);
      setPendingBills2B(pending2B.map(withType));
      setPendingBillsBooks(pendingBooks.map((r) => ({ ...r, ...(r.source_doc_id ? sourceType.get(r.source_doc_id) : undefined) })));
      setExpensedOutItems(expensedOut.map(withType));
      setLastPosted(lastVersionRes.data ? { at: lastVersionRes.data.updated_at as string, version: lastVersionRes.data.version_number } : null);

      const importedById = latest?.imported_by ?? null;
      if (importedById) {
        const { data: prof } = await supabase.from('profiles').select('first_name').eq('user_id', importedById).maybeSingle();
        if (!overtaken()) setImporterName(prof?.first_name ?? null);
      } else {
        setImporterName(null);
      }
    } catch (err: any) {
      if (!overtaken()) toast.error('Failed to load: ' + err.message);
    } finally {
      if (!overtaken()) setIsLoading(false);
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchAll(); }, [fetchAll]);
  // Switching client/month leaves any staged-but-unsaved row actions behind —
  // warn rather than silently drop them. Scoped to this effect (not fetchAll
  // itself) so a post-Save refresh doesn't also trip this warning.
  useEffect(() => {
    if (Object.keys(pendingActionsRef.current).length > 0) {
      toast.warning('Unsaved row-action changes were discarded — save before switching client/month next time.');
    }
    setPendingActions({});
  }, [selectedClient, selectedMonth]);

  const twoBLites: TwoBLite[] = useMemo(() => twoBDocs.map(toTwoBLite), [twoBDocs]);

  // The row's current action — a staged, unsaved pick if there is one,
  // otherwise whatever's in the DB.
  const effectiveAction = useCallback((d: TwoBDoc) => pendingActions[d.id] ?? d.itc_action, [pendingActions]);
  const pendingCount = Object.keys(pendingActions).length;

  const filteredDocs = useMemo(() => twoBDocs.filter((d) => {
    if (filters.supplier && !(d.supplier_name || '').toLowerCase().includes(filters.supplier.toLowerCase())) return false;
    if (filters.invoice && !(d.supplier_invoice_number || '').toLowerCase().includes(filters.invoice.toLowerCase())) return false;
    if (filters.gstin && !(d.supplier_gstin || '').toLowerCase().includes(filters.gstin.toLowerCase())) return false;
    if (filters.action && effectiveAction(d) !== filters.action) return false;
    if (filters.type && docTone(d) !== filters.type) return false;
    return true;
  }), [twoBDocs, filters, effectiveAction]);

  const anyFilter = filters.supplier || filters.invoice || filters.gstin || filters.action || filters.type;
  const allFilteredSelected = filteredDocs.length > 0 && filteredDocs.every((d) => selected.has(d.id));
  const docsTotals = useMemo(() => sumDocs(filteredDocs), [filteredDocs]);
  const docsCounted = useMemo(() => sumDocs(filteredDocs.filter((d) => isCountedAction(effectiveAction(d)))), [filteredDocs, effectiveAction]);
  const toneCounts = useMemo(() => {
    const c: Record<TwobTone, number> = { invoice: 0, debit: 0, credit: 0, amendment: 0 };
    twoBDocs.forEach((d) => { c[docTone(d)] += 1; });
    return c;
  }, [twoBDocs]);

  // ---- Amendments follow the version they amend -------------------------------
  // An amendment's base_* and treatment are taken from the version it amends
  // (amends_doc_id) as that version stood when it was counted. When the
  // version is re-treated (Save, a books pairing, a re-import's sheet move),
  // the amendments counted against it are brought in line: the base from its
  // treatment now (baseFrom), and the treatment re-derived (refollowAction)
  // when it still follows the version's treatment before, link by link down a
  // chain. A filed month is not rewritten: its rows are returned to be named,
  // and their line warns. `before`: earlier version id → its treatment before
  // the change. `alsoIds`: amendments to bring in line whatever changed
  // (their base only when in `keepAction`, a treatment staff just chose).
  // `skip`: rows already written in line. Each write applies only if the row
  // still holds the treatment read, so a change made meanwhile stays.
  type SyncedAmendment = { doc: ExistingDoc; action: string };
  const syncAmendments = async (
    before: Map<string, string>,
    opts: { alsoIds?: string[]; keepAction?: Set<string>; skip?: Set<string> } = {},
  ): Promise<{ changed: SyncedAmendment[]; filed: ExistingDoc[] }> => {
    const changed: SyncedAmendment[] = [];
    const filed: ExistingDoc[] = [];
    const seen = new Set<string>(opts.skip || []);
    let pending = before;
    let also = opts.alsoIds || [];
    for (let depth = 0; depth < 6 && (pending.size > 0 || also.length > 0); depth += 1) {
      const rows = new Map<string, ExistingDoc>();
      for (const part of chunk([...pending.keys()])) {
        (await fetchAllRows<ExistingDoc>('twob_import_docs', '*', (q) => q.in('amends_doc_id', part).order('id')))
          .forEach((r) => rows.set(r.id, r));
      }
      for (const part of chunk(also)) {
        (await fetchAllRows<ExistingDoc>('twob_import_docs', '*', (q) => q.in('id', part).not('amends_doc_id', 'is', null).order('id')))
          .forEach((r) => rows.set(r.id, r));
      }
      const list = [...rows.values()].filter((r) => !seen.has(r.id) && !!r.amends_doc_id);
      list.forEach((r) => seen.add(r.id));
      const earlier = new Map<string, EarlierVersionCandidate>();
      for (const part of chunk([...new Set(list.map((r) => r.amends_doc_id as string))])) {
        (await fetchAllRows<EarlierVersionCandidate>('twob_import_docs', EARLIER_VERSION_COLUMNS, (q) => q.in('id', part).order('id')))
          .forEach((e) => earlier.set(e.id, e));
      }
      const filedKeys = new Set<string>();
      for (const clientId of [...new Set(list.map((r) => r.client_id))]) {
        const months = [...new Set(list.filter((r) => r.client_id === clientId).map((r) => r.period_month))];
        const { data, error } = await supabase.from('filing_status').select('period_month, is_locked')
          .eq('client_id', clientId).in('period_month', months)
          .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed');
        if (error) throw error;
        (data || []).filter((f) => f.is_locked).forEach((f) => filedKeys.add(`${clientId}|${f.period_month}`));
      }
      const next = new Map<string, string>();
      for (const a of list) {
        const e = earlier.get(a.amends_doc_id as string);
        if (!e) continue;
        const base = baseFrom(e, a);
        const was = pending.get(e.id);
        const action = opts.keepAction?.has(a.id) || was === undefined
          ? a.itc_action
          : refollowAction(actionInputOf(a), a.itc_action, e, [was]);
        if (sameBase(base, a) && action === a.itc_action) continue;
        if (filedKeys.has(`${a.client_id}|${a.period_month}`)) { filed.push(a); continue; }
        const { data, error } = await supabase.from('twob_import_docs')
          .update({ ...base, itc_action: action, updated_by: user?.id, updated_at: new Date().toISOString() })
          .eq('id', a.id).eq('itc_action', a.itc_action).select('id');
        if (error) throw error;
        if (!data || data.length === 0) continue;
        changed.push({ doc: a, action });
        if (action !== a.itc_action) next.set(a.id, a.itc_action);
      }
      pending = next;
      also = [];
    }
    return { changed, filed };
  };

  // Names what syncAmendments did: the amendments brought in line (and the
  // months to post again, where one is Not in Books before or after: it moved
  // to or from Not in Books, or its base changed, and its posted entry holds
  // revised minus base), and the ones in a filed month that were left as
  // counted. Every changed amendment had its treatment or its base rewritten
  // (syncAmendments skips one that keeps both).
  const reportSynced = (r: { changed: SyncedAmendment[]; filed: ExistingDoc[] }) => {
    const label = (d: ExistingDoc) => `${d.supplier_invoice_number || '(no number)'} (${periodMonthLabel(d.period_month) || d.period_month})`;
    if (r.changed.length > 0) {
      const repost = [...new Set(r.changed
        .filter(({ doc, action }) => action === 'NOT_IN_BOOKS' || doc.itc_action === 'NOT_IN_BOOKS')
        .map(({ doc }) => periodMonthLabel(doc.period_month) || doc.period_month))];
      toast.info(
        `${plural(r.changed.length, 'amendment')} counted against a re-treated document now ${r.changed.length === 1 ? 'counts' : 'count'} against its treatment as it stands: `
        + `${listNos(r.changed.map(({ doc }) => label(doc)))}.`
        + (repost.length ? ` A Not in Books entry changed: Post to Reconciliation again for ${repost.join(', ')}.` : ''),
        { duration: 20000 },
      );
    }
    if (r.filed.length > 0) {
      toast.warning(
        `${plural(r.filed.length, 'amendment')} counted against a re-treated document ${r.filed.length === 1 ? 'is' : 'are'} in a filed month and ${r.filed.length === 1 ? 'was' : 'were'} not rewritten: `
        + `${listNos(r.filed.map(label))}. ${r.filed.length === 1 ? 'It still counts' : 'They still count'} against the earlier treatment; adjust the difference by hand in a later return.`,
        { duration: 30000 },
      );
    }
  };

  // ---- Books pairing ---------------------------------------------------------
  // Unpair a 2B document from a books row (the row was deleted, re-matched
  // elsewhere, or found Not in 2B). A document the pairing had made Mismatched
  // goes back to Matched; any other treatment staff picked stays. Skipped when
  // the document has since been paired to another books row: checked in the
  // write itself (only a row still paired to this books row, or to none, is
  // touched), so a stale copy of the documents cannot undo a newer pairing.
  const releaseDoc = async (docId: string, bookId: string, docs: TwoBDoc[]) => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc || (doc.matched_book_id && doc.matched_book_id !== bookId)) return;
    const { error } = await supabase.from('twob_import_docs').update({
      matched_book_id: null,
      ...(doc.itc_action === 'MISMATCHED' ? { itc_action: 'MATCHED' } : {}),
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', docId).or(`matched_book_id.eq.${bookId},matched_book_id.is.null`);
    if (error) throw error;
  };

  // Pair a 2B document to a books row that differs from it by more than ₹10.
  // The document turns Mismatched (claimed at the 2B value) unless staff gave
  // it a treatment that does not claim it here (Ineligible, ITC of Others,
  // Reclaim, Held), which a books entry must not overturn. A document leaving
  // Not in Books this way brings the amendments counted against it in line
  // (syncAmendments); Matched and Mismatched read the same to an amendment,
  // so a pairing between them, or a release (releaseDoc), changes none.
  const pairDoc = async (docId: string, bookId: string, docs: TwoBDoc[]) => {
    const doc = docs.find((d) => d.id === docId);
    const claimable = !doc || ['MATCHED', 'MISMATCHED', 'NOT_IN_BOOKS'].includes(doc.itc_action);
    const { error } = await supabase.from('twob_import_docs').update({
      matched_book_id: bookId,
      ...(claimable ? { itc_action: 'MISMATCHED' } : {}),
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', docId);
    if (error) throw error;
    if (doc?.itc_action === 'NOT_IN_BOOKS') {
      try {
        reportSynced(await syncAmendments(new Map([[docId, 'NOT_IN_BOOKS']])));
      } catch (err) {
        toast.error(`${doc.supplier_invoice_number || 'A document'} left Not in Books, but the amendments counted against it could not be brought in line: ${errMsg(err)}. Re-import their month.`);
      }
    }
  };

  // Move a books row from its current pairing to `next`: release the old 2B
  // document, pair the new one, then save the row. `docs` is the caller's own
  // copy of the month's documents; it is kept up to date with each write, so
  // the next books row in the same pass sees this one's pairing.
  const applyPairing = async (b: BookRow, next: { treatment: string; matched2bId: string | null }, docs: TwoBDoc[]) => {
    const patchDoc = (id: string, patch: Partial<TwoBDoc>) => {
      const i = docs.findIndex((d) => d.id === id);
      if (i >= 0) docs[i] = { ...docs[i], ...patch };
    };
    if (b.matched_2b_id && b.matched_2b_id !== next.matched2bId) {
      const doc = docs.find((d) => d.id === b.matched_2b_id);
      const released = !!doc && (!doc.matched_book_id || doc.matched_book_id === b.id);
      await releaseDoc(b.matched_2b_id, b.id, docs);
      if (released && doc) patchDoc(doc.id, { matched_book_id: null, itc_action: doc.itc_action === 'MISMATCHED' ? 'MATCHED' : doc.itc_action });
    }
    if (next.matched2bId && next.matched2bId !== b.matched_2b_id) {
      const doc = docs.find((d) => d.id === next.matched2bId);
      await pairDoc(next.matched2bId, b.id, docs);
      if (doc) patchDoc(doc.id, { matched_book_id: b.id, itc_action: ['MATCHED', 'MISMATCHED', 'NOT_IN_BOOKS'].includes(doc.itc_action) ? 'MISMATCHED' : doc.itc_action });
    }
    const { error } = await supabase.from('books_register').update({
      book_treatment: next.treatment, matched_2b_id: next.matched2bId,
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', b.id);
    if (error) throw error;
  };

  const bookLite = (b: BookRow) => ({
    supplierGstin: b.supplier_gstin, supplierInvoiceNumber: b.supplier_invoice_number,
    inputIgst: b.input_igst, inputCgst: b.input_cgst, inputSgst: b.input_sgst, docType: b.doc_type,
  });

  // After an import: re-match the month's Not in 2B and Mismatched books rows
  // against the 2B documents now in the month, and save the rows whose
  // treatment or pairing changed. Not Eligible rows are a staff decision that
  // does not depend on 2B, so they are left alone, and so is a treatment
  // staff picked in the Treatment select against the matcher: Mismatched with
  // no 2B document paired (the matcher always pairs one), or Not in 2B on a
  // row still paired to a document in the month (staff overruled that
  // pairing). Those are named when the matcher reads them otherwise, never
  // rewritten. `notIn2B` are documents kept although the file no longer has
  // them: never paired.
  const rematchBooks = async (clientId: string, month: string, notIn2B: Set<string> = new Set()) => {
    const [docs, rows] = await Promise.all([
      fetchAllRows<TwoBDoc>('twob_import_docs', '*', (q) => q
        .eq('client_id', clientId).eq('period_month', month).eq('reverse_charge', false).order('id')),
      fetchAllRows<BookRow>('books_register', '*', (q) => q
        .eq('client_id', clientId).eq('period_month', month).order('id')),
    ]);
    const lites = docs.filter((d) => !notIn2B.has(d.id)).map(toTwoBLite);
    const live = new Set(lites.map((l) => l.id));
    let changed = 0;
    const nowIn2B: string[] = [];
    const otherType: string[] = [];
    const keptByHand: string[] = [];
    for (const b of rows) {
      if (b.book_treatment !== 'NOT_IN_2B' && b.book_treatment !== 'MISMATCHED') continue;
      if (!b.supplier_gstin || !b.supplier_invoice_number) continue;
      const res = classifyBookAgainst2b(bookLite(b), lites);
      if (res.classification === 'ALREADY_IN_2B' && b.book_treatment === 'NOT_IN_2B') nowIn2B.push(b.supplier_invoice_number);
      if (res.otherTypeHint) otherType.push(b.supplier_invoice_number);
      const next = nextPairing(b, res);
      if (next.treatment === b.book_treatment && next.matched2bId === b.matched_2b_id) continue;
      const byHand = (b.book_treatment === 'MISMATCHED' && !b.matched_2b_id)
        || (b.book_treatment === 'NOT_IN_2B' && !!b.matched_2b_id && live.has(b.matched_2b_id));
      if (byHand) {
        // Overruling the same pairing again is what staff already decided against.
        if (!(b.book_treatment === 'NOT_IN_2B' && next.matched2bId === b.matched_2b_id)) keptByHand.push(b.supplier_invoice_number);
        continue;
      }
      await applyPairing(b, next, docs);
      changed += 1;
    }
    return { changed, nowIn2B, otherType, keptByHand };
  };

  // ---- Import ----------------------------------------------------------------
  const handleImportClick = () => {
    if (!canWork2BImport()) { toast.error('Needs the Import 2B & post permission — ask a GST Manager to add it to your position'); return; }
    if (!selectedClient || !selectedMonth) { toast.error('Select a client and month first'); return; }
    if (editLocked) { toast.error(LOCKED_MSG); return; }
    if (pendingCount > 0) { toast.error(UNSAVED_MSG); return; }
    fileInputRef.current?.click();
  };

  // Shared import path — used by both the manual file picker and the extension's
  // "Pull from portal" hand-off (a portal-downloaded .xlsx, reconstructed to a File).
  // The import MERGES into the month (see the note at the top of this file).
  // One import at a time: on this page (a second Pull result, or a double
  // click, while the first waits on a confirm), and per client and month
  // across this browser's tabs, since the portal pull's result reaches every
  // open tab and two merges of one month would insert every document twice.
  const importingRef = useRef(false);
  const importLockName = (clientId: string, month: string) => `gstk-import2b:${clientId}:${month}`;
  // An import of the selected month is running, on this page or in another
  // tab of this browser. Every write on the page waits for it: the merge
  // writes what it read at its start, and must not undo a change made since.
  const importRunning = async () => {
    if (importingRef.current) return true;
    if (!selectedClient || !selectedMonth) return false;
    try {
      const held = (await navigator.locks?.query?.())?.held || [];
      return held.some((l) => l.name === importLockName(selectedClient, selectedMonth));
    } catch {
      return false;
    }
  };
  const IMPORT_RUNNING_MSG = 'This month is being imported, posted, saved or deleted. Wait for that to finish, then try again.';
  // One writer of the month at a time: an import, Delete 2B, Post and Save
  // each hold this page's flag and the month's Web Lock while they write, so
  // an import refuses while one of them runs, and each of them refuses while
  // an import runs (taken after their confirm dialogs, so a pull result that
  // arrives while one is open is not missed). Returns false when refused.
  const withMonthLock = async (
    clientId: string, month: string, busyHere: string, busyElsewhere: string, fn: () => Promise<void>,
  ): Promise<boolean> => {
    if (importingRef.current) { toast.error(busyHere); return false; }
    importingRef.current = true;
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      if (!locks?.request) { await fn(); return true; }
      let ran = false;
      await locks.request(importLockName(clientId, month), { ifAvailable: true }, async (lock) => {
        if (!lock) { toast.error(busyElsewhere); return; }
        ran = true;
        await fn();
      });
      return ran;
    } finally {
      importingRef.current = false;
    }
  };
  const importFile = async (file: File) => {
    if (!file || !selectedClient || !selectedMonth) return;
    if (!canWork2BImport()) { toast.error('Needs the Import 2B & post permission — ask a GST Manager to add it to your position'); return; }
    if (Object.keys(pendingActionsRef.current).length > 0) { toast.error(UNSAVED_MSG); return; }
    const clientId = selectedClient;
    const month = selectedMonth;
    await withMonthLock(
      clientId, month,
      'An import, post, save or delete of this month is already running on this page. Wait for it to finish, then import again.',
      'This month is being imported, posted, saved or deleted in another tab. Wait for it to finish, then reload this page and import again.',
      () => runImport(file, clientId, month),
    );
  };

  const runImport = async (file: File, clientId: string, month: string) => {
    setIsImporting(true);
    try {
      // Read the filing lock afresh: the portal pull hands its file straight
      // here, possibly before this page has loaded the month. A failed read
      // stops the import rather than assume the month is open.
      const { data: filed, error: filedErr } = await supabase.from('filing_status').select('is_locked')
        .eq('client_id', clientId).eq('period_month', month)
        .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed');
      if (filedErr) { toast.error(`Could not check whether the return is filed (${filedErr.message}). Nothing was imported; try again.`); return; }
      const locked = (filed || []).some((f) => f.is_locked);
      if (locked && !isSuperadmin) { toast.error(LOCKED_MSG); return; }
      if (locked && !(await confirm({
        title: 'Import into a filed month?',
        description: `The return for ${periodMonthLabel(month) || month} is filed. Importing again can change this month's ITC Summary figures, which would then differ from the filed return.`,
        confirmText: 'Import anyway',
      }))) return;

      const result = await parseGstr2bFile(file);
      const client = clients.find((c) => c.id === clientId);

      const fileGstin = (result.header.gstin || '').toUpperCase().trim();
      const clientGstin = (client?.gstin || '').toUpperCase().trim();
      if (fileGstin && clientGstin && fileGstin !== clientGstin) {
        if (!(await confirm({ title: 'GSTIN mismatch', description: `The file's GSTIN (${fileGstin}) doesn't match ${client?.name} (${clientGstin}). Import anyway?`, confirmText: 'Import anyway' }))) {
          return;
        }
      }
      if (result.header.periodMonthKey && result.header.periodMonthKey !== month) {
        if (!(await confirm({ title: 'Period mismatch', description: `The file is for ${result.header.periodLabel || result.header.periodMonthKey}, but ${month} is selected. Import anyway?`, confirmText: 'Import anyway' }))) {
          return;
        }
      }
      if (result.records.length === 0) { toast.error('No B2B documents (invoices, debit or credit notes, amendments) found in this file.'); return; }
      if (result.warnings.length > 0) {
        const more = result.warnings.length - 3;
        toast.warning(
          `${plural(result.warnings.length, 'warning')} while reading the file: ${result.warnings.slice(0, 3).join(' · ')}${more > 0 ? ` and ${more} more` : ''}.`,
          { duration: 15000 },
        );
      }

      // B2B-family sheets not read in full are named and need a yes. The
      // month's credit notes count as read (full_2b, which lets row 5.3 fill
      // itself) only when the B2B-CDNR sheet is in the file and neither credit
      // note sheet lost a row, so a partial read never replaces a typed 5.3.
      const incomplete = result.incompleteSheets;
      const notesRead = result.sheetsRead.includes('B2B-CDNR')
        && !incomplete.some((s) => CREDIT_NOTE_SHEETS.includes(s.sheet));
      if (incomplete.length > 0 && !(await confirm({
        title: 'Part of the file was not read',
        description: (
          <>
            {incomplete.map((s) => (
              <React.Fragment key={s.sheet}>
                {s.wholeSheet ? `${s.sheet}: the sheet was not read at all.` : `${s.sheet}: ${plural(s.skippedRows, 'row')} not read.`}<br />
              </React.Fragment>
            ))}
            <br />
            The warnings name the reason. Those documents will be missing from this month.
            {!notesRead && ' Row 5.3 of ITC Summary stays typed for this month, since the credit notes were not read in full.'}
            {' '}Import what was read?
          </>
        ),
        confirmText: 'Import what was read',
      }))) return;

      const batchId = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now());
      const nowIso = new Date().toISOString();
      const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

      const built = result.records.map((r) => {
        const input: DefaultActionInput = {
          reverseCharge: r.reverseCharge, bucket: r.bucket, itcAvailable: r.itcAvailable,
          docType: r.docType, isAmendment: r.isAmendment, imsReduceRequired: r.imsReduceRequired,
        };
        const row: DocInsert = {
          client_id: clientId,
          period_month: month,
          date: isoDate(r.invoiceDate),
          supplier_name: r.supplierName,
          supplier_invoice_number: r.invoiceNumber,
          supplier_gstin: r.supplierGstin,
          taxable_value: r.taxableValue,
          input_igst: r.inputIgst,
          input_cgst: r.inputCgst,
          input_sgst: r.inputSgst,
          invoice_type: r.invoiceType,
          invoice_value: r.invoiceValue,
          place_of_supply: r.placeOfSupply,
          cess: r.cess,
          gstr1_period: r.gstr1Period,
          gstr1_filing_date: isoDate(r.gstr1FilingDate),
          source: r.source,
          irn: r.irn,
          source_sheet: r.sheet,
          bucket: r.bucket,
          reverse_charge: r.reverseCharge,
          itc_available: r.itcAvailable,
          itc_reason: r.itcReason,
          doc_type: r.docType,
          is_amendment: r.isAmendment,
          original_doc_number: r.originalNumber,
          original_doc_date: isoDate(r.originalDate),
          original_doc_type: r.originalDocType,
          amends_doc_id: null,
          amends_period: null,
          ...baseFrom(null),
          ims_reduce_required: r.imsReduceRequired,
          declared_igst: r.declaredIgst,
          declared_cgst: r.declaredCgst,
          declared_sgst: r.declaredSgst,
          declared_cess: r.declaredCess,
          full_2b: notesRead,
          itc_action: defaultAction(input),
          import_batch_id: batchId,
          imported_by: user?.id,
          imported_at: nowIso,
          updated_by: user?.id,
          updated_at: nowIso,
        };
        return { row, input };
      });
      type Built = (typeof built)[number];

      // Merge with what the month already holds (RCM rows included), pairing
      // by docKey: equal dates first, then in date order when a key repeats.
      const existing = await fetchAllRows<ExistingDoc>('twob_import_docs', '*', (q) => q
        .eq('client_id', clientId).eq('period_month', month).order('id'));
      const byDate = (a: { date?: string | null }, b: { date?: string | null }) => (a.date || '').localeCompare(b.date || '');
      const existingByKey = new Map<string, ExistingDoc[]>();
      existing.forEach((e) => {
        const k = docKey(e);
        existingByKey.set(k, [...(existingByKey.get(k) || []), e]);
      });
      const incomingByKey = new Map<string, Built[]>();
      built.forEach((b) => {
        const k = docKey(b.row);
        incomingByKey.set(k, [...(incomingByKey.get(k) || []), b]);
      });
      const pairs: { b: Built; prev: ExistingDoc }[] = [];
      const fresh: Built[] = [];
      for (const [k, list] of incomingByKey) {
        const pool = [...(existingByKey.get(k) || [])];
        const rest: Built[] = [];
        list.forEach((b) => {
          const i = pool.findIndex((e) => (e.date || '') === (b.row.date || ''));
          if (i >= 0) { pairs.push({ b, prev: pool[i] }); pool.splice(i, 1); } else rest.push(b);
        });
        rest.sort((x, y) => byDate(x.row, y.row));
        pool.sort(byDate);
        rest.forEach((b, i) => (i < pool.length ? pairs.push({ b, prev: pool[i] }) : fresh.push(b)));
      }
      // New rows take their id here, so an amendment in this file can point
      // at its original in this file.
      fresh.forEach((b) => { b.row.id = newDocId(); });
      const prevOf = new Map(pairs.map(({ b, prev }) => [b, prev]));
      const idOf = (b: Built) => prevOf.get(b)?.id ?? (b.row.id as string);

      // A paired row keeps its treatment, except that a document the portal
      // has moved to the Rejected or Rule 37A reversal sheet stops being
      // claimed (Matched / Mismatched become Ineligible), and one moved back
      // to ITC available takes its usual treatment again.
      let bucketMoved = 0;
      const bucketToCheck: string[] = [];
      const afterBucketMove = (b: Built, prev: ExistingDoc, action: string) => {
        const row = b.row;
        if (prev.bucket === row.bucket || row.reverse_charge) return action;
        const wasOut = prev.bucket === 'rejected' || prev.bucket === 'reversal';
        const nowOut = row.bucket === 'rejected' || row.bucket === 'reversal';
        if (nowOut && (action === 'MATCHED' || action === 'MISMATCHED')) { bucketMoved += 1; return 'INELIGIBLE'; }
        if (wasOut && !nowOut && action === 'INELIGIBLE' && row.itc_action !== 'INELIGIBLE') { bucketMoved += 1; return row.itc_action as string; }
        // On the ledger, or a reclaim's evidence: left for staff to decide.
        if (nowOut && (action === 'NOT_IN_BOOKS' || action === 'RECLAIM')) bucketToCheck.push(row.supplier_invoice_number || '');
        return action;
      };
      const originalAction = new Map<Built, string>();
      built.forEach((b) => {
        if (b.row.is_amendment) return;
        const prev = prevOf.get(b);
        originalAction.set(b, prev ? afterBucketMove(b, prev, prev.itc_action) : (b.row.itc_action as string));
      });

      // Amendments: find the earlier version each one amends, among this
      // client's documents from earlier months (same supplier) and this
      // file's own originals (a late filer's invoice and its amendment can
      // arrive in one 2B), and count only the difference over it, following
      // its treatment. None found: HELD.
      const amendSuppliers = [...new Set(built.filter((b) => b.row.is_amendment && b.row.supplier_gstin).map((b) => b.row.supplier_gstin as string))];
      const candidates: EarlierVersionCandidate[] = [];
      for (const part of chunk(amendSuppliers)) {
        candidates.push(...await fetchAllRows<EarlierVersionCandidate>(
          'twob_import_docs', EARLIER_VERSION_COLUMNS,
          (q) => q.eq('client_id', clientId).in('supplier_gstin', part).neq('period_month', month).order('id'),
        ));
      }
      const fileOriginals = built.filter((b) => !b.row.is_amendment).map((b) => ({
        ...b.row, id: idOf(b), period_month: month, itc_action: originalAction.get(b) as string,
      }) as EarlierVersionCandidate);
      const versionPool = [...candidates, ...fileOriginals];
      const versionById = new Map(versionPool.map((c) => [c.id, c]));
      for (const b of built) {
        if (!b.row.is_amendment) continue;
        const earlier = findEarlierVersion({
          supplier_gstin: b.row.supplier_gstin ?? null, original_doc_number: b.row.original_doc_number ?? null,
          original_doc_date: b.row.original_doc_date ?? null, original_doc_type: b.row.original_doc_type, doc_type: b.row.doc_type,
        }, month, versionPool);
        Object.assign(b.row, { amends_doc_id: earlier?.id ?? null, amends_period: earlier?.period_month ?? null, ...baseFrom(earlier, b.row) });
        b.row.itc_action = defaultAction(b.input, earlier);
      }

      // A paired row takes the file's figures but keeps its id, treatment,
      // books pairing and posting stamp. An amendment keeps the version it was
      // counted against (or the base staff entered), unless a different
      // version is found now: the latest one, imported since (months imported
      // out of order), or the one Import 2B holds for an entered base. Then it
      // is counted against that one, and named. Found again, it is counted
      // against that version as it stands now: when its treatment changed
      // since the base was taken (a held one settled included), the base is
      // taken afresh, the row named, and its treatment re-derived if it still
      // followed the version's (refollowAction). One still HELD takes the
      // found version's treatment.
      let heldResolved = 0;
      const rebased: string[] = [];
      const recounted: string[] = [];
      const updates = pairs.map(({ b, prev }) => {
        const row = b.row;
        if (!row.is_amendment) {
          return {
            ...row, id: prev.id, itc_action: originalAction.get(b) as string,
            matched_book_id: prev.matched_book_id, posted_at: prev.posted_at, posted_by: prev.posted_by,
          };
        }
        const prevBase = { amends_doc_id: prev.amends_doc_id, amends_period: prev.amends_period, base_taxable_value: prev.base_taxable_value, base_input_igst: prev.base_input_igst, base_input_cgst: prev.base_input_cgst, base_input_sgst: prev.base_input_sgst, base_cess: prev.base_cess };
        const foundBase = { amends_doc_id: row.amends_doc_id, amends_period: row.amends_period, base_taxable_value: row.base_taxable_value, base_input_igst: row.base_input_igst, base_input_cgst: row.base_input_cgst, base_input_sgst: row.base_input_sgst, base_cess: row.base_cess };
        const prevHasBase = !!prev.amends_doc_id || [prev.base_taxable_value, prev.base_input_igst, prev.base_input_cgst, prev.base_input_sgst, prev.base_cess]
          .some((v) => v !== null && v !== undefined);
        let link = prevHasBase ? prevBase : foundBase;
        let action = prev.itc_action;
        const found = row.amends_doc_id ? versionById.get(row.amends_doc_id) : undefined;
        if (row.amends_doc_id && row.amends_doc_id !== prev.amends_doc_id) {
          if (prevHasBase) rebased.push(row.supplier_invoice_number || '(no number)');
          link = foundBase;
        } else if (found) {
          link = foundBase;
          if (prevHasBase && !sameBase(prevBase, foundBase)) {
            recounted.push(row.supplier_invoice_number || '(no number)');
            if (action !== 'HELD') action = refollowAction(b.input, action, found, treatmentsGiving(found, row, prevBase));
          }
        }
        if (action === 'HELD' && link.amends_doc_id) {
          const earlier = versionById.get(link.amends_doc_id);
          const next = earlier ? defaultAction(b.input, earlier) : 'HELD';
          if (next !== 'HELD') { action = next; heldResolved += 1; }
        }
        action = afterBucketMove(b, prev, action);
        return {
          ...row, ...link, id: prev.id, itc_action: action,
          matched_book_id: prev.matched_book_id, posted_at: prev.posted_at, posted_by: prev.posted_by,
        };
      });

      // What the earlier import holds that this file does not: deleted unless
      // something depends on it. A Reclaim, a Not in Books entry on the
      // ledger, a reclaim's evidence, or an amendment counted against it:
      // kept, and listed. A posting stamp alone does not keep a row (Post
      // stamps the whole month), and neither does a books pairing (a soft
      // link: the re-match below turns that books row Not in 2B), so a
      // document that has left 2B stops counting in rows 5.1 and 5.3.
      // An amendment keeps a stale document only if it stays itself: one in
      // another month, one of this month the merge still points at it (by the
      // link it writes, not the stored one), or a stale one kept in turn.
      const pairedIds = new Set(updates.map((u) => u.id));
      const stale = existing.filter((e) => !pairedIds.has(e.id));
      const staleIds = new Set(stale.map((e) => e.id));
      const writtenLink = new Map(updates.map((u) => [u.id, u.amends_doc_id ?? null]));
      const keep = new Set(stale.filter((e) => e.itc_action === 'RECLAIM').map((e) => e.id));
      const dependants: { id: string; amends_doc_id: string }[] = [];
      for (const part of chunk(stale.map((e) => e.id))) {
        const [nib, n2b, later] = await Promise.all([
          supabase.from('bills_not_in_books').select('source_doc_id').in('source_doc_id', part),
          supabase.from('bills_not_in_2b').select('reclaimed_via_doc_id').in('reclaimed_via_doc_id', part),
          supabase.from('twob_import_docs').select('id, amends_doc_id').in('amends_doc_id', part),
        ]);
        if (nib.error) throw nib.error;
        if (n2b.error) throw n2b.error;
        if (later.error) throw later.error;
        (nib.data || []).forEach((r) => r.source_doc_id && keep.add(r.source_doc_id));
        (n2b.data || []).forEach((r) => r.reclaimed_via_doc_id && keep.add(r.reclaimed_via_doc_id));
        (later.data || []).forEach((r) => { if (r.amends_doc_id) dependants.push({ id: r.id, amends_doc_id: r.amends_doc_id }); });
      }
      for (let grew = true; grew;) {
        grew = false;
        for (const r of dependants) {
          if (keep.has(r.amends_doc_id)) continue;
          if (writtenLink.has(r.id) && writtenLink.get(r.id) !== r.amends_doc_id) continue;
          if (staleIds.has(r.id) && !keep.has(r.id)) continue;
          keep.add(r.amends_doc_id);
          grew = true;
        }
      }
      const kept = stale.filter((e) => keep.has(e.id));
      const keptCounted = kept.filter((e) => isCountedAction(e.itc_action) && !e.reverse_charge);
      const toDelete = stale.filter((e) => !keep.has(e.id)).map((e) => e.id);

      // Write in an order that never leaves the month empty part-way: new rows
      // first (originals before amendments, which may point at them), then the
      // paired rows, then the stale ones. A paired row is written without the
      // treatment, books pairing and posting stamp it kept: those columns are
      // left as they stand, so a change made while this import ran (here or
      // in another session) is not undone by the merge's earlier read. A
      // treatment the import itself changes (a sheet move, a held amendment
      // settled, an amendment recounted) is written on its own, only where
      // the row still holds the treatment read. Paired rows are updated by
      // id, never upserted: one deleted while this ran (Delete 2B in another
      // browser) stays deleted, rather than coming back with the column's
      // default treatment, and is named.
      const freshRows = [...fresh.filter((b) => !b.row.is_amendment), ...fresh.filter((b) => b.row.is_amendment)].map((b) => b.row);
      for (const part of chunk(freshRows, 500)) {
        const { error } = await supabase.from('twob_import_docs').insert(part);
        if (error) throw error;
      }
      const figures = updates.map(({ itc_action, matched_book_id, posted_at, posted_by, id, ...cols }) => ({ id, cols }));
      const vanished = new Set<string>();
      let nextFigure = 0;
      let figureFailure: unknown = null;
      const writeFigures = async () => {
        while (figureFailure === null && nextFigure < figures.length) {
          const { id, cols } = figures[nextFigure++];
          try {
            const { data, error } = await supabase.from('twob_import_docs').update(cols).eq('id', id).select('id');
            if (error) { figureFailure = error; return; }
            if (!data || data.length === 0) vanished.add(id);
          } catch (err) {
            figureFailure = err;
            return;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, figures.length) }, writeFigures));
      if (figureFailure !== null) throw figureFailure;
      const actionChanges = updates
        .map((u, i) => ({ id: u.id, from: pairs[i].prev.itc_action, to: u.itc_action }))
        .filter((c) => c.from !== c.to && !vanished.has(c.id));
      const treatmentMoved = new Map<string, string>();
      for (const c of actionChanges) {
        const { data, error } = await supabase.from('twob_import_docs')
          .update({ itc_action: c.to }).eq('id', c.id).eq('itc_action', c.from).select('id');
        if (error) throw error;
        if (data && data.length > 0) treatmentMoved.set(c.id, c.from);
      }
      // Kept rows from an earlier, complete import must not claim this
      // month's notes as read.
      if (!notesRead) {
        const { error } = await supabase.from('twob_import_docs').update({ full_2b: false })
          .eq('client_id', clientId).eq('period_month', month).eq('full_2b', true);
        if (error) throw error;
      }
      for (const part of chunk(toDelete)) {
        const { error } = await supabase.from('twob_import_docs').delete().in('id', part);
        if (error) throw error;
      }

      // Counts by kind, as the page shows them (RCM hidden).
      const landed = updates.filter((u) => !vanished.has(u.id));
      const written = [...freshRows, ...landed];
      const shown = written.filter((r) => !r.reverse_charge);
      const originals = shown.filter((r) => !r.is_amendment);
      const amendments = shown.filter((r) => r.is_amendment);
      const held = amendments.filter((r) => r.itc_action === 'HELD').length;
      const rcm = result.records.filter((r) => r.reverseCharge).length;
      const keptCount = landed.filter((u) => !u.reverse_charge).length;
      toast.success(
        `Imported ${plural(originals.filter((r) => r.doc_type === 'INVOICE').length, 'invoice')}, `
        + `${plural(originals.filter((r) => r.doc_type === 'DEBIT_NOTE').length, 'debit note')}, `
        + `${plural(originals.filter((r) => r.doc_type === 'CREDIT_NOTE').length, 'credit note')} and `
        + `${plural(amendments.length, 'amendment')}${held ? ` (${held} held, not counted until you choose a treatment)` : ''}.`
        + (keptCount ? ` Kept ${plural(keptCount, 'existing classification')}.` : '')
        + (heldResolved ? ` ${plural(heldResolved, 'held amendment')} now follow the earlier version found.` : '')
        + (bucketMoved ? ` ${plural(bucketMoved, 'document')} moved sheet and took the new sheet's treatment.` : '')
        + (toDelete.length ? ` Removed ${plural(toDelete.length, 'document')} no longer in 2B.` : '')
        + (rcm ? ` ${rcm} RCM hidden (RCM Summary).` : '')
        + (!notesRead ? ' Credit notes not read in full: row 5.3 stays typed for this month.' : ''),
        { duration: 10000 },
      );
      const list = listNos;
      if (kept.length > 0) {
        toast.warning(
          `${plural(kept.length, 'document')} from the earlier import ${kept.length === 1 ? 'is' : 'are'} not in this file but ${kept.length === 1 ? 'was' : 'were'} kept, because something depends on ${kept.length === 1 ? 'it' : 'them'} (a reclaim, a Not in Books entry on the ledger, or a later amendment): `
          + `${list(kept.map((e) => e.supplier_invoice_number || '(no number)'))}. Their treatment is unchanged`
          + (keptCounted.length ? `, so ${plural(keptCounted.length, 'Matched or Mismatched document')} still ${keptCounted.length === 1 ? 'counts' : 'count'} in ITC Summary` : '')
          + '; change it if they have left 2B.',
          { duration: 20000 },
        );
      }
      if (vanished.size > 0) {
        const gone = pairs.filter(({ prev }) => vanished.has(prev.id)).map(({ prev }) => prev.supplier_invoice_number || '(no number)');
        toast.warning(
          `${plural(vanished.size, 'document')} of this month ${vanished.size === 1 ? 'was' : 'were'} deleted (in another session) while this import ran, and ${vanished.size === 1 ? 'was' : 'were'} not brought back: `
          + `${list(gone)}. Import the file again to add ${vanished.size === 1 ? 'it' : 'them'} with ${vanished.size === 1 ? 'its' : 'their'} usual treatment.`,
          { duration: 20000 },
        );
      }
      if (bucketToCheck.length > 0) {
        toast.warning(
          `${plural(bucketToCheck.length, 'document')} moved to the Rejected or Rule 37A reversal sheet but ${bucketToCheck.length === 1 ? 'is' : 'are'} still Not in Books or Reclaim: `
          + `${list(bucketToCheck)}. Check their treatment.`,
          { duration: 20000 },
        );
      }
      if (rebased.length > 0) {
        toast.warning(
          `${plural(rebased.length, 'amendment')} now ${rebased.length === 1 ? 'counts' : 'count'} against a different earlier version than before (one imported since, or the one Import 2B holds): ${list(rebased)}. Check ${rebased.length === 1 ? 'its' : 'their'} treatment.`,
          { duration: 20000 },
        );
      }
      if (recounted.length > 0) {
        toast.warning(
          `${plural(recounted.length, 'amendment')} now ${recounted.length === 1 ? 'counts' : 'count'} against the earlier version as it stands, since its treatment changed after ${recounted.length === 1 ? 'it was' : 'they were'} counted: ${list(recounted)}. Check ${recounted.length === 1 ? 'its' : 'their'} treatment.`,
          { duration: 20000 },
        );
      }
      // An amendment the revised record makes ineligible is not claimed, but
      // the version it amends still counts in its own (often filed) month,
      // unless that version is parked Not in Books (never claimed: its ledger
      // entry is to be cleared instead) or held (counted nowhere yet).
      const prevAction = new Map(pairs.map(({ prev }) => [prev.id, prev.itc_action]));
      const baseTaxOf = (r: { base_input_igst?: number | null; base_input_cgst?: number | null; base_input_sgst?: number | null }) =>
        Math.abs(taxOf({ igst: Number(r.base_input_igst) || 0, cgst: Number(r.base_input_cgst) || 0, sgst: Number(r.base_input_sgst) || 0 }));
      const earlierActionOf = (r: { amends_doc_id?: string | null }) => (r.amends_doc_id ? versionById.get(r.amends_doc_id)?.itc_action : undefined);
      const noLongerDue = amendments.filter((r) => r.itc_action === 'INELIGIBLE' && prevAction.get(r.id as string) !== 'INELIGIBLE'
        && r.bucket === 'available' && baseTaxOf(r) >= 0.005 && earlierActionOf(r) !== 'HELD');
      const amountOf = (r: (typeof noLongerDue)[number]) => `${r.supplier_invoice_number || '(no number)'} ₹${num(clean(baseTaxOf(r)))}${r.amends_period ? ` in ${periodMonthLabel(r.amends_period)}` : ''}`;
      const toReverse = noLongerDue.filter((r) => earlierActionOf(r) !== 'NOT_IN_BOOKS');
      const toClear = noLongerDue.filter((r) => earlierActionOf(r) === 'NOT_IN_BOOKS');
      if (toReverse.length > 0) {
        toast.warning(
          `${plural(toReverse.length, 'amendment')} ${toReverse.length === 1 ? 'is' : 'are'} not claimed, since the revised document gives no ITC, but the earlier version still counts in its month: `
          + `${list(toReverse.map(amountOf))}. `
          + 'Reverse those amounts in 4B(2) by hand (or add back a credit note\'s reduction).',
          { duration: 30000 },
        );
      }
      if (toClear.length > 0) {
        toast.warning(
          `${plural(toClear.length, 'amendment')} ${toClear.length === 1 ? 'is' : 'are'} not counted, since the revised document gives no ITC, and the earlier version is parked Not in Books, never counted: `
          + `${list(toClear.map(amountOf))}. Clear ${toClear.length === 1 ? 'its' : 'their'} entry on the Not in Books ledger rather than take it into 5.2 when booked; nothing is to be reversed or added back by hand.`,
          { duration: 30000 },
        );
      }
      // An amendment that turns a document counted in rows 5.1 / 5.3 into
      // reverse charge goes to RCM Summary (hidden here); the earlier claim
      // stays in its month unless reversed by hand. Named when first linked.
      const prevLink = new Map(pairs.map(({ prev }) => [prev.id, prev.amends_doc_id]));
      const intoRcm = written.filter((r) => {
        if (!r.is_amendment || !r.reverse_charge || !r.amends_doc_id) return false;
        if (prevLink.has(r.id as string) && prevLink.get(r.id as string) === r.amends_doc_id) return false;
        const e = versionById.get(r.amends_doc_id);
        return !!e && !e.reverse_charge && isCountedAction(e.itc_action);
      });
      if (intoRcm.length > 0) {
        toast.warning(
          `${plural(intoRcm.length, 'amendment')} ${intoRcm.length === 1 ? 'turns a document' : 'turn documents'} counted in ITC Summary into reverse charge (now in RCM Summary): `
          + `${list(intoRcm.map((r) => {
            const e = versionById.get(r.amends_doc_id as string) as EarlierVersionCandidate;
            return `${r.supplier_invoice_number || '(no number)'} ₹${num(clean(Math.abs(taxOf(fullFigures(e)))))} in ${periodMonthLabel(e.period_month) || e.period_month}`;
          }))}. `
          + 'Reverse that claim in 4B(2) by hand (or add back a credit note\'s reduction).',
          { duration: 30000 },
        );
      }

      // Amendments in later months counted against an older version than one
      // this file holds (months imported out of order): named, so staff
      // re-import those months, which counts them against this one.
      try {
        const laterAmendments = (await fetchAllRows<EarlierVersionCandidate & { amends_doc_id: string | null; amends_period: string | null }>(
          'twob_import_docs',
          'id, period_month, supplier_gstin, supplier_invoice_number, original_doc_number, original_doc_date, original_doc_type, doc_type, is_amendment, itc_action, amends_doc_id, amends_period',
          (q) => q.eq('client_id', clientId).eq('is_amendment', true).neq('period_month', month).order('id'),
        )).filter((l) => periodOrder(l.period_month) > periodOrder(month));
        if (laterAmendments.length > 0) {
          const thisMonth = written.map((r) => ({ ...r, period_month: month }) as EarlierVersionCandidate);
          const outdated = laterAmendments.filter((l) => {
            const best = findEarlierVersion({
              supplier_gstin: l.supplier_gstin, original_doc_number: l.original_doc_number ?? null,
              original_doc_date: l.original_doc_date, original_doc_type: l.original_doc_type, doc_type: l.doc_type,
            }, l.period_month, thisMonth);
            if (!best || best.id === l.amends_doc_id) return false;
            return !l.amends_doc_id || !l.amends_period || periodOrder(l.amends_period) <= periodOrder(month);
          });
          if (outdated.length > 0) {
            const months = [...new Set(outdated.map((l) => periodMonthLabel(l.period_month)))].join(', ');
            toast.warning(
              `${plural(outdated.length, 'amendment')} in later months (${months}) ${outdated.length === 1 ? 'was' : 'were'} counted against an older version than one in this file, or held: `
              + `${list(outdated.map((l) => l.supplier_invoice_number || '(no number)'))}. Re-import ${outdated.length === 1 ? 'that month' : 'those months'} to count ${outdated.length === 1 ? 'it' : 'them'} against this one.`,
              { duration: 30000 },
            );
          }
        }
      } catch {
        // A check only: the import itself is done.
      }

      // Amendments in other months counted against a document whose
      // treatment this import changed (a sheet move, a held amendment
      // settled) are brought in line with it; this month's were just written
      // in line.
      if (treatmentMoved.size > 0) {
        try {
          reportSynced(await syncAmendments(treatmentMoved, { skip: new Set(written.map((r) => r.id as string)) }));
        } catch (err) {
          toast.error('2B imported, but bringing the amendments counted against its re-treated documents in line failed: ' + errMsg(err));
        }
      }

      // The books register is matched against the month's 2B, which just
      // changed. Documents kept although no longer in the file are left out.
      try {
        const re = await rematchBooks(clientId, month, new Set(kept.map((e) => e.id)));
        if (re.changed) toast.info(`Books register re-matched to the new 2B: ${plural(re.changed, 'row')} changed.`);
        if (re.nowIn2B.length) {
          toast.warning(
            `${plural(re.nowIn2B.length, 'books row')} marked Not in 2B now ${re.nowIn2B.length === 1 ? 'appears' : 'appear'} in this 2B: ${list(re.nowIn2B)}. `
            + 'Remove or re-mark them, or they will be reversed as missing.',
            { duration: 20000 },
          );
        }
        if (re.otherType.length) {
          toast.warning(
            `${plural(re.otherType.length, 'books row')} ${re.otherType.length === 1 ? 'matches' : 'match'} a 2B document of another type: ${list(re.otherType)}. Check their Type.`,
            { duration: 20000 },
          );
        }
        if (re.keptByHand.length) {
          toast.warning(
            `${plural(re.keptByHand.length, 'books row')} ${re.keptByHand.length === 1 ? 'keeps' : 'keep'} the treatment you picked, although the new 2B reads ${re.keptByHand.length === 1 ? 'it' : 'them'} otherwise: ${list(re.keptByHand)}. Check ${re.keptByHand.length === 1 ? 'it' : 'them'}.`,
            { duration: 20000 },
          );
        }
      } catch (err) {
        toast.error('2B imported, but re-matching the books register failed: ' + errMsg(err));
      }

      // Once the notes are read (full_2b), a Strict client's row 5.3 "Debit
      // Note" follows the month's 2B credit notes and is no longer typed. A
      // figure saved there that differs (typed before this import) is
      // replaced, so it is named with what 2B now gives.
      if (notesRead) {
        try {
          const [clientRes, itcRes, notes] = await Promise.all([
            supabase.from('clients').select('liberal_2b_reconciliation, builder_itc_type').eq('id', clientId).maybeSingle(),
            supabase.from('itc_summaries').select('data').eq('client_id', clientId).eq('period_month', month).maybeSingle(),
            fetchImport2BCreditNotes(clientId, month),
          ]);
          if (clientRes.error) throw clientRes.error;
          if (itcRes.error) throw itcRes.error;
          const strict = clientRes.data?.liberal_2b_reconciliation !== true && clientRes.data?.builder_itc_type !== 'NO_ITC';
          type SavedRow = { srNo?: string; igst?: unknown; cgst?: unknown; sgst?: unknown };
          const raw = itcRes.data?.data;
          const saved = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { section4A?: SavedRow[] } | null;
          const row53 = Array.isArray(saved?.section4A) ? saved.section4A.find((r) => r?.srNo === '5.3') : undefined;
          if (strict && row53) {
            const typed = { igst: Number(row53.igst) || 0, cgst: Number(row53.cgst) || 0, sgst: Number(row53.sgst) || 0 };
            const heads = ['igst', 'cgst', 'sgst'] as const;
            if (heads.some((h) => Math.abs(typed[h]) >= 0.005) && heads.some((h) => Math.abs(typed[h] - notes.total[h]) > 1)) {
              const fig = (f: { igst: number; cgst: number; sgst: number }) =>
                `₹${num(clean(taxOf(f)))} (IGST ${num(clean(f.igst))}, CGST ${num(clean(f.cgst))}, SGST ${num(clean(f.sgst))})`;
              toast.warning(
                `Row 5.3 "Debit Note" of ITC Summary was saved as ${fig(typed)}. It now follows this month's 2B credit notes: ${fig(notes.total)}. `
                + 'Anything else typed there belongs in 4B(2)(ii).',
                { duration: 30000 },
              );
            }
          }
        } catch {
          // A check only: the import itself is done.
        }
      }
      await fetchAll();
    } catch (err: any) {
      toast.error('Import failed: ' + (err?.message || 'Unknown error'));
      await fetchAll();
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (file) await importFile(file);
  };

  // ---- Pull GSTR-2B from the portal (via the browser extension) --------------
  // Always call the latest importFile from the message listener (avoids stale closures).
  const importFileRef = useRef(importFile);
  importFileRef.current = importFile;

  const [extReady, setExtReady] = useState(false);
  useEffect(() => {
    const dataUrlToFile = (dataUrl: string, name: string): File => {
      const [meta, b64] = String(dataUrl).split(',');
      const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
      const bin = atob(b64 || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], name, { type: mime });
    };
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPull2BResult) {
        const r = d.__gstkPull2BResult;
        if (!r.ok) { toast.error('Portal 2B pull: ' + (r.error || 'failed')); return; }
        if (r.clientId !== selectedClient || r.period !== selectedMonth) {
          toast.warning(`Pulled GSTR-2B is for a different client/month (${r.period}). Open that client & month to import it.`);
          return;
        }
        try {
          toast.success('GSTR-2B pulled from portal — importing…');
          importFileRef.current(dataUrlToFile(r.fileB64, r.fileName || 'GSTR2B.xlsx'));
        } catch (err: any) {
          toast.error('Could not read the pulled GSTR-2B file: ' + (err?.message || ''));
        }
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t1); clearTimeout(t2); };
  }, [selectedClient, selectedMonth]);

  const pull2BFromPortal = () => {
    if (!canWork2BImport()) { toast.error('Needs the Import 2B & post permission — ask a GST Manager to add it to your position'); return; }
    if (!selectedClient || !selectedMonth) { toast.error('Select a client and month first'); return; }
    if (editLocked) { toast.error(LOCKED_MSG); return; }
    if (pendingCount > 0) { toast.error(UNSAVED_MSG); return; }
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension, then reload this page.'); return; }
    window.postMessage({ __gstkPull2B: { clientId: selectedClient, period_month: selectedMonth } }, '*');
    toast.info('Opening the portal in a new tab — type the CAPTCHA there; the GSTR-2B will import here automatically when it finishes.');
  };

  // Deleting the month's 2B first undoes what its documents carry elsewhere,
  // as a change of treatment would: a reclaim they evidence goes back to
  // Awaiting reclaim, and the Not in Books entries they posted leave the
  // ledger. A document whose Not in Books entry is filed (locked) stays, with
  // its entry, so a re-import merges into it instead of posting the entry
  // twice. Done chunk by chunk over one list of ids: each chunk is released
  // and then deleted by the same ids, so a failure part-way leaves every
  // chunk either whole or cleanly gone.
  const deleteImported2B = async () => {
    if (readOnly || !selectedClient || !selectedMonth || twoBDocs.length === 0) return;
    if (!canDelete2BRows()) { toast.error('Needs the Delete 2B rows permission — ask a GST Manager to add it to your position'); return; }
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    if (!(await confirm({
      title: 'Delete imported 2B?',
      description: `Delete ALL imported GSTR-2B for ${selectedClientName}, ${selectedMonth}? Books entries are kept. `
        + 'Reclaims these documents evidence go back to Awaiting reclaim, and the Not in Books entries they posted to the 2B Reconciliation ledger are removed (filed or carried-forward entries stay).',
      destructive: true,
      confirmText: 'Delete',
    }))) return;
    // Under the month's lock, taken after the confirm: an import that started
    // while it was open refuses this, and one that arrives while this runs
    // is refused.
    const clientId = selectedClient;
    const month = selectedMonth;
    const ran = await withMonthLock(clientId, month, IMPORT_RUNNING_MSG, IMPORT_RUNNING_MSG, async () => {
      try {
        // Read the filing lock afresh, as an import does: the page's copy is
        // from its last load, and the return may have been filed since.
        const { data: filed, error: filedErr } = await supabase.from('filing_status').select('is_locked')
          .eq('client_id', clientId).eq('period_month', month)
          .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed');
        if (filedErr) { toast.error(`Could not check whether the return is filed (${filedErr.message}). Nothing was deleted; try again.`); return; }
        const locked = (filed || []).some((f) => f.is_locked);
        if (locked && !isSuperadmin) { toast.error(LOCKED_MSG); return; }
        if (locked && !(await confirm({
          title: 'Delete from a filed month?',
          description: `The return for ${periodMonthLabel(month) || month} is filed. Deleting its 2B can change this month's ITC Summary figures, which would then differ from the filed return.`,
          destructive: true,
          confirmText: 'Delete anyway',
        }))) return;
        const nowIso = new Date().toISOString();
        const ids = (await fetchAllRows<{ id: string }>('twob_import_docs', 'id', (q) => q
          .eq('client_id', clientId).eq('period_month', month).order('id'))).map((r) => r.id);
        let keptFiled = 0;
        for (const part of chunk(ids)) {
          const { error: relErr } = await supabase.from('bills_not_in_2b')
            .update({ reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null, updated_by: user?.id, updated_at: nowIso })
            .in('reclaimed_via_doc_id', part);
          if (relErr) throw relErr;
          const { error: nibErr } = await supabase.from('bills_not_in_books').delete()
            .in('source_doc_id', part).not('is_locked', 'is', true).not('is_carried_forward', 'is', true);
          if (nibErr) throw nibErr;
          const { data: filedRows, error: filedErr } = await supabase.from('bills_not_in_books').select('source_doc_id').in('source_doc_id', part);
          if (filedErr) throw filedErr;
          const stay = new Set((filedRows || []).map((r) => r.source_doc_id));
          const gone = part.filter((id) => !stay.has(id));
          keptFiled += part.length - gone.length;
          if (gone.length === 0) continue;
          const { error } = await supabase.from('twob_import_docs').delete().in('id', gone);
          if (error) throw error;
        }
        toast.success(keptFiled
          ? `Imported 2B cleared, except ${plural(keptFiled, 'document')} whose Not in Books entry is filed (kept with it).`
          : 'Imported 2B cleared.');
      } catch (err) {
        toast.error('Delete failed: ' + errMsg(err));
      }
    });
    if (ran) await fetchAll();
  };

  // ---- 2B doc action (single + bulk) ----------------------------------------
  // Stages a classification locally — nothing is written to twob_import_docs
  // until "Save changes" is clicked (see saveActions below). Picking the saved
  // value again un-stages the row.
  const stageDocAction = (doc: TwoBDoc, action: string) => {
    setPendingActions((prev) => {
      const next = { ...prev };
      if (action === doc.itc_action) delete next[doc.id];
      else next[doc.id] = action;
      return next;
    });
  };

  // ---- Reclaim by matching ---------------------------------------------------
  // Reclaiming previously-reversed ITC requires evidence the same invoice is
  // actually back in 2B — never a self-certified monthly pick. Both entry
  // points (a fresh 2B doc, or a pending reversed item) open the same
  // matching dialog and only commit on an exact amount match. Only an original
  // invoice or debit note can be that evidence (canEvidenceReclaim): a credit
  // note reduces ITC, and an amendment's original was in an earlier 2B.
  const toReclaimLite = (d: {
    id: string; date: string | null; supplier_name: string | null; supplier_invoice_number: string | null;
    supplier_gstin: string | null; taxable_value: number; input_igst: number; input_cgst: number; input_sgst: number;
  }): ReclaimInvoiceLite => ({
    id: d.id, date: d.date, supplierName: d.supplier_name, supplierInvoiceNumber: d.supplier_invoice_number,
    supplierGstin: d.supplier_gstin, taxableValue: d.taxable_value || 0,
    igst: d.input_igst || 0, cgst: d.input_cgst || 0, sgst: d.input_sgst || 0,
  });

  // Surface likely matches first: the same type of document (an invoice for
  // an invoice, a debit note for a debit note), then the same GSTIN with a
  // similar number, then by date.
  const sortReclaimCandidates = (
    anchor: { supplier_gstin: string | null; supplier_invoice_number: string | null; doc_type?: string | null },
    list: { lite: ReclaimInvoiceLite; docType?: string | null }[],
  ) => {
    const g = (anchor.supplier_gstin || '').toUpperCase().trim();
    const type = docTypeOf({ doc_type: anchor.doc_type });
    const score = (c: { lite: ReclaimInvoiceLite; docType?: string | null }) =>
      (docTypeOf({ doc_type: c.docType }) === type ? 0 : 2)
      + ((c.lite.supplierGstin || '').toUpperCase().trim() === g && invoiceSimilar(c.lite.supplierInvoiceNumber, anchor.supplier_invoice_number) ? 0 : 1);
    return [...list].sort((a, b) => score(a) - score(b) || (b.lite.date || '').localeCompare(a.lite.date || '')).map((c) => c.lite);
  };

  const handleDocActionChange = (doc: TwoBDoc, newAction: string) => {
    if (readOnly) return;
    if (newAction === 'RECLAIM') {
      if (!canEvidenceReclaim(doc)) {
        toast.error(`${docLabel(doc)} cannot evidence a reclaim. Only an original invoice or debit note can.`);
        return;
      }
      // Reclaim always goes straight through the matching dialog — a
      // deliberate, evidence-confirmed action, not something to stage.
      setReclaimDialog({
        mode: 'fromDoc',
        anchor: toReclaimLite(doc),
        anchorLabel: `This GSTR-2B ${docLabel(doc).toLowerCase()}`,
        candidates: sortReclaimCandidates(doc, pendingBills2B.map((p) => ({ lite: toReclaimLite(p), docType: p.doc_type }))),
        candidateLabel: 'pending reversed item',
        docId: doc.id,
      });
      return;
    }
    // Moving a currently-RECLAIM doc to something else releases its linked
    // pending item on Save (see saveActions) — nothing to do here yet.
    stageDocAction(doc, newAction);
  };

  const openReclaimFromPending = (row: PendingBill2B) => {
    const eligibleDocs = twoBDocs.filter((d) => (d.itc_action === 'MATCHED' || d.itc_action === 'MISMATCHED') && canEvidenceReclaim(d));
    setReclaimDialog({
      mode: 'fromPending',
      anchor: toReclaimLite(row),
      anchorLabel: 'Pending reversed item',
      candidates: sortReclaimCandidates(row, eligibleDocs.map((d) => ({ lite: toReclaimLite(d), docType: d.doc_type }))),
      candidateLabel: 'GSTR-2B invoice or debit note',
      pendingId: row.id,
    });
  };

  const confirmReclaim = async (pendingId: string, docId: string) => {
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const nowIso = new Date().toISOString();
    const doc = twoBDocs.find((d) => d.id === docId);
    const { error: err2B } = await supabase.from('bills_not_in_2b').update({
      reclaim_month: currentLabel, reclaim_subtype: null, reclaimed_via_doc_id: docId,
      updated_by: user?.id, updated_at: nowIso,
    }).eq('id', pendingId);
    if (err2B) { toast.error('Reclaim failed: ' + err2B.message); return; }
    const { error: errDoc } = await supabase.from('twob_import_docs').update({
      itc_action: 'RECLAIM', updated_by: user?.id, updated_at: nowIso,
    }).eq('id', docId);
    if (errDoc) { toast.error('Reclaim failed: ' + errDoc.message); return; }
    toast.success('Reclaim linked and recorded.');
    // The amendments counted against this document follow its new treatment,
    // as on Save.
    if (doc && doc.itc_action !== 'RECLAIM') {
      try {
        reportSynced(await syncAmendments(new Map([[docId, doc.itc_action]])));
      } catch (err) {
        toast.error(`Reclaim recorded, but the amendments counted against ${doc.supplier_invoice_number || 'this document'} could not be brought in line: ${errMsg(err)}. Re-import their month.`);
      }
    }
    await fetchAll();
  };

  const handleReclaimConfirm = async (candidateId: string) => {
    if (!reclaimDialog) return;
    const docId = reclaimDialog.mode === 'fromDoc' ? reclaimDialog.docId! : candidateId;
    const pendingId = reclaimDialog.mode === 'fromPending' ? reclaimDialog.pendingId! : candidateId;
    await confirmReclaim(pendingId, docId);
  };

  const toggleRow = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAllFiltered = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allFilteredSelected) filteredDocs.forEach((d) => next.delete(d.id));
    else filteredDocs.forEach((d) => next.add(d.id));
    return next;
  });

  // Bulk apply stages the action on every selected row that may take it
  // (allowedActions) and says how many it skipped and why.
  const applyBulk = () => {
    if (!bulkValue || selected.size === 0 || readOnly) return;
    const label = TWOB_ACTION_LABEL[bulkValue] || bulkValue;
    const chosen = twoBDocs.filter((d) => selected.has(d.id));
    const ok = chosen.filter((d) => allowedActions(d, d.itc_action).includes(bulkValue));
    const skipped = new Map<string, number>();
    chosen.filter((d) => !ok.includes(d)).forEach((d) => skipped.set(docLabel(d), (skipped.get(docLabel(d)) || 0) + 1));
    setPendingActions((prev) => {
      const next = { ...prev };
      ok.forEach((d) => { if (d.itc_action === bulkValue) delete next[d.id]; else next[d.id] = bulkValue; });
      return next;
    });
    if (ok.length) toast.success(`Staged ${plural(ok.length, 'row')} to ${label}. Click Save changes to commit.`);
    if (skipped.size) {
      const kinds = [...skipped].map(([k, n]) => `${plural(n, k.toLowerCase())}`).join(', ');
      toast.warning(`Skipped ${kinds}. ${label} is not offered for that kind of document.`);
    }
    setSelected(new Set());
    setBulkValue('');
  };

  // ---- Save staged row-action changes ----------------------------------------
  // An amendment with no earlier version in Import 2B and no counted figures
  // entered counts its full revised value under Matched, Mismatched or Not in
  // Books, as if the version it amends was never claimed. Save says so first.
  const saveActions = async () => {
    const entries = Object.entries(pendingActions);
    if (entries.length === 0 || readOnly || !selectedClient || !selectedMonth) return;
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const fullValue = entries
      .map(([id, action]) => ({ d: twoBDocs.find((x) => x.id === id), action }))
      .filter(({ d, action }) => !!d && d.is_amendment && !hasBase(d) && (isCountedAction(action) || action === 'NOT_IN_BOOKS'))
      .map(({ d }) => d as TwoBDoc);
    // One counted against a held amendment counts only revised less that
    // one's figures, while the held one counts nothing yet.
    const waiting = entries
      .map(([id, action]) => ({ d: twoBDocs.find((x) => x.id === id), action }))
      .filter(({ d, action }) => !!d?.amends_doc_id && earlierById[d.amends_doc_id]?.itc_action === 'HELD' && isCountedAction(action))
      .map(({ d }) => d as TwoBDoc);
    if (waiting.length > 0 && !(await confirm({
      title: 'Settle the held amendment first?',
      description: `${plural(waiting.length, 'amendment')} (${waiting.slice(0, 5).map((d) => d.supplier_invoice_number || '(no number)').join(', ')}) `
        + `${waiting.length === 1 ? 'amends' : 'amend'} a held amendment, which counts nothing yet. Counted now, ${waiting.length === 1 ? 'it claims' : 'they claim'} only the difference over that held one, so the claim stays short until it is settled.`,
      confirmText: 'Save anyway',
    }))) return;
    if (fullValue.length > 0 && !(await confirm({
      title: 'Count the full revised value?',
      description: `${plural(fullValue.length, 'amendment')} (${fullValue.slice(0, 5).map((d) => d.supplier_invoice_number || '(no number)').join(', ')}${fullValue.length > 5 ? ` and ${fullValue.length - 5} more` : ''}) `
        + `${fullValue.length === 1 ? 'has' : 'have'} no earlier version in Import 2B and no counted figures entered, so ${fullValue.length === 1 ? 'it counts its' : 'they count their'} full revised value `
        + `(₹${num(clean(fullValue.reduce((t, d) => t + taxOf(fullFigures(d)), 0)))} of tax), as if the earlier version was never claimed. `
        + 'If it was claimed before Import 2B, cancel and use "Enter counted" on the row, so only the difference counts.',
      confirmText: 'Count the full value',
    }))) return;

    // Written under the month's lock, taken after the confirms: an import
    // that started while they were open refuses this, and one that arrives
    // while this runs is refused.
    await withMonthLock(selectedClient, selectedMonth, IMPORT_RUNNING_MSG, IMPORT_RUNNING_MSG, async () => {
      setIsSavingActions(true);
      const savedIds: string[] = [];
      let wrote = false;
      const savedAction = (id: string) => twoBDocs.find((d) => d.id === id)?.itc_action;
      // The amendments counted against the saved documents follow them, and a
      // saved amendment counts against its earlier version as it stands now
      // (its base only: the treatment just chosen stays).
      const bringAmendmentsInLine = async () => {
        if (savedIds.length === 0) return;
        try {
          reportSynced(await syncAmendments(
            new Map(savedIds.map((id) => [id, savedAction(id) as string])),
            { alsoIds: savedIds.filter((id) => !!twoBDocs.find((d) => d.id === id)?.amends_doc_id), keepAction: new Set(savedIds) },
          ));
        } catch (err) {
          toast.error(`Saved, but the amendments counted against these documents could not be brought in line: ${errMsg(err)}. Re-import their month to retry.`);
        }
      };
      try {
        const nowIso = new Date().toISOString();
        // A document leaving Reclaim also releases the pending item it
        // evidences. One at a time: the item is released first, then the new
        // treatment saved. A failure in between leaves the document Reclaim
        // with nothing linked: counted nowhere (an under-claim the page shows),
        // never claimed twice.
        const leaving = entries.filter(([id, action]) => savedAction(id) === 'RECLAIM' && action !== 'RECLAIM');
        const rest = entries.filter(([id, action]) => !(savedAction(id) === 'RECLAIM' && action !== 'RECLAIM'));
        // Group by target action, in chunks, so this is a handful of round-trips
        // and a long selection never overflows the request URL.
        const byAction = new Map<string, string[]>();
        rest.forEach(([id, action]) => {
          if (!byAction.has(action)) byAction.set(action, []);
          byAction.get(action)!.push(id);
        });
        for (const [action, ids] of byAction) {
          for (const part of chunk(ids)) {
            const { error } = await supabase.from('twob_import_docs')
              .update({ itc_action: action, updated_by: user?.id, updated_at: nowIso })
              .in('id', part);
            if (error) throw error;
            savedIds.push(...part);
          }
        }
        for (const [id, action] of leaving) {
          const no = twoBDocs.find((d) => d.id === id)?.supplier_invoice_number || 'a document';
          const { error: relErr } = await supabase.from('bills_not_in_2b')
            .update({ reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null, updated_by: user?.id, updated_at: nowIso })
            .eq('reclaimed_via_doc_id', id);
          if (relErr) throw new Error(`could not unlink the reclaim of ${no}, so it stays Reclaim (${relErr.message})`);
          wrote = true;
          const { error } = await supabase.from('twob_import_docs')
            .update({ itc_action: action, updated_by: user?.id, updated_at: nowIso }).eq('id', id);
          if (error) {
            throw new Error(`the reclaim of ${no} was unlinked (the item is back in Awaiting reclaim), but its new treatment was not saved, so it counts nowhere until you save it again (${error.message})`);
          }
          savedIds.push(id);
        }
        await bringAmendmentsInLine();
        toast.success(`Saved ${entries.length} row(s).`);
        setPendingActions({});
        await fetchAll();
      } catch (err) {
        toast.error(`Save failed${savedIds.length ? ` after ${plural(savedIds.length, 'row')} saved` : ''}: ${errMsg(err)}`);
        if (savedIds.length) {
          setPendingActions((prev) => {
            const next = { ...prev };
            savedIds.forEach((id) => delete next[id]);
            return next;
          });
          await bringAmendmentsInLine();
        }
        if (savedIds.length || wrote) await fetchAll();
      } finally {
        setIsSavingActions(false);
      }
    });
  };

  // ---- Counted figures for an amendment with no earlier version ---------------
  // When the version an amendment amends is not in Import 2B (claimed before
  // the client used it, or never imported), staff enter what that version
  // counted, as base_* with no amends_doc_id. The amendment then counts only
  // the difference, as if Import 2B had found the version. Clearing them
  // returns it to counting the full revised value.
  const [baseDialog, setBaseDialog] = useState<{ doc: TwoBDoc; values: Record<BaseField, string> } | null>(null);
  const [isSavingBase, setIsSavingBase] = useState(false);
  const openBaseDialog = (d: TwoBDoc) => {
    // One with figures entered before this check opens, so they can be cleared.
    if (baseSignUnsure(d) && !hasBase(d)) { toast.error(BASE_SIGN_MSG, { duration: 15000 }); return; }
    const v = (x: number | null) => (x === null || x === undefined ? '' : String(x));
    setBaseDialog({ doc: d, values: { taxable: v(d.base_taxable_value), igst: v(d.base_input_igst), cgst: v(d.base_input_cgst), sgst: v(d.base_input_sgst), cess: v(d.base_cess) } });
  };
  const saveBase = async (clear: boolean) => {
    if (!baseDialog || readOnly) return;
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const { doc, values } = baseDialog;
    if (!clear && baseSignUnsure(doc)) { toast.error(BASE_SIGN_MSG, { duration: 15000 }); return; }
    const val = (k: BaseField) => (clear ? null : toNum(values[k]));
    if (!clear && (['taxable', 'igst', 'cgst', 'sgst', 'cess'] as BaseField[]).some((k) => toNum(values[k]) < 0)) {
      toast.error('Enter the counted figures as positive amounts, as on the earlier document.');
      return;
    }
    setIsSavingBase(true);
    const { error } = await supabase.from('twob_import_docs').update({
      base_taxable_value: val('taxable'), base_input_igst: val('igst'), base_input_cgst: val('cgst'),
      base_input_sgst: val('sgst'), base_cess: val('cess'),
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', doc.id).is('amends_doc_id', null);
    setIsSavingBase(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success(clear ? 'Counted figures cleared: the amendment counts its full revised value.' : 'Counted figures saved: the amendment counts only the difference.');
    setBaseDialog(null);
    await fetchAll();
  };

  // ---- Books register --------------------------------------------------------
  const addBookRow = async () => {
    if (readOnly || !selectedClient || !selectedMonth) return;
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const { data, error } = await supabase.from('books_register').insert({
      client_id: selectedClient, period_month: selectedMonth, book_treatment: 'NOT_IN_2B', doc_type: 'INVOICE', updated_by: user?.id,
    }).select('*').single();
    if (error) { toast.error('Add failed: ' + error.message); return; }
    setBooks((prev) => [...prev, data as BookRow]);
  };

  const updateBookLocal = (id: string, patch: Partial<BookRow>) =>
    setBooks((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Saves a books row; with `classify`, first matches it against this month's
  // 2B documents of its own type. `patch` carries a change made in the same
  // event (the Type select), before React state has caught up.
  const saveBookRow = async (id: string, classify: boolean, patch: Partial<BookRow> = {}) => {
    const found = books.find((r) => r.id === id);
    if (!found) return;
    const row = { ...found, ...patch };
    let next = { treatment: row.book_treatment, matched2bId: row.matched_2b_id };
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    // Books rows are always positive. The client's debit note (a purchase
    // return, the supplier's credit note) is entered at plus amounts with its
    // own Type and waits for the supplier's credit note in 2B, which reduces
    // ITC in row 5.3 (the firm's decisions, 20 Oct 2026).
    if (bookHasMinus(row)) {
      toast.error('Amounts here are never minus. Enter your debit note (purchase return) at plus amounts with Type "Debit note (purchase return)": it has no effect until the supplier\'s credit note is in 2B, which then reduces ITC (row 5.3).', { duration: 15000 });
      const { data } = await supabase.from('books_register').select('*').eq('id', id).maybeSingle();
      if (data) updateBookLocal(id, data as BookRow);
      return;
    }

    try {
      if (classify && row.supplier_gstin && row.supplier_invoice_number) {
        const res = classifyBookAgainst2b(bookLite(row), twoBLites);
        next = nextPairing(row, res);
        if (res.classification === 'ALREADY_IN_2B') {
          toast.warning(bookIsPurchaseReturn(row)
            ? `The supplier's credit note for this debit note is already in 2B (${res.match?.supplierInvoiceNumber || ''}): it reduces ITC from its 2B row, and this row has no effect.`
            : `This ${DOC_TYPE_LABEL[docTypeOf(row)].toLowerCase()} looks like it is already in 2B (matched): ${row.supplier_name || row.supplier_invoice_number}. Add only if it is genuinely missing.`);
        }
        const other = res.otherTypeHint ? twoBDocs.find((d) => d.id === res.otherTypeHint?.id) : undefined;
        if (other) toast.warning(otherTypeMessage(row, other), { duration: 12000 });
        // Moving off a 2B document releases it, as deleting the row would.
        if (row.matched_2b_id && row.matched_2b_id !== next.matched2bId) await releaseDoc(row.matched_2b_id, id, twoBDocs);
        if (next.matched2bId && next.matched2bId !== row.matched_2b_id) await pairDoc(next.matched2bId, id, twoBDocs);
      }
    } catch (err) {
      toast.error('Could not update the paired 2B document: ' + errMsg(err));
      return;
    }

    const { error } = await supabase.from('books_register').update({
      date: row.date, supplier_name: row.supplier_name, supplier_invoice_number: row.supplier_invoice_number,
      supplier_gstin: row.supplier_gstin, taxable_value: row.taxable_value,
      input_igst: row.input_igst, input_cgst: row.input_cgst, input_sgst: row.input_sgst,
      doc_type: docTypeOf(row) === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'INVOICE',
      book_treatment: next.treatment, matched_2b_id: next.matched2bId,
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    if (next.treatment !== found.book_treatment || next.matched2bId !== found.matched_2b_id) {
      updateBookLocal(id, { book_treatment: next.treatment, matched_2b_id: next.matched2bId });
      if (next.matched2bId || found.matched_2b_id) fetchAll();
    }
  };

  // Changing a books row's type re-matches it (a debit note, the client's
  // purchase return, pairs only with the supplier's credit note in 2B).
  const setBookDocType = (id: string, docType: string) => {
    if (readOnly) return;
    updateBookLocal(id, { doc_type: docType });
    saveBookRow(id, true, { doc_type: docType });
    if (docType === 'DEBIT_NOTE') toast.info(BOOK_DEBIT_NOTE_MSG, { duration: 12000 });
  };

  const setBookTreatment = async (id: string, treatment: string) => {
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    updateBookLocal(id, { book_treatment: treatment });
    const { error } = await supabase.from('books_register')
      .update({ book_treatment: treatment, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error('Save failed: ' + error.message);
  };

  // Deleting a books row also takes back the Not in 2B reversal it posted to
  // the ledger, as a re-post would; the ledger's link is cleared on delete, so
  // nothing else could. A reversal that is filed (locked) or already
  // reclaimed stays, and is named.
  const deleteBookRow = async (id: string) => {
    if (readOnly) return;
    if (!canDelete2BRows()) { toast.error('Needs the Delete 2B rows permission — ask a GST Manager to add it to your position'); return; }
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const row = books.find((r) => r.id === id);
    const { data: posted, error: postedErr } = await supabase.from('bills_not_in_2b')
      .select('id, is_locked, reclaim_month').eq('source_book_id', id);
    if (postedErr) { toast.error('Delete failed: ' + postedErr.message); return; }
    const stays = (posted || []).filter((l) => l.is_locked || l.reclaim_month);
    if (stays.length > 0 && !(await confirm({
      title: 'Its reversal stays on the ledger',
      description: `This row's Not in 2B reversal is ${stays.some((l) => l.is_locked) ? 'filed' : 'already reclaimed'}, so it stays on the 2B Reconciliation ledger, no longer linked to a books row. Delete the books row anyway?`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    const retract = (posted || []).filter((l) => !l.is_locked && !l.reclaim_month).map((l) => l.id);
    if (retract.length > 0) {
      const { error } = await supabase.from('bills_not_in_2b').delete().in('id', retract);
      if (error) { toast.error('Could not remove its reversal from the ledger: ' + error.message); return; }
    }
    if (row?.matched_2b_id) {
      try {
        await releaseDoc(row.matched_2b_id, id, twoBDocs);
      } catch (err) {
        toast.error('Could not release the paired 2B document: ' + errMsg(err));
        return;
      }
    }
    const { error } = await supabase.from('books_register').delete().eq('id', id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    setBooks((prev) => prev.filter((r) => r.id !== id));
    if (retract.length > 0) toast.success('Books row deleted, and its Not in 2B reversal removed from the ledger.');
    if (row?.matched_2b_id || retract.length > 0) fetchAll();
  };

  // ---- Post to Reconciliation -------------------------------------------------
  // Writes NOT_IN_BOOKS / NOT_IN_2B rows through to the live bills_not_in_2b /
  // bills_not_in_books ledger that ITC Summary, Suspended Reco and
  // carry-forward read from. 2B Reconciliation itself is read-only — this is
  // the only place that ledger gets written for this period.
  const currentLabel = useMemo(() => periodMonthLabel(selectedMonth), [selectedMonth]);

  const handlePostToReconciliation = async () => {
    if (readOnly || !selectedClient || !selectedMonth) return;
    if (!canWork2BImport()) { toast.error('Needs the Import 2B & post permission — ask a GST Manager to add it to your position'); return; }
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    setIsPosting(true);
    try {
      const plan = await planImport2BPost(selectedClient, selectedMonth);
      if (isPostPlanEmpty(plan) && plan.skippedBooks.length === 0 && plan.skippedDocs.length === 0) {
        toast.info('Nothing to post — the ledger already matches your classifications.');
        return;
      }
      const parts: string[] = [];
      const net2B = plan.insertBills2B.length + plan.updateBills2B.length + plan.retractBills2B.length;
      const netBooks = plan.insertBillsBooks.length + plan.updateBillsBooks.length + plan.retractBillsBooks.length;
      if (net2B) parts.push(`Bills Not in 2B: ${plan.insertBills2B.length} new, ${plan.updateBills2B.length} updated, ${plan.retractBills2B.length} removed`);
      if (netBooks) parts.push(`Bills Not in Books: ${plan.insertBillsBooks.length} new, ${plan.updateBillsBooks.length} updated, ${plan.retractBillsBooks.length} removed`);
      // Skipped rows, by reason (a missing date or supplier), with the first
      // few document numbers of each.
      const skippedByReason = new Map<string, string[]>();
      [...plan.skippedBooks, ...plan.skippedDocs].forEach(({ row, reason }) => {
        skippedByReason.set(reason, [...(skippedByReason.get(reason) || []), row.supplier_invoice_number || '(no number)']);
      });
      for (const [reason, nos] of skippedByReason) {
        parts.push(`Not posted, ${plural(nos.length, 'row')}: ${reason} (${nos.slice(0, 5).join(', ')}${nos.length > 5 ? ` and ${nos.length - 5} more` : ''})`);
      }
      if (skippedByReason.size) parts.push('Fix the rows not posted in the tables above.');

      if (!(await confirm({
        title: 'Post to Reconciliation?',
        description: (
          <>
            This will update the live 2B Reconciliation ledger for {selectedClientName} — {selectedMonth}:
            <br /><br />
            {parts.map((p, i) => <React.Fragment key={i}>{p}<br /></React.Fragment>)}
          </>
        ),
        confirmText: 'Post',
      }))) {
        return;
      }

      // Posted under the month's lock, taken after the confirm, and only
      // what was confirmed: the plan is read again under the lock, and a
      // month changed while the confirm was open (an import, or a change in
      // another tab) posts nothing.
      const clientId = selectedClient;
      const month = selectedMonth;
      await withMonthLock(clientId, month, IMPORT_RUNNING_MSG, IMPORT_RUNNING_MSG, async () => {
        const current = await planImport2BPost(clientId, month);
        if (JSON.stringify(current) !== JSON.stringify(plan)) {
          toast.error('This month changed while the confirm was open (an import, or a change in another tab). Nothing was posted; click Post again to see what it would do now.');
          await fetchAll();
          return;
        }
        const result = await postImport2BToLedger(clientId, month, user?.id, current);
        toast.success(
          `Posted to Reconciliation${result.versionNumber ? ` — v${result.versionNumber}` : ''}. ` +
          `${result.inserted2B + result.insertedBooks} new, ${result.updated2B + result.updatedBooks} updated, ${result.retracted2B + result.retractedBooks} removed.` +
          (result.skipped ? ` ${result.skipped} row(s) skipped.` : ''),
        );
        await fetchAll();
      });
    } catch (err: any) {
      toast.error('Post failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsPosting(false);
    }
  };

  // ---- Zone 4 — Pending items (reclaim / book-entry decisions) ---------------
  // Reclaim itself always goes through the matching dialog (see confirmReclaim
  // above) — this is only the "never coming back, write it off" escape hatch,
  // which doesn't need a matching invoice.
  const setPendingExpenseOut = async (id: string) => {
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const row = pendingBills2B.find((r) => r.id === id);
    const { error } = await supabase.from('bills_not_in_2b')
      .update({ reclaim_month: currentLabel, reclaim_subtype: 'EXPENSE_OUT', updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setPendingBills2B((prev) => prev.filter((r) => r.id !== id));
    if (row) setExpensedOutItems((prev) => [{ ...row, reclaim_month: currentLabel, reclaim_subtype: 'EXPENSE_OUT' }, ...prev]);
    toast.success('Marked as expense out.');
  };

  // Undo — bring a mistakenly expensed-out item back to "awaiting reclaim".
  const undoExpenseOut = async (id: string) => {
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const row = expensedOutItems.find((r) => r.id === id);
    const { error } = await supabase.from('bills_not_in_2b')
      .update({ reclaim_month: null, reclaim_subtype: null, updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error('Undo failed: ' + error.message); return; }
    setExpensedOutItems((prev) => prev.filter((r) => r.id !== id));
    if (row) setPendingBills2B((prev) => [{ ...row, reclaim_month: null, reclaim_subtype: null }, ...prev]);
    toast.success('Expense out undone — back in Awaiting reclaim.');
  };

  const setPendingBookEntry = async (id: string, value: 'blank' | 'current') => {
    if (await importRunning()) { toast.error(IMPORT_RUNNING_MSG); return; }
    const patch = value === 'blank' ? { book_entry_month: null } : { book_entry_month: currentLabel };
    const { error } = await supabase.from('bills_not_in_books')
      .update({ ...patch, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setPendingBillsBooks((prev) => prev.filter((r) => value === 'blank' ? true : r.id !== id));
    if (value !== 'blank') toast.success('Book entry recorded.');
  };

  // The type of a pending ledger item, from the books row or 2B document that
  // posted it; an item with no known source (carried forward, or added on 2B
  // Reconciliation) reads as an invoice, or, negative, as a credit or
  // adjustment (in the credit note colour), as the e-mailed list names it.
  const pendingKind = (r: PendingItemLike): { label: string; tone: TwobTone } =>
    (!r.doc_type && takesItcAway(r) ? { label: 'Credit / adjustment', tone: 'credit' } : { label: docLabel(r), tone: docTone(r) });
  const pendingTypeBadge = (r: PendingItemLike) => (
    <span className={cn('inline-flex whitespace-nowrap rounded border px-1.5 text-[11px] font-medium leading-5', TONE_BADGE[pendingKind(r).tone])}>
      {pendingKind(r).label}
    </span>
  );

  // ---- Amount-wise summary ---------------------------------------------------
  // Net ITC effect by action (credit notes subtract, amendments count their
  // difference). Held appears while some amendment is held, saved or staged,
  // or the Action filter is on it (so the filter can always be cleared).
  const showHeld = filters.action === 'HELD' || twoBDocs.some((d) => d.itc_action === 'HELD' || pendingActions[d.id] === 'HELD');
  const summary2b = useMemo(
    () => TWOB_ACTIONS
      .map((a) => ({ value: a.value, label: a.label, ...sumDocs(twoBDocs.filter((d) => effectiveAction(d) === a.value)) }))
      .filter((r) => r.value !== 'HELD' || r.count > 0 || showHeld),
    [twoBDocs, effectiveAction, showHeld],
  );
  // What counts in ITC Summary: Matched and Mismatched, rows 5.1 less 5.3.
  const counted2b = useMemo(() => sumDocs(twoBDocs.filter((d) => isCountedAction(effectiveAction(d)))), [twoBDocs, effectiveAction]);
  // Purchase returns stand apart, as a minus: they reduce the books, but wait
  // for the supplier's credit note in 2B and post nothing until then.
  const summaryBooks = useMemo(
    () => {
      const returns = books.filter(bookIsPurchaseReturn);
      const rows = BOOK_TREATMENTS.map((t) => ({ label: t.label, ...sumRows(books.filter((b) => !bookIsPurchaseReturn(b) && b.book_treatment === t.value)) }));
      return returns.length ? [...rows, { label: 'Less: debit notes (purchase returns)', ...sumRows(returns, -1) }] : rows;
    },
    [books],
  );

  const selectedClientName = clients.find((c) => c.id === selectedClient)?.name || '';
  const rowSelectCls = 'h-7 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60';
  // Inline cell editor: borderless, fills the cell, ring on focus (the workspace grid look).
  const cellInputCls = 'block h-8 w-full border-0 bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60';
  const filterInputCls = 'h-7 w-full rounded border border-input bg-background px-1.5 text-[11px] font-normal';

  // The small lines under a 2B document's number: what an amendment amends
  // and counts (or why it counts in full, or waits), a credit note's IMS
  // declared amount, and the Rule 37A reversal / IMS rejected sheets. `warn`
  // lines need staff's attention and are shown in amber.
  const docNotes = (d: TwoBDoc, action: string): { text: string; warn?: boolean }[] => {
    const out: { text: string; warn?: boolean }[] = [];
    if (d.is_amendment) {
      const orig = `Amends ${d.original_doc_number || 'an earlier document'}${d.original_doc_date ? ` of ${isoToDisplay(d.original_doc_date)}` : ''}`;
      const revised = taxOf(fullFigures(d));
      const delta = taxOf(effectFigures(d)) - revised;
      const baseTax = taxOf({ igst: Number(d.base_input_igst) || 0, cgst: Number(d.base_input_cgst) || 0, sgst: Number(d.base_input_sgst) || 0 });
      const baseZero = Math.abs(baseTax) < 0.005 && Math.abs(Number(d.base_taxable_value) || 0) < 0.005;
      // "− counted" when the earlier version moved ITC the same way; "+ undone"
      // when it moved it the other way (a credit note revised into a debit note).
      const diff = `revised ₹${num(clean(revised))} ${delta > 0 ? '+ undone' : '− counted'} ₹${num(clean(Math.abs(delta)))}`;
      const earlier = d.amends_doc_id ? earlierById[d.amends_doc_id] : undefined;
      if (d.amends_doc_id) {
        const period = periodMonthLabel(d.amends_period || earlier?.period_month || '') || 'an earlier month';
        const label = earlier ? TWOB_ACTION_LABEL[earlier.itc_action] || earlier.itc_action : '';
        const otherType = earlier && docTypeOf(earlier) !== docTypeOf(d) ? ` (a ${DOC_TYPE_LABEL[docTypeOf(earlier)].toLowerCase()})` : '';
        const countsHere = isCountedAction(action) || action === 'NOT_IN_BOOKS';
        if (earlier?.itc_action === 'HELD') {
          out.push({ text: `${orig} · amends a held amendment from ${period}: settle that one first, it counts nothing yet`, warn: true });
        } else if (earlier?.reverse_charge && !d.reverse_charge) {
          // The supplier dropped the reverse charge flag: that version sat in RCM Summary, never in 5.1 / 5.3.
          out.push({
            text: `${orig} · the ${period} version was reverse charge (RCM Summary), never counted here: `
              + (countsHere ? `revised ₹${num(clean(revised))} counts in full` : `choose a treatment; Matched counts the revised ₹${num(clean(revised))} in full`)
              + `, and the RCM claim of ${period} stays as it was, to be undone by hand`,
            warn: true,
          });
        } else if (baseZero) {
          out.push(countsHere
            ? { text: `${orig} · the ${period} version${otherType} counted nothing${label ? ` (${label})` : ''}: revised ₹${num(clean(revised))} counts in full` }
            : {
              text: `${orig} · the ${period} version${otherType} counted nothing${label ? ` (${label})` : ''}, and this row is ${TWOB_ACTION_LABEL[action] || action}: revised ₹${num(clean(revised))} counts nowhere`,
              warn: !earlier || earlier.itc_action !== action,
            });
        } else {
          out.push({ text: `${orig}${otherType} · counted in ${period}${label ? ` as ${label}` : ''}: ${diff}` });
        }
        // The version was re-treated after this row took its base (and the
        // row was not brought in line: a filed month, or saved before that).
        if (earlier && earlier.itc_action !== 'HELD' && !sameBase(baseFrom(earlier, d), d)) {
          const now = baseFrom(earlier, d);
          const nowTax = taxOf({ igst: Number(now.base_input_igst) || 0, cgst: Number(now.base_input_cgst) || 0, sgst: Number(now.base_input_sgst) || 0 });
          out.push({
            text: `The ${period} version is now ${label}, so this row should count against ₹${num(clean(Math.abs(nowTax)))}, not the ₹${num(clean(Math.abs(baseTax)))} it was counted against. `
              + (isLocked ? 'This month is filed: adjust the difference by hand in a later return.' : 'Re-import this month to bring it in line.'),
            warn: true,
          });
        }
      } else if (hasBase(d)) {
        // No link: counted figures staff entered, or the version found at import has since been deleted.
        const where = d.amends_period ? `counted in ${periodMonthLabel(d.amends_period)} (that version since removed)` : 'counted before Import 2B (entered)';
        out.push({ text: `${orig} · ${where}: ${diff}` });
      } else {
        out.push({ text: orig });
        if (action === 'HELD') {
          out.push({ text: `No earlier version in Import 2B, so not counted. Matched would claim the full revised ₹${num(clean(revised))}, as if it was never claimed; if it was, enter what it counted first.`, warn: true });
        } else if (isCountedAction(action) || action === 'NOT_IN_BOOKS') {
          out.push({ text: `No earlier version in Import 2B: counts the full revised ₹${num(clean(revised))}. If it was claimed before, enter what it counted.`, warn: true });
        }
      }
      // Not claimed here, but the version it amends still counts in its
      // month; or, parked Not in Books, was never claimed (its ledger entry is
      // what to clear). A held version counts nowhere yet (its line says so).
      if (countedNothing(action) && !baseZero && !(earlier && (countedNothing(earlier.itc_action) || earlier.itc_action === 'HELD'))) {
        out.push({
          text: earlier?.itc_action === 'NOT_IN_BOOKS'
            ? isCreditNote(earlier)
              ? `Not counted here; the earlier credit note is parked Not in Books (₹${num(clean(Math.abs(baseTax)))}), never reduced: clear its entry on the Not in Books ledger if no longer due, nothing to add back`
              : `Not claimed here; the earlier version is parked Not in Books (₹${num(clean(Math.abs(baseTax)))}), never claimed: clear its entry on the Not in Books ledger if no longer due, nothing to reverse in 4B(2)`
            : isCreditNote(d)
              ? `Not counted here, but the earlier version still reduces ₹${num(clean(Math.abs(baseTax)))}: add it back by hand if no longer due`
              : `Not claimed here, but the earlier version still counts ₹${num(clean(Math.abs(baseTax)))}: reverse it in 4B(2) if it is no longer eligible`,
          warn: true,
        });
      }
    }
    if (isCreditNote(d) && d.ims_reduce_required === 'YES'
      && [d.declared_igst, d.declared_cgst, d.declared_sgst, d.declared_cess].some((v) => v !== null && v !== undefined)) {
      const noteTax = (Number(d.input_igst) || 0) + (Number(d.input_cgst) || 0) + (Number(d.input_sgst) || 0);
      out.push({ text: `IMS: reduce ₹${num(clean(taxOf(fullFigures(d))))} declared (note tax ₹${num(clean(noteTax))})` });
    }
    // Parked, a credit note is left out of 5.3; once booked it is reduced in
    // 5.2, though the portal's auto-drafted 4A(5) is already net of it (§10,
    // choice 3).
    if (isCreditNote(d) && action === 'NOT_IN_BOOKS' && d.bucket === 'available') {
      out.push({ text: 'Not reduced in 5.3: once booked, reduce row 5.2 by it, head by head; the portal\'s auto-drafted 4A(5) is already net of it (keep it Pending in IMS to defer it there too)' });
    }
    if (d.bucket === 'reversal') out.push({ text: 'Rule 37A ITC reversal: reverse it in 4B(2)(ii)' });
    if (d.bucket === 'rejected') out.push({ text: 'Rejected in IMS' });
    return out;
  };

  // `counted` adds a last line: what of the total counts in ITC Summary.
  const renderSummaryTable = (title: string, rows: (Totals & { label: string })[], totalLabel = 'Total', counted?: Totals & { label: string }) => {
    const tot = rows.reduce((a, r) => ({ count: a.count + r.count, taxable: a.taxable + r.taxable, igst: a.igst + r.igst, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst }), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    const totals = counted ? [{ ...tot, label: totalLabel }, counted] : [{ ...tot, label: totalLabel }];
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">{title}</p>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className={TABLE_CLS}>
            <thead>
              <tr>
                <th className={WS_TH}>Classification</th>
                <th className={cn(WS_TH, 'w-14 text-right')}>Count</th>
                <th className={cn(WS_TH, 'text-right')}>Taxable</th>
                <th className={cn(WS_TH, 'text-right')}>IGST</th>
                <th className={cn(WS_TH, 'text-right')}>CGST</th>
                <th className={cn(WS_TH, 'text-right')}>SGST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={WS_TR}>
                  <td className={WS_TD}>{r.label}</td>
                  <td className={WS_TD_NUM}>{r.count}</td>
                  <td className={WS_TD_NUM}>{num(clean(r.taxable))}</td>
                  <td className={WS_TD_NUM}>{num(clean(r.igst))}</td>
                  <td className={WS_TD_NUM}>{num(clean(r.cgst))}</td>
                  <td className={WS_TD_NUM}>{num(clean(r.sgst))}</td>
                </tr>
              ))}
              {totals.map((t, i) => {
                const last = i === totals.length - 1 ? 'border-b-0' : '';
                return (
                  <tr key={t.label} className={WS_TR_TOTAL}>
                    <td className={cn(WS_TD, last)}>{t.label}</td>
                    <td className={cn(WS_TD_NUM, last)}>{t.count}</td>
                    <td className={cn(WS_TD_NUM, last)}>{num(clean(t.taxable))}</td>
                    <td className={cn(WS_TD_NUM, last)}>{num(clean(t.igst))}</td>
                    <td className={cn(WS_TD_NUM, last)}>{num(clean(t.cgst))}</td>
                    <td className={cn(WS_TD_NUM, last)}>{num(clean(t.sgst))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className={WS_PAGE}>
      {/* Header */}
      <PageHeader
        compact
        embedded
        title="Import 2B"
        subtitle="Import GSTR-2B & reconcile with books · B2B invoices, debit and credit notes, amendments"
        icon={<FileSpreadsheet />}
        actions={isStaff ? (
          <>
            <ChangeHistoryButton page="import2b" clientId={selectedClient} month={selectedMonth} />
            <Button
              variant="outline"
              size="sm"
              onClick={pull2BFromPortal}
              disabled={isImporting || !selectedClient || !selectedMonth || editLocked || !canWork2BImport()}
              className={cn(WS_BTN, !extReady && 'text-muted-foreground')}
              title={!canWork2BImport() ? 'Needs the Import 2B & post permission — ask a GST Manager to add it to your position' : extReady
                ? 'Pull this client\'s GSTR-2B from the portal via the browser extension'
                : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Pull from portal
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(WS_BTN, 'text-muted-foreground hover:text-foreground')}
              onClick={handleImportClick}
              disabled={isImporting || !selectedClient || !selectedMonth || editLocked || !canWork2BImport()}
              title={canWork2BImport() ? "Manual fallback — import a GSTR-2B Excel file if the portal pull didn't work" : 'Needs the Import 2B & post permission — ask a GST Manager to add it to your position'}
            >
              <Upload className="h-3.5 w-3.5" />
              Import file
            </Button>
            {(twoBDocs.length > 0 || books.length > 0) && (
              <Button
                size="sm"
                className={WS_BTN}
                onClick={handlePostToReconciliation}
                disabled={isPosting || writeLocked || pendingCount > 0 || !canWork2BImport()}
                title={!canWork2BImport() ? 'Needs the Import 2B & post permission — ask a GST Manager to add it to your position' : pendingCount > 0
                  ? 'Save your row-action changes first — Post to Reconciliation reads the saved classifications.'
                  : 'Write NOT_IN_BOOKS / NOT_IN_2B classifications through to the live 2B Reconciliation ledger'}
              >
                {isPosting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Post to Reconciliation
              </Button>
            )}
            {selectedClient && selectedMonth && (twoBDocs.length > 0 || pendingBillsBooks.length > 0) && (
              <EmailBillsNotInBooksDialog
                clientId={selectedClient}
                clientName={selectedClientName}
                clientGstin={clients.find((c) => c.id === selectedClient)?.gstin || ''}
                periodMonth={selectedMonth}
                triggerClassName={WS_BTN}
                blockedReason={isImporting ? 'Wait for the import to finish.'
                  : pendingCount > 0 ? 'Save your row-action changes first: the e-mail lists the saved Not in Books documents.' : null}
              />
            )}
            {twoBDocs.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className={WS_BTN}
                onClick={deleteImported2B}
                disabled={writeLocked || !canDelete2BRows()}
                title={canDelete2BRows() ? undefined : 'Needs the Delete 2B rows permission — ask a GST Manager to add it to your position'}
              >
                <Trash2 className="h-3.5 w-3.5" />Delete 2B
              </Button>
            )}
          </>
        ) : undefined}
      />
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />

      {/* Filters (client / month): one labelled toolbar. */}
      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-full min-w-0 space-y-0.5 sm:w-64">
              <span className={WS_FILTER_LABEL}>Client</span>
              <SearchableSelect options={clients.map((c) => ({ value: c.id, label: c.name }))}
                value={selectedClient} onValueChange={setSelectedClient} placeholder="Select Client" className={WS_CONTROL} />
            </label>
            <label className="w-36 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Month</span>
              <SearchableMonthSelect options={monthOptions} value={selectedMonth} onValueChange={setSelectedMonth} placeholder="Select Month" className={WS_CONTROL} />
            </label>
            {lastImportedAt && (
              <div className="ml-auto text-right text-[11px] leading-snug text-muted-foreground">
                Imported {new Date(lastImportedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {importerName ? ` by ${importerName}` : ''}
                <br />{twoBDocs.length} docs{rcmHidden ? ` · ${rcmHidden} RCM hidden` : ''}
                {lastPosted && (
                  <><br />Posted to Reconciliation {new Date(lastPosted.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{lastPosted.version ? ` · v${lastPosted.version}` : ''}</>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isLocked && (
        <Note tone="warn">
          <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> {isSuperadmin ? 'The return for this period has been filed. You can still edit as superadmin — changes do not reach the filed return.' : 'This sheet is locked because the return has been filed.'}</span>
        </Note>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading 2B…
          </CardContent>
        </Card>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-6">
            <TableEmptyState
              icon={<FileSpreadsheet className="h-5 w-5" />}
              title="Select a client and month to begin"
              description="Pick a client and return period above to import and reconcile GSTR-2B."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline tiles: 2B docs by action (each tile filters zone 1 to that action) + books entries.
              Amounts are the net ITC effect: a credit note subtracts, an amendment counts its difference. */}
          {(twoBDocs.length > 0 || books.length > 0) && (
            <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', summary2b.length > 6 ? 'xl:grid-cols-9' : 'xl:grid-cols-8')}>
              <TileButton
                active={!filters.action}
                onClick={() => { setFilters((f) => ({ ...f, action: '' })); setZone1Open(true); }}
                title="Show every 2B doc"
              >
                <KpiTile
                  label="2B docs"
                  value={twoBDocs.length}
                  hint={`Counted in ITC ${num(clean(taxOf(counted2b))) || '0'}`}
                />
              </TileButton>
              {summary2b.map((r) => {
                const active = filters.action === r.value;
                return (
                  <TileButton
                    key={r.value}
                    active={active}
                    onClick={() => { setFilters((f) => ({ ...f, action: active ? '' : r.value })); setZone1Open(true); }}
                    title={active ? 'Show every 2B doc' : `Show ${r.label} docs only`}
                  >
                    <KpiTile
                      label={r.label}
                      value={r.count}
                      hint={`${isCountedAction(r.value) ? 'Counted' : 'Not counted'} ${num(clean(r.igst + r.cgst + r.sgst)) || '0'}`}
                      tone={r.count ? ACTION_TONE[r.value] : 'neutral'}
                    />
                  </TileButton>
                );
              })}
              <KpiTile
                label="Books entries"
                value={books.length}
                hint={summaryBooks.filter((t) => t.count).map((t) => `${t.label} ${t.count}`).join(' · ') || 'None added'}
                tone={books.length ? 'warn' : 'neutral'}
              />
            </div>
          )}

          {/* Zone 1 — imported 2B */}
          <Card>
            <CardContent className="px-4 py-3">
              <Collapsible open={zone1Open} onOpenChange={setZone1Open}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <CollapsibleTrigger className="flex items-center gap-1.5 text-left group">
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${zone1Open ? '' : '-rotate-90'}`} />
                  <div>
                    <p className="text-[15px] font-semibold leading-snug text-foreground">1 · GSTR-2B (imported)</p>
                    <p className="text-xs text-muted-foreground">
                      {filteredDocs.length}{anyFilter ? ` of ${twoBDocs.length}` : ''} invoices, notes and amendments{rcmHidden ? ` · ${rcmHidden} RCM hidden (RCM Summary)` : ''} · set the action per row
                    </p>
                  </div>
                </CollapsibleTrigger>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Bulk apply bar */}
                  {!readOnly && selected.size > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1">
                      <span className="text-xs font-medium">{selected.size} selected</span>
                      <select className="h-7 rounded-md border border-input bg-background px-2 text-xs" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                        <option value="">Set action to…</option>
                        {BULK_TWOB_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <Button size="sm" className="h-7 px-2.5 text-xs" onClick={applyBulk} disabled={!bulkValue}>Apply</Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => setSelected(new Set())}
                        aria-label="Clear selection"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {/* Save staged row-action changes — nothing writes to the DB until this is clicked. */}
                  {!readOnly && pendingCount > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1">
                      <span className="text-xs font-medium text-foreground">{pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setPendingActions({})}
                        disabled={isSavingActions}
                      >
                        Discard
                      </Button>
                      <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={saveActions} disabled={isSavingActions || isImporting}>
                        {isSavingActions ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Save changes
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <CollapsibleContent>
              {twoBDocs.length === 0 ? (
                <TableEmptyState
                  icon={<FileSpreadsheet className="h-5 w-5" />}
                  title="No GSTR-2B imported"
                  description={`No invoices, notes or amendments imported for ${selectedClientName}, ${selectedMonth}.${isStaff && !editLocked ? ' Use "Pull from portal" to fetch them.' : ''}`}
                />
              ) : (
                <>
                {/* Legend: one chip per kind of document, in its colours; each filters the table to that kind. */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {TONES.map((t) => {
                    const active = filters.type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFilters((f) => ({ ...f, type: active ? '' : t }))}
                        title={active ? 'Show every kind of document' : `Show ${TONE_LABEL[t].toLowerCase()}s only`}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          TONE_BADGE[t],
                          active && 'ring-2 ring-primary/60',
                        )}
                      >
                        {TONE_LABEL[t]}
                        <span className="tabular-nums opacity-80">{toneCounts[t]}</span>
                      </button>
                    );
                  })}
                  <span className="text-[11px] text-muted-foreground">
                    Amounts are the net ITC effect: a credit note subtracts, an amendment counts only its difference. Only Matched and Mismatched rows count in ITC Summary; a held row counts nowhere.
                  </span>
                </div>
                <ScrollArea className={SCROLL_CLS}>
                  <div className="min-w-[1150px]">
                    <table className={TABLE_CLS}>
                      <thead>
                        <tr>
                          <th className={cn(WS_TH, 'w-9 text-center')}>
                            <div className="flex items-center justify-center">
                              <Checkbox
                                checked={allFilteredSelected}
                                onCheckedChange={toggleAllFiltered}
                                disabled={writeLocked}
                                aria-label="Select all rows"
                              />
                            </div>
                          </th>
                          <th className={cn(WS_TH, 'w-28')}>Type</th>
                          <th className={WS_TH}>Date</th>
                          <th className={WS_TH}>Supplier</th>
                          <th className={WS_TH}>Doc no.</th>
                          <th className={WS_TH}>GSTIN</th>
                          <th className={cn(WS_TH, 'text-right')}>Taxable</th>
                          <th className={cn(WS_TH, 'text-right')}>IGST</th>
                          <th className={cn(WS_TH, 'text-right')}>CGST</th>
                          <th className={cn(WS_TH, 'text-right')}>SGST</th>
                          <th className={cn(WS_TH, 'w-44')}>Action</th>
                        </tr>
                        {/* Heading filter row */}
                        <tr className="bg-muted">
                          <th className="border-b border-r p-1"></th>
                          <th className="border-b border-r p-1">
                            <select className={filterInputCls + ' h-7'} value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as '' | TwobTone }))}>
                              <option value="">All</option>
                              {TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
                            </select>
                          </th>
                          <th className="border-b border-r p-1"></th>
                          <th className="border-b border-r p-1">
                            <input className={filterInputCls} placeholder="Filter…" value={filters.supplier} onChange={(e) => setFilters((f) => ({ ...f, supplier: e.target.value }))} />
                          </th>
                          <th className="border-b border-r p-1">
                            <input className={filterInputCls} placeholder="Filter…" value={filters.invoice} onChange={(e) => setFilters((f) => ({ ...f, invoice: e.target.value }))} />
                          </th>
                          <th className="border-b border-r p-1">
                            <input className={filterInputCls} placeholder="Filter…" value={filters.gstin} onChange={(e) => setFilters((f) => ({ ...f, gstin: e.target.value }))} />
                          </th>
                          <th className="border-b border-r p-1"></th>
                          <th className="border-b border-r p-1"></th>
                          <th className="border-b border-r p-1"></th>
                          <th className="border-b border-r p-1"></th>
                          <th className="border-b border-r p-1">
                            <select className={filterInputCls + ' h-7'} value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
                              <option value="">All</option>
                              {TWOB_ACTIONS.filter((o) => o.value !== 'HELD' || summary2b.some((r) => r.value === 'HELD')).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDocs.length === 0 ? (
                          <TableEmptyState
                            colSpan={11}
                            icon={<Inbox className="h-5 w-5" />}
                            title="No rows match the filters"
                            description="Clear or change the column filters above to see imported documents."
                          />
                        ) : filteredDocs.map((d) => {
                          const isDirty = d.id in pendingActions;
                          const tone = docTone(d);
                          const eff = signedEffect(d);
                          const action = effectiveAction(d);
                          // The treatments this kind of document may take; HELD stays offered until the pick is saved.
                          const options = allowedActions(d, d.itc_action);
                          if (!options.includes(action)) options.unshift(action);
                          const notes = docNotes(d, action);
                          return (
                          // A selected or unsaved row shows that state instead of its kind's tint
                          // (the stripe keeps the kind), in dark mode too.
                          <tr key={d.id} className={cn(WS_TR, selected.has(d.id) ? 'bg-primary/5 dark:bg-primary/15' : isDirty ? 'bg-warning/10 dark:bg-warning/15' : TONE_ROW[tone])}>
                            <td className={cn(WS_TD, 'text-center', TONE_STRIPE[tone])}>
                              <div className="flex items-center justify-center">
                                <Checkbox
                                  checked={selected.has(d.id)}
                                  onCheckedChange={() => toggleRow(d.id)}
                                  disabled={writeLocked}
                                  aria-label={`Select ${d.supplier_invoice_number || 'row'}`}
                                />
                              </div>
                            </td>
                            <td className={WS_TD}>
                              <span className={cn('inline-flex whitespace-nowrap rounded border px-1.5 text-[11px] font-medium leading-5', TONE_BADGE[tone])}>
                                {docLabel(d)}
                              </span>
                            </td>
                            <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums')}>{isoToDisplay(d.date)}</td>
                            <td className={WS_TD}>{d.supplier_name}</td>
                            <td className={WS_TD}>
                              <div>{d.supplier_invoice_number}</div>
                              {notes.map((n) => (
                                <div key={n.text} className={cn('text-[11px] leading-snug text-muted-foreground', n.warn && 'font-medium text-amber-700 dark:text-amber-300')}>{n.text}</div>
                              ))}
                              {d.is_amendment && !d.amends_doc_id && !readOnly && (
                                <button
                                  type="button"
                                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
                                  disabled={isImporting}
                                  onClick={() => openBaseDialog(d)}
                                >
                                  {hasBase(d) ? 'Edit counted' : 'Enter counted'}
                                </button>
                              )}
                            </td>
                            <td className={cn(WS_TD, 'font-mono')}>{d.supplier_gstin}</td>
                            {[eff.taxable, eff.igst, eff.cgst, eff.sgst].map((v, i) => (
                              <td
                                key={i}
                                className={cn(WS_TD_NUM, action === 'HELD' && 'italic text-muted-foreground')}
                                title={action === 'HELD' ? 'Held: not counted until a treatment is chosen' : undefined}
                              >
                                {num(clean(v))}
                              </td>
                            ))}
                            <td className={WS_TD}>
                              <select
                                className={rowSelectCls + (isDirty ? ' border-warning' : '')}
                                value={action}
                                disabled={writeLocked}
                                title={isDirty ? 'Unsaved — click Save changes above to commit' : undefined}
                                onChange={(e) => handleDocActionChange(d, e.target.value)}
                              >
                                {options.map((v) => <option key={v} value={v}>{TWOB_ACTION_LABEL[v] || v}</option>)}
                              </select>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                      {filteredDocs.length > 0 && (
                        <tfoot>
                          {[
                            { label: `Total of the ${plural(filteredDocs.length, 'row')} shown, every action`, t: docsTotals },
                            { label: 'Counted in ITC Summary (Matched and Mismatched: 5.1 less 5.3)', t: docsCounted },
                          ].map(({ label, t }) => (
                            <tr key={label} className={WS_TR_TOTAL}>
                              <td className={WS_TD} colSpan={6}>{label}</td>
                              <td className={WS_TD_NUM}>{num(clean(t.taxable))}</td>
                              <td className={WS_TD_NUM}>{num(clean(t.igst))}</td>
                              <td className={WS_TD_NUM}>{num(clean(t.cgst))}</td>
                              <td className={WS_TD_NUM}>{num(clean(t.sgst))}</td>
                              <td className={WS_TD}></td>
                            </tr>
                          ))}
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
                </>
              )}
              </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Zone 2 — books register */}
          <Card>
            <CardContent className="px-4 py-3">
              <Collapsible open={zone2Open} onOpenChange={setZone2Open}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <CollapsibleTrigger className="flex items-center gap-1.5 text-left group">
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${zone2Open ? '' : '-rotate-90'}`} />
                  <div>
                    <p className="text-[15px] font-semibold leading-snug text-foreground">2 · Books / purchase register</p>
                    <p className="text-xs text-muted-foreground">Add purchases booked but missing from 2B · a debit note (purchase return) waits for the supplier's credit note in 2B · CGST fills SGST</p>
                  </div>
                </CollapsibleTrigger>
                {!readOnly && (
                  <Button variant="outline" size="sm" className={WS_BTN} onClick={addBookRow} disabled={isImporting}><Plus className="h-3.5 w-3.5" />Add row</Button>
                )}
              </div>
              <CollapsibleContent>
              <ScrollArea className={SCROLL_CLS}>
                <div className="min-w-[1150px]">
                  <table className={TABLE_CLS}>
                    <thead>
                      <tr>
                        <th className={cn(WS_TH, 'w-28')}>Date</th>
                        <th className={cn(WS_TH, 'w-28')}>Type</th>
                        <th className={WS_TH}>Supplier</th>
                        <th className={WS_TH}>Doc no.</th>
                        <th className={WS_TH}>GSTIN</th>
                        <th className={cn(WS_TH, 'text-right w-24')}>Taxable</th>
                        <th className={cn(WS_TH, 'text-right w-20')}>IGST</th>
                        <th className={cn(WS_TH, 'text-right w-20')}>CGST</th>
                        <th className={cn(WS_TH, 'text-right w-20')}>SGST</th>
                        <th className={cn(WS_TH, 'w-32')}>Treatment</th>
                        {!readOnly && <th className={cn(WS_TH, 'w-10')}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {books.length === 0 ? (
                        <TableEmptyState
                          colSpan={readOnly ? 10 : 11}
                          icon={<Inbox className="h-5 w-5" />}
                          title="No books entries added"
                          description={readOnly ? undefined : 'Use "Add row" to record purchases or debit notes (purchase returns) booked but missing from 2B.'}
                        />
                      ) : books.map((b) => {
                        const tone = docTone({ doc_type: b.doc_type });
                        const minus = bookHasMinus(b);
                        return (
                        <tr key={b.id} className={cn(WS_TR, TONE_ROW[tone], minus && 'bg-destructive/10')}
                          title={minus ? 'Minus amount: amounts here are always plus. Enter a debit note (purchase return) at plus amounts with Type "Debit note (purchase return)".'
                            : bookIsPurchaseReturn(b) ? BOOK_DEBIT_NOTE_MSG : undefined}>
                          <td className={cn('border-b border-r p-0', minus ? 'border-l-4 border-l-destructive' : TONE_STRIPE[tone])}>
                            <input type="date" className={cellInputCls} value={b.date || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { date: e.target.value })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <select
                              className={cn(rowSelectCls, 'm-0.5 w-[calc(100%-4px)]')}
                              value={docTypeOf({ doc_type: b.doc_type }) === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'INVOICE'}
                              disabled={writeLocked}
                              title="An invoice pairs with the supplier's invoice in 2B; a debit note (purchase return) with the supplier's credit note, and has no effect until then"
                              onChange={(e) => setBookDocType(b.id, e.target.value)}
                            >
                              {BOOK_DOC_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={cellInputCls} value={b.supplier_name || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { supplier_name: e.target.value })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={cellInputCls} value={b.supplier_invoice_number || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { supplier_invoice_number: e.target.value })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={`${cellInputCls} font-mono`} value={b.supplier_gstin || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { supplier_gstin: e.target.value.toUpperCase() })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.taxable_value || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { taxable_value: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.input_igst || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { input_igst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.input_cgst || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { input_cgst: toNum(e.target.value), input_sgst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.input_sgst || ''} disabled={writeLocked}
                              onChange={(e) => updateBookLocal(b.id, { input_sgst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border-b border-r p-0">
                            <select className={cn(rowSelectCls, 'm-0.5 w-[calc(100%-4px)]')} value={b.book_treatment} disabled={writeLocked} onChange={(e) => setBookTreatment(b.id, e.target.value)}>
                              {BOOK_TREATMENTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          {!readOnly && (
                            <td className="border-b border-r px-1 text-center">
                              <Button
                                variant="ghost"
                                disabled={!canDelete2BRows() || isImporting}
                                title={canDelete2BRows() ? undefined : 'Needs the Delete 2B rows permission — ask a GST Manager to add it to your position'}
                                size="icon"
                                className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive-strong focus-visible:opacity-100 group-hover:opacity-100"
                                onClick={() => deleteBookRow(b.id)}
                                aria-label={`Delete books row ${b.supplier_invoice_number || ''}`.trim()}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                        );
                      })}
                    </tbody>
                    {books.length > 0 && (() => {
                      const bookTotals = sumBooksNet(books);
                      return (
                        <tfoot>
                          <tr className={WS_TR_TOTAL}>
                            <td className={WS_TD} colSpan={5}>
                              Total ({bookTotals.count})
                            </td>
                            <td className={WS_TD_NUM}>{num(bookTotals.taxable)}</td>
                            <td className={WS_TD_NUM}>{num(bookTotals.igst)}</td>
                            <td className={WS_TD_NUM}>{num(bookTotals.cgst)}</td>
                            <td className={WS_TD_NUM}>{num(bookTotals.sgst)}</td>
                            <td className={WS_TD} colSpan={readOnly ? 1 : 2} />
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
              </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Zone 3 — amount-wise summary */}
          <Card>
            <CardContent className="space-y-3 px-4 py-3">
              <p className="text-[15px] font-semibold leading-snug text-foreground">3 · Reconciliation summary (amount-wise)</p>
              {renderSummaryTable('GSTR-2B (imported) by action, net ITC effect', summary2b, 'Total, every action', { label: 'Counted in ITC Summary (5.1 less 5.3)', ...counted2b })}
              {renderSummaryTable('Books — by treatment', summaryBooks)}
              {rcmHidden > 0 && <p className="text-xs text-muted-foreground">Plus {rcmHidden} RCM doc(s) hidden — handled in RCM Summary.</p>}
              <Note>
                Matched invoices and debit notes claim at the 2B figure and feed ITC Summary row 5.1; matched credit
                notes reduce ITC through row 5.3; an amendment counts only its difference over the version already
                counted. "Not in Books" and "Not in 2B" rows only reach the live ledger once you click{' '}
                <span className="font-medium">Post to Reconciliation</span> above.
              </Note>
            </CardContent>
          </Card>

          {/* Zone 4 — pending items already on the ledger, awaiting a decision */}
          {(pendingBills2B.length > 0 || pendingBillsBooks.length > 0 || expensedOutItems.length > 0) && (
            <Card>
              <CardContent className="space-y-3 px-4 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug text-foreground"><Clock className="h-4 w-4 text-muted-foreground" />4 · Pending items</p>
                  <p className="text-xs text-muted-foreground">
                    Already on the 2B Reconciliation ledger for {selectedMonth} · decide Reclaim / Book Entry here — the ledger itself is read-only.
                  </p>
                </div>

                {pendingBills2B.length > 0 && (
                  <Collapsible open={zone4Open.reclaim} onOpenChange={(open) => setZone4Open((z) => ({ ...z, reclaim: open }))}>
                    <CollapsibleTrigger className="group mb-1.5 flex w-full items-center gap-1.5 text-left">
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${zone4Open.reclaim ? '' : '-rotate-90'}`} />
                      <p className="text-xs font-semibold text-muted-foreground group-hover:text-foreground">
                        Awaiting reclaim (booked, reversed — not yet back in 2B) · {pendingBills2B.length}
                      </p>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                    <ScrollArea className={SCROLL_CLS}>
                      <div className="min-w-[900px]">
                        <table className={TABLE_CLS}>
                          <thead>
                            <tr>
                              <th className={WS_TH}>Date</th>
                              <th className={cn(WS_TH, 'w-28')}>Type</th>
                              <th className={WS_TH}>Supplier</th>
                              <th className={WS_TH}>Doc no.</th>
                              <th className={cn(WS_TH, 'text-right')}>IGST</th>
                              <th className={cn(WS_TH, 'text-right')}>CGST</th>
                              <th className={cn(WS_TH, 'text-right')}>SGST</th>
                              <th className={cn(WS_TH, 'w-24')}>Reversed</th>
                              <th className={cn(WS_TH, 'w-44')}>Reclaim</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pendingBills2B.map((r) => (
                              <tr key={r.id} className={cn(WS_TR, TONE_ROW[pendingKind(r).tone])}>
                                <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums', TONE_STRIPE[pendingKind(r).tone])}>{isoToDisplay(r.date)}</td>
                                <td className={WS_TD}>{pendingTypeBadge(r)}</td>
                                <td className={WS_TD}>{r.supplier_name}</td>
                                <td className={WS_TD}>{r.supplier_invoice_number}</td>
                                <td className={WS_TD_NUM}>{num(r.input_igst)}</td>
                                <td className={WS_TD_NUM}>{num(r.input_cgst)}</td>
                                <td className={WS_TD_NUM}>{num(r.input_sgst)}</td>
                                <td className={WS_TD}>{r.reversal_month || '-'}</td>
                                <td className={WS_TD}>
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      disabled={writeLocked}
                                      onClick={() => openReclaimFromPending(r)}
                                    >
                                      Link &amp; Reclaim
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                      disabled={writeLocked}
                                      onClick={() => setPendingExpenseOut(r.id)}
                                    >
                                      Expense out
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {pendingBillsBooks.length > 0 && (
                  <Collapsible open={zone4Open.bookEntry} onOpenChange={(open) => setZone4Open((z) => ({ ...z, bookEntry: open }))}>
                    <CollapsibleTrigger className="group mb-1.5 flex w-full items-center gap-1.5 text-left">
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${zone4Open.bookEntry ? '' : '-rotate-90'}`} />
                      <p className="text-xs font-semibold text-muted-foreground group-hover:text-foreground">
                        Awaiting book entry (in 2B — not yet booked) · {pendingBillsBooks.length}
                      </p>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                    <ScrollArea className={SCROLL_CLS}>
                      <div className="min-w-[900px]">
                        <table className={TABLE_CLS}>
                          <thead>
                            <tr>
                              <th className={WS_TH}>Date</th>
                              <th className={cn(WS_TH, 'w-28')}>Type</th>
                              <th className={WS_TH}>Supplier</th>
                              <th className={WS_TH}>Doc no.</th>
                              <th className={cn(WS_TH, 'text-right')}>IGST</th>
                              <th className={cn(WS_TH, 'text-right')}>CGST</th>
                              <th className={cn(WS_TH, 'text-right')}>SGST</th>
                              <th className={cn(WS_TH, 'w-24')}>In 2B since</th>
                              <th className={cn(WS_TH, 'w-40')}>Book Entry</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pendingBillsBooks.map((r) => (
                              <tr key={r.id} className={cn(WS_TR, TONE_ROW[pendingKind(r).tone])}>
                                <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums', TONE_STRIPE[pendingKind(r).tone])}>{isoToDisplay(r.date)}</td>
                                <td className={WS_TD}>{pendingTypeBadge(r)}</td>
                                <td className={WS_TD}>{r.supplier_name}</td>
                                <td className={WS_TD}>{r.supplier_invoice_number}</td>
                                <td className={WS_TD_NUM}>{num(r.input_igst)}</td>
                                <td className={WS_TD_NUM}>{num(r.input_cgst)}</td>
                                <td className={WS_TD_NUM}>{num(r.input_sgst)}</td>
                                <td className={WS_TD}>{r.bill_in_2b_month || '-'}</td>
                                <td className={WS_TD}>
                                  <select
                                    className={rowSelectCls}
                                    disabled={writeLocked}
                                    value={r.book_entry_month ? 'current' : 'blank'}
                                    onChange={(e) => setPendingBookEntry(r.id, e.target.value as 'blank' | 'current')}
                                  >
                                    <option value="blank">-</option>
                                    <option value="current">Booked in {currentLabel}</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    <Note className="mt-2">
                      Once booked, claim the ITC under ITC Summary row 5.2 "ITC for Previous Month": the document
                      won't reappear in a future GSTR-2B pull. A negative row is a credit note, or an amendment that
                      cut an earlier document's tax: once booked, reduce row 5.2 by it, head by head, negative where
                      needed (5.2 is the one ITC Summary row that takes a negative figure).
                    </Note>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {expensedOutItems.length > 0 && (
                  <Collapsible open={zone4Open.expensedOut} onOpenChange={(open) => setZone4Open((z) => ({ ...z, expensedOut: open }))}>
                    <CollapsibleTrigger className="group mb-1.5 flex w-full items-center gap-1.5 text-left">
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${zone4Open.expensedOut ? '' : '-rotate-90'}`} />
                      <p className="text-xs font-semibold text-muted-foreground group-hover:text-foreground">
                        Expensed out this period — Undo if this was a mistake · {expensedOutItems.length}
                      </p>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                    <ScrollArea className={SCROLL_CLS}>
                      <div className="min-w-[900px]">
                        <table className={TABLE_CLS}>
                          <thead>
                            <tr>
                              <th className={WS_TH}>Date</th>
                              <th className={cn(WS_TH, 'w-28')}>Type</th>
                              <th className={WS_TH}>Supplier</th>
                              <th className={WS_TH}>Doc no.</th>
                              <th className={cn(WS_TH, 'text-right')}>IGST</th>
                              <th className={cn(WS_TH, 'text-right')}>CGST</th>
                              <th className={cn(WS_TH, 'text-right')}>SGST</th>
                              <th className={cn(WS_TH, 'w-24')}>Reversed</th>
                              <th className={cn(WS_TH, 'w-28')}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {expensedOutItems.map((r) => (
                              <tr key={r.id} className={cn(WS_TR, TONE_ROW[pendingKind(r).tone])}>
                                <td className={cn(WS_TD, 'whitespace-nowrap tabular-nums', TONE_STRIPE[pendingKind(r).tone])}>{isoToDisplay(r.date)}</td>
                                <td className={WS_TD}>{pendingTypeBadge(r)}</td>
                                <td className={WS_TD}>{r.supplier_name}</td>
                                <td className={WS_TD}>{r.supplier_invoice_number}</td>
                                <td className={WS_TD_NUM}>{num(r.input_igst)}</td>
                                <td className={WS_TD_NUM}>{num(r.input_cgst)}</td>
                                <td className={WS_TD_NUM}>{num(r.input_sgst)}</td>
                                <td className={WS_TD}>{r.reversal_month || '-'}</td>
                                <td className={WS_TD}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={writeLocked}
                                    onClick={() => undoExpenseOut(r.id)}
                                  >
                                    Undo
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* What the earlier version of an amendment counted, when Import 2B does not hold it. */}
      <Dialog open={!!baseDialog} onOpenChange={(open) => { if (!open) setBaseDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>What the earlier version counted</DialogTitle>
            <DialogDescription>
              {baseDialog && (
                <>
                  {docLabel(baseDialog.doc)} {baseDialog.doc.supplier_invoice_number} amends{' '}
                  {baseDialog.doc.original_doc_number || 'an earlier document'}
                  {baseDialog.doc.original_doc_date ? ` of ${isoToDisplay(baseDialog.doc.original_doc_date)}` : ''}, which is not in
                  Import 2B. Enter the figures that version counted (as on that{' '}
                  {DOC_TYPE_LABEL[docTypeOf({ doc_type: baseDialog.doc.original_doc_type || baseDialog.doc.doc_type })].toLowerCase()},
                  positive), so this amendment counts only the difference. Leave it empty if it was never claimed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {baseDialog && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(['taxable', 'igst', 'cgst', 'sgst', 'cess'] as BaseField[]).map((k) => (
                <label key={k} className="space-y-0.5">
                  <span className={WS_FILTER_LABEL}>{k === 'taxable' ? 'Taxable' : k.toUpperCase()}</span>
                  <Input
                    inputMode="decimal"
                    className="h-8 text-right text-xs tabular-nums"
                    value={baseDialog.values[k]}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBaseDialog((b) => (b ? { ...b, values: { ...b.values, [k]: v, ...(k === 'cgst' ? { sgst: v } : {}) } } : b));
                    }}
                  />
                </label>
              ))}
              <p className="col-span-full text-[11px] text-muted-foreground">
                Revised now: tax ₹{num(clean(taxOf(fullFigures(baseDialog.doc))))}. Counted:{' '}
                ₹{num(clean(toNum(baseDialog.values.igst) + toNum(baseDialog.values.cgst) + toNum(baseDialog.values.sgst)))}. CGST fills SGST.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {baseDialog && hasBase(baseDialog.doc) && (
              <Button variant="ghost" size="sm" className="mr-auto text-muted-foreground" disabled={isSavingBase || isImporting} onClick={() => saveBase(true)}>
                Clear
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={isSavingBase} onClick={() => setBaseDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={isSavingBase || isImporting} onClick={() => saveBase(false)}>
              {isSavingBase && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReclaimMatchDialog
        open={!!reclaimDialog}
        onOpenChange={(open) => { if (!open) setReclaimDialog(null); }}
        anchorLabel={reclaimDialog?.anchorLabel || ''}
        anchor={reclaimDialog?.anchor || null}
        candidates={reclaimDialog?.candidates || []}
        candidateLabel={reclaimDialog?.candidateLabel || ''}
        onConfirm={handleReclaimConfirm}
      />
    </div>
  );
};

export default Import2BTab;
