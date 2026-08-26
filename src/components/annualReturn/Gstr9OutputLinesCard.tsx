import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PasteFromExcelDialog, PasteImportResult } from '@/components/annualReturn/PasteFromExcelDialog';

const CATEGORIES = ['b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note'] as const;
const CATEGORY_LABEL: Record<string, string> = {
  b2c: 'B2C', b2b: 'B2B', sez_with: 'SEZ with payment', sez_without: 'SEZ w/o payment',
  zero_rated: 'Zero rated', deemed_export: 'Deemed export', credit_note: 'Credit note',
};

interface Row { category: string; taxable_value: string; igst: string; cgst: string; sgst: string; updated_at: string | null; }
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR 9-OUTPUT, column A (books) — the B2C/B2B/SEZ/deemed-export/credit-note
 * classification the sheet needs, which PL-Output doesn't carry as a
 * dimension. Column B (auto-populated from gstr1_data) lands in R3.
 */
const parseLenient = (v: string | undefined) => {
  if (v === undefined || v === null || v.trim() === '') return 0;
  const cleaned = v.replace(/[₹$,\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

export const Gstr9OutputLinesCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({}); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('gstr9_output_lines').select('category, taxable_value, igst, cgst, sgst, updated_at').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load GSTR 9-Output: ' + error.message); setLoading(false); return; }
    const next: Record<string, Row> = {};
    CATEGORIES.forEach((c) => { next[c] = { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0', updated_at: null }; });
    (data || []).forEach((r: { category: string; taxable_value: number; igst: number; cgst: number; sgst: number; updated_at: string | null }) => {
      next[r.category] = { category: r.category, taxable_value: String(r.taxable_value), igst: String(r.igst), cgst: String(r.cgst), sgst: String(r.sgst), updated_at: r.updated_at };
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

  const dirtyCategories = CATEGORIES.filter((c) => dirty[c]);

  const findCategory = (raw: string): string | null => {
    const v = (raw || '').trim().toLowerCase();
    if (!v) return null;
    const byKey = CATEGORIES.find((c) => c.toLowerCase() === v);
    if (byKey) return byKey;
    const byLabel = CATEGORIES.find((c) => CATEGORY_LABEL[c].toLowerCase() === v);
    return byLabel || null;
  };

  const handlePasteImport = (parsedRows: string[][]): PasteImportResult => {
    const warnings: string[] = [];
    let imported = 0;
    parsedRows.forEach((row, i) => {
      const rowNum = i + 1;
      if (row.every((cell) => !cell || !cell.trim())) {
        warnings.push(`Row ${rowNum}: empty row skipped.`);
        return;
      }
      const [rawCategory, rawTaxable, rawIgst, rawCgst, rawSgst] = row;
      const category = findCategory(rawCategory);
      if (!category) {
        warnings.push(`Row ${rowNum}: "${rawCategory ?? ''}" is not a recognized category.`);
        return;
      }
      update(category, 'taxable_value', String(parseLenient(rawTaxable)));
      update(category, 'igst', String(parseLenient(rawIgst)));
      update(category, 'cgst', String(parseLenient(rawCgst)));
      update(category, 'sgst', String(parseLenient(rawSgst)));
      imported++;
    });

    if (warnings.length > 0) {
      const preview = warnings.slice(0, 3).join(' ');
      const msg = `Imported ${imported} row${imported === 1 ? '' : 's'}. ${warnings.length} skipped — see below: ${preview}`;
      if (imported > 0) toast.warning(msg, { duration: 8000 });
      else toast.error(msg, { duration: 8000 });
    } else {
      toast.success(`Imported ${imported} row${imported === 1 ? '' : 's'}.`);
    }

    return { imported, skipped: warnings.length, warnings };
  };

  const saveAll = async () => {
    if (dirtyCategories.length === 0) return;
    setSaving(true);
    try {
      const payload = dirtyCategories.map((category) => {
        const r = rows[category];
        return { client_id: clientId, financial_year: financialYear, category, taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst), updated_at: new Date().toISOString() };
      });
      const { error } = await supabase.from('gstr9_output_lines').upsert(payload, { onConflict: 'client_id,financial_year,category' });
      if (error) throw error;
      toast.success(`${payload.length} row${payload.length === 1 ? '' : 's'} saved.`);
      setDirty((prev) => {
        const next = { ...prev };
        dirtyCategories.forEach((c) => { next[c] = false; });
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
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">GSTR 9-OUTPUT — Books column</CardTitle>
          <CardDescription>Books-side classification by supply type — compared against the portal's auto-populated figures once R3 lands.</CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
            Paste from Excel
          </Button>
          <Button size="sm" disabled={dirtyCategories.length === 0 || saving} onClick={saveAll}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save changes{dirtyCategories.length > 0 ? ` (${dirtyCategories.length})` : ''}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((c) => {
              const r = rows[c] || { category: c, taxable_value: '0', igst: '0', cgst: '0', sgst: '0', updated_at: null };
              return (
                <TableRow key={c}>
                  <TableCell className="font-medium">
                    {CATEGORY_LABEL[c]}
                    {r.updated_at && <div className="text-[11px] font-normal text-muted-foreground">Updated {new Date(r.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
                  </TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.taxable_value} disabled={saving} onChange={(e) => update(c, 'taxable_value', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.igst} disabled={saving} onChange={(e) => update(c, 'igst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.cgst} disabled={saving} onChange={(e) => update(c, 'cgst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={r.sgst} disabled={saving} onChange={(e) => update(c, 'sgst', e.target.value)} /></TableCell>
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
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
      <PasteFromExcelDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Paste GSTR 9-OUTPUT lines from Excel"
        columnLabels={['Category', 'Taxable', 'IGST', 'CGST', 'SGST']}
        onImport={handlePasteImport}
      />
    </Card>
  );
};

export default Gstr9OutputLinesCard;
