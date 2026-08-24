import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const CATEGORIES = ['b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note'] as const;
const CATEGORY_LABEL: Record<string, string> = {
  b2c: 'B2C', b2b: 'B2B', sez_with: 'SEZ with payment', sez_without: 'SEZ w/o payment',
  zero_rated: 'Zero rated', deemed_export: 'Deemed export', credit_note: 'Credit note',
};

interface Row { category: string; taxable_value: string; igst: string; cgst: string; sgst: string; }
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR 9-OUTPUT, column A (books) — the B2C/B2B/SEZ/deemed-export/credit-note
 * classification the sheet needs, which PL-Output doesn't carry as a
 * dimension. Column B (auto-populated from gstr1_data) lands in R3.
 */
export const Gstr9OutputLinesCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({}); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('gstr9_output_lines').select('category, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load GSTR 9-Output: ' + error.message); setLoading(false); return; }
    const next: Record<string, Row> = {};
    CATEGORIES.forEach((c) => { next[c] = { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0' }; });
    (data || []).forEach((r: { category: string; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
      next[r.category] = { category: r.category, taxable_value: String(r.taxable_value), igst: String(r.igst), cgst: String(r.cgst), sgst: String(r.sgst) };
    });
    setRows(next);
    setDirty({});
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (category: string, field: keyof Row, value: string) => {
    setRows((prev) => ({ ...prev, [category]: { ...prev[category], [field]: value } }));
    setDirty((prev) => ({ ...prev, [category]: true }));
  };

  const save = async (category: string) => {
    const r = rows[category];
    setSavingKey(category);
    try {
      const { error } = await supabase.from('gstr9_output_lines').upsert(
        { client_id: clientId, financial_year: financialYear, category, taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst), updated_at: new Date().toISOString() },
        { onConflict: 'client_id,financial_year,category' },
      );
      if (error) throw error;
      toast.success(`${CATEGORY_LABEL[category]} saved.`);
      setDirty((prev) => ({ ...prev, [category]: false }));
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSavingKey(null);
    }
  };

  const totals = CATEGORIES.reduce((acc, c) => {
    const r = rows[c];
    if (!r) return acc;
    return { taxable: acc.taxable + num(r.taxable_value), igst: acc.igst + num(r.igst), cgst: acc.cgst + num(r.cgst), sgst: acc.sgst + num(r.sgst) };
  }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">GSTR 9-OUTPUT — Books column</CardTitle>
        <CardDescription>Books-side classification by supply type — compared against the portal's auto-populated figures once R3 lands.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">IGST</TableHead>
              <TableHead className="text-right">CGST</TableHead>
              <TableHead className="text-right">SGST</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((c) => {
              const r = rows[c] || { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0' };
              return (
                <TableRow key={c}>
                  <TableCell className="font-medium">{CATEGORY_LABEL[c]}</TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.taxable_value} onChange={(e) => update(c, 'taxable_value', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.igst} onChange={(e) => update(c, 'igst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.cgst} onChange={(e) => update(c, 'cgst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.sgst} onChange={(e) => update(c, 'sgst', e.target.value)} /></TableCell>
                  <TableCell>
                    <Button size="sm" variant={dirty[c] ? 'default' : 'ghost'} disabled={savingKey === c} onClick={() => save(c)}>
                      {savingKey === c ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.taxable)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.igst)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.cgst)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.sgst)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Gstr9OutputLinesCard;
