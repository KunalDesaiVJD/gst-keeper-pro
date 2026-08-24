import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPlInputTotals, fetchDutiesTaxesInputAnnual, fetchRcmTotals, taxTotal } from '@/lib/annualReturnAggregates';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; sub?: string; strong?: boolean }> = ({ label, value, sub, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <div>
      <div className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
    <div className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</div>
  </div>
);

/**
 * The computed rows the real PL-Input sheet shows below its three
 * sections — Suspended ITC (net outstanding, pulled from Duties &
 * Taxes-Input) and RCM Credit. Verified against the filed workbook: the
 * "RCM CREDIT AS PER PORTAL" row's value actually matches RCM Part B
 * (books), not Part A — the sheet's own label is misleading, but this
 * replicates what it actually computes, not what it says.
 */
export const PLInputSummaryCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [totalItc, setTotalItc] = useState(0);
  const [suspended, setSuspended] = useState(0);
  const [rcmCredit, setRcmCredit] = useState(0);
  const [netItc, setNetItc] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPlInputTotals(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
    ]).then(([pl, dt, rcm]) => {
      if (cancelled) return;
      const plTotal = taxTotal(pl.purchase) + taxTotal(pl.expense) + taxTotal(pl.capital_goods);
      const susp = taxTotal(dt.netSuspended);
      const rcmB = taxTotal(rcm.partB);
      setTotalItc(plTotal);
      setSuspended(susp);
      setRcmCredit(rcmB);
      setNetItc(plTotal - susp + rcmB);
    }).catch((err) => toast.error('Could not compute PL-Input summary: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">PL-Input — Computed summary</CardTitle>
        <CardDescription>Nothing entered here — pulled from Duties &amp; Taxes-Input and RCM, same as the sheet's own formulas.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-md">
        <Row label="Total ITC as per P&amp;L" value={totalItc} sub="Sum of Purchase + Expense + Capital Goods" />
        <Row label="Suspended ITC as per Duties &amp; Taxes" value={suspended} sub="Reversed + Reversed-180d − Reclaim − Reclaim-180d, still outstanding" />
        <Row label="RCM Credit" value={rcmCredit} sub="RCM Part B (books) total" />
        <Row label="Net ITC for the year" value={netItc} strong />
      </CardContent>
    </Card>
  );
};

export default PLInputSummaryCard;
