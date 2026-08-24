import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchDutiesTaxesInputAnnual, fetchRcmTotals, fetchPortalItcClaimedAnnual, fetchCarryForwardTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/** ANNEXURE-2 — ITC reconciliation: the ITC ledger's Dr. balance through to any excess claimed. */
export const Annexure2Card: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [drBalance, setDrBalance] = useState(0);
  const [rcmItc, setRcmItc] = useState(0);
  const [debitNote, setDebitNote] = useState(0);
  const [otherAdjustment, setOtherAdjustment] = useState(0);
  const [claimedInNextFy, setClaimedInNextFy] = useState(0);
  const [asPerPortal, setAsPerPortal] = useState(0);
  const [reversal, setReversal] = useState(0);
  const [claimedFromPrevFy, setClaimedFromPrevFy] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchPortalItcClaimedAnnual(clientId, financialYear),
      fetchCarryForwardTotals(clientId, financialYear),
    ]).then(([dt, rcm, portalItc, cf]) => {
      if (cancelled) return;
      setDrBalance(taxTotal(dt.purchase));
      setRcmItc(taxTotal(rcm.partB));
      setDebitNote(taxTotal(dt.debitNote));
      setOtherAdjustment(taxTotal(dt.netSuspended));
      setClaimedInNextFy(taxTotal(cf.claimed_in_next_fy));
      setAsPerPortal(taxTotal(portalItc));
      setReversal(taxTotal(dt.reversalTotal));
      setClaimedFromPrevFy(taxTotal(cf.claimed_from_prev_fy));
    }).catch((err) => toast.error('Could not compute Annexure 2: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const netItcAvailed = drBalance + rcmItc - debitNote - otherAdjustment;
  const total = netItcAvailed - claimedInNextFy;
  const netItc = asPerPortal - reversal - claimedFromPrevFy;
  const excess = total - netItc;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">ANNEXURE-2 — ITC Reconciliation</CardTitle>
        <CardDescription>The ITC ledger's Dr. balance through to any excess claimed against the portal.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-lg">
        <Row label="Dr. balance of ITC ledger (Duties &amp; Taxes-Input purchases)" value={drBalance} />
        <Row label="RCM-ITC (Part B)" value={rcmItc} />
        <Row label="Debit note (−)" value={-debitNote} />
        <Row label="Other adjustment — net suspended ITC (−)" value={-otherAdjustment} />
        <Row label="Net ITC availed" value={netItcAvailed} strong />
        <Row label="ITC of this year claimed in next year (−)" value={-claimedInNextFy} />
        <Row label="Total" value={total} strong />
        <Row label="As per portal (6A, includes prior-year effect)" value={asPerPortal} />
        <Row label="Reversal as per 7(H1) (−)" value={-reversal} />
        <Row label="ITC of previous year claimed in this year (−)" value={-claimedFromPrevFy} />
        <Row label="Net ITC" value={netItc} strong />
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm font-semibold">Excess ITC claimed / to be claimed</span>
          <Badge variant={Math.abs(excess) <= 10 ? 'success' : 'destructive'}>{fmt(excess)}</Badge>
        </div>
      </CardContent>
    </Card>
  );
};

export default Annexure2Card;
