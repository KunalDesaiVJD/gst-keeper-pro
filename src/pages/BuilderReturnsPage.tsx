import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useMonth } from '@/contexts/MonthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Info } from 'lucide-react';
import { formatINR, type BuilderRateCode } from '@/utils/builderRates';
import {
  prettyPeriodLabel, summarisePeriod,
  type PostingRow, type RateBucket,
} from '@/utils/builderLedger';

interface PostingDbRow {
  source_id: string;
  source_type: 'ADVANCE_11A' | 'ADVANCE_11B' | 'INVOICE_B2CS';
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
}

const SOURCE_LABEL: Record<PostingDbRow['source_type'], string> = {
  ADVANCE_11A: 'Advance received',
  ADVANCE_11B: 'Advance adjusted',
  INVOICE_B2CS: 'Invoice',
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
    }),
    { taxableValue: 0, cgst: 0, sgst: 0 },
  );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rate</TableHead>
            <TableHead className="text-right">Documents</TableHead>
            <TableHead className="text-right">Consideration</TableHead>
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
  const { canViewBuilderReports } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();

  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [rows, setRows] = useState<PostingDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
      setRows((data || []) as unknown as PostingDbRow[]);
    } catch (e) {
      toast.error(`Could not load postings: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, selectedMonth, projectFilter]);

  useEffect(() => { void load(); }, [load]);

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
                            <TableCell className="text-sm">{SOURCE_LABEL[r.source_type]}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{r.gstr1_table}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm">{r.rate_pct}%</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(r.consideration)}</TableCell>
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
              BU differentials, conversions and bounce reversals will post into these same tables once
              later phases are built.
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
