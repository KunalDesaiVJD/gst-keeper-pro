import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Upload, Loader2, Trash2, Plus, Lock, X, Download, RefreshCw } from 'lucide-react';
import { PortalActionButton } from '@/components/portal/PortalActionButton';
import { PortalJobsPanel } from '@/components/portal/PortalJobsPanel';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { parseGstr2bFile } from '@/utils/parseGstr2b';
import { classifyBookAgainst2b, TwoBLite } from '@/utils/matchTwob';

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

const TWOB_ACTIONS = [
  { value: 'MATCHED', label: 'Matched' },
  { value: 'INELIGIBLE', label: 'Ineligible' },
  { value: 'ITC_OF_OTHERS', label: 'ITC of Others' },
  { value: 'MISMATCHED', label: 'Mismatched' },
  { value: 'NOT_IN_BOOKS', label: 'Not in Books' },
];

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

  // Multi-select + bulk apply (2B table)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState('');
  // Column header filters (2B table)
  const [filters, setFilters] = useState({ supplier: '', invoice: '', gstin: '', action: '' });

  const isStaff = isStaffRole();
  const readOnly = isLocked || !isStaff;

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
      return;
    }
    setIsLoading(true);
    try {
      const [docsRes, rcmRes, booksRes, filingRes] = await Promise.all([
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
      ]);
      const docs = (docsRes.data || []) as TwoBDoc[];
      setTwoBDocs(docs);
      setRcmHidden(rcmRes.count || 0);
      setBooks((booksRes.data || []) as BookRow[]);
      setLastImportedAt(docs[0]?.imported_at ?? null);
      setIsLocked(!!filingRes.data?.is_locked);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !selectedClient || !selectedMonth) return;

    setIsImporting(true);
    try {
      const result = await parseGstr2bFile(file);
      const client = clients.find((c) => c.id === selectedClient);

      const fileGstin = (result.header.gstin || '').toUpperCase().trim();
      const clientGstin = (client?.gstin || '').toUpperCase().trim();
      if (fileGstin && clientGstin && fileGstin !== clientGstin) {
        if (!confirm(`The file's GSTIN (${fileGstin}) does not match ${client?.name} (${clientGstin}). Import anyway?`)) {
          setIsImporting(false); return;
        }
      }
      if (result.header.periodMonthKey && result.header.periodMonthKey !== selectedMonth) {
        if (!confirm(`The file is for ${result.header.periodLabel || result.header.periodMonthKey}, but ${selectedMonth} is selected. Import anyway?`)) {
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

  const deleteImported2B = async () => {
    if (readOnly || !selectedClient || !selectedMonth || twoBDocs.length === 0) return;
    if (!confirm(`Delete ALL imported GSTR-2B for ${selectedClientName} — ${selectedMonth}? Books entries are kept.`)) return;
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
    setTwoBDocs((prev) => prev.map((d) => (ids.includes(d.id) ? { ...d, itc_action: bulkValue } : d)));
    const { error } = await supabase.from('twob_import_docs')
      .update({ itc_action: bulkValue, updated_by: user?.id, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { toast.error('Bulk update failed: ' + error.message); fetchAll(); return; }
    toast.success(`Set ${ids.length} row(s) to ${TWOB_ACTIONS.find((a) => a.value === bulkValue)?.label}.`);
    setSelected(new Set());
    setBulkValue('');
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
              <th className="border border-border p-2 text-right">Taxable</th>
              <th className="border border-border p-2 text-right">IGST</th>
              <th className="border border-border p-2 text-right">CGST</th>
              <th className="border border-border p-2 text-right">SGST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="border border-border p-2">{r.label}</td>
                <td className="border border-border p-2 text-right">{r.count}</td>
                <td className="border border-border p-2 text-right">{num(r.taxable)}</td>
                <td className="border border-border p-2 text-right">{num(r.igst)}</td>
                <td className="border border-border p-2 text-right">{num(r.cgst)}</td>
                <td className="border border-border p-2 text-right">{num(r.sgst)}</td>
              </tr>
            ))}
            <tr className="font-medium bg-muted/30">
              <td className="border border-border p-2">Total</td>
              <td className="border border-border p-2 text-right">{tot.count}</td>
              <td className="border border-border p-2 text-right">{num(tot.taxable)}</td>
              <td className="border border-border p-2 text-right">{num(tot.igst)}</td>
              <td className="border border-border p-2 text-right">{num(tot.cgst)}</td>
              <td className="border border-border p-2 text-right">{num(tot.sgst)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-heading font-bold text-foreground">Import 2B</h2>
          <p className="text-sm text-muted-foreground">Import GSTR-2B & reconcile with books · B2B only</p>
        </div>
        {isStaff && (
          <div className="flex items-center gap-2">
            <PortalActionButton
              clientId={selectedClient}
              periodMonth={selectedMonth}
              jobType="SYNC_ALL"
              label="Sync from portal"
              icon={<RefreshCw className="h-4 w-4 mr-2" />}
              disabled={!selectedClient || !selectedMonth || isLocked}
              onDone={fetchAll}
            />
            <PortalActionButton
              clientId={selectedClient}
              periodMonth={selectedMonth}
              jobType="PULL_2B"
              label="Pull 2B from portal"
              icon={<Download className="h-4 w-4 mr-2" />}
              disabled={!selectedClient || !selectedMonth || isLocked}
              onDone={fetchAll}
            />
            <Button onClick={handleImportClick} disabled={isImporting || !selectedClient || !selectedMonth || isLocked}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import GSTR-2B
            </Button>
            {twoBDocs.length > 0 && (
              <Button variant="destructive" size="sm" onClick={deleteImported2B} disabled={readOnly}>
                <Trash2 className="h-4 w-4 mr-2" />Delete 2B
              </Button>
            )}
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </div>

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
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !selectedClient || !selectedMonth ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Select a client and month to begin.</CardContent></Card>
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
                      {TWOB_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Button size="sm" className="h-7" onClick={applyBulk} disabled={!bulkValue}>Apply</Button>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              {twoBDocs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No GSTR-2B imported for {selectedClientName} — {selectedMonth}.{isStaff && !isLocked && ' Click "Import GSTR-2B".'}
                </div>
              ) : (
                <ScrollArea className="w-full">
                  <div className="min-w-[1050px]">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#4A90A4] text-white">
                          <th className="border border-[#2E5A6B] p-2 w-9 text-center">
                            <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} disabled={readOnly} aria-label="Select all" />
                          </th>
                          <th className="border border-[#2E5A6B] p-2 text-left">Date</th>
                          <th className="border border-[#2E5A6B] p-2 text-left">Supplier</th>
                          <th className="border border-[#2E5A6B] p-2 text-left">Invoice</th>
                          <th className="border border-[#2E5A6B] p-2 text-left">GSTIN</th>
                          <th className="border border-[#2E5A6B] p-2 text-right">Taxable</th>
                          <th className="border border-[#2E5A6B] p-2 text-right">IGST</th>
                          <th className="border border-[#2E5A6B] p-2 text-right">CGST</th>
                          <th className="border border-[#2E5A6B] p-2 text-right">SGST</th>
                          <th className="border border-[#2E5A6B] p-2 text-left w-40">Action</th>
                        </tr>
                        {/* Heading filter row */}
                        <tr className="bg-[#e8f0f2]">
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
                          <tr><td colSpan={10} className="text-center py-6 text-muted-foreground border border-border">No rows match the filters.</td></tr>
                        ) : filteredDocs.map((d) => (
                          <tr key={d.id} className={selected.has(d.id) ? 'bg-primary/5' : 'hover:bg-muted/40'}>
                            <td className="border border-border p-2 text-center">
                              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleRow(d.id)} disabled={readOnly} aria-label="Select row" />
                            </td>
                            <td className="border border-border p-2 whitespace-nowrap">{isoToDisplay(d.date)}</td>
                            <td className="border border-border p-2">{d.supplier_name}</td>
                            <td className="border border-border p-2">{d.supplier_invoice_number}</td>
                            <td className="border border-border p-2 font-mono">{d.supplier_gstin}</td>
                            <td className="border border-border p-2 text-right">{num(d.taxable_value)}</td>
                            <td className="border border-border p-2 text-right">{num(d.input_igst)}</td>
                            <td className="border border-border p-2 text-right">{num(d.input_cgst)}</td>
                            <td className="border border-border p-2 text-right">{num(d.input_sgst)}</td>
                            <td className="border border-border p-2">
                              <select className={rowSelectCls} value={d.itc_action} disabled={readOnly} onChange={(e) => setDocAction(d.id, e.target.value)}>
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
                      <tr className="bg-[#4A90A4] text-white">
                        <th className="border border-[#2E5A6B] p-2 text-left w-28">Date</th>
                        <th className="border border-[#2E5A6B] p-2 text-left">Supplier</th>
                        <th className="border border-[#2E5A6B] p-2 text-left">Invoice</th>
                        <th className="border border-[#2E5A6B] p-2 text-left">GSTIN</th>
                        <th className="border border-[#2E5A6B] p-2 text-right w-24">Taxable</th>
                        <th className="border border-[#2E5A6B] p-2 text-right w-20">IGST</th>
                        <th className="border border-[#2E5A6B] p-2 text-right w-20">CGST</th>
                        <th className="border border-[#2E5A6B] p-2 text-right w-20">SGST</th>
                        <th className="border border-[#2E5A6B] p-2 text-left w-32">Treatment</th>
                        {!readOnly && <th className="border border-[#2E5A6B] p-2 w-10"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {books.length === 0 ? (
                        <tr><td colSpan={readOnly ? 9 : 10} className="text-center py-8 text-muted-foreground border border-border">
                          No books invoices added.{!readOnly && ' Use "Add row" for invoices missing from 2B.'}
                        </td></tr>
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
                            <input className={`${cellInputCls} text-right`} value={b.taxable_value || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { taxable_value: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, false)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right`} value={b.input_igst || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { input_igst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right`} value={b.input_cgst || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { input_cgst: toNum(e.target.value), input_sgst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <input className={`${cellInputCls} text-right`} value={b.input_sgst || ''} disabled={readOnly}
                              onChange={(e) => updateBookLocal(b.id, { input_sgst: toNum(e.target.value) })} onBlur={() => saveBookRow(b.id, true)} />
                          </td>
                          <td className="border border-border p-1">
                            <select className={rowSelectCls} value={b.book_treatment} disabled={readOnly} onChange={(e) => setBookTreatment(b.id, e.target.value)}>
                              {BOOK_TREATMENTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          {!readOnly && (
                            <td className="border border-border p-1 text-center">
                              <button onClick={() => deleteBookRow(b.id)} className="text-destructive hover:opacity-70" aria-label="Delete row"><Trash2 className="h-4 w-4" /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
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
                Writing these buckets into Bills Not in 2B / Books is the next phase — nothing is committed to your live 2B sheet yet.
              </p>
            </CardContent>
          </Card>

          <PortalJobsPanel clientId={selectedClient} periodMonth={selectedMonth} />
        </>
      )}
    </div>
  );
};

export default Import2BTab;
