import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Upload, FileJson, Loader2, Trash2, Send, CheckCircle2, XCircle, Inbox, BarChart3, Download, ChevronsDownUp, ChevronsUpDown, FileSpreadsheet, History, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { buildGstr1Summary } from '@/utils/buildGstr1Summary';
import { exportGstr1SummaryToPDF } from '@/utils/gstr1SummaryPdf';
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
import { useNavigate } from 'react-router-dom';
import { isBuilderGenerated as isBuilderSourced } from '@/utils/builderGstr1';
import Gstr1ManualEntryPanel from '@/components/gstr1/Gstr1ManualEntryPanel';

// gstr1_data stores period_month as the short label ("Jun-26"). The rest of
// the app shares a single MonthContext value in "MM/YYYY" form, so convert
// here when reading/writing the table. Keeps existing rows readable.
const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Descriptive header shown above the active section's table (the tiles are the
// navigation, so the table needs its own label of what's being viewed).
const SECTION_LABELS: Record<string, string> = {
  b2b: 'B2B — 4A, 4B, 6B, 6C',
  b2cl: 'B2CL — 5 (B2C Large)',
  b2cs: 'B2CS — 7 (B2C Others)',
  b2csa: 'B2CSA — 10 (Amended B2C Others)',
  cdnr: 'CDNR — 9B (Registered)',
  cdnur: 'CDNUR — 9B (Unregistered)',
  exp: 'EXP — 6A (Exports)',
  hsn: 'HSN — 12',
  nil: 'NIL — 8',
  at: 'AT — 11A (Advances)',
  txpd: 'TXPD — 11B (Adjustment)',
  doc: 'DOC — 13 (Documents)',
};
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
  // Promoters file from the builder module: their outward side is computed from
  // bookings, receipts and BU events, so there is no JSON to upload.
  regular_sub_type?: string | null;
  // 'manual' clients only send bills — their GSTR-1 is prepared entirely
  // outside this app, so the Import/Upload actions don't apply to them.
  gstr1_import_mode?: 'json' | 'manual' | null;
}

interface UploadErrorRow {
  invoiceNo?: string;
  gstin?: string;
  reason: string;
}

interface UploadVersion {
  id: string;
  version_number: number;
  action_type: 'IMPORT' | 'UPLOAD' | 'REFRESH_ERRORS';
  actor_id: string | null;
  actor_name?: string;
  action_at: string;
  file_name: string | null;
  status: string | null;
  summary: string | null;
  errors: UploadErrorRow[] | null;
}

interface GSTR1Record {
  id: string;
  client_id: string;
  period_month: string;
  raw_json: any;
  file_name: string | null;
  imported_at: string;
  // Legacy Humonex "push" columns — kept readable for historical rows, no
  // longer written to. The extension writes the new last_upload_* set below.
  last_pushed_at?: string | null;
  last_push_status?: string | null;
  last_push_by?: string | null;
  last_push_message?: string | null;
  // Portal upload result (extension writes these after the portal processes
  // the JSON). status: 'accepted' | 'partial' | 'failed'.
  last_uploaded_at?: string | null;
  last_uploaded_by?: string | null;
  last_upload_status?: 'accepted' | 'partial' | 'failed' | null;
  last_upload_summary?: string | null;
  last_upload_errors?: UploadErrorRow[] | null;
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
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [gstr1Data, setGstr1Data] = useState<GSTR1Record | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState('b2b');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "Upload to GST Portal" flow — extension-driven.
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    ok: boolean;
    message: string;
    errors?: UploadErrorRow[];
  } | null>(null);
  const [errorsDialogOpen, setErrorsDialogOpen] = useState(false);
  const [extReady, setExtReady] = useState(false);

  // Upload history (versions) + per-version error dialog.
  const [versions, setVersions] = useState<UploadVersion[]>([]);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  // Filing status for this (client, period, GSTR-1). Once 'Filed', all edits
  // and portal actions are blocked so the record we hold matches what was
  // actually filed with GSTN.
  const [filingStatus, setFilingStatus] = useState<string | null>(null);
  const isFiled = filingStatus === 'Filed';
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Per-tab collapse: when a section id is in the set, its table shows only the
  // header + totals row (data rows hidden). Every section starts collapsed so
  // the page opens on a totals-first view.
  const ALL_TAB_IDS = ['b2b', 'b2cl', 'b2cs', 'b2csa', 'cdnr', 'cdnur', 'exp', 'hsn', 'nil', 'at', 'txpd', 'doc'];
  const [collapsedTabs, setCollapsedTabs] = useState<Set<string>>(() => new Set(ALL_TAB_IDS));
  const isCollapsed = (key: string) => collapsedTabs.has(key);
  const toggleCollapse = (key: string) =>
    setCollapsedTabs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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
    const { data } = await supabase
      .from('clients').select('id, name, gstin, regular_sub_type, gstr1_import_mode').order('name');
    setClients((data || []) as Client[]);
  }, []);

  /**
   * Promoters do not upload a GSTR-1. Their outward side is computed in the
   * builder module from bookings, receipts, BU events and adjustments, and
   * written here by "Generate" on Builder Returns — so for these clients the
   * import path is closed rather than merely discouraged. Uploading a file
   * alongside the computed return is how the two quietly diverge.
   */
  const isBuilderClient = useMemo(
    () => clients.find((c) => c.id === selectedClient)?.regular_sub_type === 'Builder',
    [clients, selectedClient],
  );

  /**
   * 'Manual' clients only send bills — their GSTR-1 is prepared entirely
   * outside this app (Excel / portal online entry), so Import JSON and Upload
   * to GST Portal don't apply. Set per-client on the client form.
   */
  const isManualClient = useMemo(
    () => clients.find((c) => c.id === selectedClient)?.gstr1_import_mode === 'manual',
    [clients, selectedClient],
  );

  /** Was the stored return produced by Builder Returns rather than uploaded? */
  const isBuilderGenerated = useMemo(
    () => isBuilderSourced(gstr1Data?.raw_json),
    [gstr1Data],
  );

  /**
   * True when the currently loaded GSTR-1 JSON was originally generated for a
   * different taxpayer than the client selected here. Common cause: an older
   * import that predates the import-time GSTIN check. The Upload button will
   * refuse in this state; the banner tells the operator why up front so they
   * can delete and re-import the correct file.
   */
  const gstinMismatch = useMemo(() => {
    const clientGstin = (clients.find((c) => c.id === selectedClient)?.gstin || '').toUpperCase().trim();
    const jsonGstin = String(gstr1Data?.raw_json?.gstin || '').toUpperCase().trim();
    if (!clientGstin || !jsonGstin) return null;
    if (clientGstin === jsonGstin) return null;
    return { clientGstin, jsonGstin };
  }, [clients, selectedClient, gstr1Data]);

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

  // Upload history — all IMPORT / UPLOAD / REFRESH_ERRORS actions for this
  // (client, period), with the actor's name resolved from profiles. If the
  // versions table is empty but the underlying gstr1_data row already has
  // import / upload timestamps (i.e., it predates this feature), backfill a
  // synthetic history from those columns so the audit trail isn't blank for
  // returns imported before the migration.
  const fetchVersions = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setVersions([]); return; }
    const periodMonthKey = mmYyyyToShort(selectedMonth);

    const load = async () => {
      const { data } = await supabase
        .from('gstr1_upload_versions')
        .select('*')
        .eq('client_id', selectedClient)
        .eq('period_month', periodMonthKey)
        .order('version_number', { ascending: false });
      return (data as UploadVersion[] | null) || [];
    };

    let rows = await load();

    if (rows.length === 0 && gstr1Data) {
      const backfill: any[] = [];
      if (gstr1Data.imported_at) {
        backfill.push({
          client_id: selectedClient,
          period_month: periodMonthKey,
          action_type: 'IMPORT',
          actor_id: null, // pre-migration — we didn't record who
          action_at: gstr1Data.imported_at,
          file_name: gstr1Data.file_name,
          status: 'imported',
          summary: `Imported ${gstr1Data.file_name || '(no filename)'} · backfilled from existing record`,
        });
      }
      if (gstr1Data.last_uploaded_at) {
        backfill.push({
          client_id: selectedClient,
          period_month: periodMonthKey,
          action_type: 'UPLOAD',
          actor_id: gstr1Data.last_uploaded_by || null,
          action_at: gstr1Data.last_uploaded_at,
          file_name: null,
          status: gstr1Data.last_upload_status || null,
          summary: gstr1Data.last_upload_summary
            ? `${gstr1Data.last_upload_summary} · backfilled from existing record`
            : 'Uploaded to portal · backfilled from existing record',
          errors: gstr1Data.last_upload_errors || null,
        });
      }
      if (backfill.length > 0) {
        await supabase.from('gstr1_upload_versions').insert(backfill);
        rows = await load();
      }
    }

    const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
    let nameMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles').select('user_id, first_name').in('user_id', actorIds);
      nameMap = new Map((profiles || []).map((p) => [p.user_id, p.first_name || 'Unknown']));
    }
    setVersions(rows.map((r) => ({ ...r, actor_name: r.actor_id ? (nameMap.get(r.actor_id) || 'Unknown') : 'System' })));
  }, [selectedClient, selectedMonth, gstr1Data]);

  // Filing status for the (client, GSTR-1, period). 'Filed' → block edits.
  const fetchFilingStatus = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setFilingStatus(null); return; }
    // filing_status.period_month uses MM/YYYY format across the app.
    const { data } = await supabase
      .from('filing_status')
      .select('status')
      .eq('client_id', selectedClient)
      .eq('return_type', 'GSTR-1')
      .eq('period_month', selectedMonth)
      .maybeSingle();
    setFilingStatus(((data as any)?.status || null) as string | null);
  }, [selectedClient, selectedMonth]);

  // One-liner used by every mutation path (import, upload result received,
  // manual error-report import) to record what happened, by whom, when.
  const recordVersion = useCallback(async (v: {
    action_type: 'IMPORT' | 'UPLOAD' | 'REFRESH_ERRORS';
    file_name?: string | null;
    status?: string | null;
    summary?: string | null;
    errors?: UploadErrorRow[] | null;
  }) => {
    if (!selectedClient || !selectedMonth) return;
    const periodMonthKey = mmYyyyToShort(selectedMonth);
    await supabase.from('gstr1_upload_versions').insert({
      client_id: selectedClient,
      period_month: periodMonthKey,
      action_type: v.action_type,
      actor_id: user?.id ?? null,
      file_name: v.file_name ?? null,
      status: v.status ?? null,
      summary: v.summary ?? null,
      errors: (v.errors as any) ?? null,
    });
    fetchVersions();
  }, [selectedClient, selectedMonth, user?.id, fetchVersions]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchGSTR1Data(); }, [fetchGSTR1Data]);
  useEffect(() => { fetchVersions(); }, [fetchVersions]);
  useEffect(() => { fetchFilingStatus(); }, [fetchFilingStatus]);
  // Clear the transient upload banner when the operator switches client/month.
  useEffect(() => { setUploadResult(null); }, [selectedClient, selectedMonth]);

  // Extension bridge: detect the GST Keeper browser extension and receive the
  // upload result it posts back after driving the portal. Mirrors the pattern
  // used on the reco pages for the "Pull" button.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkUploadGstr1Result) {
        const r = d.__gstkUploadGstr1Result as {
          ok: boolean;
          status?: 'accepted' | 'partial' | 'failed';
          summary?: string;
          errors?: UploadErrorRow[];
          error?: string;
        };
        setIsUploading(false);
        if (r.ok) {
          const summary = r.summary || 'Uploaded to portal.';
          const isPartial = r.status === 'partial' || (r.errors && r.errors.length > 0);
          if (isPartial) {
            toast.error(summary + ' Click "View errors" for details.');
          } else {
            toast.success(summary);
          }
          setUploadResult({ ok: !isPartial, message: summary, errors: r.errors });
        } else {
          const msg = r.error || 'Portal upload failed.';
          toast.error('Upload failed: ' + msg);
          setUploadResult({ ok: false, message: msg, errors: r.errors });
        }
        fetchGSTR1Data();
        fetchVersions();
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fetchGSTR1Data, fetchVersions]);

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
    // Belt as well as braces: the button is already swapped out for builder
    // clients, but the handler refuses too so no future caller can slip past it.
    if (isBuilderClient) {
      toast.error('This is a builder client — generate the return from Builder Returns instead.');
      return;
    }
    if (isManualClient) {
      toast.error('This client is set to Manual GSTR-1 mode — JSON import is not applicable. Change it in Edit Client if this is wrong.');
      return;
    }
    if (isFiled) {
      toast.error('GSTR-1 for this period is already Filed — imports are locked to preserve the record of what was actually filed.');
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

      // Refuse an import whose GSTIN doesn't match the selected client. Loading
      // client A's file into client B's slot is almost always an operator slip
      // — and once it's saved, later actions (portal upload, summary review)
      // silently reference the wrong taxpayer.
      const clientGstin = (clients.find((c) => c.id === selectedClient)?.gstin || '').toUpperCase().trim();
      const jsonGstin = String(json?.gstin || '').toUpperCase().trim();
      if (clientGstin && jsonGstin && clientGstin !== jsonGstin) {
        throw new Error(
          `GSTIN mismatch — the file is for ${jsonGstin} but this client is ${clientGstin}. Pick the right client and try again.`
        );
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
      await recordVersion({
        action_type: 'IMPORT',
        file_name: file.name,
        status: 'imported',
        summary: `Imported ${file.name}`,
      });
    } catch (err: any) {
      toast.error('Failed to import: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!gstr1Data) return;
    if (isFiled) {
      toast.error('GSTR-1 for this period is already Filed — the imported JSON is locked and cannot be deleted.');
      return;
    }
    if (!(await confirm({ title: 'Delete GSTR-1 data?', description: 'This removes the imported GSTR-1 data for this client and period.', destructive: true, confirmText: 'Delete' }))) return;
    try {
      await supabase.from('gstr1_data').delete().eq('id', gstr1Data.id);
      toast.success('GSTR-1 data deleted');
      setGstr1Data(null);
    } catch (err: any) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  // Sends the stored GSTR-1 JSON to the GST portal by asking the browser
  // extension to drive the portal from the user's own machine. The extension
  // logs in (human clears CAPTCHA), navigates to the return, uploads the JSON,
  // waits for the portal to finish processing, and posts back either success
  // or a structured error list. Filing / signing stays manual by design.
  const handleUpload = async () => {
    if (!gstr1Data || !selectedClient || !selectedMonth) return;
    if (isFiled) {
      toast.error('GSTR-1 for this period is already Filed — portal upload is locked.');
      return;
    }
    if (!extReady) {
      toast.error('Install / enable the GST Keeper browser extension to upload from this page.');
      return;
    }
    // Pre-flight: the portal only accepts a JSON whose GSTIN matches the
    // logged-in taxpayer. If the imported JSON's GSTIN doesn't match this
    // client's GSTIN, the upload will be rejected with a misleading portal
    // error ("Download the latest offline tool…"). Refuse here so the operator
    // sees the real reason instead of debugging blind on the portal tab.
    const clientGstin = (clients.find((c) => c.id === selectedClient)?.gstin || '').toUpperCase().trim();
    const jsonGstin = String(gstr1Data.raw_json?.gstin || '').toUpperCase().trim();
    if (clientGstin && jsonGstin && clientGstin !== jsonGstin) {
      toast.error(
        `GSTIN mismatch — the imported JSON is for ${jsonGstin} but this client is ${clientGstin}. Import the correct client's JSON before uploading.`
      );
      setUploadDialogOpen(false);
      return;
    }
    // Similar for period — portal binds the upload to whichever return period
    // is open on the offline page, but if the JSON's fp doesn't match the
    // period we selected here, our tracking (last_uploaded_at, etc.) would
    // record it against the wrong month. Warn but don't block.
    const jsonFp = String(gstr1Data.raw_json?.fp || '');
    const expectedFp = (() => {
      const [mm, yyyy] = selectedMonth.split('/');
      return `${(mm || '').padStart(2, '0')}${yyyy || ''}`;
    })();
    if (jsonFp && expectedFp && jsonFp !== expectedFp) {
      toast.warning(
        `Period note: the JSON's fp is ${jsonFp} but this page is filing ${expectedFp}. Uploading anyway.`
      );
    }

    setIsUploading(true);
    setUploadResult(null);
    setUploadDialogOpen(false);
    window.postMessage(
      {
        __gstkUploadGstr1: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
        },
      },
      '*'
    );
    toast.info('Opening the GST portal in a new tab — clear the CAPTCHA and let the upload run. Progress will appear here.');
  };

  // Manual fallback for when the extension can't auto-fetch the Error Report
  // (or the operator would rather just download it themselves): paste-in via
  // a file picker. Uses the SAME parser the extension uses, so the resulting
  // per-invoice list is identical to the auto path.
  const errorReportInputRef = useRef<HTMLInputElement>(null);
  const parseGstnErrorReport = (obj: any): UploadErrorRow[] => {
    const rows: UploadErrorRow[] = [];
    const root = obj?.error_report || obj || {};
    if (typeof root !== 'object') return rows;
    for (const sectionKey of Object.keys(root)) {
      const section = (root as any)[sectionKey];
      if (!Array.isArray(section)) continue;
      for (const party of section) {
        const partyGstin: string = party?.ctin || party?.gstin || '';
        const errMsgRaw = party?.error_msg || party?.err_msg || party?.error || party?.errors;
        const errCd = party?.error_cd ? ` [${party.error_cd}]` : '';
        const partyReason = errMsgRaw
          ? (Array.isArray(errMsgRaw) ? errMsgRaw.join('; ') : String(errMsgRaw)) + errCd
          : '';
        const list: any[] = Array.isArray(party?.inv) ? party.inv
                          : Array.isArray(party?.nt) ? party.nt
                          : [];
        if (list.length && partyReason) {
          for (const inv of list) {
            const invoiceNo = String(inv?.inum || inv?.nt_num || inv?.doc_num || '');
            if (!invoiceNo) continue;
            rows.push({ invoiceNo, gstin: partyGstin, reason: partyReason });
          }
          continue;
        }
        if (partyReason) {
          rows.push({
            invoiceNo: `[${sectionKey}] ${party?.pos ? 'POS ' + party.pos : ''}`.trim(),
            gstin: partyGstin,
            reason: partyReason,
          });
        }
      }
    }
    return rows;
  };

  const handleImportErrorReport = () => errorReportInputRef.current?.click();
  const handleErrorReportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (errorReportInputRef.current) errorReportInputRef.current.value = '';
    if (!file || !gstr1Data) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const rows = parseGstnErrorReport(obj);
      // Sanity check: warn if the report's GSTIN + fp don't match this row.
      const reportGstin = String(obj?.gstin || '').toUpperCase();
      const reportFp = String(obj?.fp || '');
      const clientGstin = (clients.find((c) => c.id === selectedClient)?.gstin || '').toUpperCase();
      const [mm, yyyy] = (selectedMonth || '').split('/');
      const expectedFp = `${(mm || '').padStart(2, '0')}${yyyy || ''}`;
      if (reportGstin && clientGstin && reportGstin !== clientGstin) {
        toast.error(`This error report is for ${reportGstin} but this client is ${clientGstin}.`);
        return;
      }
      if (reportFp && expectedFp && reportFp !== expectedFp) {
        toast.warning(`Note: this error report is for period ${reportFp} but this page is ${expectedFp}. Loading anyway.`);
      }
      const summary = rows.length
        ? `Parsed ${rows.length} per-invoice validation error(s) from imported Error Report.`
        : 'No per-invoice errors found in the imported Error Report file (structure may differ from expected).';
      // Persist so the "View errors" button + the sidebar indicator survive a refresh.
      const { error } = await supabase
        .from('gstr1_data')
        .update({
          last_upload_status: 'partial',
          last_upload_summary: summary,
          last_upload_errors: rows as any,
          last_uploaded_at: gstr1Data.last_uploaded_at || new Date().toISOString(),
        })
        .eq('id', gstr1Data.id);
      if (error) throw error;
      setUploadResult({ ok: false, message: summary, errors: rows });
      setErrorsDialogOpen(true);
      await fetchGSTR1Data();
      await recordVersion({
        action_type: 'REFRESH_ERRORS',
        file_name: file.name,
        status: 'partial',
        summary,
        errors: rows,
      });
      toast.success(summary);
    } catch (err: any) {
      toast.error('Could not parse Error Report: ' + (err?.message || 'Unknown error'));
    }
  };

  // "Refresh errors" — after a "Processed with Error" upload, GSTN generates
  // the per-invoice Error Report asynchronously (up to 20 min). Ask the
  // extension to re-open the portal and fetch the now-available report so we
  // can populate the errors dialog and DB without re-uploading the JSON.
  const handleRefreshErrors = () => {
    if (!gstr1Data || !selectedClient || !selectedMonth) return;
    if (!extReady) {
      toast.error('Install / enable the GST Keeper browser extension to refresh errors.');
      return;
    }
    setIsUploading(true);
    setUploadResult(null);
    window.postMessage(
      {
        __gstkRefreshGstr1Errors: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
        },
      },
      '*'
    );
    toast.info('Opening the GST portal to fetch the latest error report — clear the CAPTCHA in the new tab.');
  };

  // Re-download the stored GSTR-1 JSON exactly as imported — this is the same
  // file format the GST portal accepts for upload.
  const handleDownloadJson = () => {
    if (!gstr1Data?.raw_json) {
      toast.error('No GSTR-1 JSON to download.');
      return;
    }
    const blob = new Blob([JSON.stringify(gstr1Data.raw_json)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = gstr1Data.file_name?.replace(/\.json$/i, '')
      || `GSTR1_${(selectedClientName || 'client').replace(/\s+/g, '_')}_${mmYyyyToShort(selectedMonth)}`;
    a.download = `${base}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('GSTR-1 JSON downloaded.');
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

  // B2CSA — Table 10 amendments. Same shape as B2CS plus `omon`, the original
  // month being amended, which is the whole point of the table.
  const b2csaRows = useMemo(() => {
    return (json.b2csa || []).map((item: any) => ({
      pos: item.pos, typ: item.typ, omon: item.omon, rt: item.rt,
      txval: item.txval, iamt: item.iamt, camt: item.camt, samt: item.samt, csamt: item.csamt,
    }));
  }, [json.b2csa]);

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

  // HSN data. The portal JSON has used two shapes:
  //  - older: hsn.data (single flat list)
  //  - newer: hsn.hsn_b2b + hsn.hsn_b2c (split by supply type)
  // Accept both so files pulled from either era populate the HSN tab.
  const hsnRows = useMemo(() => {
    const raw: any[] = json.hsn?.data
      ? json.hsn.data
      : [...(json.hsn?.hsn_b2b || []), ...(json.hsn?.hsn_b2c || [])];
    return raw.map((item: any) => ({
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
        title="GSTR-1"
        subtitle="Import and view GSTR-1 JSON data client-wise & month-wise"
        icon={<FileJson className="h-6 w-6" />}
        actions={isStaff ? (
          <>
            {isBuilderClient ? (
              <Button variant="outline" onClick={() => navigate('/builder-returns')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Prepare in Builder Returns
              </Button>
            ) : isManualClient ? null : (
              <Button
                onClick={handleImportClick}
                disabled={isImporting || !selectedClient || !selectedMonth || isFiled}
                title={isFiled ? 'GSTR-1 already Filed — import locked to preserve the filed record' : undefined}
              >
                {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Import JSON
              </Button>
            )}
            {/* Version History — every Import / Upload / Refresh_Errors action
                is recorded, so operators can audit who touched what and see
                per-attempt error reports. Always visible when a client + month
                are selected so the audit trail is discoverable even before
                any post-migration actions have been recorded. */}
            {selectedClient && selectedMonth && (
              <Button
                variant="outline"
                onClick={() => setVersionHistoryOpen(true)}
                title={versions.length === 0
                  ? 'No upload history yet for this return — imports and uploads from now on are tracked here'
                  : `${versions.length} recorded action(s) for this return`}
              >
                <History className="h-4 w-4 mr-2" />
                Version History{versions.length > 0 ? ` (${versions.length})` : ''}
              </Button>
            )}
            {/* Once a manual client's JSON has been generated via Prepare
                Manually, it uploads exactly like an imported return. */}
            {gstr1Data && canEditFilingStatus() && (
              <Button
                onClick={() => { setUploadResult(null); setUploadDialogOpen(true); }}
                disabled={isUploading || !extReady || !!gstinMismatch || isFiled}
                className="bg-success text-success-foreground hover:bg-success/90"
                title={
                  isFiled
                    ? 'GSTR-1 already Filed — portal upload is locked to preserve the filed record'
                    : gstinMismatch
                      ? `Cannot upload: JSON GSTIN ${gstinMismatch.jsonGstin} doesn't match client GSTIN ${gstinMismatch.clientGstin}`
                      : extReady
                        ? 'Upload this GSTR-1 JSON to the GST portal (filing / signing stays manual)'
                        : 'GST Keeper browser extension not detected — install / enable it and reload this page'
                }
              >
                {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Upload to GST Portal
              </Button>
            )}
            {/* Only meaningful right after a "Processed with Error" upload,
                while GSTN is still generating the per-invoice Error Report. */}
            {gstr1Data && canEditFilingStatus() && gstr1Data.last_upload_status === 'partial' && (
              <>
                <Button
                  variant="outline"
                  onClick={handleRefreshErrors}
                  disabled={isUploading || !extReady}
                  title="Re-open the portal and fetch the per-invoice Error Report (GSTN takes up to 20 min to generate it)"
                >
                  {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  Refresh errors
                </Button>
                <Button
                  variant="outline"
                  onClick={handleImportErrorReport}
                  title="Manually import the Error Report JSON you downloaded from the portal's Download tab"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import Error Report
                </Button>
              </>
            )}
            {gstr1Data && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isUploading || isFiled}
                title={isFiled ? 'GSTR-1 already Filed — delete is locked' : undefined}
              >
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
      <input
        ref={errorReportInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleErrorReportChange}
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
                {gstr1Data.last_uploaded_at ? (
                  <div className={`text-xs flex items-center gap-1 font-medium ${gstr1Data.last_upload_status === 'accepted' ? 'text-success' : 'text-destructive'}`}>
                    {gstr1Data.last_upload_status === 'accepted'
                      ? <CheckCircle2 className="h-3.5 w-3.5" />
                      : <XCircle className="h-3.5 w-3.5" />}
                    {gstr1Data.last_upload_summary || (gstr1Data.last_upload_status === 'accepted'
                      ? 'Uploaded to portal'
                      : gstr1Data.last_upload_status === 'partial'
                        ? 'Uploaded with errors'
                        : 'Upload failed')}
                    {' · '}
                    {new Date(gstr1Data.last_uploaded_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {gstr1Data.last_upload_errors && gstr1Data.last_upload_errors.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() => {
                          setUploadResult({ ok: false, message: gstr1Data.last_upload_summary || 'Upload had errors.', errors: gstr1Data.last_upload_errors || [] });
                          setErrorsDialogOpen(true);
                        }}
                      >
                        View errors
                      </Button>
                    )}
                  </div>
                ) : gstr1Data.last_pushed_at && (
                  <div className={`text-xs flex items-center gap-1 font-medium ${gstr1Data.last_push_status === 'success' ? 'text-success' : 'text-destructive'}`}>
                    {gstr1Data.last_push_status === 'success'
                      ? <CheckCircle2 className="h-3.5 w-3.5" />
                      : <XCircle className="h-3.5 w-3.5" />}
                    {gstr1Data.last_push_status === 'success' ? 'Pushed to GST portal (legacy)' : 'Last push failed (legacy)'}
                    {' · '}
                    {new Date(gstr1Data.last_pushed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Return is Filed — hard lock on Import / Upload / Delete so nobody can
          alter the JSON that backs a filed return retroactively. */}
      {isFiled && (
        <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success-foreground">
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-success" />
          <div className="flex-1">
            <p className="font-medium text-success">GSTR-1 already Filed for this period</p>
            <p className="text-xs mt-0.5 text-foreground/80">
              Import JSON, Upload to Portal and Delete are locked to preserve the record of what was actually filed
              with GSTN. Version History and Error Reports remain viewable.
            </p>
          </div>
        </div>
      )}

      {/* Loaded JSON is for a different taxpayer — refuse Upload and surface
          the mismatch so the operator can delete + re-import the right file. */}
      {gstinMismatch && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">GSTIN mismatch — this file belongs to a different taxpayer.</p>
            <p className="text-xs mt-0.5 text-destructive/90">
              File GSTIN: <span className="font-mono">{gstinMismatch.jsonGstin}</span> · Client GSTIN:{' '}
              <span className="font-mono">{gstinMismatch.clientGstin}</span>. Upload is blocked. Delete this
              import and re-import the correct client's JSON.
            </p>
          </div>
        </div>
      )}

      {/* Portal Upload Report — persistent, visible summary of the most recent
          upload for this (client, period). Shows the status prominently and,
          when the portal rejected any invoices, lists the per-invoice reasons
          right on the page (no dialog to click into). Survives page refresh
          because it reads from last_upload_* columns on gstr1_data. */}
      {gstr1Data && gstr1Data.last_uploaded_at && (
        <Card
          className={
            gstr1Data.last_upload_status === 'accepted'
              ? 'border-success/40 bg-success/5'
              : gstr1Data.last_upload_status === 'partial'
                ? 'border-warning/40 bg-warning/5'
                : 'border-destructive/40 bg-destructive/5'
          }
        >
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2">
                {gstr1Data.last_upload_status === 'accepted' ? (
                  <CheckCircle2 className="h-5 w-5 mt-0.5 text-success shrink-0" />
                ) : (
                  <XCircle
                    className={`h-5 w-5 mt-0.5 shrink-0 ${gstr1Data.last_upload_status === 'partial' ? 'text-warning' : 'text-destructive'}`}
                  />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    Portal Upload Report — {gstr1Data.last_upload_status === 'accepted'
                      ? 'All records accepted'
                      : gstr1Data.last_upload_status === 'partial'
                        ? 'Some records rejected by GSTN'
                        : 'Upload rejected by GSTN'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {gstr1Data.last_upload_summary || '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Last uploaded: {new Date(gstr1Data.last_uploaded_at).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                    {gstr1Data.last_upload_errors && gstr1Data.last_upload_errors.length > 0 && (
                      <> · <span className="font-medium">{gstr1Data.last_upload_errors.length}</span> invoice error(s)</>
                    )}
                  </p>
                </div>
              </div>
              {gstr1Data.last_upload_errors && gstr1Data.last_upload_errors.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!gstr1Data?.last_upload_errors?.length) return;
                    const text = gstr1Data.last_upload_errors
                      .map((e, i) => `${i + 1}. ${e.invoiceNo || '-'} | ${e.gstin || '-'} | ${e.reason}`)
                      .join('\n');
                    navigator.clipboard.writeText(text);
                    toast.success('Copied error list to clipboard');
                  }}
                >
                  Copy list
                </Button>
              )}
            </div>

            {/* Inline per-invoice error table — the reason each rejection
                happened, no clicking required. */}
            {gstr1Data.last_upload_errors && gstr1Data.last_upload_errors.length > 0 && (
              <div className="rounded-md border bg-background max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted">
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Invoice No.</TableHead>
                      <TableHead>Customer GSTIN</TableHead>
                      <TableHead>Reason (portal message)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gstr1Data.last_upload_errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{e.invoiceNo || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{e.gstin || '—'}</TableCell>
                        <TableCell className="text-sm">{e.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* If the upload was 'partial' but GSTN hasn't returned the
                per-invoice report yet (or it didn't parse), tell the operator
                what to do next. */}
            {gstr1Data.last_upload_status === 'partial' && (!gstr1Data.last_upload_errors || gstr1Data.last_upload_errors.length === 0) && (
              <p className="text-xs text-warning">
                GSTN accepted the file but flagged some records. The per-invoice reasons haven't been fetched
                yet — click <span className="font-medium">Refresh errors</span> (fetches from the portal) or{' '}
                <span className="font-medium">Import Error Report</span> (paste the JSON you download manually).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last upload result banner */}
      {uploadResult && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            uploadResult.ok
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {uploadResult.ok ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" />
          ) : (
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span className="break-words flex-1">{uploadResult.message}</span>
          {uploadResult.errors && uploadResult.errors.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setErrorsDialogOpen(true)}
            >
              View {uploadResult.errors.length} error{uploadResult.errors.length === 1 ? '' : 's'}
            </Button>
          )}
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
        <div className="space-y-6">
          {/* Manual clients: the entry grid IS the primary GSTR-1 workflow,
              shown directly — no extra click, no separate page. Once Generate
              JSON runs, gstr1Data appears and the normal parsed-sections view
              (tiles, detail tables, Upload button) takes over below, exactly
              like an imported client's return. */}
          {isManualClient && (
            <Gstr1ManualEntryPanel
              clientId={selectedClient}
              clientGstin={selectedClientData?.gstin || ''}
              clientName={selectedClientName}
              periodShort={mmYyyyToShort(selectedMonth)}
              isFiled={isFiled}
              canEdit={isStaff && canEditFilingStatus()}
              actorId={user?.id ?? null}
              hasGeneratedJson={false}
              onGenerated={() => { fetchGSTR1Data(); fetchVersions(); }}
            />
          )}
          <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={isBuilderClient ? <FileSpreadsheet className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
              title={`No GSTR-1 data for ${selectedClientName} — ${mmYyyyToShort(selectedMonth)}`}
              description={!isStaff ? undefined : isBuilderClient
                ? 'This is a builder client. Open Builder Returns and generate the period — the '
                  + 'figures are computed from bookings, receipts and BU events, not uploaded.'
                : isManualClient
                  ? 'Enter invoices above, then click Generate JSON.'
                  : 'Click "Import JSON" above to upload the GSTR-1 file for this period.'}
            />
          </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {isManualClient && (
            <Gstr1ManualEntryPanel
              clientId={selectedClient}
              clientGstin={selectedClientData?.gstin || ''}
              clientName={selectedClientName}
              periodShort={mmYyyyToShort(selectedMonth)}
              isFiled={isFiled}
              canEdit={isStaff && canEditFilingStatus()}
              actorId={user?.id ?? null}
              hasGeneratedJson={true}
              onGenerated={() => { fetchGSTR1Data(); fetchVersions(); }}
            />
          )}
        <Card>
          <CardContent className="p-4">
            {/* Provenance. A computed return and an uploaded one look identical
                once stored, so say which this is before anyone reconciles it. */}
            {isBuilderGenerated && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <FileSpreadsheet className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Generated from Builder Returns.</span>{' '}
                  These figures were computed from bookings, receipts, BU events and adjustments —
                  not uploaded. To change them, correct the underlying records and regenerate.
                  {' '}
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2"
                    onClick={() => navigate('/builder-returns')}
                  >
                    Open Builder Returns
                  </button>
                  {(json as { b2csa?: unknown[] }).b2csa?.length ? (
                    <>
                      {' '}This return also carries {(json as { b2csa: unknown[] }).b2csa.length}{' '}
                      Table 10 amendment line(s) from a retrospective re-rating. They are included
                      in the JSON and in the portal push, but there is no Table 10 tile below yet.
                    </>
                  ) : null}
                </p>
              </div>
            )}

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
              {/* The tiles above are the section navigation; this header names the
                  section whose table is shown and carries the collapse toggle. */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {SECTION_LABELS[activeTab] ?? activeTab.toUpperCase()}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary tabular-nums shrink-0">
                    {(docCount[activeTab] ?? 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => toggleCollapse(activeTab)}
                >
                  {isCollapsed(activeTab) ? (
                    <><ChevronsUpDown className="h-3.5 w-3.5 mr-1.5" /> Show all rows</>
                  ) : (
                    <><ChevronsDownUp className="h-3.5 w-3.5 mr-1.5" /> Show only total</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Counts are documents (invoices / notes) like the GST portal; the table lists each tax-rate line, so it can have more rows than the count.
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
                        {!isCollapsed('b2b') && b2bRows.map((row, i) => (
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
                        {!isCollapsed('b2cl') && b2clRows.map((row, i) => (
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
                        {!isCollapsed('b2cs') && b2csRows.map((row: any, i: number) => (
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

              {/* B2CSA Tab — Table 10 */}
              <TabsContent value="b2csa">
                {b2csaRows.length === 0 ? renderEmptyState('B2CSA') : (
                  <div className={TABLE_SHELL}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20 w-12">Sr.</TableHead>
                          <TableHead className="font-bold text-primary-foreground border border-primary-foreground/20">Original Month</TableHead>
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
                        {!isCollapsed('b2csa') && b2csaRows.map((row: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="border border-border text-center">{i + 1}</TableCell>
                            <TableCell className="border border-border">{row.omon}</TableCell>
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
                          <TableCell className="border border-border font-semibold" colSpan={5}>Total ({b2csaRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csaRows, 'txval'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csaRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csaRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csaRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(b2csaRows, 'csamt'))}</TableCell>
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
                        {!isCollapsed('cdnr') && cdnrRows.map((row, i) => (
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
                        {!isCollapsed('cdnur') && cdnurRows.map((row, i) => (
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
                        {!isCollapsed('exp') && expRows.map((row, i) => (
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
                        {!isCollapsed('hsn') && hsnRows.map((row: any, i: number) => (
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
                        {!isCollapsed('nil') && (nilData.inv || []).map((item: any, i: number) => (
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
                        {!isCollapsed('at') && atRows.map((row: any, i: number) => (
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
                        {!isCollapsed('txpd') && txpdRows.map((row: any, i: number) => (
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
                        {!isCollapsed('doc') && docRows.map((row, i) => (
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
        </div>
      )}

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
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleDownloadJson}>
                  <FileJson className="h-3.5 w-3.5 mr-1.5" /> Download JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
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

      {/* Upload confirmation — the extension will open the GST portal in a
          new tab; the human clears the CAPTCHA. Filing / signing stays manual. */}
      <AlertDialog open={uploadDialogOpen} onOpenChange={(o) => { if (!isUploading) setUploadDialogOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upload GSTR-1 to the GST portal?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The extension will open the GST portal in a new tab, log this client in,
                  and upload the JSON to the selected return.
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
                  You will need to solve the portal CAPTCHA in the new tab. Preview, Submit and
                  EVC / DSC signing stay manual — this action only populates the return draft
                  on the portal. Any invoice validation errors will be listed here once processing finishes.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)} disabled={isUploading}>
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isUploading || !extReady}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {isUploading ? 'Uploading…' : 'Confirm & Upload'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Portal upload errors — per-invoice list captured from the portal's
          Error Report so the operator can fix the source data without leaving
          this page. */}
      <Dialog open={errorsDialogOpen} onOpenChange={setErrorsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Portal upload — validation errors</DialogTitle>
            <DialogDescription>
              {uploadResult?.message || 'The portal returned validation errors for the invoices listed below.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted">
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Invoice No.</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(uploadResult?.errors || []).map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{e.invoiceNo || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{e.gstin || '—'}</TableCell>
                    <TableCell className="text-sm">{e.reason}</TableCell>
                  </TableRow>
                ))}
                {(!uploadResult?.errors || uploadResult.errors.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No per-invoice errors captured.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-between items-center pt-2">
            <p className="text-xs text-muted-foreground">
              Fix the offending invoices in your source (Tally / accounts), regenerate the JSON, re-import here, then upload again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!uploadResult?.errors?.length) return;
                const text = uploadResult.errors
                  .map((e, i) => `${i + 1}. ${e.invoiceNo || '-'} | ${e.gstin || '-'} | ${e.reason}`)
                  .join('\n');
                navigator.clipboard.writeText(text);
                toast.success('Copied to clipboard');
              }}
            >
              Copy list
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Upload version history — every Import, Upload attempt and Refresh
          Errors is recorded here so operators can see who touched what and
          why any given upload was rejected. */}
      <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>GSTR-1 upload history — {selectedClientName || '—'} · {mmYyyyToShort(selectedMonth)}</DialogTitle>
            <DialogDescription>
              Every Import, Portal Upload and Error Report fetch for this return. Click "Errors" on a row
              that captured per-invoice validation reasons to see the list for that specific attempt.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted">
                <TableRow>
                  <TableHead className="w-16">V#</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="w-24">Errors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <React.Fragment key={v.id}>
                    <TableRow>
                      <TableCell className="font-mono">v{v.version_number}</TableCell>
                      <TableCell>
                        {v.action_type === 'IMPORT' && 'Imported'}
                        {v.action_type === 'UPLOAD' && 'Uploaded to portal'}
                        {v.action_type === 'REFRESH_ERRORS' && 'Errors report'}
                        {v.file_name && (
                          <div className="text-[10px] text-muted-foreground font-mono truncate max-w-xs">{v.file_name}</div>
                        )}
                      </TableCell>
                      <TableCell>{v.actor_name || '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(v.action_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        <span className={
                          v.status === 'accepted' ? 'text-success font-medium' :
                          v.status === 'partial' ? 'text-warning font-medium' :
                          v.status === 'failed' ? 'text-destructive font-medium' :
                          'text-muted-foreground'
                        }>
                          {v.status || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs max-w-md">{v.summary || '—'}</TableCell>
                      <TableCell>
                        {v.errors && v.errors.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setExpandedVersionId(expandedVersionId === v.id ? null : v.id)}
                          >
                            {expandedVersionId === v.id ? 'Hide' : `View (${v.errors.length})`}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedVersionId === v.id && v.errors && v.errors.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/40 p-3">
                          <div className="rounded border bg-background">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-12">#</TableHead>
                                  <TableHead>Invoice No.</TableHead>
                                  <TableHead>Customer GSTIN</TableHead>
                                  <TableHead>Reason</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {v.errors.map((e, i) => (
                                  <TableRow key={i}>
                                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                                    <TableCell className="font-mono text-xs">{e.invoiceNo || '—'}</TableCell>
                                    <TableCell className="font-mono text-xs">{e.gstin || '—'}</TableCell>
                                    <TableCell className="text-xs">{e.reason}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
                {versions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                      No upload history yet for this return.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GSTR1DataPage;
