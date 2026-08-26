import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchDutiesTaxesInputAnnual, fetchRcmTotals, fetchPortalItcClaimedAnnual, fetchCarryForwardTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Remarks on the Excess ITC badge are stored in reconciliation_reasons — the
// same audit-trail table the Reconciliation tab already writes per-line
// reasons to (client_id + financial_year + line_key, upserted). This reuses
// that schema under its own line_key rather than standing up a new table.
const REMARKS_LINE_KEY = 'annexure2_excess_itc';

interface Props { clientId: string; financialYear: string; }

const Row: React.FC<{ label: string; value: number; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between py-2 border-b last:border-b-0">
    <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</span>
  </div>
);

/** ANNEXURE-2 — ITC reconciliation: the ITC ledger's Dr. balance through to any excess claimed. */
export const Annexure2Card: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [drBalance, setDrBalance] = useState(0);
  const [rcmItc, setRcmItc] = useState(0);
  const [debitNote, setDebitNote] = useState(0);
  const [otherAdjustment, setOtherAdjustment] = useState(0);
  const [claimedInNextFy, setClaimedInNextFy] = useState(0);
  const [asPerPortal, setAsPerPortal] = useState(0);
  const [reversal, setReversal] = useState(0);
  const [claimedFromPrevFy, setClaimedFromPrevFy] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [remarksDraft, setRemarksDraft] = useState('');
  const [remarksSaving, setRemarksSaving] = useState(false);

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

  useEffect(() => {
    if (!clientId || !financialYear) { setRemarks(''); setRemarksDraft(''); return; }
    let cancelled = false;
    supabase
      .from('reconciliation_reasons')
      .select('reason')
      .eq('client_id', clientId)
      .eq('financial_year', financialYear)
      .eq('line_key', REMARKS_LINE_KEY)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.log('Annexure 2 remarks: could not load — ' + error.message); return; }
        setRemarks(data?.reason ?? '');
        setRemarksDraft(data?.reason ?? '');
      });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  const saveRemarks = async () => {
    setRemarksSaving(true);
    try {
      const { error } = await supabase.from('reconciliation_reasons').upsert({
        client_id: clientId,
        financial_year: financialYear,
        line_key: REMARKS_LINE_KEY,
        reason: remarksDraft.trim(),
        entered_by: user?.id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,financial_year,line_key' });
      if (error) throw error;
      setRemarks(remarksDraft.trim());
      toast.success('Remarks saved.');
    } catch (err) {
      console.log('Annexure 2 remarks: could not save — ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setRemarksSaving(false);
    }
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const netItcAvailed = drBalance + rcmItc - debitNote - otherAdjustment;
  const total = netItcAvailed - claimedInNextFy;
  const netItc = asPerPortal - reversal - claimedFromPrevFy;
  const excess = total - netItc;

  // Same empty-FY guard as Annexure-1: every fetched raw total at zero means
  // nothing has been entered yet, not that the year is actually reconciled.
  const allInputsZero =
    drBalance === 0 && rcmItc === 0 && debitNote === 0 && otherAdjustment === 0 &&
    claimedInNextFy === 0 && asPerPortal === 0 && reversal === 0 && claimedFromPrevFy === 0;

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
          {allInputsZero ? (
            <Badge variant="outline">No data yet</Badge>
          ) : (
            <Badge variant={Math.abs(excess) <= 10 ? 'success' : 'destructive'}>{fmt(excess)}</Badge>
          )}
        </div>
        <div className="pt-3 space-y-1.5">
          <label htmlFor="annexure2-remarks" className="text-xs font-medium text-muted-foreground">Remarks (optional)</label>
          <Textarea
            id="annexure2-remarks"
            value={remarksDraft}
            onChange={(e) => setRemarksDraft(e.target.value)}
            placeholder="e.g. known timing difference, discussed with client 12 Aug"
            className="min-h-[64px] text-sm"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={remarksSaving || remarksDraft.trim() === remarks.trim()}
              onClick={saveRemarks}
            >
              {remarksSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save remarks
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default Annexure2Card;
