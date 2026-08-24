import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { rollupGstr1Categories, Gstr1Category } from '@/lib/gstr1CategoryRollup';

const CATEGORIES: Gstr1Category[] = ['b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note'];
const CATEGORY_LABEL: Record<string, string> = {
  b2c: 'B2C', b2b: 'B2B', sez_with: 'SEZ with payment', sez_without: 'SEZ w/o payment',
  zero_rated: 'Zero rated', deemed_export: 'Deemed export', credit_note: 'Credit note',
};

interface Row { category: string; taxable_value: string; igst: string; cgst: string; sgst: string; source: 'auto' | 'manual'; }
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR 9-OUTPUT, column B (auto-populated) — computed from gstr1_data when
 * all 12 months are present (firm decision, 27 Aug 2026), with manual entry
 * as the fallback for any FY where they aren't. A recompute never writes
 * over a manual figure silently — the "Recompute from GSTR-1" action is
 * explicit, and only available once the months are actually complete.
 */
export const Gstr9OutputPortalCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<{ present: number; total: number } | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({}); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('portal_gstr1_category_figures').select('category, taxable_value, igst, cgst, sgst, source').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load GSTR 9-Output portal figures: ' + error.message); setLoading(false); return; }
    const next: Record<string, Row> = {};
    CATEGORIES.forEach((c) => { next[c] = { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0', source: 'manual' }; });
    (data || []).forEach((r: { category: string; taxable_value: number; igst: number; cgst: number; sgst: number; source: 'auto' | 'manual' }) => {
      next[r.category] = { category: r.category, taxable_value: String(r.taxable_value), igst: String(r.igst), cgst: String(r.cgst), sgst: String(r.sgst), source: r.source };
    });
    setRows(next);
    setDirty({});
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const recompute = async () => {
    setRolling(true);
    try {
      const result = await rollupGstr1Categories(clientId, financialYear);
      setCompleteness({ present: result.monthsPresent, total: result.monthsTotal });
      if (!result.complete || !result.categories) {
        toast.warning(`Only ${result.monthsPresent} of ${result.monthsTotal} months have GSTR-1 data — can't auto-populate until all months are present. Enter figures manually below for now.`);
        return;
      }
      const now = new Date().toISOString();
      const upserts = CATEGORIES.map((c) => ({
        client_id: clientId, financial_year: financialYear, category: c,
        taxable_value: result.categories![c].taxable, igst: result.categories![c].igst, cgst: result.categories![c].cgst, sgst: result.categories![c].sgst,
        source: 'auto', updated_at: now,
      }));
      const { error } = await supabase.from('portal_gstr1_category_figures').upsert(upserts, { onConflict: 'client_id,financial_year,category' });
      if (error) throw error;
      toast.success('Recomputed from GSTR-1 — all 12 months were present.');
      await load();
    } catch (err) {
      toast.error('Recompute failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setRolling(false);
    }
  };

  const update = (category: string, field: keyof Row, value: string) => {
    setRows((prev) => ({ ...prev, [category]: { ...prev[category], [field]: value, source: 'manual' } }));
    setDirty((prev) => ({ ...prev, [category]: true }));
  };

  const save = async (category: string) => {
    const r = rows[category];
    setSavingKey(category);
    try {
      const { error } = await supabase.from('portal_gstr1_category_figures').upsert(
        { client_id: clientId, financial_year: financialYear, category, taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst), source: 'manual', updated_at: new Date().toISOString() },
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
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg">GSTR 9-OUTPUT — Portal column (auto-populated)</CardTitle>
            <CardDescription>
              Computed from GSTR-1 when all 12 months are present{completeness ? ` (last check: ${completeness.present} of ${completeness.total})` : ''}; manual entry is the fallback.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={recompute} disabled={rolling}>
            {rolling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Recompute from GSTR-1
          </Button>
        </div>
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
              <TableHead className="w-20">Source</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((c) => {
              const r = rows[c] || { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0', source: 'manual' as const };
              return (
                <TableRow key={c}>
                  <TableCell className="font-medium">{CATEGORY_LABEL[c]}</TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.taxable_value} onChange={(e) => update(c, 'taxable_value', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.igst} onChange={(e) => update(c, 'igst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.cgst} onChange={(e) => update(c, 'cgst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.sgst} onChange={(e) => update(c, 'sgst', e.target.value)} /></TableCell>
                  <TableCell><Badge variant={r.source === 'auto' ? 'success' : 'outline'}>{r.source === 'auto' ? 'Auto' : 'Manual'}</Badge></TableCell>
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
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Gstr9OutputPortalCard;
