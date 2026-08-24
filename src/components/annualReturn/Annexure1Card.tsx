import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPlOutputTotals, fetchRcmTotals, fetchPortalTurnoverAnnual, fetchTaxPaymentTotals, taxTotal, TaxSum } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/** ANNEXURE-1 — Income reconciliation: books turnover vs. the portal, and payable vs. paid per tax head. */
export const Annexure1Card: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [grossTaxable, setGrossTaxable] = useState<TaxSum | null>(null);
  const [rcm, setRcm] = useState<TaxSum | null>(null);
  const [asPerPortal, setAsPerPortal] = useState<TaxSum | null>(null);
  const [payments, setPayments] = useState<Record<'igst' | 'cgst' | 'sgst', { payable: number; paidCash: number; paidItc: number }> | null>(null);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPlOutputTotals(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchPortalTurnoverAnnual(clientId, financialYear),
      fetchTaxPaymentTotals(clientId, financialYear),
    ]).then(([pl, rcmTotals, portalTurnover, pay]) => {
      if (cancelled) return;
      setGrossTaxable(pl.A);
      setRcm(rcmTotals.partB);
      setAsPerPortal(portalTurnover);
      setPayments(pay);
    }).catch((err) => toast.error('Could not compute Annexure 1: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading || !grossTaxable || !rcm || !asPerPortal || !payments) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const totalFromNewGstr9 = taxTotal(grossTaxable) + taxTotal(rcm);
  const totalAsPerPortal = taxTotal(asPerPortal);
  const diff = totalFromNewGstr9 - totalAsPerPortal;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">ANNEXURE-1 — Income Reconciliation</CardTitle>
        <CardDescription>Gross taxable income as per books, plus RCM, against the portal's own total.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-lg space-y-4">
        <div>
          <Row label="Gross taxable income (PL-Output Part A)" value={taxTotal(grossTaxable)} />
          <Row label="Tax paid on RCM as per books" value={taxTotal(rcm)} />
          <Row label="Total as per new GSTR-9" value={totalFromNewGstr9} strong />
          <Row label="Total as per auto-calculated GSTR-9 (portal)" value={totalAsPerPortal} />
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm font-semibold">Difference</span>
            <Badge variant={Math.abs(diff) <= TOLERANCE ? 'success' : 'destructive'}>{fmt(diff)}</Badge>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Paid &amp; Payable</div>
          {(['igst', 'cgst', 'sgst'] as const).map((h) => {
            const p = payments[h];
            const paidTotal = p.paidCash + p.paidItc;
            const d = p.payable - paidTotal;
            return (
              <div key={h} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-muted-foreground uppercase">{h}</span>
                <span className="tabular-nums">{fmt(p.payable)} payable / {fmt(paidTotal)} paid</span>
                <Badge variant={Math.abs(d) <= TOLERANCE ? 'success' : 'destructive'}>{fmt(d)}</Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default Annexure1Card;
