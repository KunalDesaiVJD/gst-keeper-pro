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
// Paise-level rounding so summed-from-many-invoices rollup figures don't
// register as "differs" against a manual entry due to float noise alone.
const paise = (v: number) => Math.round(v * 100);

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
  const [saving, setSaving] = useState(false);
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
      const skipped: string[] = [];
      const upserts = CATEGORIES.filter((c) => {
        const current = rows[c];
        const computed = result.categories![c];
        const differsFromManual = current?.source === 'manual' && (
          paise(num(current.taxable_value)) !== paise(computed.taxable) ||
          paise(num(current.igst)) !== paise(computed.igst) ||
          paise(num(current.cgst)) !== paise(computed.cgst) ||
          paise(num(current.sgst)) !== paise(computed.sgst)
        );
        if (differsFromManual) skipped.push(CATEGORY_LABEL[c]);
        return !differsFromManual;
      }).map((c) => ({
        client_id: clientId, financial_year: financialYear, category: c,
        taxable_value: result.categories![c].taxable, igst: result.categories![c].igst, cgst: result.categories![c].cgst, sgst: result.categories![c].sgst,
        source: 'auto', updated_at: now,
      }));
      if (upserts.length > 0) {
        const { error } = await supabase.from('portal_gstr1_category_figures').upsert(upserts, { onConflict: 'client_id,financial_year,category' });
        if (error) throw error;
      }
      if (skipped.length > 0) {
        toast.success(`Recomputed ${upserts.length} categories from GSTR-1. ${skipped.length} manual ${skipped.length === 1 ? 'entry' : 'entries'} left unchanged (${skipped.join(', ')}).`);
      } else {
        toast.success('Recomputed from GSTR-1 — all 12 months were present.');
      }
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

  const dirtyCategories = CATEGORIES.filter((c) => dirty[c]);

  const saveAll = async () => {
    if (dirtyCategories.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const upserts = dirtyCategories.map((c) => {
        const r = rows[c];
        return { client_id: clientId, financial_year: financialYear, category: c, taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst), source: 'manual', updated_at: now };
      });
      const { error } = await supabase.from('portal_gstr1_category_figures').upsert(upserts, { onConflict: 'client_id,financial_year,category' });
      if (error) throw error;
      const saved = dirtyCategories;
      toast.success(`${saved.length} row${saved.length === 1 ? '' : 's'} saved.`);
      setDirty((prev) => {
        const next = { ...prev };
        saved.forEach((c) => { next[c] = false; });
        return next;
      });
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={recompute} disabled={rolling}>
              {rolling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Recompute from GSTR-1
            </Button>
            <Button size="sm" onClick={saveAll} disabled={saving || dirtyCategories.length === 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />} Save changes{dirtyCategories.length > 0 ? ` (${dirtyCategories.length})` : ''}
            </Button>
          </div>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((c) => {
              const r = rows[c] || { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0', source: 'manual' as const };
              return (
                <TableRow key={c}>
                  <TableCell className="font-medium">{CATEGORY_LABEL[c]}</TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.taxable_value} onChange={(e) => update(c, 'taxable_value', e.target.value)} disabled={saving} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.igst} onChange={(e) => update(c, 'igst', e.target.value)} disabled={saving} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.cgst} onChange={(e) => update(c, 'cgst', e.target.value)} disabled={saving} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.sgst} onChange={(e) => update(c, 'sgst', e.target.value)} disabled={saving} /></TableCell>
                  <TableCell><Badge variant={r.source === 'auto' ? 'success' : 'outline'}>{r.source === 'auto' ? 'Auto' : 'Manual'}</Badge></TableCell>
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

export default Gstr9OutputPortalCard;
