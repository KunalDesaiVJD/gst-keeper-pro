import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Inbox, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchDutiesTaxesInputAnnual, fetchPlInputTotals, fetchRcmTotals, taxTotal } from '@/lib/annualReturnAggregates';
import { EXPENSE_HEADS, TABLE14_EXPENSE_HEADS } from '@/components/annualReturn/PLInputCard';

const TOLERANCE = 10;
const REASON_LINE_KEY = 'gstr9c_table15_itc_reasons';
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface HeadTotals { value: number; totalItc: number; }

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C TABLE 14 — "Reconciliation of ITC declared in Annual Return
 * (GSTR9) with ITC availed on expenses as per audited Annual Financial
 * Statement or books of account". The 17 official expense-head rows (A-Q),
 * from PL-Input lines grouped by expense_head. Net suspended ITC (from
 * Duties & Taxes-Input) is deducted from the Purchases bucket only,
 * matching the sheet — every other head is unaffected.
 *
 * Renamed 27 Aug 2026 (was "Table 12B", which doesn't exist in the real
 * offline utility — GSTR-9C's Table 12 is a separate 4-line summary, see
 * Table12NetItcSummaryCard). RCM is deliberately excluded from this
 * table's total: the real form has no RCM row here at all — RCM ITC is
 * reconciled instead via GSTR-9's own Table 6C/D — but it's still shown as
 * a memo line so its contribution to any unreconciled gap below isn't a
 * silent mystery.
 */
export const Gstr9cTable14ItcByExpenseHeadView: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Record<string, HeadTotals>>({});
  const [gstr9InputTotal, setGstr9InputTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [savedReason, setSavedReason] = useState('');

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('pl_input_lines').select('expense_head, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchPlInputTotals(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      supabase.from('reconciliation_reasons').select('reason').eq('client_id', clientId).eq('financial_year', financialYear).eq('line_key', REASON_LINE_KEY).maybeSingle(),
    ]).then(([linesRes, dt, pl, rcmTotals, reasonRes]) => {
      if (cancelled) return;
      if (linesRes.error) throw linesRes.error;
      const next: Record<string, HeadTotals> = {};
      EXPENSE_HEADS.forEach((h) => { next[h] = { value: 0, totalItc: 0 }; });
      (linesRes.data || []).forEach((r: { expense_head: string | null; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
        if (!r.expense_head || !next[r.expense_head]) return;
        next[r.expense_head].value += Number(r.taxable_value);
        next[r.expense_head].totalItc += Number(r.igst) + Number(r.cgst) + Number(r.sgst);
      });
      const netSuspended = taxTotal(dt.netSuspended);
      next['Purchases'].totalItc -= netSuspended;
      setRows(next);
      // Matches GSTR 9-Input's "Total (matches Table 6O)" computation — this
      // deliberately INCLUDES RCM (row E/S), while the table below excludes
      // it, so any RCM-driven gap shows up honestly as unreconciled.
      setGstr9InputTotal(taxTotal(pl.purchase) + taxTotal(pl.expense) + taxTotal(pl.capital_goods) + taxTotal(rcmTotals.partB) + taxTotal(dt.reclaimTotal));
      setReason(reasonRes.data?.reason || '');
      setSavedReason(reasonRes.data?.reason || '');
    }).catch((err) => toast.error('Could not compute GSTR 9C Table 14: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  const reasonDirty = reason !== savedReason;
  const saveReason = async () => {
    if (!reasonDirty) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('reconciliation_reasons').upsert(
        { client_id: clientId, financial_year: financialYear, line_key: REASON_LINE_KEY, reason: reason.trim(), entered_by: user?.id || null, updated_at: new Date().toISOString() },
        { onConflict: 'client_id,financial_year,line_key' },
      );
      if (error) throw error;
      setSavedReason(reason.trim());
      toast.success('Table 15 reason saved.');
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const totalValue = TABLE14_EXPENSE_HEADS.reduce((a, h) => a + (rows[h]?.value || 0), 0);
  const totalItc = TABLE14_EXPENSE_HEADS.reduce((a, h) => a + (rows[h]?.totalItc || 0), 0);
  const visibleHeads = TABLE14_EXPENSE_HEADS.filter((h) => {
    const r = rows[h] || { value: 0, totalItc: 0 };
    return r.value !== 0 || r.totalItc !== 0;
  });
  const hiddenCount = TABLE14_EXPENSE_HEADS.length - visibleHeads.length;
  const rcm = rows['RCM'] || { value: 0, totalItc: 0 };

  if (visibleHeads.length === 0 && rcm.value === 0 && rcm.totalItc === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">GSTR-9C TABLE 14 — ITC by expense head</CardTitle>
          <CardDescription>Purchases net of suspended ITC, matching the sheet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">No PL-Input entries for this client/year yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">GSTR-9C TABLE 14 — ITC by expense head</CardTitle>
        <CardDescription>Purchases net of suspended ITC, matching the sheet. RCM has no row here (see memo below) — reconciled via the RCM tab instead.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-6 py-2 text-xs text-muted-foreground">
          Showing {visibleHeads.length} of {TABLE14_EXPENSE_HEADS.length} expense heads
          {hiddenCount > 0 ? ` (${hiddenCount} with no ITC hidden)` : ''}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expense head</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Total ITC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TABLE14_EXPENSE_HEADS.map((h) => {
              const r = rows[h] || { value: 0, totalItc: 0 };
              if (r.value === 0 && r.totalItc === 0) return null;
              return (
                <TableRow key={h}>
                  <TableCell className="font-medium">{h}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.value)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.totalItc)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>R — Total eligible ITC availed</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totalValue)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totalItc)}</TableCell>
            </TableRow>
            {(rcm.value !== 0 || rcm.totalItc !== 0) && (
              <TableRow>
                <TableCell className="text-muted-foreground italic">RCM (excluded from Table 14 — see RCM tab / Table 6C/D)</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(rcm.value)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(rcm.totalItc)}</TableCell>
              </TableRow>
            )}
          </TableFooter>
        </Table>
        {gstr9InputTotal !== null && (
          <p className="flex items-center gap-2 px-6 py-3 text-xs text-muted-foreground">
            S — ITC claimed in GSTR-9: <span className="tabular-nums text-foreground">{fmt(gstr9InputTotal)}</span>
            <Badge variant={Math.abs(totalItc - gstr9InputTotal) <= TOLERANCE ? 'success' : 'warning'} className="text-[10px]">
              {Math.abs(totalItc - gstr9InputTotal) <= TOLERANCE ? 'Matched (T)' : `T — Diff ${fmt(totalItc - gstr9InputTotal)}`}
            </Badge>
          </p>
        )}
        {gstr9InputTotal !== null && Math.abs(totalItc - gstr9InputTotal) > TOLERANCE && (
          <div className="px-6 pb-4 space-y-2 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Table 15 — Reason for the Un-Reconciled difference</div>
              <Button size="sm" variant={reasonDirty ? 'default' : 'outline'} disabled={saving || !reasonDirty} onClick={saveReason}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save
              </Button>
            </div>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why doesn't the ITC-by-expense-head total reconcile?" rows={3} disabled={saving} className="text-sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Gstr9cTable14ItcByExpenseHeadView;
