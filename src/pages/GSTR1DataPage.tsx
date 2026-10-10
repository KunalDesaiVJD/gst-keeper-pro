import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Upload, FileJson, Loader2, Trash2, Send, CheckCircle2, XCircle, Inbox, BarChart3, Download, ChevronsDownUp, ChevronsUpDown, FileSpreadsheet, History, Lock, Pencil, Plus, Save, X, Combine } from 'lucide-react';
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
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note } from '@/components/gstr9/ui';
import {
  WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_TR_TOTAL,
  WS_FILTER_LABEL, WS_CONTROL, WS_CELL_INPUT,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
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
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DOC_TYPES } from '@/utils/gstr1ManualBuild';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { isBuilderGenerated as isBuilderSourced, stripInternalFields } from '@/utils/builderGstr1';
import { effectiveFilingReturnType, markFilingPushed } from '@/lib/markFilingPushed';
import { diffGstr1, summariseDiff } from '@/utils/gstReturnDiff';
import ReturnDiffTable from '@/components/dialogs/ReturnDiffTable';
import Gstr1ManualEntryPanel from '@/components/gstr1/Gstr1ManualEntryPanel';
import EinvoiceRecoPanel from '@/components/gstr1/EinvoiceRecoPanel';
import { ProblemLine } from '@/components/notices/ui/ProblemLine';
import {
  extractDocs, isPullFresh, leaveOutKept, planEinvoiceUpload, reconcileEinvoice,
  type EinvRecoRow, type EinvUploadPlan, type EinvoiceDocRow,
} from '@/lib/einvoice/einvoice';
import {
  EINVOICE_MIN_EXTENSION, booksHaveEinvoiceable, einvoiceExcelMismatch, fetchEinvoiceEvidence, isPullRunning, loadEinvoiceRecords,
  parseEinvoiceExcelFiles, pushAwaitingRepull, readEinvoiceExcelFile, readEinvoicePull, samePull, saveEinvoiceExcelImport, successfulPullAt,
  type EinvoiceEvidence, type EinvoicePullRow, type EinvoiceRecords,
} from '@/lib/einvoice/einvoiceData';
import AdvanceSetoffGateDialog from '@/components/advances/AdvanceSetoffGateDialog';
import { useAdvanceSetoffGate } from '@/hooks/useAdvanceSetoffGate';
import { compareVersions, isExtensionUpdateRecommended, updateRecommendedMessage } from '@/lib/extensionVersion';
import { describeHsnFixes, describeHsnProblems, editableUqc, isServiceHsn, normaliseGstr1Hsn, normaliseUqc } from '@/lib/gstr1/uqc';
import { describeGstr1Issues, gstr1HasSectionData, tidyGstr1Json, validateGstr1Json } from '@/lib/gstr1/validate';
import { UqcSelect, UqcText } from '@/components/gstr1/UqcSelect';

/** First extension version that pushes a NIL GSTR-1. */
const NIL_PUSH_MIN_EXTENSION = '0.8.4';
/** An e-invoice pull left without a result this long is given up on. From 0.8.8 the extension waits up to 22 minutes
 *  for the portal to build the GSTR-1 file (its own idle limit is 10 minutes, kept off by a heartbeat while it waits). */
const EINVOICE_PULL_WATCHDOG_MS = 30 * 60 * 1000;
/** First extension version whose Refresh errors reads the Upload History (and can record 'accepted'). */
const REFRESH_HISTORY_MIN_EXTENSION = '0.8.6';
/**
 * A 'failed' upload whose file reached the portal with its outcome unknown, by
 * the summary the extension saves (word for word): the 6-minute timeout
 * (content.js handleGstr1Upload) or its portal tab closed after the file was
 * attached (background.js PUSH_TAB_CLOSED_UPLOAD). Only these offer Refresh
 * errors: every other failure never sent the file, so nothing on the portal is
 * this push's.
 */
const OUTCOME_UNKNOWN_SUMMARIES = [
  'Timed out waiting for the portal to finish processing (6 min).',
  'Portal tab closed during the upload',
];
const isOutcomeUnknownFailure = (summary?: string | null) =>
  OUTCOME_UNKNOWN_SUMMARIES.some((p) => (summary || '').startsWith(p));
/**
 * Whether the stored JSON is still the one that attempt sent. Refresh records
 * the stored JSON as what was uploaded, so after a re-import or an edit it
 * would put a file the portal never received on record as accepted.
 */
const jsonUnchangedSinceUpload = (r: { updated_at?: string | null; last_uploaded_at?: string | null }) =>
  !r.updated_at || !r.last_uploaded_at || Date.parse(r.updated_at) <= Date.parse(r.last_uploaded_at);
/** An upload or NIL push left without a result this long is given up on (the extension's own idle limit is 10 minutes). */
const UPLOAD_WATCHDOG_MS = 20 * 60 * 1000;

// What the push gate for an e-invoice client says (docs/GSTR1_EINVOICE_POSITIONS.md §4).
const fmtEinvWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const einvExtensionTooOldText = (v: string | null) =>
  `The browser extension is ${v ? `v${v}` : 'an older version'}; pushing an e-invoice client needs v${EINVOICE_MIN_EXTENSION} or later. `
  + 'An older copy ignores the plan and uploads every document, which would overwrite the e-invoices on the portal and drop their IRNs. '
  + 'Load the updated extension (chrome://extensions → Reload) and try again.';
/** yyyy-mm-dd → "9 Oct 2026". */
const fmtEinvDay = (iso: string) => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : iso;
};
/** How staff make the portal generate today's GSTR-1 file, which a pull of an older one needs (§4.3). */
const EINV_FRESH_FILE_STEPS = 'On the portal: Prepare Offline → Download → Generate JSON file to download, wait for the file to be generated, then pull again.';
/** Is an ISO time on today's IST calendar day? */
const isTodayIst = (iso: string) => {
  const day = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10);
  const t = Date.parse(iso);
  return Number.isFinite(t) && day(t) === day(Date.now());
};
/**
 * A pull is saving its records (einvoice_pulls status 'running', or one this
 * page started that has not reported back): nothing may rest on them yet (§4.3, §8).
 */
const einvPullRunningText = (p: EinvoicePullRow | null) =>
  `A pull of e-invoices is in progress${p && isPullRunning(p) ? ` (started ${fmtEinvWhen(p.pulled_at)})` : ''}: wait for it to finish, `
  + 'then push. If it was interrupted (its portal tab closed, or the connection dropped), pull again.';
/** Why the last pull is not one a plan may rest on: running, stale, not today, or none (§4.3). */
const einvPullWhy = (p: EinvoicePullRow | null) => (!p ? 'No e-invoice pull for this period yet.'
  : p.status === 'ok' || p.status === 'none' ? `The last pull was ${fmtEinvWhen(p.pulled_at)}, not today.`
    : p.status === 'stale'
      ? `${isTodayIst(p.pulled_at) ? `Today's pull (${fmtEinvWhen(p.pulled_at)})` : `The last pull (${fmtEinvWhen(p.pulled_at)})`} got a GSTR-1 file the portal generated earlier${p.generated_on ? ` (on ${fmtEinvDay(p.generated_on)})` : ''}, so nothing was saved from it. ${EINV_FRESH_FILE_STEPS}`
      : `The last pull (${fmtEinvWhen(p.pulled_at)}) did not finish (${p.status}).`);
const einvNotFreshText = (p: EinvoicePullRow | null, x?: EinvoicePullRow | null) => (isPullRunning(p) ? einvPullRunningText(p)
  : `Pull e-invoices, or import the e-invoice Excel downloaded from the portal, first (today). ${einvPullWhy(p)}`
    + (x ? ` The e-invoice Excel was imported ${fmtEinvWhen(x.pulled_at)}, not today.` : '')
    + ' E-invoices reach the portal two days after their IRN, and one uploaded over first is never auto-populated, so what is left out must rest on today\'s e-invoice status.');
/**
 * The firm's decision (10 Oct 2026): an e-invoice Excel imported today lets a
 * push go just as a pull of today does. Its import time is recorded
 * (einvoice_pulls, source einvoice_excel) and shown on the push.
 */
const isExcelFresh = (x: EinvoicePullRow | null | undefined): boolean => !!x && x.status === 'ok' && isTodayIst(x.pulled_at);
/** What a plan rests on: the pull of today, else the Excel imported today (null: neither). */
const einvPlanBasis = (p: EinvoicePullRow | null, x: EinvoicePullRow | null) => (isPullFresh(p) ? { kind: 'pull' as const, at: p!.pulled_at }
  : isExcelFresh(x) ? { kind: 'excel' as const, at: x!.pulled_at } : null);
/** A pull started or ended while the records were being read, or since (§4.3, §8). */
const EINV_PULL_MOVED = 'A pull of e-invoices saved new records while this push was being prepared, so nothing was uploaded. '
  + 'Check the e-invoice reconciliation, then click Upload again.';
const einvDocLabel = (r: EinvRecoRow) => `${r.section.toUpperCase()} ${r.doc_no}${r.doc_type !== 'INV' ? ` (${r.doc_type})` : ''}${r.ctin ? `, ${r.ctin}` : ''}`;
const einvBlockerWhy = (r: EinvRecoRow) => r.differences.join(', ') || (r.status === 'number_differs' ? 'number differs from the e-invoice' : 'changed after IRN');
const einvBlockersText = (rows: EinvRecoRow[]) => {
  const list = rows.slice(0, 6).map((r) => `${einvDocLabel(r)}: ${einvBlockerWhy(r)}`).join('; ');
  return `${rows.length} document${rows.length === 1 ? ' blocks' : 's block'} the push (changed after IRN, or number differs from the e-invoice): `
    + `${list}${rows.length > 6 ? `; and ${rows.length - 6} more` : ''}. Correct the books to the e-invoice (or the IRN on the IRP), then push.`;
};
const einvDocList = (rows: EinvRecoRow[], max = 6) =>
  rows.slice(0, max).map(einvDocLabel).join('; ') + (rows.length > max ? `; and ${rows.length - max} more` : '');
/** The push refused over documents whose e-invoice is pending auto-population (§4.5). */
const einvPendingText = (rows: EinvRecoRow[]) =>
  `${rows.length} document${rows.length === 1 ? ' is' : 's are'} in the books with an e-invoice still pending auto-population, not on the `
  + `portal's draft yet: ${einvDocList(rows)}. Nothing was uploaded. Tick the box in the upload dialog to upload `
  + `${rows.length === 1 ? 'it' : 'them'} now without the IRN (GSTN para 3(c)), or pull again once the portal shows ${rows.length === 1 ? 'it' : 'them'}, then push.`;
/** What Version History records on the push's UPLOAD row when staff override the pending block (§4.5). */
const einvPendingOverrideNote = (rows: EinvRecoRow[]) =>
  `E-invoice override: ${rows.length} document${rows.length === 1 ? '' : 's'} pending auto-population uploaded from the books, `
  + `so ${rows.length === 1 ? 'its' : 'their'} IRN is not linked (GSTN para 3(c)): ${einvDocList(rows, 10)}.`;
/** Pending auto-population and not in the books (§5, warnings.pending). */
const einvPendingNotInBooksText = (k: number) =>
  `${k.toLocaleString('en-IN')} e-invoice${k === 1 ? ' is' : 's are'} pending auto-population and in neither the books nor the portal's draft yet: `
  + `if GSTR-1 is filed before a pull shows ${k === 1 ? 'it' : 'them'} on the draft, ${k === 1 ? 'it is' : 'they are'} missing from it. `
  + `Do not file until a pull shows ${k === 1 ? 'it' : 'them'}, or add ${k === 1 ? 'it' : 'them'} to the books.`;
/**
 * Failed or lost, and not in the books (§5, warnings.missingFromReturn). The
 * pull stores only documents that carry an IRN, so one still on the portal
 * without it is filed as uploaded (review N6).
 */
const einvMissingFromReturnText = (k: number) =>
  `${k.toLocaleString('en-IN')} e-invoice${k === 1 ? ' is' : 's are'} not among the IRN documents on the portal draft and not in the books: `
  + `${k === 1 ? 'it' : 'they'} will be missing from GSTR-1 unless added to the books (or the IRN was cancelled). `
  + `If ${k === 1 ? 'it is' : 'they are'} on the portal without ${k === 1 ? 'its' : 'their'} IRN, ${k === 1 ? 'it' : 'they'} will be filed as uploaded.`;
/** Could not tell whether the client issues e-invoices (§4.6, §7): refuse rather than push it as one that does not. */
const EINV_EVIDENCE_FAILED = 'Could not check whether this client issues e-invoices, so nothing was uploaded. Try again.';

/**
 * Appends `note` to the summary of the UPLOAD row a push wrote (the first
 * one after `afterVersion`), when that upload was accepted or partial (a
 * failed row uploaded nothing). The extension writes that row just before
 * the result reaches the page, so it is looked for a few times. True when
 * the row carries the note.
 */
async function noteOnUploadVersion(
  o: { clientId: string; periodShort: string; afterVersion: number; note: string },
  attempts = 8,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((res) => setTimeout(res, 1500));
    const { data, error } = await supabase
      .from('gstr1_upload_versions')
      .select('id, summary, status')
      .eq('client_id', o.clientId)
      .eq('period_month', o.periodShort)
      .eq('action_type', 'UPLOAD')
      .gt('version_number', o.afterVersion)
      .order('version_number', { ascending: true })
      .limit(1);
    const row = !error && data ? data[0] : null;
    if (!row) continue;
    // Only an upload the portal took (accepted or partial) uploaded the
    // documents the note names; a failed row did not (review N4).
    if (row.status !== 'accepted' && row.status !== 'partial') return false;
    if ((row.summary || '').includes(o.note)) return true;
    const { error: upError } = await supabase
      .from('gstr1_upload_versions')
      .update({ summary: row.summary ? `${row.summary} ${o.note}` : o.note })
      .eq('id', row.id);
    return !upError;
  }
  return false;
}

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
  ata: 'ATA — 11(2) (Amended Advances)',
  txpda: 'TXPDA — 11(2) (Amended Adjustment)',
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
  registration_type?: string | null;
  // 'manual' clients only send bills — their GSTR-1 is prepared entirely
  // outside this app, so the Import/Upload actions don't apply to them.
  // 'json_manual' clients import/upload a JSON as usual but staff can also
  // open the manual entry grid against it and edit every section by hand.
  gstr1_import_mode?: 'json' | 'manual' | 'json_manual' | null;
  // Ticked "E-invoice applicable". With client_einvoice_evidence (IRNs seen
  // for this client or a registration on its PAN) it makes an e-invoice
  // client: the page pulls its e-invoices, reconciles them with the books
  // JSON and leaves the ones already on the portal out of the push
  // (docs/GSTR1_EINVOICE_POSITIONS.md).
  einvoice_applicable?: boolean | null;
}

interface UploadErrorRow {
  invoiceNo?: string;
  gstin?: string;
  reason: string;
}

// GSTN's upload/error-report responses can include a row for every submitted
// record, not just the rejected ones — accepted records show up with
// placeholder fields like reason "NA NA NA" instead of a real validation
// message. Without filtering these out, a fully-accepted upload (extension
// reports status 'accepted' and a summary like "all accepted") still gets
// rendered as a partial/failed upload because the errors array isn't empty.
const isAcceptedRecordReason = (reason?: string | null) => {
  const trimmed = (reason || '').trim();
  if (!trimmed) return true;
  return trimmed.split(/\s+/).every((token) => /^n\/?a$/i.test(token));
};
// The portal's own labels and buttons, scraped as a "reason" by extensions
// before 0.8.6 while the Error Report was still being generated. They say
// the reasons are NOT in yet, the opposite of an accepted record.
const isPortalLabelReason = (reason?: string | null) =>
  /^(generate error report|download error report|error report generation requested|acknowledged)\b/i.test((reason || '').trim());
const isPlaceholderReason = (reason?: string | null) => isAcceptedRecordReason(reason) || isPortalLabelReason(reason);
const filterRealErrors = (errors?: UploadErrorRow[] | null): UploadErrorRow[] =>
  (errors || []).filter((row) => !isPlaceholderReason(row.reason));

interface UploadVersion {
  id: string;
  client_id: string;
  /** Short label ("Aug-26"), as gstr1_data. */
  period_month: string;
  version_number: number;
  action_type: 'IMPORT' | 'UPLOAD' | 'REFRESH_ERRORS';
  actor_id: string | null;
  actor_name?: string;
  action_at: string;
  file_name: string | null;
  status: string | null;
  summary: string | null;
  errors: UploadErrorRow[] | null;
  payload: unknown | null;
  /** UPLOAD rows from extension 0.8.7: e-invoices left out of the upload so the portal kept their IRN. */
  einvoice_kept?: number | null;
  /** UPLOAD rows from extension 0.8.7: the extension that pushed. */
  ext_version?: string | null;
}

interface GSTR1Record {
  id: string;
  client_id: string;
  period_month: string;
  raw_json: any;
  file_name: string | null;
  imported_at: string;
  /** Stamped by every writer of raw_json (import, edits, Generate, Builder, Table 11B, the pre-push correction). */
  updated_at?: string | null;
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
// sticky header (and the sticky totals row) to have a scroll container to stick to.
const TABLE_SHELL = 'overflow-hidden rounded-md border bg-card [&>div]:max-h-[70vh] [&>div]:overflow-auto';

// The Annual Return grid look for the shadcn <Table> parts (TableHead/TableCell
// merge these over their own h-12 / p-4 defaults).
const TH = `h-auto ${WS_TH}`;
const TD = WS_TD;
const TD_NUM = WS_TD_NUM;
const TR_TOTAL = `${WS_TR_TOTAL} border-0 hover:bg-muted`;
const TFOOT = 'sticky bottom-0 z-10 border-t-0 bg-transparent';
// Header for a table nested inside another scroll area (no sticky — it would
// pin to the outer container).
const TH_STATIC = `${TH} static`;
const CELL_SELECT = 'h-9 rounded-none border-0 bg-transparent px-2 text-sm shadow-none focus:ring-1 focus:ring-inset focus:ring-primary focus:ring-offset-0';

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

  // Advance set-off gate. This is the GSTR-1 call site, and the only one that
  // can fix the draft in place — Table 11B lives in this JSON, so persistDraft
  // writes the corrected return straight back and the check re-runs.
  // docs/ADVANCE_SETOFF_POSITIONS.md §5.
  const advanceGate = useAdvanceSetoffGate({
    returnType: 'GSTR-1',
    returnLabel: 'GSTR-1 upload',
    persistDraft: async (nextJson) => {
      if (!selectedClient || !selectedMonth) return;
      const { error } = await supabase
        .from('gstr1_data')
        .update({ raw_json: nextJson as never, updated_at: new Date().toISOString() })
        .eq('client_id', selectedClient)
        .eq('period_month', mmYyyyToShort(selectedMonth));
      if (error) throw error;
      await fetchGSTR1Data();
    },
  });

  // "Upload to GST Portal" flow — extension-driven.
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    ok: boolean;
    message: string;
    errors?: UploadErrorRow[];
  } | null>(null);
  const [errorsDialogOpen, setErrorsDialogOpen] = useState(false);
  const [showUploadReport, setShowUploadReport] = useState(false);
  const [extReady, setExtReady] = useState(false);
  // The extension's own version (appbridge.js posts it with the ready ping).
  // NIL push and the e-invoice pull exist only from 0.8.4.
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const extNudged = useRef(false);
  // NIL return push (no JSON needed) — confirmation dialog.
  const [nilDialogOpen, setNilDialogOpen] = useState(false);
  // E-invoice (IRN) records for this client + period: every stored record
  // (pull and Excel), the last portal pull and the last Excel import.
  const [einvoiceDocs, setEinvoiceDocs] = useState<EinvoiceDocRow[]>([]);
  const [einvoicePull, setEinvoicePull] = useState<EinvoicePullRow | null>(null);
  const [einvoiceExcel, setEinvoiceExcel] = useState<EinvoicePullRow | null>(null);
  const [einvLoading, setEinvLoading] = useState(false);
  const [isPullingEinv, setIsPullingEinv] = useState(false);
  const [isImportingEinvExcel, setIsImportingEinvExcel] = useState(false);
  const einvFetchSeq = useRef(0);
  const einvExcelInputRef = useRef<HTMLInputElement>(null);
  // The selection as of the latest render, for async work that outlives it.
  const selectionRef = useRef({ client: selectedClient, month: selectedMonth });
  selectionRef.current = { client: selectedClient, month: selectedMonth };
  // Is the selected client an e-invoice client, by evidence (§7)? Keyed by
  // client so a stale answer never decides for another one.
  const [einvEvidence, setEinvEvidence] = useState<(EinvoiceEvidence & { clientId: string }) | null>(null);
  const einvEvidenceSeq = useRef(0);
  // Set while a NIL push is in flight, so a failure result is worded as one.
  const nilPushRef = useRef(false);
  // Set while a push that carries an e-invoice plan is in flight, so its
  // result says how many e-invoices were left out, even none.
  const einvPlanSentRef = useRef(false);
  // The upload dialog's override for documents whose e-invoice is pending
  // auto-population (§4.5): the reconciliation keys staff ticked to upload
  // without their IRN. A push re-reads the records, and any pending document
  // not ticked here still blocks it.
  const [einvPendingAck, setEinvPendingAck] = useState<string[] | null>(null);
  // Set while a push that used that override is in flight: its UPLOAD row in
  // Version History gets the note once the extension has written it.
  const einvOverrideRef = useRef<{ clientId: string; periodMonth: string; periodShort: string; afterVersion: number; note: string } | null>(null);

  // Manual correction of an imported JSON's HSN (Table 12) and Documents
  // Issued (Table 13) sections. Tally's GSTR-1 export has produced malformed
  // values/shape in these two sections for some clients, causing the portal
  // to reject the whole upload with a generic error — this lets the operator
  // hand-fix the values in-app before retrying, without needing Tally to
  // regenerate a corrected file.
  const [hsnEditMode, setHsnEditMode] = useState(false);
  const [hsnEditRows, setHsnEditRows] = useState<any[]>([]);
  const [isSavingHsn, setIsSavingHsn] = useState(false);
  const [docEditMode, setDocEditMode] = useState(false);
  const [docEditRows, setDocEditRows] = useState<any[]>([]);
  const [isSavingDoc, setIsSavingDoc] = useState(false);

  // Upload history (versions) + per-version error dialog.
  const [versions, setVersions] = useState<UploadVersion[]>([]);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  // Filing status for this (client, period, GSTR-1). Once 'Filed', all edits
  // and portal actions are blocked so the record we hold matches what was
  // actually filed with GSTN.
  const [filingStatus, setFilingStatus] = useState<string | null>(null);
  const isFiled = filingStatus === 'Filed';
  // NIL Return: staff-ticked flag meaning this period had zero activity, so
  // Table 13 (Documents Issued) — normally mandatory before portal push,
  // since it can never be auto-filled — is not required.
  const [isNilReturn, setIsNilReturn] = useState(false);
  const [isTogglingNil, setIsTogglingNil] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Per-tab collapse: when a section id is in the set, its table shows only the
  // header + totals row (data rows hidden). Every section starts collapsed so
  // the page opens on a totals-first view.
  const ALL_TAB_IDS = ['b2b', 'b2cl', 'b2cs', 'b2csa', 'cdnr', 'cdnur', 'exp', 'hsn', 'nil', 'at', 'txpd', 'ata', 'txpda', 'doc'];
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
      .from('clients').select('id, name, gstin, regular_sub_type, registration_type, gstr1_import_mode, einvoice_applicable').order('name');
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

  /**
   * 'json_manual' clients import/upload their JSON as usual, but staff can
   * also open the manual entry grid against the imported return and edit any
   * section by hand (not just HSN/Documents via the HSN editor below).
   */
  const isJsonManualClient = useMemo(
    () => clients.find((c) => c.id === selectedClient)?.gstr1_import_mode === 'json_manual',
    [clients, selectedClient],
  );

  /** Ticked "E-invoice applicable" on the client form. */
  const isEinvoiceTicked = useMemo(
    () => !!clients.find((c) => c.id === selectedClient)?.einvoice_applicable,
    [clients, selectedClient],
  );

  // client_einvoice_evidence: the tick, e-invoice records or IRNs in a stored
  // GSTR-1 JSON, on this client or any registration on its PAN. On an RPC
  // error (migration not applied) the tick alone decides.
  const fetchEinvoiceEvidenceForClient = useCallback(async () => {
    const seq = ++einvEvidenceSeq.current;
    if (!selectedClient) { setEinvEvidence(null); return; }
    const ev = await fetchEinvoiceEvidence(selectedClient, isEinvoiceTicked);
    if (seq !== einvEvidenceSeq.current) return;
    setEinvEvidence({ ...ev, clientId: selectedClient });
  }, [selectedClient, isEinvoiceTicked]);

  /**
   * E-invoice client (docs/GSTR1_EINVOICE_POSITIONS.md §7): ticked, or IRNs
   * seen for it or its PAN, exemption or not. The reco panel, the pull and
   * the push gate apply to it.
   */
  const isEinvoiceClient = useMemo(
    () => isEinvoiceTicked || (einvEvidence?.clientId === selectedClient && einvEvidence.issues),
    [isEinvoiceTicked, einvEvidence, selectedClient],
  );
  const einvoiceReason = einvEvidence?.clientId === selectedClient && einvEvidence.issues
    ? einvEvidence.reason
    : isEinvoiceTicked ? 'Ticked "E-invoice applicable"' : null;
  /**
   * The evidence read failed for a client that is not ticked: nobody knows
   * whether it issues e-invoices, so the panel is hidden for want of an
   * answer, not because it issues none. Push and Download JSON re-read it
   * and refuse while it still fails (§7).
   */
  const einvEvidenceFailed = !isEinvoiceTicked && einvEvidence?.clientId === selectedClient && !!einvEvidence.failed
    ? (einvEvidence.error || 'the read failed')
    : null;

  /**
   * The evidence for a push or a download: the tick, or a fresh read
   * whenever the cached answer is another client's or was not read from the
   * evidence (a failed read is never trusted). null when the read failed and
   * the client is not ticked: the caller refuses.
   */
  const einvoiceClientNow = useCallback(async (clientId: string): Promise<boolean | null> => {
    if (isEinvoiceTicked) return true;
    if (einvEvidence?.clientId === clientId && einvEvidence.fromEvidence) return einvEvidence.issues;
    const seq = ++einvEvidenceSeq.current;
    const ev = await fetchEinvoiceEvidence(clientId, false);
    if (seq === einvEvidenceSeq.current && selectionRef.current.client === clientId) setEinvEvidence({ ...ev, clientId });
    return ev.failed ? null : ev.issues;
  }, [isEinvoiceTicked, einvEvidence]);

  // einvoice_docs / einvoice_pulls use MM/YYYY like the rest of the app. The
  // extension writes the pull; the page writes the Excel import.
  const fetchEinvoice = useCallback(async () => {
    const seq = ++einvFetchSeq.current;
    if (!selectedClient || !selectedMonth || !isEinvoiceClient) {
      setEinvoiceDocs([]); setEinvoicePull(null); setEinvoiceExcel(null); setEinvLoading(false);
      return;
    }
    setEinvLoading(true);
    try {
      const rec = await loadEinvoiceRecords(selectedClient, selectedMonth);
      if (seq !== einvFetchSeq.current) return;
      setEinvoiceDocs(rec.docs);
      setEinvoicePull(rec.pull);
      setEinvoiceExcel(rec.excel);
    } catch (err) {
      if (seq !== einvFetchSeq.current) return;
      setEinvoiceDocs([]); setEinvoicePull(null); setEinvoiceExcel(null);
      toast.error('Could not load e-invoices: ' + (err instanceof Error ? err.message : (err as { message?: string })?.message || String(err)));
    } finally {
      if (seq === einvFetchSeq.current) setEinvLoading(false);
    }
  }, [selectedClient, selectedMonth, isEinvoiceClient]);

  // The reconciliation and the upload plan (§3), shared by the panel, the
  // upload dialog and Download JSON. pulledAt is the last pull that finished;
  // the Excel import never stands in for it.
  const einvPulledAt = successfulPullAt(einvoicePull);
  const einvBooksDocs = useMemo(
    () => (isEinvoiceClient && gstr1Data?.raw_json ? extractDocs(gstr1Data.raw_json) : []),
    [isEinvoiceClient, gstr1Data],
  );
  const einvRows = useMemo<EinvRecoRow[]>(
    () => (isEinvoiceClient ? reconcileEinvoice(einvBooksDocs, einvoiceDocs, { pulledAt: einvPulledAt }) : []),
    [isEinvoiceClient, einvBooksDocs, einvoiceDocs, einvPulledAt],
  );
  const einvPlan = useMemo<EinvUploadPlan>(() => planEinvoiceUpload(einvRows), [einvRows]);
  /** The push gate applies: an e-invoice client whose books have e-invoiceable documents. */
  const einvGate = isEinvoiceClient && booksHaveEinvoiceable(einvBooksDocs);
  /** Every document whose e-invoice is pending is ticked for upload in the dialog (§4.5). */
  const einvPendingAcked = einvPlan.pendingBlockers.length > 0
    && einvPlan.pendingBlockers.every((r) => !!einvPendingAck?.includes(r.key));

  /**
   * Why the push is refused for an e-invoice client (§4), in the order staff
   * fix them; empty when it may go. handleUpload checks the same against
   * fresh reads.
   */
  const einvPushBlocks = useMemo(() => {
    if (!einvGate) return [] as { key: string; text: string }[];
    const blocks: { key: string; text: string }[] = [];
    if (!extVersion || compareVersions(extVersion, EINVOICE_MIN_EXTENSION) < 0) {
      blocks.push({ key: 'ext', text: einvExtensionTooOldText(extVersion) });
    }
    // A pull still saving (its row says 'running', or this page started one
    // that has not reported back) is waited for, never planned on (§4.3).
    // An Excel imported today stands in for the pull, even while one waits on the portal.
    const excelFresh = isExcelFresh(einvoiceExcel);
    if (isPullRunning(einvoicePull) || (isPullingEinv && !excelFresh)) blocks.push({ key: 'pull', text: einvPullRunningText(einvoicePull) });
    else if (!isPullFresh(einvoicePull) && !excelFresh) blocks.push({ key: 'pull', text: einvNotFreshText(einvoicePull, einvoiceExcel) });
    if (einvPlan.blockers.length) blocks.push({ key: 'blockers', text: einvBlockersText(einvPlan.blockers) });
    if (einvPlan.pendingBlockers.length && !einvPendingAcked) blocks.push({ key: 'pending', text: einvPendingText(einvPlan.pendingBlockers) });
    return blocks;
  }, [einvGate, extVersion, einvoicePull, einvoiceExcel, einvPlan, einvPendingAcked, isPullingEinv]);

  /**
   * A push that reached the portal with no successful pull since: when it
   * was pushed, so the panel asks for a pull to confirm the IRNs (§8,
   * pushAwaitingRepull).
   */
  const einvPushedWithoutRepull = useMemo(() => {
    if (!isEinvoiceClient || !selectedClient || !selectedMonth) return null;
    const short = mmYyyyToShort(selectedMonth);
    return pushAwaitingRepull(versions.filter((v) => v.client_id === selectedClient && v.period_month === short), einvoicePull);
  }, [isEinvoiceClient, selectedClient, selectedMonth, versions, einvoicePull]);

  /** Was the stored return produced by Builder Returns rather than uploaded? */
  const isBuilderGenerated = useMemo(
    () => isBuilderSourced(gstr1Data?.file_name),
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
      const record = data as GSTR1Record | null;
      if (record) {
        // The extension writes last_upload_* directly to this row, so a stray
        // placeholder row in last_upload_errors (see isPlaceholderReason)
        // would otherwise keep showing "View errors" / a red status forever,
        // even across refreshes, on a return GSTN actually accepted in full.
        // Read as accepted only when GSTN listed records and every one was an
        // accepted record ("NA NA NA"). A partial with no rows, or only the
        // portal's "generate error report" labels, is one whose reasons were
        // never fetched: it stays partial, so Refresh errors and Import Error
        // Report stay on screen (21 such uploads since Aug-2026 lost them).
        const storedErrors = record.last_upload_errors || [];
        record.last_upload_errors = filterRealErrors(storedErrors);
        if (record.last_upload_status === 'partial' && storedErrors.length > 0
          && storedErrors.every((row) => isAcceptedRecordReason(row?.reason))) {
          record.last_upload_status = 'accepted';
        }
      }
      setGstr1Data(record);
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

    // Only from this selection's own row. Right after a client or month
    // switch gstr1Data still holds the previous one's, and backfilling from
    // it wrote that client's import and accepted upload into this one's
    // history (93 phantom rows, quarantined by 20261009200000).
    if (rows.length === 0 && gstr1Data
      && gstr1Data.client_id === selectedClient && gstr1Data.period_month === periodMonthKey) {
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
  // The row Filing Status shows: 'GSTR-1 (IFF)' for an IFF (QRMP) client, so
  // its status, Filed lock and NIL tick are the ones staff see there.
  const fetchFilingStatus = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setFilingStatus(null); setIsNilReturn(false); return; }
    const returnType = await effectiveFilingReturnType(selectedClient, 'GSTR-1', selectedMonth);
    // filing_status.period_month uses MM/YYYY format across the app.
    const { data } = await supabase
      .from('filing_status')
      .select('status, is_nil')
      .eq('client_id', selectedClient)
      .eq('return_type', returnType)
      .eq('period_month', selectedMonth)
      .maybeSingle();
    setFilingStatus(((data as any)?.status || null) as string | null);
    setIsNilReturn(!!(data as any)?.is_nil);
  }, [selectedClient, selectedMonth]);

  // Ticking NIL Return upserts filing_status so the flag survives even before
  // any other action (Prepared/Filed status, etc.) has touched this row.
  const handleToggleNilReturn = async (checked: boolean) => {
    if (!selectedClient || !selectedMonth) return;
    setIsTogglingNil(true);
    setIsNilReturn(checked); // optimistic — matches the rest of this page's UX
    try {
      const returnType = await effectiveFilingReturnType(selectedClient, 'GSTR-1', selectedMonth);
      const { error } = await supabase
        .from('filing_status')
        .upsert(
          { client_id: selectedClient, return_type: returnType, period_month: selectedMonth, is_nil: checked, updated_by: user?.id ?? null },
          { onConflict: 'client_id,return_type,period_month' },
        );
      if (error) throw error;
      toast.success(checked ? 'Marked as NIL Return — Documents Issued (Table 13) is no longer required for upload.' : 'NIL Return unmarked — Table 13 is required again before upload.');
    } catch (err: any) {
      setIsNilReturn(!checked);
      toast.error('Failed to update NIL Return: ' + err.message);
    } finally {
      setIsTogglingNil(false);
    }
  };

  // One-liner used by every mutation path (import, upload result received,
  // manual error-report import) to record what happened, by whom, when.
  // Only the expanded version is diffed. A GSTR-1 payload can run to thousands
  // of invoices, and diffing every row of the history on every render of this
  // dialog would stall it for a large client.
  const expandedDiff = useMemo(() => {
    if (!expandedDiffId) return null;
    const idx = versions.findIndex((x) => x.id === expandedDiffId);
    if (idx < 0) return null;
    const cur = versions[idx];
    const prev = versions[idx + 1];
    if (!cur?.payload || !prev?.payload) return null;
    return { cur, prev, rows: diffGstr1(prev.payload, cur.payload) };
  }, [expandedDiffId, versions]);

  const recordVersion = useCallback(async (v: {
    action_type: 'IMPORT' | 'UPLOAD' | 'REFRESH_ERRORS';
    file_name?: string | null;
    status?: string | null;
    summary?: string | null;
    errors?: UploadErrorRow[] | null;
    /**
     * The GSTR-1 JSON as it stands after this action. Passed explicitly rather
     * than read from `gstr1Data` because callers update the row first and this
     * closure would still be holding the pre-update copy.
     */
    payload?: unknown;
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
      payload: (v.payload as any) ?? null,
    });
    fetchVersions();
  }, [selectedClient, selectedMonth, user?.id, fetchVersions]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchGSTR1Data(); }, [fetchGSTR1Data]);
  useEffect(() => { fetchVersions(); }, [fetchVersions]);
  useEffect(() => { fetchFilingStatus(); }, [fetchFilingStatus]);
  useEffect(() => { fetchEinvoiceEvidenceForClient(); }, [fetchEinvoiceEvidenceForClient]);
  useEffect(() => { fetchEinvoice(); }, [fetchEinvoice]);
  // Clear the transient upload banner when the operator switches client/month.
  useEffect(() => {
    setUploadResult(null);
    setShowUploadReport(false);
    setHsnEditMode(false); setHsnEditRows([]);
    setDocEditMode(false); setDocEditRows([]);
    setIsPullingEinv(false);
    setEinvPendingAck(null);
  }, [selectedClient, selectedMonth]);
  // The pending override is ticked afresh each time the upload dialog opens.
  useEffect(() => { if (!uploadDialogOpen) setEinvPendingAck(null); }, [uploadDialogOpen]);

  // An upload, NIL push or Refresh that never reports back (a closed tab or
  // a dead end on an extension before 0.8.6) must not leave the buttons
  // spinning for ever.
  useEffect(() => {
    if (!isUploading) return;
    const t = setTimeout(() => {
      setIsUploading(false);
      nilPushRef.current = false;
      einvPlanSentRef.current = false;
      // No result, but the push may have reached the portal: one last look
      // for its UPLOAD row to record the pending override on.
      const ov = einvOverrideRef.current;
      einvOverrideRef.current = null;
      if (ov) void noteOnUploadVersion(ov, 1);
      toast.warning('No result from the browser extension after 20 minutes. Check the GST portal tab and Version History before uploading again.', { duration: 20000 });
    }, UPLOAD_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [isUploading]);
  // Nor an e-invoice pull (a closed tab before 0.8.7, or a lost message).
  useEffect(() => {
    if (!isPullingEinv) return;
    const t = setTimeout(() => {
      setIsPullingEinv(false);
      toast.warning('No e-invoice pull result from the browser extension after 30 minutes. Check the GST portal tab, then pull again.', { duration: 20000 });
    }, EINVOICE_PULL_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [isPullingEinv]);

  // Extension bridge: detect the GST Keeper browser extension and receive the
  // upload result it posts back after driving the portal. Mirrors the pattern
  // used on the reco pages for the "Pull" button.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) {
        setExtReady(true);
        if (typeof d.version === 'string') {
          setExtVersion(d.version);
          // NIL push and the e-invoice pull need a newer copy than the office may run: say so once.
          if (!extNudged.current && isExtensionUpdateRecommended(d.version)) {
            extNudged.current = true;
            toast.warning(updateRecommendedMessage(d.version), { id: 'ext-update' });
          }
        }
      }
      if (d.__gstkPullEinvoiceStarted) {
        const r = d.__gstkPullEinvoiceStarted as { ok: boolean; error?: string };
        if (!r.ok) {
          setIsPullingEinv(false);
          toast.error('E-invoice pull could not start: ' + (r.error || 'unknown error'));
        }
      }
      if (d.__gstkEinvoicePullDone) {
        const r = d.__gstkEinvoicePullDone as {
          ok: boolean;
          // 'stale': the portal served a file generated before today; nothing was saved or marked.
          status?: 'ok' | 'none' | 'pending' | 'failed' | 'stale';
          docsFound?: number;
          staleRemoved?: number;
          message?: string;
          clientId?: string | null;
          period_month?: string | null;
          tabClosed?: boolean;
        };
        // 0.8.7 names the client and period the pull was for. One for another
        // selection (changed while the portal tab ran) was saved under that
        // client and month: say so, and leave this one's records alone.
        if (r.clientId && r.period_month && (r.clientId !== selectedClient || r.period_month !== selectedMonth)) {
          const name = clients.find((c) => c.id === r.clientId)?.name || 'another client';
          toast.warning(
            `The e-invoice pull for ${name} · ${mmYyyyToShort(r.period_month)} finished (${r.status || (r.ok ? 'ok' : 'failed')}). `
            + 'It belongs to that client and month, not the one shown here: open them to see it.',
            { duration: 15000 },
          );
          return;
        }
        setIsPullingEinv(false);
        const n = r.docsFound ?? 0;
        // From 0.8.7 the pull marks (gone_at), never deletes, the records an
        // earlier pull saved that this one no longer saw on the draft.
        const stale = r.staleRemoved
          ? ` ${r.staleRemoved.toLocaleString('en-IN')} e-invoice${r.staleRemoved === 1 ? '' : 's'} saved by an earlier pull ${r.staleRemoved === 1 ? 'is' : 'are'} no longer on the portal's draft: kept with ${r.staleRemoved === 1 ? 'its' : 'their'} IRN and shown as IRN lost.`
          : '';
        if (r.tabClosed) toast.warning(r.message || 'The portal tab was closed before the e-invoice pull finished. Nothing was saved; pull again.', { duration: 15000 });
        else if (r.status === 'ok') toast.success(`E-invoices pulled — ${n.toLocaleString('en-IN')} IRN${n === 1 ? '' : 's'} on the portal.${stale}`, stale ? { duration: 15000 } : undefined);
        else if (r.status === 'none') toast.info(`No e-invoices on the portal for this period.${stale}`, stale ? { duration: 15000 } : undefined);
        else if (r.status === 'stale') {
          toast.warning(r.message || `The portal served a GSTR-1 file generated before today, so nothing was saved from it. ${EINV_FRESH_FILE_STEPS}`, { duration: 25000 });
        } else if (r.status === 'pending') toast.warning(r.message || 'The portal is still preparing the data — pull again in a few minutes.');
        else toast.error('E-invoice pull failed: ' + (r.message || 'unknown error'));
        fetchEinvoice();
        fetchEinvoiceEvidenceForClient();
      }
      if (d.__gstkUploadGstr1Result) {
        const r = d.__gstkUploadGstr1Result as {
          ok: boolean;
          status?: 'accepted' | 'partial' | 'failed' | 'nil_marked' | 'pending';
          summary?: string;
          message?: string;
          errors?: UploadErrorRow[];
          error?: string;
          // 0.8.7: e-invoices left out of the upload so the portal keeps their
          // IRN, and keep entries that named no document in the stored JSON.
          einvoiceKept?: number;
          einvoiceKeepUnmatched?: number;
          clientId?: string | null;
          period_month?: string | null;
          tabClosed?: boolean;
        };
        setIsUploading(false);
        const wasNil = nilPushRef.current;
        nilPushRef.current = false;
        const sentPlan = einvPlanSentRef.current;
        einvPlanSentRef.current = false;
        // A push that uploaded pending e-invoices on the override (§4.5): its
        // UPLOAD row says so, only when the portal took the file (accepted or
        // partial). A failed row, such as one written before the file was
        // attached, uploaded nothing and gets no note (review N4).
        const override = einvOverrideRef.current;
        if (override && !wasNil && r.status !== 'pending'
          && (!r.clientId || (r.clientId === override.clientId && r.period_month === override.periodMonth))) {
          einvOverrideRef.current = null;
          if (r.status === 'accepted' || r.status === 'partial') {
            void noteOnUploadVersion(override).then((noted) => {
              if (!noted && r.ok) {
                toast.warning(`Version History could not record the e-invoice override on this upload. For the record: ${override.note}`, { duration: 20000 });
              }
              fetchVersions();
            });
          }
        }
        // 0.8.6 names the return the result is for. One for another client or
        // month (the selection changed while the portal tab ran) belongs to
        // that return: the extension already wrote it to that return's
        // gstr1_data row, and nothing is written here for the one shown.
        if (r.clientId && r.period_month && (r.clientId !== selectedClient || r.period_month !== selectedMonth)) {
          const name = clients.find((c) => c.id === r.clientId)?.name || 'another client';
          const outcome = r.status === 'nil_marked' ? 'marked NIL'
            : r.status === 'pending' ? 'nothing recorded yet'
              : r.tabClosed ? 'outcome unknown, the portal tab was closed'
                : r.ok ? (r.status || 'done') : 'failed';
          toast.warning(
            `The GSTR-1 result for ${name} · ${mmYyyyToShort(r.period_month)} arrived (${outcome}). It belongs to that client and month, `
            + 'not the one shown here: open them to see it.',
            { duration: 20000 },
          );
          fetchVersions();
          return;
        }
        // 0.8.6: Refresh errors found nothing to record yet (the portal is
        // still processing, or shows no upload from GST Keeper since this
        // push). Nothing was written, so nothing failed.
        if (r.status === 'pending') {
          toast.info(r.summary || r.error || 'Nothing to record from the portal yet.', { duration: 15000 });
          fetchVersions();
          return;
        }
        // 0.8.6: the portal tab was closed before a result came back, so the
        // outcome is unknown. An upload whose file was attached is saved
        // 'failed' with words that offer Refresh errors; read it back.
        if (r.tabClosed) {
          toast.warning((wasNil ? 'NIL push: ' : '') + (r.error || r.summary || 'The portal tab was closed before the push finished. Check the portal.'), { duration: 20000 });
          fetchGSTR1Data();
          fetchVersions();
          fetchFilingStatus();
          return;
        }
        if (r.ok && r.status === 'nil_marked') {
          // NIL push: the extension ticked the portal's "File Nil GSTR-1"
          // option. Same "Pushed" marker as a clean JSON upload. 0.8.5 records
          // it itself; 0.8.4 does not, so the page still asks (the server
          // stamps the client's IFF row when that is the one shown).
          const msg = r.message || r.summary || 'GSTR-1 marked as NIL on the GST portal. Filing / signing stays manual.';
          toast.success(msg);
          setUploadResult({ ok: true, message: msg });
          if (selectedClient && selectedMonth) {
            markFilingPushed({
              clientId: selectedClient,
              returnType: 'GSTR-1',
              periodMonth: selectedMonth,
              actorId: user?.id ?? null,
            }).then((res) => {
              if (!res.ok) toast.warning('Marked NIL on the portal, but the filing status could not be updated: ' + ('error' in res ? res.error : ''));
              fetchFilingStatus();
            });
          }
        } else if (r.ok) {
          const kept = typeof r.einvoiceKept === 'number' && (r.einvoiceKept > 0 || sentPlan)
            ? ` ${r.einvoiceKept.toLocaleString('en-IN')} e-invoice${r.einvoiceKept === 1 ? '' : 's'} left out so the portal keeps ${r.einvoiceKept === 1 ? 'its' : 'their'} IRN.`
            : '';
          const summary = (r.summary || 'Uploaded to portal.') + kept;
          if (r.einvoiceKeepUnmatched && r.einvoiceKeepUnmatched > 0) {
            toast.warning(
              `${r.einvoiceKeepUnmatched.toLocaleString('en-IN')} of the e-invoices planned to be left out ${r.einvoiceKeepUnmatched === 1 ? 'was' : 'were'} not found in the stored return, `
              + 'so the return changed after the plan. Pull e-invoices again and check the reconciliation before filing.',
              { duration: 20000 },
            );
          }
          const realErrors = filterRealErrors(r.errors);
          // Trust the extension's own accepted/partial call over the mere
          // presence of an errors array — GSTN's response can list every
          // record (with placeholder reasons for the accepted ones), so
          // "errors.length > 0" alone isn't a reliable partial signal. Only
          // fall back to counting real errors when status wasn't sent at all
          // (older extension builds).
          const isPartial = r.status ? r.status === 'partial' : realErrors.length > 0;
          if (isPartial) {
            toast.error(summary + ' Click "View errors" for details.');
          } else {
            toast.success(summary);
          }
          setUploadResult({ ok: !isPartial, message: summary, errors: realErrors });
          // Only a clean upload counts as 'Pushed', and the database records
          // it: the extension writes 'accepted' to the job's own gstr1_data
          // row and its trigger marks that client's return Pushed (a partial
          // upload is not). Marking it from here too stamped whichever client
          // this page showed when the result arrived.
          fetchFilingStatus();
        } else {
          const msg = r.error || r.message || 'Portal upload failed.';
          toast.error((wasNil ? 'NIL push failed: ' : 'Upload failed: ') + msg);
          setUploadResult({ ok: false, message: msg, errors: filterRealErrors(r.errors) });
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
  }, [fetchGSTR1Data, fetchVersions, fetchFilingStatus, fetchEinvoice, fetchEinvoiceEvidenceForClient, clients, selectedClient, selectedMonth, user?.id]);

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

      // Corrections with one right answer on the way in (tidyGstr1Json), and
      // Table 12 units as GSTN codes ("Others" → OTH, NA on services), so what
      // is stored, shown and pushed is what the portal takes.
      const tidy = tidyGstr1Json(json, { builder: isBuilderSourced(file.name) });
      const hsnFix = normaliseGstr1Hsn(tidy.json);
      json = hsnFix.json;

      // A file for another month is refused like one for another GSTIN: the
      // portal rejects it ("GSTIN or Return period mismatch"), it cannot be
      // filed for this one. Anything else the portal would refuse is fixable
      // here (manual entry grid, Edit HSN Summary), so it imports with a
      // warning and the upload blocks on it.
      const check = validateGstr1Json(json, { gstin: clientGstin, period: selectedMonth });
      const wrongPeriod = check.problems.find((p) => p.rule === 'fp');
      if (wrongPeriod) {
        throw new Error(`Return period mismatch — the file ${wrongPeriod.message}.`);
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

      // JSON+Manual clients may already have edited rows in gstr1_manual_entries
      // from a previous import. A fresh import replaces raw_json outright, so
      // stale manual-entry rows must go too — otherwise the entry grid keeps
      // showing the old edits instead of hydrating from the newly imported file.
      if (isJsonManualClient) {
        await supabase
          .from('gstr1_manual_entries' as any)
          .delete().eq('client_id', selectedClient).eq('period_month', periodMonthKey);
      }

      toast.success(`GSTR-1 JSON imported for ${periodMonthKey}.`);
      if (tidy.changed) toast.info(tidy.notes.join(' '), { duration: 12000 });
      if (hsnFix.changed) toast.info(describeHsnFixes(hsnFix), { duration: 12000 });
      if (hsnFix.problems.length) toast.warning(describeHsnProblems(hsnFix.problems), { duration: 15000 });
      if (check.problems.length) toast.warning(describeGstr1Issues(check.problems), { duration: 20000 });
      if (check.warnings.length) toast.warning(describeGstr1Issues(check.warnings), { duration: 15000 });
      await fetchGSTR1Data();
      await recordVersion({
        action_type: 'IMPORT',
        file_name: file.name,
        status: 'imported',
        summary: `Imported ${file.name}`,
        payload: json,
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
    const description = (isManualClient || isJsonManualClient)
      ? 'This removes the generated GSTR-1 data and every manually entered invoice row for this client and period.'
      : 'This removes the imported GSTR-1 data for this client and period.';
    if (!(await confirm({ title: 'Delete GSTR-1 data?', description, destructive: true, confirmText: 'Delete' }))) return;
    try {
      const { error } = await supabase.from('gstr1_data').delete().eq('id', gstr1Data.id);
      if (error) throw error;
      // Manual (and JSON+Manual) clients key invoices into gstr1_manual_entries,
      // a separate table from gstr1_data — deleting only the generated JSON left
      // those rows behind, so "Delete" then re-importing/re-entering silently
      // reloaded the old edited rows instead of starting fresh.
      if (isManualClient || isJsonManualClient) {
        const periodMonthKey = mmYyyyToShort(selectedMonth);
        const { error: entriesError } = await supabase
          .from('gstr1_manual_entries' as any)
          .delete().eq('client_id', selectedClient).eq('period_month', periodMonthKey);
        if (entriesError) throw entriesError;
      }
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
    // E-invoice client (§7), decided now: the evidence may still be loading,
    // be another client's, or have failed. It is read again unless the tick
    // or a successful read of the evidence for this client decides; if that
    // read fails too, a client that is not ticked is not pushed (it may
    // issue e-invoices, and the push would overwrite them). The gate applies
    // when the books have e-invoiceable documents: extension 0.8.7 or later,
    // and a pull taken today, read afresh (§4). Clients that are not
    // e-invoice clients go up exactly as before.
    const einvClient = await einvoiceClientNow(selectedClient);
    if (einvClient == null) {
      toast.error(EINV_EVIDENCE_FAILED, { duration: 15000 });
      return;
    }
    const einvApplies = einvClient && booksHaveEinvoiceable(extractDocs(gstr1Data.raw_json));
    let einvRecords: EinvoiceRecords | null = null;
    if (einvApplies) {
      if (!extVersion || compareVersions(extVersion, EINVOICE_MIN_EXTENSION) < 0) {
        toast.error(einvExtensionTooOldText(extVersion), { duration: 20000 });
        return;
      }
      try {
        einvRecords = await loadEinvoiceRecords(selectedClient, selectedMonth);
      } catch (err) {
        toast.error('Could not read the e-invoice records, so nothing was uploaded: ' + (err instanceof Error ? err.message : (err as { message?: string })?.message || String(err)));
        return;
      }
      setEinvoiceDocs(einvRecords.docs);
      setEinvoicePull(einvRecords.pull);
      setEinvoiceExcel(einvRecords.excel);
      // A pull saving its records now (its row says 'running', or this page
      // started one), or one that started or ended while they were read:
      // they may be half one pull's, so nothing is planned on them (§4.3, §8).
      if (isPullRunning(einvRecords.pull) || (isPullingEinv && !isExcelFresh(einvRecords.excel))) {
        toast.error(einvPullRunningText(einvRecords.pull), { duration: 20000 });
        return;
      }
      if (einvRecords.pullMoved) {
        toast.error(EINV_PULL_MOVED, { duration: 20000 });
        fetchEinvoice();
        return;
      }
      if (!einvPlanBasis(einvRecords.pull, einvRecords.excel)) {
        toast.error(einvNotFreshText(einvRecords.pull, einvRecords.excel), { duration: 20000 });
        return;
      }
    }
    // Check the stored return, not only this page's copy: the extension pushes
    // the stored row, and the Table 12 correction below writes this copy back.
    // If another tab or a colleague saved the return since the page loaded,
    // reload it and let the user look again rather than overwrite their work.
    // Its updated_at is the version the e-invoice plan rests on: extension
    // 0.8.7 refuses the push if the stored row has changed since (§1).
    const { data: stored, error: readError } = await supabase
      .from('gstr1_data').select('raw_json, updated_at').eq('id', gstr1Data.id).maybeSingle();
    if (readError || !stored) {
      toast.error('Could not read the stored return, so nothing was uploaded: ' + (readError?.message || 'it is no longer there.'));
      return;
    }
    if (JSON.stringify(stored.raw_json) !== JSON.stringify(gstr1Data.raw_json)) {
      setUploadDialogOpen(false);
      await fetchGSTR1Data();
      toast.warning('This return was changed elsewhere since the page loaded (another tab or a colleague). It has been reloaded: check it and click Upload again.', { duration: 12000 });
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
    // The return period (fp) is checked by the validator below, and blocks:
    // the portal rejects a file for another month as "GSTIN or Return period
    // mismatch", it does not file it for this one.
    //
    // An empty file is rejected as "No section data". A NIL period has its
    // own push, which needs no JSON.
    if (!gstr1HasSectionData(gstr1Data.raw_json)) {
      toast.error(isNilReturn
        ? 'This JSON has no section data, which the portal rejects ("No section data"). The period is ticked NIL: use Push NIL, which needs no JSON.'
        : 'This JSON has no section data, which the portal rejects ("No section data"). Import the return again, or, if the period had no activity, tick "NIL Return" and use Push NIL.');
      setUploadDialogOpen(false);
      return;
    }
    // Documents Issued (Table 13) can't be derived from invoice content — it's
    // about serial-number continuity, including cancelled numbers — so it is
    // never auto-filled by import or by Builder Returns. Require it by hand
    // before every push, unless the period is explicitly marked NIL.
    const doc_det = gstr1Data.raw_json?.doc_issue?.doc_det;
    if (!isNilReturn && (!Array.isArray(doc_det) || doc_det.length === 0)) {
      toast.error(
        'Documents Issued (Table 13) is empty. Enter it in the manual entry grid before uploading — it is never '
        + 'prefilled — or tick "NIL Return" above if this period had no activity.'
      );
      return;
    }

    // Corrections with one right answer, saved before the push (the extension
    // uploads the stored row, so this covers JSONs imported before these
    // checks existed). tidyGstr1Json: blank shipping bill fields left out,
    // Table 13 one entry per document type with net issued = total less
    // cancelled, a Builder Table 12 moved to hsn_b2c. normaliseGstr1Hsn:
    // Table 12 units, which the portal rejects outside GSTN's list ("Others",
    // "PCS-PIECES": RET191353), any unit but NA on a service, a quantity on a
    // service (RET191355) and a repeated HSN + rate + unit. Stop on what
    // needs a person.
    const tidy = tidyGstr1Json(gstr1Data.raw_json, { builder: isBuilderSourced(gstr1Data.file_name) });
    const hsnFix = normaliseGstr1Hsn(tidy.json);
    if (hsnFix.problems.length) {
      toast.error(describeHsnProblems(hsnFix.problems), { duration: 15000 });
      setUploadDialogOpen(false);
      return;
    }
    let draftJson = gstr1Data.raw_json;
    let basisUpdatedAt: string | null = stored.updated_at ?? null;
    if (tidy.changed || hsnFix.changed) {
      const { data: saved, error: saveError } = await supabase
        .from('gstr1_data')
        .update({ raw_json: hsnFix.json, updated_at: new Date().toISOString() })
        .eq('id', gstr1Data.id)
        .select('id, updated_at');
      if (saveError || !saved || saved.length === 0) {
        toast.error('Could not save the corrections for the portal, so nothing was uploaded: ' + (saveError?.message || 'the database returned no row.'));
        return;
      }
      draftJson = hsnFix.json;
      basisUpdatedAt = saved[0].updated_at ?? null;
      const fixes = [...tidy.notes, ...(hsnFix.changed ? [describeHsnFixes(hsnFix)] : [])].join(' ');
      toast.info(fixes, { duration: 12000 });
      await recordVersion({ action_type: 'IMPORT', status: 'edited', summary: `Corrected for the portal before upload: ${fixes}`, payload: hsnFix.json });
      await fetchGSTR1Data();
    }

    // Every other rule GSTN enforces on a GSTR-1 (src/lib/gstr1/validate.ts):
    // a fault found here would come back as "File could not be uploaded!" or
    // a partial upload with no reason captured. Warnings are points to check.
    const check = validateGstr1Json(draftJson, { gstin: clientGstin, period: selectedMonth, nil: isNilReturn });
    if (check.problems.length) {
      toast.error(describeGstr1Issues(check.problems), { duration: 20000 });
      setUploadDialogOpen(false);
      return;
    }
    if (check.warnings.length) toast.warning(describeGstr1Issues(check.warnings), { duration: 15000 });

    // E-invoices (§1, §4): the plan, on the JSON the extension will upload and
    // the records just read. Changed after IRN and number differs block; so
    // do documents whose e-invoice is pending auto-population, unless every
    // one of them was ticked in the dialog to go up without its IRN. The rest
    // of the plan names, by exact identity, the documents to leave out so the
    // portal keeps its own record with the IRN. basisUpdatedAt is the stored
    // row's version the plan was made on. An e-invoice client with no
    // e-invoiceable document sends an empty plan, recorded as 0.
    let einvoicePlan: { keep: EinvUploadPlan['keep']; planAt: string; basisUpdatedAt: string | null } | null = null;
    let pendingOverridden: EinvRecoRow[] = [];
    if (einvApplies && einvRecords) {
      const plan = planEinvoiceUpload(reconcileEinvoice(extractDocs(draftJson), einvRecords.docs, { pulledAt: successfulPullAt(einvRecords.pull) }));
      if (plan.blockers.length) {
        toast.error(einvBlockersText(plan.blockers), { duration: 20000 });
        return;
      }
      const ticked = new Set(einvPendingAck || []);
      const unticked = plan.pendingBlockers.filter((r) => !ticked.has(r.key));
      if (unticked.length) {
        toast.error(einvPendingText(unticked), { duration: 20000 });
        return;
      }
      pendingOverridden = plan.pendingBlockers;
      einvoicePlan = { keep: plan.keep, planAt: new Date().toISOString(), basisUpdatedAt };
    } else if (einvClient) {
      einvoicePlan = { keep: [], planAt: new Date().toISOString(), basisUpdatedAt };
    }

    // Advance set-off. Last of the pre-flight checks and the only one that can
    // be passed with a manager's recorded approval rather than a correction —
    // every other failure above is unambiguous, this one has genuine
    // exceptions (§6).
    const advanceOk = await advanceGate.evaluate({
      clientId: selectedClient,
      clientName: clients.find((c) => c.id === selectedClient)?.name || '',
      gstin: clientGstin,
      periodMonth: selectedMonth,
      draftJson,
      regularSubType: clients.find((c) => c.id === selectedClient)?.regular_sub_type,
      registrationType: clients.find((c) => c.id === selectedClient)?.registration_type,
    });
    if (!advanceOk) {
      setUploadDialogOpen(false);
      return;
    }

    // The pull the plan rests on must still be the last one: read its row
    // again now, after the records and every check above (which can wait on
    // a manager). A pull that started (status 'running') or ended since
    // changed it, and the plan may rest on records it has replaced (§4.3, §8).
    if (einvApplies && einvRecords) {
      let pullNow: EinvoicePullRow | null;
      try {
        pullNow = await readEinvoicePull(selectedClient, selectedMonth);
      } catch (err) {
        toast.error('Could not check the e-invoice pull again, so nothing was uploaded: ' + (err instanceof Error ? err.message : (err as { message?: string })?.message || String(err)));
        return;
      }
      if (isPullRunning(pullNow) || !samePull(einvRecords.pull, pullNow)) {
        toast.error(isPullRunning(pullNow) ? einvPullRunningText(pullNow) : EINV_PULL_MOVED, { duration: 20000 });
        fetchEinvoice();
        return;
      }
    }

    // The override goes on record on this push's UPLOAD row: the first one
    // after the newest version now (the corrections above wrote theirs).
    einvOverrideRef.current = null;
    if (pendingOverridden.length) {
      const periodShort = mmYyyyToShort(selectedMonth);
      const { data: lastV } = await supabase
        .from('gstr1_upload_versions')
        .select('version_number')
        .eq('client_id', selectedClient)
        .eq('period_month', periodShort)
        .order('version_number', { ascending: false })
        .limit(1);
      const afterVersion = lastV?.[0]?.version_number
        ?? versions.reduce((m, v) => Math.max(m, v.version_number || 0), 0);
      einvOverrideRef.current = {
        clientId: selectedClient, periodMonth: selectedMonth, periodShort, afterVersion, note: einvPendingOverrideNote(pendingOverridden),
      };
    }

    setIsUploading(true);
    setUploadResult(null);
    setUploadDialogOpen(false);
    einvPlanSentRef.current = !!einvoicePlan;
    window.postMessage(
      {
        __gstkUploadGstr1: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
          // 0.8.7: documents to leave out so the portal keeps their IRN, and
          // the stored row's updated_at the plan was made on.
          ...(einvoicePlan ? { einvoice: einvoicePlan } : {}),
        },
      },
      '*'
    );
    toast.info(
      'Opening the GST portal in a new tab — clear the CAPTCHA and let the upload run. Progress will appear here.'
      + (einvoicePlan && einvoicePlan.keep.length
        ? ` ${einvoicePlan.keep.length.toLocaleString('en-IN')} e-invoice${einvoicePlan.keep.length === 1 ? '' : 's'} will be left out so the portal keeps ${einvoicePlan.keep.length === 1 ? 'its' : 'their'} IRN.`
        : '')
      + (pendingOverridden.length
        ? ` ${pendingOverridden.length.toLocaleString('en-IN')} document${pendingOverridden.length === 1 ? '' : 's'} pending auto-population will be uploaded without ${pendingOverridden.length === 1 ? 'its' : 'their'} IRN, as you chose; Version History records it.`
        : ''),
    );
  };

  // NIL return: no JSON is needed. The extension opens the period's GSTR-1,
  // ticks the portal's "File Nil GSTR-1" option and confirms; filing / signing
  // stays manual. None of the JSON pre-flight checks (GSTIN, fp, Table 13,
  // advance set-off) apply — there is no JSON.
  const handlePushNil = () => {
    if (!selectedClient || !selectedMonth) return;
    if (!isNilReturn) {
      toast.error('Tick "NIL Return" first — only a NIL period can be pushed without a JSON.');
      setNilDialogOpen(false);
      return;
    }
    if (isFiled) {
      toast.error('GSTR-1 for this period is already Filed — portal push is locked.');
      setNilDialogOpen(false);
      return;
    }
    if (extVersion && compareVersions(extVersion, NIL_PUSH_MIN_EXTENSION) < 0) {
      // 0.8.3 and older ignore the NIL flag and look for a stored JSON, so the
      // push never reaches the portal and is never recorded as Pushed.
      toast.error(`The browser extension is v${extVersion}; NIL push needs v${NIL_PUSH_MIN_EXTENSION} or later. Load the updated extension (chrome://extensions → Reload) and try again.`);
      setNilDialogOpen(false);
      return;
    }
    if (!extReady) {
      toast.error('Install / enable the GST Keeper browser extension to push from this page.');
      return;
    }
    nilPushRef.current = true;
    setIsUploading(true);
    setUploadResult(null);
    setNilDialogOpen(false);
    window.postMessage(
      {
        __gstkUploadGstr1: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
          nil: true,
        },
      },
      '*'
    );
    toast.info('Opening the GST portal in a new tab — clear the CAPTCHA and let the NIL marking run. Progress will appear here.');
  };

  // E-invoice pull: the extension downloads this period's GSTR-1 from the
  // portal and upserts its IRN-bearing documents into einvoice_docs (and the
  // outcome into einvoice_pulls). This page just re-reads them on completion.
  const handlePullEinvoice = () => {
    if (!selectedClient || !selectedMonth) return;
    if (!extReady) {
      toast.error('Install / enable the GST Keeper browser extension to pull e-invoices.');
      return;
    }
    if (!extVersion || compareVersions(extVersion, EINVOICE_MIN_EXTENSION) < 0) {
      // 0.8.4 to 0.8.6 save e-invoices on the old record key, which the
      // database no longer has, so their pull fails and saves nothing; 0.8.3
      // and older have no pull at all.
      toast.error(
        `The browser extension is ${extVersion ? `v${extVersion}` : 'an older version'}; the e-invoice pull needs v${EINVOICE_MIN_EXTENSION} or later. `
        + 'Older copies save e-invoices on the old record key, so their pull fails and saves nothing. '
        + 'Load the updated extension (chrome://extensions → Reload) and try again.',
        { duration: 15000 },
      );
      return;
    }
    setIsPullingEinv(true);
    window.postMessage(
      {
        __gstkPullEinvoice: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
        },
      },
      '*'
    );
    toast.info('Pulling e-invoices from the GST portal — clear the CAPTCHA in the new tab if asked.');
  };

  // E-invoice Excel (§6): the GSTR-1 dashboard's "Download details from
  // e-invoices (Excel)", or the ZIP the portal gives for more than 500
  // documents. Checked against this client's GSTIN and this month, confirmed
  // with its counts, then it replaces the period's earlier Excel records (the
  // pull's records are untouched).
  const handleImportEinvoiceExcelClick = () => {
    if (!selectedClient || !selectedMonth) {
      toast.error('Please select a client and month first');
      return;
    }
    einvExcelInputRef.current?.click();
  };

  const handleEinvoiceExcelChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedClient || !selectedMonth) return;
    const clientId = selectedClient;
    const periodMonth = selectedMonth;
    const client = clients.find((c) => c.id === clientId);
    const label = mmYyyyToShort(periodMonth);
    const n = (x: number) => x.toLocaleString('en-IN');
    setIsImportingEinvExcel(true);
    try {
      const files = await readEinvoiceExcelFile(file);
      const parsed = parseEinvoiceExcelFiles(files, client?.gstin || null);
      const wrong = einvoiceExcelMismatch(parsed.metas, { gstin: client?.gstin || '', periodMonth, label });
      if (wrong) {
        toast.error(wrong, { duration: 15000 });
        return;
      }
      if (parsed.docs.length === 0 && parsed.cancelled === 0) {
        const why = parsed.sheetsSkipped.map((x) => `${x.sheet}: ${x.reason}`).join('; ');
        toast.error(`No e-invoice could be read from ${file.name}, so nothing was imported.${why ? ` ${why}.` : ''}`, { duration: 15000 });
        return;
      }
      const updated = parsed.metas.map((m) => m.meta.updated_till).filter(Boolean).join(', ');
      const ok = await confirm({
        title: `Import the e-invoice Excel for ${client?.name || 'this client'} · ${label}?`,
        description: (
          <span className="block space-y-1.5 text-sm">
            <span className="block">
              {file.name}{updated ? ` (updated till ${updated})` : ''}. It replaces this period&apos;s earlier e-invoice Excel records
              {einvoiceExcel ? ` (imported ${fmtEinvWhen(einvoiceExcel.pulled_at)})` : ''}; the pulled records stay.
            </span>
            <span className="block font-medium text-foreground">{n(parsed.docs.length)} document{parsed.docs.length === 1 ? '' : 's'} to save</span>
            <span className="block">{n(parsed.cancelled)} with a cancelled IRN, skipped</span>
            <span className="block">{n(parsed.pending)} pending auto-population</span>
            <span className="block">{n(parsed.failed)} where auto-population failed</span>
            <span className="block">
              {n(parsed.sheetsSkipped.length)} sheet{parsed.sheetsSkipped.length === 1 ? '' : 's'} skipped
              {parsed.sheetsSkipped.length ? `: ${parsed.sheetsSkipped.map((x) => `${x.sheet} (${x.reason})`).join('; ')}` : ''}
            </span>
            {parsed.rowsSkipped.length > 0 && (
              <span className="block">
                {n(parsed.rowsSkipped.length)} row{parsed.rowsSkipped.length === 1 ? '' : 's'} not read:{' '}
                {parsed.rowsSkipped.slice(0, 5).map((x) => `${x.sheet} row ${x.row} (${x.reason})`).join('; ')}
                {parsed.rowsSkipped.length > 5 ? `; and ${n(parsed.rowsSkipped.length - 5)} more` : ''}
              </span>
            )}
          </span>
        ),
        confirmText: 'Import',
      });
      if (!ok) return;
      const message = `${n(parsed.docs.length)} e-invoice(s) from ${file.name}: ${n(parsed.cancelled)} cancelled skipped, `
        + `${n(parsed.pending)} pending, ${n(parsed.failed)} failed, ${n(parsed.sheetsSkipped.length)} sheet(s) and ${n(parsed.rowsSkipped.length)} row(s) skipped.`;
      const { inserted } = await saveEinvoiceExcelImport({ clientId, periodMonth, actorId: user?.id ?? null, docs: parsed.docs, message });
      toast.success(`E-invoice Excel imported — ${n(inserted)} document${inserted === 1 ? '' : 's'} for ${client?.name || 'the client'} · ${label}.`);
      if (parsed.failed) toast.warning(`${n(parsed.failed)} e-invoice${parsed.failed === 1 ? '' : 's'} failed auto-population: ${parsed.failed === 1 ? 'that document goes' : 'those documents go'} up from the books without the IRN.`, { duration: 15000 });
    } catch (err) {
      toast.error('Could not import the e-invoice Excel: ' + (err instanceof Error ? err.message : (err as { message?: string })?.message || String(err)), { duration: 15000 });
    } finally {
      setIsImportingEinvExcel(false);
      // Re-read whatever happened, so the panel and the upload dialog never
      // show records that are gone (the import replaces them in one
      // transaction, so a failure leaves the earlier set). Only if the page
      // still shows that return: the import can outlast a change of client or
      // month, and this closure's fetchers would load the old one's records
      // over the new one's.
      if (selectionRef.current.client === clientId && selectionRef.current.month === periodMonth) {
        fetchEinvoice();
        fetchEinvoiceEvidenceForClient();
      }
    }
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
      const rawRows = parseGstnErrorReport(obj);
      // Some GSTN error reports list every submitted record, not just the
      // rejected ones — accepted records carry placeholder reasons like
      // "NA NA NA" rather than a real message. Strip those before deciding
      // whether this report actually contains any errors.
      const rows = filterRealErrors(rawRows);
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
      let summary: string;
      let status: 'accepted' | 'partial';
      if (rows.length > 0) {
        summary = `Parsed ${rows.length} per-invoice validation error(s) from imported Error Report.`;
        status = 'partial';
      } else if (rawRows.length > 0) {
        summary = 'Error Report parsed — no genuine validation errors found (all listed rows were accepted/placeholder entries).';
        status = 'accepted';
      } else {
        summary = 'No per-invoice errors found in the imported Error Report file (structure may differ from expected).';
        status = 'partial';
      }
      // Persist so the "View errors" button + the sidebar indicator survive a refresh.
      const { error } = await supabase
        .from('gstr1_data')
        .update({
          last_upload_status: status,
          last_upload_summary: summary,
          last_upload_errors: rows as any,
          last_uploaded_at: gstr1Data.last_uploaded_at || new Date().toISOString(),
        })
        .eq('id', gstr1Data.id);
      if (error) throw error;
      setUploadResult({ ok: status === 'accepted', message: summary, errors: rows });
      setErrorsDialogOpen(true);
      await fetchGSTR1Data();
      await recordVersion({
        action_type: 'REFRESH_ERRORS',
        file_name: file.name,
        status,
        summary,
        errors: rows,
        // The return's data is untouched by an error-report fetch — carrying
        // the current JSON keeps the diff chain unbroken across this entry.
        payload: gstr1Data.raw_json,
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
  const handleDownloadJson = async () => {
    if (!gstr1Data?.raw_json) {
      toast.error('No GSTR-1 JSON to download.');
      return;
    }
    const clientId = selectedClient;
    const periodMonth = selectedMonth;
    // E-invoice client (§7), as the push decides it: a failed evidence read
    // is read again, and a client that is not ticked is refused while it
    // still fails (the file would carry every e-invoice).
    const einvClient = clientId ? await einvoiceClientNow(clientId) : false;
    if (einvClient == null) {
      toast.error(EINV_EVIDENCE_FAILED.replace('uploaded', 'downloaded'), { duration: 15000 });
      return;
    }
    // Its e-invoice records, read afresh like the push's.
    let einvRecords: EinvoiceRecords | null = null;
    if (einvClient && clientId && periodMonth) {
      try {
        einvRecords = await loadEinvoiceRecords(clientId, periodMonth);
      } catch (err) {
        toast.error('Could not read the e-invoice records, so nothing was downloaded: ' + (err instanceof Error ? err.message : (err as { message?: string })?.message || String(err)));
        return;
      }
      if (selectionRef.current.client !== clientId || selectionRef.current.month !== periodMonth) return;
      setEinvoiceDocs(einvRecords.docs);
      setEinvoicePull(einvRecords.pull);
      setEinvoiceExcel(einvRecords.excel);
      // As for the push: never on records a pull is saving, or that a pull
      // changed while they were read (§4.3, §8).
      if (isPullingEinv || isPullRunning(einvRecords.pull)) {
        toast.error(einvPullRunningText(einvRecords.pull).replace('then push', 'then download again'), { duration: 20000 });
        return;
      }
      if (einvRecords.pullMoved) {
        toast.error('A pull of e-invoices saved new records while they were being read, so nothing was downloaded. Download again.', { duration: 20000 });
        fetchEinvoice();
        return;
      }
    }
    // Strip this app's own provenance fields (_source/_generated_at) — the
    // portal's upload schema doesn't recognise them, and a strict validator
    // rejects the whole file over one unexpected key. The same corrections
    // the push applies (tidyGstr1Json, and Table 12 units as GSTN codes), so
    // a file uploaded by hand on the portal isn't rejected (RET191353) either.
    const tidy = tidyGstr1Json(stripInternalFields(gstr1Data.raw_json), { builder: isBuilderSourced(gstr1Data.file_name) });
    const hsnFix = normaliseGstr1Hsn(tidy.json);
    let portalJson: unknown = hsnFix.json;
    // An e-invoice client's file leaves out, like the push, the documents the
    // portal already holds as e-invoices (§1): uploaded by hand, a copy would
    // overwrite the e-invoice and drop its IRN. It plans on whatever records
    // there are, even without a pull today (leaving out nothing would wipe
    // every auto-populated IRN), and the toast says on what evidence (§5, Download JSON).
    let einvLeftOut: { removed: number; byPull: number; byExcel: number; byBooksIrn: number; fresh: boolean; pulledAt: string | null; pull: EinvoicePullRow | null } | null = null;
    let einvFileWarnings: string[] = [];
    if (einvRecords) {
      const pulledAt = successfulPullAt(einvRecords.pull);
      const rows = reconcileEinvoice(extractDocs(portalJson), einvRecords.docs, { pulledAt });
      const plan = planEinvoiceUpload(rows);
      const res = leaveOutKept(portalJson, plan.keep);
      portalJson = res.json;
      const kept = rows.filter((r) => r.books && (r.status === 'matched' || r.status === 'books_irn'));
      einvLeftOut = {
        removed: res.removed,
        byBooksIrn: kept.filter((r) => r.status === 'books_irn').length,
        byExcel: kept.filter((r) => r.status === 'matched' && r.einv?.source === 'einvoice_excel').length,
        byPull: kept.filter((r) => r.status === 'matched' && r.einv?.source !== 'einvoice_excel').length,
        fresh: isPullFresh(einvRecords.pull),
        pulledAt,
        pull: einvRecords.pull,
      };
      if (plan.blockers.length) toast.warning(`${einvBlockersText(plan.blockers)} The file carries ${plan.blockers.length === 1 ? 'it' : 'them'} as in the books.`, { duration: 20000 });
      const n = (x: number) => x.toLocaleString('en-IN');
      const w = plan.warnings;
      einvFileWarnings = [
        plan.pendingBlockers.length > 0
          && `${n(plan.pendingBlockers.length)} document${plan.pendingBlockers.length === 1 ? '' : 's'} whose e-invoice is pending auto-population ${plan.pendingBlockers.length === 1 ? 'is' : 'are'} in the file: uploaded, ${plan.pendingBlockers.length === 1 ? 'its' : 'their'} IRN will not be linked (GSTN para 3(c)). To keep it, pull again once the portal shows ${plan.pendingBlockers.length === 1 ? 'it' : 'them'} and download again.`,
        w.pending.length > 0 && einvPendingNotInBooksText(w.pending.length),
        w.missingFromReturn.length > 0 && einvMissingFromReturnText(w.missingFromReturn.length),
        plan.warnings.shippingBill.length > 0
          && `${n(plan.warnings.shippingBill.length)} export${plan.warnings.shippingBill.length === 1 ? '' : 's'} left out to keep the IRN ${plan.warnings.shippingBill.length === 1 ? 'has' : 'have'} a shipping bill in the books that the e-invoice lacks: add it on the portal or through Table 9A.`,
      ].filter(Boolean) as string[];
    }
    const blob = new Blob([JSON.stringify(portalJson)], { type: 'application/json' });
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
    if (einvLeftOut && einvRecords && booksHaveEinvoiceable(extractDocs(gstr1Data.raw_json))) {
      // Exactly what was left out, and on whose word (§5, Download JSON).
      const { removed, byPull, byExcel, byBooksIrn, fresh, pulledAt, pull } = einvLeftOut;
      const n = (x: number) => x.toLocaleString('en-IN');
      const docs = (x: number) => `${n(x)} document${x === 1 ? '' : 's'}`;
      // The pull's records: today's pull, the last successful one, or (when
      // the last attempt failed or served an old file) an earlier one.
      const pullWord = fresh ? `today's pull${pulledAt ? ` of ${fmtEinvWhen(pulledAt)}` : ''}`
        : pulledAt ? `the last pull, of ${fmtEinvWhen(pulledAt)}` : 'an earlier pull';
      const evidence = [
        byPull > 0 && `${pullWord} (${n(byPull)})`,
        byExcel > 0 && `the e-invoice Excel (${n(byExcel)})`,
        byBooksIrn > 0 && `the IRN in the books JSON (${n(byBooksIrn)})`,
      ].filter(Boolean).join(', ');
      // Why no pull of the day backs the file, in the pull's own terms: none,
      // not today, an old file served today, or not finished (§4.3).
      const why = !pull ? 'E-invoices have not been pulled for this period.'
        : pull.status === 'ok' || pull.status === 'none' ? `E-invoices were not pulled today (the last pull was ${fmtEinvWhen(pull.pulled_at)}).`
          : einvPullWhy(pull);
      // A stale pull's words already give the steps to a fresh file.
      const pullAgain = pull?.status === 'stale'
        ? 'Download again after that pull, before uploading the file on the portal.'
        : 'Pull e-invoices and download again before uploading it on the portal.';
      if (fresh) {
        toast.info(removed
          ? `${docs(removed)} left out of the file so the portal keeps ${removed === 1 ? 'its' : 'their'} IRN, on the word of ${evidence}.`
          : `Nothing left out of the file: today's pull${pulledAt ? ` of ${fmtEinvWhen(pulledAt)}` : ''} showed no document of the books on the portal's draft as an e-invoice.`,
        { duration: 15000 });
      } else if (removed) {
        toast.warning(
          `${why} The file leaves out ${docs(removed)} on the word of ${evidence}. A document edited or deleted `
          + `on the portal since would be missing from the return. ${pullAgain}`,
          { duration: 25000 },
        );
      } else {
        toast.warning(
          `${why} The file leaves nothing out: uploaded on the portal, it would overwrite every e-invoice `
          + `already there and drop its IRN. ${pullAgain}`,
          { duration: 25000 },
        );
      }
      if (einvFileWarnings.length) toast.warning(einvFileWarnings.join(' '), { duration: 25000 });
    }
    if (tidy.changed) toast.info(`${tidy.notes.join(' ')} (in the downloaded file; the saved return is corrected when you upload)`, { duration: 12000 });
    if (hsnFix.changed) toast.info(`${describeHsnFixes(hsnFix)} (in the downloaded file; the saved return is corrected when you upload)`, { duration: 12000 });
    if (hsnFix.problems.length) toast.warning(describeHsnProblems(hsnFix.problems), { duration: 15000 });
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
  const footTd = `${WS_TD_NUM} font-semibold`;

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

  // B2CSA — Table 10 amendments: `omon`, the original month being amended,
  // which is the whole point of the table. The portal shape (Builder Returns
  // writes it) is one entry per month and POS with its rate lines in itms[];
  // older rows are flat, one per rate, and read as their own single line.
  const b2csaRows = useMemo(() => {
    type Line = { rt?: number; txval?: number; iamt?: number; camt?: number; samt?: number; csamt?: number };
    return (json.b2csa || []).flatMap((a: any) => ((Array.isArray(a.itms) && a.itms.length ? a.itms : [a]) as Line[]).map((l) => ({
      pos: a.pos, typ: a.typ, omon: a.omon, rt: l.rt,
      txval: l.txval, iamt: l.iamt, camt: l.camt, samt: l.samt, csamt: l.csamt,
    })));
  }, [json.b2csa]);

  // A document's own value (`val`, incl. tax) repeats on every item line of
  // a multi-rate document, so the Value footer sums it once per document.
  const sumDocVal = (rows: any[], key: (r: any) => string): number => {
    const seen = new Set<string>();
    return rows.reduce((t, r) => {
      const k = key(r);
      if (seen.has(k)) return t;
      seen.add(k);
      return t + (Number(r.val) || 0);
    }, 0);
  };

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
            ntTyp: nt.ntty ?? nt.typ,
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
          ntTyp: nt.ntty ?? nt.typ,
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
      ? json.hsn.data.map((item: any) => ({ ...item, _src: 'hsn_b2b' }))
      : [
          ...(json.hsn?.hsn_b2b || []).map((item: any) => ({ ...item, _src: 'hsn_b2b' })),
          ...(json.hsn?.hsn_b2c || []).map((item: any) => ({ ...item, _src: 'hsn_b2c' })),
        ];
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
      _src: item._src,
    }));
  }, [json.hsn]);

  // NIL data
  const nilData = useMemo(() => {
    return json.nil || {};
  }, [json.nil]);

  // AT / TXPD (Advances and their adjustment) and the two Table 11(2)
  // amendment sections. One group can carry several rate lines — a POS with
  // both an 18% and a 12% advance is one group with two `itms`. Flatten every
  // rate line into its own row, the same way b2b/b2cl/cdnr are flattened.
  // Reading only itms[0] (as this did) silently dropped every rate but the
  // first, so the table footer disagreed with the tile and with
  // buildGstr1Summary, which has always summed all of them.
  const flattenAdvanceGroups = (groups: any[], withOmon: boolean) => {
    const rows: any[] = [];
    (groups || []).forEach((group: any) => {
      // Tolerate a flat, itms-less shape too — some older stored rows carry
      // the rate line directly on the group.
      const itms = Array.isArray(group.itms) && group.itms.length ? group.itms : [group];
      itms.forEach((itm: any) => {
        rows.push({
          ...(withOmon ? { omon: group.omon } : {}),
          pos: group.pos,
          sply_ty: group.sply_ty,
          rt: itm.rt,
          ad_amt: itm.ad_amt,
          iamt: itm.iamt,
          camt: itm.camt,
          samt: itm.samt,
          csamt: itm.csamt,
        });
      });
    });
    return rows;
  };

  const atRows = useMemo(() => flattenAdvanceGroups(json.at, false), [json.at]);
  const txpdRows = useMemo(() => flattenAdvanceGroups(json.txpd, false), [json.txpd]);
  // Table 11(2) — amendments to an earlier period's 11A / 11B. `omon` (the
  // original month) is the first column because it is what gives the row its
  // meaning; see docs/ADVANCE_SETOFF_POSITIONS.md §7.
  const ataRows = useMemo(() => flattenAdvanceGroups(json.ata, true), [json.ata]);
  const txpdaRows = useMemo(() => flattenAdvanceGroups(json.txpda, true), [json.txpda]);

  // DOC data. The portal JSON keys each group by "doc_num" (a serial code for
  // the document type, e.g. 1 = Invoices for outward supply) and doesn't
  // repeat the type label — look it up from DOC_TYPES for display/editing.
  const docRows = useMemo(() => {
    const rows: any[] = [];
    (json.doc_issue?.doc_det || []).forEach((doc: any) => {
      const typLabel = doc.doc_typ || DOC_TYPES.find((d) => d.doc_num === doc.doc_num)?.value || '';
      (doc.docs || []).forEach((d: any) => {
        rows.push({
          doc_num: doc.doc_num,
          doc_typ: typLabel,
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

  // --- HSN (Table 12) manual correction ---
  const startHsnEdit = () => {
    // Units as GSTN codes, so the picker shows them; a value GSTN doesn't know stays, shown as "choose".
    setHsnEditRows(hsnRows.map((r, i) => ({ ...r, uqc: editableUqc(r.uqc, r.hsn_sc), _id: i })));
    setHsnEditMode(true);
  };
  const cancelHsnEdit = () => { setHsnEditMode(false); setHsnEditRows([]); };
  const updateHsnCell = (id: number, field: string, value: any) =>
    setHsnEditRows((prev) => prev.map((r) => (r._id === id ? { ...r, [field]: value } : r)));
  const addHsnRow = () =>
    setHsnEditRows((prev) => [
      ...prev,
      { _id: (prev.at(-1)?._id ?? -1) + 1, _src: 'hsn_b2b', hsn_sc: '', desc: '', uqc: '', qty: 0, rt: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    ]);
  const removeHsnRow = (id: number) => setHsnEditRows((prev) => prev.filter((r) => r._id !== id));
  // Merge rows sharing the same HSN code + rate + UQC + Type (B2B vs Other)
  // into one summed row. Table 12 is meant to have exactly one row per
  // unique HSN+rate+UQC — Tally exports (and manual edits, e.g. correcting
  // an invalid UQC on several rows to the same value) can leave duplicates,
  // which the portal may reject as separate conflicting entries. _src is
  // part of the merge key because hsn_b2b/hsn_b2c are genuinely different
  // portal JSON buckets — merging across them would silently reclassify
  // supplies, not just consolidate a duplicate.
  const mergeDuplicateHsnRows = () => {
    setHsnEditRows((prev) => {
      const groups = new Map<string, any[]>();
      prev.forEach((r) => {
        const unit = normaliseUqc(r.uqc, r.hsn_sc) ?? String(r.uqc || '').trim().toUpperCase();
        const key = [String(r.hsn_sc || '').trim().toUpperCase(), String(Number(r.rt) || 0), unit, r._src || 'hsn_b2b'].join('|');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      });
      let mergedCount = 0;
      const merged = Array.from(groups.values()).map((rows) => {
        if (rows.length === 1) return rows[0];
        mergedCount += rows.length - 1;
        const num = (v: any) => Number(v) || 0;
        return {
          ...rows[0],
          desc: rows.find((r) => (r.desc || '').trim())?.desc || rows[0].desc,
          qty: rows.reduce((s, r) => s + num(r.qty), 0),
          txval: rows.reduce((s, r) => s + num(r.txval), 0),
          iamt: rows.reduce((s, r) => s + num(r.iamt), 0),
          camt: rows.reduce((s, r) => s + num(r.camt), 0),
          samt: rows.reduce((s, r) => s + num(r.samt), 0),
          csamt: rows.reduce((s, r) => s + num(r.csamt), 0),
        };
      });
      if (mergedCount > 0) toast.success(`Merged ${mergedCount} duplicate row(s) — ${merged.length} unique HSN + rate + UQC row(s) remain.`);
      else toast.info('No duplicate HSN + rate + UQC rows found.');
      return merged;
    });
  };
  const saveHsnEdits = async () => {
    if (!gstr1Data) return;
    setIsSavingHsn(true);
    try {
      const buckets: Record<string, any[]> = { hsn_b2b: [], hsn_b2c: [] };
      hsnEditRows
        .filter((r) => String(r.hsn_sc || '').trim())
        .forEach((r) => {
          const bucket = r._src === 'hsn_b2c' ? 'hsn_b2c' : 'hsn_b2b';
          buckets[bucket].push({
            num: buckets[bucket].length + 1,
            hsn_sc: String(r.hsn_sc).trim(),
            desc: r.desc || '',
            uqc: r.uqc || '',
            qty: Number(r.qty) || 0,
            rt: Number(r.rt) || 0,
            txval: Number(r.txval) || 0,
            iamt: Number(r.iamt) || 0,
            camt: Number(r.camt) || 0,
            samt: Number(r.samt) || 0,
            csamt: Number(r.csamt) || 0,
          });
        });
      const edited = { ...json };
      if (buckets.hsn_b2b.length || buckets.hsn_b2c.length) {
        edited.hsn = {};
        if (buckets.hsn_b2b.length) edited.hsn.hsn_b2b = buckets.hsn_b2b;
        if (buckets.hsn_b2c.length) edited.hsn.hsn_b2c = buckets.hsn_b2c;
      } else {
        delete edited.hsn;
      }
      // Same rules the push applies: GSTN units, NA and qty 0 on services, one row per HSN + rate + unit.
      const hsnFix = normaliseGstr1Hsn(edited);
      if (hsnFix.problems.length) {
        toast.error(describeHsnProblems(hsnFix.problems, ''), { duration: 15000 });
        return;
      }
      const newJson = hsnFix.json;
      const { error } = await supabase.from('gstr1_data').update({ raw_json: newJson, updated_at: new Date().toISOString() }).eq('id', gstr1Data.id);
      if (error) throw error;
      toast.success('HSN summary updated.');
      if (hsnFix.fixes.length || hsnFix.merged) toast.info(describeHsnFixes(hsnFix), { duration: 12000 });
      await fetchGSTR1Data();
      await recordVersion({ action_type: 'IMPORT', status: 'edited', summary: 'Edited HSN summary (Table 12) before upload', payload: newJson });
      setHsnEditMode(false);
      setHsnEditRows([]);
    } catch (err: any) {
      toast.error('Failed to save HSN summary: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSavingHsn(false);
    }
  };

  // --- Documents Issued (Table 13) manual correction ---
  const docSeriesCount = (from: string, to: string): number | null => {
    const f = String(from ?? '').match(/(\d+)\s*$/)?.[1];
    const t = String(to ?? '').match(/(\d+)\s*$/)?.[1];
    if (!f || !t) return null;
    const diff = parseInt(t, 10) - parseInt(f, 10) + 1;
    return diff > 0 ? diff : null;
  };
  const startDocEdit = () => {
    setDocEditRows(docRows.map((r, i) => ({ ...r, _id: i })));
    setDocEditMode(true);
  };
  const cancelDocEdit = () => { setDocEditMode(false); setDocEditRows([]); };
  const updateDocCell = (id: number, field: string, value: any) =>
    setDocEditRows((prev) => prev.map((r) => {
      if (r._id !== id) return r;
      const next = { ...r, [field]: value };
      if (field === 'doc_typ') {
        next.doc_num = DOC_TYPES.find((d) => d.value === value)?.doc_num ?? r.doc_num;
      }
      if (field === 'from' || field === 'to') {
        const count = docSeriesCount(next.from, next.to);
        if (count !== null) next.totnum = count;
      }
      return next;
    }));
  const addDocRow = () =>
    setDocEditRows((prev) => [
      ...prev,
      { _id: (prev.at(-1)?._id ?? -1) + 1, doc_num: DOC_TYPES[0].doc_num, doc_typ: DOC_TYPES[0].value, from: '', to: '', totnum: 0, cancel: 0 },
    ]);
  const removeDocRow = (id: number) => setDocEditRows((prev) => prev.filter((r) => r._id !== id));
  const saveDocEdits = async () => {
    if (!gstr1Data) return;
    setIsSavingDoc(true);
    try {
      const groups = new Map<number, any[]>();
      docEditRows
        .filter((r) => (Number(r.totnum) || 0) > 0)
        .forEach((r) => {
          const key = Number(r.doc_num);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
        });
      const docDet = Array.from(groups.entries()).map(([doc_num, rows]) => ({
        doc_num,
        docs: rows.map((r, i) => {
          const totnum = Number(r.totnum) || 0;
          const cancel = Number(r.cancel) || 0;
          return { num: i + 1, from: r.from || '', to: r.to || '', totnum, cancel, net_issue: totnum - cancel };
        }),
      }));
      const newJson = { ...json };
      if (docDet.length) newJson.doc_issue = { doc_det: docDet };
      else delete newJson.doc_issue;
      const { error } = await supabase.from('gstr1_data').update({ raw_json: newJson, updated_at: new Date().toISOString() }).eq('id', gstr1Data.id);
      if (error) throw error;
      toast.success('Documents Issued updated.');
      await fetchGSTR1Data();
      await recordVersion({ action_type: 'IMPORT', status: 'edited', summary: 'Edited Documents Issued (Table 13) before upload', payload: newJson });
      setDocEditMode(false);
      setDocEditRows([]);
    } catch (err: any) {
      toast.error('Failed to save Documents Issued: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSavingDoc(false);
    }
  };

  const renderEmptyState = (label: string) => (
    <TableEmptyState
      icon={<Inbox className="h-6 w-6" />}
      title={`No ${label} data`}
      description={`This GSTR-1 file contains no ${label} records for the selected client and period.`}
    />
  );

  const selectedClientData = clients.find(c => c.id === selectedClient);
  const selectedClientName = selectedClientData?.name || '';

  return (
    <div className={WS_PAGE}>
      {/* One compact row: what this is and the return's actions (the bell is fixed top-right). */}
      <PageHeader
        compact
        title="GSTR-1"
        subtitle="import and view GSTR-1 JSON client-wise & month-wise"
        icon={<FileJson />}
        actions={isStaff ? (
          <>
            {/* Version History — every Import / Upload / Refresh_Errors action
                is recorded, so operators can audit who touched what and see
                per-attempt error reports. Always visible when a client + month
                are selected so the audit trail is discoverable even before
                any post-migration actions have been recorded. */}
            {selectedClient && selectedMonth && (
              <Button
                variant="outline"
                size="sm"
                className={WS_BTN}
                onClick={() => setVersionHistoryOpen(true)}
                title={versions.length === 0
                  ? 'No upload history yet for this return — imports and uploads from now on are tracked here'
                  : `${versions.length} recorded action(s) for this return`}
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Version History</span>
                {versions.length > 0 && <span className="tabular-nums text-muted-foreground">({versions.length})</span>}
              </Button>
            )}
            {/* Only meaningful right after a "Processed with Error" upload,
                while GSTN is still generating the per-invoice Error Report, or
                a 'failed' one whose file reached the portal with its outcome
                unknown (the 6-minute timeout, or its portal tab closed after
                the attach): from 0.8.6 Refresh reads the portal's Upload
                History and saves this app's processed upload 'accepted'. Never
                for a failure that did not send the file, nor on a Filed
                return. An older extension's Refresh always wrote 'partial', so
                a failed upload offers it only from 0.8.6. */}
            {gstr1Data && canEditFilingStatus() && (gstr1Data.last_upload_status === 'partial'
              || (gstr1Data.last_upload_status === 'failed' && !isFiled && isOutcomeUnknownFailure(gstr1Data.last_upload_summary)
                && jsonUnchangedSinceUpload(gstr1Data)
                && !!extVersion && compareVersions(extVersion, REFRESH_HISTORY_MIN_EXTENSION) >= 0)) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={WS_BTN}
                  onClick={handleRefreshErrors}
                  disabled={isUploading || !extReady}
                  title={gstr1Data.last_upload_status === 'failed'
                    ? 'Re-open the portal and read its Upload History: an upload it processed after this page gave up is recorded as accepted, or its errors fetched'
                    : 'Re-open the portal and fetch the per-invoice Error Report (GSTN takes up to 20 min to generate it)'}
                >
                  {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Refresh errors
                </Button>
                {gstr1Data.last_upload_status === 'partial' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={WS_BTN}
                    onClick={handleImportErrorReport}
                    title="Manually import the Error Report JSON you downloaded from the portal's Download tab"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import Error Report
                  </Button>
                )}
              </>
            )}
            {gstr1Data && (
              <Button
                variant="outline"
                size="sm"
                className={cn(WS_BTN, 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
                onClick={handleDelete}
                disabled={isUploading || isFiled}
                title={isFiled ? 'GSTR-1 already Filed — delete is locked' : undefined}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            )}
            {isBuilderClient ? (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate('/builder-returns')}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Prepare in Builder Returns
              </Button>
            ) : isManualClient ? null : (
              <Button
                size="sm"
                variant={gstr1Data ? 'outline' : 'default'}
                className={WS_BTN}
                onClick={handleImportClick}
                disabled={isImporting || !selectedClient || !selectedMonth || isFiled}
                title={isFiled ? 'GSTR-1 already Filed — import locked to preserve the filed record' : undefined}
              >
                {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Import JSON
              </Button>
            )}
            {/* Once a manual client's JSON has been generated via Prepare
                Manually, it uploads exactly like an imported return. */}
            {gstr1Data && canEditFilingStatus() && (
              <Button
                size="sm"
                onClick={() => { setUploadResult(null); setUploadDialogOpen(true); }}
                disabled={isUploading || !extReady || !!gstinMismatch || isFiled}
                className={cn(WS_BTN, 'px-3 bg-success text-success-foreground hover:bg-success/90')}
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
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Upload to GST Portal
              </Button>
            )}
            {/* NIL period: marks the return NIL on the portal — no JSON needed. */}
            {selectedClient && selectedMonth && isNilReturn && canEditFilingStatus() && (
              <Button
                size="sm"
                variant={gstr1Data ? 'outline' : 'default'}
                onClick={() => { setUploadResult(null); setNilDialogOpen(true); }}
                disabled={isUploading || !extReady || isFiled}
                className={cn(WS_BTN, 'px-3')}
                title={
                  isFiled
                    ? 'GSTR-1 already Filed — portal push is locked'
                    : extReady
                      ? 'Mark this GSTR-1 as NIL on the GST portal — no JSON needed (filing / signing stays manual)'
                      : 'GST Keeper browser extension not detected — install / enable it and reload this page'
                }
              >
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Push NIL return
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
      {isStaff && selectedClient && einvEvidenceFailed && (
        <div className="flex flex-wrap items-center gap-2" data-testid="einvoice-evidence-failed">
          <ProblemLine problems={[{
            key: 'einv-evidence',
            text: `Could not check whether this client issues e-invoices (${einvEvidenceFailed}): the e-invoice panel is hidden and Upload and Download JSON refuse until the check runs.`,
          }]}
          />
          <Button variant="outline" size="sm" className={cn(WS_BTN, 'h-6 px-2 text-[11px]')} onClick={() => fetchEinvoiceEvidenceForClient()}>
            Retry
          </Button>
        </div>
      )}
      <input
        ref={einvExcelInputRef}
        type="file"
        accept=".xlsx,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
        className="hidden"
        data-testid="einvoice-excel-input"
        onChange={handleEinvoiceExcelChange}
      />

      {/* Filters: one labelled toolbar, with the loaded file's provenance and
          last portal upload on the right. */}
      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <label className="w-full min-w-0 space-y-0.5 sm:w-56">
              <span className={WS_FILTER_LABEL}>Client</span>
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name }))}
                value={selectedClient}
                onValueChange={setSelectedClient}
                placeholder="Select Client"
                className={WS_CONTROL}
              />
            </label>
            <label className="w-full min-w-0 space-y-0.5 sm:w-36">
              <span className={WS_FILTER_LABEL}>Month</span>
              <SearchableMonthSelect
                options={monthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Select Month"
                className={WS_CONTROL}
              />
            </label>
            {isStaff && selectedClient && selectedMonth && (
              <div
                className="min-w-0 space-y-0.5"
                title="This period had zero activity — Documents Issued (Table 13) will not be required before uploading to the portal."
              >
                <span className={WS_FILTER_LABEL}>Return type</span>
                <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5">
                  <Checkbox
                    id="gstr1-nil-return"
                    checked={isNilReturn}
                    disabled={!canEditFilingStatus() || isFiled || isTogglingNil}
                    onCheckedChange={(v) => handleToggleNilReturn(!!v)}
                  />
                  <label htmlFor="gstr1-nil-return" className="cursor-pointer select-none text-xs font-medium">
                    NIL Return
                  </label>
                  {isTogglingNil && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
              </div>
            )}
            {gstr1Data && (
              <div className="ml-auto flex min-w-0 flex-col items-start gap-1 sm:items-end">
                <div className="max-w-full truncate text-[11px] text-muted-foreground" title={gstr1Data.file_name}>
                  File: <span className="font-medium text-foreground">{gstr1Data.file_name}</span> · Imported {new Date(gstr1Data.imported_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                {gstr1Data.last_uploaded_at ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={gstr1Data.last_upload_status === 'accepted' ? 'success' : gstr1Data.last_upload_status === 'partial' ? 'warning' : 'destructive'}
                      className="gap-1 px-1.5 text-[10px] font-medium"
                    >
                      {gstr1Data.last_upload_status === 'accepted'
                        ? <CheckCircle2 className="h-3 w-3 text-success-strong" />
                        : <XCircle className={cn('h-3 w-3', gstr1Data.last_upload_status === 'partial' ? 'text-warning' : 'text-destructive')} />}
                      {gstr1Data.last_upload_summary || (gstr1Data.last_upload_status === 'accepted'
                        ? 'Uploaded to portal'
                        : gstr1Data.last_upload_status === 'partial'
                          ? 'Uploaded with errors'
                          : 'Upload failed')}
                    </Badge>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {new Date(gstr1Data.last_uploaded_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      onClick={() => setShowUploadReport((v) => !v)}
                    >
                      {showUploadReport ? 'Hide report' : 'View report'}
                    </Button>
                    {gstr1Data.last_upload_errors && gstr1Data.last_upload_errors.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px]"
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={gstr1Data.last_push_status === 'success' ? 'success' : 'destructive'}
                      className="gap-1 px-1.5 text-[10px] font-medium"
                    >
                      {gstr1Data.last_push_status === 'success'
                        ? <CheckCircle2 className="h-3 w-3 text-success-strong" />
                        : <XCircle className="h-3 w-3 text-destructive" />}
                      {gstr1Data.last_push_status === 'success' ? 'Pushed to GST portal (legacy)' : 'Last push failed (legacy)'}
                    </Badge>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {new Date(gstr1Data.last_pushed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
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
        <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs text-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">GSTR-1 already Filed for this period.</span>{' '}
            Import JSON, Upload to Portal and Delete are locked to preserve the record of what was actually filed
            with GSTN. Version History and Error Reports remain viewable.
          </div>
        </div>
      )}

      {/* Loaded JSON is for a different taxpayer — refuse Upload and surface
          the mismatch so the operator can delete + re-import the right file. */}
      {gstinMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-foreground">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-destructive">GSTIN mismatch — this file belongs to a different taxpayer.</span>{' '}
            File GSTIN: <span className="font-mono">{gstinMismatch.jsonGstin}</span> · Client GSTIN:{' '}
            <span className="font-mono">{gstinMismatch.clientGstin}</span>. Upload is blocked. Delete this
            import and re-import the correct client's JSON.
          </div>
        </div>
      )}

      {/* Portal Upload Report — full summary of the most recent upload for this
          (client, period), behind the "View report" toggle above so it isn't
          taking up page space by default. When open, it shows the status
          prominently and, when the portal rejected any invoices, lists the
          per-invoice reasons right on the page (no dialog to click into).
          Survives page refresh because it reads from last_upload_* columns on
          gstr1_data — only the open/closed state resets on navigation. */}
      {gstr1Data && gstr1Data.last_uploaded_at && showUploadReport && (
        <Card
          className={
            gstr1Data.last_upload_status === 'accepted'
              ? 'border-success/40'
              : gstr1Data.last_upload_status === 'partial'
                ? 'border-warning/50'
                : 'border-destructive/40'
          }
        >
          <CardContent className="space-y-2.5 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {gstr1Data.last_upload_status === 'accepted' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" />
                ) : (
                  <XCircle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${gstr1Data.last_upload_status === 'partial' ? 'text-warning' : 'text-destructive'}`}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug">
                    Portal Upload Report — {gstr1Data.last_upload_status === 'accepted'
                      ? 'All records accepted'
                      : gstr1Data.last_upload_status === 'partial'
                        ? 'Some records rejected by GSTN'
                        : 'Upload rejected by GSTN'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {gstr1Data.last_upload_summary || '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
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
                  className={WS_BTN}
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
              <div className={cn(TABLE_SHELL, '[&>div]:max-h-[50vh]')}>
                <Table className={WS_TABLE}>
                  <TableHeader>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className={`${TH} w-12`}>#</TableHead>
                      <TableHead className={TH}>Invoice No.</TableHead>
                      <TableHead className={TH}>Customer GSTIN</TableHead>
                      <TableHead className={TH}>Reason (portal message)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gstr1Data.last_upload_errors.map((e, i) => (
                      <TableRow key={i} className={WS_TR}>
                        <TableCell className={`${TD} tabular-nums text-muted-foreground`}>{i + 1}</TableCell>
                        <TableCell className={`${TD} font-mono`}>{e.invoiceNo || '—'}</TableCell>
                        <TableCell className={`${TD} font-mono`}>{e.gstin || '—'}</TableCell>
                        <TableCell className={TD}>{e.reason}</TableCell>
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
              <Note tone="warn">
                GSTN accepted the file but flagged some records. The per-invoice reasons haven't been fetched
                yet — click <span className="font-medium">Refresh errors</span> (fetches from the portal) or{' '}
                <span className="font-medium">Import Error Report</span> (paste the JSON you download manually).
              </Note>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last upload result banner */}
      {uploadResult && (
        <div
          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs text-foreground ${
            uploadResult.ok
              ? 'border-success/40 bg-success/10'
              : 'border-destructive/40 bg-destructive/10'
          }`}
        >
          {uploadResult.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          )}
          <span className="flex-1 break-words">{uploadResult.message}</span>
          {uploadResult.errors && uploadResult.errors.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => setErrorsDialogOpen(true)}
            >
              View {uploadResult.errors.length} error{uploadResult.errors.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}

      {/* Data Display */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading GSTR-1…
          </CardContent>
        </Card>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-3">
            <TableEmptyState
              icon={<FileJson className="h-6 w-6" />}
              title="No client or month selected"
              description="Select a client and a return period above to view GSTR-1 data."
            />
          </CardContent>
        </Card>
      ) : !gstr1Data ? (
        <div className="space-y-3">
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
            <CardContent className="p-3">
              <TableEmptyState
                icon={isBuilderClient ? <FileSpreadsheet className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
                title={isStaff && isNilReturn
                  ? `NIL return for ${selectedClientName} — ${mmYyyyToShort(selectedMonth)}`
                  : `No GSTR-1 data for ${selectedClientName} — ${mmYyyyToShort(selectedMonth)}`}
                description={!isStaff ? undefined : isNilReturn
                  ? 'This period is marked NIL, so no JSON is needed. Click "Push NIL return" above to mark '
                    + 'the GSTR-1 as NIL on the GST portal (filing / signing stays manual).'
                  : isBuilderClient
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
        <div className="space-y-3">
          {/* Builder clients land here too, once Builder Returns has generated
              a JSON: the grid hydrates from it (prefilled Table 7/11A/11B,
              Table 13 always blank — see hydrateManualEntriesFromJson) so
              staff can review, add Documents Issued by hand, and re-Generate
              before the Upload button above will allow a push. JSON+Manual
              clients land here the same way once their JSON is imported —
              the grid hydrates every section from the imported return so
              staff can edit anything, not just HSN/Documents. */}
          {(isManualClient || isBuilderClient || isJsonManualClient) && (
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

          {/* Provenance. A computed return and an uploaded one look identical
              once stored, so say which this is before anyone reconciles it. */}
          {isBuilderGenerated && (
            <Note tone="position" open>
              <span className="font-medium">Generated from Builder Returns.</span>{' '}
              These figures were computed from bookings, receipts, BU events and adjustments —
              not uploaded. To change them, correct the underlying records and regenerate.
              {' '}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => navigate('/builder-returns')}
              >
                Open Builder Returns
              </button>
              {/* Lines, not b2csa entries: an entry is a month and POS with its rate lines in itms[]. */}
              {b2csaRows.length ? (
                <>
                  {' '}This return also carries {b2csaRows.length}{' '}
                  Table 10 amendment line(s) from a retrospective re-rating. They are included
                  in the JSON and in the portal push, but there is no Table 10 tile below yet.
                </>
              ) : null}
            </Note>
          )}

          {/* Headline liability for the return (the summary's totals, excl. HSN & Docs). */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <KpiTile label="Total value (excl. HSN & Docs)" value={`₹${fmt2(summary.totals.value)}`} hint={`${summary.tiles.reduce((n, t) => n + (t.count > 0 ? 1 : 0), 0)} section(s) with data`} />
            <KpiTile label="Integrated tax" value={`₹${fmt2(summary.totals.igst)}`} />
            <KpiTile label="Central tax" value={`₹${fmt2(summary.totals.cgst)}`} />
            <KpiTile label="State / UT tax" value={`₹${fmt2(summary.totals.sgst)}`} />
            <KpiTile label="Cess" value={`₹${fmt2(summary.totals.cess)}`} />
          </div>

          {/* Portal-style section overview — click a tile to jump to its detail tab */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">Sections in this return</h3>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setSummaryOpen(true)}>
                <BarChart3 className="h-3.5 w-3.5" /> Generate Summary
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
              {summary.tiles.map((t) => (
                <SectionTile
                  key={t.key}
                  label={t.label}
                  count={t.count}
                  value={t.value > 0 ? `₹${fmt2(t.value)}` : undefined}
                  active={activeTab === t.key}
                  onClick={() => setActiveTab(t.key)}
                />
              ))}
            </div>
          </div>

          <Card>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {/* The tiles above are the section navigation; this header names the
                  section whose table is shown and carries the collapse toggle. */}
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-4 pb-2 pt-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[15px] font-semibold leading-snug text-foreground">
                      {SECTION_LABELS[activeTab] ?? activeTab.toUpperCase()}
                    </span>
                    <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-medium tabular-nums">
                      {(docCount[activeTab] ?? 0).toLocaleString('en-IN')}
                    </Badge>
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Counts are documents (invoices / notes) like the GST portal; the table lists each tax-rate line, so it can have more rows than the count.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {activeTab === 'hsn' && !isFiled && (
                    hsnEditMode ? (
                      <>
                        <Button variant="ghost" size="sm" className={WS_BTN} onClick={cancelHsnEdit} disabled={isSavingHsn}>
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button size="sm" className={WS_BTN} onClick={saveHsnEdits} disabled={isSavingHsn}>
                          {isSavingHsn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" className={WS_BTN} onClick={startHsnEdit}>
                        <Pencil className="h-3.5 w-3.5" /> Edit HSN Summary
                      </Button>
                    )
                  )}
                  {activeTab === 'doc' && !isFiled && (
                    docEditMode ? (
                      <>
                        <Button variant="ghost" size="sm" className={WS_BTN} onClick={cancelDocEdit} disabled={isSavingDoc}>
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button size="sm" className={WS_BTN} onClick={saveDocEdits} disabled={isSavingDoc}>
                          {isSavingDoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" className={WS_BTN} onClick={startDocEdit}>
                        <Pencil className="h-3.5 w-3.5" /> Edit Documents Issued
                      </Button>
                    )
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={WS_BTN}
                    onClick={() => toggleCollapse(activeTab)}
                  >
                    {isCollapsed(activeTab) ? (
                      <><ChevronsUpDown className="h-3.5 w-3.5" /> Show all rows</>
                    ) : (
                      <><ChevronsDownUp className="h-3.5 w-3.5" /> Show only total</>
                    )}
                  </Button>
                </div>
              </div>
              <div className="px-4 pb-3 [&_[role=tabpanel]]:mt-0">

              {/* B2B Tab */}
              <TabsContent value="b2b">
                {b2bRows.length === 0 ? renderEmptyState('B2B') : (
                  <div className={TABLE_SHELL}>
                    <Table className={`${WS_TABLE} min-w-[1200px]`}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>GSTIN</TableHead>
                          <TableHead className={TH}>Invoice No.</TableHead>
                          <TableHead className={TH}>Date</TableHead>
                          <TableHead className={`${TH} text-right`}>Value</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Rev. Chrg</TableHead>
                          <TableHead className={TH}>Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('b2b') && b2bRows.map((row, i) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} font-mono text-xs`}>{row.ctin}</TableCell>
                            <TableCell className={TD}>{row.inum}</TableCell>
                            <TableCell className={TD}>{row.idt}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.val)}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.rchrg}</TableCell>
                            <TableCell className={TD}>{row.inv_typ}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({b2bRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumDocVal(b2bRows, (r) => `${r.ctin}|${r.inum}`))}</TableCell>
                          <TableCell className={TD} colSpan={4} />
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Invoice No.</TableHead>
                          <TableHead className={TH}>Date</TableHead>
                          <TableHead className={`${TH} text-right`}>Value</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('b2cl') && b2clRows.map((row, i) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.inum}</TableCell>
                            <TableCell className={TD}>{row.idt}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.val)}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({b2clRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumDocVal(b2clRows, (r) => `${r.pos}|${r.inum}`))}</TableCell>
                          <TableCell className={TD} />
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('b2cs') && b2csRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.typ}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({b2csRows.length} rows)</TableCell>
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>Original Month</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('b2csa') && b2csaRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.omon}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.typ}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={5}>Total ({b2csaRows.length} rows)</TableCell>
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
                    <Table className={`${WS_TABLE} min-w-[1200px]`}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>GSTIN</TableHead>
                          <TableHead className={TH}>Note No.</TableHead>
                          <TableHead className={TH}>Date</TableHead>
                          <TableHead className={TH}>Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Value</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('cdnr') && cdnrRows.map((row, i) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} font-mono text-xs`}>{row.ctin}</TableCell>
                            <TableCell className={TD}>{row.ntNum}</TableCell>
                            <TableCell className={TD}>{row.ntDt}</TableCell>
                            <TableCell className={TD}>{row.ntTyp}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.val)}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={5}>Total ({cdnrRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumDocVal(cdnrRows, (r) => `${r.ctin}|${r.ntNum}`))}</TableCell>
                          <TableCell className={TD} />
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>Note No.</TableHead>
                          <TableHead className={TH}>Date</TableHead>
                          <TableHead className={TH}>Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Value</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('cdnur') && cdnurRows.map((row, i) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.ntNum}</TableCell>
                            <TableCell className={TD}>{row.ntDt}</TableCell>
                            <TableCell className={TD}>{row.ntTyp}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.val)}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({cdnurRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumDocVal(cdnurRows, (r) => `${r.ntNum}`))}</TableCell>
                          <TableCell className={TD} colSpan={2} />
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
                    <Table className={`${WS_TABLE} min-w-[1100px]`}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>Export Type</TableHead>
                          <TableHead className={TH}>Invoice No.</TableHead>
                          <TableHead className={TH}>Date</TableHead>
                          <TableHead className={`${TH} text-right`}>Value</TableHead>
                          <TableHead className={TH}>Port Code</TableHead>
                          <TableHead className={TH}>SB No.</TableHead>
                          <TableHead className={TH}>SB Date</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('exp') && expRows.map((row, i) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.expTyp}</TableCell>
                            <TableCell className={TD}>{row.inum}</TableCell>
                            <TableCell className={TD}>{row.idt}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.val)}</TableCell>
                            <TableCell className={TD}>{row.sbpcode}</TableCell>
                            <TableCell className={TD}>{row.sbnum}</TableCell>
                            <TableCell className={TD}>{row.sbdt}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({expRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumDocVal(expRows, (r) => `${r.expTyp ?? ''}|${r.inum}`))}</TableCell>
                          <TableCell className={TD} colSpan={4} />
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
                {hsnEditMode ? (
                  <div className={TABLE_SHELL}>
                    <Table className={`${WS_TABLE} min-w-[1100px]`}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={`${TH} w-32`}>HSN Code</TableHead>
                          <TableHead className={`${TH} w-44`}>Type</TableHead>
                          <TableHead className={`${TH} w-40`}>UQC</TableHead>
                          <TableHead className={`${TH} w-24 text-right`}>Qty</TableHead>
                          <TableHead className={`${TH} w-20 text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} w-32 text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} w-28 text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} w-28 text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} w-28 text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} w-24 text-right`}>Cess</TableHead>
                          <TableHead className={`${TH} w-12`} />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hsnEditRows.map((row: any, i: number) => (
                          <TableRow key={row._id} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={WS_CELL_INPUT} value={row.hsn_sc || ''} onChange={(e) => updateHsnCell(row._id, 'hsn_sc', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Select value={row._src || 'hsn_b2b'} onValueChange={(v) => updateHsnCell(row._id, '_src', v)}>
                                <SelectTrigger className={CELL_SELECT}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="hsn_b2b">B2B / CDNR (registered)</SelectItem>
                                  <SelectItem value="hsn_b2c">Other (B2C / Exports)</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <UqcSelect value={row.uqc} hsn={row.hsn_sc} onChange={(code) => updateHsnCell(row._id, 'uqc', code)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              {isServiceHsn(row.hsn_sc) ? (
                                <span className="block px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground" title="A service always goes to the portal with quantity 0.">0</span>
                              ) : (
                                <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.qty ?? 0} onChange={(e) => updateHsnCell(row._id, 'qty', e.target.value)} />
                              )}
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.rt ?? 0} onChange={(e) => updateHsnCell(row._id, 'rt', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.txval ?? 0} onChange={(e) => updateHsnCell(row._id, 'txval', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.iamt ?? 0} onChange={(e) => updateHsnCell(row._id, 'iamt', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.camt ?? 0} onChange={(e) => updateHsnCell(row._id, 'camt', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.samt ?? 0} onChange={(e) => updateHsnCell(row._id, 'samt', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.csamt ?? 0} onChange={(e) => updateHsnCell(row._id, 'csamt', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0 text-center`}>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeHsnRow(row._id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={TD} colSpan={12}>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="sm" onClick={addHsnRow}>
                                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Row
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={mergeDuplicateHsnRows}
                                title="Combine rows that share the same HSN code, rate and UQC into one summed row — the portal expects exactly one row per unique combination."
                              >
                                <Combine className="h-3.5 w-3.5 mr-1.5" /> Merge Duplicates
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                ) : hsnRows.length === 0 ? renderEmptyState('HSN') : (
                  <div className={TABLE_SHELL}>
                    <Table className={`${WS_TABLE} min-w-[1000px]`}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>HSN Code</TableHead>
                          <TableHead className={TH}>Description</TableHead>
                          <TableHead className={TH}>UQC</TableHead>
                          <TableHead className={`${TH} text-right`}>Qty</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Taxable Value</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('hsn') && hsnRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} font-mono`}>{row.hsn_sc}</TableCell>
                            <TableCell className={TD}>{row.desc}</TableCell>
                            <TableCell className={TD}><UqcText value={row.uqc} hsn={row.hsn_sc} /></TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.qty)}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.txval)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({hsnRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(hsnRows, 'qty'))}</TableCell>
                          <TableCell className={TD} />
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={TH}>Description</TableHead>
                          <TableHead className={`${TH} text-right`}>Nil Rated</TableHead>
                          <TableHead className={`${TH} text-right`}>Exempted</TableHead>
                          <TableHead className={`${TH} text-right`}>Non-GST</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('nil') && (nilData.inv || []).map((item: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={TD}>{item.sply_ty === 'INTRB2B' ? 'Inter-State B2B' : item.sply_ty === 'INTRAB2B' ? 'Intra-State B2B' : item.sply_ty === 'INTRB2C' ? 'Inter-State B2C' : item.sply_ty === 'INTRAB2C' ? 'Intra-State B2C' : item.sply_ty}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(item.nil_amt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(item.expt_amt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(item.ngsup_amt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`}>Total</TableCell>
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Supply Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Advance Amount</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('at') && atRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.sply_ty}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.ad_amt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({atRows.length} rows)</TableCell>
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
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Supply Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Advance Amount</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('txpd') && txpdRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.sply_ty}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.ad_amt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={4}>Total ({txpdRows.length} rows)</TableCell>
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

              {/* ATA Tab — Table 11(2) amendment. Carries the original month
                  ({'omon'}) the row restates; without it the row means nothing. */}
              <TabsContent value="ata">
                {ataRows.length === 0 ? renderEmptyState('Amended Advances') : (
                  <div className={TABLE_SHELL}>
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>Original Period</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Supply Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Revised Advance Amount</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('ata') && ataRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} tabular-nums`}>{row.omon}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.sply_ty}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.ad_amt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={5}>Total ({ataRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(ataRows, 'ad_amt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(ataRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(ataRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(ataRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(ataRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* TXPDA Tab — Table 11(2) amendment. Carries the original month
                  ({'omon'}) the row restates; without it the row means nothing. */}
              <TabsContent value="txpda">
                {txpdaRows.length === 0 ? renderEmptyState('Amended Advance Adjustment') : (
                  <div className={TABLE_SHELL}>
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>Original Period</TableHead>
                          <TableHead className={TH}>POS</TableHead>
                          <TableHead className={TH}>Supply Type</TableHead>
                          <TableHead className={`${TH} text-right`}>Rate</TableHead>
                          <TableHead className={`${TH} text-right`}>Revised Advance Adjusted</TableHead>
                          <TableHead className={`${TH} text-right`}>IGST</TableHead>
                          <TableHead className={`${TH} text-right`}>CGST</TableHead>
                          <TableHead className={`${TH} text-right`}>SGST</TableHead>
                          <TableHead className={`${TH} text-right`}>Cess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('txpda') && txpdaRows.map((row: any, i: number) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} tabular-nums`}>{row.omon}</TableCell>
                            <TableCell className={TD}>{row.pos}</TableCell>
                            <TableCell className={TD}>{row.sply_ty}</TableCell>
                            <TableCell className={TD_NUM}>{row.rt}%</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.ad_amt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.iamt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.camt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.samt)}</TableCell>
                            <TableCell className={TD_NUM}>{formatNumber(row.csamt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={5}>Total ({txpdaRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdaRows, 'ad_amt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdaRows, 'iamt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdaRows, 'camt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdaRows, 'samt'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(txpdaRows, 'csamt'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* DOC Tab */}
              <TabsContent value="doc">
                {docEditMode ? (
                  <div className={TABLE_SHELL}>
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={`${TH} w-56`}>Doc Type</TableHead>
                          <TableHead className={`${TH} w-32`}>From</TableHead>
                          <TableHead className={`${TH} w-32`}>To</TableHead>
                          <TableHead className={`${TH} w-24 text-right`}>Total</TableHead>
                          <TableHead className={`${TH} w-24 text-right`}>Cancelled</TableHead>
                          <TableHead className={`${TH} w-24 text-right`}>Net Issued</TableHead>
                          <TableHead className={`${TH} w-12`} />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {docEditRows.map((row: any, i: number) => (
                          <TableRow key={row._id} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Select value={row.doc_typ || ''} onValueChange={(v) => updateDocCell(row._id, 'doc_typ', v)}>
                                <SelectTrigger className={CELL_SELECT}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {DOC_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.value}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={WS_CELL_INPUT} value={row.from || ''} onChange={(e) => updateDocCell(row._id, 'from', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={WS_CELL_INPUT} value={row.to || ''} onChange={(e) => updateDocCell(row._id, 'to', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.totnum ?? 0} onChange={(e) => updateDocCell(row._id, 'totnum', e.target.value)} />
                            </TableCell>
                            <TableCell className={`${TD} p-0`}>
                              <Input className={`${WS_CELL_INPUT} text-right`} type="number" value={row.cancel ?? 0} onChange={(e) => updateDocCell(row._id, 'cancel', e.target.value)} />
                            </TableCell>
                            <TableCell className={TD_NUM}>
                              {(Number(row.totnum) || 0) - (Number(row.cancel) || 0)}
                            </TableCell>
                            <TableCell className={`${TD} p-0 text-center`}>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeDocRow(row._id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={TD} colSpan={8}>
                            <Button variant="ghost" size="sm" onClick={addDocRow}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Row
                            </Button>
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                ) : docRows.length === 0 ? renderEmptyState('Document Issued') : (
                  <div className={TABLE_SHELL}>
                    <Table className={WS_TABLE}>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className={`${TH} w-12`}>Sr.</TableHead>
                          <TableHead className={TH}>Doc Type</TableHead>
                          <TableHead className={TH}>Sr. No.</TableHead>
                          <TableHead className={TH}>From</TableHead>
                          <TableHead className={TH}>To</TableHead>
                          <TableHead className={`${TH} text-right`}>Total</TableHead>
                          <TableHead className={`${TH} text-right`}>Cancelled</TableHead>
                          <TableHead className={`${TH} text-right`}>Net Issued</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!isCollapsed('doc') && docRows.map((row, i) => (
                          <TableRow key={i} className={WS_TR}>
                            <TableCell className={`${TD} text-center`}>{i + 1}</TableCell>
                            <TableCell className={TD}>{row.doc_typ}</TableCell>
                            <TableCell className={TD}>{row.doc_num}</TableCell>
                            <TableCell className={TD}>{row.from}</TableCell>
                            <TableCell className={TD}>{row.to}</TableCell>
                            <TableCell className={TD_NUM}>{row.totnum}</TableCell>
                            <TableCell className={TD_NUM}>{row.cancel}</TableCell>
                            <TableCell className={TD_NUM}>{row.net_issue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className={TFOOT}>
                        <TableRow className={TR_TOTAL}>
                          <TableCell className={`${TD} font-semibold`} colSpan={5}>Total ({docRows.length} rows)</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(docRows, 'totnum'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(docRows, 'cancel'))}</TableCell>
                          <TableCell className={footTd}>{formatNumber(sumBy(docRows, 'net_issue'))}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </TabsContent>
              </div>
            </Tabs>
          </Card>
        </div>
      )}

      {/* E-invoice (IRN) reconciliation — e-invoice clients only (ticked, or
          IRNs seen for the client or its PAN). Without an imported JSON every
          e-invoice shows as not in books. */}
      {isStaff && selectedClient && selectedMonth && isEinvoiceClient && !isLoading && (
        <EinvoiceRecoPanel
          rows={einvRows}
          plan={einvPlan}
          einvoiceDocs={einvoiceDocs}
          booksDocCount={gstr1Data?.raw_json ? einvBooksDocs.length : null}
          lastPull={einvoicePull}
          lastExcel={einvoiceExcel}
          reason={einvoiceReason}
          pushedWithoutRepull={einvPushedWithoutRepull}
          loading={einvLoading}
          canPull={canEditFilingStatus()}
          extReady={extReady}
          pulling={isPullingEinv}
          importing={isImportingEinvExcel}
          onPull={handlePullEinvoice}
          onImportExcel={handleImportEinvoiceExcelClick}
          clientName={selectedClientName}
          periodMonth={selectedMonth}
        />
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
                <Button variant="outline" size="sm" className={WS_BTN} onClick={handleDownloadJson}>
                  <FileJson className="h-3.5 w-3.5" /> Download JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={WS_BTN}
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
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className={cn(WS_TABLE_WRAP, 'min-h-0')}>
            <table className={`${WS_TABLE} min-w-[900px]`}>
              <thead>
                <tr>
                  <th className={WS_TH}>Description</th>
                  <th className={`${WS_TH} text-center`}>No. of records</th>
                  <th className={`${WS_TH} text-center`}>Document Type</th>
                  <th className={`${WS_TH} text-right`}>Value (₹)</th>
                  <th className={`${WS_TH} text-right`}>Integrated Tax (₹)</th>
                  <th className={`${WS_TH} text-right`}>Central Tax (₹)</th>
                  <th className={`${WS_TH} text-right`}>State/UT Tax (₹)</th>
                  <th className={`${WS_TH} text-right`}>Cess (₹)</th>
                </tr>
              </thead>
              <tbody>
                {summary.sections.map((s, i) => (
                  <tr key={`${s.code}-${i}`} className={WS_TR}>
                    <td className={WS_TD}>
                      <span className="font-semibold text-foreground">{s.code}</span>
                      <span className="text-muted-foreground"> — {s.title}</span>
                    </td>
                    <td className={`${WS_TD} text-center tabular-nums`}>{s.count.toLocaleString('en-IN')}</td>
                    <td className={`${WS_TD} text-center text-muted-foreground`}>{s.docType}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.value)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.igst)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.cgst)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.sgst)}</td>
                    <td className={WS_TD_NUM}>{fmt2(s.cess)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr className={WS_TR_TOTAL}>
                  <td className={`${WS_TD} text-right`} colSpan={3}>Total liability (excl. HSN &amp; Docs)</td>
                  <td className={WS_TD_NUM}>{fmt2(summary.totals.value)}</td>
                  <td className={WS_TD_NUM}>{fmt2(summary.totals.igst)}</td>
                  <td className={WS_TD_NUM}>{fmt2(summary.totals.cgst)}</td>
                  <td className={WS_TD_NUM}>{fmt2(summary.totals.sgst)}</td>
                  <td className={WS_TD_NUM}>{fmt2(summary.totals.cess)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Note open>
            "No. of records" counts documents (invoices / notes) like the GST portal, so it can be lower
            than a detail tab's row count when one document has multiple tax rates. 9B notes are shown net
            (Debit − Credit), so credit notes reduce the value.
          </Note>
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
                {einvGate && (
                  <div className="space-y-2" data-testid="einvoice-upload-plan">
                    {einvPushBlocks.filter((b) => b.key !== 'pending').map((b) => (
                      <Note key={b.key} tone="warn">
                        {b.key === 'blockers' ? (
                          <>
                            <span className="font-medium">
                              {einvPlan.blockers.length.toLocaleString('en-IN')} document{einvPlan.blockers.length === 1 ? ' blocks' : 's block'} the push
                            </span>{' '}
                            (changed after IRN, or number differs from the e-invoice). Correct the books to the e-invoice, or the
                            IRN on the IRP, then push:
                            <span className="mt-1 block max-h-28 overflow-auto">
                              {einvPlan.blockers.map((r) => (
                                <span key={r.key} className="block">{einvDocLabel(r)}: {einvBlockerWhy(r)}</span>
                              ))}
                            </span>
                          </>
                        ) : b.text}
                      </Note>
                    ))}
                    {!einvPushBlocks.some((b) => b.key === 'pull') && einvPlan.pendingBlockers.length > 0 && (
                      <Note tone="warn">
                        <span className="font-medium">
                          {einvPlan.pendingBlockers.length.toLocaleString('en-IN')} document{einvPlan.pendingBlockers.length === 1 ? ' is' : 's are'} in
                          the books with an e-invoice still pending auto-population
                        </span>
                        : the portal&apos;s draft does not have {einvPlan.pendingBlockers.length === 1 ? 'it' : 'them'} yet, so{' '}
                        {einvPlan.pendingBlockers.length === 1 ? 'it' : 'they'} cannot be left out, and the push is blocked until you choose.
                        <span className="mt-1 block max-h-28 overflow-auto">
                          {einvPlan.pendingBlockers.map((r) => (
                            <span key={r.key} className="block">{einvDocLabel(r)}{r.einv?.irn_date ? ` · IRN of ${r.einv.irn_date}` : ''}</span>
                          ))}
                        </span>
                        <label className="mt-2 flex cursor-pointer items-start gap-2 font-medium" data-testid="einvoice-pending-override">
                          <Checkbox
                            className="mt-0.5"
                            checked={einvPendingAcked}
                            onCheckedChange={(v) => setEinvPendingAck(v ? einvPlan.pendingBlockers.map((r) => r.key) : null)}
                          />
                          <span>
                            {einvPlan.pendingBlockers.length === 1
                              ? 'Upload this document now; its IRN'
                              : `Upload these ${einvPlan.pendingBlockers.length.toLocaleString('en-IN')} documents now; their IRN`}
                            {' '}will not be linked (GSTN para 3(c)). To keep the IRN, cancel, pull again once the portal
                            shows {einvPlan.pendingBlockers.length === 1 ? 'it' : 'them'}, then push.
                          </span>
                        </label>
                      </Note>
                    )}
                    {!einvPushBlocks.some((b) => b.key === 'pull') && (
                      <Note tone="info" open>
                        <span className="font-medium tabular-nums">{einvPlan.keepCount.toLocaleString('en-IN')}</span>{' '}
                        document{einvPlan.keepCount === 1 ? '' : 's'} on the portal as e-invoices (seen on the draft by the pull, shown as
                        auto-populated by the e-invoice Excel, or carrying {einvPlan.keepCount === 1 ? 'its' : 'their'} own IRN) will be left out so the portal keeps{' '}
                        {einvPlan.keepCount === 1 ? 'its' : 'their'} IRN;{' '}
                        <span className="font-medium tabular-nums">{Math.max(0, einvBooksDocs.length - einvPlan.keepCount).toLocaleString('en-IN')}</span>{' '}
                        will be uploaded. Table 12 (HSN) and Table 13 go in full.
                        {(() => {
                          const basis = einvPlanBasis(einvoicePull, einvoiceExcel);
                          if (basis?.kind === 'excel') return ` Planned on the e-invoice Excel imported ${fmtEinvWhen(basis.at)} (no portal pull today): documents the Excel shows as auto-populated are left out.`;
                          return einvPulledAt ? ` Planned on the pull of ${fmtEinvWhen(einvPulledAt)}.` : '';
                        })()}
                      </Note>
                    )}
                    {(() => {
                      const w = einvPlan.warnings;
                      const n = (x: number) => x.toLocaleString('en-IN');
                      const lines = [
                        w.notInBooks.length > 0 && `${n(w.notInBooks.length)} IRN not in books: the e-invoice stays on the portal and is filed with the return. The books miss a document, or the IRN should have been cancelled on the IRP.`,
                        w.pending.length > 0 && einvPendingNotInBooksText(w.pending.length),
                        w.autopopFailed.length > 0 && `${n(w.autopopFailed.length)} auto-population failed: the books document goes up without its IRN (see the error in the reconciliation).`,
                        w.irnLost.length > 0 && `${n(w.irnLost.length)} IRN lost on the portal: the books document goes up; an upload cannot restore the IRN.`,
                        w.missingFromReturn.length > 0 && `${einvMissingFromReturnText(w.missingFromReturn.length)} Documents: ${einvDocList(w.missingFromReturn)}.`,
                        w.shippingBill.length > 0 && `${n(w.shippingBill.length)} export${w.shippingBill.length === 1 ? '' : 's'} left out to keep the IRN ${w.shippingBill.length === 1 ? 'has' : 'have'} a shipping bill in the books that the e-invoice lacks (or differs): add the shipping bill on the portal or through Table 9A. ${w.shippingBill.map((r) => `${einvDocLabel(r)}: ${r.notes.join('; ')}`).join(' · ')}`,
                      ].filter(Boolean) as string[];
                      return lines.length > 0 && (
                        <Note tone="warn">
                          {lines.map((l) => <span key={l} className="block">{l}</span>)}
                        </Note>
                      );
                    })()}
                  </div>
                )}
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
              disabled={isUploading || !extReady || einvPushBlocks.length > 0}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {isUploading ? 'Uploading…' : 'Confirm & Upload'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NIL push confirmation — no JSON involved. */}
      <AlertDialog open={nilDialogOpen} onOpenChange={(o) => { if (!isUploading) setNilDialogOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push NIL GSTR-1 to the GST portal?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>This marks the GSTR-1 as NIL on the GST portal. Filing / signing stays manual.</p>
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-foreground space-y-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Client</span>
                    <span className="font-medium text-right">{selectedClientName || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Period</span>
                    <span className="font-medium text-right">{derivedFiling?.period} {selectedMonth?.split('/')[1]}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  You will need to solve the portal CAPTCHA in the new tab.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setNilDialogOpen(false)} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={handlePushNil} disabled={isUploading || !extReady || isFiled || !isNilReturn}>
              {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Confirm &amp; Push NIL
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
          <div className={cn(TABLE_SHELL, '[&>div]:max-h-[60vh]')}>
            <Table className={WS_TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={`${TH} w-16`}>#</TableHead>
                  <TableHead className={TH}>Invoice No.</TableHead>
                  <TableHead className={TH}>GSTIN</TableHead>
                  <TableHead className={TH}>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(uploadResult?.errors || []).map((e, i) => (
                  <TableRow key={i} className={WS_TR}>
                    <TableCell className={`${TD} tabular-nums text-muted-foreground`}>{i + 1}</TableCell>
                    <TableCell className={`${TD} font-mono`}>{e.invoiceNo || '—'}</TableCell>
                    <TableCell className={`${TD} font-mono`}>{e.gstin || '—'}</TableCell>
                    <TableCell className={TD}>{e.reason}</TableCell>
                  </TableRow>
                ))}
                {(!uploadResult?.errors || uploadResult.errors.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className={`${TD} py-6 text-center text-muted-foreground`}>
                      No per-invoice errors captured.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Fix the offending invoices in your source (Tally / accounts), regenerate the JSON, re-import here, then upload again.
            </p>
            <Button
              variant="outline"
              size="sm"
              className={cn(WS_BTN, 'shrink-0')}
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
              Every Import, Portal Upload and Error Report fetch for this return. "Changes" compares a
              version against the one before it, down to the individual invoice and figure, so a wrong
              number can be traced to the version that introduced it and the person who made it.
            </DialogDescription>
          </DialogHeader>
          <div className={cn(TABLE_SHELL, '[&>div]:max-h-[65vh]')}>
            <Table className={WS_TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={`${TH} w-16`}>V#</TableHead>
                  <TableHead className={TH}>Action</TableHead>
                  <TableHead className={TH}>By</TableHead>
                  <TableHead className={TH}>When</TableHead>
                  <TableHead className={TH}>Status</TableHead>
                  <TableHead className={TH}>Summary</TableHead>
                  <TableHead className={`${TH} w-24`}>Errors</TableHead>
                  <TableHead className={`${TH} w-32`}>Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v, idx) => (
                  <React.Fragment key={v.id}>
                    <TableRow>
                      <TableCell className={`${TD} font-mono`}>v{v.version_number}</TableCell>
                      <TableCell className={TD}>
                        {v.action_type === 'IMPORT' && 'Imported'}
                        {v.action_type === 'UPLOAD' && 'Uploaded to portal'}
                        {v.action_type === 'REFRESH_ERRORS' && 'Errors report'}
                        {v.file_name && (
                          <div className="text-[10px] text-muted-foreground font-mono truncate max-w-xs">{v.file_name}</div>
                        )}
                      </TableCell>
                      <TableCell className={TD}>{v.actor_name || '—'}</TableCell>
                      <TableCell className={`${TD} whitespace-nowrap`}>
                        {new Date(v.action_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className={TD}>
                        {v.status ? (
                          <Badge
                            variant={
                              v.status === 'accepted' ? 'success' :
                              v.status === 'partial' ? 'warning' :
                              v.status === 'failed' ? 'destructive' :
                              'secondary'
                            }
                            className="px-1.5 text-[10px] font-medium capitalize"
                          >
                            {v.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className={`${TD} max-w-md`}>
                        {v.summary || '—'}
                        {v.action_type === 'UPLOAD' && (v.einvoice_kept != null || v.ext_version) && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {v.einvoice_kept != null && `${v.einvoice_kept.toLocaleString('en-IN')} e-invoice${v.einvoice_kept === 1 ? '' : 's'} left out (IRN kept on the portal)`}
                            {v.einvoice_kept != null && v.ext_version ? ' · ' : ''}
                            {v.ext_version && `extension v${v.ext_version}`}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={TD}>
                        {v.errors && v.errors.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[11px]"
                            onClick={() => setExpandedVersionId(expandedVersionId === v.id ? null : v.id)}
                          >
                            {expandedVersionId === v.id ? 'Hide' : `View (${v.errors.length})`}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className={TD}>
                        {v.payload && versions[idx + 1]?.payload ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[11px]"
                            onClick={() => setExpandedDiffId(expandedDiffId === v.id ? null : v.id)}
                            title={`Compare against v${versions[idx + 1].version_number}`}
                          >
                            {expandedDiffId === v.id
                              ? 'Hide'
                              : `vs v${versions[idx + 1].version_number}`}
                          </Button>
                        ) : (
                          <span
                            className="text-muted-foreground text-xs"
                            title={v.payload ? 'Nothing earlier to compare against' : 'This action predates change tracking'}
                          >
                            {v.payload ? 'First version' : '—'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedDiffId === v.id && (
                      <TableRow>
                        <TableCell colSpan={8} className={`${TD} bg-muted/40 p-3`}>
                          {expandedDiff ? (
                            <>
                              <p className="text-xs text-muted-foreground mb-2">
                                What <span className="font-mono">v{expandedDiff.cur.version_number}</span> ({expandedDiff.cur.actor_name || '—'}) changed
                                against <span className="font-mono">v{expandedDiff.prev.version_number}</span> ({expandedDiff.prev.actor_name || '—'})
                                {expandedDiff.rows.length > 0 && <> — {summariseDiff(expandedDiff.rows)}</>}.
                              </p>
                              <ReturnDiffTable
                                rows={expandedDiff.rows}
                                againstLabel={`v${expandedDiff.prev.version_number}`}
                              />
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">Nothing to compare for this version.</p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {expandedVersionId === v.id && v.errors && v.errors.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className={`${TD} bg-muted/40 p-3`}>
                          <div className="overflow-hidden rounded-md border bg-card">
                            <Table className={WS_TABLE}>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className={`${TH_STATIC} w-12`}>#</TableHead>
                                  <TableHead className={TH_STATIC}>Invoice No.</TableHead>
                                  <TableHead className={TH_STATIC}>Customer GSTIN</TableHead>
                                  <TableHead className={TH_STATIC}>Reason</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {v.errors.map((e, i) => (
                                  <TableRow key={i} className={WS_TR}>
                                    <TableCell className={`${TD} tabular-nums text-muted-foreground`}>{i + 1}</TableCell>
                                    <TableCell className={`${TD} font-mono`}>{e.invoiceNo || '—'}</TableCell>
                                    <TableCell className={`${TD} font-mono`}>{e.gstin || '—'}</TableCell>
                                    <TableCell className={TD}>{e.reason}</TableCell>
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
                    <TableCell colSpan={7} className={`${TD} py-6 text-center text-muted-foreground`}>
                      No upload history yet for this return.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AdvanceSetoffGateDialog {...advanceGate.dialogProps} />
    </div>
  );
};

/**
 * A section tile: the KpiTile look (label, figure, hint) as a button that opens
 * the section's table. The label wraps to two lines — the portal's table names
 * are long and are the point of the tile.
 */
const SectionTile: React.FC<{ label: string; count: number; value?: string; active: boolean; onClick: () => void }> = ({ label, count, value, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-pressed={active}
    className={cn(
      'flex flex-col rounded-lg border bg-card px-3 py-1.5 text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active && 'border-primary/60 ring-2 ring-primary/60',
    )}
  >
    <span className="line-clamp-2 min-h-[2.2em] text-[11px] font-medium leading-tight text-muted-foreground">{label}</span>
    <span className={cn('text-[15px] font-semibold leading-tight tabular-nums', count === 0 && 'text-muted-foreground')}>{count.toLocaleString('en-IN')}</span>
    <span className="truncate text-[11px] leading-tight tabular-nums text-muted-foreground">{value ?? '\u00A0'}</span>
  </button>
);

export default GSTR1DataPage;
