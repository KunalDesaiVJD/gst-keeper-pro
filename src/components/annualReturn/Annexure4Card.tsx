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
interface EditRow { key: string; id?: string; direction: string; clause_ref: string; taxable_value: string; igst: string; cgst: string; sgst: string; notes: string; }
const emptyRow = (): EditRow => ({ key: `new-${crypto.randomUUID()}`, direction: DIRECTIONS[0], clause_ref: '8C', taxable_value: '', igst: '', cgst: '', sgst: '', notes: '' });
const lineToRow = (l: Line): EditRow => ({ key: l.id, id: l.id, direction: l.direction, clause_ref: l.clause_ref || '8C', taxable_value: String(l.taxable_value), igst: String(l.igst), cgst: String(l.cgst), sgst: String(l.sgst), notes: l.notes || '' });
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
  const [rows, setRows] = useState<EditRow[]>([]);
  const [priorLines, setPriorLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setDirty(new Set()); setLoading(false); return; }
    setLoading(true);
    const [curRes, priorRes] = await Promise.all([
      supabase.from('annual_return_carry_forward').select('id, direction, clause_ref, taxable_value, igst, cgst, sgst, notes').eq('client_id', clientId).eq('financial_year', financialYear).order('created_at', { ascending: true }),
      supabase.from('annual_return_carry_forward').select('id, direction, clause_ref, taxable_value, igst, cgst, sgst, notes').eq('client_id', clientId).eq('financial_year', previousFY(financialYear)).order('created_at', { ascending: true }),
    ]);
    if (curRes.error) toast.error('Could not load Annexure 4: ' + curRes.error.message);
    setRows(((curRes.data || []) as Line[]).map(lineToRow));
    setPriorLines((priorRes.data || []) as Line[]);
    setDirty(new Set());
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLine = () => {
    const row = emptyRow();
    setRows((prev) => [...prev, row]);
    setDirty((prev) => new Set(prev).add(row.key));
  };

  const updateRow = (key: string, patch: Partial<EditRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty((prev) => new Set(prev).add(key));
  };

  const buildPayload = (r: EditRow) => ({
    client_id: clientId, financial_year: financialYear, direction: r.direction, clause_ref: r.clause_ref,
    taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst),
    notes: r.notes.trim() || null, updated_at: new Date().toISOString(),
  });

  const saveAll = async () => {
    const dirtyRows = rows.filter((r) => dirty.has(r.key));
    if (dirtyRows.length === 0) return;
    setSaving(true);
    try {
      const newRows = dirtyRows.filter((r) => !r.id);
      const existingRows = dirtyRows.filter((r) => r.id);
      if (newRows.length > 0) {
        const { error } = await supabase.from('annual_return_carry_forward').insert(newRows.map(buildPayload));
        if (error) throw new Error('New rows: ' + error.message);
      }
      if (existingRows.length > 0) {
        const { error } = await supabase.from('annual_return_carry_forward').upsert(existingRows.map((r) => ({ id: r.id, ...buildPayload(r) })), { onConflict: 'id' });
        if (error) throw new Error('Existing rows: ' + error.message);
      }
      toast.success(`Saved ${dirtyRows.length} carry-forward line${dirtyRows.length > 1 ? 's' : ''}.`);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: EditRow) => {
    if (!(await confirm({ title: 'Delete this carry-forward line?', description: "This can't be undone.", destructive: true, confirmText: 'Delete' }))) return;
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setDirty((prev) => { const next = new Set(prev); next.delete(row.key); return next; });
      return;
    }
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
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>
              <Button size="sm" onClick={saveAll} disabled={saving || dirty.size === 0}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save changes{dirty.size > 0 ? ` (${dirty.size})` : ''}
              </Button>
            </div>
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
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No carry-forward lines entered yet.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <Select value={row.clause_ref} onValueChange={(v) => updateRow(row.key, { clause_ref: v })}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>{CLAUSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={row.direction} onValueChange={(v) => updateRow(row.key, { direction: v })}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>{DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{DIRECTION_LABEL[d]}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" value={row.taxable_value} onChange={(e) => updateRow(row.key, { taxable_value: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell><Input type="number" value={row.igst} onChange={(e) => updateRow(row.key, { igst: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell><Input type="number" value={row.cgst} onChange={(e) => updateRow(row.key, { cgst: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell><Input type="number" value={row.sgst} onChange={(e) => updateRow(row.key, { sgst: e.target.value })} placeholder="0" className="text-right w-28" /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label="Delete line"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Annexure4Card;
