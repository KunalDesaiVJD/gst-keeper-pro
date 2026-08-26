import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchPlOutputTotals, fetchRcmTotals, fetchPortalTurnoverAnnual, fetchDutiesTaxesInputAnnual,
  fetchPortalItcClaimedAnnual, fetchCarryForwardTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/**
 * ANNEXURE-3 — DRC-03 pre-calculation. Every open reconciliation line the
 * year carries, summed into one payable figure. "Any other payment" is a
 * real manually-entered figure (annexure3_other_payments) — added after the
 * 25 Aug 2026 UX audit found the Total silently excluded it with no entry
 * surface anywhere, hard-coded to zero.
 */
export const Annexure3Card: React.FC<Props> = ({ clientId, financialYear }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clause9Diff, setClause9Diff] = useState(0);
  const [rcmToBePaid, setRcmToBePaid] = useState(0);
  const [excessItc, setExcessItc] = useState(0);
  const [otherPayment, setOtherPayment] = useState(0);
  const [otherNotes, setOtherNotes] = useState('');
  const [draftAmount, setDraftAmount] = useState('0');
  const [draftNotes, setDraftNotes] = useState('');

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
      supabase.from('annexure3_other_payments').select('amount, notes').eq('client_id', clientId).eq('financial_year', financialYear).maybeSingle(),
    ]).then(([pl, rcm, portalTurnover, dt, portalItc, cf, otherRes]) => {
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
      const amount = Number(otherRes.data?.amount) || 0;
      const notes = otherRes.data?.notes || '';
      setOtherPayment(amount);
      setOtherNotes(notes);
      setDraftAmount(String(amount));
      setDraftNotes(notes);
    }).catch((err) => toast.error('Could not compute Annexure 3: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  const saveOtherPayment = async () => {
    setSaving(true);
    try {
      const amount = num(draftAmount);
      const { error } = await supabase.from('annexure3_other_payments').upsert(
        { client_id: clientId, financial_year: financialYear, amount, notes: draftNotes || null, updated_at: new Date().toISOString() },
        { onConflict: 'client_id,financial_year' },
      );
      if (error) throw error;
      setOtherPayment(amount);
      setOtherNotes(draftNotes);
      toast.success('Any other payment saved.');
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const dirty = num(draftAmount) !== otherPayment || draftNotes !== otherNotes;
  const total = clause9Diff + Math.max(rcmToBePaid, 0) + Math.max(excessItc, 0) + otherPayment;

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
        <div className="py-2 border-b space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Any other payment</span>
            <Input type="number" className="w-40 text-right" aria-label="Any other payment amount"
              value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} />
          </div>
          <Textarea placeholder="Reason / basis for this payment (optional)" aria-label="Any other payment notes"
            value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} className="text-xs min-h-[54px]" />
          <div className="flex justify-end">
            <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={saving || !dirty} onClick={saveOtherPayment} aria-label="Save any other payment">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}Save
            </Button>
          </div>
        </div>
        <Row label="Total" value={total} strong />
      </CardContent>
    </Card>
  );
};

export default Annexure3Card;
