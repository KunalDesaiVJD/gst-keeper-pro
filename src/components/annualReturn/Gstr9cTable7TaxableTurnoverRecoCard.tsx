import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchGstr9cTable5TurnoverReco, computeGstr9cTable5P, fetchGstr9cTable7TaxableTurnoverReco, type Table7RowKey } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const REASON_LINE_KEY = 'gstr9c_table8_taxable_turnover';

const ROW_KEYS: Table7RowKey[] = ['B', 'C', 'D', 'D1', 'F'];
const ROW_LABEL: Record<Table7RowKey, string> = {
  B: 'Value of Exempted, Nil Rated, Non-GST, No-supply turnover',
  C: 'Zero rated supplies without payment of tax',
  D: 'Supplies on which tax is to be paid by the recipient on reverse charge basis',
  D1: 'Supplies on which tax is to be paid by e-commerce operators u/s 9(5)',
  F: 'Taxable turnover as per liability declared in Annual Return (GSTR-9)',
};

type Rows = Record<Table7RowKey, string>;
const emptyRows = (): Rows => ({ B: '0', C: '0', D: '0', D1: '0', F: '0' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C TABLE 7 — Reconciliation of Taxable Turnover, plus Table 8's
 * reason for the unreconciled difference. Verified against the real
 * GSTR_9C_Offline_Utility.xlsm (v2.8), sheet "PT II (7)"/"(8)", 27 Aug 2026.
 * Row A is Table 5's P, computed from gstr9c_table5_turnover_reco — never
 * re-entered or re-derived independently.
 */
export const Gstr9cTable7TaxableTurnoverRecoCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [a, setA] = useState(0);
  const [rows, setRows] = useState<Rows>(emptyRows());
  const [reason, setReason] = useState('');
  const [savedReason, setSavedReason] = useState('');
  const [dirty, setDirty] = useState<Record<Table7RowKey, boolean>>({} as Record<Table7RowKey, boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows(emptyRows()); setA(0); setLoading(false); return; }
    setLoading(true);
    try {
      const [table5Rows, table7Totals, reasonRes] = await Promise.all([
        fetchGstr9cTable5TurnoverReco(clientId, financialYear),
        fetchGstr9cTable7TaxableTurnoverReco(clientId, financialYear),
        supabase.from('reconciliation_reasons').select('reason').eq('client_id', clientId).eq('financial_year', financialYear).eq('line_key', REASON_LINE_KEY).maybeSingle(),
      ]);
      setA(computeGstr9cTable5P(table5Rows));
      const next = emptyRows();
      ROW_KEYS.forEach((k) => { next[k] = String(table7Totals[k]); });
      setRows(next);
      setReason(reasonRes.data?.reason || '');
      setSavedReason(reasonRes.data?.reason || '');
      setDirty({} as Record<Table7RowKey, boolean>);
    } catch (err) {
      toast.error('Could not load Table 7: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (k: Table7RowKey, v: string) => { setRows((prev) => ({ ...prev, [k]: v })); setDirty((prev) => ({ ...prev, [k]: true })); };

  const e = a - num(rows.B) - num(rows.C) - num(rows.D) - num(rows.D1);
  const g = num(rows.F) - e;
  const reasonDirty = reason !== savedReason;
  const dirtyKeys = ROW_KEYS.filter((k) => dirty[k]);

  const saveAll = async () => {
    if (dirtyKeys.length === 0 && !reasonDirty) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (dirtyKeys.length > 0) {
        const payload = dirtyKeys.map((k) => ({ client_id: clientId, financial_year: financialYear, row_key: k, amount: num(rows[k]), updated_at: now }));
        const { error } = await supabase.from('gstr9c_table7_taxable_turnover_reco').upsert(payload, { onConflict: 'client_id,financial_year,row_key' });
        if (error) throw error;
      }
      if (reasonDirty) {
        const { error } = await supabase.from('reconciliation_reasons').upsert(
          { client_id: clientId, financial_year: financialYear, line_key: REASON_LINE_KEY, reason: reason.trim(), entered_by: user?.id || null, updated_at: now },
          { onConflict: 'client_id,financial_year,line_key' },
        );
        if (error) throw error;
        setSavedReason(reason.trim());
      }
      toast.success('Table 7 saved.');
      setDirty({} as Record<Table7RowKey, boolean>);
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const dirtyCount = dirtyKeys.length + (reasonDirty ? 1 : 0);

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">TABLE 7 — Reconciliation of Taxable Turnover</CardTitle>
        <CardDescription>From Table 5's adjusted turnover down to the taxable portion — matches the offline utility's Part II(7) exactly.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center gap-2 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">TABLE 7 — Reconciliation of Taxable Turnover</CardTitle>
          <CardDescription>From Table 5's adjusted turnover down to the taxable portion — matches the offline utility's Part II(7) exactly.</CardDescription>
        </div>
        <Button size="sm" disabled={saving || dirtyCount === 0} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-40">Amount (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">A</TableCell>
              <TableCell className="text-sm font-medium">Annual Turnover after adjustments [from Table 5(P) above]</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(a)} <Badge variant="outline" className="ml-1 text-[10px] align-middle">Table 5</Badge></TableCell>
            </TableRow>
            {ROW_KEYS.map((k) => (
              <TableRow key={k}>
                <TableCell className="font-medium text-muted-foreground">{k}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{ROW_LABEL[k]}</TableCell>
                <TableCell><Input type="number" className="text-right h-8" value={rows[k]} disabled={saving} onChange={(e2) => update(k, e2.target.value)} aria-label={ROW_LABEL[k]} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>E — Taxable turnover as per adjustments above (A−B−C−D−D1)</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{fmt(e)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={2}>G — Unreconciled Taxable Turnover (F−E)</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {fmt(g)}{' '}
                <Badge variant={Math.abs(g) <= TOLERANCE ? 'success' : 'destructive'} className="ml-1 text-[10px] align-middle">
                  {Math.abs(g) <= TOLERANCE ? 'Matched' : 'Needs a reason'}
                </Badge>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {Math.abs(g) > TOLERANCE && (
          <div className="p-4 border-t space-y-2">
            <div className="text-sm font-medium">Table 8 — Reason for the Un-Reconciled difference</div>
            <Textarea value={reason} onChange={(e2) => setReason(e2.target.value)} placeholder="Why does the taxable turnover not reconcile?" rows={3} disabled={saving} className="text-sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Gstr9cTable7TaxableTurnoverRecoCard;
