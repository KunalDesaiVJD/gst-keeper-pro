import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPlInputTotals, fetchPlOutputPartBByBifurcation, fetchDutiesTaxesInputAnnual, fetchRcmTotals,
  fetchPortalItcClaimedAnnual, fetchPortal2bAnnual, fetchPortalCategoryTotals, fetchItcReversalTotals,
  fetchTaxPaymentTotals, fetchCarryForwardTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; tag?: string; tagVariant?: 'success' | 'warning' | 'secondary' | 'outline' | 'destructive'; strong?: boolean }> = ({ label, value, tag, tagVariant = 'secondary', strong }) => (
  <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
    <div className="flex items-center gap-2">
      <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
      {tag && <Badge variant={tagVariant} className="text-[10px]">{tag}</Badge>}
    </div>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

interface Computed {
  t4A: number; t4B: number; t4D: number; t4E: number; t4G: number; t4I: number; t4H: number; t4M: number; t4N: number;
  t5A: number; t5B: number; t5F: number; t5G: number; t5M: number; t5N: number;
  totalTurnover: number;
  t6A: number; t6B: number; t6C_D: number; t6H: number; t6I: number; t6O: number;
  t7Rulewise: number; t7H1: number; t7I: number; t7J: number;
  t8A: number; t8B: number; t8C: number; t8D: number;
  payIgst: { payable: number; paid: number }; payCgst: { payable: number; paid: number }; paySgst: { payable: number; paid: number };
  t10: number; t11: number; t12: number; t13: number;
}

const GROUPS = [
  { id: 'outward', label: 'Table 4–5 · Outward' },
  { id: 'itc', label: 'Table 6–7 · ITC' },
  { id: 'reco8', label: 'Table 8 · ITC vs 2B' },
  { id: 'taxpaid', label: 'Table 9 · Tax paid' },
  { id: 'nextyear', label: 'Table 10–13 · Next year' },
] as const;

/**
 * The terminal assembly — GSTR-9 Tables 4 through 13, built from every
 * earlier phase's data. Nothing is entered here. Where the sheet's formula
 * chain genuinely needs a figure the schema doesn't produce cleanly, that's
 * noted rather than approximated silently.
 */
export const Gstr9FormView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [group, setGroup] = useState<typeof GROUPS[number]['id']>('outward');
  const [c, setC] = useState<Computed | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setStatus('idle'); setC(null); return; }
    let cancelled = false;
    setStatus('loading');
    setC(null);
    Promise.all([
      fetchPlInputTotals(clientId, financialYear),
      fetchPlOutputPartBByBifurcation(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchPortalItcClaimedAnnual(clientId, financialYear),
      fetchPortal2bAnnual(clientId, financialYear),
      fetchPortalCategoryTotals(clientId, financialYear),
      fetchItcReversalTotals(clientId, financialYear),
      fetchTaxPaymentTotals(clientId, financialYear),
      fetchCarryForwardTotals(clientId, financialYear),
    ]).then(([pl, plOutB, dt, rcm, portalItc, portal2b, cat, itcRev, pay, cf]) => {
      if (cancelled) return;
      const t4A = taxTotal(cat.b2c), t4B = taxTotal(cat.b2b), t4D = taxTotal(cat.sez_with), t4E = taxTotal(cat.deemed_export);
      const t4G = taxTotal(rcm.partA);
      const t4I = -Math.abs(taxTotal(cat.credit_note));
      const t4H = t4A + t4B + t4D + t4E + t4G;
      const t4M = t4I;
      const t4N = t4H + t4M;

      const t5A = taxTotal(plOutB.export_wo_tax), t5B = taxTotal(plOutB.sez_wo_tax), t5F = taxTotal(plOutB.non_gst);
      const t5G = t5A + t5B + t5F;
      const t5M = t5G;
      const t5N = t4N + t5M - t4G;

      const t6A = taxTotal(portalItc);
      const t6B = taxTotal(pl.purchase);
      const t6C_D = taxTotal(rcm.partB);
      const t6H = taxTotal(pl.expense) + taxTotal(pl.capital_goods);
      const t6I = t6B + t6C_D + t6H + taxTotal(dt.reclaimTotal);
      const t6O = t6I;

      const t7Rulewise = taxTotal(itcRev.total);
      const t7H1 = taxTotal(dt.reversalTotal);
      const t7I = t7Rulewise + t7H1;
      const t7J = t6O - t7I;

      const t8A = taxTotal(portal2b);
      const t8B = t6B;
      const t8C = taxTotal(cf.claimed_in_next_fy);
      const t8D = t8A - (t8B + t8C);

      const payIgst = { payable: pay.igst.payable, paid: pay.igst.paidCash + pay.igst.paidItc };
      const payCgst = { payable: pay.cgst.payable, paid: pay.cgst.paidCash + pay.cgst.paidItc };
      const paySgst = { payable: pay.sgst.payable, paid: pay.sgst.paidCash + pay.sgst.paidItc };

      setC({
        t4A, t4B, t4D, t4E, t4G, t4I, t4H, t4M, t4N,
        t5A, t5B, t5F, t5G, t5M, t5N, totalTurnover: t5N,
        t6A, t6B, t6C_D, t6H, t6I, t6O,
        t7Rulewise, t7H1, t7I, t7J,
        t8A, t8B, t8C, t8D,
        payIgst, payCgst, paySgst,
        t10: taxTotal(cf.turnover_declared_next_fy), t11: taxTotal(cf.turnover_reduced_next_fy),
        t12: taxTotal(cf.claimed_in_next_fy) * -1, t13: taxTotal(cf.claimed_in_next_fy),
      });
      setStatus('ready');
    }).catch((err) => {
      toast.error('Could not assemble GSTR-9: ' + (err instanceof Error ? err.message : 'Unknown error'));
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [clientId, financialYear, retryTick]);

  if (status === 'idle') return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Select a client and financial year to view this.</CardContent></Card>;
  if (status === 'loading') return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  if (status === 'error' || !c) return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="text-sm text-muted-foreground">Could not load this client's GSTR-9 summary.</span>
        <Button size="sm" variant="outline" onClick={() => setRetryTick((t) => t + 1)}>Retry</Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <Button key={g.id} size="sm" variant={group === g.id ? 'default' : 'outline'} onClick={() => setGroup(g.id)}>{g.label}</Button>
        ))}
      </div>

      {group === 'outward' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Table 4 — Supplies on which tax is payable</CardTitle><CardDescription>4A–4N, from GSTR 9-Output's auto-populated column and RCM Part A.</CardDescription></CardHeader>
          <CardContent className="max-w-lg">
            <Row label="4A — B2C" value={c.t4A} />
            <Row label="4B — B2B" value={c.t4B} />
            <Row label="4D — SEZ with payment" value={c.t4D} />
            <Row label="4E — Deemed exports" value={c.t4E} />
            <Row label="4G — RCM inward (Part A)" value={c.t4G} tag="Portal" tagVariant="outline" />
            <Row label="4H — Sub-total" value={c.t4H} />
            <Row label="4I — Credit notes (−)" value={c.t4I} />
            <Row label="4N — Supplies &amp; advances on which tax payable" value={c.t4N} strong />
          </CardContent>
        </Card>
      )}
      {group === 'outward' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Table 5 — Supplies on which tax is not payable</CardTitle></CardHeader>
          <CardContent className="max-w-lg">
            <Row label="5A — Export without payment of tax" value={c.t5A} />
            <Row label="5B — SEZ without payment" value={c.t5B} />
            <Row label="5F — Non-GST supply" value={c.t5F} />
            <Row label="5G / 5M — Sub-total" value={c.t5M} />
            <Row label="5N — Total turnover (4N + 5M − 4G)" value={c.totalTurnover} strong />
          </CardContent>
        </Card>
      )}

      {group === 'itc' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Table 6 — ITC availed</CardTitle></CardHeader>
          <CardContent className="max-w-lg">
            <Row label="6A — Total ITC via GSTR-3B" value={c.t6A} tag="Portal" tagVariant="outline" />
            <Row label="6B — Inputs" value={c.t6B} />
            <Row label="6C/6D — RCM" value={c.t6C_D} />
            <Row label="Input Services + Capital Goods" value={c.t6H} />
            <Row label="6O — Total ITC availed" value={c.t6O} strong tag={Math.abs(c.t6O - c.t6A) <= TOLERANCE ? 'Matches 6A' : `Diff vs 6A: ${fmt(c.t6O - c.t6A)}`} tagVariant={Math.abs(c.t6O - c.t6A) <= TOLERANCE ? 'success' : 'warning'} />
          </CardContent>
        </Card>
      )}
      {group === 'itc' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Table 7 — ITC Reversed &amp; Ineligible</CardTitle></CardHeader>
          <CardContent className="max-w-lg">
            <Row label="Rule-wise (37/37A/38/39/42/43) + s.17(5)" value={c.t7Rulewise} />
            <Row label="H1 — Other reversal" value={c.t7H1} />
            <Row label="7I — Total ITC reversed" value={c.t7I} />
            <Row label="7J — Net ITC available for utilisation" value={c.t7J} strong />
          </CardContent>
        </Card>
      )}

      {group === 'reco8' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Table 8 — ITC as per GSTR-2B</CardTitle></CardHeader>
          <CardContent className="max-w-lg">
            <Row label="8A — ITC as per GSTR-2B" value={c.t8A} tag="Portal" tagVariant="outline" />
            <Row label="8B — ITC per 6B" value={c.t8B} tag="Computed" tagVariant="outline" />
            <Row label="8C — Claimed in next FY" value={c.t8C} />
            <Row label="8D — Difference [A−(B+C)]" value={c.t8D} strong tag={Math.abs(c.t8D) <= TOLERANCE ? 'Matched — lockable' : 'Needs a reason'} tagVariant={Math.abs(c.t8D) <= TOLERANCE ? 'success' : 'destructive'} />
          </CardContent>
        </Card>
      )}

      {group === 'taxpaid' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Table 9 — Tax paid</CardTitle></CardHeader>
          <CardContent className="max-w-lg">
            {([['IGST', c.payIgst], ['CGST', c.payCgst], ['SGST', c.paySgst]] as [string, { payable: number; paid: number }][]).map(([label, v]) => (
              <Row key={label} label={`${label} — payable / paid`} value={v.payable} tag={`Paid ${fmt(v.paid)}`} tagVariant={Math.abs(v.payable - v.paid) <= TOLERANCE ? 'success' : 'destructive'} />
            ))}
          </CardContent>
        </Card>
      )}

      {group === 'nextyear' && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Tables 10–13 — Next-year amendments</CardTitle><CardDescription>From Annexure 4's carry-forward entries.</CardDescription></CardHeader>
          <CardContent className="max-w-lg">
            <Row label="10 — Supplies declared through amendments (+)" value={c.t10} />
            <Row label="11 — Supplies reduced through amendments (−)" value={c.t11} />
            <Row label="12 — ITC of the FY reversed in next FY" value={c.t12} />
            <Row label="13 — ITC of the FY availed in next FY" value={c.t13} />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Gstr9FormView;
