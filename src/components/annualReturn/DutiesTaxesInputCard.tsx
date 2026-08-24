import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

const TOLERANCE = 10;
const LAST_YEAR_EFFECT = 'Last Year Effect';

const NUMERIC_KEYS = [
  'purchase_igst', 'purchase_cgst', 'purchase_sgst',
  'debit_note_igst', 'debit_note_cgst', 'debit_note_sgst',
  'suspended_reversed_igst', 'suspended_reversed_cgst', 'suspended_reversed_sgst',
  'suspended_reversed_180d_igst', 'suspended_reversed_180d_cgst', 'suspended_reversed_180d_sgst',
  'suspended_reclaim_igst', 'suspended_reclaim_cgst', 'suspended_reclaim_sgst',
  'suspended_reclaim_180d_igst', 'suspended_reclaim_180d_cgst', 'suspended_reclaim_180d_sgst',
  'as_per_3b_igst', 'as_per_3b_cgst', 'as_per_3b_sgst',
  'other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst',
] as const;
type NumericKey = typeof NUMERIC_KEYS[number];

interface MonthRow {
  month: string;
  other_adjustment_reason: string;
  hasEntry: boolean;
}
type FullMonthRow = MonthRow & Record<NumericKey, number>;

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
const as3b = (r: FullMonthRow) => r.as_per_3b_igst + r.as_per_3b_cgst + r.as_per_3b_sgst;

const FIELD_GROUPS: { title: string; keys: NumericKey[] }[] = [
  { title: 'Purchase', keys: ['purchase_igst', 'purchase_cgst', 'purchase_sgst'] },
  { title: 'Debit Note', keys: ['debit_note_igst', 'debit_note_cgst', 'debit_note_sgst'] },
  { title: 'Suspended ITC (Reversed)', keys: ['suspended_reversed_igst', 'suspended_reversed_cgst', 'suspended_reversed_sgst'] },
  { title: 'Suspended ITC (Reversed) — 180 days', keys: ['suspended_reversed_180d_igst', 'suspended_reversed_180d_cgst', 'suspended_reversed_180d_sgst'] },
  { title: 'Suspended ITC (Reclaim)', keys: ['suspended_reclaim_igst', 'suspended_reclaim_cgst', 'suspended_reclaim_sgst'] },
  { title: 'Suspended ITC (Reclaim) — 180 days', keys: ['suspended_reclaim_180d_igst', 'suspended_reclaim_180d_cgst', 'suspended_reclaim_180d_sgst'] },
  { title: 'As per 3B', keys: ['as_per_3b_igst', 'as_per_3b_cgst', 'as_per_3b_sgst'] },
];
const TAX_LABEL: Record<string, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST' };

interface Props { clientId: string; financialYear: string; }

/**
 * DUTIES & TAXES-INPUT — month-wise, entered separately from PL-Input.
 * Reversal/reclaim/180-day columns are running totals, not linked to a
 * specific original transaction (firm decision, 27 Aug 2026 — matches the
 * sheet). Includes the sheet's "Last Year Effect" pseudo-month row.
 */
export const DutiesTaxesInputCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const months = [LAST_YEAR_EFFECT, ...monthsForFY(financialYear)];
  const [data, setData] = useState<Record<string, FullMonthRow>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FullMonthRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setData({}); setLoading(false); return; }
    setLoading(true);
    const { data: rows, error } = await supabase.from('duties_taxes_input_monthly').select('*').eq('client_id', clientId).eq('financial_year', financialYear).in('month', months);
    if (error) { toast.error('Could not load Duties & Taxes-Input: ' + error.message); setLoading(false); return; }
    const next: Record<string, FullMonthRow> = {};
    months.forEach((m) => { next[m] = emptyMonth(m); });
    (rows || []).forEach((r: Record<string, unknown>) => {
      const row = emptyMonth(r.month as string);
      NUMERIC_KEYS.forEach((k) => { row[k] = Number(r[k]) || 0; });
      row.other_adjustment_reason = (r.other_adjustment_reason as string) || '';
      row.hasEntry = true;
      next[r.month as string] = row;
    });
    setData(next);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { hasEntry, ...payload } = editing;
      const { error } = await supabase.from('duties_taxes_input_monthly').upsert(
        { client_id: clientId, financial_year: financialYear, ...payload, updated_at: new Date().toISOString() },
        { onConflict: 'client_id,financial_year,month' },
      );
      if (error) throw error;
      toast.success(`${editing.month} saved.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">DUTIES &amp; TAXES-INPUT</CardTitle>
        <CardDescription>Month-wise purchases, debit notes and suspended-ITC reversal/reclaim vs. as-filed GSTR-3B — separate entry from PL-Input.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Net Purchase</TableHead>
              <TableHead className="text-right">As per 3B</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => {
              const r = data[m] || emptyMonth(m);
              const net = netPurchase(r);
              const asFiled = as3b(r);
              const diff = net - asFiled;
              const matched = Math.abs(diff) <= TOLERANCE;
              return (
                <TableRow key={m}>
                  <TableCell className="font-medium">{m}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(asFiled)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${r.hasEntry ? (matched ? 'text-success' : 'text-destructive') : 'text-muted-foreground'}`}>{r.hasEntry ? fmt(diff) : '—'}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(r)} aria-label={`Edit ${m}`}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.month} — Duties &amp; Taxes-Input</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {FIELD_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</div>
                  {group.keys.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">{TAX_LABEL[key.split('_').pop() as string]}</span>
                      <Input type="number" className="w-40 text-right" value={String(editing[key])} onChange={(e) => setEditing({ ...editing, [key]: num(e.target.value) })} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="pt-2 border-t space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other adjustments (Dr side)</div>
                {(['other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst'] as const).map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{TAX_LABEL[key.split('_').pop() as string]}</span>
                    <Input type="number" className="w-40 text-right" value={String(editing[key])} onChange={(e) => setEditing({ ...editing, [key]: num(e.target.value) })} />
                  </div>
                ))}
                <Textarea placeholder="Reason for adjustment" value={editing.other_adjustment_reason} onChange={(e) => setEditing({ ...editing, other_adjustment_reason: e.target.value })} />
              </div>
              <div className="flex items-center justify-between pt-2 border-t text-sm">
                <span>Diff</span>
                <Badge variant={Math.abs(netPurchase(editing) - as3b(editing)) <= TOLERANCE ? 'success' : 'destructive'}>{fmt(netPurchase(editing) - as3b(editing))}</Badge>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default DutiesTaxesInputCard;
