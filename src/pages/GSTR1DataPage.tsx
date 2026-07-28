import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileJson, Loader2, Trash2, Send, CheckCircle2, XCircle, FileCheck2, Inbox, BarChart3, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { buildGstr1Summary } from '@/utils/buildGstr1Summary';
import { exportGstr1SummaryToPDF } from '@/utils/gstr1SummaryPdf';
import { Gstr3bPreviewDialog } from '@/components/portal/Gstr3bPreviewDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';

// gstr1_data stores period_month as the short label ("Jun-26"). The rest of
// the app shares a single MonthContext value in "MM/YYYY" form, so convert
// here when reading/writing the table. Keeps existing rows readable.
const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mmYyyyToShort = (mmYyyy: string): string => {
  if (!mmYyyy) return '';
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return '';
  return `${MONTH_SHORT_NAMES[mm - 1]}-${String(yyyy).slice(-2)}`;
};

interface Client {
  id: string;
  name: string;
  gstin: string;
}

interface GSTR1Record {
  id: string;
  client_id: string;
  period_month: string;
  raw_json: any;
  file_name: string | null;
  imported_at: string;
  // Populated by the gst-push edge function after a portal push (nullable:
  // absent until the first push, or until the migration adding these columns
  // is applied).
  last_pushed_at?: string | null;
  last_push_status?: string | null;
  last_push_by?: string | null;
  last_push_message?: string | null;
}

// Shared scroll shell for the eleven tab tables. shadcn's <Table> renders its
// own `overflow-auto` div, so the height cap has to land on that child for the
// sticky header to have a scroll container to stick to.
const TABLE_SHELL = 'rounded-md border border-border [&>div]:max-h-[70vh] [&>div]:overflow-auto';

// GSTR-1 JSON section types
interface B2BInvoice {
  ctin: string;
  inv: Array<{
    inum: string;
    idt: string;
    val: number;
    pos: string;
    rchrg: string;
    inv_typ: string;
    itms: Array<{
      num: number;
      itm_det: {
        rt: number;
        txval: number;
        iamt?: number;
        camt?: number;
        samt?: number;
        csamt?: number;
      };
    }>;
  }>;
}

const GSTR1DataPage: React.FC = () => {
  const { user, isStaffRole, canEditFilingStatus } = useAuth();
  const confirm = useConfirm();
  // Shared selections so opening this page after picking a client/month on
  // another page (e.g. ITC Summary, Suspended Reco) preserves the context.
  const { selectedClientId: selectedClient, setSelectedClientId: setSelectedClient } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [clients, setClients] = useState<Client[]>([]);
  const [gstr1Data, setGstr1Data] = useState<GSTR1Record | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState('b2b');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "Push to GST Portal" (Humonex) flow.
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [gstr3bOpen, setGstr3bOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const isStaff = isStaffRole();

  // Use the same MM/YYYY value format as every other page so the shared
  // MonthContext stays consistent. Labels render as "Mmm YYYY" for clarity.
  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
      const yyyy = currentDate.getFullYear();
      months.push({ value: `${mm}/${yyyy}`, label: `${monthNames[currentDate.getMonth()]} ${yyyy}` });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  // The GST portal / Humonex filing period fields derived from the selected
  // month. The edge function recomputes these authoritatively; this copy is
  // only for showing the operator what will be submitted before they confirm.
  const derivedFiling = useMemo(() => {
    if (!selectedMonth) return null;
    const [mmStr, yyyyStr] = selectedMonth.split('/');
    const mm = Number(mmStr);
    const yyyy = Number(yyyyStr);
    if (!mm || mm < 1 || mm > 12 || !yyyy) return null;
    const fullNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const period = fullNames[mm - 1];
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const financialYear = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
    let quarter: string;
    if (mm >= 4 && mm <= 6) quarter = 'Quarter 1 (Apr - Jun)';
    else if (mm >= 7 && mm <= 9) quarter = 'Quarter 2 (Jul - Sep)';
    else if (mm >= 10 && mm <= 12) quarter = 'Quarter 3 (Oct - Dec)';
    else quarter = 'Quarter 4 (Jan - Mar)';
    return { period, financialYear, quarter };
  }, [selectedMonth]);

  const fetchClients = useCallback(async () => {
    const { data } = await supabase.from('clients').select('id, name, gstin').order('name');
    setClients(data || []);
  }, []);

  const fetchGSTR1Data = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setGstr1Data(null); return; }
    setIsLoading(true);
    try {
      const periodMonthKey = mmYyyyToShort(selectedMonth);
      const { data, error } = await supabase
        .from('gstr1_data')
        .select('*')
        .eq('client_id', selectedClient)
        .eq('period_month', periodMonthKey)
        .maybeSingle();
      if (error) throw error;
      setGstr1Data(data as GSTR1Record | null);
    } catch (err: any) {
      toast.error('Failed to fetch data: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchGSTR1Data(); }, [fetchGSTR1Data]);
  // Clear the transient push banner when the operator switches client/month
  // (but not on a post-push refetch of the same selection).
  useEffect(() => { setPushResult(null); }, [selectedClient, selectedMonth]);

  // Opens the persistent hidden <input type="file"> below. Using a stable ref
  // (instead of a dynamically-created input with an onchange closure) means
  // handleFileChange always reads the LATEST selectedClient / selectedMonth
  // when the user picks a file, even if they tweaked the dropdowns between
  // clicking Import JSON and picking the file in the OS file dialog.
  const handleImportClick = () => {
    if (!selectedClient || !selectedMonth) {
      toast.error('Please select a client and month first');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (!selectedClient || !selectedMonth) {
      toast.error('Please select a client and month first');
      return;
    }

    setIsImporting(true);
    try {
      const text = await file.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Selected file is not valid JSON.');
      }

      const periodMonthKey = mmYyyyToShort(selectedMonth);
      const { data: written, error } = await supabase
        .from('gstr1_data')
        .upsert({
          client_id: selectedClient,
          period_month: periodMonthKey,
          raw_json: json,
          file_name: file.name,
          imported_by: user?.id,
          imported_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,period_month' })
        .select('id');

      if (error) throw error;
      // .select() after .upsert() returns the affected row. If RLS or a
      // constraint silently dropped the write, the array will be empty and
      // we surface that instead of pretending the import succeeded.
      if (!written || written.length === 0) {
        throw new Error('Write was rejected by the database (no row returned). Check that you are signed in.');
      }

      toast.success(`GSTR-1 JSON imported for ${periodMonthKey}.`);
      await fetchGSTR1Data();
    } catch (err: any) {
      toast.error('Failed to import: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!gstr1Data) return;
    if (!(await confirm({ title: 'Delete GSTR-1 data?', description: 'This removes the imported GSTR-1 data for this client and period.', destructive: true, confirmText: 'Delete' }))) return;
    try {
      await supabase.from('gstr1_data').delete().eq('id', gstr1Data.id);
      toast.success('GSTR-1 data deleted');
      setGstr1Data(null);
    } catch (err: any) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  // Sends the stored GSTR-1 JSON to the GST portal through the server-side
  // Humonex proxy (the gst-push edge function). The client's GST-portal login
  // and the secret Humonex token are handled entirely on the server; the app
  // only sends which client + period to push.
  const handlePush = async () => {
    if (!gstr1Data || !selectedClient || !selectedMonth) return;
    setIsPushing(true);
    setPushResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('gst-push', {
        body: {
          clientId: selectedClient,
          periodMonth: selectedMonth,
          actorId: user?.id,
          actorRole: user?.role,
        },
      });

      // supabase-js only populates `data` on a 2xx response; the function
      // returns 200 for every handled outcome, so a non-null `error` means a
      // network failure or an unexpected 500 (which may carry a body message).
      if (error) {
        let message = error.message || 'Request to the push service failed.';
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) message = body.error;
          }
        } catch { /* keep the original message */ }
        throw new Error(message);
      }

      const pushedAt = new Date().toISOString();
      if (data?.ok) {
        const msg = `Pushed to GST portal — ${selectedClientName}, ${data.period} ${data.financialYear}.`;
        toast.success(msg);
        setPushResult({ ok: true, message: msg });
        // Mirror what the edge function persisted so the "last pushed" indicator
        // updates immediately without waiting for a reload.
        setGstr1Data((prev) => prev ? { ...prev, last_pushed_at: pushedAt, last_push_status: 'success', last_push_by: user?.id ?? null, last_push_message: null } : prev);
      } else {
        const remote =
          (data?.response && typeof data.response === 'object' && (data.response.message || data.response.error)) ||
          (typeof data?.response === 'string' ? data.response : '') ||
          data?.error ||
          'The GST portal push was not accepted.';
        toast.error(`Push failed: ${remote}`);
        setPushResult({ ok: false, message: remote });
        setGstr1Data((prev) => prev ? { ...prev, last_pushed_at: pushedAt, last_push_status: 'failed', last_push_by: user?.id ?? null, last_push_message: remote } : prev);
      }
    } catch (err: any) {
      const message = err?.message || 'Unknown error';
      toast.error('Push failed: ' + message);
      setPushResult({ ok: false, message });
    } finally {
      setIsPushing(false);
      setPushDialogOpen(false);
    }
  };

  const json = gstr1Data?.raw_json || {};

  const formatNumber = (num: number | undefined | null) => {
    if (!num && num !== 0) return '';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  // Portal-style rupee amount with fixed 2 decimals (matches the GSTR-1 PDF).
  const fmt2 = (num: number | undefined | null) =>
    (num || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Column total for a detail table (sums a numeric field across its rows).
  const sumBy = (rows: any[], key: string) =>
    rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const footTd = 'border border-border text-right tabular-nums font-semibold';

  // Consolidated summary + section tile counts, derived entirely from the
  // imported JSON (see buildGstr1Summary). Drives both the tile grid and the
  // "Generate Summary" dialog.
  const summary = useMemo(() => buildGstr1Summary(json), [json]);

  // Portal-style document counts keyed by tab id, so the tab badges show the
  // same figure as the tiles and the summary (documents/invoices/notes) instead
  // of the flattened rate-line row count. Keeps every count on the page in sync.
  const docCount = useMemo(() => {
    const m: Record<string, number> = {};
    summary.tiles.forEach((t) => { m[t.key] = t.count; });
    return m;
  }, [summary]);

  // Flatten B2B data
  const b2bRows = useMemo(() => {
    const rows: any[] = [];
    (json.b2b || []).forEach((party: any) => {
      (party.inv || []).forEach((inv: any) => {
        (inv.itms || []).forEach((itm: any) => {
          rows.push({
            ctin: party.ctin,
            inum: inv.inum,
            idt: inv.idt,
            val: inv.val,
            pos: inv.pos,
            rchrg: inv.rchrg,
            inv_typ: inv.inv_typ,
            rt: itm.itm_det?.rt,
            txval: itm.itm_det?.txval,
            iamt: itm.itm_det?.iamt,
            camt: itm.itm_det?.camt,
            samt: itm.itm_det?.samt,
            csamt: itm.itm_det?.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.b2b]);

  // Flatten B2CL data
  const b2clRows = useMemo(() => {
    const rows: any[] = [];
    (json.b2cl || []).forEach((state: any) => {
      (state.inv || []).forEach((inv: any) => {
        (inv.itms || []).forEach((itm: any) => {
          rows.push({
            pos: state.pos,
            inum: inv.inum,
            idt: inv.idt,
            val: inv.val,
            rt: itm.itm_det?.rt,
            txval: itm.itm_det?.txval,
            iamt: itm.itm_det?.iamt,
            csamt: itm.itm_det?.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.b2cl]);

  // B2CS data
  const b2csRows = useMemo(() => {
    return (json.b2cs || []).map((item: any) => ({
      pos: item.pos,
      typ: item.typ,
      rt: item.rt,
      txval: item.txval,
      iamt: item.iamt,
      camt: item.camt,
      samt: item.samt,
      csamt: item.csamt,
    }));
  }, [json.b2cs]);

  // CDNR data
  const cdnrRows = useMemo(() => {
    const rows: any[] = [];
    (json.cdnr || []).forEach((party: any) => {
      (party.nt || []).forEach((nt: any) => {
        (nt.itms || []).forEach((itm: any) => {
          rows.push({
            ctin: party.ctin,
            ntNum: nt.nt_num,
            ntDt: nt.nt_dt,
            ntTyp: nt.typ,
            val: nt.val,
            pos: nt.pos,
            rt: itm.itm_det?.rt,
            txval: itm.itm_det?.txval,
            iamt: itm.itm_det?.iamt,
            camt: itm.itm_det?.camt,
            samt: itm.itm_det?.samt,
            csamt: itm.itm_det?.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.cdnr]);

  // CDNUR data
  const cdnurRows = useMemo(() => {
    const rows: any[] = [];
    (json.cdnur || []).forEach((nt: any) => {
      (nt.itms || []).forEach((itm: any) => {
        rows.push({
          ntNum: nt.nt_num,
          ntDt: nt.nt_dt,
          ntTyp: nt.typ,
          val: nt.val,
          pos: nt.pos,
          rt: itm.itm_det?.rt,
          txval: itm.itm_det?.txval,
          iamt: itm.itm_det?.iamt,
          csamt: itm.itm_det?.csamt,
        });
      });
    });
    return rows;
  }, [json.cdnur]);

  // EXP data
  const expRows = useMemo(() => {
    const rows: any[] = [];
    (json.exp || []).forEach((exp: any) => {
      (exp.inv || []).forEach((inv: any) => {
        (inv.itms || []).forEach((itm: any) => {
          rows.push({
            expTyp: exp.exp_typ,
            inum: inv.inum,
            idt: inv.idt,
            val: inv.val,
            sbpcode: inv.sbpcode,
            sbnum: inv.sbnum,
            sbdt: inv.sbdt,
            rt: itm.rt,
            txval: itm.txval,
            iamt: itm.iamt,
            csamt: itm.csamt,
          });
        });
      });
    });
    return rows;
  }, [json.exp]);

  // HSN data
  const hsnRows = useMemo(() => {
    return (json.hsn?.data || []).map((item: any) => ({
      hsn_sc: item.hsn_sc,
      desc: item.desc,
      uqc: item.uqc,
      qty: item.qty,
      rt: item.rt,
      txval: item.txval,
      iamt: item.iamt,
      camt: item.camt,
      samt: item.samt,
      csamt: item.csamt,
    }));
  }, [json.hsn]);

  // NIL data
  const nilData = useMemo(() => {
    return json.nil || {};
  }, [json.nil]);

  // AT (Advances) data
  const atRows = useMemo(() => {
    return (json.at || []).map((item: any) => ({
      pos: item.pos,
      sply_ty: item.sply_ty,
      rt: item.itms?.[0]?.rt || item.rt,
      ad_amt: item.itms?.[0]?.ad_amt || item.ad_amt,
      iamt: item.itms?.[0]?.iamt || item.iamt,
      camt: item.itms?.[0]?.camt || item.camt,
      samt: item.itms?.[0]?.samt || item.samt,
      csamt: item.itms?.[0]?.csamt || item.csamt,
    }));
  }, [json.at]);

  // TXPD (Advance Adjustments) data
  const txpdRows = useMemo(() => {
    return (json.txpd || []).map((item: any) => ({
      pos: item.pos,
      sply_ty: item.sply_ty,
      rt: item.itms?.[0]?.rt || item.rt,
      ad_amt: item.itms?.[0]?.ad_amt || item.ad_amt,
      iamt: item.itms?.[0]?.iamt || item.iamt,
      camt: item.itms?.[0]?.camt || item.camt,
      samt: item.itms?.[0]?.samt || item.samt,
      csamt: item.itms?.[0]?.csamt || item.csamt,
    }));
  }, [json.txpd]);

  // DOC data
  const docRows = useMemo(() => {
    const rows: any[] = [];
    (json.doc_issue?.doc_det || []).forEach((doc: any) => {
      (doc.docs || []).forEach((d: any) => {
        rows.push({
          doc_num: doc.doc_num,
          doc_typ: doc.doc_typ,
          from: d.from,
          to: d.to,
          totnum: d.totnum,
          cancel: d.cancel,
          net_issue: d.net_issue,
        });
      });
    });
    return rows;
  }, [json.doc_issue]);

  const renderEmptyState = (label: string) => (
    <TableEmptyState
      icon={<Inbox className="h-6 w-6" />}
      title={`No ${label} data`}
      description={`This GSTR-1 file contains no ${label} records for the selected client and period.`}
    />
  );

  const selectedClientName = clients.find(c => c.id === selectedClient)?.name || '';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        title="GSTR-01"
        subtitle="Import and view GSTR-01 JSON data client-wise & month-wise"
        icon={<FileJson className="h-6 w-6" />}
        actions={isStaff ? (
          <>
            <Button onClick={handleImportClick} disabled={isImporting || !selectedClient || !selectedMonth}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import JSON
            </Button>
            {gstr1Data && (
              <Button variant="outline" onClick={() => setSummaryOpen(true)}>
                <BarChart3 className="h-4 w-4 mr-2" /> Generate Summary
              </Button>
            )}
            {gstr1Data && canEditFilingStatus() && (
              <Button
                onClick={() => { setPushResult(null); setPushDialogOpen(true); }}
                disabled={isPushing}
                className="bg-success text-success-foreground hover:bg-success/90"
              >
                {isPushing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Push to GST Portal
              </Button>
            )}
            {selectedClient && canEditFilingStatus() && (
              <Button variant="outline" onClick={() => setGstr3bOpen(true)} disabled={!selectedClient || !selectedMonth}>
                <FileCheck2 className="h-4 w-4 mr-2" /> Prepare GSTR-3B
              </Button>
            )}
            {gstr1Data && (
              <Button variant="destructive" onClick={handleDelete} disabled={isPushing}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            )}
          </>
        ) : undefined}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Client:</span>
              <div className="w-56">
                <SearchableSelect
                  options={clients.map(c => ({ value: c.id, label: c.name }))}
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  placeholder="Select Client"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Month:</span>
              <div className="w-32">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>
            {gstr1Data && (
              <div className="ml-auto flex flex-col items-end gap-0.5">
                <div className="text-xs text-muted-foreground">
                  File: <span className="font-medium">{gstr1Data.file_name}</span> • Imported: {new Date(gstr1Data.imported_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                {gstr1Data.last_pushed_at && (
                  <div className={`text-xs flex items-center gap-1 font-medium ${gstr1Data.last_push_status === 'success' ? 'text-success' : 'text-destructive'}`}>
                    {gstr1Data.last_push_status === 'success'
                      ? <CheckCircle2 className="h-3.5 w-3.5" />
                      : <XCircle className="h-3.5 w-3.5" />}
                    {gstr1Data.last_push_status === 'success' ? 'Pushed to GST portal' : 'Last push failed'}
                    {' · '}
                    {new Date(gstr1Data.last_pushed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Last push result */}
      {pushResult && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            pushResult.ok
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {pushResult.ok ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" />
          ) : (
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span className="break-words">{pushResult.message}</span>
        </div>
      )}

      {/* Data Display */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<FileJson className="h-6 w-6" />}
              title="No client or month selected"
              description="Select a client and a return period above to view GSTR-1 data."
            />
          </CardContent>
        </Card>
      ) : !gstr1Data ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<Upload className="h-6 w-6" />}
              title={`No GSTR-1 data for ${selectedClientName} — ${mmYyyyToShort(selectedMonth)}`}
              description={isStaff ? 'Click "Import JSON" above to upload the GSTR-1 file for this period.' : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            {/* Portal-style section overview — click a tile to jump to its detail tab */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Sections in this return</h3>
                <Button variant="outline" size="sm" onClick={() => setSummaryOpen(true)}>
                  <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Generate Summary
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {summary.tiles.map((t) => {
                  const isActive = activeTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setActiveTab(t.key)}
                      className={`text-left rounded-lg border p-3 transition-colors hover:border-primary/50 hover:bg-primary/5 ${
                        isActive ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <div className="text-xs font-medium text-foreground leading-snug min-h-[32px]">{t.label}</div>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <span className="text-lg font-bold text-primary tabular-nums">{t.count.toLocaleString('en-IN')}</span>
                        {t.value > 0 && (
                          <span className="text-[11px] text-muted-foreground tabular-nums">₹{fmt2(t.value)}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
                <TabsTrigger value="b2b">B2B ({docCount.b2b ?? 0})</TabsTrigger>
                <TabsTrigger value="b2cl">B2CL ({docCount.b2cl ?? 0})</TabsTrigger>
                <TabsTrigger value="b2cs">B2CS ({docCount.b2cs ?? 0})</TabsTrigger>
                <TabsTrigger value="cdnr">CDNR ({docCount.cdnr ?? 0})</TabsTrigger>
                <TabsTrigger value="cdnur">CDNUR ({docCount.cdnur ?? 0})</TabsTrigger>
                <TabsTrigger value="exp">EXP ({docCount.exp ?? 0})</TabsTrigger>
                <TabsTrigger value="hsn">HSN ({docCount.hsn ?? 0})</TabsTrigger>
                <TabsTrigger value="nil">NIL ({docCount.nil ?? 0})</TabsTrigger>
                <TabsTrigger value="at">AT ({docCount.at ?? 0})</TabsTrigger>
                <TabsTrigger value="txpd">TXPD ({docCount.txpd ?? 0})</TabsTrigger>
                <TabsTrigger value="doc">DOC ({docCount.doc ?? 0})</TabsTrigger>
              </TabsList>
              <p className="text-xs text-muted-foreground -mt-2 mb-3">
                Counts show documents (invoices / notes) like the GST portal. The tables below list each
                tax-rate line, so a table can have more rows than its badge when a document spans multiple rates.
              </p>

              {/* B2B Tab */}
              <TabsContent value="b2b">
                {b2bRows.length === 0 ? renderEmptyState('B2B') : (
                  <div className={TABLE_SHELL}>
                    <Table className="min-w-[1200px]">
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">GSTIN</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Invoice No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Date</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">POS</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Rev. Chrg</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">CGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">SGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {b2bRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border font-mono text-xs">{row.ctin}</TableCell>
                            <TableCell className="border border-border">{row.inum}</TableCell>
                            <TableCell className="border border-border">{row.idt}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border">{row.rchrg}</TableCell>
                            <TableCell className="border border-border">{row.inv_typ}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.camt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.samt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({b2bRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2bRows, 'val'))}</TableCell>
                          <TableCell className="border border-border" colSpan={4} />
                          <TableCell className={footTd}>{formatNumber(sumBy(b2bRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2bRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2bRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2bRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2bRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* B2CL Tab */}
              <TabsContent value="b2cl">
                {b2clRows.length === 0 ? renderEmptyState('B2CL') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">POS</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Invoice No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Date</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {b2clRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border">{row.inum}</TableCell>
                            <TableCell className="border border-border">{row.idt}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({b2clRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2clRows, 'val'))}</TableCell>
                          <TableCell className="border border-border" />
                          <TableCell className={footTd}>{formatNumber(sumBy(b2clRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2clRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2clRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* B2CS Tab */}
              <TabsContent value="b2cs">
                {b2csRows.length === 0 ? renderEmptyState('B2CS') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">POS</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">CGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">SGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {b2csRows.map((row: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border">{row.typ}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.camt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.samt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({b2csRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* CDNR Tab */}
              <TabsContent value="cdnr">
                {cdnrRows.length === 0 ? renderEmptyState('CDNR') : (
                  <div className={TABLE_SHELL}>
                    <Table className="min-w-[1200px]">
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">GSTIN</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Note No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Date</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">CGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">SGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cdnrRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border font-mono text-xs">{row.ctin}</TableCell>
                            <TableCell className="border border-border">{row.ntNum}</TableCell>
                            <TableCell className="border border-border">{row.ntDt}</TableCell>
                            <TableCell className="border border-border">{row.ntTyp}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.camt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.samt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={5}>Total ({cdnrRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnrRows, 'val'))}</TableCell>
                          <TableCell className="border border-border" />
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnrRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnrRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnrRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnrRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnrRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* CDNUR Tab */}
              <TabsContent value="cdnur">
                {cdnurRows.length === 0 ? renderEmptyState('CDNUR') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Note No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Date</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">POS</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cdnurRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.ntNum}</TableCell>
                            <TableCell className="border border-border">{row.ntDt}</TableCell>
                            <TableCell className="border border-border">{row.ntTyp}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({cdnurRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnurRows, 'val'))}</TableCell>
                          <TableCell className="border border-border" colSpan={2} />
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnurRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnurRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(cdnurRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* EXP Tab */}
              <TabsContent value="exp">
                {expRows.length === 0 ? renderEmptyState('Export') : (
                  <div className={TABLE_SHELL}>
                    <Table className="min-w-[1100px]">
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Export Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Invoice No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Date</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Port Code</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">SB No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">SB Date</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {expRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.expTyp}</TableCell>
                            <TableCell className="border border-border">{row.inum}</TableCell>
                            <TableCell className="border border-border">{row.idt}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.val)}</TableCell>
                            <TableCell className="border border-border">{row.sbpcode}</TableCell>
                            <TableCell className="border border-border">{row.sbnum}</TableCell>
                            <TableCell className="border border-border">{row.sbdt}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({expRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(expRows, 'val'))}</TableCell>
                          <TableCell className="border border-border" colSpan={4} />
                          <TableCell className={footTd}>{formatNumber(sumBy(expRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(expRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(expRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* HSN Tab */}
              <TabsContent value="hsn">
                {hsnRows.length === 0 ? renderEmptyState('HSN') : (
                  <div className={TABLE_SHELL}>
                    <Table className="min-w-[1000px]">
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">HSN Code</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Description</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">UQC</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Qty</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Taxable Value</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">CGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">SGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hsnRows.map((row: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border font-mono">{row.hsn_sc}</TableCell>
                            <TableCell className="border border-border">{row.desc}</TableCell>
                            <TableCell className="border border-border">{row.uqc}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.qty)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.txval)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.camt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.samt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({hsnRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'qty'))}</TableCell>
                          <TableCell className="border border-border" />
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* NIL Tab */}
              <TabsContent value="nil">
                {!nilData.inv ? renderEmptyState('Nil Rated') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Description</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Nil Rated</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Exempted</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Non-GST</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(nilData.inv || []).map((item: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border">{item.sply_ty === 'INTRB2B' ? 'Inter-State B2B' : item.sply_ty === 'INTRAB2B' ? 'Intra-State B2B' : item.sply_ty === 'INTRB2C' ? 'Inter-State B2C' : item.sply_ty === 'INTRAB2C' ? 'Intra-State B2C' : item.sply_ty}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(item.nil_amt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(item.expt_amt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(item.ngsup_amt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold">Total</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(nilData.inv || [], 'nil_amt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(nilData.inv || [], 'expt_amt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(nilData.inv || [], 'ngsup_amt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* AT Tab */}
              <TabsContent value="at">
                {atRows.length === 0 ? renderEmptyState('Advance Tax') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">POS</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Supply Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Advance Amount</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">CGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">SGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {atRows.map((row: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border">{row.sply_ty}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.ad_amt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.camt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.samt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({atRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(atRows, 'ad_amt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(atRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(atRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(atRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(atRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* TXPD Tab */}
              <TabsContent value="txpd">
                {txpdRows.length === 0 ? renderEmptyState('Advance Adjustment') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">POS</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Supply Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Rate</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Advance Amount</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">IGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">CGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">SGST</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {txpdRows.map((row: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.pos}</TableCell>
                            <TableCell className="border border-border">{row.sply_ty}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.rt}%</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.ad_amt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.iamt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.camt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.samt)}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={4}>Total ({txpdRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdRows, 'ad_amt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* DOC Tab */}
              <TabsContent value="doc">
                {docRows.length === 0 ? renderEmptyState('Document Issued') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Doc Type</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Sr. No.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">From</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">To</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Total</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Cancelled</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 text-right">Net Issued</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {docRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.doc_typ}</TableCell>
                            <TableCell className="border border-border">{row.doc_num}</TableCell>
                            <TableCell className="border border-border">{row.from}</TableCell>
                            <TableCell className="border border-border">{row.to}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.totnum}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.cancel}</TableCell>
                            <TableCell className="border border-border text-right tabular-nums">{row.net_issue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableCell className="border border-border font-semibold" colSpan={5}>Total ({docRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(docRows, 'totnum'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(docRows, 'cancel'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(docRows, 'net_issue'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <Gstr3bPreviewDialog
        open={gstr3bOpen}
        onOpenChange={setGstr3bOpen}
        clientId={selectedClient}
        gstin={clients.find((c) => c.id === selectedClient)?.gstin || ''}
        periodMonth={selectedMonth}
      />

      {/* Consolidated, portal-style GSTR-1 summary (like the system-generated PDF). */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle>
                  GSTR-1 Summary — {selectedClientName || '—'}
                  {selectedMonth ? ` · ${mmYyyyToShort(selectedMonth)}` : ''}
                </DialogTitle>
                <DialogDescription>
                  Consolidated summary generated from the imported GSTR-1 data, laid out like the GST portal.
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  exportGstr1SummaryToPDF({
                    summary,
                    clientName: selectedClientName || 'Client',
                    gstin: clients.find((c) => c.id === selectedClient)?.gstin || '',
                    monthLabel: mmYyyyToShort(selectedMonth),
                    fileName: gstr1Data?.file_name,
                  })
                }
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
              </Button>
            </div>
          </DialogHeader>
          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full text-sm border-collapse min-w-[900px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-primary-foreground">
                  <th className="border border-primary-foreground/20 p-2 text-left font-bold">Description</th>
                  <th className="border border-primary-foreground/20 p-2 text-center font-bold whitespace-nowrap">No. of records</th>
                  <th className="border border-primary-foreground/20 p-2 text-center font-bold whitespace-nowrap">Document Type</th>
                  <th className="border border-primary-foreground/20 p-2 text-right font-bold whitespace-nowrap">Value (₹)</th>
                  <th className="border border-primary-foreground/20 p-2 text-right font-bold whitespace-nowrap">Integrated Tax (₹)</th>
                  <th className="border border-primary-foreground/20 p-2 text-right font-bold whitespace-nowrap">Central Tax (₹)</th>
                  <th className="border border-primary-foreground/20 p-2 text-right font-bold whitespace-nowrap">State/UT Tax (₹)</th>
                  <th className="border border-primary-foreground/20 p-2 text-right font-bold whitespace-nowrap">Cess (₹)</th>
                </tr>
              </thead>
              <tbody>
                {summary.sections.map((s, i) => (
                  <tr key={`${s.code}-${i}`} className="odd:bg-muted/30">
                    <td className="border border-border p-2">
                      <span className="font-semibold text-foreground">{s.code}</span>
                      <span className="text-muted-foreground"> — {s.title}</span>
                    </td>
                    <td className="border border-border p-2 text-center tabular-nums">{s.count.toLocaleString('en-IN')}</td>
                    <td className="border border-border p-2 text-center text-muted-foreground">{s.docType}</td>
                    <td className="border border-border p-2 text-right tabular-nums">{fmt2(s.value)}</td>
                    <td className="border border-border p-2 text-right tabular-nums">{fmt2(s.igst)}</td>
                    <td className="border border-border p-2 text-right tabular-nums">{fmt2(s.cgst)}</td>
                    <td className="border border-border p-2 text-right tabular-nums">{fmt2(s.sgst)}</td>
                    <td className="border border-border p-2 text-right tabular-nums">{fmt2(s.cess)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted font-semibold">
                  <td className="border border-border p-2 text-right" colSpan={3}>Total liability (excl. HSN &amp; Docs)</td>
                  <td className="border border-border p-2 text-right tabular-nums">{fmt2(summary.totals.value)}</td>
                  <td className="border border-border p-2 text-right tabular-nums">{fmt2(summary.totals.igst)}</td>
                  <td className="border border-border p-2 text-right tabular-nums">{fmt2(summary.totals.cgst)}</td>
                  <td className="border border-border p-2 text-right tabular-nums">{fmt2(summary.totals.sgst)}</td>
                  <td className="border border-border p-2 text-right tabular-nums">{fmt2(summary.totals.cess)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            "No. of records" counts documents (invoices / notes) like the GST portal, so it can be lower
            than a detail tab's row count when one document has multiple tax rates. 9B notes are shown net
            (Debit − Credit), so credit notes reduce the value.
          </p>
        </DialogContent>
      </Dialog>

      {/* Push confirmation — submitting to the live GST portal is outward and
          hard to reverse, so require an explicit confirm showing exactly what
          period is being filed. */}
      <AlertDialog open={pushDialogOpen} onOpenChange={(o) => { if (!isPushing) setPushDialogOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push GSTR-1 to the GST portal?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This submits the imported GSTR-1 data to the live GST portal via Humonex.
                  Review the details before continuing:
                </p>
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-foreground space-y-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Client</span>
                    <span className="font-medium text-right">{selectedClientName || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Period</span>
                    <span className="font-medium text-right">{derivedFiling?.period} {selectedMonth?.split('/')[1]}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Quarter</span>
                    <span className="font-medium text-right">{derivedFiling?.quarter}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Financial year</span>
                    <span className="font-medium text-right">{derivedFiling?.financialYear}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  The client's stored GST portal login is used to file. Make sure the data on this page
                  is final — this action cannot be undone from here.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setPushDialogOpen(false)} disabled={isPushing}>
              Cancel
            </Button>
            <Button
              onClick={handlePush}
              disabled={isPushing}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {isPushing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {isPushing ? 'Pushing…' : 'Confirm & Push'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GSTR1DataPage;
