import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPlOutputTotals, fetchPlInputTotals, fetchDutiesTaxesOutputAnnual, fetchDutiesTaxesInputAnnual, taxTotal } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; refreshKey?: number; }

/**
 * Books Input and Duties & Taxes are entered separately by design (firm
 * decision, 27 Aug 2026) — this is where they're cross-checked against
 * each other's annual totals, rather than one being derived from the
 * other.
 *
 * refreshKey is bumped by the sibling Duties & Taxes cards after a save
 * (lifted in AnnualReturnPage) so this card can't go on showing a stale
 * verdict after a month gets corrected next door — a manual Refresh
 * button is kept too, as a fallback that doesn't depend on the signal.
 */
export const AnnualCrossCheckCard: React.FC<Props> = ({ clientId, financialYear, refreshKey }) => {
  const [loading, setLoading] = useState(true);
  const [outputDiff, setOutputDiff] = useState<{ pl: number; dt: number } | null>(null);
  const [inputDiff, setInputDiff] = useState<{ pl: number; dt: number } | null>(null);
  const [manualNonce, setManualNonce] = useState(0);

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
  }, [clientId, financialYear, refreshKey, manualNonce]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Annual cross-check</CardTitle>
          <CardDescription>Same figures, entered twice on purpose — this is where they're expected to agree.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center gap-2 py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    );
  }

  const rows = [
    { label: 'Outward tax — PL-Output (Part A) vs Duties & Taxes-Output (Net Sales)', d: outputDiff },
    { label: 'ITC — PL-Input (all sections) vs Duties & Taxes-Input (Net Purchase)', d: inputDiff },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Annual cross-check</CardTitle>
          <CardDescription>Same figures, entered twice on purpose — this is where they're expected to agree.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setManualNonce((n) => n + 1)} aria-label="Refresh cross-check">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {(!clientId || !financialYear) ? (
          <p className="text-sm text-muted-foreground">Select a client and financial year to see the cross-check.</p>
        ) : rows.map(({ label, d }) => {
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
                <Badge variant={matched ? 'success' : 'destructive'}>{matched ? 'Matched' : `Diff: ${fmt(diff)}`}</Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default AnnualCrossCheckCard;
