import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ChevronDown, ChevronRight, Save, CheckCircle2, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';
import { PasteFromExcelDialog, type PasteImportResult } from '@/components/annualReturn/PasteFromExcelDialog';

const NUMERIC_KEYS = [
  'turnover_taxable', 'turnover_igst', 'turnover_cgst', 'turnover_sgst',
  'outward_igst', 'outward_cgst', 'outward_sgst',
  'itc_igst', 'itc_cgst', 'itc_sgst',
  'itc2b_igst', 'itc2b_cgst', 'itc2b_sgst',
  'rcm_taxable', 'rcm_igst', 'rcm_cgst', 'rcm_sgst',
] as const;
type NumericKey = typeof NUMERIC_KEYS[number];
type MonthRow = { month: string; hasGstr1: boolean; hasGstr3b: boolean; hasGstr2b: boolean; hasRcm: boolean } & Record<NumericKey, number>;

const emptyMonth = (month: string): MonthRow => {
  const base = { month, hasGstr1: false, hasGstr3b: false, hasGstr2b: false, hasRcm: false } as MonthRow;
  NUMERIC_KEYS.forEach((k) => { base[k] = 0; });
  return base;
};

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));

type ReturnType = 'GSTR-1' | 'GSTR-3B' | 'GSTR-2B' | 'RCM';
const FIELD_GROUPS: { title: string; returnType: ReturnType; keys: NumericKey[] }[] = [
  { title: 'GSTR-1 turnover', returnType: 'GSTR-1', keys: ['turnover_taxable', 'turnover_igst', 'turnover_cgst', 'turnover_sgst'] },
  { title: 'GSTR-3B outward tax', returnType: 'GSTR-3B', keys: ['outward_igst', 'outward_cgst', 'outward_sgst'] },
  { title: 'GSTR-3B ITC claimed', returnType: 'GSTR-3B', keys: ['itc_igst', 'itc_cgst', 'itc_sgst'] },
  { title: 'GSTR-2B ITC available', returnType: 'GSTR-2B', keys: ['itc2b_igst', 'itc2b_cgst', 'itc2b_sgst'] },
  { title: 'RCM (Part A — as per portal)', returnType: 'RCM', keys: ['rcm_taxable', 'rcm_igst', 'rcm_cgst', 'rcm_sgst'] },
];
const FIELD_LABEL: Record<string, string> = { turnover_taxable: 'Taxable', turnover_igst: 'IGST', turnover_cgst: 'CGST', turnover_sgst: 'SGST', outward_igst: 'IGST', outward_cgst: 'CGST', outward_sgst: 'SGST', itc_igst: 'IGST', itc_cgst: 'CGST', itc_sgst: 'SGST', itc2b_igst: 'IGST', itc2b_cgst: 'CGST', itc2b_sgst: 'SGST', rcm_taxable: 'Taxable', rcm_igst: 'IGST', rcm_cgst: 'CGST', rcm_sgst: 'SGST' };

// Flattened in the same order as FIELD_GROUPS — this is the paste column order (after Month).
const PASTE_FIELDS: { key: NumericKey; returnType: ReturnType }[] = FIELD_GROUPS.flatMap((g) => g.keys.map((key) => ({ key, returnType: g.returnType })));
const PASTE_COLUMN_LABELS = [
  'Month', 'Turnover Taxable', 'Turnover IGST', 'Turnover CGST', 'Turnover SGST',
  'Outward IGST', 'Outward CGST', 'Outward SGST',
  'ITC IGST', 'ITC CGST', 'ITC SGST',
  'ITC2B IGST', 'ITC2B CGST', 'ITC2B SGST',
  'RCM Taxable', 'RCM IGST', 'RCM CGST', 'RCM SGST',
];

/** Strips currency symbols/commas/whitespace; blank cell -> '0'. Leaves the numeric parsing itself to updateField's own num(). */
const cleanPastedNumber = (raw: string): string => {
  const stripped = (raw ?? '').replace(/[^0-9.\-]/g, '');
  return stripped === '' ? '0' : stripped;
};

interface Props { clientId: string; financialYear: string; }

/**
 * Phase 2 (R3) — month-wise "as filed on the portal" figures, split by tax
 * head, RCM Part A included. Stored on gst_filed_returns as four return_type
 * rows per month. Table 6A/8A are the FY sum of the months here.
 *
 * Rewritten (25 Aug 2026 UX audit) from a per-month edit dialog to an
 * always-editable grid — every month's row can be expanded in place (no
 * modal) and several months can be open and edited at once, all committed
 * with one batch save. touchedGroups tracks, per month, which return-type
 * groups were actually edited since the last save — this is what makes
 * save() only write the return-types a user actually touched (or that
 * already had a saved row) rather than blindly overwriting all four every
 * time, which was the critical fix from the prior audit pass; that
 * behaviour is preserved here, just generalised across many months in one
 * save instead of one month per dialog session.
 */
export const PortalCaptureCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const months = monthsForFY(financialYear);
  const [data, setData] = useState<Record<string, MonthRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirtyMonths, setDirtyMonths] = useState<Set<string>>(new Set());
  const [touchedGroups, setTouchedGroups] = useState<Record<string, Set<ReturnType>>>({});
  const [pasteOpen, setPasteOpen] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setData({}); setLoading(false); return; }
    setLoading(true);
    const { data: rows, error } = await supabase.from('gst_filed_returns').select('period_month, return_type, summary').eq('client_id', clientId).in('period_month', months);
    if (error) { toast.error('Could not load portal figures: ' + error.message); setLoading(false); return; }
    const next: Record<string, MonthRow> = {};
    months.forEach((m) => { next[m] = emptyMonth(m); });
    (rows || []).forEach((r: { period_month: string; return_type: string; summary: Record<string, number> | null }) => {
      const bucket = next[r.period_month];
      if (!bucket) return;
      const s = r.summary || {};
      if (r.return_type === 'GSTR-1') {
        bucket.turnover_taxable = Number(s.turnover_taxable) || Number(s.turnover) || 0; // fallback for pre-R3 rows
        bucket.turnover_igst = Number(s.turnover_igst) || 0;
        bucket.turnover_cgst = Number(s.turnover_cgst) || 0;
        bucket.turnover_sgst = Number(s.turnover_sgst) || 0;
        bucket.hasGstr1 = true;
      } else if (r.return_type === 'GSTR-3B') {
        bucket.outward_igst = Number(s.outward_igst) || 0;
        bucket.outward_cgst = Number(s.outward_cgst) || 0;
        bucket.outward_sgst = Number(s.outward_sgst) || 0;
        bucket.itc_igst = Number(s.itc_igst) || 0;
        bucket.itc_cgst = Number(s.itc_cgst) || 0;
        bucket.itc_sgst = Number(s.itc_sgst) || 0;
        bucket.hasGstr3b = true;
      } else if (r.return_type === 'GSTR-2B') {
        bucket.itc2b_igst = Number(s.itc2b_igst) || Number(s.itc_available) || 0;
        bucket.itc2b_cgst = Number(s.itc2b_cgst) || 0;
        bucket.itc2b_sgst = Number(s.itc2b_sgst) || 0;
        bucket.hasGstr2b = true;
      } else if (r.return_type === 'RCM') {
        bucket.rcm_taxable = Number(s.rcm_taxable) || 0;
        bucket.rcm_igst = Number(s.rcm_igst) || 0;
        bucket.rcm_cgst = Number(s.rcm_cgst) || 0;
        bucket.rcm_sgst = Number(s.rcm_sgst) || 0;
        bucket.hasRcm = true;
      }
    });
    setData(next);
    setDirtyMonths(new Set());
    setTouchedGroups({});
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

  const updateField = (month: string, key: NumericKey, returnType: ReturnType, value: string) => {
    setData((prev) => ({ ...prev, [month]: { ...prev[month], [key]: num(value) } }));
    setDirtyMonths((prev) => new Set(prev).add(month));
    setTouchedGroups((prev) => {
      const monthSet = new Set(prev[month] || []);
      monthSet.add(returnType);
      return { ...prev, [month]: monthSet };
    });
  };

  const monthLookup = new Map(months.map((m) => [m.toLowerCase(), m]));

  const handlePasteImport = (rows: string[][]): PasteImportResult => {
    let imported = 0;
    const warnings: string[] = [];
    rows.forEach((row, idx) => {
      const rowNum = idx + 1;
      const isEmptyRow = row.every((c) => !c || c.trim() === '');
      if (isEmptyRow) { warnings.push(`Row ${rowNum}: empty row skipped.`); return; }
      const monthCell = (row[0] || '').trim();
      const matchedMonth = monthLookup.get(monthCell.toLowerCase());
      if (!matchedMonth) { warnings.push(`Row ${rowNum}: month "${monthCell}" not recognized.`); return; }
      PASTE_FIELDS.forEach((f, fi) => {
        const cellIdx = fi + 1; // cell 0 is Month
        if (cellIdx >= row.length) return; // column not provided in this row
        updateField(matchedMonth, f.key, f.returnType, cleanPastedNumber(row[cellIdx] ?? ''));
      });
      imported += 1;
    });
    const skipped = warnings.length;
    if (skipped > 0) {
      const preview = warnings.slice(0, 3).join(' ');
      toast.error(`Imported ${imported} row${imported === 1 ? '' : 's'}. ${skipped} skipped — see below: ${preview}`, { duration: 8000 });
    } else {
      toast.success(`Imported ${imported} row${imported === 1 ? '' : 's'}.`);
    }
    return { imported, skipped, warnings };
  };

  const saveAll = async () => {
    if (dirtyMonths.size === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const upserts: { client_id: string; period_month: string; return_type: ReturnType; summary: Record<string, number>; updated_at: string }[] = [];
      dirtyMonths.forEach((month) => {
        const row = data[month];
        if (!row) return;
        const touched = touchedGroups[month] || new Set<ReturnType>();
        const candidates: { return_type: ReturnType; include: boolean; summary: Record<string, number> }[] = [
          { return_type: 'GSTR-1', include: touched.has('GSTR-1') || row.hasGstr1, summary: { turnover_taxable: row.turnover_taxable, turnover_igst: row.turnover_igst, turnover_cgst: row.turnover_cgst, turnover_sgst: row.turnover_sgst } },
          { return_type: 'GSTR-3B', include: touched.has('GSTR-3B') || row.hasGstr3b, summary: { outward_igst: row.outward_igst, outward_cgst: row.outward_cgst, outward_sgst: row.outward_sgst, itc_igst: row.itc_igst, itc_cgst: row.itc_cgst, itc_sgst: row.itc_sgst } },
          { return_type: 'GSTR-2B', include: touched.has('GSTR-2B') || row.hasGstr2b, summary: { itc2b_igst: row.itc2b_igst, itc2b_cgst: row.itc2b_cgst, itc2b_sgst: row.itc2b_sgst } },
          { return_type: 'RCM', include: touched.has('RCM') || row.hasRcm, summary: { rcm_taxable: row.rcm_taxable, rcm_igst: row.rcm_igst, rcm_cgst: row.rcm_cgst, rcm_sgst: row.rcm_sgst } },
        ];
        candidates.filter((c) => c.include).forEach((c) => {
          upserts.push({ client_id: clientId, period_month: month, return_type: c.return_type, summary: c.summary, updated_at: now });
        });
      });
      if (upserts.length > 0) {
        const { error } = await supabase.from('gst_filed_returns').upsert(upserts, { onConflict: 'client_id,period_month,return_type' });
        if (error) throw error;
      }
      toast.success(`${dirtyMonths.size} month${dirtyMonths.size === 1 ? '' : 's'} saved.`);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const confirmedCount = months.filter((m) => data[m]?.hasGstr1 && data[m]?.hasGstr3b && data[m]?.hasGstr2b && data[m]?.hasRcm).length;
  const table6A = months.reduce((sum, m) => sum + (data[m]?.hasGstr3b ? data[m].itc_igst + data[m].itc_cgst + data[m].itc_sgst : 0), 0);
  const table8A = months.reduce((sum, m) => sum + (data[m]?.hasGstr2b ? data[m].itc2b_igst + data[m].itc2b_cgst + data[m].itc2b_sgst : 0), 0);
  const allConfirmed = confirmedCount === months.length;

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${allConfirmed ? 'bg-success/5 border-success/20 text-success' : 'bg-warning/5 border-warning/20 text-warning'}`}>
        {allConfirmed && <CheckCircle2 className="h-4 w-4 shrink-0" />}
        {confirmedCount} of {months.length} months confirmed
        {!allConfirmed && ' — figures for the rest still need entry before this year can rely on them.'}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="mb-0"><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Table 6A · Total ITC via GSTR-3B</div>
          <div className="flex items-baseline justify-between"><div className="text-xl font-semibold font-heading tabular-nums">{fmt(table6A)}</div><Badge variant={allConfirmed ? 'success' : 'warning'}>{allConfirmed ? 'Complete' : 'Partial'}</Badge></div>
        </CardContent></Card>
        <Card className="mb-0"><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Table 8A · ITC as per GSTR-2B</div>
          <div className="flex items-baseline justify-between"><div className="text-xl font-semibold font-heading tabular-nums">{fmt(table8A)}</div><Badge variant={allConfirmed ? 'success' : 'warning'}>{allConfirmed ? 'Complete' : 'Partial'}</Badge></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-lg">Month-wise return figures</CardTitle>
            <CardDescription>GSTR-1 turnover, GSTR-3B outward tax &amp; ITC claimed, GSTR-2B ITC available, and RCM Part A — click a month to expand and edit. Several months can be open at once.</CardDescription>
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
                <TableHead>Period</TableHead>
                <TableHead className="text-right">GSTR-1 Turnover</TableHead>
                <TableHead className="text-right">3B Outward</TableHead>
                <TableHead className="text-right">3B ITC</TableHead>
                <TableHead className="text-right">2B ITC</TableHead>
                <TableHead className="text-right">RCM</TableHead>
                <TableHead className="w-32">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => {
                const r = data[m] || emptyMonth(m);
                const confirmed = r.hasGstr1 && r.hasGstr3b && r.hasGstr2b && r.hasRcm;
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
                      <TableCell className="text-right tabular-nums">{fmt(r.turnover_taxable)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.outward_igst + r.outward_cgst + r.outward_sgst)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.itc_igst + r.itc_cgst + r.itc_sgst)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.itc2b_igst + r.itc2b_cgst + r.itc2b_sgst)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.rcm_igst + r.rcm_cgst + r.rcm_sgst)}</TableCell>
                      <TableCell><Badge variant={confirmed ? 'success' : 'outline'} className={confirmed ? '' : 'border-dashed text-muted-foreground'}>{confirmed ? 'Confirmed' : 'Needs entry'}</Badge></TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
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
                                      onChange={(e) => updateField(m, key, group.returnType, e.target.value)}
                                      aria-label={`${m} ${group.title} ${FIELD_LABEL[key]}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            ))}
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
      </Card>

      <PasteFromExcelDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Paste month-wise portal figures"
        columnLabels={PASTE_COLUMN_LABELS}
        onImport={handlePasteImport}
      />
    </div>
  );
};

export default PortalCaptureCard;
