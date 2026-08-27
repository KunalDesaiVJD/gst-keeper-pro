import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const TAX_HEADS = ['igst', 'cgst', 'sgst', 'cess', 'interest'] as const;
type TaxHead = typeof TAX_HEADS[number];
const TAX_HEAD_LABEL: Record<TaxHead, string> = { igst: 'Integrated Tax', cgst: 'Central Tax', sgst: 'State/UT Tax', cess: 'Cess', interest: 'Interest' };

interface Row { payable: string; paid: string; }
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9 TABLE 14 — differential tax paid on the Table 10/11 declarations
 * (Annexure 4, above). Fixed 5-row set (IGST/CGST/SGST/Cess/Interest),
 * matching the real portal table exactly (portal roadmap, 27 Aug 2026).
 */
export const Table14DifferentialTaxCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<TaxHead, Row>>({} as Record<TaxHead, Row>);
  const [dirty, setDirty] = useState<Record<TaxHead, boolean>>({} as Record<TaxHead, boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({} as Record<TaxHead, Row>); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('gstr9_table14_differential_tax').select('tax_head, payable, paid').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load Table 14: ' + error.message); setLoading(false); return; }
    const next = {} as Record<TaxHead, Row>;
    TAX_HEADS.forEach((h) => { next[h] = { payable: '0', paid: '0' }; });
    (data || []).forEach((r: { tax_head: TaxHead; payable: number; paid: number }) => {
      next[r.tax_head] = { payable: String(r.payable), paid: String(r.paid) };
    });
    setRows(next);
    setDirty({} as Record<TaxHead, boolean>);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (head: TaxHead, field: keyof Row, value: string) => {
    setRows((prev) => ({ ...prev, [head]: { ...prev[head], [field]: value } }));
    setDirty((prev) => ({ ...prev, [head]: true }));
  };

  const dirtyHeads = TAX_HEADS.filter((h) => dirty[h]);

  const saveAll = async () => {
    if (dirtyHeads.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = dirtyHeads.map((h) => ({
        client_id: clientId, financial_year: financialYear, tax_head: h,
        payable: num(rows[h].payable), paid: num(rows[h].paid), updated_at: now,
      }));
      const { error } = await supabase.from('gstr9_table14_differential_tax').upsert(payload, { onConflict: 'client_id,financial_year,tax_head' });
      if (error) throw error;
      toast.success(`${payload.length} row${payload.length === 1 ? '' : 's'} saved.`);
      setDirty((prev) => {
        const next = { ...prev };
        dirtyHeads.forEach((h) => { next[h] = false; });
        return next;
      });
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const totals = TAX_HEADS.reduce((acc, h) => {
    const r = rows[h];
    if (!r) return acc;
    return { payable: acc.payable + num(r.payable), paid: acc.paid + num(r.paid) };
  }, { payable: 0, paid: 0 });

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">TABLE 14 — Differential tax paid</CardTitle>
        <CardDescription>On account of the declarations in Table 10 &amp; 11 (Annexure 4) above.</CardDescription>
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
          <CardTitle className="text-lg">TABLE 14 — Differential tax paid</CardTitle>
          <CardDescription>On account of the declarations in Table 10 &amp; 11 (Annexure 4) above.</CardDescription>
        </div>
        <Button size="sm" disabled={saving || dirtyHeads.length === 0} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyHeads.length > 0 ? ` (${dirtyHeads.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Payable (₹)</TableHead>
              <TableHead className="text-right">Paid (₹)</TableHead>
              <TableHead className="text-right">Difference (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TAX_HEADS.map((h) => {
              const r = rows[h] || { payable: '0', paid: '0' };
              const diff = num(r.payable) - num(r.paid);
              return (
                <TableRow key={h}>
                  <TableCell className="font-medium">{TAX_HEAD_LABEL[h]}</TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.payable} disabled={saving} onChange={(e) => update(h, 'payable', e.target.value)} aria-label={`${TAX_HEAD_LABEL[h]} payable`} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.paid} disabled={saving} onChange={(e) => update(h, 'paid', e.target.value)} aria-label={`${TAX_HEAD_LABEL[h]} paid`} /></TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(diff)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.payable)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.paid)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.payable - totals.paid)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Table14DifferentialTaxCard;
