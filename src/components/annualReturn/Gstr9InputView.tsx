import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPlInputTotals, fetchDutiesTaxesInputAnnual, fetchRcmTotals, fetchPortalItcClaimedAnnual, fetchItcReversalTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; tag?: string; tagVariant?: 'success' | 'warning' | 'secondary' | 'outline'; tagTitle?: string; strong?: boolean }> = ({ label, value, tag, tagVariant = 'secondary', tagTitle, strong }) => (
  <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
    <div className="flex items-center gap-2">
      <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
      {tag && <Badge variant={tagVariant} className="text-[10px]" title={tagTitle}>{tag}</Badge>}
    </div>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/**
 * GSTR 9-INPUT — ITC bucketed by type, cross-tied to what's actually
 * claimed via the portal. Table 7's rule-wise reversals (37/37A/38/39/42/43,
 * s.17(5) ineligible ITC) are now real, via itc_reversal_lines (R6) — no
 * longer shown as "not captured."
 */
export const Gstr9InputView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState(0);
  const [inputServices, setInputServices] = useState(0);
  const [capitalGoods, setCapitalGoods] = useState(0);
  const [rcm, setRcm] = useState(0);
  const [reclaim, setReclaim] = useState(0);
  const [otherReversal, setOtherReversal] = useState(0);
  const [ruleReversal, setRuleReversal] = useState(0);
  const [asPer3b, setAsPer3b] = useState(0);
  const [asPerBook, setAsPerBook] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPlInputTotals(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchPortalItcClaimedAnnual(clientId, financialYear),
      fetchItcReversalTotals(clientId, financialYear),
    ]).then(([pl, dt, rcmTotals, portalItc, itcReversal]) => {
      if (cancelled) return;
      setInput(taxTotal(pl.purchase));
      setInputServices(taxTotal(pl.expense));
      setCapitalGoods(taxTotal(pl.capital_goods));
      setRcm(taxTotal(rcmTotals.partB));
      setReclaim(taxTotal(dt.reclaimTotal));
      setOtherReversal(taxTotal(dt.reversalTotal));
      setRuleReversal(taxTotal(itcReversal.total));
      setAsPer3b(taxTotal(portalItc));
      setAsPerBook(taxTotal(pl.purchase) + taxTotal(pl.expense) + taxTotal(pl.capital_goods));
    }).catch((err) => toast.error('Could not compute GSTR 9-Input: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const total6O = input + inputServices + capitalGoods + rcm + reclaim;
  const diffVs3b = total6O - asPer3b;
  const reversal = otherReversal + ruleReversal;
  const total7J = total6O - reversal;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">GSTR 9-INPUT</CardTitle>
        <CardDescription>ITC availed, bucketed by type — computed, not entered here.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-lg space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">ITC availed</div>
          <Row label="Input" value={input} />
          <Row label="Input Services" value={inputServices} />
          <Row label="Capital Goods" value={capitalGoods} />
          <Row label="RCM" value={rcm} />
          <Row label="ITC Reclaim" value={reclaim} />
          <Row label="As per 3B" value={asPer3b} tag="Portal" tagVariant="outline" tagTitle="See the Portal Capture tab" />
          <Row label="Total (matches Table 6O)" value={total6O} strong tag={Math.abs(diffVs3b) <= TOLERANCE ? 'Matched' : `Diff ${fmt(diffVs3b)}`} tagVariant={Math.abs(diffVs3b) <= TOLERANCE ? 'success' : 'warning'} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Reversals</div>
          <Row label="Other Reversal (H1 — Duties &amp; Taxes suspended)" value={otherReversal} />
          <Row label="Rule-wise (37/37A/38/39/42/43) + s.17(5)" value={ruleReversal} tag="Table 7 tab" tagVariant="outline" tagTitle="See the GSTR 9-Input tab's Table 7 section" />
          <Row label="Total ITC Reversed" value={reversal} />
          <Row label="Total (matches Table 7J)" value={total7J} strong />
        </div>
        <Row label="As per books (PL-Input total)" value={asPerBook} tag="Books" tagVariant="outline" tagTitle="See the Books Input tab (PL-Input)" />
      </CardContent>
    </Card>
  );
};

export default Gstr9InputView;
