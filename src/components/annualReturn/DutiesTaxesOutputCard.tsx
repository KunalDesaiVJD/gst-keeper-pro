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
  'other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst',
] as const;
type NumericKey = typeof NUMERIC_KEYS[number];

interface MonthRow {
  month: string;
  sales_igst: number; sales_cgst: number; sales_sgst: number;
  credit_note_igst: number; credit_note_cgst: number; credit_note_sgst: number;
  other_adjustment_igst: number; other_adjustment_cgst: number; other_adjustment_sgst: number;
  other_adjustment_reason: string;
  hasEntry: boolean;
}

interface Portal3b { igst: number; cgst: number; sgst: number; }
const zeroPortal3b: Portal3b = { igst: 0, cgst: 0, sgst: 0 };

const emptyMonth = (month: string): MonthRow => ({
  month, sales_igst: 0, sales_cgst: 0, sales_sgst: 0, credit_note_igst: 0, credit_note_cgst: 0, credit_note_sgst: 0,
  other_adjustment_igst: 0, other_adjustment_cgst: 0, other_adjustment_sgst: 0,
  other_adjustment_reason: '', hasEntry: false,
});

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));
const netSales = (r: MonthRow) => (r.sales_igst + r.sales_cgst + r.sales_sgst) - (r.credit_note_igst + r.credit_note_cgst + r.credit_note_sgst);
const as3bTotal = (p: Portal3b) => p.igst + p.cgst + p.sgst;

interface Props { clientId: string; financialYear: string; onSaved?: () => void; }

const FIELD_GROUPS: { title: string; keys: NumericKey[] }[] = [
  { title: 'Sales', keys: ['sales_igst', 'sales_cgst', 'sales_sgst'] },
  { title: 'Credit Note', keys: ['credit_note_igst', 'credit_note_cgst', 'credit_note_sgst'] },
  { title: 'Other adjustments (Cr side)', keys: ['other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst'] },
];
const FIELD_LABEL: Record<NumericKey, string> = {
  sales_igst: 'IGST', sales_cgst: 'CGST', sales_sgst: 'SGST',
  credit_note_igst: 'IGST', credit_note_cgst: 'CGST', credit_note_sgst: 'SGST',
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
 *
 * "As per 3B" (27 Aug 2026 UX audit) is no longer a manually-retyped field
 * here — it's the same GSTR-3B outward-tax figure already captured once on
 * Portal Capture, read live from gst_filed_returns and shown read-only.
 * Retyping it was confirmed genuine duplication (nothing besides this
 * card's own diff ever read the old as_per_3b_* columns), unlike the
 * books-vs-portal duplication elsewhere in this module, which is
 * intentional. Read-only means it can't be dirty/saved from here.
 */
export const DutiesTaxesOutputCard: React.FC<Props> = ({ clientId, financialYear, onSaved }) => {
  const months = monthsForFY(financialYear);
  const [data, setData] = useState<Record<string, MonthRow>>({});
  const [portal3b, setPortal3b] = useState<Record<string, Portal3b>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirtyMonths, setDirtyMonths] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setData({}); setPortal3b({}); setLoading(false); return; }
    setLoading(true);
    const [rowsRes, portalRes] = await Promise.all([
      supabase.from('duties_taxes_output_monthly').select('*').eq('client_id', clientId).eq('financial_year', financialYear).in('month', months),
      supabase.from('gst_filed_returns').select('period_month, summary').eq('client_id', clientId).eq('return_type', 'GSTR-3B').in('period_month', months),
    ]);
    if (rowsRes.error) { toast.error('Could not load Duties & Taxes-Output: ' + rowsRes.error.message); setLoading(false); return; }
    const next: Record<string, MonthRow> = {};
    months.forEach((m) => { next[m] = emptyMonth(m); });
    (rowsRes.data || []).forEach((r: Record<string, unknown>) => {
      next[r.month as string] = {
        month: r.month as string,
        sales_igst: Number(r.sales_igst), sales_cgst: Number(r.sales_cgst), sales_sgst: Number(r.sales_sgst),
        credit_note_igst: Number(r.credit_note_igst), credit_note_cgst: Number(r.credit_note_cgst), credit_note_sgst: Number(r.credit_note_sgst),
        other_adjustment_igst: Number(r.other_adjustment_igst), other_adjustment_cgst: Number(r.other_adjustment_cgst), other_adjustment_sgst: Number(r.other_adjustment_sgst),
        other_adjustment_reason: (r.other_adjustment_reason as string) || '', hasEntry: true,
      };
    });
    setData(next);
    if (portalRes.error) {
      toast.error('Could not load "As per 3B" from Portal Capture: ' + portalRes.error.message);
    } else {
      const p3b: Record<string, Portal3b> = {};
      (portalRes.data || []).forEach((r: { period_month: string; summary: Record<string, number> | null }) => {
        const s = r.summary || {};
        p3b[r.period_month] = { igst: Number(s.outward_igst) || 0, cgst: Number(s.outward_cgst) || 0, sgst: Number(s.outward_sgst) || 0 };
      });
      setPortal3b(p3b);
    }
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
      updateField(matchedMonth, 'other_adjustment_igst', String(parseAmount(row[7])));
      updateField(matchedMonth, 'other_adjustment_cgst', String(parseAmount(row[8])));
      updateField(matchedMonth, 'other_adjustment_sgst', String(parseAmount(row[9])));
      if (row[10] && row[10].trim() !== '') updateReason(matchedMonth, row[10].trim());
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
              const p3b = portal3b[m] || zeroPortal3b;
              const net = netSales(r);
              const asFiled = as3bTotal(p3b);
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
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">As per 3B</span>
                              <Badge variant="outline" className="text-[10px]">Portal</Badge>
                            </div>
                            {(['igst', 'cgst', 'sgst'] as const).map((h) => (
                              <div key={h} className="flex items-center justify-between gap-3">
                                <span className="text-sm text-muted-foreground">{h.toUpperCase()}</span>
                                <span className="text-sm tabular-nums h-8 flex items-center px-1">{fmt(p3b[h])}</span>
                              </div>
                            ))}
                            <p className="text-xs text-muted-foreground pt-1">From Portal Capture — not editable here.</p>
                          </div>
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
          'Other Adjustment IGST', 'Other Adjustment CGST', 'Other Adjustment SGST',
          'Other Adjustment Reason',
        ]}
        onImport={handlePasteImport}
      />
    </Card>
  );
};

export default DutiesTaxesOutputCard;
