import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Info } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPlOutputTotals, fetchRcmTotals, fetchPortalTurnoverAnnual, fetchDutiesTaxesInputAnnual,
  fetchPortalItcClaimedAnnual, fetchCarryForwardTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/**
 * ANNEXURE-3 — DRC-03 pre-calculation. Every open reconciliation line the
 * year carries, summed into one payable figure. This is a preview only —
 * "Any other payment" has no source anywhere and always shows zero here
 * until a human enters one; it is not assumed nil the way the other three
 * lines are computed.
 */
export const Annexure3Card: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [clause9Diff, setClause9Diff] = useState(0);
  const [rcmToBePaid, setRcmToBePaid] = useState(0);
  const [excessItc, setExcessItc] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPlOutputTotals(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchPortalTurnoverAnnual(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchPortalItcClaimedAnnual(clientId, financialYear),
      fetchCarryForwardTotals(clientId, financialYear),
    ]).then(([pl, rcm, portalTurnover, dt, portalItc, cf]) => {
      if (cancelled) return;
      // Annexure-1's headline diff: books (turnover + RCM) vs portal turnover.
      setClause9Diff((taxTotal(pl.A) + taxTotal(rcm.partB)) - taxTotal(portalTurnover));
      // RCM to be paid: portal (Part A) ahead of books (Part B) is a shortfall.
      setRcmToBePaid(taxTotal(rcm.partA) - taxTotal(rcm.partB));
      // Annexure-2's excess ITC claimed.
      const netItcAvailed = taxTotal(dt.purchase) + taxTotal(rcm.partB) - taxTotal(dt.debitNote) - taxTotal(dt.netSuspended);
      const total = netItcAvailed - taxTotal(cf.claimed_in_next_fy);
      const netItc = taxTotal(portalItc) - taxTotal(dt.reversalTotal) - taxTotal(cf.claimed_from_prev_fy);
      setExcessItc(total - netItc);
    }).catch((err) => toast.error('Could not compute Annexure 3: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const total = clause9Diff + Math.max(rcmToBePaid, 0) + Math.max(excessItc, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">ANNEXURE-3 — DRC-03 Pre-calculation</CardTitle>
        <CardDescription>A preview, not a filing — every open line the year currently carries.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-lg">
        <Row label="Clause 9 difference of GSTR-9 (Annexure 1)" value={clause9Diff} />
        <Row label="RCM to be paid (as per RCM sheet)" value={Math.max(rcmToBePaid, 0)} />
        <Row label="Excess ITC claimed as per reco (Annexure 2)" value={Math.max(excessItc, 0)} />
        <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground my-2 bg-info/5 border-info/20">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-info" />
          "Any other payment" has no entry surface yet — always zero here, not assumed confirmed.
        </div>
        <Row label="Total" value={total} strong />
      </CardContent>
    </Card>
  );
};

export default Annexure3Card;
