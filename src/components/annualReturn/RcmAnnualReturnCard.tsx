import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

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

interface Draft {
  id?: string;
  month: string;
  category: string;
  taxable_value: string;
  igst: string;
  cgst: string;
  sgst: string;
}

const emptyDraft = (month: string): Draft => ({ month, category: '', taxable_value: '', igst: '', cgst: '', sgst: '' });
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
  const [lines, setLines] = useState<Line[]>([]);
  const [partA, setPartA] = useState<PartATotals>({ taxable: 0, igst: 0, cgst: 0, sgst: 0, monthsPresent: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setLines([]); setLoading(false); return; }
    setLoading(true);
    const [linesRes, portalRes] = await Promise.all([
      supabase.from('rcm_annual_return_lines').select('id, month, category, taxable_value, igst, cgst, sgst')
        .eq('client_id', clientId).eq('financial_year', financialYear).order('month', { ascending: true }),
      supabase.from('gst_filed_returns').select('summary').eq('client_id', clientId).eq('return_type', 'RCM').in('period_month', months),
    ]);
    if (linesRes.error) toast.error('Could not load RCM Part B: ' + linesRes.error.message);
    setLines((linesRes.data || []) as Line[]);
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

  const startAdd = () => setDraft(emptyDraft(months[0]));
  const startEdit = (row: Line) => setDraft({ id: row.id, month: row.month, category: row.category, taxable_value: String(row.taxable_value), igst: String(row.igst), cgst: String(row.cgst), sgst: String(row.sgst) });

  const saveDraft = async () => {
    if (!draft || !draft.category.trim()) { toast.error('Category is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId, financial_year: financialYear, month: draft.month, category: draft.category.trim(),
        taxable_value: num(draft.taxable_value), igst: num(draft.igst), cgst: num(draft.cgst), sgst: num(draft.sgst),
        updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('rcm_annual_return_lines').update(payload).eq('id', draft.id)
        : await supabase.from('rcm_annual_return_lines').upsert(payload, { onConflict: 'client_id,financial_year,month,category' });
      if (error) throw error;
      toast.success('RCM line saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: Line) => {
    const { error } = await supabase.from('rcm_annual_return_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totalTaxable = lines.reduce((a, r) => a + Number(r.taxable_value), 0);
  const totalIgst = lines.reduce((a, r) => a + Number(r.igst), 0);
  const totalCgst = lines.reduce((a, r) => a + Number(r.cgst), 0);
  const totalSgst = lines.reduce((a, r) => a + Number(r.sgst), 0);

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
          {lines.length > 0 && <Badge variant={partAMatched ? 'success' : 'destructive'}>Diff vs Part B: {fmt(partADiff)}</Badge>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">RCM — Part B (Books)</CardTitle>
              <CardDescription>Category and month-wise, built up from books — matched against Part A above.</CardDescription>
            </div>
            {!draft && <Button variant="outline" size="sm" onClick={startAdd}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>}
          </div>
        </CardHeader>
        <CardContent>
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
            {lines.length === 0 && !draft && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No RCM Part B lines entered yet.</TableCell></TableRow>
            )}
            {lines.map((row) => (
              draft?.id === row.id ? null : (
                <TableRow key={row.id}>
                  <TableCell>{row.month}</TableCell>
                  <TableCell className="font-medium">{row.category}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.taxable_value)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.igst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.cgst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.sgst)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>Edit</Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label={`Delete ${row.category}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            ))}
            {draft && (
              <TableRow>
                <TableCell>
                  <Select value={draft.month} onValueChange={(v) => setDraft({ ...draft, month: v })}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input list="rcm-category-suggestions" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. Transportation Exp" />
                  <datalist id="rcm-category-suggestions">{SUGGESTED_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
                </TableCell>
                <TableCell><Input type="number" value={draft.taxable_value} onChange={(e) => setDraft({ ...draft, taxable_value: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={draft.igst} onChange={(e) => setDraft({ ...draft, igst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={draft.cgst} onChange={(e) => setDraft({ ...draft, cgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={draft.sgst} onChange={(e) => setDraft({ ...draft, sgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" onClick={saveDraft} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {lines.length > 0 && (
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
    </div>
  );
};

export default RcmAnnualReturnCard;
