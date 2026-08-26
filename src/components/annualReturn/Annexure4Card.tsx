import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { previousFY } from '@/lib/annualReturnPeriods';
import { useConfirm } from '@/components/ui/confirm-dialog';

const DIRECTIONS = ['claimed_in_next_fy', 'claimed_from_prev_fy', 'turnover_declared_next_fy', 'turnover_reduced_next_fy'] as const;
const DIRECTION_LABEL: Record<string, string> = {
  claimed_in_next_fy: 'ITC claimed in next FY (Clause 8C)', claimed_from_prev_fy: 'ITC claimed from previous FY',
  turnover_declared_next_fy: 'Turnover declared in next FY (Clause 10)', turnover_reduced_next_fy: 'Turnover reduced in next FY (Clause 11)',
};
const CLAUSES = ['8C', '10', '11', '12', '13'] as const;

interface Line { id: string; direction: string; clause_ref: string | null; taxable_value: number; igst: number; cgst: number; sgst: number; notes: string | null; }
interface Draft { id?: string; direction: string; clause_ref: string; taxable_value: string; igst: string; cgst: string; sgst: string; notes: string; }
const emptyDraft = (): Draft => ({ direction: DIRECTIONS[0], clause_ref: '8C', taxable_value: '', igst: '', cgst: '', sgst: '', notes: '' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * ANNEXURE-4 — items from this FY that spill into the next one (Table 8C,
 * 10, 11, 12, 13). Entering them here for FY N is what makes them show up
 * as "previous year" carry-forward when FY N+1 is prepared — the same
 * table both years read, one entering, one displaying.
 */
export const Annexure4Card: React.FC<Props> = ({ clientId, financialYear }) => {
  const confirm = useConfirm();
  const [lines, setLines] = useState<Line[]>([]);
  const [priorLines, setPriorLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setLines([]); setLoading(false); return; }
    setLoading(true);
    const [curRes, priorRes] = await Promise.all([
      supabase.from('annual_return_carry_forward').select('id, direction, clause_ref, taxable_value, igst, cgst, sgst, notes').eq('client_id', clientId).eq('financial_year', financialYear).order('created_at', { ascending: true }),
      supabase.from('annual_return_carry_forward').select('id, direction, clause_ref, taxable_value, igst, cgst, sgst, notes').eq('client_id', clientId).eq('financial_year', previousFY(financialYear)).order('created_at', { ascending: true }),
    ]);
    if (curRes.error) toast.error('Could not load Annexure 4: ' + curRes.error.message);
    setLines((curRes.data || []) as Line[]);
    setPriorLines((priorRes.data || []) as Line[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = () => setDraft(emptyDraft());
  const startEdit = (row: Line) => setDraft({ id: row.id, direction: row.direction, clause_ref: row.clause_ref || '8C', taxable_value: String(row.taxable_value), igst: String(row.igst), cgst: String(row.cgst), sgst: String(row.sgst), notes: row.notes || '' });

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        client_id: clientId, financial_year: financialYear, direction: draft.direction, clause_ref: draft.clause_ref,
        taxable_value: num(draft.taxable_value), igst: num(draft.igst), cgst: num(draft.cgst), sgst: num(draft.sgst),
        notes: draft.notes.trim() || null, updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('annual_return_carry_forward').update(payload).eq('id', draft.id)
        : await supabase.from('annual_return_carry_forward').insert(payload);
      if (error) throw error;
      toast.success('Carry-forward line saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: Line) => {
    if (!(await confirm({ title: 'Delete this carry-forward line?', description: "This can't be undone.", destructive: true, confirmText: 'Delete' }))) return;
    const { error } = await supabase.from('annual_return_carry_forward').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="mb-0">
        <CardHeader>
          <CardTitle className="text-lg">Previous year carry-forward (from FY {previousFY(financialYear)})</CardTitle>
          <CardDescription>Read-only — entered when FY {previousFY(financialYear)} was prepared.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {priorLines.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">Nothing carried forward from FY {previousFY(financialYear)}.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Clause</TableHead><TableHead>Direction</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">IGST</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead></TableRow></TableHeader>
              <TableBody>
                {priorLines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.clause_ref || '—'}</TableCell>
                    <TableCell>{DIRECTION_LABEL[l.direction] || l.direction}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.taxable_value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.igst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.cgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.sgst)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">ANNEXURE-4 — FY {financialYear} items spilling into next year</CardTitle>
              <CardDescription>Clauses 8C, 10, 11, 12, 13 — this becomes next year's "previous year carry-forward" above.</CardDescription>
            </div>
            {!draft && <Button variant="outline" size="sm" onClick={startAdd}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Clause</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 && !draft && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No carry-forward lines entered yet.</TableCell></TableRow>
              )}
              {lines.map((row) => (
                draft?.id === row.id ? null : (
                  <TableRow key={row.id}>
                    <TableCell>{row.clause_ref || '—'}</TableCell>
                    <TableCell>{DIRECTION_LABEL[row.direction] || row.direction}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.taxable_value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.igst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.cgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.sgst)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>Edit</Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label="Delete line"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              ))}
              {draft && (
                <TableRow>
                  <TableCell>
                    <Select value={draft.clause_ref} onValueChange={(v) => setDraft({ ...draft, clause_ref: v })}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>{CLAUSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={draft.direction} onValueChange={(v) => setDraft({ ...draft, direction: v })}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>{DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{DIRECTION_LABEL[d]}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" value={draft.taxable_value} onChange={(e) => setDraft({ ...draft, taxable_value: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell><Input type="number" value={draft.igst} onChange={(e) => setDraft({ ...draft, igst: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell><Input type="number" value={draft.cgst} onChange={(e) => setDraft({ ...draft, cgst: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell><Input type="number" value={draft.sgst} onChange={(e) => setDraft({ ...draft, sgst: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" onClick={saveDraft} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Annexure4Card;
