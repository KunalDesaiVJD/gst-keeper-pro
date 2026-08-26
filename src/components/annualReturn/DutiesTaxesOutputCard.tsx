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

const FIELD_LABELS: { key: keyof MonthRow; label: string }[] = [
  { key: 'sales_igst', label: 'Sales — IGST' }, { key: 'sales_cgst', label: 'Sales — CGST' }, { key: 'sales_sgst', label: 'Sales — SGST' },
  { key: 'credit_note_igst', label: 'Credit Note — IGST' }, { key: 'credit_note_cgst', label: 'Credit Note — CGST' }, { key: 'credit_note_sgst', label: 'Credit Note — SGST' },
  { key: 'as_per_3b_igst', label: 'As per 3B — IGST' }, { key: 'as_per_3b_cgst', label: 'As per 3B — CGST' }, { key: 'as_per_3b_sgst', label: 'As per 3B — SGST' },
];

/**
 * DUTIES & TAXES-OUTPUT — month-wise, entered separately from PL-Output
 * (firm decision, 27 Aug 2026) and cross-checked against it rather than
 * derived from it.
 */
export const DutiesTaxesOutputCard: React.FC<Props> = ({ clientId, financialYear, onSaved }) => {
  const months = monthsForFY(financialYear);
  const [data, setData] = useState<Record<string, MonthRow>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MonthRow | null>(null);
  const [saving, setSaving] = useState(false);

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
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { hasEntry, ...payload } = editing;
      const { error } = await supabase.from('duties_taxes_output_monthly').upsert(
        { client_id: clientId, financial_year: financialYear, ...payload, updated_at: new Date().toISOString() },
        { onConflict: 'client_id,financial_year,month' },
      );
      if (error) throw error;
      toast.success(`${editing.month} saved.`);
      setEditing(null);
      await load();
      onSaved?.();
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
        <CardTitle className="text-lg">DUTIES &amp; TAXES-OUTPUT</CardTitle>
        <CardDescription>Month-wise sales vs. as-filed GSTR-3B — separate entry from PL-Output, cross-checked against it.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Net Sales</TableHead>
              <TableHead className="text-right">As per 3B</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => {
              const r = data[m] || emptyMonth(m);
              const net = netSales(r);
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
          <DialogHeader><DialogTitle>{editing?.month} — Duties &amp; Taxes-Output</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              {FIELD_LABELS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <Input type="number" className="w-40 text-right" value={String(editing[key])}
                    onChange={(e) => setEditing({ ...editing, [key]: num(e.target.value) })} />
                </div>
              ))}
              <div className="pt-2 border-t space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other adjustments (Cr side)</div>
                {(['other_adjustment_igst', 'other_adjustment_cgst', 'other_adjustment_sgst'] as const).map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{key.replace('other_adjustment_', '').toUpperCase()}</span>
                    <Input type="number" className="w-40 text-right" value={String(editing[key])} onChange={(e) => setEditing({ ...editing, [key]: num(e.target.value) })} />
                  </div>
                ))}
                <Textarea placeholder="Reason for adjustment" value={editing.other_adjustment_reason} onChange={(e) => setEditing({ ...editing, other_adjustment_reason: e.target.value })} />
              </div>
              <div className="flex items-center justify-between pt-2 border-t text-sm">
                <span>Diff</span>
                <Badge variant={Math.abs(netSales(editing) - as3b(editing)) <= TOLERANCE ? 'success' : 'destructive'}>{fmt(netSales(editing) - as3b(editing))}</Badge>
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

export default DutiesTaxesOutputCard;
