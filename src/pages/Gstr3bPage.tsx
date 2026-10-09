import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileCheck2, Download, FileText, Loader2, FileJson, Send, CheckCircle2, XCircle, X, Lock, History, Info, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_TR_HEADING, WS_TR_TOTAL, WS_FILTER_LABEL, WS_CONTROL } from '@/components/workspace/theme';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchGstr3b } from '@/utils/fetchGstr3b';
import type { Gstr3bResult } from '@/utils/buildGstr3bJson';
import { exportGstr3bToPDF } from '@/utils/gstr3bPdf';
import { computeSuspendedRecoDiff } from '@/lib/suspendedRecoCalc';
import type { RecoDiffResult } from '@/lib/suspendedRecoCalc';
import { computeGstReceivableRecoDiff } from '@/lib/gstReceivableRecoCalc';
import AdvanceSetoffGateDialog from '@/components/advances/AdvanceSetoffGateDialog';
import { useAdvanceSetoffGate } from '@/hooks/useAdvanceSetoffGate';
import { effectiveFilingReturnType } from '@/lib/markFilingPushed';
import { classifyGstr3bPush, skipLabel, type Gstr3bPushOutcome } from '@/lib/gstr3bPushStatus';
import { diffGstr3b, summariseDiff } from '@/utils/gstReturnDiff';
import ReturnDiffTable from '@/components/dialogs/ReturnDiffTable';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface Client { id: string; name: string; gstin: string; regular_sub_type?: string | null; builder_itc_type?: string | null; registration_type?: string | null }

interface Gstr3bPushVersion {
  id: string;
  version_number: number;
  actor_id: string | null;
  actor_name?: string;
  action_at: string;
  status: string | null;
  summary: string | null;
  filled_count: number | null;
  skipped: string[] | null;
  payload: unknown | null;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShort = (mmYyyy: string) => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${MONTH_SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}` : '';
};
const inr = (n: number | undefined) =>
  (n || n === 0 ? Number(n) : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum3 = (t?: { igst: number; cgst: number; sgst: number }) => (t ? t.igst + t.cgst + t.sgst : 0);

// How a push reads, from its status and the free-text skips the extension
// reports (e.g. "4A(5) All other ITC col 2 — …"). The rule is the
// extension's own (src/lib/gstr3bPushStatus.ts), applied to every version's
// words: failed is red; partial, or an older 'ok' row with a skip that is not
// tolerated, amber; a clean fill green. 3.1(a)/(b) left to the portal are not
// a fault (the portal keeps what it filled from GSTR-1), so they no longer
// turn a push red.
type PushSeverity = 'ok' | 'warning' | 'critical';
const pushSeverity = (status: string | null | undefined, skipped: string[] | null | undefined): PushSeverity => {
  if (status === 'failed') return 'critical';
  if (status === 'partial') return 'warning';
  return classifyGstr3bPush({ ok: true, skipped }).realSkips.length ? 'warning' : 'ok';
};

// The draft as the extension types it: every amount to 2 decimals, the
// portal's own precision. A figure that is not a number comes from a broken
// source row and would be typed as text; a negative amount in Table 3.1 or 4
// is a sign error upstream (credit notes netted past zero, a reversal entered
// with its sign) that the portal rejects field by field, so neither is pushed.
// 4(C) is left out of the sign check: the extension never types it (the
// portal computes it), and reversals above the credit available make it
// negative legitimately.
const round2 = (n: number) => Math.round(n * 100) / 100;
const roundDraft = (v: unknown): unknown => {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : v;
  if (Array.isArray(v)) return v.map(roundDraft);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDraft(x)]));
  return v;
};
const DRAFT_ROWS: Record<string, string> = {
  osup_det: '3.1(a) Outward taxable supplies',
  osup_zero: '3.1(b) Zero rated supplies',
  osup_nil_exmp: '3.1(c) Nil rated and exempted supplies',
  isup_rev: '3.1(d) Inward supplies under reverse charge',
  osup_nongst: '3.1(e) Non-GST outward supplies',
  'itc_avl:IMPG': '4A(1) Import of goods',
  'itc_avl:IMPS': '4A(2) Import of services',
  'itc_avl:ISRC': '4A(3) Inward supplies under reverse charge',
  'itc_avl:ISD': '4A(4) Inward supplies from ISD',
  'itc_avl:OTH': '4A(5) All other ITC',
  'itc_rev:RUL': '4B(1) ITC reversed under rules 38, 42 and 43 and section 17(5)',
  'itc_rev:OTH': '4B(2) ITC reversed, others',
  itc_net: '4C Net ITC',
  'itc_rclmd:OTH': '4D(1) ITC reclaimed',
  'itc_inelg:RUL': '4D Ineligible ITC under section 17(5)',
  'itc_inelg:OTH': '4D(2) Ineligible ITC under section 16(4) and place of supply',
};
const DRAFT_FIELDS: Record<string, string> = {
  txval: 'taxable value', iamt: 'integrated tax', camt: 'central tax', samt: 'state/UT tax', csamt: 'cess',
  igst: 'integrated tax', cgst: 'central tax', sgst: 'state/UT tax', cess: 'cess',
};
const INTER_ROWS: Record<string, string> = {
  unreg_details: '3.2 Inter-state supplies to unregistered persons',
  comp_details: '3.2 Inter-state supplies to composition taxable persons',
  uin_details: '3.2 Inter-state supplies to UIN holders',
};
const draftCell = (path: string[]): string => {
  // itc_elg rows are keyed by their `ty` (itc_avl › IMPG › igst), 3.2 rows by their POS.
  const field = path[path.length - 1];
  const fieldWord = DRAFT_FIELDS[field] ?? field;
  if (path[0] === 'inter_sup' && INTER_ROWS[path[1]]) return `${INTER_ROWS[path[1]]} (${path[2]}), ${fieldWord}`;
  if (path[0] === 'inward_sup') {
    return `5 Exempt, nil rated and non-GST inward supplies (${path[2] === 'NONGST' ? 'non-GST' : 'GST'}), ${field === 'inter' ? 'inter-state' : field === 'intra' ? 'intra-state' : fieldWord}`;
  }
  const row = path[0] === 'itc_elg' && path.length === 4 ? `${path[1]}:${path[2]}` : path[1];
  return DRAFT_ROWS[row] ? `${DRAFT_ROWS[row]}, ${fieldWord}` : path.join(' › ');
};
const draftProblems = (json: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${draftCell(path)} is not a number`);
      else if (v < 0 && (path[0] === 'sup_details' || path[0] === 'itc_elg') && path[1] !== 'itc_net') {
        out.push(`${draftCell(path)} is negative (₹${inr(v)})`);
      }
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => {
        const o = (x && typeof x === 'object' ? x : {}) as { ty?: unknown; pos?: unknown };
        walk(x, [...path, o.ty !== undefined ? String(o.ty) : o.pos !== undefined ? `POS ${String(o.pos)}` : String(i + 1)]);
      });
    } else if (v && typeof v === 'object') {
      Object.entries(v).forEach(([k, x]) => walk(x, [...path, k]));
    }
  };
  walk(json, []);
  return out;
};

/** A push left without a result this long is given up on (the extension's own idle limit is 10 minutes). */
const PUSH_WATCHDOG_MS = 20 * 60 * 1000;

// 3.1(a) and (b) as a draft has them, for the note that the portal kept its own.
const draft31 = (json: unknown) => {
  const sup = (json as { sup_details?: Record<string, Record<string, number> | undefined> } | null)?.sup_details;
  if (!sup) return null;
  const a = sup.osup_det || {};
  const b = sup.osup_zero || {};
  return {
    a: { txval: Number(a.txval) || 0, igst: Number(a.iamt) || 0, cgst: Number(a.camt) || 0, sgst: Number(a.samt) || 0 },
    b: { txval: Number(b.txval) || 0, igst: Number(b.iamt) || 0 },
  };
};

// One line of a portal-style table (Particulars + up to four amount columns).
const TRow: React.FC<{ label: string; txval?: number; igst?: number; cgst?: number; sgst?: number; bold?: boolean }> = ({ label, txval, igst, cgst, sgst, bold }) => (
  <tr className={bold ? WS_TR_TOTAL : WS_TR}>
    <td className={WS_TD}>{label}</td>
    <td className={WS_TD_NUM}>{txval === undefined ? '' : inr(txval)}</td>
    <td className={WS_TD_NUM}>{igst === undefined ? '' : inr(igst)}</td>
    <td className={WS_TD_NUM}>{cgst === undefined ? '' : inr(cgst)}</td>
    <td className={WS_TD_NUM}>{sgst === undefined ? '' : inr(sgst)}</td>
  </tr>
);

// One line of Table 4 (Particulars + IGST/CGST/SGST). `kind` picks the
// heading / sub-row / total look; `indent` nests a sub-row under its heading.
const ItcRow: React.FC<{ label: string; igst: number; cgst: number; sgst: number; kind?: 'total' | 'row'; indent?: boolean }> = ({ label, igst, cgst, sgst, kind = 'row', indent }) => (
  <tr className={kind === 'total' ? WS_TR_HEADING : WS_TR}>
    <td className={`${WS_TD} ${indent ? 'pl-6' : ''}`}>{label}</td>
    <td className={WS_TD_NUM}>{inr(igst)}</td>
    <td className={WS_TD_NUM}>{inr(cgst)}</td>
    <td className={WS_TD_NUM}>{inr(sgst)}</td>
  </tr>
);

const TAX_TH = `${WS_TH} w-32 text-right`;

const THead: React.FC<{ first: string; taxable?: boolean }> = ({ first, taxable = true }) => (
  <thead>
    <tr>
      <th className={WS_TH}>{first}</th>
      {taxable && <th className={TAX_TH}>Taxable value</th>}
      <th className={TAX_TH}>Integrated tax</th>
      <th className={TAX_TH}>Central tax</th>
      <th className={TAX_TH}>State/UT tax</th>
    </tr>
  </thead>
);

const Gstr3bPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedClientId: selectedClient, setSelectedClientId: setSelectedClient } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { user, isStaffRole, canEditFilingStatus } = useAuth();
  const isStaff = isStaffRole();
  const [clients, setClients] = useState<Client[]>([]);
  const [result, setResult] = useState<Gstr3bResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // NIL Return flag, shared with GSTR-1's filing_status.is_nil mechanism.
  const [isNilReturn, setIsNilReturn] = useState(false);
  const [isTogglingNil, setIsTogglingNil] = useState(false);
  const confirm = useConfirm();

  // Same filing_status row GSTR-1 locks against — 'Filed' disables the push,
  // same reasoning: don't let the tool alter a draft behind what was already
  // submitted to GSTN.
  const [filingStatus, setFilingStatus] = useState<string | null>(null);
  const isFiled = filingStatus === 'Filed';
  // GSTR-3B can only genuinely be NIL if GSTR-1 for the same client/period
  // was also NIL — they cover the same underlying outward/inward activity.
  // Gate the checkbox on GSTR-1's own is_nil flag so it isn't offered (and
  // can't be mis-ticked) for a period that plainly has real supplies.
  const [gstr1IsNil, setGstr1IsNil] = useState(false);

  // The rows Filing Status shows: 'GSTR-3B (Q)' at an IFF client's quarter
  // end and its 'GSTR-1 (IFF)', else the plain types. Read off the plain rows,
  // an IFF client's status and NIL ticks were ones Filing Status never shows.
  const fetchFilingStatus = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setIsNilReturn(false); setFilingStatus(null); setGstr1IsNil(false); return; }
    const [type3b, type1] = await Promise.all([
      effectiveFilingReturnType(selectedClient, 'GSTR-3B', selectedMonth),
      effectiveFilingReturnType(selectedClient, 'GSTR-1', selectedMonth),
    ]);
    const [gstr3bRes, gstr1Res] = await Promise.all([
      supabase.from('filing_status').select('status, is_nil')
        .eq('client_id', selectedClient).eq('return_type', type3b).eq('period_month', selectedMonth).maybeSingle(),
      supabase.from('filing_status').select('is_nil')
        .eq('client_id', selectedClient).eq('return_type', type1).eq('period_month', selectedMonth).maybeSingle(),
    ]);
    setIsNilReturn(!!(gstr3bRes.data as any)?.is_nil);
    setFilingStatus(((gstr3bRes.data as any)?.status || null) as string | null);
    setGstr1IsNil(!!(gstr1Res.data as any)?.is_nil);
  }, [selectedClient, selectedMonth]);
  useEffect(() => { fetchFilingStatus(); }, [fetchFilingStatus]);

  const handleToggleNilReturn = async (checked: boolean) => {
    if (!selectedClient || !selectedMonth) return;
    setIsTogglingNil(true);
    setIsNilReturn(checked);
    try {
      const returnType = await effectiveFilingReturnType(selectedClient, 'GSTR-3B', selectedMonth);
      const { error } = await supabase
        .from('filing_status')
        .upsert(
          { client_id: selectedClient, return_type: returnType, period_month: selectedMonth, is_nil: checked, updated_by: user?.id ?? null },
          { onConflict: 'client_id,return_type,period_month' },
        );
      if (error) throw error;
      toast.success(checked ? 'Marked as NIL Return.' : 'NIL Return unmarked.');
    } catch (err: any) {
      setIsNilReturn(!checked);
      toast.error('Failed to update NIL Return: ' + err.message);
    } finally {
      setIsTogglingNil(false);
    }
  };

  // "Push to GST Portal" — extension-driven, mirrors the GSTR-1 upload bridge.
  // GSTR-3B has no offline-JSON path (it's a live web form), so this fills
  // Table 3.1 + Table 4 directly and stops before Confirm/Offset/File — the
  // human reviews and submits.
  const [extReady, setExtReady] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{
    status: Gstr3bPushOutcome;
    summary: string;
    /** Skips that are not tolerated: fields the staffer must enter on the portal. */
    realSkips: string[];
    /** 3.1(a)/(b): not typed, the portal keeps the values it filled from GSTR-1. */
    portalFilled: string[];
    /** The draft that was pushed, when this page pushed it. */
    draft: unknown;
  } | null>(null);
  // What the last push actually sent. A ref (not state) because the portal's
  // reply arrives on a window message whose handler must read the payload as it
  // was at push time, without re-rendering to get at it.
  const pushedPayloadRef = useRef<unknown>(null);

  // Push audit trail — one row per "Push to GST Portal" attempt, mirroring
  // GSTR-1's gstr1_upload_versions (see GSTR1DataPage.tsx / that migration).
  const [versions, setVersions] = useState<Gstr3bPushVersion[]>([]);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setVersions([]); return; }
    const { data } = await supabase
      .from('gstr3b_push_versions')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .order('version_number', { ascending: false });
    const rows = (data as any[]) || [];
    const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
    let nameMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles').select('user_id, first_name').in('user_id', actorIds);
      nameMap = new Map((profiles || []).map((p) => [p.user_id, p.first_name || 'Unknown']));
    }
    setVersions(rows.map((r) => ({ ...r, actor_name: r.actor_id ? (nameMap.get(r.actor_id) || 'Unknown') : 'System' })));
  }, [selectedClient, selectedMonth]);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

  // Only for a push the extension did not record itself (before 0.8.6, or its
  // own write failed). The database trigger on gstr3b_push_versions marks an
  // 'ok' row's return Pushed, on the row Filing Status shows; this page no
  // longer calls mark_filing_pushed, which would stamp it twice.
  const recordPushVersion = useCallback(async (v: { status: Gstr3bPushOutcome; summary: string; filledCount?: number; skipped?: string[] | null }) => {
    if (!selectedClient || !selectedMonth) return;
    const { error } = await supabase.from('gstr3b_push_versions').insert({
      client_id: selectedClient,
      period_month: selectedMonth,
      actor_id: user?.id ?? null,
      status: v.status,
      summary: v.summary,
      filled_count: v.filledCount ?? null,
      skipped: (v.skipped as any) ?? null,
      // The exact JSON this attempt pushed, so any two versions can be diffed
      // later to show which figure changed and who changed it. Captured at the
      // moment of the push, not re-derived — a re-derivation would reflect
      // today's data, which is precisely what the audit trail must not do.
      payload: (pushedPayloadRef.current as any) ?? null,
    });
    if (error) toast.warning('The push could not be saved to Push History, so it is not recorded in Filing Status: ' + error.message);
    fetchVersions();
    fetchFilingStatus();
  }, [selectedClient, selectedMonth, user?.id, fetchVersions, fetchFilingStatus]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPushGstr3bResult) {
        const r = d.__gstkPushGstr3bResult as {
          ok: boolean;
          status?: 'filled' | 'partial' | 'failed';
          summary?: string;
          error?: string;
          skipped?: string[];
          portalFilled?: string[];
          filled?: number;
          clientId?: string | null;
          period_month?: string | null;
          recorded?: boolean;
        };
        setIsPushing(false);
        const c = classifyGstr3bPush(r);
        // 0.8.6 names the return the push was for. One for another client or
        // month (the selection changed while the portal tab ran) belongs to
        // that return: nothing is written for the one shown here.
        if (r.clientId && r.period_month && (r.clientId !== selectedClient || r.period_month !== selectedMonth)) {
          const name = clients.find((x) => x.id === r.clientId)?.name || 'another client';
          const outcome = c.status === 'ok' ? 'filled' : c.status === 'partial' ? 'partly filled' : 'failed';
          toast.warning(
            `The GSTR-3B push for ${name} · ${toShort(r.period_month)} has finished (${outcome}). It belongs to that client and month, not the one shown here. `
            + (r.recorded
              ? 'It is recorded in that return\'s Push History.'
              : 'It was NOT recorded: open that client and month, check the portal and Push History.'),
            { duration: 20000 },
          );
          return;
        }
        const failed = c.status === 'failed';
        const summary = failed ? (r.error || r.summary || 'GSTR-3B push failed.') : (r.summary || 'GSTR-3B form filled.');
        if (c.status === 'ok') toast.success(summary);
        else if (c.status === 'partial') {
          toast.warning(`GSTR-3B partly filled: ${c.realSkips.length || 'some'} field(s) could not be set. It is not marked Pushed until a clean push.`, { duration: 15000 });
        } else toast.error(summary);
        setPushResult({ status: c.status, summary, realSkips: c.realSkips, portalFilled: c.portalFilled, draft: pushedPayloadRef.current });
        if (r.recorded) {
          // 0.8.6 wrote the Push History row itself, and the database trigger
          // records Pushed from an 'ok' row: read both back.
          fetchVersions();
          fetchFilingStatus();
        } else {
          recordPushVersion({
            status: c.status,
            summary,
            filledCount: r.filled,
            skipped: [...(r.skipped || []), ...(r.portalFilled || [])],
          });
        }
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
  }, [recordPushVersion, fetchVersions, fetchFilingStatus, clients, selectedClient, selectedMonth]);

  useEffect(() => { setPushResult(null); }, [selectedClient, selectedMonth]);

  // A push that never reports back (a closed tab or a dead end on an
  // extension before 0.8.6) must not leave the button spinning for ever.
  useEffect(() => {
    if (!isPushing) return;
    const t = setTimeout(() => {
      setIsPushing(false);
      toast.warning('No result from the browser extension after 20 minutes. Check the GST portal tab and Push History before pushing again.', { duration: 20000 });
    }, PUSH_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [isPushing]);

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    let cur = new Date(startDate);
    while (cur <= endDate) {
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      months.push({ value: `${mm}/${cur.getFullYear()}`, label: `${MONTH_SHORT[cur.getMonth()]} ${cur.getFullYear()}` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin, regular_sub_type, builder_itc_type, registration_type').order('name').then(({ data }) => setClients((data || []) as Client[]));
  }, []);

  const selectedClientData = clients.find((c) => c.id === selectedClient);
  const selectedClientName = selectedClientData?.name || '';

  const compute = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setResult(null); return; }
    setIsLoading(true);
    try {
      const gstin = clients.find((c) => c.id === selectedClient)?.gstin || '';
      setResult(await fetchGstr3b(selectedClient, gstin, selectedMonth));
    } catch (e: any) {
      toast.error('Failed to build GSTR-3B: ' + (e?.message || 'unknown'));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, selectedMonth, clients]);

  useEffect(() => { compute(); }, [compute]);

  // Reconciliation check — Suspended Reco and GST Receivable Reco each carry
  // their own live "DIFFERENCE" figure (opening + portal − books, Rs.10
  // tolerance applied). Neither is otherwise surfaced here, so a client could
  // get pushed to the portal with an unresolved balance mismatch and nobody
  // would know until someone happened to open those pages. A non-zero
  // difference DOES block Push (see hasRecoDiff below) — the comment here used
  // to say "advisory only, doesn't block Push", which had not been true since
  // the disabled= binding was added and sent people looking in the wrong place
  // when the button wouldn't press.
  const [recoCheck, setRecoCheck] = useState<{ suspended: RecoDiffResult | null; receivable: RecoDiffResult | null }>({ suspended: null, receivable: null });
  const [recoCheckLoading, setRecoCheckLoading] = useState(false);

  const checkReconciliation = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setRecoCheck({ suspended: null, receivable: null }); return; }
    setRecoCheckLoading(true);
    try {
      const [suspended, receivable] = await Promise.all([
        computeSuspendedRecoDiff(selectedClient, selectedMonth),
        computeGstReceivableRecoDiff(selectedClient, selectedMonth),
      ]);
      setRecoCheck({ suspended, receivable });
    } catch {
      // Advisory check — a failure here shouldn't block anything, just skip the banner.
      setRecoCheck({ suspended: null, receivable: null });
    } finally {
      setRecoCheckLoading(false);
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => { checkReconciliation(); }, [checkReconciliation]);

  // A NO-ITC promoter's Suspended Reco can never tie out, so it must not hold
  // up the push. Credit reversed under Rule 37A / s.16(2)(c) sits in the
  // portal's suspended balance until it is reclaimed; a promoter who elected
  // the 1%/5% scheme under Notification 3/2019-CTR never reclaims any of it
  // (ITC Summary pins Total 4B to Total 4A for these clients precisely so Net
  // ITC is 0 by construction). The books side accumulates reversals with no
  // portal-side balance to match them against, so the difference is
  // permanently non-zero through no error of the staff's and the Push button
  // stays disabled forever — reported on KRISHNA INFRA-NO ITC for Aug-2026, a
  // fixed -Rs 82,076.88 that nothing on the Suspended Reco page could clear.
  //
  // Same waiver, same two flags as the Filing Status gate — see
  // docs/2B_RECONCILIATION_FLOW.md §8. Builder AND NO_ITC: the waiver is about
  // the promoter scheme, not about a client having no ITC for some other
  // reason. The GST Receivable Reco half is NOT waived: its own calculation
  // already handles NO_ITC (gstReceivableRecoCalc.ts nets Total 4B against
  // Total 4A for these clients), so a difference there is a real finding and
  // still blocks.
  const isNoItcBuilder =
    selectedClientData?.regular_sub_type === 'Builder'
    && selectedClientData?.builder_itc_type === 'NO_ITC';
  const suspendedBlocks = !isNoItcBuilder && !!recoCheck.suspended && recoCheck.suspended.total !== 0;
  const receivableBlocks = !!recoCheck.receivable && recoCheck.receivable.total !== 0;

  const hasRecoDiff = suspendedBlocks || receivableBlocks;

  const s = result?.summary;

  const handleDownloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR3B_${(selectedClientData?.gstin || selectedClientName || 'client')}_${(selectedMonth || '').replace('/', '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('GSTR-3B JSON downloaded.');
  };

  const handleDownloadPdf = () => {
    if (!result) return;
    exportGstr3bToPDF({
      result,
      clientName: selectedClientName || 'Client',
      gstin: selectedClientData?.gstin || '',
      monthLabel: toShort(selectedMonth),
    });
  };

  // Advance set-off gate — the GSTR-3B call site. 3.1(a) is derived from the
  // GSTR-1 JSON (buildGstr3bJson), so a missing Table 11B understates this
  // return exactly as it does GSTR-1, and the same check has to stand here.
  // No persistDraft: the correction belongs on the GSTR-1 page, not this one.
  const advanceGate = useAdvanceSetoffGate({
    returnType: 'GSTR-3B',
    returnLabel: 'GSTR-3B push',
  });

  const handlePush = async () => {
    if (!result || !selectedClient || !selectedMonth) return;
    if (!extReady) {
      toast.error('Install / enable the GST Keeper browser extension to push from this page.');
      return;
    }
    if (!selectedClientData?.gstin) {
      toast.error('Selected client has no GSTIN on file.');
      return;
    }
    if (recoCheckLoading || hasRecoDiff) {
      toast.error('Resolve the Suspended Reco / GST Receivable Reco difference before pushing to the portal.');
      return;
    }
    // Every amount to 2 decimals, and nothing the portal would refuse (see roundDraft / draftProblems).
    const draft = roundDraft(result.json);
    const bad = draftProblems(draft);
    if (bad.length) {
      toast.error(
        `This GSTR-3B draft cannot be pushed: ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? `; and ${bad.length - 4} more` : ''}. `
        + 'Correct the source (GSTR-1, ITC Summary, RCM or GSTR-3B Adjustments) and push again.',
        { duration: 20000 },
      );
      return;
    }
    // With no ITC Summary, Table 4 is all zero (buildGstr3bJson's flag), and
    // the extension types those zeros over the ITC the portal filled from
    // GSTR-2B. Sometimes right (a period with no credit), so it asks.
    if (result.flags.some((f) => f.startsWith('No ITC Summary'))) {
      const go = await confirm({
        title: 'No ITC Summary for this period',
        description: 'There is no ITC Summary for this period, so Table 4 would be typed as 0 and overwrite the ITC the portal filled from GSTR-2B. Push anyway?',
        confirmText: 'Push anyway',
        destructive: true,
      });
      if (!go) return;
    }
    // The check reads the GSTR-1 JSON this 3B was built from — that is where
    // Table 11A/11B live.
    const { data: g1 } = await supabase
      .from('gstr1_data')
      .select('raw_json')
      .eq('client_id', selectedClient)
      .eq('period_month', toShort(selectedMonth))
      .maybeSingle();
    const advanceOk = await advanceGate.evaluate({
      clientId: selectedClient,
      clientName: selectedClientData?.name || '',
      gstin: selectedClientData.gstin,
      periodMonth: selectedMonth,
      draftJson: (g1 as { raw_json?: unknown } | null)?.raw_json ?? null,
      regularSubType: selectedClientData?.regular_sub_type,
      registrationType: selectedClientData?.registration_type,
    });
    if (!advanceOk) return;

    setIsPushing(true);
    setPushResult(null);
    pushedPayloadRef.current = draft;
    window.postMessage(
      {
        __gstkPushGstr3b: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
          gstr3bJson: draft,
        },
      },
      '*'
    );
    toast.info('Opening the GST portal in a new tab — clear the CAPTCHA and let the fill run. It stops before Confirm/Offset/File; review and submit yourself.');
  };

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="GSTR-3B"
        subtitle="Draft GSTR-3B assembled from GSTR-1, ITC Summary and RCM — client-wise & month-wise"
        icon={<FileCheck2 />}
        actions={result ? (
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={handleDownloadJson}>
              <FileJson className="h-3.5 w-3.5" /> JSON
            </Button>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={handleDownloadPdf}>
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
            {isStaff && (
              <Button
                onClick={handlePush}
                size="sm"
                disabled={isPushing || !extReady || isFiled || recoCheckLoading || hasRecoDiff}
                className={WS_BTN}
                title={
                  isFiled
                    ? 'GSTR-3B already Filed for this period — push is locked'
                    : recoCheckLoading
                      ? 'Checking Suspended Reco / GST Receivable Reco…'
                      : hasRecoDiff
                        ? 'Suspended Reco / GST Receivable Reco difference must be resolved before pushing'
                        : !extReady
                          ? 'Install / enable the GST Keeper browser extension'
                          : 'Fills Table 3.1 + Table 4 on the live GSTR-3B form; stops before Confirm/Offset/File'
                }
              >
                {isPushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {isPushing ? 'Pushing…' : 'Push to GST Portal'}
              </Button>
            )}
          </>
        ) : undefined}
      />

      {/* Filters — client / period, NIL flag and push history in one compact row */}
      <Card className="px-3 py-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div className="w-full space-y-0.5 sm:w-60">
            <div className={WS_FILTER_LABEL}>Client</div>
            <SearchableSelect
              options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
              value={selectedClient}
              onValueChange={setSelectedClient}
              placeholder="Select Client"
              searchPlaceholder="Type to search clients..."
              emptyText="No clients found."
              className={WS_CONTROL}
            />
          </div>
          <div className="w-40 space-y-0.5">
            <div className={WS_FILTER_LABEL}>Return period</div>
            <SearchableMonthSelect
              options={monthOptions}
              value={selectedMonth}
              onValueChange={setSelectedMonth}
              placeholder="Select Month"
              className={WS_CONTROL}
            />
          </div>
          {isStaff && selectedClient && selectedMonth && gstr1IsNil && (
            <div className="flex h-8 items-center gap-2" title="This period had zero activity for GSTR-3B.">
              <Checkbox
                id="gstr3b-nil-return"
                checked={isNilReturn}
                disabled={!canEditFilingStatus() || isFiled || isTogglingNil}
                onCheckedChange={(v) => handleToggleNilReturn(!!v)}
              />
              <label htmlFor="gstr3b-nil-return" className="cursor-pointer select-none text-xs font-medium">
                NIL Return
              </label>
            </div>
          )}
          {selectedClient && selectedMonth && (
            <Button
              variant="outline"
              size="sm"
              className={WS_BTN}
              onClick={() => setVersionHistoryOpen(true)}
              title={versions.length === 0
                ? 'No push history yet for this return'
                : `${versions.length} recorded push(es) for this return`}
            >
              <History className="h-3.5 w-3.5" />
              Push History{versions.length > 0 ? ` (${versions.length})` : ''}
            </Button>
          )}
          {versions.length > 0 && (
            <p className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto">
              <span>
                Last pushed by <span className="font-medium text-foreground">{versions[0].actor_name || '—'}</span> on{' '}
                {new Date(versions[0].action_at).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
              {versions[0].status && (
                <Badge variant={versions[0].status === 'ok' ? 'success' : versions[0].status === 'partial' ? 'warning' : 'destructive'} className="text-[10px] font-medium">
                  {versions[0].status === 'ok' ? 'succeeded' : versions[0].status === 'partial' ? 'partly filled' : 'failed'}
                </Badge>
              )}
            </p>
          )}
        </div>
      </Card>

      {/* Return is Filed — matches GSTR-1's lock: don't let the tool push a
          draft behind what was already submitted to GSTN. */}
      {isFiled && (
        <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs text-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">GSTR-3B already Filed for this period.</span>{' '}
            <span className="text-muted-foreground">Push to GST Portal is locked to preserve the record of what was actually filed.</span>
          </div>
          <Badge variant="success" className="shrink-0 text-[10px] font-medium">Filed</Badge>
        </div>
      )}

      {/* Reconciliation difference — Suspended Reco and/or GST Receivable Reco
          don't tie out for this client/period. Advisory, not a block: staff
          should look before filing, but the push itself isn't held up. */}
      {!recoCheckLoading && selectedClient && selectedMonth && hasRecoDiff && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold text-destructive">Reconciliation difference found — Push to GST Portal is locked</p>
            {suspendedBlocks && (
              <p>
                <span className="font-medium">Suspended Reco</span> difference: <span className="font-semibold tabular-nums">₹{inr(recoCheck.suspended!.total)}</span> (2B and RCM → Suspended Reco).
              </p>
            )}
            {receivableBlocks && (
              <p>
                <span className="font-medium">GST Receivable Reco</span> difference: <span className="font-semibold tabular-nums">₹{inr(recoCheck.receivable!.total)}</span>.
              </p>
            )}
            <p className="text-muted-foreground">Resolve the difference on the relevant page to unlock the push.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {suspendedBlocks && (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate('/2b-and-rcm')}>Suspended Reco</Button>
            )}
            {receivableBlocks && (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate('/itc-summary')}>GST Receivable Reco</Button>
            )}
          </div>
        </div>
      )}

      {/* GSTR-3B Adjustments module — this draft already includes N manual
          rows (a GSTR-1A amendment, a prior-period true-up, etc.); flag it
          plainly rather than let it blend in silently. */}
      {result && (result.adjustmentsApplied > 0 || result.adjustmentsUnmapped > 0) && (
        <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-2.5 py-1.5 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            {result.adjustmentsApplied > 0 && (
              <p className="text-foreground">
                {result.adjustmentsApplied} manual adjustment{result.adjustmentsApplied === 1 ? '' : 's'} from GSTR-3B
                Adjustments {result.adjustmentsApplied === 1 ? 'is' : 'are'} included in the totals below.
              </p>
            )}
            {result.adjustmentsUnmapped > 0 && (
              <p className="mt-0.5 font-medium text-destructive">
                {result.adjustmentsUnmapped} more, tagged "Other", could NOT be mapped into a table and are excluded — review them.
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" className={`${WS_BTN} shrink-0`} onClick={() => navigate('/gstr3b-adjustments')}>
            Review
          </Button>
        </div>
      )}

      {/* Draft-quality flags from buildGstr3bJson() — e.g. "No GSTR-1 data",
          "No ITC Summary". These already exist and are already shown on the
          client-facing preview dialog (Gstr3bPreviewDialog.tsx); they were
          never surfaced here, so a client with a Filed GSTR-1 but no
          gstr1_data row silently drafted a ₹0 GSTR-3B with nothing to explain
          why. Data-gap flags (the ones that only fire when something is
          actually missing) lead the list, ahead of the two routine
          boilerplate notes (4D itc_inelg mapping, Table 5 not computed) that
          buildGstr3bJson() pushes on every single computation regardless of
          data completeness. */}
      {result && result.flags.length > 0 && (() => {
        const isDataGapFlag = (f: string) => f.startsWith('No GSTR-1 data') || f.startsWith('No ITC Summary');
        const dataGapFlags = result.flags.filter(isDataGapFlag);
        const routineFlags = result.flags.filter((f) => !isDataGapFlag(f));
        return (
          <Note tone="warn">
            <div className="space-y-0.5">
              <p className="font-semibold">Review before filing</p>
              {dataGapFlags.map((f, i) => (
                <p key={`gap-${i}`} className="font-medium">• {f}</p>
              ))}
              {routineFlags.map((f, i) => (
                <p key={`routine-${i}`} className="text-muted-foreground">• {f}</p>
              ))}
            </div>
          </Note>
        );
      })()}

      {/* Push-to-portal result — what got filled, what didn't, and the
          standing reminder that Table 5 / 4(D)(1) are never touched. */}
      {pushResult && (() => {
        // Partial (a field the extension could not set) is never green: the
        // return is not Pushed until a clean push. 3.1(a)/(b) left to the
        // portal are not a fault, but their figures are the portal's, so the
        // draft's own are shown beside the note to compare before filing.
        const severity: PushSeverity = pushResult.status === 'failed' ? 'critical' : pushResult.status === 'partial' ? 'warning' : 'ok';
        const leftToPortal = Array.from(new Set(pushResult.portalFilled.map((s) => skipLabel(s).split(' ')[0])));
        const own31 = leftToPortal.length > 0 ? draft31(pushResult.draft ?? result?.json) : null;
        const styles: Record<PushSeverity, string> = {
          ok: 'border-success/40 bg-success/10',
          warning: 'border-warning/40 bg-warning/10',
          critical: 'border-destructive/40 bg-destructive/5',
        };
        const iconTone: Record<PushSeverity, string> = { ok: 'text-success', warning: 'text-warning', critical: 'text-destructive' };
        const Icon = severity === 'ok' ? CheckCircle2 : severity === 'warning' ? AlertTriangle : XCircle;
        return (
          <div className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs text-foreground ${styles[severity]}`}>
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconTone[severity]}`} />
            <div className="min-w-0 flex-1">
              <p className="break-words">{pushResult.summary}</p>
              {pushResult.status === 'partial' && (
                <p className="mt-0.5 font-semibold text-warning">
                  {pushResult.realSkips.length || 'Some'} field(s) could not be set: enter {pushResult.realSkips.length === 1 ? 'it' : 'them'} on the portal before Confirm / Offset Liability / File.
                  {' '}Not marked Pushed in Filing Status until a clean push.
                </p>
              )}
              {pushResult.realSkips.length > 0 && (
                <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
                  {pushResult.realSkips.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              {leftToPortal.length > 0 && (
                <p className="mt-1 break-words">
                  <span className="font-medium">{leftToPortal.join(' and ')} {leftToPortal.length === 1 ? 'was' : 'were'} not typed:</span>
                  {' '}the portal keeps the values it filled from GSTR-1. Compare them with this draft before filing
                  {own31 ? (
                    <>
                      {': '}3.1(a) taxable value <span className="tabular-nums">₹{inr(own31.a.txval)}</span>, tax{' '}
                      <span className="tabular-nums">₹{inr(own31.a.igst + own31.a.cgst + own31.a.sgst)}</span>{' '}
                      (IGST ₹{inr(own31.a.igst)}, CGST ₹{inr(own31.a.cgst)}, SGST ₹{inr(own31.a.sgst)});
                      {' '}3.1(b) taxable value <span className="tabular-nums">₹{inr(own31.b.txval)}</span>, IGST{' '}
                      <span className="tabular-nums">₹{inr(own31.b.igst)}</span>.
                    </>
                  ) : '.'}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0" onClick={() => setPushResult(null)} aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })()}

      {isLoading ? (
        <Card className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Building GSTR-3B…
        </Card>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<FileCheck2 className="h-5 w-5" />}
              title="No client or month selected"
              description="Select a client and a return period above to build the GSTR-3B."
            />
          </CardContent>
        </Card>
      ) : !s ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<FileCheck2 className="h-5 w-5" />}
              title="Nothing to show"
              description="No source data found for this client and period."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <KpiTile label="Output Tax (3.1a)" value={`₹${inr(sum3(s.outward))}`} hint="IGST + CGST + SGST" />
            <KpiTile label="RCM Liability (3.1d)" value={`₹${inr(sum3(s.rcmLiability))}`} hint="Inward supplies under reverse charge" />
            <KpiTile label="Total Tax Liability" value={`₹${inr(sum3(s.totalLiability))}`} hint="3.1 (a) + (d)" />
            <KpiTile label="Net ITC (4C)" value={`₹${inr(sum3(s.itcNet))}`} hint="ITC available − reversed" tone="ok" />
          </div>

          {/* 3.1 Outward + inward RCM */}
          <SectionCard title="3.1 Details of outward supplies and inward supplies liable to reverse charge">
            <div className={WS_TABLE_WRAP}>
              <table className={`${WS_TABLE} min-w-[720px]`}>
                <THead first="Nature of supplies" />
                <tbody>
                  <TRow label="(a) Outward taxable supplies (other than zero rated, nil rated and exempted)" txval={s.outward.txval} igst={s.outward.igst} cgst={s.outward.cgst} sgst={s.outward.sgst} />
                  <TRow label="(b) Outward taxable supplies (zero rated)" txval={s.zeroRated.txval} igst={s.zeroRated.igst} cgst={0} sgst={0} />
                  <TRow label="(c) Other outward supplies (nil rated, exempted)" txval={s.nilExempt} igst={0} cgst={0} sgst={0} />
                  <TRow label="(d) Inward supplies (liable to reverse charge)" txval={s.rcmLiability.txval} igst={s.rcmLiability.igst} cgst={s.rcmLiability.cgst} sgst={s.rcmLiability.sgst} />
                  <TRow label="(e) Non-GST outward supplies" txval={s.nonGst} igst={0} cgst={0} sgst={0} />
                  <TRow label="Total tax liability (a + d)" igst={s.totalLiability.igst} cgst={s.totalLiability.cgst} sgst={s.totalLiability.sgst} bold />
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* 4. Eligible ITC */}
          <SectionCard title="4. Eligible ITC">
            <div className={WS_TABLE_WRAP}>
              <table className={`${WS_TABLE} min-w-[620px]`}>
                <THead first="Details" taxable={false} />
                <tbody>
                  <ItcRow kind="total" label="(A) ITC Available (whether in full or part)" igst={s.itcAvailable.igst} cgst={s.itcAvailable.cgst} sgst={s.itcAvailable.sgst} />
                  {s.itcAvailableRows.map((r) => (
                    <ItcRow key={r.srNo} indent label={`${r.srNo} ${r.label}`} igst={r.igst} cgst={r.cgst} sgst={r.sgst} />
                  ))}
                  <ItcRow kind="total" label="(B) ITC reversed" igst={s.itcReversed.igst} cgst={s.itcReversed.cgst} sgst={s.itcReversed.sgst} />
                  {s.itcReversedRows.map((r) => (
                    <ItcRow key={r.srNo} indent label={`${r.srNo} ${r.label}`} igst={r.igst} cgst={r.cgst} sgst={r.sgst} />
                  ))}
                  <tr className={WS_TR_TOTAL}>
                    <td className={WS_TD}>(C) Net ITC available (A − B)</td>
                    <td className={WS_TD_NUM}>{inr(s.itcNet.igst)}</td>
                    <td className={WS_TD_NUM}>{inr(s.itcNet.cgst)}</td>
                    <td className={WS_TD_NUM}>{inr(s.itcNet.sgst)}</td>
                  </tr>
                  <tr className={WS_TR_HEADING}><td className={WS_TD} colSpan={4}>(D) Other Details</td></tr>
                  {s.itcOtherDetails.map((d) => (
                    <ItcRow key={d.srNo} indent label={`${d.srNo} ${d.label}`} igst={d.igst} cgst={d.cgst} sgst={d.sgst} />
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>GSTR-3B push history — {selectedClientName || '—'} · {toShort(selectedMonth)}</DialogTitle>
            <DialogDescription>
              Every "Push to GST Portal" attempt for this return, with what got filled, what didn't,
              and which figures changed since the previous attempt.
            </DialogDescription>
          </DialogHeader>
          <div className={`max-h-[65vh] ${WS_TABLE_WRAP}`}>
            <Table className="text-xs">
              <TableHeader className="sticky top-0 z-10 bg-muted [&_th]:h-8 [&_th]:px-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="w-16">V#</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="w-24">Skipped</TableHead>
                  <TableHead className="w-28">Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td]:px-2 [&_td]:py-1.5">
                {versions.map((v, idx) => {
                  const severity: PushSeverity = pushSeverity(v.status, v.skipped);
                  // versions are ordered newest first, so the version this one
                  // is compared against is the next entry in the list.
                  const prev = versions[idx + 1];
                  const canDiff = !!v.payload && !!prev?.payload;
                  const diffRows = canDiff ? diffGstr3b(prev.payload, v.payload) : [];
                  const statusVariant = v.status === 'ok'
                    ? (severity === 'ok' ? 'success' : 'warning')
                    : v.status === 'partial' ? 'warning' : v.status === 'failed' ? 'destructive' : 'secondary';
                  const viewButtonClass = severity === 'critical' ? 'text-destructive hover:text-destructive' : severity === 'warning' ? 'text-warning hover:text-warning' : '';
                  return (
                  <React.Fragment key={v.id}>
                    <TableRow>
                      <TableCell className="font-mono">v{v.version_number}</TableCell>
                      <TableCell>{v.actor_name || '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(v.action_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant} className="text-[10px] font-medium">
                          {v.status === 'ok' ? `Filled ${v.filled_count ?? 0}` : v.status === 'partial' ? `Partly filled ${v.filled_count ?? 0}` : v.status || '—'}
                        </Badge>
                        {severity === 'critical' && <AlertTriangle className="inline-block h-3.5 w-3.5 ml-1 text-destructive" />}
                      </TableCell>
                      <TableCell className="text-xs max-w-md">{v.summary || '—'}</TableCell>
                      <TableCell>
                        {v.skipped && v.skipped.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 text-xs ${viewButtonClass}`}
                            onClick={() => setExpandedVersionId(expandedVersionId === v.id ? null : v.id)}
                          >
                            {expandedVersionId === v.id ? 'Hide' : `View (${v.skipped.length})`}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canDiff ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 text-xs ${diffRows.length > 0 ? 'text-warning hover:text-warning' : ''}`}
                            onClick={() => setExpandedDiffId(expandedDiffId === v.id ? null : v.id)}
                            title={`Compare this push against v${prev.version_number}`}
                          >
                            {expandedDiffId === v.id ? 'Hide' : summariseDiff(diffRows)}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs" title={v.payload ? 'Nothing earlier to compare against' : 'This push predates change tracking'}>
                            {v.payload ? 'First push' : '—'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedVersionId === v.id && v.skipped && v.skipped.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/40 p-3">
                          <ul className="text-xs list-disc pl-4 space-y-0.5">
                            {v.skipped.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </TableCell>
                      </TableRow>
                    )}
                    {expandedDiffId === v.id && canDiff && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/40 p-3">
                          <p className="text-xs text-muted-foreground mb-2">
                            What <span className="font-mono">v{v.version_number}</span> ({v.actor_name || '—'}) changed
                            against <span className="font-mono">v{prev.version_number}</span> ({prev.actor_name || '—'}).
                          </p>
                          <ReturnDiffTable rows={diffRows} againstLabel={`v${prev.version_number}`} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                  );
                })}
                {versions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      No pushes recorded yet for this return.
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

export default Gstr3bPage;
