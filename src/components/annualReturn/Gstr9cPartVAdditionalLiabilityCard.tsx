import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchGstr9cPartVAdditionalLiability } from '@/lib/annualReturnAggregates';

const RATE_ROW_KEYS = ['A', 'A1', 'B', 'C', 'D', 'D1', 'E', 'F', 'G', 'G1', 'G2'] as const;
const OTHER_ROW_KEYS = ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
const ALL_ROW_KEYS = [...RATE_ROW_KEYS, ...OTHER_ROW_KEYS] as const;
type RowKey = typeof ALL_ROW_KEYS[number];

const ROW_LABEL: Record<RowKey, string> = {
  A: '5%', A1: '6%', B: '12%', C: '18%', D: '28%', D1: '40%', E: '3%', F: '0.25%', G: '0.10%', G1: 'Others%',
  G2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)',
  H: 'Input tax credit', I: 'Interest', J: 'Late Fee', K: 'Penalty',
  L: 'Any other amount paid for supplies not included in Annual Return (GSTR-9)',
  M: 'Erroneous refund to be paid back', N: 'Outstanding demands to be settled', O: 'Other',
};

interface RateWiseRowStr { taxable_value: string; central_tax: string; state_tax: string; integrated_tax: string; cess: string; }
type FieldRows = Record<RowKey, RateWiseRowStr>;
const emptyFieldRow = (): RateWiseRowStr => ({ taxable_value: '0', central_tax: '0', state_tax: '0', integrated_tax: '0', cess: '0' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C PART V — Additional Liability due to non-reconciliation.
 * Verified against the real GSTR_9C_Offline_Utility.xlsm (v2.8), sheet
 * "PT V", 27 Aug 2026. Entirely manual, no formula cells in the real
 * sheet — this is the auditor's consolidated additional-liability
 * recommendation, same shape as Table 11.
 */
export const Gstr9cPartVAdditionalLiabilityCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<FieldRows>({} as FieldRows);
  const [dirty, setDirty] = useState<Record<RowKey, boolean>>({} as Record<RowKey, boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchGstr9cPartVAdditionalLiability(clientId, financialYear);
      const next = {} as FieldRows;
      ALL_ROW_KEYS.forEach((k) => {
        const r = data[k];
        next[k] = { taxable_value: String(r.taxable_value), central_tax: String(r.central_tax), state_tax: String(r.state_tax), integrated_tax: String(r.integrated_tax), cess: String(r.cess) };
      });
      setRows(next);
      setDirty({} as Record<RowKey, boolean>);
    } catch (err) {
      toast.error('Could not load Part V: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (k: RowKey, field: keyof RateWiseRowStr, v: string) => {
    setRows((prev) => ({ ...prev, [k]: { ...prev[k], [field]: v } }));
    setDirty((prev) => ({ ...prev, [k]: true }));
  };

  const rowAmounts = (k: RowKey) => {
    const r = rows[k] || emptyFieldRow();
    return { taxable_value: num(r.taxable_value), central_tax: num(r.central_tax), state_tax: num(r.state_tax), integrated_tax: num(r.integrated_tax), cess: num(r.cess) };
  };
  const totals = ALL_ROW_KEYS.reduce((acc, k) => {
    const r = rowAmounts(k);
    return { taxable_value: acc.taxable_value + r.taxable_value, central_tax: acc.central_tax + r.central_tax, state_tax: acc.state_tax + r.state_tax, integrated_tax: acc.integrated_tax + r.integrated_tax, cess: acc.cess + r.cess };
  }, { taxable_value: 0, central_tax: 0, state_tax: 0, integrated_tax: 0, cess: 0 });

  const dirtyKeys = (Object.keys(dirty) as RowKey[]).filter((k) => dirty[k]);

  const saveAll = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = dirtyKeys.map((k) => ({ client_id: clientId, financial_year: financialYear, row_key: k, ...rowAmounts(k), updated_at: now }));
      const { error } = await supabase.from('gstr9c_part_v_additional_liability').upsert(payload, { onConflict: 'client_id,financial_year,row_key' });
      if (error) throw error;
      toast.success(`${payload.length} row${payload.length === 1 ? '' : 's'} saved.`);
      setDirty({} as Record<RowKey, boolean>);
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (k: RowKey, hasTaxable: boolean) => {
    const row = rows[k] || emptyFieldRow();
    return (
      <TableRow key={k}>
        <TableCell className="font-medium text-muted-foreground whitespace-nowrap">{k}</TableCell>
        <TableCell className="text-sm min-w-[200px]">{ROW_LABEL[k]}</TableCell>
        <TableCell className="min-w-[110px]">
          {hasTaxable
            ? <Input type="number" className="text-right h-8" value={row.taxable_value} disabled={saving} onChange={(e) => update(k, 'taxable_value', e.target.value)} aria-label={`${ROW_LABEL[k]} value`} />
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
        <CardTitle className="text-lg">PART V — Additional Liability Due to Non-Reconciliation</CardTitle>
        <CardDescription>Matches the offline utility's Part V exactly.</CardDescription>
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
          <CardTitle className="text-lg">PART V — Additional Liability Due to Non-Reconciliation</CardTitle>
          <CardDescription>Matches the offline utility's Part V exactly.</CardDescription>
        </div>
        <Button size="sm" disabled={saving || dirtyKeys.length === 0} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Value (₹)</TableHead>
                <TableHead className="text-right">Central Tax</TableHead>
                <TableHead className="text-right">State/UT Tax</TableHead>
                <TableHead className="text-right">Integrated Tax</TableHead>
                <TableHead className="text-right">Cess</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RATE_ROW_KEYS.map((k) => renderRow(k, true))}
              {OTHER_ROW_KEYS.map((k) => renderRow(k, false))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Total — Paid through Cash/ITC</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.taxable_value)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.central_tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.state_tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.integrated_tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.cess)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default Gstr9cPartVAdditionalLiabilityCard;
