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
import { fetchGstr9cTable9RateWiseLiabilityReco, computeGstr9cTable9P, type Table9RowKey, type RateWiseRow } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const REASON_LINE_KEY = 'gstr9c_table10_rate_wise_liability';

// Rate-slab rows carry a Taxable Value; Interest/Late Fee/Penalty/Others don't.
const RATE_ROW_KEYS: Table9RowKey[] = ['A', 'B', 'B1', 'C', 'D', 'E', 'F', 'G', 'H', 'H1', 'H2', 'I', 'J', 'K', 'K1', 'K2'];
const OTHER_ROW_KEYS: Table9RowKey[] = ['L', 'M', 'N', 'O'];
const ALL_ROW_KEYS = [...RATE_ROW_KEYS, ...OTHER_ROW_KEYS];

const ROW_LABEL: Record<Table9RowKey, string> = {
  A: '5%', B: '5% (RC)', B1: '6%', C: '12%', D: '12% (RC)', E: '18%', F: '18% (RC)',
  G: '28%', H: '28% (RC)', H1: '40%', H2: '40% (RC)', I: '3%', J: '0.25%', K: '0.10%', K1: 'Others%',
  K2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)',
  L: 'Interest', M: 'Late Fee', N: 'Penalty', O: 'Others', Q: 'Total amount payable as declared in Annual Return (GSTR-9)',
};

type FieldRows = Record<Table9RowKey, { taxable_value: string; central_tax: string; state_tax: string; integrated_tax: string; cess: string }>;
const emptyFieldRow = () => ({ taxable_value: '0', central_tax: '0', state_tax: '0', integrated_tax: '0', cess: '0' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C TABLE 9 — Reconciliation of rate-wise liability and amount
 * payable thereon, plus Table 10's reason for the unreconciled payment.
 * Verified against the real GSTR_9C_Offline_Utility.xlsm (v2.8), sheet
 * "PT III (9)"/"(10)", 27 Aug 2026.
 */
export const Gstr9cTable9RateWiseLiabilityCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<FieldRows>({} as FieldRows);
  const [reason, setReason] = useState('');
  const [savedReason, setSavedReason] = useState('');
  const [dirty, setDirty] = useState<Record<Table9RowKey, boolean>>({} as Record<Table9RowKey, boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    setLoading(true);
    try {
      const [data, reasonRes] = await Promise.all([
        fetchGstr9cTable9RateWiseLiabilityReco(clientId, financialYear),
        supabase.from('reconciliation_reasons').select('reason').eq('client_id', clientId).eq('financial_year', financialYear).eq('line_key', REASON_LINE_KEY).maybeSingle(),
      ]);
      const next = {} as FieldRows;
      [...ALL_ROW_KEYS, 'Q' as Table9RowKey].forEach((k) => {
        const r = data[k];
        next[k] = { taxable_value: String(r.taxable_value), central_tax: String(r.central_tax), state_tax: String(r.state_tax), integrated_tax: String(r.integrated_tax), cess: String(r.cess) };
      });
      setRows(next);
      setReason(reasonRes.data?.reason || '');
      setSavedReason(reasonRes.data?.reason || '');
      setDirty({} as Record<Table9RowKey, boolean>);
    } catch (err) {
      toast.error('Could not load Table 9: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (k: Table9RowKey, field: keyof RateWiseRow, v: string) => {
    setRows((prev) => ({ ...prev, [k]: { ...prev[k], [field]: v } }));
    setDirty((prev) => ({ ...prev, [k]: true }));
  };

  const rowAmounts = (k: Table9RowKey): RateWiseRow => {
    const r = rows[k] || emptyFieldRow();
    return { taxable_value: num(r.taxable_value), central_tax: num(r.central_tax), state_tax: num(r.state_tax), integrated_tax: num(r.integrated_tax), cess: num(r.cess) };
  };
  const allAmounts = {} as Record<Table9RowKey, RateWiseRow>;
  ALL_ROW_KEYS.forEach((k) => { allAmounts[k] = rowAmounts(k); });
  const p = computeGstr9cTable9P(allAmounts);
  const q = rowAmounts('Q');
  const r = { central_tax: q.central_tax - p.central_tax, state_tax: q.state_tax - p.state_tax, integrated_tax: q.integrated_tax - p.integrated_tax, cess: q.cess - p.cess };
  const rMax = Math.max(Math.abs(r.central_tax), Math.abs(r.state_tax), Math.abs(r.integrated_tax), Math.abs(r.cess));

  const dirtyKeys = (Object.keys(dirty) as Table9RowKey[]).filter((k) => dirty[k]);
  const reasonDirty = reason !== savedReason;

  const saveAll = async () => {
    if (dirtyKeys.length === 0 && !reasonDirty) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (dirtyKeys.length > 0) {
        const payload = dirtyKeys.map((k) => ({ client_id: clientId, financial_year: financialYear, row_key: k, ...rowAmounts(k), updated_at: now }));
        const { error } = await supabase.from('gstr9c_table9_rate_wise_liability_reco').upsert(payload, { onConflict: 'client_id,financial_year,row_key' });
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
      toast.success('Table 9 saved.');
      setDirty({} as Record<Table9RowKey, boolean>);
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const dirtyCount = dirtyKeys.length + (reasonDirty ? 1 : 0);

  const renderRow = (k: Table9RowKey, hasTaxable: boolean) => {
    const row = rows[k] || emptyFieldRow();
    return (
      <TableRow key={k}>
        <TableCell className="font-medium text-muted-foreground whitespace-nowrap">{k}</TableCell>
        <TableCell className="text-sm min-w-[160px]">{ROW_LABEL[k]}</TableCell>
        <TableCell className="min-w-[110px]">
          {hasTaxable
            ? <Input type="number" className="text-right h-8" value={row.taxable_value} disabled={saving} onChange={(e) => update(k, 'taxable_value', e.target.value)} aria-label={`${ROW_LABEL[k]} taxable value`} />
            : <span className="text-xs text-muted-foreground pl-2">—</span>}
        </TableCell>
        <TableCell className="min-w-[110px]"><Input type="number" className="text-right h-8" value={row.central_tax} disabled={saving} onChange={(e) => update(k, 'central_tax', e.target.value)} aria-label={`${ROW_LABEL[k]} central tax`} /></TableCell>
        <TableCell className="min-w-[110px]"><Input type="number" className="text-right h-8" value={row.state_tax} disabled={saving} onChange={(e) => update(k, 'state_tax', e.target.value)} aria-label={`${ROW_LABEL[k]} state tax`} /></TableCell>
        <TableCell className="min-w-[110px]"><Input type="number" className="text-right h-8" value={row.integrated_tax} disabled={saving} onChange={(e) => update(k, 'integrated_tax', e.target.value)} aria-label={`${ROW_LABEL[k]} integrated tax`} /></TableCell>
        <TableCell className="min-w-[110px]"><Input type="number" className="text-right h-8" value={row.cess} disabled={saving} onChange={(e) => update(k, 'cess', e.target.value)} aria-label={`${ROW_LABEL[k]} cess`} /></TableCell>
      </TableRow>
    );
  };

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">TABLE 9 — Reconciliation of Rate-Wise Liability</CardTitle>
        <CardDescription>Matches the offline utility's Part III(9) exactly.</CardDescription>
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
          <CardTitle className="text-lg">TABLE 9 — Reconciliation of Rate-Wise Liability</CardTitle>
          <CardDescription>Matches the offline utility's Part III(9) exactly.</CardDescription>
        </div>
        <Button size="sm" disabled={saving || dirtyCount === 0} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Taxable Value (₹)</TableHead>
                <TableHead className="text-right">Central Tax</TableHead>
                <TableHead className="text-right">State/UT Tax</TableHead>
                <TableHead className="text-right">Integrated Tax</TableHead>
                <TableHead className="text-right">Cess</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RATE_ROW_KEYS.map((k) => renderRow(k, true))}
              {OTHER_ROW_KEYS.map((k) => renderRow(k, false))}
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Q</TableCell>
                <TableCell className="text-sm font-medium min-w-[160px]">{ROW_LABEL.Q}</TableCell>
                <TableCell><span className="text-xs text-muted-foreground pl-2">—</span></TableCell>
                {(['central_tax', 'state_tax', 'integrated_tax', 'cess'] as const).map((f) => (
                  <TableCell key={f} className="min-w-[110px]">
                    <Input type="number" className="text-right h-8" value={(rows.Q || emptyFieldRow())[f]} disabled={saving} onChange={(e) => update('Q', f, e.target.value)} aria-label={`${ROW_LABEL.Q} ${f}`} />
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>P — Total amount to be paid as per tables above (sum A-O)</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(p.taxable_value)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(p.central_tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(p.state_tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(p.integrated_tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(p.cess)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>
                  R — Un-reconciled payment (Q−P){' '}
                  <Badge variant={rMax <= TOLERANCE ? 'success' : 'destructive'} className="ml-1 text-[10px] align-middle">
                    {rMax <= TOLERANCE ? 'Matched' : 'Needs a reason'}
                  </Badge>
                </TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums font-semibold">{fmt(r.central_tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(r.state_tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(r.integrated_tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(r.cess)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {rMax > TOLERANCE && (
          <div className="p-4 border-t space-y-2">
            <div className="text-sm font-medium">Table 10 — Reason for the Un-Reconciled Payment of Tax</div>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why doesn't the tax payment reconcile?" rows={3} disabled={saving} className="text-sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Gstr9cTable9RateWiseLiabilityCard;
