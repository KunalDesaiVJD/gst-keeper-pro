import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const ROW_KEYS = ['A', 'B', 'C'] as const;
type RowKey = typeof ROW_KEYS[number];
const ROW_LABEL: Record<RowKey, string> = {
  A: 'Supplies received from Composition taxpayers',
  B: 'Deemed supply under Section 143',
  C: 'Goods sent on approval basis but not returned',
};

const COLUMNS = ['taxable_value', 'central_tax', 'state_tax', 'integrated_tax', 'cess'] as const;
type Column = typeof COLUMNS[number];
const COLUMN_LABEL: Record<Column, string> = {
  taxable_value: 'Taxable Value', central_tax: 'Central Tax', state_tax: 'State/UT Tax', integrated_tax: 'Integrated Tax', cess: 'Cess',
};

type Row = Record<Column, string>;
const emptyRow = (): Row => ({ taxable_value: '0', central_tax: '0', state_tax: '0', integrated_tax: '0', cess: '0' });
const num = (v: string) => (v === '' ? 0 : Number(v));

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9 TABLE 16 — Supplies received from Composition taxpayers, deemed
 * supply under s.143, and goods sent on approval basis but not returned
 * (portal roadmap, 27 Aug 2026). Fixed 3-row grid, standalone manual entry.
 */
export const Table16CompositionDeemedApprovalCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<RowKey, Row>>({} as Record<RowKey, Row>);
  const [dirty, setDirty] = useState<Record<RowKey, boolean>>({} as Record<RowKey, boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({} as Record<RowKey, Row>); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('gstr9_table16_composition_deemed_approval')
      .select('row_key, taxable_value, central_tax, state_tax, integrated_tax, cess')
      .eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load Table 16: ' + error.message); setLoading(false); return; }
    const next = {} as Record<RowKey, Row>;
    ROW_KEYS.forEach((k) => { next[k] = emptyRow(); });
    (data || []).forEach((r: { row_key: RowKey } & Record<Column, number>) => {
      next[r.row_key] = { taxable_value: String(r.taxable_value), central_tax: String(r.central_tax), state_tax: String(r.state_tax), integrated_tax: String(r.integrated_tax), cess: String(r.cess) };
    });
    setRows(next);
    setDirty({} as Record<RowKey, boolean>);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: RowKey, col: Column, value: string) => {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], [col]: value } }));
    setDirty((prev) => ({ ...prev, [key]: true }));
  };

  const dirtyKeys = ROW_KEYS.filter((k) => dirty[k]);

  const saveAll = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = dirtyKeys.map((k) => ({
        client_id: clientId, financial_year: financialYear, row_key: k,
        taxable_value: num(rows[k].taxable_value), central_tax: num(rows[k].central_tax), state_tax: num(rows[k].state_tax),
        integrated_tax: num(rows[k].integrated_tax), cess: num(rows[k].cess), updated_at: now,
      }));
      const { error } = await supabase.from('gstr9_table16_composition_deemed_approval').upsert(payload, { onConflict: 'client_id,financial_year,row_key' });
      if (error) throw error;
      toast.success(`${payload.length} row${payload.length === 1 ? '' : 's'} saved.`);
      setDirty((prev) => {
        const next = { ...prev };
        dirtyKeys.forEach((k) => { next[k] = false; });
        return next;
      });
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">TABLE 16 — Composition / Deemed Supply / Approval Basis</CardTitle>
        <CardDescription>Standalone — not derived from any other table.</CardDescription>
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
          <CardTitle className="text-lg">TABLE 16 — Composition / Deemed Supply / Approval Basis</CardTitle>
          <CardDescription>Standalone — not derived from any other table.</CardDescription>
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
                <TableHead className="min-w-[280px]">Particulars</TableHead>
                {COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{COLUMN_LABEL[c]}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROW_KEYS.map((k) => {
                const r = rows[k] || emptyRow();
                return (
                  <TableRow key={k}>
                    <TableCell className="font-medium whitespace-nowrap">{k}. {ROW_LABEL[k]}</TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell key={c} className="min-w-[110px]">
                        <Input type="number" className="text-right h-8" value={r[c]} disabled={saving} onChange={(e) => update(k, c, e.target.value)} aria-label={`${ROW_LABEL[k]} ${COLUMN_LABEL[c]}`} />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default Table16CompositionDeemedApprovalCard;
