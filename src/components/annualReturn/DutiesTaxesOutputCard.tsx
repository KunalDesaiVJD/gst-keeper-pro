import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ChevronDown, ChevronRight, Save, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';
import { PasteFromExcelDialog, PasteImportResult } from '@/components/annualReturn/PasteFromExcelDialog';

const TOLERANCE = 10;

const NUMERIC_KEYS = [
  'sales_igst', 'sales_cgst', 'sales_sgst',
  'credit_note_igst', 'credit_note_cgst', 'credit_note_sgst',
  'as_per_3b_igst', 'as_per_3b_cgst', 'as_per_3b_sgst',
  'other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst',
] as const;
type NumericKey = typeof NUMERIC_KEYS[number];

interface MonthRow {
  month: string;
  sales_igst: number; sales_cgst: number; sales_sgst: number;
  credit_note_igst: number; credit_note_cgst: number; credit_note_sgst: number;
  as_per_3b_igst: number; as_per_3b_cgst: number; as_per_3b_sgst: number;
  other_adjustment_igst: number; other_adjustment_cgst: number; other_adjustment_sgst: number;
  other_adjustment_reason: string;
  hasEntry: boolean;
}

const emptyMonth = (month: string): MonthRow => ({
  month, sales_igst: 0, sales_cgst: 0, sales_sgst: 0, credit_note_igst: 0, credit_note_cgst: 0, credit_note_sgst: 0,
  as_per_3b_igst: 0, as_per_3b_cgst: 0, as_per_3b_sgst: 0, other_adjustment_igst: 0, other_adjustment_cgst: 0, other_adjustment_sgst: 0,
  other_adjustment_reason: '', hasEntry: false,
});

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));
const netSales = (r: MonthRow) => (r.sales_igst + r.sales_cgst + r.sales_sgst) - (r.credit_note_igst + r.credit_note_cgst + r.credit_note_sgst);
const as3b = (r: MonthRow) => r.as_per_3b_igst + r.as_per_3b_cgst + r.as_per_3b_sgst;

interface Props { clientId: string; financialYear: string; onSaved?: () => void; }

const FIELD_GROUPS: { title: string; keys: NumericKey[] }[] = [
  { title: 'Sales', keys: ['sales_igst', 'sales_cgst', 'sales_sgst'] },
  { title: 'Credit Note', keys: ['credit_note_igst', 'credit_note_cgst', 'credit_note_sgst'] },
  { title: 'As per 3B', keys: ['as_per_3b_igst', 'as_per_3b_cgst', 'as_per_3b_sgst'] },
  { title: 'Other adjustments (Cr side)', keys: ['other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst'] },
];
const FIELD_LABEL: Record<NumericKey, string> = {
  sales_igst: 'IGST', sales_cgst: 'CGST', sales_sgst: 'SGST',
  credit_note_igst: 'IGST', credit_note_cgst: 'CGST', credit_note_sgst: 'SGST',
  as_per_3b_igst: 'IGST', as_per_3b_cgst: 'CGST', as_per_3b_sgst: 'SGST',
  other_adjustment_igst: 'IGST', other_adjustment_cgst: 'CGST', other_adjustment_sgst: 'SGST',
};

/**
 * DUTIES & TAXES-OUTPUT — month-wise, entered separately from PL-Output
 * (firm decision, 27 Aug 2026) and cross-checked against it rather than
 * derived from it.
 *
 * Rewritten (26 Aug 2026 UX audit) from a per-month edit dialog to an
 * always-editable grid, matching PortalCaptureCard — every month's row can
 * be expanded in place (no modal) and several months can be open and
 * edited at once, all committed with one batch save.
 */
export const DutiesTaxesOutputCard: React.FC<Props> = ({ clientId, financialYear, onSaved }) => {
  const months = monthsForFY(financialYear);
  const [data, setData] = useState<Record<string, MonthRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirtyMonths, setDirtyMonths] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setData({}); setLoading(false); return; }
    setLoading(true);
    const { data: rows, error } = await supabase.from('duties_taxes_output_monthly').select('*').eq('client_id', clientId).eq('financial_year', financialYear).in('month', months);
    if (error) { toast.error('Could not load Duties & Taxes-Output: ' + error.message); setLoading(false); return; }
    const next: Record<string, MonthRow> = {};
    months.forEach((m) => { next[m] = emptyMonth(m); });
    (rows || []).forEach((r: Record<string, unknown>) => {
      next[r.month as string] = {
        month: r.month as string,
        sales_igst: Number(r.sales_igst), sales_cgst: Number(r.sales_cgst), sales_sgst: Number(r.sales_sgst),
        credit_note_igst: Number(r.credit_note_igst), credit_note_cgst: Number(r.credit_note_cgst), credit_note_sgst: Number(r.credit_note_sgst),
        as_per_3b_igst: Number(r.as_per_3b_igst), as_per_3b_cgst: Number(r.as_per_3b_cgst), as_per_3b_sgst: Number(r.as_per_3b_sgst),
        other_adjustment_igst: Number(r.other_adjustment_igst), other_adjustment_cgst: Number(r.other_adjustment_cgst), other_adjustment_sgst: Number(r.other_adjustment_sgst),
        other_adjustment_reason: (r.other_adjustment_reason as string) || '', hasEntry: true,
      };
    });
    setData(next);
    setDirtyMonths(new Set());
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = (month: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  };

  const updateField = (month: string, key: NumericKey, value: string) => {
    setData((prev) => ({ ...prev, [month]: { ...prev[month], [key]: num(value) } }));
    setDirtyMonths((prev) => new Set(prev).add(month));
  };

  const updateReason = (month: string, value: string) => {
    setData((prev) => ({ ...prev, [month]: { ...prev[month], other_adjustment_reason: value } }));
    setDirtyMonths((prev) => new Set(prev).add(month));
  };

  const saveAll = async () => {
    if (dirtyMonths.size === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const upserts = Array.from(dirtyMonths).map((month) => {
        const row = data[month];
        const { hasEntry, ...payload } = row;
        return { client_id: clientId, financial_year: financialYear, ...payload, updated_at: now };
      });
      const { error } = await supabase.from('duties_taxes_output_monthly').upsert(upserts, { onConflict: 'client_id,financial_year,month' });
      if (error) throw error;
      toast.success(`${dirtyMonths.size} month${dirtyMonths.size === 1 ? '' : 's'} saved.`);
      await load();
      onSaved?.();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const parseAmount = (cell: string | undefined): number => {
    if (!cell) return 0;
    const cleaned = cell.replace(/[₹$,\s]/g, '').trim();
    if (cleaned === '') return 0;
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  };

  const handlePasteImport = (rows: string[][]): PasteImportResult => {
    let imported = 0;
    const warnings: string[] = [];
    rows.forEach((row, i) => {
      const rowNum = i + 1;
      if (row.every((c) => !c || c.trim() === '')) {
        warnings.push(`Row ${rowNum}: empty row skipped.`);
        return;
      }
      const monthCell = (row[0] || '').trim();
      const matchedMonth = months.find((m) => m.toLowerCase() === monthCell.toLowerCase());
      if (!matchedMonth) {
        warnings.push(`Row ${rowNum}: "${monthCell}" is not a recognized month — skipped.`);
        return;
      }
      updateField(matchedMonth, 'sales_igst', String(parseAmount(row[1])));
      updateField(matchedMonth, 'sales_cgst', String(parseAmount(row[2])));
      updateField(matchedMonth, 'sales_sgst', String(parseAmount(row[3])));
      updateField(matchedMonth, 'credit_note_igst', String(parseAmount(row[4])));
      updateField(matchedMonth, 'credit_note_cgst', String(parseAmount(row[5])));
      updateField(matchedMonth, 'credit_note_sgst', String(parseAmount(row[6])));
      updateField(matchedMonth, 'as_per_3b_igst', String(parseAmount(row[7])));
      updateField(matchedMonth, 'as_per_3b_cgst', String(parseAmount(row[8])));
      updateField(matchedMonth, 'as_per_3b_sgst', String(parseAmount(row[9])));
      updateField(matchedMonth, 'other_adjustment_igst', String(parseAmount(row[10])));
      updateField(matchedMonth, 'other_adjustment_cgst', String(parseAmount(row[11])));
      updateField(matchedMonth, 'other_adjustment_sgst', String(parseAmount(row[12])));
      if (row[13] && row[13].trim() !== '') updateReason(matchedMonth, row[13].trim());
      imported += 1;
    });

    const skipped = warnings.length;
    if (skipped > 0) {
      const preview = warnings.slice(0, 3).join(' ');
      toast.error(`Imported ${imported} row${imported === 1 ? '' : 's'}. ${skipped} skipped — see below: ${preview}`, { duration: 10000 });
    } else {
      toast.success(`Imported ${imported} row${imported === 1 ? '' : 's'}.`);
    }
    return { imported, skipped, warnings };
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">DUTIES &amp; TAXES-OUTPUT</CardTitle>
          <CardDescription>Month-wise sales vs. as-filed GSTR-3B — separate entry from PL-Output, cross-checked against it. Click a month to expand and edit. Several months can be open at once.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
            Paste from Excel
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || dirtyMonths.size === 0}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save changes{dirtyMonths.size > 0 ? ` (${dirtyMonths.size})` : ''}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Net Sales</TableHead>
              <TableHead className="text-right">As per 3B</TableHead>
              <TableHead className="text-right">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => {
              const r = data[m] || emptyMonth(m);
              const net = netSales(r);
              const asFiled = as3b(r);
              const diff = net - asFiled;
              const matched = Math.abs(diff) <= TOLERANCE;
              const isOpen = expanded.has(m);
              return (
                <React.Fragment key={m}>
                  <TableRow className={dirtyMonths.has(m) ? 'bg-warning/5' : undefined}>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleExpanded(m)} aria-label={isOpen ? `Collapse ${m}` : `Expand ${m}`}>
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{m}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(asFiled)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${r.hasEntry ? (matched ? 'text-success' : 'text-destructive') : 'text-muted-foreground'}`}>{r.hasEntry ? fmt(diff) : '—'}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/30 p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {FIELD_GROUPS.map((group) => (
                            <div key={group.title} className="space-y-1.5">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</div>
                              {group.keys.map((key) => (
                                <div key={key} className="flex items-center justify-between gap-3">
                                  <span className="text-sm text-muted-foreground">{FIELD_LABEL[key]}</span>
                                  <Input
                                    type="number" className="w-32 text-right h-8" disabled={saving}
                                    value={String(r[key])}
                                    onChange={(e) => updateField(m, key, e.target.value)}
                                    aria-label={`${m} ${group.title} ${FIELD_LABEL[key]}`}
                                  />
                                </div>
                              ))}
                              {group.title === 'Other adjustments (Cr side)' && (
                                <Textarea
                                  className="mt-1"
                                  placeholder="Reason for adjustment"
                                  disabled={saving}
                                  value={r.other_adjustment_reason}
                                  onChange={(e) => updateReason(m, e.target.value)}
                                  aria-label={`${m} Other adjustments (Cr side) reason`}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between pt-3 mt-3 border-t text-sm">
                          <span>Diff (Net Sales − As per 3B)</span>
                          <Badge variant={matched ? 'success' : 'destructive'}>{fmt(diff)}</Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <PasteFromExcelDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Paste Duties & Taxes-Output from Excel"
        columnLabels={[
          'Month', 'Sales IGST', 'Sales CGST', 'Sales SGST',
          'Credit Note IGST', 'Credit Note CGST', 'Credit Note SGST',
          'As per 3B IGST', 'As per 3B CGST', 'As per 3B SGST',
          'Other Adjustment IGST', 'Other Adjustment CGST', 'Other Adjustment SGST',
          'Other Adjustment Reason',
        ]}
        onImport={handlePasteImport}
      />
    </Card>
  );
};

export default DutiesTaxesOutputCard;
