import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  FileSpreadsheet, Loader2, Info, CheckCircle2, AlertTriangle, ShieldAlert, Send, ExternalLink, Wallet,
} from 'lucide-react';
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
const BucketTable: React.FC<{ buckets: RateBucket[]; emptyText: string }> = ({ buckets, emptyText }) => {
  if (!buckets.length) {
    return <p className="text-sm text-muted-foreground px-4 py-6">{emptyText}</p>;
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
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rate</TableHead>
            <TableHead className="text-right">Documents</TableHead>
            <TableHead className="text-right">Consideration</TableHead>
            <TableHead className="text-right">Non-GST (land)</TableHead>
            <TableHead className="text-right">Taxable value</TableHead>
            <TableHead className="text-right">CGST</TableHead>
            <TableHead className="text-right">SGST</TableHead>
            <TableHead className="text-right">Total tax</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buckets.map((b) => (
            <TableRow key={`${b.rateCode}-${b.ratePct}`}>
              <TableCell className="font-medium">
                {b.ratePct}%
                <span className="block text-xs text-muted-foreground">eff. {b.effectiveRatePct}%</span>
              </TableCell>
              <TableCell className="text-right text-sm">{b.count}</TableCell>
              <TableCell className="text-right text-sm">{formatINR(b.consideration)}</TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">{formatINR(b.landDeduction)}</TableCell>
              <TableCell className="text-right text-sm font-medium">{formatINR(b.taxableValue)}</TableCell>
              <TableCell className="text-right text-sm">{formatINR(b.cgst)}</TableCell>
              <TableCell className="text-right text-sm">{formatINR(b.sgst)}</TableCell>
              <TableCell className="text-right text-sm font-medium">{formatINR(b.totalTax)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/50">
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell />
            <TableCell />
            <TableCell className="text-right font-semibold text-muted-foreground">{formatINR(total.landDeduction)}</TableCell>
            <TableCell className="text-right font-semibold">{formatINR(total.taxableValue)}</TableCell>
            <TableCell className="text-right font-semibold">{formatINR(total.cgst)}</TableCell>
            <TableCell className="text-right font-semibold">{formatINR(total.sgst)}</TableCell>
            <TableCell className="text-right font-semibold">{formatINR(total.cgst + total.sgst)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
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

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
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

  const summary = useMemo(
    () => summarisePeriod(rows.map((r) => ({
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
    [rows],
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
        <CardContent className="p-10 text-center text-muted-foreground">
          <p className="text-sm">You do not have permission to view builder reports.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Builder Returns Workpaper"
        subtitle="What the builder's outward side contributes to GSTR-1 and 3B for the period"
        icon={<FileSpreadsheet className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px] max-w-xs">
              <Label className="mb-1.5 block">Builder client</Label>
              <SearchableSelect
                options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
                value={selectedClientId || ''}
                onValueChange={setSelectedClientId}
                placeholder="Search builder client..."
                searchPlaceholder="Type to search..."
                emptyText="No builder clients found."
              />
            </div>
            <div className="w-48">
              <Label className="mb-1.5 block">Period</Label>
              <SearchableMonthSelect
                options={monthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Select period"
              />
            </div>
            <div className="w-56">
              <Label className="mb-1.5 block">Project</Label>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Prepare and hand off to GSTR-1 ─────────────────────────────────── */}
      {selectedClientId && (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Prepare GSTR-1 for {prettyPeriodLabel(selectedMonth)}</CardTitle>
                <CardDescription>
                  Figures come from bookings, receipts, BU events and adjustments — nothing is
                  keyed here. Generating writes the return into GSTR-1, where it is reviewed and
                  pushed to the portal. ITC is untouched: that stays in GST Working.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => navigate('/gstr1-data')}
                >
                  Open GSTR-1 <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={isGenerating || blockers.length > 0 || !preview}
                >
                  {isGenerating
                    ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    : <Send className="mr-1.5 h-4 w-4" />}
                  {gstr1Status?.fromBuilder ? 'Regenerate' : 'Generate'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* What the return would carry. */}
            {preview && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  { label: 'Table 7 — B2CS', n: preview.counts.b2cs },
                  { label: 'Table 11A — advances', n: preview.counts.at },
                  { label: 'Table 11B — adjusted', n: preview.counts.txpd },
                  { label: 'Table 10 — amendments', n: preview.counts.b2csa },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-lg font-semibold">{s.n}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.n === 1 ? 'rate line' : 'rate lines'}
                    </p>
                  </div>
                ))}
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Table 8 — Non-GST (land)</p>
                  <p className="text-lg font-semibold">{formatINR(preview.nonGstTotal)}</p>
                  <p className="text-xs text-muted-foreground">1/3rd deemed land value</p>
                </div>
                <div className="rounded-lg border bg-primary/5 p-3">
                  <p className="text-xs text-muted-foreground">Tax in the return</p>
                  <p className="text-lg font-semibold">{formatINR(preview.totalTax)}</p>
                  <p className="text-xs text-muted-foreground">CGST + SGST</p>
                </div>
              </div>
            )}

            {/* Table 13 — the series actually issued this period, with the SAC
                stated rather than remembered. */}
            {preview && preview.docSeries.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document series — GSTR-1 Table 13</TableHead>
                      <TableHead>SAC</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Issued</TableHead>
                      <TableHead className="text-right">Cancelled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.docSeries.map((s) => (
                      <TableRow key={s.docNum}>
                        <TableCell className="text-sm font-medium">
                          {s.label}
                          <span className="ml-1.5 text-xs text-muted-foreground">#{s.docNum}</span>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{s.sac}</Badge></TableCell>
                        <TableCell className="text-sm font-mono">{s.from}</TableCell>
                        <TableCell className="text-sm font-mono">{s.to}</TableCell>
                        <TableCell className="text-right text-sm">{s.totalIssued}</TableCell>
                        <TableCell className="text-right text-sm">0</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Blockers stop generation; cautions do not. */}
            {blockers.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <ShieldAlert className="h-4 w-4" /> Cannot generate yet
                </p>
                <ul className="mt-1.5 space-y-1 pl-6 text-xs text-muted-foreground list-disc">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}
            {cautions.length > 0 && blockers.length === 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-500">
                  <AlertTriangle className="h-4 w-4" /> Worth checking first
                </p>
                <ul className="mt-1.5 space-y-1 pl-6 text-xs text-muted-foreground list-disc">
                  {cautions.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            )}

            {/* Where GSTR-1 currently stands for this period. */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              {gstr1Status?.fromBuilder ? (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    GSTR-1 holds a return generated here
                    {gstr1Status.importedAt
                      ? ` on ${new Date(gstr1Status.importedAt).toLocaleString('en-IN')}`
                      : ''}. Regenerating replaces it.
                  </span>
                </>
              ) : gstr1Status ? (
                <>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    GSTR-1 already holds an uploaded file for this period
                    {gstr1Status.fileName ? ` (${gstr1Status.fileName})` : ''}. Generating replaces it
                    with the figures computed here.
                  </span>
                </>
              ) : (
                <>
                  <Info className="h-4 w-4 shrink-0" />
                  <span>Nothing in GSTR-1 for this period yet.</span>
                </>
              )}
            </div>

            {projectFilter !== 'ALL' && (
              <p className="text-xs text-muted-foreground">
                The workpaper below is filtered to one project, but the return covers every project
                under this GSTIN — a GSTR-1 is filed per registration, not per project.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading postings…
        </div>
      )}

      {!isLoading && selectedClientId && (
        <>
          {/* ── 3B headline ────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GSTR-3B Table 3.1(a) — outward taxable supplies</CardTitle>
              <CardDescription>
                All three legs netted. An invoice that absorbs an earlier advance reports its full value in
                Table 7 and reverses the advance in Table 11B, so only the incremental liability lands here.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <BucketTable buckets={summary.outward} emptyText="Nothing posted for this period." />
            </CardContent>
          </Card>

          {/* ── ITC & cash working paper — firm policy ────────────────────── */}
          {isLoadingItcCash && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Building the ITC &amp; cash working paper…
            </div>
          )}
          {!isLoadingItcCash && itcCashPaper && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4" /> ITC &amp; cash working paper — firm policy
                </CardTitle>
                <CardDescription>
                  <strong>Not portal mechanics.</strong> The GST portal nets all available credit against
                  the aggregate CGST/SGST liability regardless of which supply generated either side — it
                  does not know or care that this project has a residential and a commercial leg. The firm
                  elects, as a matter of internal discipline, to set off input tax credit only against
                  commercial output tax and to pay residential output tax in cash every period, even where
                  surplus credit remains. This table shows what that policy calls for; it changes nothing
                  in ITC Working or GSTR-3B on its own.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead className="text-right">Commercial (18%, with credit)</TableHead>
                        <TableHead className="text-right">Residential (no ITC)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Output tax for the period</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(itcCashPaper.commercialOutputTax)}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(itcCashPaper.residentialOutputTax)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Net ITC available (4C)</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(itcCashPaper.netItcAvailable)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">Never applied here</TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/30">
                        <TableCell className="font-medium">Suggested set-off</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatINR(itcCashPaper.commercialSetOff)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                      </TableRow>
                      <TableRow className="bg-primary/5">
                        <TableCell className="font-semibold">Cash required</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatINR(itcCashPaper.commercialCashDue)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatINR(itcCashPaper.residentialCashDue)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                  <span className="text-sm">
                    Total cash to arrange this period, under this policy
                  </span>
                  <span className="text-lg font-semibold">{formatINR(itcCashPaper.totalCashRequired)}</span>
                </div>
                {itcCashPaper.itcCarriedForward > 0 && (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {formatINR(itcCashPaper.itcCarriedForward)} of credit is left after commercial is fully
                    set off. Under this policy it is carried forward for a future month's commercial
                    liability — not applied against residential, even though the portal would allow it.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── GSTR-1 legs ────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GSTR-1 Table 7 — B2CS</CardTitle>
              <CardDescription>
                Milestone and other invoices raised in the period. Buyers are unregistered and the property
                is intra-state, so B2CS is the only outward invoice table in play.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <BucketTable buckets={summary.table7} emptyText="No invoices raised in this period." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">GSTR-1 Table 11A — tax liability on advances received</CardTitle>
              <CardDescription>
                Construction is a service, so Notification 66/2017 does not apply and every advance bears
                tax in the month of receipt.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <BucketTable buckets={summary.table11A} emptyText="No advances received in this period." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">GSTR-1 Table 11B — adjustment of advances</CardTitle>
              <CardDescription>
                Negative by design: these advances were taxed on receipt and are now covered by an invoice.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <BucketTable buckets={summary.table11B} emptyText="No advances adjusted in this period." />
            </CardContent>
          </Card>

          {/* ── Document listing ───────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents ({rows.length})</CardTitle>
              <CardDescription>Every posting behind the totals above.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">
                  Nothing posted for {prettyPeriodLabel(selectedMonth)}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Table</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Consideration</TableHead>
                        <TableHead className="text-right">Non-GST (land)</TableHead>
                        <TableHead className="text-right">Taxable value</TableHead>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...rows]
                        .sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''))
                        .map((r) => (
                          <TableRow key={`${r.source_type}-${r.source_id}`}>
                            <TableCell className="text-sm">{r.doc_date}</TableCell>
                            <TableCell className="text-sm font-medium">{r.unit_no}</TableCell>
                            <TableCell className="text-sm">
                              {invoiceLabels[r.source_id] || SOURCE_LABEL[r.source_type]}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{r.gstr1_table}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm">{r.rate_pct}%</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(r.consideration)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{formatINR(r.land_deduction)}</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(r.taxable_value)}</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(r.cgst)}</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(r.sgst)}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-xs">
              Taxable value is shown after the 1/3rd deemed land deduction, at the notified rate
              (1.5% / 7.5% / 18%). Tax is always CGST + SGST in equal halves. HSN for Table 12 is SAC 9954.
              BU differentials, credit notes, re-ratings and bounce reversals all post into these same
              tables. TDR/FSI reverse charge is not here by design — the credit is blocked under the
              1%/5% scheme, so it is paid in cash through 3B Table 3.1(d) and never reaches GSTR-1.
            </p>
          </div>
        </>
      )}

      {!selectedClientId && !isLoading && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileSpreadsheet className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Select a builder client and period.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BuilderReturnsPage;
