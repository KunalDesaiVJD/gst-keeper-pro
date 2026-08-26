import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardPaste, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';
import { PasteFromExcelDialog } from '@/components/annualReturn/PasteFromExcelDialog';

const SUGGESTED_CATEGORIES = ['Transportation Exp', 'Delivery Exp', 'Office Rent Expense', 'Advocate Fees'];

interface Line {
  id: string;
  month: string;
  category: string;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
}

interface Row {
  id: string;
  isNew: boolean;
  month: string;
  category: string;
  taxable_value: string;
  igst: string;
  cgst: string;
  sgst: string;
}

const rowFromLine = (row: Line): Row => ({ id: row.id, isNew: false, month: row.month, category: row.category, taxable_value: String(row.taxable_value), igst: String(row.igst), cgst: String(row.cgst), sgst: String(row.sgst) });
const emptyRow = (month: string): Row => ({ id: `new-${crypto.randomUUID()}`, isNew: true, month, category: '', taxable_value: '', igst: '', cgst: '', sgst: '' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

interface PartATotals { taxable: number; igst: number; cgst: number; sgst: number; monthsPresent: number; }

/**
 * RCM — Part B (books), a dedicated entry for this module (firm decision,
 * 27 Aug 2026: kept independent of the existing rcm_data table used for 3B
 * prep, even though it duplicates that effort). Part A (portal) is computed
 * from the RCM figures captured on Portal Capture (R3) — read-only here.
 */
export const RcmAnnualReturnCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const months = monthsForFY(financialYear);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [partA, setPartA] = useState<PartATotals>({ taxable: 0, igst: 0, cgst: 0, sgst: 0, monthsPresent: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const [linesRes, portalRes] = await Promise.all([
      supabase.from('rcm_annual_return_lines').select('id, month, category, taxable_value, igst, cgst, sgst')
        .eq('client_id', clientId).eq('financial_year', financialYear).order('month', { ascending: true }),
      supabase.from('gst_filed_returns').select('summary').eq('client_id', clientId).eq('return_type', 'RCM').in('period_month', months),
    ]);
    if (linesRes.error) toast.error('Could not load RCM Part B: ' + linesRes.error.message);
    setRows(((linesRes.data || []) as Line[]).map(rowFromLine));
    setDirty(new Set());
    if (portalRes.error) {
      toast.error('Could not load RCM Part A: ' + portalRes.error.message);
    } else {
      const totals = (portalRes.data || []).reduce((acc, r: { summary: Record<string, number> | null }) => {
        const s = r.summary || {};
        return { taxable: acc.taxable + (Number(s.rcm_taxable) || 0), igst: acc.igst + (Number(s.rcm_igst) || 0), cgst: acc.cgst + (Number(s.rcm_cgst) || 0), sgst: acc.sgst + (Number(s.rcm_sgst) || 0), monthsPresent: acc.monthsPresent + 1 };
      }, { taxable: 0, igst: 0, cgst: 0, sgst: 0, monthsPresent: 0 });
      setPartA(totals);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLine = () => {
    const row = emptyRow(months[0]);
    setRows((prev) => [...prev, row]);
    setDirty((prev) => new Set(prev).add(row.id));
  };

  const handlePasteImport = (pasted: string[][]) => {
    const newRows: Row[] = [];
    const warnings: string[] = [];
    pasted.forEach((cells, i) => {
      const rowNum = i + 1;
      const [monthRaw, categoryRaw, taxableRaw, igstRaw, cgstRaw, sgstRaw] = cells;
      const isBlank = cells.every((c) => !c || !c.trim());
      if (isBlank) { warnings.push(`Row ${rowNum}: empty row skipped.`); return; }
      const monthInput = (monthRaw || '').trim();
      const month = months.find((m) => m.toLowerCase() === monthInput.toLowerCase());
      if (!month) { warnings.push(`Row ${rowNum}: unrecognized month "${monthInput}".`); return; }
      const category = (categoryRaw || '').trim();
      if (!category) { warnings.push(`Row ${rowNum}: category is required.`); return; }
      const cleanNum = (v: string | undefined) => {
        if (!v || !v.trim()) return 0;
        const n = Number(v.replace(/[₹,\s]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };
      newRows.push({
        id: `new-${crypto.randomUUID()}`,
        isNew: true,
        month,
        category,
        taxable_value: String(cleanNum(taxableRaw)),
        igst: String(cleanNum(igstRaw)),
        cgst: String(cleanNum(cgstRaw)),
        sgst: String(cleanNum(sgstRaw)),
      });
    });
    if (newRows.length > 0) {
      setRows((prev) => [...prev, ...newRows]);
      setDirty((prev) => { const next = new Set(prev); newRows.forEach((r) => next.add(r.id)); return next; });
    }
    const result = { imported: newRows.length, skipped: warnings.length, warnings };
    const summary = `Imported ${result.imported} row${result.imported === 1 ? '' : 's'}.${result.skipped > 0 ? ` ${result.skipped} skipped — see below:` : ''}`;
    const detail = warnings.slice(0, 3).join(' ');
    if (result.skipped > 0) {
      toast.error(`${summary} ${detail}`, { duration: 10000 });
    } else {
      toast.success(summary);
    }
    return result;
  };

  const updateRow = (id: string, field: keyof Omit<Row, 'id' | 'isNew'>, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDirty((prev) => new Set(prev).add(id));
  };

  const saveChanges = async () => {
    const dirtyRows = rows.filter((r) => dirty.has(r.id));
    if (dirtyRows.length === 0) return;
    const invalid = dirtyRows.find((r) => !r.category.trim());
    if (invalid) { toast.error(`Category is required for the ${invalid.month} row.`); return; }
    setSaving(true);
    try {
      const buildPayload = (r: Row) => ({
        client_id: clientId, financial_year: financialYear, month: r.month, category: r.category.trim(),
        taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst),
        updated_at: new Date().toISOString(),
      });
      const newRows = dirtyRows.filter((r) => r.isNew);
      const existingRows = dirtyRows.filter((r) => !r.isNew);
      if (newRows.length > 0) {
        const { error } = await supabase.from('rcm_annual_return_lines').insert(newRows.map(buildPayload));
        if (error) { toast.error('Save failed for new rows: ' + error.message); return; }
      }
      if (existingRows.length > 0) {
        const { error } = await supabase.from('rcm_annual_return_lines').upsert(existingRows.map((r) => ({ ...buildPayload(r), id: r.id })), { onConflict: 'id' });
        if (error) { toast.error('Save failed for existing rows: ' + error.message); return; }
      }
      toast.success(`${dirtyRows.length} RCM line${dirtyRows.length > 1 ? 's' : ''} saved.`);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: Row) => {
    if (row.isNew) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setDirty((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
      return;
    }
    const { error } = await supabase.from('rcm_annual_return_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totalTaxable = rows.reduce((a, r) => a + num(r.taxable_value), 0);
  const totalIgst = rows.reduce((a, r) => a + num(r.igst), 0);
  const totalCgst = rows.reduce((a, r) => a + num(r.cgst), 0);
  const totalSgst = rows.reduce((a, r) => a + num(r.sgst), 0);

  const partADiff = (totalIgst + totalCgst + totalSgst) - (partA.igst + partA.cgst + partA.sgst);
  const partAMatched = Math.abs(partADiff) <= 10;

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="mb-0">
        <CardHeader>
          <CardTitle className="text-lg">RCM — Part A (as per GST portal)</CardTitle>
          <CardDescription>Read-only — computed from the RCM figures captured on Portal Capture ({partA.monthsPresent} of {months.length} months present).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Taxable: <span className="font-medium text-foreground tabular-nums">{fmt(partA.taxable)}</span></span>
          <span className="text-muted-foreground">IGST: <span className="font-medium text-foreground tabular-nums">{fmt(partA.igst)}</span></span>
          <span className="text-muted-foreground">CGST: <span className="font-medium text-foreground tabular-nums">{fmt(partA.cgst)}</span></span>
          <span className="text-muted-foreground">SGST: <span className="font-medium text-foreground tabular-nums">{fmt(partA.sgst)}</span></span>
          {rows.length > 0 && <Badge variant={partAMatched ? 'success' : 'destructive'}>Diff vs Part B: {fmt(partADiff)}</Badge>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">RCM — Part B (Books)</CardTitle>
              <CardDescription>Category and month-wise, built up from books — matched against Part A above.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)}><ClipboardPaste className="h-3.5 w-3.5 mr-1.5" /> Paste from Excel</Button>
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>
              <Button size="sm" onClick={saveChanges} disabled={saving || dirty.size === 0}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save changes{dirty.size > 0 ? ` (${dirty.size})` : ''}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
        <datalist id="rcm-category-suggestions">{SUGGESTED_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Month</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">IGST</TableHead>
              <TableHead className="text-right">CGST</TableHead>
              <TableHead className="text-right">SGST</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No RCM Part B lines entered yet.</TableCell></TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Select value={row.month} onValueChange={(v) => updateRow(row.id, 'month', v)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input list="rcm-category-suggestions" value={row.category} onChange={(e) => updateRow(row.id, 'category', e.target.value)} placeholder="e.g. Transportation Exp" />
                </TableCell>
                <TableCell><Input type="number" value={row.taxable_value} onChange={(e) => updateRow(row.id, 'taxable_value', e.target.value)} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={row.igst} onChange={(e) => updateRow(row.id, 'igst', e.target.value)} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={row.cgst} onChange={(e) => updateRow(row.id, 'cgst', e.target.value)} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={row.sgst} onChange={(e) => updateRow(row.id, 'sgst', e.target.value)} placeholder="0" className="text-right" /></TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label={`Delete ${row.category}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Total Part B</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totalTaxable)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totalIgst)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totalCgst)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totalSgst)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
        </CardContent>
      </Card>

      <PasteFromExcelDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Paste RCM Part B lines from Excel"
        columnLabels={['Month', 'Category', 'Taxable', 'IGST', 'CGST', 'SGST']}
        onImport={handlePasteImport}
      />
    </div>
  );
};

export default RcmAnnualReturnCard;
