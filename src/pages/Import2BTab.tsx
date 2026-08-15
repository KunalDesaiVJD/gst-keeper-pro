import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Upload, Loader2, Trash2, Plus, Lock, X, RefreshCw, Inbox, FileSpreadsheet, Send, Clock } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { parseGstr2bFile } from '@/utils/parseGstr2b';
import { classifyBookAgainst2b, invoiceSimilar, TwoBLite } from '@/utils/matchTwob';
import { periodMonthLabel, planImport2BPost, postImport2BToLedger, isPostPlanEmpty } from '@/lib/postImport2B';
import ReclaimMatchDialog, { ReclaimInvoiceLite } from '@/components/dialogs/ReclaimMatchDialog';

// Phase 3 — the "Import 2B" tab. Import the portal's GSTR-2B .xlsx into the
// twob_import_docs staging table (non-RCM B2B only shown), let staff classify
// each doc, and manually enter books invoices missing from 2B. The write into
// bills_not_in_2b / bills_not_in_books is Phase 4.

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
  bucket: string;
  reverse_charge: boolean;
  itc_available: boolean | null;
  itc_reason: string | null;
  itc_action: string;
  matched_book_id: string | null;
  imported_at: string | null;
  imported_by: string | null;
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

const TWOB_ACTIONS = [
  { value: 'MATCHED', label: 'Matched' },
  { value: 'INELIGIBLE', label: 'Ineligible' },
  { value: 'ITC_OF_OTHERS', label: 'ITC of Others' },
  { value: 'MISMATCHED', label: 'Mismatched' },
  { value: 'NOT_IN_BOOKS', label: 'Not in Books' },
  { value: 'RECLAIM', label: 'Reclaim' },
];
// RECLAIM always goes through the matching dialog (Link & Reclaim) — never a
// blind bulk-apply, since each one has to be paired to a specific pending item.
const BULK_TWOB_ACTIONS = TWOB_ACTIONS.filter((a) => a.value !== 'RECLAIM');

const BOOK_TREATMENTS = [
  { value: 'NOT_IN_2B', label: 'Not in 2B' },
  { value: 'MISMATCHED', label: 'Mismatched' },
  { value: 'NOT_ELIGIBLE', label: 'Not Eligible' },
];

const num = (v: number | null | undefined) =>
  (v || v === 0) ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
const isoToDisplay = (iso: string | null) => {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const toNum = (v: string) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

interface Totals { count: number; taxable: number; igst: number; cgst: number; sgst: number }
const sumRows = (rows: { taxable_value: number; input_igst: number; input_cgst: number; input_sgst: number }[]): Totals =>
  rows.reduce((a, r) => ({
    count: a.count + 1,
    taxable: a.taxable + (r.taxable_value || 0),
    igst: a.igst + (r.input_igst || 0),
    cgst: a.cgst + (r.input_cgst || 0),
    sgst: a.sgst + (r.input_sgst || 0),
  }), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 });

const Import2BTab: React.FC = () => {
  const { user, isStaffRole } = useAuth();
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

  // Zone 4 — items already posted to the ledger, still awaiting a reclaim /
  // book-entry decision for this client + month.
  const [pendingBills2B, setPendingBills2B] = useState<PendingBill2B[]>([]);
  const [pendingBillsBooks, setPendingBillsBooks] = useState<PendingBillBooks[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [lastPosted, setLastPosted] = useState<{ at: string; version: number | null } | null>(null);
  const [reclaimDialog, setReclaimDialog] = useState<ReclaimDialogState | null>(null);

  // Multi-select + bulk apply (2B table)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState('');
  // Column header filters (2B table)
  const [filters, setFilters] = useState({ supplier: '', invoice: '', gstin: '', action: '' });

  const isStaff = isStaffRole();
  const readOnly = isLocked || !isStaff;
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

  const fetchAll = useCallback(async () => {
    setSelected(new Set());
    setBulkValue('');
    if (!selectedClient || !selectedMonth) {
      setTwoBDocs([]); setBooks([]); setRcmHidden(0); setLastImportedAt(null); setImporterName(null); setIsLocked(false);
      setPendingBills2B([]); setPendingBillsBooks([]); setLastPosted(null);
      return;
    }
    setIsLoading(true);
    try {
      const [docsRes, rcmRes, booksRes, filingRes, pending2BRes, pendingBooksRes, lastVersionRes] = await Promise.all([
        supabase.from('twob_import_docs').select('*')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth)
          .eq('reverse_charge', false).order('date'),
        supabase.from('twob_import_docs').select('id', { count: 'exact', head: true })
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).eq('reverse_charge', true),
        supabase.from('books_register').select('*')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).order('created_at'),
        supabase.from('filing_status').select('is_locked')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth)
          .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']).eq('status', 'Filed').maybeSingle(),
        // Zone 4 — still-open ledger items for this period (reclaim not yet
        // assigned / not yet booked), whichever period first posted them.
        supabase.from('bills_not_in_2b').select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, reversal_month, reclaim_month, reclaim_subtype')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).is('reclaim_month', null).order('date'),
        supabase.from('bills_not_in_books').select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, book_entry_month, bill_in_2b_month')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).is('book_entry_month', null).order('date'),
        supabase.from('twob_versions').select('updated_at, version_number')
          .eq('client_id', selectedClient).eq('period_month', selectedMonth).eq('is_current', true).maybeSingle(),
      ]);
      const docs = (docsRes.data || []) as TwoBDoc[];
      setTwoBDocs(docs);
      setRcmHidden(rcmRes.count || 0);
      setBooks((booksRes.data || []) as BookRow[]);
      setLastImportedAt(docs[0]?.imported_at ?? null);
      setIsLocked(!!filingRes.data?.is_locked);
      setPendingBills2B((pending2BRes.data || []) as PendingBill2B[]);
      setPendingBillsBooks((pendingBooksRes.data || []) as PendingBillBooks[]);
      setLastPosted(lastVersionRes.data ? { at: lastVersionRes.data.updated_at as string, version: lastVersionRes.data.version_number } : null);

      const importedById = docs[0]?.imported_by ?? null;
      if (importedById) {
        const { data: prof } = await supabase.from('profiles').select('first_name').eq('user_id', importedById).maybeSingle();
        setImporterName(prof?.first_name ?? null);
      } else {
        setImporterName(null);
      }
    } catch (err: any) {
      toast.error('Failed to load: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const twoBLites: TwoBLite[] = useMemo(
    () => twoBDocs.map((d) => ({
      id: d.id, supplierGstin: d.supplier_gstin, supplierInvoiceNumber: d.supplier_invoice_number,
      inputIgst: d.input_igst, inputCgst: d.input_cgst, inputSgst: d.input_sgst,
    })),
    [twoBDocs],
  );

  const filteredDocs = useMemo(() => twoBDocs.filter((d) => {
    if (filters.supplier && !(d.supplier_name || '').toLowerCase().includes(filters.supplier.toLowerCase())) return false;
    if (filters.invoice && !(d.supplier_invoice_number || '').toLowerCase().includes(filters.invoice.toLowerCase())) return false;
    if (filters.gstin && !(d.supplier_gstin || '').toLowerCase().includes(filters.gstin.toLowerCase())) return false;
    if (filters.action && d.itc_action !== filters.action) return false;
    return true;
  }), [twoBDocs, filters]);

  const anyFilter = filters.supplier || filters.invoice || filters.gstin || filters.action;
  const allFilteredSelected = filteredDocs.length > 0 && filteredDocs.every((d) => selected.has(d.id));

  // ---- Import ----------------------------------------------------------------
  const handleImportClick = () => {
    if (!selectedClient || !selectedMonth) { toast.error('Select a client and month first'); return; }
    if (isLocked) { toast.error('The return is filed — this sheet is locked.'); return; }
    fileInputRef.current?.click();
  };

  // Shared import path — used by both the manual file picker and the extension's
  // "Pull from portal" hand-off (a portal-downloaded .xlsx, reconstructed to a File).
  const importFile = async (file: File) => {
    if (!file || !selectedClient || !selectedMonth) return;

    setIsImporting(true);
    try {
      const result = await parseGstr2bFile(file);
      const client = clients.find((c) => c.id === selectedClient);

      const fileGstin = (result.header.gstin || '').toUpperCase().trim();
      const clientGstin = (client?.gstin || '').toUpperCase().trim();
      if (fileGstin && clientGstin && fileGstin !== clientGstin) {
        if (!(await confirm({ title: 'GSTIN mismatch', description: `The file's GSTIN (${fileGstin}) doesn't match ${client?.name} (${clientGstin}). Import anyway?`, confirmText: 'Import anyway' }))) {
          setIsImporting(false); return;
        }
      }
      if (result.header.periodMonthKey && result.header.periodMonthKey !== selectedMonth) {
        if (!(await confirm({ title: 'Period mismatch', description: `The file is for ${result.header.periodLabel || result.header.periodMonthKey}, but ${selectedMonth} is selected. Import anyway?`, confirmText: 'Import anyway' }))) {
          setIsImporting(false); return;
        }
      }
      if (result.records.length === 0) { toast.error('No B2B rows found in this file.'); setIsImporting(false); return; }
      result.warnings.forEach((w) => toast.warning(w));

      const batchId = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now());
      const nowIso = new Date().toISOString();
      const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

      const rows = result.records.map((r) => ({
        client_id: selectedClient,
        period_month: selectedMonth,
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
        itc_action: r.reverseCharge ? 'MATCHED' : (r.itcAvailable === false ? 'INELIGIBLE' : 'MATCHED'),
        import_batch_id: batchId,
        imported_by: user?.id,
        imported_at: nowIso,
        updated_by: user?.id,
        updated_at: nowIso,
      }));

      // Re-import fully replaces the previous batch (RCM + non-RCM) for this client + period.
      const { error: delErr } = await supabase.from('twob_import_docs')
        .delete().eq('client_id', selectedClient).eq('period_month', selectedMonth);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase.from('twob_import_docs').insert(rows);
      if (insErr) throw insErr;

      const rcm = result.records.filter((r) => r.reverseCharge).length;
      toast.success(
        `Imported ${result.records.length - rcm} B2B docs${rcm ? ` · ${rcm} RCM hidden (RCM Summary)` : ''}.`,
      );
      await fetchAll();
    } catch (err: any) {
      toast.error('Import failed: ' + (err?.message || 'Unknown error'));
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
    if (!selectedClient || !selectedMonth) { toast.error('Select a client and month first'); return; }
    if (isLocked) { toast.error('The return is filed — this sheet is locked.'); return; }
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension, then reload this page.'); return; }
    window.postMessage({ __gstkPull2B: { clientId: selectedClient, period_month: selectedMonth } }, '*');
    toast.info('Opening the portal in a new tab — type the CAPTCHA there; the GSTR-2B will import here automatically when it finishes.');
  };

  const deleteImported2B = async () => {
    if (readOnly || !selectedClient || !selectedMonth || twoBDocs.length === 0) return;
    if (!(await confirm({ title: 'Delete imported 2B?', description: `Delete ALL imported GSTR-2B for ${selectedClientName} — ${selectedMonth}? Books entries are kept.`, destructive: true, confirmText: 'Delete' }))) return;
    const { error } = await supabase.from('twob_import_docs')
      .delete().eq('client_id', selectedClient).eq('period_month', selectedMonth);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Imported 2B cleared.');
    await fetchAll();
  };

  // ---- 2B doc action (single + bulk) ----------------------------------------
  const setDocAction = async (docId: string, action: string) => {
    setTwoBDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, itc_action: action } : d)));
    const { error } = await supabase.from('twob_import_docs')
      .update({ itc_action: action, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', docId);
    if (error) { toast.error('Save failed: ' + error.message); fetchAll(); }
  };

  // ---- Reclaim by matching ---------------------------------------------------
  // Reclaiming previously-reversed ITC requires evidence the same invoice is
  // actually back in 2B — never a self-certified monthly pick. Both entry
  // points (a fresh 2B doc, or a pending reversed item) open the same
  // matching dialog and only commit on an exact amount match.
  const toReclaimLite = (d: {
    id: string; date: string | null; supplier_name: string | null; supplier_invoice_number: string | null;
    supplier_gstin: string | null; taxable_value: number; input_igst: number; input_cgst: number; input_sgst: number;
  }): ReclaimInvoiceLite => ({
    id: d.id, date: d.date, supplierName: d.supplier_name, supplierInvoiceNumber: d.supplier_invoice_number,
    supplierGstin: d.supplier_gstin, taxableValue: d.taxable_value || 0,
    igst: d.input_igst || 0, cgst: d.input_cgst || 0, sgst: d.input_sgst || 0,
  });

  // Surface likely matches first (same GSTIN + a similar invoice number), then by date.
  const sortReclaimCandidates = (
    anchor: { supplier_gstin: string | null; supplier_invoice_number: string | null },
    list: ReclaimInvoiceLite[],
  ) => {
    const g = (anchor.supplier_gstin || '').toUpperCase().trim();
    const score = (c: ReclaimInvoiceLite) =>
      (c.supplierGstin || '').toUpperCase().trim() === g && invoiceSimilar(c.supplierInvoiceNumber, anchor.supplier_invoice_number) ? 0 : 1;
    return [...list].sort((a, b) => score(a) - score(b) || (b.date || '').localeCompare(a.date || ''));
  };

  const handleDocActionChange = async (doc: TwoBDoc, newAction: string) => {
    if (readOnly) return;
    if (newAction === 'RECLAIM') {
      setReclaimDialog({
        mode: 'fromDoc',
        anchor: toReclaimLite(doc),
        anchorLabel: 'This GSTR-2B document',
        candidates: sortReclaimCandidates(doc, pendingBills2B.map(toReclaimLite)),
        candidateLabel: 'pending reversed item',
        docId: doc.id,
      });
      return;
    }
    const wasReclaim = doc.itc_action === 'RECLAIM';
    if (wasReclaim) {
      // Moving away from RECLAIM — release whichever pending item this doc
      // was linked to, so it goes back to "awaiting reclaim".
      const { error } = await supabase.from('bills_not_in_2b')
        .update({ reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('reclaimed_via_doc_id', doc.id);
      if (error) { toast.error('Could not unlink reclaim: ' + error.message); return; }
    }
    await setDocAction(doc.id, newAction);
    if (wasReclaim) await fetchAll();
  };

  const openReclaimFromPending = (row: PendingBill2B) => {
    const eligibleDocs = twoBDocs.filter((d) => d.itc_action === 'MATCHED' || d.itc_action === 'MISMATCHED');
    setReclaimDialog({
      mode: 'fromPending',
      anchor: toReclaimLite(row),
      anchorLabel: 'Pending reversed item',
      candidates: sortReclaimCandidates(row, eligibleDocs.map(toReclaimLite)),
      candidateLabel: 'GSTR-2B document',
      pendingId: row.id,
    });
  };

  const confirmReclaim = async (pendingId: string, docId: string) => {
    const nowIso = new Date().toISOString();
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

  const applyBulk = async () => {
    if (!bulkValue || selected.size === 0 || readOnly) return;
    const ids = [...selected];
    // Bulk-apply never targets RECLAIM itself (see BULK_TWOB_ACTIONS), but a
    // selected doc might already BE one — release its linked pending item
    // first so it doesn't dangle, pointing at a doc that no longer reclaims it.
    const reclaimIds = twoBDocs.filter((d) => ids.includes(d.id) && d.itc_action === 'RECLAIM').map((d) => d.id);
    if (reclaimIds.length > 0) {
      const { error: unlinkError } = await supabase.from('bills_not_in_2b')
        .update({ reclaim_month: null, reclaim_subtype: null, reclaimed_via_doc_id: null, updated_by: user?.id, updated_at: new Date().toISOString() })
        .in('reclaimed_via_doc_id', reclaimIds);
      if (unlinkError) { toast.error('Could not unlink reclaim: ' + unlinkError.message); return; }
    }
    setTwoBDocs((prev) => prev.map((d) => (ids.includes(d.id) ? { ...d, itc_action: bulkValue } : d)));
    const { error } = await supabase.from('twob_import_docs')
      .update({ itc_action: bulkValue, updated_by: user?.id, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { toast.error('Bulk update failed: ' + error.message); fetchAll(); return; }
    toast.success(`Set ${ids.length} row(s) to ${TWOB_ACTIONS.find((a) => a.value === bulkValue)?.label}.`);
    setSelected(new Set());
    setBulkValue('');
    if (reclaimIds.length > 0) await fetchAll();
  };

  // ---- Books register --------------------------------------------------------
  const addBookRow = async () => {
    if (readOnly || !selectedClient || !selectedMonth) return;
    const { data, error } = await supabase.from('books_register').insert({
      client_id: selectedClient, period_month: selectedMonth, book_treatment: 'NOT_IN_2B', updated_by: user?.id,
    }).select('*').single();
    if (error) { toast.error('Add failed: ' + error.message); return; }
    setBooks((prev) => [...prev, data as BookRow]);
  };

  const updateBookLocal = (id: string, patch: Partial<BookRow>) =>
    setBooks((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const saveBookRow = async (id: string, classify: boolean) => {
    const row = books.find((r) => r.id === id);
    if (!row) return;
    let treatment = row.book_treatment;
    let matched2bId = row.matched_2b_id;

    if (classify && row.supplier_gstin && row.supplier_invoice_number) {
      const res = classifyBookAgainst2b(
        { supplierGstin: row.supplier_gstin, supplierInvoiceNumber: row.supplier_invoice_number, inputIgst: row.input_igst, inputCgst: row.input_cgst, inputSgst: row.input_sgst },
        twoBLites,
      );
      if (res.classification === 'NOT_IN_2B') { treatment = 'NOT_IN_2B'; matched2bId = null; }
      else if (res.classification === 'MISMATCHED') {
        treatment = 'MISMATCHED'; matched2bId = res.match?.id ?? null;
        if (res.match) {
          await supabase.from('twob_import_docs')
            .update({ itc_action: 'MISMATCHED', matched_book_id: id, updated_by: user?.id, updated_at: new Date().toISOString() })
            .eq('id', res.match.id);
        }
      } else if (res.classification === 'ALREADY_IN_2B') {
        toast.warning(`This invoice looks like it is already in 2B (matched): ${row.supplier_name || row.supplier_invoice_number}. Add only if it is genuinely missing.`);
      }
    }

    const { error } = await supabase.from('books_register').update({
      date: row.date, supplier_name: row.supplier_name, supplier_invoice_number: row.supplier_invoice_number,
      supplier_gstin: row.supplier_gstin, taxable_value: row.taxable_value,
      input_igst: row.input_igst, input_cgst: row.input_cgst, input_sgst: row.input_sgst,
      book_treatment: treatment, matched_2b_id: matched2bId,
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    if (treatment !== row.book_treatment || matched2bId !== row.matched_2b_id) {
      updateBookLocal(id, { book_treatment: treatment, matched_2b_id: matched2bId });
      if (matched2bId) fetchAll();
    }
  };

  const setBookTreatment = async (id: string, treatment: string) => {
    updateBookLocal(id, { book_treatment: treatment });
    const { error } = await supabase.from('books_register')
      .update({ book_treatment: treatment, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error('Save failed: ' + error.message);
  };

  const deleteBookRow = async (id: string) => {
    if (readOnly) return;
    const row = books.find((r) => r.id === id);
    if (row?.matched_2b_id) {
      await supabase.from('twob_import_docs')
        .update({ itc_action: 'MATCHED', matched_book_id: null }).eq('id', row.matched_2b_id);
    }
    const { error } = await supabase.from('books_register').delete().eq('id', id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    setBooks((prev) => prev.filter((r) => r.id !== id));
    if (row?.matched_2b_id) fetchAll();
  };

  // ---- Post to Reconciliation -------------------------------------------------
  // Writes NOT_IN_BOOKS / NOT_IN_2B rows through to the live bills_not_in_2b /
  // bills_not_in_books ledger that ITC Summary, Suspended Reco and
  // carry-forward read from. 2B Reconciliation itself is read-only — this is
  // the only place that ledger gets written for this period.
  const currentLabel = useMemo(() => periodMonthLabel(selectedMonth), [selectedMonth]);

  const handlePostToReconciliation = async () => {
    if (readOnly || !selectedClient || !selectedMonth) return;
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
      const skipped = plan.skippedBooks.length + plan.skippedDocs.length;
      if (skipped) parts.push(`${skipped} row(s) skipped — missing date/supplier, fix in the tables above`);

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

      const result = await postImport2BToLedger(selectedClient, selectedMonth, user?.id, plan);
      toast.success(
        `Posted to Reconciliation${result.versionNumber ? ` — v${result.versionNumber}` : ''}. ` +
        `${result.inserted2B + result.insertedBooks} new, ${result.updated2B + result.updatedBooks} updated, ${result.retracted2B + result.retractedBooks} removed.` +
        (result.skipped ? ` ${result.skipped} row(s) skipped.` : ''),
      );
      await fetchAll();
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
    const { error } = await supabase.from('bills_not_in_2b')
      .update({ reclaim_month: currentLabel, reclaim_subtype: 'EXPENSE_OUT', updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setPendingBills2B((prev) => prev.filter((r) => r.id !== id));
    toast.success('Marked as expense out.');
  };

  const setPendingBookEntry = async (id: string, value: 'blank' | 'current') => {
    const patch = value === 'blank' ? { book_entry_month: null } : { book_entry_month: currentLabel };
    const { error } = await supabase.from('bills_not_in_books')
      .update({ ...patch, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setPendingBillsBooks((prev) => prev.filter((r) => value === 'blank' ? true : r.id !== id));
    if (value !== 'blank') toast.success('Book entry recorded.');
  };

  // ---- Amount-wise summary ---------------------------------------------------
  const summary2b = useMemo(
    () => TWOB_ACTIONS.map((a) => ({ label: a.label, ...sumRows(twoBDocs.filter((d) => d.itc_action === a.value)) })),
    [twoBDocs],
  );
  const summaryBooks = useMemo(
    () => BOOK_TREATMENTS.map((t) => ({ label: t.label, ...sumRows(books.filter((b) => b.book_treatment === t.value)) })),
    [books],
  );

  const selectedClientName = clients.find((c) => c.id === selectedClient)?.name || '';
  const rowSelectCls = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60';
  const cellInputCls = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60';
  const filterInputCls = 'h-7 w-full rounded border border-input bg-background px-1.5 text-[11px] font-normal';

  const renderSummaryTable = (title: string, rows: (Totals & { label: string })[]) => {
    const tot = rows.reduce((a, r) => ({ count: a.count + r.count, taxable: a.taxable + r.taxable, igst: a.igst + r.igst, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst }), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    return (
      <div>
        <p className="text-sm font-medium mb-2">{title}</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/60">
              <th className="border border-border p-2 text-left">Classification</th>
              <th className="border border-border p-2 text-right w-14">Count</th>
              <th className="border border-border p-2 text-right tabular-nums">Taxable</th>
              <th className="border border-border p-2 text-right tabular-nums">IGST</th>
              <th className="border border-border p-2 text-right tabular-nums">CGST</th>
              <th className="border border-border p-2 text-right tabular-nums">SGST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="border border-border p-2">{r.label}</td>
                <td className="border border-border p-2 text-right tabular-nums">{r.count}</td>
                <td className="border border-border p-2 text-right tabular-nums">{num(r.taxable)}</td>
                <td className="border border-border p-2 text-right tabular-nums">{num(r.igst)}</td>
                <td className="border border-border p-2 text-right tabular-nums">{num(r.cgst)}</td>
                <td className="border border-border p-2 text-right tabular-nums">{num(r.sgst)}</td>
              </tr>
            ))}
            <tr className="font-medium bg-muted/30">
              <td className="border border-border p-2">Total</td>
              <td className="border border-border p-2 text-right tabular-nums">{tot.count}</td>
              <td className="border border-border p-2 text-right tabular-nums">{num(tot.taxable)}</td>
              <td className="border border-border p-2 text-right tabular-nums">{num(tot.igst)}</td>
              <td className="border border-border p-2 text-right tabular-nums">{num(tot.cgst)}</td>
              <td className="border border-border p-2 text-right tabular-nums">{num(tot.sgst)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        embedded
        title="Import 2B"
        subtitle="Import GSTR-2B & reconcile with books · B2B only"
        actions={isStaff ? (
          <>
            <Button
              variant="outline"
              onClick={pull2BFromPortal}
              disabled={isImporting || !selectedClient || !selectedMonth || isLocked}
              className={extReady ? '' : 'text-muted-foreground'}
              title={extReady
                ? 'Pull this client\'s GSTR-2B from the portal via the browser extension'
                : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Pull from portal
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={handleImportClick}
              disabled={isImporting || !selectedClient || !selectedMonth || isLocked}
              title="Manual fallback — import a GSTR-2B Excel file if the portal pull didn't work"
            >
              <Upload className="h-3.5 w-3.5 mr-1" />
              Import file
            </Button>
            {(twoBDocs.length > 0 || books.length > 0) && (
              <Button
                onClick={handlePostToReconciliation}
                disabled={isPosting || readOnly}
                title="Write NOT_IN_BOOKS / NOT_IN_2B classifications through to the live 2B Reconciliation ledger"
              >
                {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Post to Reconciliation
              </Button>
            )}
            {twoBDocs.length > 0 && (
              <Button variant="destructive" size="sm" onClick={deleteImported2B} disabled={readOnly}>
                <Trash2 className="h-4 w-4 mr-2" />Delete 2B
              </Button>
            )}
          </>
        ) : undefined}
      />
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />

      {/* Filters (client / month) */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Client:</span>
              <div className="w-56">
                <SearchableSelect options={clients.map((c) => ({ value: c.id, label: c.name }))}
                  value={selectedClient} onValueChange={setSelectedClient} placeholder="Select Client" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Month:</span>
              <div className="w-32">
                <SearchableMonthSelect options={monthOptions} value={selectedMonth} onValueChange={setSelectedMonth} placeholder="Select Month" />
              </div>
            </div>
            {lastImportedAt && (
              <div className="text-xs text-muted-foreground ml-auto text-right">
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
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning">
          <Lock className="h-4 w-4 shrink-0" />
          <span className="text-sm">This sheet is locked because the return has been filed.</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-8">
            <TableEmptyState
              icon={<FileSpreadsheet className="h-6 w-6" />}
              title="Select a client and month to begin"
              description="Pick a client and return period above to import and reconcile GSTR-2B."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Zone 1 — imported 2B */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-foreground">1 · GSTR-2B (imported)</p>
                  <p className="text-xs text-muted-foreground">
                    {filteredDocs.length}{anyFilter ? ` of ${twoBDocs.length}` : ''} B2B docs{rcmHidden ? ` · ${rcmHidden} RCM hidden (RCM Summary)` : ''} · set the action per row
                  </p>
                </div>
                {/* Bulk apply bar */}
                {!readOnly && selected.size > 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1">
                    <span className="text-xs font-medium">{selected.size} selected</span>
                    <select className="h-7 rounded-md border border-input bg-background px-2 text-xs" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                      <option value="">Set action to…</option>
                      {BULK_TWOB_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Button size="sm" className="h-7" onClick={applyBulk} disabled={!bulkValue}>Apply</Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => setSelected(new Set())}
                      aria-label="Clear selection"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              {twoBDocs.length === 0 ? (
                <TableEmptyState
                  icon={<FileSpreadsheet className="h-6 w-6" />}
                  title="No GSTR-2B imported"
                  description={`Nothing imported for ${selectedClientName} — ${selectedMonth}.${isStaff && !isLocked ? ' Use "Pull from portal" to fetch it.' : ''}`}
                />
              ) : (
                <ScrollArea className="w-full">
                  <div className="min-w-[1050px]">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-primary text-primary-foreground">
                          <th className="border border-primary-foreground/20 p-2 w-9 text-center">
                            <div className="flex items-center justify-center">
                              <Checkbox
                                className="border-primary-foreground/60 data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
                                checked={allFilteredSelected}
                                onCheckedChange={toggleAllFiltered}
                                disabled={readOnly}
                                aria-label="Select all rows"
                              />
                            </div>
                          </th>
                          <th className="border border-primary-foreground/20 p-2 text-left">Date</th>
                          <th className="border border-primary-foreground/20 p-2 text-left">Supplier</th>
                          <th className="border border-primary-foreground/20 p-2 text-left">Invoice</th>
                          <th className="border border-primary-foreground/20 p-2 text-left">GSTIN</th>
                          <th className="border border-primary-foreground/20 p-2 text-right">Taxable</th>
                          <th className="border border-primary-foreground/20 p-2 text-right">IGST</th>
                          <th className="border border-primary-foreground/20 p-2 text-right">CGST</th>
                          <th className="border border-primary-foreground/20 p-2 text-right">SGST</th>
                          <th className="border border-primary-foreground/20 p-2 text-left w-40">Action</th>
                        </tr>
                        {/* Heading filter row */}
                        <tr className="bg-muted">
                          <th className="border border-border p-1"></th>
                          <th className="border border-border p-1"></th>
                          <th className="border border-border p-1">
                            <input className={filterInputCls} placeholder="Filter…" value={filters.supplier} onChange={(e) => setFilters((f) => ({ ...f, supplier: e.target.value }))} />
                          </th>
                          <th className="border border-border p-1">
                            <input className={filterInputCls} placeholder="Filter…" value={filters.invoice} onChange={(e) => setFilters((f) => ({ ...f, invoice: e.target.value }))} />
                          </th>
                          <th className="border border-border p-1">
                            <input className={filterInputCls} placeholder="Filter…" value={filters.gstin} onChange={(e) => setFilters((f) => ({ ...f, gstin: e.target.value }))} />
                          </th>
                          <th className="border border-border p-1"></th>
                          <th className="border border-border p-1"></th>
                          <th className="border border-border p-1"></th>
                          <th className="border border-border p-1"></th>
                          <th className="border border-border p-1">
                            <select className={filterInputCls + ' h-7'} value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
                              <option value="">All</option>
                              {TWOB_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDocs.length === 0 ? (
                          <TableEmptyState
                            colSpan={10}
                            icon={<Inbox className="h-6 w-6" />}
                            title="No rows match the filters"
                            description="Clear or change the column filters above to see imported documents."
                          />
                        ) : filteredDocs.map((d) => (
                          <tr key={d.id} className={selected.has(d.id) ? 'bg-primary/5' : 'hover:bg-muted/40'}>
                            <td className="border border-border p-2 text-center">
                              <div className="flex items-center justify-center">
                                <Checkbox
                                  checked={selected.has(d.id)}
                                  onCheckedChange={() => toggleRow(d.id)}
                                  disabled={readOnly}
                                  aria-label={`Select ${d.supplier_invoice_number || 'row'}`}
                                />
                              </div>
                            </td>
                            <td className="border border-border p-2 whitespace-nowrap tabular-nums">{isoToDisplay(d.date)}</td>
                            <td className="border border-border p-2">{d.supplier_name}</td>
                            <td className="border border-border p-2">{d.supplier_invoice_number}</td>
                            <td className="border border-border p-2 font-mono">{d.supplier_gstin}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(d.taxable_value)}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(d.input_igst)}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(d.input_cgst)}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(d.input_sgst)}</td>
                            <td className="border border-border p-2">
                              <select className={rowSelectCls} value={d.itc_action} disabled={readOnly} onChange={(e) => handleDocActionChange(d, e.target.value)}>
                                {TWOB_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Zone 2 — books register */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">2 · Books / purchase register</p>
                  <p className="text-xs text-muted-foreground">Add invoices booked but missing from 2B · CGST fills SGST</p>
                </div>
                {!readOnly && (
                  <Button variant="outline" size="sm" onClick={addBookRow}><Plus className="h-4 w-4 mr-1" />Add row</Button>
                )}
              </div>
              <ScrollArea className="w-full">
                <div className="min-w-[1050px]">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-primary text-primary-foreground">
                        <th className="border border-primary-foreground/20 p-2 text-left w-28">Date</th>
                        <th className="border border-primary-foreground/20 p-2 text-left">Supplier</th>
                        <th className="border border-primary-foreground/20 p-2 text-left">Invoice</th>
                        <th className="border border-primary-foreground/20 p-2 text-left">GSTIN</th>
                        <th className="border border-primary-foreground/20 p-2 text-right w-24">Taxable</th>
                        <th className="border border-primary-foreground/20 p-2 text-right w-20">IGST</th>
                        <th className="border border-primary-foreground/20 p-2 text-right w-20">CGST</th>
                        <th className="border border-primary-foreground/20 p-2 text-right w-20">SGST</th>
                        <th className="border border-primary-foreground/20 p-2 text-left w-32">Treatment</th>
                        {!readOnly && <th className="border border-primary-foreground/20 p-2 w-10"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {books.length === 0 ? (
                        <TableEmptyState
                          colSpan={readOnly ? 9 : 10}
                          icon={<Inbox className="h-6 w-6" />}
                          title="No books invoices added"
                          description={readOnly ? undefined : 'Use "Add row" to record invoices booked but missing from 2B.'}
                        />
                      ) : books.map((b) => (
                        <tr key={b.id}>
                          <td className="border border-border p-1">
                            <input type="date" className={cellInputCls} value={b.date || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { date: e.target.value })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={cellInputCls} value={b.supplier_name || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { supplier_name: e.target.value })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={cellInputCls} value={b.supplier_invoice_number || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { supplier_invoice_number: e.target.value })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} font-mono`} value={b.supplier_gstin || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { supplier_gstin: e.target.value.toUpperCase() })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.taxable_value || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { taxable_value: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.input_igst || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { input_igst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.input_cgst || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { input_cgst: toNum(e.target.value), input_sgst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right tabular-nums`} value={b.input_sgst || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { input_sgst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <select className={rowSelectCls} value={b.book_treatment} disabled={readOnly} onChange={(e) => setBookTreatment(b.id, e.target.value)}>
                              {BOOK_TREATMENTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          {!readOnly && (
                            <td className="border border-border p-1 text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => deleteBookRow(b.id)}
                                aria-label={`Delete books row ${b.supplier_invoice_number || ''}`.trim()}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {books.length > 0 && (() => {
                      const bookTotals = sumRows(books);
                      return (
                        <tfoot>
                          <tr className="font-medium bg-muted/30">
                            <td className="border border-border p-2" colSpan={4}>
                              Total ({bookTotals.count})
                            </td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(bookTotals.taxable)}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(bookTotals.igst)}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(bookTotals.cgst)}</td>
                            <td className="border border-border p-2 text-right tabular-nums">{num(bookTotals.sgst)}</td>
                            <td className="border border-border p-2" colSpan={readOnly ? 1 : 2} />
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Zone 3 — amount-wise summary */}
          <Card>
            <CardContent className="p-4 space-y-5">
              <p className="font-semibold text-foreground">3 · Reconciliation summary (amount-wise)</p>
              {renderSummaryTable('GSTR-2B (imported) — by action', summary2b)}
              {renderSummaryTable('Books — by treatment', summaryBooks)}
              {rcmHidden > 0 && <p className="text-xs text-muted-foreground">Plus {rcmHidden} RCM doc(s) hidden — handled in RCM Summary.</p>}
              <p className="text-xs text-muted-foreground">
                Matched supplies claim at the 2B figure and feed ITC Summary directly. "Not in Books" and "Not in 2B"
                rows only reach the live ledger once you click <span className="font-medium text-foreground">Post to Reconciliation</span> above.
              </p>
            </CardContent>
          </Card>

          {/* Zone 4 — pending items already on the ledger, awaiting a decision */}
          {(pendingBills2B.length > 0 || pendingBillsBooks.length > 0) && (
            <Card>
              <CardContent className="p-4 space-y-5">
                <div>
                  <p className="font-semibold text-foreground flex items-center gap-2"><Clock className="h-4 w-4" />4 · Pending items</p>
                  <p className="text-xs text-muted-foreground">
                    Already on the 2B Reconciliation ledger for {selectedMonth} · decide Reclaim / Book Entry here — the ledger itself is read-only.
                  </p>
                </div>

                {pendingBills2B.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Awaiting reclaim (booked, reversed — not yet back in 2B)</p>
                    <ScrollArea className="w-full">
                      <div className="min-w-[900px]">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-primary text-primary-foreground">
                              <th className="border border-primary-foreground/20 p-2 text-left">Date</th>
                              <th className="border border-primary-foreground/20 p-2 text-left">Supplier</th>
                              <th className="border border-primary-foreground/20 p-2 text-left">Invoice</th>
                              <th className="border border-primary-foreground/20 p-2 text-right">IGST</th>
                              <th className="border border-primary-foreground/20 p-2 text-right">CGST</th>
                              <th className="border border-primary-foreground/20 p-2 text-right">SGST</th>
                              <th className="border border-primary-foreground/20 p-2 text-left w-24">Reversed</th>
                              <th className="border border-primary-foreground/20 p-2 text-left w-44">Reclaim</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pendingBills2B.map((r) => (
                              <tr key={r.id}>
                                <td className="border border-border p-2 whitespace-nowrap tabular-nums">{isoToDisplay(r.date)}</td>
                                <td className="border border-border p-2">{r.supplier_name}</td>
                                <td className="border border-border p-2">{r.supplier_invoice_number}</td>
                                <td className="border border-border p-2 text-right tabular-nums">{num(r.input_igst)}</td>
                                <td className="border border-border p-2 text-right tabular-nums">{num(r.input_cgst)}</td>
                                <td className="border border-border p-2 text-right tabular-nums">{num(r.input_sgst)}</td>
                                <td className="border border-border p-2">{r.reversal_month || '-'}</td>
                                <td className="border border-border p-2">
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      disabled={readOnly}
                                      onClick={() => openReclaimFromPending(r)}
                                    >
                                      Link &amp; Reclaim
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                      disabled={readOnly}
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
                  </div>
                )}

                {pendingBillsBooks.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Awaiting book entry (in 2B — not yet booked)</p>
                    <ScrollArea className="w-full">
                      <div className="min-w-[900px]">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-primary text-primary-foreground">
                              <th className="border border-primary-foreground/20 p-2 text-left">Date</th>
                              <th className="border border-primary-foreground/20 p-2 text-left">Supplier</th>
                              <th className="border border-primary-foreground/20 p-2 text-left">Invoice</th>
                              <th className="border border-primary-foreground/20 p-2 text-right">IGST</th>
                              <th className="border border-primary-foreground/20 p-2 text-right">CGST</th>
                              <th className="border border-primary-foreground/20 p-2 text-right">SGST</th>
                              <th className="border border-primary-foreground/20 p-2 text-left w-24">In 2B since</th>
                              <th className="border border-primary-foreground/20 p-2 text-left w-40">Book Entry</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pendingBillsBooks.map((r) => (
                              <tr key={r.id}>
                                <td className="border border-border p-2 whitespace-nowrap tabular-nums">{isoToDisplay(r.date)}</td>
                                <td className="border border-border p-2">{r.supplier_name}</td>
                                <td className="border border-border p-2">{r.supplier_invoice_number}</td>
                                <td className="border border-border p-2 text-right tabular-nums">{num(r.input_igst)}</td>
                                <td className="border border-border p-2 text-right tabular-nums">{num(r.input_cgst)}</td>
                                <td className="border border-border p-2 text-right tabular-nums">{num(r.input_sgst)}</td>
                                <td className="border border-border p-2">{r.bill_in_2b_month || '-'}</td>
                                <td className="border border-border p-2">
                                  <select
                                    className={rowSelectCls}
                                    disabled={readOnly}
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
                    <p className="text-xs text-muted-foreground mt-2">
                      Once booked, claim the ITC under ITC Summary row 5.2 "ITC for Previous Month" — this invoice
                      won't reappear in a future GSTR-2B pull.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

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
