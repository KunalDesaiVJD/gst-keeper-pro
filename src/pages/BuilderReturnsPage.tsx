import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { BuilderSectionHeader } from '@/components/builder/BuilderSectionHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import {
  WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE, WS_TABLE_WRAP, WS_TR_HEADING, WS_TR_TOTAL,
} from '@/components/workspace/theme';
import { B_TABLE, B_TD, B_TD_NUM, B_TH, B_TH_NUM, B_TR, B_TR_HEAD } from '@/components/builder/theme';
import { useBuilderEmbedded } from '@/contexts/BuilderWorkspaceContext';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  FileSpreadsheet, Loader2, Info, CheckCircle2, AlertTriangle, ShieldAlert, Send, ExternalLink, Wallet,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  NO_BLOCK, blockOf, blocksIn, inTable, rateKey, returnsUnitWiseReport, unitLines,
  type ReturnTableKey, type UnitPosting,
} from '@/utils/builderReturnsUnitWise';
import { downloadReportXlsx } from '@/lib/reportExport/excel';
import { downloadReportPdf } from '@/lib/reportExport/pdf';
import { useNavigate } from 'react-router-dom';
import { formatINR, type BuilderRateCode } from '@/utils/builderRates';
import {
  prettyPeriodLabel, summarisePeriod,
  type PostingRow, type RateBucket,
} from '@/utils/builderLedger';
import type { BuilderGstr1Result } from '@/utils/builderGstr1';
import {
  previewBuilderGstr1, saveBuilderGstr1, fetchGstr1Status, type Gstr1Status,
} from '@/lib/builderGstr1Data';
import { isFsiConsentBlocked } from '@/lib/builderFsiData';
import { runAutoReclassSweep } from '@/lib/builderAdjustmentsData';
import { fetchBuilderOutputTaxSplit, fetchNetItcAvailable } from '@/lib/builderItcCashData';
import { computeItcCashWorkingPaper, type ItcCashWorkingPaper } from '@/utils/builderItcCash';

type PostingSource =
  | 'ADVANCE_11A' | 'ADVANCE_11B' | 'OPENING_11B' | 'INVOICE_B2CS'
  | 'CREDIT_NOTE' | 'RECLASS_10_OLD' | 'RECLASS_10_NEW' | 'BOUNCE_REVERSAL' | 'CANCELLATION_OFFSET';

interface PostingDbRow {
  source_id: string;
  source_type: PostingSource;
  gstr1_table: string;
  client_id: string;
  project_id: string;
  unit_id: string;
  unit_no: string;
  period_month: string;
  doc_date: string;
  rate_code: BuilderRateCode;
  rate_pct: number;
  consideration: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  land_deduction: number;
}

const SOURCE_LABEL: Record<PostingSource, string> = {
  ADVANCE_11A: 'Advance received',
  ADVANCE_11B: 'Advance adjusted',
  OPENING_11B: 'Opening balance adjusted',
  INVOICE_B2CS: 'Invoice',
  CREDIT_NOTE: 'Credit note',
  RECLASS_10_OLD: 'Re-rating — old rate reversed',
  RECLASS_10_NEW: 'Re-rating — at correct rate',
  BOUNCE_REVERSAL: 'Bounce reversal',
  CANCELLATION_OFFSET: 'Cancellation offset',
};

/** Rate-wise table shared by all four sections. */
const BucketTable: React.FC<{
  buckets: RateBucket[]; emptyText: string;
  /** The postings behind these buckets, for the unit-wise detail under each rate line. */
  postings?: UnitPosting[];
  blockLabel?: string;
}> = ({ buckets, emptyText, postings, blockLabel = 'Block' }) => {
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((prev) => {
    const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next;
  });
  if (!buckets.length) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  const total = buckets.reduce(
    (acc, b) => ({
      taxableValue: acc.taxableValue + b.taxableValue,
      cgst: acc.cgst + b.cgst,
      sgst: acc.sgst + b.sgst,
      landDeduction: acc.landDeduction + b.landDeduction,
    }),
    { taxableValue: 0, cgst: 0, sgst: 0, landDeduction: 0 },
  );
  return (
    <Table className={B_TABLE} containerClassName={WS_TABLE_WRAP}>
      <TableHeader>
        <TableRow className={B_TR_HEAD}>
          <TableHead className={B_TH}>Rate</TableHead>
          <TableHead className={B_TH_NUM}>Documents</TableHead>
          <TableHead className={B_TH_NUM}>Consideration</TableHead>
          <TableHead className={B_TH_NUM}>Non-GST (land)</TableHead>
          <TableHead className={B_TH_NUM}>Taxable value</TableHead>
          <TableHead className={B_TH_NUM}>CGST</TableHead>
          <TableHead className={B_TH_NUM}>SGST</TableHead>
          <TableHead className={B_TH_NUM}>Total tax</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((b) => {
          const k = `${b.rateCode}|${b.ratePct}`;
          const isOpen = open.has(k);
          const groups = isOpen && postings ? unitLines(postings.filter((p) => rateKey(p) === k)) : [];
          return (
          <React.Fragment key={k}>
          <TableRow className={cn(B_TR, postings && 'cursor-pointer')} onClick={postings ? () => toggle(k) : undefined}>
            <TableCell className={cn(B_TD, 'font-medium')}>
              {postings && (isOpen
                ? <ChevronDown className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />)}
              <span className="tabular-nums">{b.ratePct}%</span>
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">eff. {b.effectiveRatePct}%</span>
            </TableCell>
            <TableCell className={B_TD_NUM}>{b.count}</TableCell>
            <TableCell className={B_TD_NUM}>{formatINR(b.consideration)}</TableCell>
            <TableCell className={cn(B_TD_NUM, 'text-muted-foreground')}>{formatINR(b.landDeduction)}</TableCell>
            <TableCell className={cn(B_TD_NUM, 'font-medium')}>{formatINR(b.taxableValue)}</TableCell>
            <TableCell className={B_TD_NUM}>{formatINR(b.cgst)}</TableCell>
            <TableCell className={B_TD_NUM}>{formatINR(b.sgst)}</TableCell>
            <TableCell className={cn(B_TD_NUM, 'font-medium')}>{formatINR(b.totalTax)}</TableCell>
          </TableRow>
          {groups.map((g) => (
            <React.Fragment key={`${k}-${g.block}`}>
              {g.units.map((u) => (
                <TableRow key={u.unitId} className="bg-muted/20 text-[12px] hover:bg-muted/30">
                  <TableCell className={cn(B_TD, 'pl-8')}>
                    <span className="font-medium">{u.unitNo}</span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{u.tables.join(', ')}</span>
                  </TableCell>
                  <TableCell className={B_TD_NUM}>{u.docs}</TableCell>
                  <TableCell className={B_TD_NUM}>{formatINR(u.consideration)}</TableCell>
                  <TableCell className={cn(B_TD_NUM, 'text-muted-foreground')}>{formatINR(u.land)}</TableCell>
                  <TableCell className={B_TD_NUM}>{formatINR(u.taxable)}</TableCell>
                  <TableCell className={B_TD_NUM}>{formatINR(u.cgst)}</TableCell>
                  <TableCell className={B_TD_NUM}>{formatINR(u.sgst)}</TableCell>
                  <TableCell className={B_TD_NUM}>{formatINR(u.cgst + u.sgst)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 text-[12px] font-semibold hover:bg-muted/40">
                <TableCell className={cn(B_TD, 'pl-8')}>
                  {g.block === NO_BLOCK ? `No ${blockLabel.toLowerCase()}` : `${blockLabel} ${g.block}`} subtotal
                </TableCell>
                <TableCell className={B_TD_NUM}>{g.total.docs}</TableCell>
                <TableCell className={B_TD_NUM}>{formatINR(g.total.consideration)}</TableCell>
                <TableCell className={cn(B_TD_NUM, 'text-muted-foreground')}>{formatINR(g.total.land)}</TableCell>
                <TableCell className={B_TD_NUM}>{formatINR(g.total.taxable)}</TableCell>
                <TableCell className={B_TD_NUM}>{formatINR(g.total.cgst)}</TableCell>
                <TableCell className={B_TD_NUM}>{formatINR(g.total.sgst)}</TableCell>
                <TableCell className={B_TD_NUM}>{formatINR(g.total.cgst + g.total.sgst)}</TableCell>
              </TableRow>
            </React.Fragment>
          ))}
          </React.Fragment>
          );
        })}
        <TableRow className={cn(WS_TR_TOTAL, 'border-0 hover:bg-muted')}>
          <TableCell className={B_TD}>Total</TableCell>
          <TableCell className={B_TD} />
          <TableCell className={B_TD} />
          <TableCell className={cn(B_TD_NUM, 'text-muted-foreground')}>{formatINR(total.landDeduction)}</TableCell>
          <TableCell className={B_TD_NUM}>{formatINR(total.taxableValue)}</TableCell>
          <TableCell className={B_TD_NUM}>{formatINR(total.cgst)}</TableCell>
          <TableCell className={B_TD_NUM}>{formatINR(total.sgst)}</TableCell>
          <TableCell className={B_TD_NUM}>{formatINR(total.cgst + total.sgst)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
};

/**
 * Period workpaper: what the builder's outward side contributes to GSTR-1 and
 * 3B for one month.
 *
 * Only three outward tables can arise. Buyers are unregistered individuals, so
 * there is no Table 4A; and under s.12(3)(a) IGST Act the place of supply for a
 * service in relation to immovable property is the property's location, so with
 * a Gujarat GSTIN and Gujarat property every supply is intra-state — Table 5
 * (B2CL), CDNUR and 3B Table 3.2 are all unreachable.
 */
const BuilderReturnsPage: React.FC = () => {
  const { canViewBuilderReports, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const navigate = useNavigate();
  const embedded = useBuilderEmbedded();

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  // Block (A, B, C… from the unit number) filter over every table and the export.
  const [blockFilter, setBlockFilter] = useState<string>('ALL');
  const [gstr1Tab, setGstr1Tab] = useState<'table7' | 'table11A' | 'table11B' | 'docs'>('table7');
  const [rows, setRows] = useState<PostingDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /** BU_DIFFERENTIAL invoices' own milestone_label, keyed by invoice id — more
   *  specific than SOURCE_LABEL's generic "Invoice" (it says "BU differential"
   *  or "Dastavej differential", per the invoice's actual cut-off source). */
  const [invoiceLabels, setInvoiceLabels] = useState<Record<string, string>>({});

  // ── Return preparation state ──────────────────────────────────────────────
  // The preview is always built for the whole client, never the project filter:
  // GSTR-1 is filed per GSTIN, so the filter reads the workpaper but must not
  // shape what gets filed.
  const [preview, setPreview] = useState<BuilderGstr1Result | null>(null);
  const [fsiBlocked, setFsiBlocked] = useState(false);
  const [gstr1Status, setGstr1Status] = useState<Gstr1Status | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── ITC & cash working paper — firm policy, not portal mechanics ─────────
  const [itcCashPaper, setItcCashPaper] = useState<ItcCashWorkingPaper | null>(null);
  const [isLoadingItcCash, setIsLoadingItcCash] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clients').select('id, name, gstin')
        .eq('regular_sub_type', 'Builder').order('name');
      setClients((data || []) as { id: string; name: string; gstin: string | null }[]);
    })();
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setProjects([]); return; }
    (async () => {
      const { data } = await supabase
        .from('builder_projects').select('id, name').eq('client_id', selectedClientId).order('name');
      setProjects((data || []) as { id: string; name: string }[]);
      setProjectFilter('ALL');
    })();
  }, [selectedClientId]);

  const load = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) { setRows([]); return; }
    setIsLoading(true);
    try {
      let q = supabase
        .from('builder_period_postings').select('*')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);
      if (projectFilter !== 'ALL') q = q.eq('project_id', projectFilter);
      const { data, error } = await q;
      if (error) throw error;
      const postings = (data || []) as unknown as PostingDbRow[];
      setRows(postings);

      const invoiceIds = postings.filter((r) => r.source_type === 'INVOICE_B2CS').map((r) => r.source_id);
      if (invoiceIds.length) {
        const { data: inv } = await supabase.from('builder_invoices')
          .select('id, milestone_label').eq('invoice_type', 'BU_DIFFERENTIAL').in('id', invoiceIds);
        const labels: Record<string, string> = {};
        ((inv || []) as { id: string; milestone_label: string | null }[]).forEach((i) => {
          if (i.milestone_label) labels[i.id] = i.milestone_label;
        });
        setInvoiceLabels(labels);
      } else {
        setInvoiceLabels({});
      }
    } catch (e) {
      toast.error(`Could not load postings: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, selectedMonth, projectFilter]);

  useEffect(() => { void load(); }, [load]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  );

  /**
   * Refresh everything the "prepare" panel needs: what the return would contain,
   * whether an FSI consent is still outstanding, and what GSTR-1 already holds.
   */
  const refreshPrepare = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) {
      setPreview(null); setFsiBlocked(false); setGstr1Status(null);
      return;
    }
    try {
      const [built, blocked, status] = await Promise.all([
        previewBuilderGstr1({
          clientId: selectedClientId,
          gstin: selectedClient?.gstin ?? null,
          period: selectedMonth,
        }),
        isFsiConsentBlocked(selectedClientId, selectedMonth),
        fetchGstr1Status(selectedClientId, selectedMonth),
      ]);
      setPreview(built);
      setFsiBlocked(blocked);
      setGstr1Status(status);
    } catch (e) {
      toast.error(`Could not prepare the return: ${(e as Error).message}`);
    }
  }, [selectedClientId, selectedMonth, selectedClient?.gstin]);

  useEffect(() => { void refreshPrepare(); }, [refreshPrepare]);

  /**
   * The working paper only has something to say for a Partial-ITC client with
   * a saved ITC summary for the period — fetchNetItcAvailable returns null
   * otherwise, and the card below stays hidden rather than showing a
   * misleading zero.
   */
  useEffect(() => {
    if (!selectedClientId || !selectedMonth) { setItcCashPaper(null); return; }
    setIsLoadingItcCash(true);
    (async () => {
      try {
        const [netItc, split] = await Promise.all([
          fetchNetItcAvailable({ clientId: selectedClientId, periodMonth: selectedMonth }),
          fetchBuilderOutputTaxSplit({
            clientId: selectedClientId,
            periodMonth: selectedMonth,
            projectId: projectFilter !== 'ALL' ? projectFilter : null,
          }),
        ]);
        if (netItc === null) { setItcCashPaper(null); return; }
        setItcCashPaper(computeItcCashWorkingPaper({
          commercialOutputTax: split.commercialCgst + split.commercialSgst,
          residentialOutputTax: split.residentialCgst + split.residentialSgst,
          netItcAvailable: netItc.cgst + netItc.sgst,
        }));
      } catch (e) {
        toast.error(`Could not build the ITC & cash working paper: ${(e as Error).message}`);
        setItcCashPaper(null);
      } finally {
        setIsLoadingItcCash(false);
      }
    })();
  }, [selectedClientId, selectedMonth, projectFilter]);

  const handleGenerate = async () => {
    if (!selectedClientId || !selectedMonth) return;
    setIsGenerating(true);
    try {
      // Safety net: a filed-period crossing (§8) posts its Table 10 amendment
      // the moment it's detected, from wherever that's first noticed
      // (Bookings page, this page's own load); an unfiled period is simply
      // resynced to the current rate, no amendment involved. Re-run it here
      // too, for whichever project the crossing actually happened on, so the
      // return is never generated ahead of a correction it should already carry.
      const projectsToSweep = projectFilter !== 'ALL'
        ? [projectFilter]
        : projects.map((p) => p.id);
      for (const pid of projectsToSweep) {
        try {
          const { posted, resynced } = await runAutoReclassSweep(pid, user?.id ?? null);
          if (posted.length) {
            toast.success(
              `${posted.length} unit${posted.length === 1 ? '' : 's'} re-rated on a filed period crossing `
              + `₹45,00,000 before generating (${posted.map((c) => c.unitNo).join(', ')}).`,
            );
          }
          if (resynced.length) {
            toast.info(
              `${resynced.length} unit${resynced.length === 1 ? '' : 's'} resynced to the current rate on `
              + 'unfiled periods before generating — no amendment needed.',
            );
          }
        } catch (e) {
          toast.error(`Auto re-rating check failed for a project: ${(e as Error).message}`);
        }
      }

      const { result, blocked } = await saveBuilderGstr1({
        clientId: selectedClientId,
        gstin: selectedClient?.gstin ?? null,
        period: selectedMonth,
        userId: user?.id ?? null,
      });
      if (blocked.length) {
        toast.error(blocked[0].message);
        setPreview(result);
        return;
      }
      toast.success(`GSTR-1 generated for ${prettyPeriodLabel(selectedMonth)}.`);
      await refreshPrepare();
    } catch (e) {
      toast.error(`Could not generate: ${(e as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (fsiBlocked) {
      out.push('A TDR/FSI liability for this period is marked to be ignored, and the client\'s '
        + 'written consent is not yet on record and approved.');
    }
    (preview?.warnings || []).filter((w) => w.severity === 'BLOCK').forEach((w) => out.push(w.message));
    return out;
  }, [fsiBlocked, preview]);

  const cautions = useMemo(
    () => (preview?.warnings || []).filter((w) => w.severity === 'WARN').map((w) => w.message),
    [preview],
  );

  const allPostings = useMemo<UnitPosting[]>(() => rows.map((r) => ({
    source_type: r.source_type, gstr1_table: r.gstr1_table, unit_id: r.unit_id, unit_no: r.unit_no,
    rate_code: r.rate_code, rate_pct: Number(r.rate_pct) || 0,
    consideration: Number(r.consideration) || 0, taxable_value: Number(r.taxable_value) || 0,
    cgst: Number(r.cgst) || 0, sgst: Number(r.sgst) || 0, land_deduction: Number(r.land_deduction) || 0,
  })), [rows]);
  const blockOptions = useMemo(() => blocksIn(allPostings), [allPostings]);
  useEffect(() => { if (blockFilter !== 'ALL' && !blockOptions.includes(blockFilter)) setBlockFilter('ALL'); }, [blockOptions, blockFilter]);
  const shownRows = useMemo(
    () => (blockFilter === 'ALL' ? rows : rows.filter((r) => blockOf(r.unit_no) === blockFilter)),
    [rows, blockFilter],
  );
  const shownPostings = useMemo(
    () => (blockFilter === 'ALL' ? allPostings : allPostings.filter((p) => blockOf(p.unit_no) === blockFilter)),
    [allPostings, blockFilter],
  );
  const postingsOf = (key: ReturnTableKey) => shownPostings.filter(inTable(key));
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (!selectedClient) return;
    setIsExporting(true);
    try {
      const table = returnsUnitWiseReport({
        clientName: selectedClient.name,
        gstin: selectedClient.gstin,
        periodLabel: prettyPeriodLabel(selectedMonth),
        projectLabel: projectFilter === 'ALL' ? 'All projects' : (projects.find((p) => p.id === projectFilter)?.name || ''),
        blockLabel: 'Block',
        blockFilter: blockFilter === 'ALL' ? 'All' : blockFilter,
        postings: shownPostings,
      });
      await (format === 'pdf' ? downloadReportPdf : downloadReportXlsx)(table);
    } catch (e) {
      toast.error(`Could not export: ${(e as Error).message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const summary = useMemo(
    () => summarisePeriod(shownRows.map((r) => ({
      source_type: r.source_type,
      gstr1_table: r.gstr1_table,
      rate_code: r.rate_code,
      rate_pct: Number(r.rate_pct) || 0,
      consideration: Number(r.consideration) || 0,
      taxable_value: Number(r.taxable_value) || 0,
      cgst: Number(r.cgst) || 0,
      sgst: Number(r.sgst) || 0,
      land_deduction: Number(r.land_deduction) || 0,
    } as PostingRow))),
    [shownRows],
  );

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = -18; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const v = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      out.push({ value: v, label: prettyPeriodLabel(v) });
    }
    return out;
  }, []);

  if (!canViewBuilderReports()) {
    return (
      <Card>
        <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
          You do not have permission to view builder reports.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={WS_PAGE}>
      <BuilderSectionHeader
        compact
        embedded={embedded}
        title="Builder Returns Workpaper"
        subtitle="What the builder's outward side contributes to GSTR-1 and 3B for the period"
        icon={<FileSpreadsheet />}
      />

      <Card>
        <CardContent className="px-3 py-2">
          {/* One row: filters left, exports right (the house layout of every Builder step). */}
          <div className="flex flex-wrap items-end gap-2">
            {!embedded && (
              <label className="w-full min-w-0 space-y-0.5 sm:w-72">
                <span className={WS_FILTER_LABEL}>Builder client</span>
                <SearchableSelect
                  options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
                  value={selectedClientId || ''}
                  onValueChange={setSelectedClientId}
                  placeholder="Search builder client..."
                  searchPlaceholder="Type to search..."
                  emptyText="No builder clients found."
                  className={WS_CONTROL}
                />
              </label>
            )}
            {!embedded && (
              <label className="w-full min-w-0 space-y-0.5 sm:w-44">
                <span className={WS_FILTER_LABEL}>Period</span>
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select period"
                  className={WS_CONTROL}
                />
              </label>
            )}
            <label className="w-full min-w-0 space-y-0.5 sm:w-56">
              <span className={WS_FILTER_LABEL}>Project</span>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className={WS_CONTROL} aria-label="Project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="w-full min-w-0 space-y-0.5 sm:w-40">
              <span className={WS_FILTER_LABEL}>Block</span>
              <Select value={blockFilter} onValueChange={setBlockFilter}>
                <SelectTrigger className={WS_CONTROL} aria-label="Block"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All blocks</SelectItem>
                  {blockOptions.map((b) => (
                    <SelectItem key={b} value={b}>{b === NO_BLOCK ? 'No block' : `Block ${b}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          {selectedClientId && rows.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className={WS_BTN} disabled={isExporting} onClick={() => void handleExport('xlsx')}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel (unit-wise)
              </Button>
              <Button variant="outline" size="sm" className={WS_BTN} disabled={isExporting} onClick={() => void handleExport('pdf')}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export PDF (unit-wise)
              </Button>
            </div>
          )}
          </div>
          {selectedClientId && rows.length > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">Click a rate line in any table to see its units, block by block.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Prepare and hand off to GSTR-1 ─────────────────────────────────── */}
      {selectedClientId && (
        <SectionCard
          className="border-primary/30"
          title={`Prepare GSTR-1 for ${prettyPeriodLabel(selectedMonth)}`}
          description={(
            <>
              Figures come from bookings, receipts, BU events and adjustments — nothing is
              keyed here. Generating writes the return into GSTR-1, where it is reviewed and
              pushed to the portal. ITC is untouched: that stays in GST Working.
            </>
          )}
          actions={(
            <>
              <Button
                variant="outline" size="sm" className={WS_BTN}
                onClick={() => navigate('/gstr1-data')}
              >
                Open GSTR-1 <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm" className={WS_BTN}
                onClick={handleGenerate}
                disabled={isGenerating || blockers.length > 0 || !preview}
              >
                {isGenerating
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Send className="h-3.5 w-3.5" />}
                {gstr1Status?.fromBuilder ? 'Regenerate' : 'Generate'}
              </Button>
            </>
          )}
        >
          {/* What the return would carry. */}
          {preview && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {[
                { label: 'Table 7 — B2CS', n: preview.counts.b2cs },
                { label: 'Table 11A — advances', n: preview.counts.at },
                { label: 'Table 11B — adjusted', n: preview.counts.txpd },
                { label: 'Table 10 — amendments', n: preview.counts.b2csa },
                { label: 'Table 11B(2) — adjusted, amended', n: preview.counts.txpda },
              ].map((t) => (
                <KpiTile key={t.label} label={t.label} value={t.n} hint={t.n === 1 ? 'rate line' : 'rate lines'} />
              ))}
              <KpiTile label="Table 8 — Non-GST (land)" value={formatINR(preview.nonGstTotal)} hint="1/3rd deemed land value" />
              <KpiTile label="Tax in the return" value={formatINR(preview.totalTax)} hint="CGST + SGST" />
            </div>
          )}

          {/* Table 13 — the series actually issued this period, with the SAC
              stated rather than remembered. */}
          {preview && preview.docSeries.length > 0 && (
            <Table className={B_TABLE} containerClassName={WS_TABLE_WRAP}>
              <TableHeader>
                <TableRow className={B_TR_HEAD}>
                  <TableHead className={B_TH}>Document series — GSTR-1 Table 13</TableHead>
                  <TableHead className={B_TH}>SAC</TableHead>
                  <TableHead className={B_TH}>From</TableHead>
                  <TableHead className={B_TH}>To</TableHead>
                  <TableHead className={B_TH_NUM}>Issued</TableHead>
                  <TableHead className={B_TH_NUM}>Cancelled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.docSeries.map((ds) => (
                  <TableRow key={ds.docNum} className={B_TR}>
                    <TableCell className={cn(B_TD, 'font-medium')}>
                      {ds.label}
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">#{ds.docNum}</span>
                    </TableCell>
                    <TableCell className={B_TD}><Badge variant="outline" className="text-[10px] font-medium">{ds.sac}</Badge></TableCell>
                    <TableCell className={cn(B_TD, 'font-mono')}>{ds.from}</TableCell>
                    <TableCell className={cn(B_TD, 'font-mono')}>{ds.to}</TableCell>
                    <TableCell className={B_TD_NUM}>{ds.totalIssued}</TableCell>
                    <TableCell className={B_TD_NUM}>0</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Blockers stop generation; cautions do not. */}
          {blockers.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-destructive-strong">
                <ShieldAlert className="h-3.5 w-3.5" /> Cannot generate yet
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-6 text-muted-foreground">
                {blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}
          {cautions.length > 0 && blockers.length === 0 && (
            <Note tone="warn">
              <p className="font-medium">Worth checking first</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {cautions.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </Note>
          )}

          {/* Where GSTR-1 currently stands for this period. */}
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            {gstr1Status?.fromBuilder ? (
              <>
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
                <span>
                  GSTR-1 holds a return generated here
                  {gstr1Status.importedAt
                    ? ` on ${new Date(gstr1Status.importedAt).toLocaleString('en-IN')}`
                    : ''}. Regenerating replaces it.
                </span>
              </>
            ) : gstr1Status ? (
              <>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  GSTR-1 already holds an uploaded file for this period
                  {gstr1Status.fileName ? ` (${gstr1Status.fileName})` : ''}. Generating replaces it
                  with the figures computed here.
                </span>
              </>
            ) : (
              <>
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Nothing in GSTR-1 for this period yet.</span>
              </>
            )}
          </div>

          {projectFilter !== 'ALL' && (
            <Note>
              The workpaper below is filtered to one project, but the return covers every project
              under this GSTIN — a GSTR-1 is filed per registration, not per project.
            </Note>
          )}
        </SectionCard>
      )}

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading postings…
          </CardContent>
        </Card>
      )}

      {!isLoading && selectedClientId && (
        <>
          {/* ── 3B headline ────────────────────────────────────────────── */}
          <SectionCard
            title="GSTR-3B Table 3.1(a) — outward taxable supplies"
            description={(
              <>
                All three legs netted. An invoice that absorbs an earlier advance reports its full value in
                Table 7 and reverses the advance in Table 11B, so only the incremental liability lands here.
              </>
            )}
          >
            <BucketTable buckets={summary.outward} emptyText="Nothing posted for this period." postings={postingsOf('outward')} />
          </SectionCard>

          {/* ── ITC & cash working paper — firm policy ────────────────────── */}
          {isLoadingItcCash && (
            <Card>
              <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Building the ITC &amp; cash working paper…
              </CardContent>
            </Card>
          )}
          {!isLoadingItcCash && itcCashPaper && (
            <SectionCard
              className="border-primary/30"
              title={<span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> ITC &amp; cash working paper — firm policy</span>}
              description={(
                <>
                  <strong>Not portal mechanics.</strong> The GST portal nets all available credit against
                  the aggregate CGST/SGST liability regardless of which supply generated either side — it
                  does not know or care that this project has a residential and a commercial leg. The firm
                  elects, as a matter of internal discipline, to set off input tax credit only against
                  commercial output tax and to pay residential output tax in cash every period, even where
                  surplus credit remains. This table shows what that policy calls for; it changes nothing
                  in ITC Working or GSTR-3B on its own.
                </>
              )}
            >
              <Table className={B_TABLE} containerClassName={WS_TABLE_WRAP}>
                <TableHeader>
                  <TableRow className={B_TR_HEAD}>
                    <TableHead className={B_TH} />
                    <TableHead className={B_TH_NUM}>Commercial (18%, with credit)</TableHead>
                    <TableHead className={B_TH_NUM}>Residential (no ITC)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className={B_TR}>
                    <TableCell className={cn(B_TD, 'font-medium')}>Output tax for the period</TableCell>
                    <TableCell className={B_TD_NUM}>{formatINR(itcCashPaper.commercialOutputTax)}</TableCell>
                    <TableCell className={B_TD_NUM}>{formatINR(itcCashPaper.residentialOutputTax)}</TableCell>
                  </TableRow>
                  <TableRow className={B_TR}>
                    <TableCell className={cn(B_TD, 'font-medium')}>Net ITC available (4C)</TableCell>
                    <TableCell className={B_TD_NUM}>{formatINR(itcCashPaper.netItcAvailable)}</TableCell>
                    <TableCell className={cn(B_TD_NUM, 'text-muted-foreground')}>Never applied here</TableCell>
                  </TableRow>
                  <TableRow className={cn(WS_TR_HEADING, 'border-0')}>
                    <TableCell className={B_TD}>Suggested set-off</TableCell>
                    <TableCell className={B_TD_NUM}>{formatINR(itcCashPaper.commercialSetOff)}</TableCell>
                    <TableCell className={cn(B_TD_NUM, 'font-normal text-muted-foreground')}>—</TableCell>
                  </TableRow>
                  <TableRow className={cn(WS_TR_TOTAL, 'border-0 hover:bg-muted')}>
                    <TableCell className={B_TD}>Cash required</TableCell>
                    <TableCell className={B_TD_NUM}>{formatINR(itcCashPaper.commercialCashDue)}</TableCell>
                    <TableCell className={B_TD_NUM}>{formatINR(itcCashPaper.residentialCashDue)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <div className="max-w-md">
                <KpiTile
                  label="Total cash to arrange this period, under this policy"
                  value={formatINR(itcCashPaper.totalCashRequired)}
                />
              </div>
              {itcCashPaper.itcCarriedForward > 0 && (
                <Note>
                  {formatINR(itcCashPaper.itcCarriedForward)} of credit is left after commercial is fully
                  set off. Under this policy it is carried forward for a future month's commercial
                  liability — not applied against residential, even though the portal would allow it.
                </Note>
              )}
            </SectionCard>
          )}

          {/* ── GSTR-1 legs and the documents, one card with a tab each ───── */}
          <SectionCard
            title="GSTR-1 tables"
            description={gstr1Tab === 'table7'
              ? 'Table 7 (B2CS, Table 10 for an amendment): milestone and BU / dastavej invoices raised in the period. Buyers are unregistered and the property is intra-state, so B2CS is the only outward invoice table in play.'
              : gstr1Tab === 'table11A'
                ? 'Table 11A: construction is a service, so Notification 66/2017 does not apply and every advance bears tax in the month of receipt.'
                : gstr1Tab === 'table11B'
                  ? 'Table 11B (11B(2) for an amendment): negative by design; these advances were taxed on receipt and are now covered by an invoice.'
                  : 'Every posting behind the totals above.'}
            actions={(
              <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs" role="tablist" aria-label="GSTR-1 table">
                {([
                  ['table7', `Table 7 (${summary.table7.reduce((n, b) => n + b.count, 0)})`],
                  ['table11A', `Table 11A (${summary.table11A.reduce((n, b) => n + b.count, 0)})`],
                  ['table11B', `Table 11B (${summary.table11B.reduce((n, b) => n + b.count, 0)})`],
                  ['docs', `Documents (${shownRows.length})`],
                ] as const).map(([k, label]) => (
                  <button
                    key={k} type="button" role="tab" aria-selected={gstr1Tab === k}
                    onClick={() => setGstr1Tab(k)}
                    className={cn('rounded px-2.5 py-1', gstr1Tab === k ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground')}
                  >{label}</button>
                ))}
              </div>
            )}
          >
            {gstr1Tab === 'table7' && (
              <BucketTable buckets={summary.table7} emptyText="No invoices raised in this period." postings={postingsOf('table7')} />
            )}
            {gstr1Tab === 'table11A' && (
              <BucketTable buckets={summary.table11A} emptyText="No advances received in this period." postings={postingsOf('table11A')} />
            )}
            {gstr1Tab === 'table11B' && (
              <BucketTable buckets={summary.table11B} emptyText="No advances adjusted in this period." postings={postingsOf('table11B')} />
            )}
            {gstr1Tab === 'docs' && (
              <>
            {shownRows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nothing posted for {prettyPeriodLabel(selectedMonth)}.
              </p>
            ) : (
              <Table className={B_TABLE} containerClassName={cn(WS_TABLE_WRAP, 'max-h-[70vh]')}>
                <TableHeader>
                  <TableRow className={B_TR_HEAD}>
                    <TableHead className={B_TH}>Date</TableHead>
                    <TableHead className={B_TH}>Unit</TableHead>
                    <TableHead className={B_TH}>Source</TableHead>
                    <TableHead className={B_TH}>Table</TableHead>
                    <TableHead className={B_TH_NUM}>Rate</TableHead>
                    <TableHead className={B_TH_NUM}>Consideration</TableHead>
                    <TableHead className={B_TH_NUM}>Non-GST (land)</TableHead>
                    <TableHead className={B_TH_NUM}>Taxable value</TableHead>
                    <TableHead className={B_TH_NUM}>CGST</TableHead>
                    <TableHead className={B_TH_NUM}>SGST</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...shownRows]
                    .sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))
                    .map((r) => (
                      <TableRow key={`${r.source_type}-${r.source_id}`} className={B_TR}>
                        <TableCell className={cn(B_TD, 'whitespace-nowrap')}>{r.doc_date}</TableCell>
                        <TableCell className={cn(B_TD, 'font-medium')}>{r.unit_no}</TableCell>
                        <TableCell className={B_TD}>
                          {invoiceLabels[r.source_id] || SOURCE_LABEL[r.source_type]}
                        </TableCell>
                        <TableCell className={B_TD}>
                          <Badge variant="outline" className="text-[10px] font-medium">{r.gstr1_table}</Badge>
                        </TableCell>
                        <TableCell className={B_TD_NUM}>{r.rate_pct}%</TableCell>
                        <TableCell className={B_TD_NUM}>{formatINR(r.consideration)}</TableCell>
                        <TableCell className={cn(B_TD_NUM, 'text-muted-foreground')}>{formatINR(r.land_deduction)}</TableCell>
                        <TableCell className={B_TD_NUM}>{formatINR(r.taxable_value)}</TableCell>
                        <TableCell className={B_TD_NUM}>{formatINR(r.cgst)}</TableCell>
                        <TableCell className={B_TD_NUM}>{formatINR(r.sgst)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </>
            )}
          </SectionCard>

          <Note>
            Taxable value is shown after the 1/3rd deemed land deduction, at the notified rate
            (1.5% / 7.5% / 18%). Tax is always CGST + SGST in equal halves. HSN for Table 12 is SAC 9954.
            BU differentials, credit notes, re-ratings and bounce reversals all post into these same
            tables. TDR/FSI reverse charge is not here by design — the credit is blocked under the
            1%/5% scheme, so it is paid in cash through 3B Table 3.1(d) and never reaches GSTR-1.
          </Note>
        </>
      )}

      {!selectedClientId && !isLoading && (
        <Card>
          <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
            <FileSpreadsheet className="mx-auto mb-2 h-6 w-6 opacity-40" />
            Select a builder client and period.
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BuilderReturnsPage;
