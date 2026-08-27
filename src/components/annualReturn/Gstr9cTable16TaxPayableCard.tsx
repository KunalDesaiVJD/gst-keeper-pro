import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const ROW_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
type RowKey = typeof ROW_KEYS[number];
const ROW_LABEL: Record<RowKey, string> = {
  A: 'Central Tax', B: 'State Tax/UT Tax', C: 'Integrated Tax', D: 'Cess', E: 'Interest', F: 'Penalty',
};

const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C TABLE 16 — Tax payable on un-reconciled difference in ITC (due
 * to the reasons recorded in Tables 13 & 15 above). Verified against the
 * real GSTR_9C_Offline_Utility.xlsm (v2.8), sheet "PT IV (16)", 27 Aug
 * 2026. Entirely manual — this table IS the auditor's answer, same as
 * Table 11.
 */
export const Gstr9cTable16TaxPayableCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<RowKey, string>>({} as Record<RowKey, string>);
  const [dirty, setDirty] = useState<Record<RowKey, boolean>>({} as Record<RowKey, boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('gstr9c_table16_tax_payable_unreconciled_itc').select('row_key, amount').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load Table 16: ' + error.message); setLoading(false); return; }
    const next = {} as Record<RowKey, string>;
    ROW_KEYS.forEach((k) => { next[k] = '0'; });
    (data || []).forEach((r: { row_key: RowKey; amount: number }) => { next[r.row_key] = String(r.amount); });
    setRows(next);
    setDirty({} as Record<RowKey, boolean>);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (k: RowKey, v: string) => { setRows((prev) => ({ ...prev, [k]: v })); setDirty((prev) => ({ ...prev, [k]: true })); };
  const dirtyKeys = ROW_KEYS.filter((k) => dirty[k]);

  const saveAll = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = dirtyKeys.map((k) => ({ client_id: clientId, financial_year: financialYear, row_key: k, amount: num(rows[k]), updated_at: now }));
      const { error } = await supabase.from('gstr9c_table16_tax_payable_unreconciled_itc').upsert(payload, { onConflict: 'client_id,financial_year,row_key' });
      if (error) throw error;
      toast.success(`${payload.length} row${payload.length === 1 ? '' : 's'} saved.`);
      setDirty({} as Record<RowKey, boolean>);
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const total = ROW_KEYS.reduce((s, k) => s + num(rows[k] || '0'), 0);

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">TABLE 16 — Tax Payable on Un-Reconciled ITC</CardTitle>
        <CardDescription>Due to the reasons recorded in Tables 13 & 15 above.</CardDescription>
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
          <CardTitle className="text-lg">TABLE 16 — Tax Payable on Un-Reconciled ITC</CardTitle>
          <CardDescription>Due to the reasons recorded in Tables 13 & 15 above.</CardDescription>
        </div>
        <Button size="sm" disabled={saving || dirtyKeys.length === 0} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-40">Amount payable (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROW_KEYS.map((k) => (
              <TableRow key={k}>
                <TableCell className="font-medium text-muted-foreground">{k}</TableCell>
                <TableCell className="text-sm">{ROW_LABEL[k]}</TableCell>
                <TableCell><Input type="number" className="text-right h-8" value={rows[k] ?? '0'} disabled={saving} onChange={(e) => update(k, e.target.value)} aria-label={ROW_LABEL[k]} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{fmt(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Gstr9cTable16TaxPayableCard;
