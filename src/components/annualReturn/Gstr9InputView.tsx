import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPlInputTotals, fetchDutiesTaxesInputAnnual, fetchRcmTotals, fetchPortalItcClaimedAnnual, taxTotal,
} from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; tag?: string; tagVariant?: 'success' | 'warning' | 'secondary' | 'outline'; strong?: boolean }> = ({ label, value, tag, tagVariant = 'secondary', strong }) => (
  <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
    <div className="flex items-center gap-2">
      <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
      {tag && <Badge variant={tagVariant} className="text-[10px]">{tag}</Badge>}
    </div>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/**
 * GSTR 9-INPUT — ITC bucketed by type, cross-tied to what's actually
 * claimed via the portal. Table 7's rule-wise reversals (37/38/39/42/43,
 * s.17(5) ineligible ITC) aren't captured anywhere in the schema yet — that
 * row is shown honestly as "not captured" rather than defaulted to zero as
 * if it were confirmed nil.
 */
export const Gstr9InputView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState(0);
  const [inputServices, setInputServices] = useState(0);
  const [capitalGoods, setCapitalGoods] = useState(0);
  const [rcm, setRcm] = useState(0);
  const [reclaim, setReclaim] = useState(0);
  const [reversal, setReversal] = useState(0);
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
    ]).then(([pl, dt, rcmTotals, portalItc]) => {
      if (cancelled) return;
      setInput(taxTotal(pl.purchase));
      setInputServices(taxTotal(pl.expense));
      setCapitalGoods(taxTotal(pl.capital_goods));
      setRcm(taxTotal(rcmTotals.partB));
      setReclaim(taxTotal(dt.reclaimTotal));
      setReversal(taxTotal(dt.reversalTotal));
      setAsPer3b(taxTotal(portalItc));
      setAsPerBook(taxTotal(pl.purchase) + taxTotal(pl.expense) + taxTotal(pl.capital_goods));
    }).catch((err) => toast.error('Could not compute GSTR 9-Input: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const total6O = input + inputServices + capitalGoods + rcm + reclaim;
  const diffVs3b = total6O - asPer3b;
  const total7J = total6O - reversal; // s.17(5) not yet captured — see note below

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
          <Row label="As per 3B" value={asPer3b} tag="Portal" tagVariant="outline" />
          <Row label="Total (matches Table 6O)" value={total6O} strong tag={Math.abs(diffVs3b) <= TOLERANCE ? 'Matched' : `Diff ${fmt(diffVs3b)}`} tagVariant={Math.abs(diffVs3b) <= TOLERANCE ? 'success' : 'warning'} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Reversals</div>
          <Row label="ITC Reversal (Duties &amp; Taxes suspended)" value={reversal} />
          <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground my-2 bg-warning/5 border-warning/20">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />
            As per section 17(5) — not captured anywhere in the schema yet. Table 7's rule-wise reversals
            (37/38/39/42/43, 17(5)) need their own entry, not built in this phase — shown as excluded here, not
            assumed nil.
          </div>
          <Row label="Total (matches Table 7J)" value={total7J} strong />
        </div>
        <Row label="As per books (PL-Input total)" value={asPerBook} tag="Books" tagVariant="outline" />
      </CardContent>
    </Card>
  );
};

export default Gstr9InputView;
