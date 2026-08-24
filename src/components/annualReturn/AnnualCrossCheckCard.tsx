import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPlOutputTotals, fetchPlInputTotals, fetchDutiesTaxesOutputAnnual, fetchDutiesTaxesInputAnnual, taxTotal } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * Books Input and Duties & Taxes are entered separately by design (firm
 * decision, 27 Aug 2026) — this is where they're cross-checked against
 * each other's annual totals, rather than one being derived from the
 * other.
 */
export const AnnualCrossCheckCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [outputDiff, setOutputDiff] = useState<{ pl: number; dt: number } | null>(null);
  const [inputDiff, setInputDiff] = useState<{ pl: number; dt: number } | null>(null);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPlOutputTotals(clientId, financialYear),
      fetchPlInputTotals(clientId, financialYear),
      fetchDutiesTaxesOutputAnnual(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
    ]).then(([plOut, plIn, dtOut, dtIn]) => {
      if (cancelled) return;
      setOutputDiff({ pl: taxTotal(plOut.A), dt: taxTotal(dtOut.netSales) });
      setInputDiff({ pl: taxTotal(plIn.purchase) + taxTotal(plIn.expense) + taxTotal(plIn.capital_goods), dt: taxTotal(dtIn.netPurchase) });
    }).catch((err) => toast.error('Could not compute cross-check: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const rows = [
    { label: 'Outward tax — PL-Output (Part A) vs Duties & Taxes-Output (Net Sales)', d: outputDiff },
    { label: 'ITC — PL-Input (all sections) vs Duties & Taxes-Input (Net Purchase)', d: inputDiff },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Annual cross-check</CardTitle>
        <CardDescription>Same figures, entered twice on purpose — this is where they're expected to agree.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(({ label, d }) => {
          if (!d) return null;
          const diff = d.pl - d.dt;
          const matched = Math.abs(diff) <= TOLERANCE;
          return (
            <div key={label} className="flex items-center justify-between gap-4 text-sm border-b pb-2 last:border-b-0 last:pb-0">
              <span className="text-muted-foreground">{label}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="tabular-nums">{fmt(d.pl)}</span>
                <span className="text-muted-foreground">vs</span>
                <span className="tabular-nums">{fmt(d.dt)}</span>
                <Badge variant={matched ? 'success' : 'destructive'}>{fmt(diff)}</Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default AnnualCrossCheckCard;
