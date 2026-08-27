import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchDutiesTaxesInputAnnual, fetchPlInputTotals, fetchRcmTotals, taxTotal } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));

const Row: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C TABLE 12 — "Reconciliation of Net Input Tax Credit (ITC)". Six
 * lines: A/B/C are manually entered (they're the auditor's own audited-
 * financials figures, not derivable from books already in the system); D
 * (A+B-C) and F (E-D) are computed; E is the same "ITC claimed in GSTR-9"
 * total GSTR9-Input and Table 14 already compute.
 *
 * Was missing entirely until 27 Aug 2026 — the view previously (and
 * incorrectly) labelled "Table 12B" was actually Table 14's per-expense-
 * head breakdown, corrected alongside this addition.
 */
export const Table12NetItcSummaryCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [draftA, setDraftA] = useState('0');
  const [draftB, setDraftB] = useState('0');
  const [draftC, setDraftC] = useState('0');
  const [e, setE] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('gstr9c_table12_net_itc').select('itc_per_financials, itc_earlier_fy_claimed_this_fy, itc_this_fy_claimed_later_fy').eq('client_id', clientId).eq('financial_year', financialYear).maybeSingle(),
      fetchPlInputTotals(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
    ]).then(([rowRes, pl, rcm, dt]) => {
      if (cancelled) return;
      const av = Number(rowRes.data?.itc_per_financials) || 0;
      const bv = Number(rowRes.data?.itc_earlier_fy_claimed_this_fy) || 0;
      const cv = Number(rowRes.data?.itc_this_fy_claimed_later_fy) || 0;
      setA(av); setB(bv); setC(cv);
      setDraftA(String(av)); setDraftB(String(bv)); setDraftC(String(cv));
      // Same "ITC claimed in GSTR-9" total GSTR9-Input's Table 6O / Table 14's row S already compute.
      setE(taxTotal(pl.purchase) + taxTotal(pl.expense) + taxTotal(pl.capital_goods) + taxTotal(rcm.partB) + taxTotal(dt.reclaimTotal));
    }).catch((err) => toast.error('Could not compute Table 12: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  const saveAll = async () => {
    setSaving(true);
    try {
      const payload = {
        client_id: clientId, financial_year: financialYear,
        itc_per_financials: num(draftA), itc_earlier_fy_claimed_this_fy: num(draftB), itc_this_fy_claimed_later_fy: num(draftC),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('gstr9c_table12_net_itc').upsert(payload, { onConflict: 'client_id,financial_year' });
      if (error) throw error;
      setA(num(draftA)); setB(num(draftB)); setC(num(draftC));
      toast.success('Table 12 saved.');
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <Card>
      <CardHeader><CardTitle className="text-lg">GSTR-9C TABLE 12 — Reconciliation of Net ITC</CardTitle></CardHeader>
      <CardContent className="flex items-center justify-center gap-2 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </CardContent>
    </Card>
  );

  const dirty = num(draftA) !== a || num(draftB) !== b || num(draftC) !== c;
  const d = num(draftA) + num(draftB) - num(draftC);
  const f = e - d;
  const matched = Math.abs(f) <= TOLERANCE;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">GSTR-9C TABLE 12 — Reconciliation of Net ITC</CardTitle>
          <CardDescription>A, B and C are the auditor's own figures from the audited financials — not derived from books already in the system.</CardDescription>
        </div>
        <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={saving || !dirty} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save
        </Button>
      </CardHeader>
      <CardContent className="max-w-lg">
        <div className="flex items-center justify-between gap-3 py-2 border-b">
          <span className="text-sm text-muted-foreground">A — ITC availed as per audited Annual Financial Statement</span>
          <Input type="number" className="w-40 text-right" disabled={saving} value={draftA} onChange={(e2) => setDraftA(e2.target.value)} aria-label="Table 12 row A" />
        </div>
        <div className="flex items-center justify-between gap-3 py-2 border-b">
          <span className="text-sm text-muted-foreground">B — ITC booked in earlier FY, claimed this FY</span>
          <Input type="number" className="w-40 text-right" disabled={saving} value={draftB} onChange={(e2) => setDraftB(e2.target.value)} aria-label="Table 12 row B" />
        </div>
        <div className="flex items-center justify-between gap-3 py-2 border-b">
          <span className="text-sm text-muted-foreground">C — ITC booked this FY, to be claimed in a later FY</span>
          <Input type="number" className="w-40 text-right" disabled={saving} value={draftC} onChange={(e2) => setDraftC(e2.target.value)} aria-label="Table 12 row C" />
        </div>
        <Row label="D — ITC per financials/books (A + B − C)" value={d} strong />
        <Row label="E — ITC claimed in GSTR-9" value={e} />
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm font-semibold">F — Un-reconciled ITC (E − D)</span>
          <Badge variant={matched ? 'success' : 'destructive'}>{matched ? 'Matched' : `Diff ${fmt(f)}`}</Badge>
        </div>
      </CardContent>
    </Card>
  );
};

export default Table12NetItcSummaryCard;
