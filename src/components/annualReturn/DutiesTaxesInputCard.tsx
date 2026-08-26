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
const LAST_YEAR_EFFECT = 'Last Year Effect';

const NUMERIC_KEYS = [
  'purchase_igst', 'purchase_cgst', 'purchase_sgst',
  'debit_note_igst', 'debit_note_cgst', 'debit_note_sgst',
  'suspended_reversed_igst', 'suspended_reversed_cgst', 'suspended_reversed_sgst',
  'suspended_reversed_180d_igst', 'suspended_reversed_180d_cgst', 'suspended_reversed_180d_sgst',
  'suspended_reclaim_igst', 'suspended_reclaim_cgst', 'suspended_reclaim_sgst',
  'suspended_reclaim_180d_igst', 'suspended_reclaim_180d_cgst', 'suspended_reclaim_180d_sgst',
  'other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst',
] as const;
type NumericKey = typeof NUMERIC_KEYS[number];

interface MonthRow {
  month: string;
  other_adjustment_reason: string;
  hasEntry: boolean;
}
type FullMonthRow = MonthRow & Record<NumericKey, number>;

interface Portal3b { igst: number; cgst: number; sgst: number; }
const zeroPortal3b: Portal3b = { igst: 0, cgst: 0, sgst: 0 };

const emptyMonth = (month: string): FullMonthRow => {
  const base = { month, other_adjustment_reason: '', hasEntry: false } as FullMonthRow;
  NUMERIC_KEYS.forEach((k) => { base[k] = 0; });
  return base;
};

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));
const netPurchase = (r: FullMonthRow) =>
  (r.purchase_igst + r.purchase_cgst + r.purchase_sgst)
  - (r.debit_note_igst + r.debit_note_cgst + r.debit_note_sgst)
  - (r.suspended_reversed_igst + r.suspended_reversed_cgst + r.suspended_reversed_sgst)
  - (r.suspended_reversed_180d_igst + r.suspended_reversed_180d_cgst + r.suspended_reversed_180d_sgst)
  + (r.suspended_reclaim_igst + r.suspended_reclaim_cgst + r.suspended_reclaim_sgst)
  + (r.suspended_reclaim_180d_igst + r.suspended_reclaim_180d_cgst + r.suspended_reclaim_180d_sgst);
const as3bTotal = (p: Portal3b) => p.igst + p.cgst + p.sgst;

const FIELD_GROUPS: { title: string; keys: NumericKey[] }[] = [
  { title: 'Purchase', keys: ['purchase_igst', 'purchase_cgst', 'purchase_sgst'] },
  { title: 'Debit Note', keys: ['debit_note_igst', 'debit_note_cgst', 'debit_note_sgst'] },
  { title: 'Suspended ITC (Reversed)', keys: ['suspended_reversed_igst', 'suspended_reversed_cgst', 'suspended_reversed_sgst'] },
  { title: 'Suspended ITC (Reversed) — 180 days', keys: ['suspended_reversed_180d_igst', 'suspended_reversed_180d_cgst', 'suspended_reversed_180d_sgst'] },
  { title: 'Suspended ITC (Reclaim)', keys: ['suspended_reclaim_igst', 'suspended_reclaim_cgst', 'suspended_reclaim_sgst'] },
  { title: 'Suspended ITC (Reclaim) — 180 days', keys: ['suspended_reclaim_180d_igst', 'suspended_reclaim_180d_cgst', 'suspended_reclaim_180d_sgst'] },
];
const OTHER_ADJUSTMENT_KEYS = ['other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst'] as const;
const TAX_LABEL: Record<string, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST' };

interface Props { clientId: string; financialYear: string; onSaved?: () => void; }

/**
 * DUTIES & TAXES-INPUT — month-wise, entered separately from PL-Input.
 * Reversal/reclaim/180-day columns are running totals, not linked to a
 * specific original transaction (firm decision, 27 Aug 2026 — matches the
 * sheet). Includes the sheet's "Last Year Effect" pseudo-month row.
 *
 * Rewritten (26 Aug 2026 UX audit) from a per-month edit dialog to an
 * always-editable grid, matching PortalCaptureCard's pattern — every month's
 * row (including the synthetic Last Year Effect row) can be expanded in
 * place with no modal, several months can be open and edited at once, and
 * every dirty month is committed in one batch upsert.
 *
 * "As per 3B" (27 Aug 2026 UX audit) is no longer a manually-retyped field
 * here — it's the same GSTR-3B ITC-claimed figure already captured once on
 * Portal Capture, read live from gst_filed_returns and shown read-only.
 * Confirmed genuine duplication (nothing besides this card's own diff ever
 * read the old as_per_3b_* columns — Gstr9InputView's own "As per 3B" row
 * already sources from Portal Capture directly, not from here).
 */
export const DutiesTaxesInputCard: React.FC<Props> = ({ clientId, financialYear, onSaved }) => {
  const months = [LAST_YEAR_EFFECT, ...monthsForFY(financialYear)];
  const [data, setData] = useState<Record<string, FullMonthRow>>({});
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
      supabase.from('duties_taxes_input_monthly').select('*').eq('client_id', clientId).eq('financial_year', financialYear).in('month', months),
      supabase.from('gst_filed_returns').select('period_month, summary').eq('client_id', clientId).eq('return_type', 'GSTR-3B').in('period_month', months),
    ]);
    if (rowsRes.error) { toast.error('Could not load Duties & Taxes-Input: ' + rowsRes.error.message); setLoading(false); return; }
    const next: Record<string, FullMonthRow> = {};
    months.forEach((m) => { next[m] = emptyMonth(m); });
    (rowsRes.data || []).forEach((r: Record<string, unknown>) => {
      const row = emptyMonth(r.month as string);
      NUMERIC_KEYS.forEach((k) => { row[k] = Number(r[k]) || 0; });
      row.other_adjustment_reason = (r.other_adjustment_reason as string) || '';
      row.hasEntry = true;
      next[r.month as string] = row;
    });
    setData(next);
    if (portalRes.error) {
      toast.error('Could not load "As per 3B" from Portal Capture: ' + portalRes.error.message);
    } else {
      const p3b: Record<string, Portal3b> = {};
      (portalRes.data || []).forEach((r: { period_month: string; summary: Record<string, number> | null }) => {
        const s = r.summary || {};
        p3b[r.period_month] = { igst: Number(s.itc_igst) || 0, cgst: Number(s.itc_cgst) || 0, sgst: Number(s.itc_sgst) || 0 };
      });
      // "Last Year Effect" is a books-only adjustment row — the portal has no month for it, always zero.
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
      const { error } = await supabase.from('duties_taxes_input_monthly').upsert(upserts, { onConflict: 'client_id,financial_year,month' });
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
      NUMERIC_KEYS.forEach((key, idx) => {
        updateField(matchedMonth, key, String(parseAmount(row[idx + 1])));
      });
      const reasonIdx = NUMERIC_KEYS.length + 1;
      if (row[reasonIdx] && row[reasonIdx].trim() !== '') updateReason(matchedMonth, row[reasonIdx].trim());
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
          <CardTitle className="text-lg">DUTIES &amp; TAXES-INPUT</CardTitle>
          <CardDescription>Month-wise purchases, debit notes and suspended-ITC reversal/reclaim vs. as-filed GSTR-3B — click a month to expand and edit. Several months can be open at once.</CardDescription>
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
              <TableHead className="text-right">Net Purchase</TableHead>
              <TableHead className="text-right">As per 3B</TableHead>
              <TableHead className="text-right">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => {
              const r = data[m] || emptyMonth(m);
              const p3b = portal3b[m] || zeroPortal3b;
              const net = netPurchase(r);
              const asFiled = as3bTotal(p3b);
              const diff = net - asFiled;
              const matched = Math.abs(diff) <= TOLERANCE;
              const isOpen = expanded.has(m);
              const isAdjustmentRow = m === LAST_YEAR_EFFECT;
              return (
                <React.Fragment key={m}>
                  <TableRow className={dirtyMonths.has(m) ? 'bg-warning/5' : undefined}>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleExpanded(m)} aria-label={isOpen ? `Collapse ${m}` : `Expand ${m}`}>
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                    <TableCell className={`font-medium ${isAdjustmentRow ? 'italic text-muted-foreground' : ''}`}>
                      {m}
                      {isAdjustmentRow && <Badge variant="outline" className="ml-2 align-middle text-[10px] border-dashed text-muted-foreground">adjustment</Badge>}
                    </TableCell>
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
                                  <span className="text-sm text-muted-foreground">{TAX_LABEL[key.split('_').pop() as string]}</span>
                                  <Input
                                    type="number" className="w-32 text-right h-8" disabled={saving}
                                    value={String(r[key])}
                                    onChange={(e) => updateField(m, key, e.target.value)}
                                    aria-label={`${m} ${group.title} ${TAX_LABEL[key.split('_').pop() as string]}`}
                                  />
                                </div>
                              ))}
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
                            <p className="text-xs text-muted-foreground pt-1">{isAdjustmentRow ? 'No portal period for this row.' : 'From Portal Capture — not editable here.'}</p>
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other adjustments (Dr side)</div>
                            {OTHER_ADJUSTMENT_KEYS.map((key) => (
                              <div key={key} className="flex items-center justify-between gap-3">
                                <span className="text-sm text-muted-foreground">{TAX_LABEL[key.split('_').pop() as string]}</span>
                                <Input
                                  type="number" className="w-32 text-right h-8" disabled={saving}
                                  value={String(r[key])}
                                  onChange={(e) => updateField(m, key, e.target.value)}
                                  aria-label={`${m} Other adjustments (Dr side) ${TAX_LABEL[key.split('_').pop() as string]}`}
                                />
                              </div>
                            ))}
                            <Textarea
                              placeholder="Reason for adjustment" disabled={saving}
                              value={r.other_adjustment_reason}
                              onChange={(e) => updateReason(m, e.target.value)}
                              aria-label={`${m} Other adjustments (Dr side) reason`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-3 mt-3 border-t text-sm">
                          <span>Diff</span>
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
        title="Paste Duties & Taxes-Input from Excel"
        columnLabels={[
          'Month',
          'Purchase IGST', 'Purchase CGST', 'Purchase SGST',
          'Debit Note IGST', 'Debit Note CGST', 'Debit Note SGST',
          'Suspended Reversed IGST', 'Suspended Reversed CGST', 'Suspended Reversed SGST',
          'Suspended Reversed 180d IGST', 'Suspended Reversed 180d CGST', 'Suspended Reversed 180d SGST',
          'Suspended Reclaim IGST', 'Suspended Reclaim CGST', 'Suspended Reclaim SGST',
          'Suspended Reclaim 180d IGST', 'Suspended Reclaim 180d CGST', 'Suspended Reclaim 180d SGST',
          'Other Adjustment IGST', 'Other Adjustment CGST', 'Other Adjustment SGST',
          'Other Adjustment Reason',
        ]}
        onImport={handlePasteImport}
      />
    </Card>
  );
};

export default DutiesTaxesInputCard;
