import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardPaste, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PasteFromExcelDialog, PasteImportResult } from './PasteFromExcelDialog';

type Part = 'A' | 'B';
const BIFURCATIONS = ['export_wo_tax', 'sez_wo_tax', 'non_gst'] as const;
const BIFURCATION_LABEL: Record<string, string> = {
  export_wo_tax: 'Export sale W/O',
  sez_wo_tax: 'SEZ W/O',
  non_gst: 'Non-GST',
};
const GST_RATE_SUGGESTIONS = ['0%', '0.1%', '0.25%', '1%', '1.5%', '3%', '5%', '7.5%', '12%', '18%', '28%', 'Exempt/Nil'];

interface Line {
  id: string;
  part: Part;
  ledger_head: string;
  bifurcation: string | null;
  rate: string | null;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
}

interface EditRow {
  key: string;
  id?: string;
  part: Part;
  ledger_head: string;
  bifurcation: string;
  rate: string;
  taxable_value: string;
  igst: string;
  cgst: string;
  sgst: string;
}

const emptyRow = (part: Part): EditRow => ({ key: `new-${crypto.randomUUID()}`, part, ledger_head: '', bifurcation: '', rate: '', taxable_value: '', igst: '', cgst: '', sgst: '' });
const toEditRow = (row: Line): EditRow => ({
  key: row.id, id: row.id, part: row.part, ledger_head: row.ledger_head, bifurcation: row.bifurcation || '',
  rate: row.rate || '', taxable_value: String(row.taxable_value), igst: String(row.igst), cgst: String(row.cgst), sgst: String(row.sgst),
});
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Lenient numeric paste parsing: blank -> 0, strips stray currency symbols/commas, NaN -> 0. */
const parsePastedNum = (v: string | undefined) => {
  if (!v || !v.trim()) return 0;
  const cleaned = v.replace(/[₹$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

interface Props {
  clientId: string;
  financialYear: string;
}

/**
 * PL-OUTPUT — Part A (taxable) and Part B (non-taxable), annual, by ledger
 * head, exactly as the firm's sheet has it (no month — Duties & Taxes-Output
 * is the separate monthly entry, cross-checked against this, not derived
 * from it). Part A+B is cross-checked here against the audited turnover
 * already captured in client_annual_turnover.
 */
export const PLOutputCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<EditRow[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [auditedTurnover, setAuditedTurnover] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteOpenA, setPasteOpenA] = useState(false);
  const [pasteOpenB, setPasteOpenB] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setDirty(new Set()); setLoading(false); return; }
    setLoading(true);
    const [linesRes, turnoverRes] = await Promise.all([
      supabase.from('pl_output_lines').select('id, part, ledger_head, bifurcation, rate, taxable_value, igst, cgst, sgst')
        .eq('client_id', clientId).eq('financial_year', financialYear).order('created_at', { ascending: true }),
      supabase.from('client_annual_turnover').select('aggregate_turnover').eq('client_id', clientId).eq('financial_year', financialYear).maybeSingle(),
    ]);
    if (linesRes.error) toast.error('Could not load PL-Output: ' + linesRes.error.message);
    const loaded = (linesRes.data || []) as Line[];
    setRows(loaded.map(toEditRow));
    setDirty(new Set());
    setAuditedTurnover(turnoverRes.data?.aggregate_turnover ?? null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = (part: Part) => {
    const row = emptyRow(part);
    setRows((prev) => [...prev, row]);
    setDirty((prev) => new Set(prev).add(row.key));
  };

  const updateRow = (key: string, patch: Partial<EditRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty((prev) => new Set(prev).add(key));
  };

  const reportPasteResult = (result: PasteImportResult) => {
    if (result.skipped > 0) {
      const preview = result.warnings.slice(0, 3).join(' ');
      toast.error(`Imported ${result.imported} row${result.imported === 1 ? '' : 's'}. ${result.skipped} skipped — see below: ${preview}`, { duration: 10000 });
    } else {
      toast.success(`Imported ${result.imported} row${result.imported === 1 ? '' : 's'}.`);
    }
    return result;
  };

  const handleImportA = (rows: string[][]): PasteImportResult => {
    const warnings: string[] = [];
    const newRows: EditRow[] = [];
    rows.forEach((cells, i) => {
      const rowNum = i + 1;
      if (cells.every((c) => !c || !c.trim())) { warnings.push(`Row ${rowNum}: empty row, skipped.`); return; }
      const [ledgerHead, rate, taxableValue, igst, cgst, sgst] = cells;
      const ledger = (ledgerHead || '').trim();
      if (!ledger) { warnings.push(`Row ${rowNum}: missing Ledger Head, skipped.`); return; }
      const row = emptyRow('A');
      row.ledger_head = ledger;
      row.rate = (rate || '').trim();
      row.taxable_value = String(parsePastedNum(taxableValue));
      row.igst = String(parsePastedNum(igst));
      row.cgst = String(parsePastedNum(cgst));
      row.sgst = String(parsePastedNum(sgst));
      newRows.push(row);
    });
    if (newRows.length > 0) {
      setRows((prev) => [...prev, ...newRows]);
      setDirty((prev) => { const next = new Set(prev); newRows.forEach((r) => next.add(r.key)); return next; });
    }
    return reportPasteResult({ imported: newRows.length, skipped: warnings.length, warnings });
  };

  const handleImportB = (rows: string[][]): PasteImportResult => {
    const warnings: string[] = [];
    const newRows: EditRow[] = [];
    rows.forEach((cells, i) => {
      const rowNum = i + 1;
      if (cells.every((c) => !c || !c.trim())) { warnings.push(`Row ${rowNum}: empty row, skipped.`); return; }
      const [ledgerHead, bifurcation, taxableValue] = cells;
      const ledger = (ledgerHead || '').trim();
      if (!ledger) { warnings.push(`Row ${rowNum}: missing Ledger Head, skipped.`); return; }
      const rawBif = (bifurcation || '').trim();
      const bifKey = BIFURCATIONS.find(
        (b) => b.toLowerCase() === rawBif.toLowerCase() || BIFURCATION_LABEL[b].toLowerCase() === rawBif.toLowerCase(),
      );
      if (!bifKey) { warnings.push(`Row ${rowNum}: unrecognized Bifurcation "${rawBif}", skipped.`); return; }
      const row = emptyRow('B');
      row.ledger_head = ledger;
      row.bifurcation = bifKey;
      row.taxable_value = String(parsePastedNum(taxableValue));
      newRows.push(row);
    });
    if (newRows.length > 0) {
      setRows((prev) => [...prev, ...newRows]);
      setDirty((prev) => { const next = new Set(prev); newRows.forEach((r) => next.add(r.key)); return next; });
    }
    return reportPasteResult({ imported: newRows.length, skipped: warnings.length, warnings });
  };

  const saveAll = async () => {
    const dirtyRows = rows.filter((r) => dirty.has(r.key));
    if (dirtyRows.length === 0) return;
    for (const r of dirtyRows) {
      if (!r.ledger_head.trim()) { toast.error(`Ledger head is required for a Part ${r.part} line.`); return; }
      if (r.part === 'B' && !r.bifurcation) { toast.error(`Pick a bifurcation for "${r.ledger_head.trim()}".`); return; }
    }
    setSaving(true);
    try {
      const toPayload = (r: EditRow) => ({
        client_id: clientId, financial_year: financialYear, part: r.part,
        ledger_head: r.ledger_head.trim(), bifurcation: r.part === 'B' ? r.bifurcation : null,
        rate: r.rate.trim() || null, taxable_value: num(r.taxable_value),
        igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst),
        updated_at: new Date().toISOString(),
      });
      const newRows = dirtyRows.filter((r) => !r.id);
      const existingRows = dirtyRows.filter((r) => r.id);
      if (newRows.length > 0) {
        const { error } = await supabase.from('pl_output_lines').insert(newRows.map(toPayload));
        if (error) { toast.error('Save failed for new lines: ' + error.message); return; }
      }
      if (existingRows.length > 0) {
        const { error } = await supabase.from('pl_output_lines')
          .upsert(existingRows.map((r) => ({ ...toPayload(r), id: r.id })), { onConflict: 'id' });
        if (error) { toast.error('Save failed for existing lines: ' + error.message); return; }
      }
      toast.success(`${dirtyRows.length} PL-Output line${dirtyRows.length === 1 ? '' : 's'} saved.`);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: EditRow) => {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setDirty((prev) => { const next = new Set(prev); next.delete(row.key); return next; });
      return;
    }
    const { error } = await supabase.from('pl_output_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totals = (part: Part) => rows.filter((r) => r.part === part).reduce(
    (acc, r) => ({ taxable: acc.taxable + num(r.taxable_value), igst: acc.igst + num(r.igst), cgst: acc.cgst + num(r.cgst), sgst: acc.sgst + num(r.sgst) }),
    { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
  );
  const totalA = totals('A');
  const totalB = totals('B');
  const grandTaxable = totalA.taxable + totalB.taxable;
  const diff = auditedTurnover != null ? grandTaxable - auditedTurnover : null;

  const renderTable = (part: Part) => {
    const partRows = rows.filter((r) => r.part === part);
    const t = part === 'A' ? totalA : totalB;
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ledger Head</TableHead>
            {part === 'B' && <TableHead>Bifurcation</TableHead>}
            {part === 'A' && <TableHead className="w-20">Rate</TableHead>}
            <TableHead className="text-right">Taxable Value</TableHead>
            {part === 'A' && <><TableHead className="text-right">IGST</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead></>}
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {partRows.length === 0 && (
            <TableRow><TableCell colSpan={part === 'A' ? 6 : 4} className="text-center text-sm text-muted-foreground py-6">No Part {part} lines yet.</TableCell></TableRow>
          )}
          {partRows.map((row) => (
            <TableRow key={row.key}>
              <TableCell><Input value={row.ledger_head} onChange={(e) => updateRow(row.key, { ledger_head: e.target.value })} placeholder="e.g. GST Sales 18%" aria-label="Ledger head" /></TableCell>
              {part === 'B' && (
                <TableCell>
                  <Select value={row.bifurcation || undefined} onValueChange={(v) => updateRow(row.key, { bifurcation: v })}>
                    <SelectTrigger className="w-40" aria-label="Bifurcation"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{BIFURCATIONS.map((b) => <SelectItem key={b} value={b}>{BIFURCATION_LABEL[b]}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              )}
              {part === 'A' && <TableCell><Input list="pl-output-rate-suggestions" value={row.rate} onChange={(e) => updateRow(row.key, { rate: e.target.value })} placeholder="18%" className="w-20" aria-label="Rate" /></TableCell>}
              <TableCell><Input type="number" value={row.taxable_value} onChange={(e) => updateRow(row.key, { taxable_value: e.target.value })} placeholder="0" className="text-right" aria-label="Taxable value" /></TableCell>
              {part === 'A' && <>
                <TableCell><Input type="number" value={row.igst} onChange={(e) => updateRow(row.key, { igst: e.target.value })} placeholder="0" className="text-right" aria-label="IGST" /></TableCell>
                <TableCell><Input type="number" value={row.cgst} onChange={(e) => updateRow(row.key, { cgst: e.target.value })} placeholder="0" className="text-right" aria-label="CGST" /></TableCell>
                <TableCell><Input type="number" value={row.sgst} onChange={(e) => updateRow(row.key, { sgst: e.target.value })} placeholder="0" className="text-right" aria-label="SGST" /></TableCell>
              </>}
              <TableCell>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label={`Delete ${row.ledger_head || 'line'}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {partRows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={part === 'A' ? 2 : 2}>Total Part {part}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(t.taxable)}</TableCell>
              {part === 'A' && <>
                <TableCell className="text-right tabular-nums">{fmt(t.igst)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(t.cgst)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(t.sgst)}</TableCell>
              </>}
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg">PL-OUTPUT</CardTitle>
            <CardDescription>Books sales, annual, by ledger head — Part A (taxable) and Part B (non-taxable). No month here; see Duties &amp; Taxes for the monthly entry.</CardDescription>
          </div>
          {!loading && (
            <Button size="sm" onClick={saveAll} disabled={saving || dirty.size === 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save changes{dirty.size > 0 ? ` (${dirty.size})` : ''}
            </Button>
          )}
        </div>
      </CardHeader>
      {loading ? (
        <CardContent className="flex justify-center py-10">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        </CardContent>
      ) : (
      <CardContent className="space-y-6">
        <datalist id="pl-output-rate-suggestions">{GST_RATE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Part A — Taxable income</h4>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPasteOpenA(true)}><ClipboardPaste className="h-3.5 w-3.5 mr-1.5" /> Paste from Excel</Button>
              <Button variant="outline" size="sm" onClick={() => addRow('A')}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>
            </div>
          </div>
          {renderTable('A')}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Part B — Non-taxable income</h4>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPasteOpenB(true)}><ClipboardPaste className="h-3.5 w-3.5 mr-1.5" /> Paste from Excel</Button>
              <Button variant="outline" size="sm" onClick={() => addRow('B')}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>
            </div>
          </div>
          {renderTable('B')}
        </div>
        <div className="rounded-md border px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="text-muted-foreground">Total A + B: <span className="font-medium text-foreground tabular-nums">{fmt(grandTaxable)}</span></span>
          <span className="text-muted-foreground">As per audited financials: <span className="font-medium text-foreground tabular-nums">{auditedTurnover != null ? fmt(auditedTurnover) : '— not entered on Client Turnover'}</span></span>
          {diff != null && (
            <Badge variant={Math.abs(diff) <= 10 ? 'success' : 'destructive'}>Diff {fmt(diff)}</Badge>
          )}
        </div>
      </CardContent>
      )}
      <PasteFromExcelDialog
        open={pasteOpenA}
        onOpenChange={setPasteOpenA}
        title="Paste Part A from Excel"
        columnLabels={['Ledger Head', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST']}
        onImport={handleImportA}
      />
      <PasteFromExcelDialog
        open={pasteOpenB}
        onOpenChange={setPasteOpenB}
        title="Paste Part B from Excel"
        columnLabels={['Ledger Head', 'Bifurcation', 'Taxable Value']}
        onImport={handleImportB}
      />
    </Card>
  );
};

export default PLOutputCard;
