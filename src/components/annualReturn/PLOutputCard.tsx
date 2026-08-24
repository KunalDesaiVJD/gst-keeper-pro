import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Part = 'A' | 'B';
const BIFURCATIONS = ['export_wo_tax', 'sez_wo_tax', 'non_gst'] as const;
const BIFURCATION_LABEL: Record<string, string> = {
  export_wo_tax: 'Export sale W/O',
  sez_wo_tax: 'SEZ W/O',
  non_gst: 'Non-GST',
};

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

interface Draft {
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

const emptyDraft = (part: Part): Draft => ({ part, ledger_head: '', bifurcation: '', rate: '', taxable_value: '', igst: '', cgst: '', sgst: '' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

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
  const [lines, setLines] = useState<Line[]>([]);
  const [auditedTurnover, setAuditedTurnover] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setLines([]); setLoading(false); return; }
    setLoading(true);
    const [linesRes, turnoverRes] = await Promise.all([
      supabase.from('pl_output_lines').select('id, part, ledger_head, bifurcation, rate, taxable_value, igst, cgst, sgst')
        .eq('client_id', clientId).eq('financial_year', financialYear).order('created_at', { ascending: true }),
      supabase.from('client_annual_turnover').select('aggregate_turnover').eq('client_id', clientId).eq('financial_year', financialYear).maybeSingle(),
    ]);
    if (linesRes.error) toast.error('Could not load PL-Output: ' + linesRes.error.message);
    setLines((linesRes.data || []) as Line[]);
    setAuditedTurnover(turnoverRes.data?.aggregate_turnover ?? null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = (part: Part) => setDraft(emptyDraft(part));
  const startEdit = (row: Line) => setDraft({
    id: row.id, part: row.part, ledger_head: row.ledger_head, bifurcation: row.bifurcation || '',
    rate: row.rate || '', taxable_value: String(row.taxable_value), igst: String(row.igst), cgst: String(row.cgst), sgst: String(row.sgst),
  });

  const saveDraft = async () => {
    if (!draft || !draft.ledger_head.trim()) { toast.error('Ledger head is required.'); return; }
    if (draft.part === 'B' && !draft.bifurcation) { toast.error('Pick a bifurcation for a Part B line.'); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId, financial_year: financialYear, part: draft.part,
        ledger_head: draft.ledger_head.trim(), bifurcation: draft.part === 'B' ? draft.bifurcation : null,
        rate: draft.rate.trim() || null, taxable_value: num(draft.taxable_value),
        igst: num(draft.igst), cgst: num(draft.cgst), sgst: num(draft.sgst),
        updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('pl_output_lines').update(payload).eq('id', draft.id)
        : await supabase.from('pl_output_lines').insert(payload);
      if (error) throw error;
      toast.success('PL-Output line saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: Line) => {
    const { error } = await supabase.from('pl_output_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totals = (part: Part) => lines.filter((l) => l.part === part).reduce(
    (acc, r) => ({ taxable: acc.taxable + Number(r.taxable_value), igst: acc.igst + Number(r.igst), cgst: acc.cgst + Number(r.cgst), sgst: acc.sgst + Number(r.sgst) }),
    { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
  );
  const totalA = totals('A');
  const totalB = totals('B');
  const grandTaxable = totalA.taxable + totalB.taxable;
  const diff = auditedTurnover != null ? grandTaxable - auditedTurnover : null;

  const renderTable = (part: Part) => {
    const rows = lines.filter((l) => l.part === part);
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
          {rows.length === 0 && !(draft && draft.part === part && !draft.id) && (
            <TableRow><TableCell colSpan={part === 'A' ? 6 : 4} className="text-center text-sm text-muted-foreground py-6">No Part {part} lines yet.</TableCell></TableRow>
          )}
          {rows.map((row) => (
            draft?.id === row.id ? null : (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.ledger_head}</TableCell>
                {part === 'B' && <TableCell>{BIFURCATION_LABEL[row.bifurcation || ''] || '—'}</TableCell>}
                {part === 'A' && <TableCell>{row.rate || '—'}</TableCell>}
                <TableCell className="text-right tabular-nums">{fmt(row.taxable_value)}</TableCell>
                {part === 'A' && <>
                  <TableCell className="text-right tabular-nums">{fmt(row.igst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.cgst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.sgst)}</TableCell>
                </>}
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>Edit</Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label={`Delete ${row.ledger_head}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          ))}
          {draft && draft.part === part && (
            <TableRow>
              <TableCell><Input value={draft.ledger_head} onChange={(e) => setDraft({ ...draft, ledger_head: e.target.value })} placeholder="e.g. GST Sales 18%" /></TableCell>
              {part === 'B' && (
                <TableCell>
                  <Select value={draft.bifurcation || undefined} onValueChange={(v) => setDraft({ ...draft, bifurcation: v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{BIFURCATIONS.map((b) => <SelectItem key={b} value={b}>{BIFURCATION_LABEL[b]}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              )}
              {part === 'A' && <TableCell><Input value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} placeholder="18%" className="w-20" /></TableCell>}
              <TableCell><Input type="number" value={draft.taxable_value} onChange={(e) => setDraft({ ...draft, taxable_value: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              {part === 'A' && <>
                <TableCell><Input type="number" value={draft.igst} onChange={(e) => setDraft({ ...draft, igst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={draft.cgst} onChange={(e) => setDraft({ ...draft, cgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                <TableCell><Input type="number" value={draft.sgst} onChange={(e) => setDraft({ ...draft, sgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              </>}
              <TableCell>
                <div className="flex gap-1 justify-end">
                  <Button size="sm" onClick={saveDraft} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {rows.length > 0 && (
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

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg">PL-OUTPUT</CardTitle>
            <CardDescription>Books sales, annual, by ledger head — Part A (taxable) and Part B (non-taxable). No month here; see Duties &amp; Taxes for the monthly entry.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Part A — Taxable income</h4>
            {!draft && <Button variant="outline" size="sm" onClick={() => startAdd('A')}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>}
          </div>
          {renderTable('A')}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Part B — Non-taxable income</h4>
            {!draft && <Button variant="outline" size="sm" onClick={() => startAdd('B')}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>}
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
    </Card>
  );
};

export default PLOutputCard;
