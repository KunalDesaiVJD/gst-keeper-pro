import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface TurnoverRow {
  id: string;
  ledger_head: string;
  rate: string | null;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
}

interface Draft {
  id?: string;
  ledger_head: string;
  rate: string;
  taxable_value: string;
  igst: string;
  cgst: string;
  sgst: string;
}

const EMPTY_DRAFT: Draft = { ledger_head: '', rate: '', taxable_value: '', igst: '', cgst: '', sgst: '' };

const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props {
  clientId: string;
  financialYear: string;
}

/**
 * PL-OUTPUT equivalent — books sales, rate-wise, line by line. This is the
 * root of the turnover chain for the annual return: GSTR-9 Table 4/5 and
 * 9C Table 5 reconcile against these rows in later phases, not the other
 * way round.
 */
export const BooksTurnoverCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<TurnoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('books_turnover_lines')
      .select('id, ledger_head, rate, taxable_value, igst, cgst, sgst')
      .eq('client_id', clientId)
      .eq('financial_year', financialYear)
      .order('created_at', { ascending: true });
    if (error) toast.error('Could not load turnover lines: ' + error.message);
    setRows((data || []) as TurnoverRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = () => setDraft({ ...EMPTY_DRAFT });
  const startEdit = (row: TurnoverRow) => setDraft({
    id: row.id,
    ledger_head: row.ledger_head,
    rate: row.rate || '',
    taxable_value: String(row.taxable_value),
    igst: String(row.igst),
    cgst: String(row.cgst),
    sgst: String(row.sgst),
  });

  const saveDraft = async () => {
    if (!draft || !draft.ledger_head.trim()) { toast.error('Ledger head is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        financial_year: financialYear,
        ledger_head: draft.ledger_head.trim(),
        rate: draft.rate.trim() || null,
        taxable_value: num(draft.taxable_value),
        igst: num(draft.igst),
        cgst: num(draft.cgst),
        sgst: num(draft.sgst),
        updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('books_turnover_lines').update(payload).eq('id', draft.id)
        : await supabase.from('books_turnover_lines').insert(payload);
      if (error) throw error;
      toast.success('Turnover line saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: TurnoverRow) => {
    const { error } = await supabase.from('books_turnover_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totals = rows.reduce(
    (acc, r) => ({
      taxable: acc.taxable + Number(r.taxable_value),
      igst: acc.igst + Number(r.igst),
      cgst: acc.cgst + Number(r.cgst),
      sgst: acc.sgst + Number(r.sgst),
    }),
    { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg">Outward Supplies (Books)</CardTitle>
            <CardDescription>Rate-wise books sales — mirrors PL-Output. Feeds GSTR-9 Table 4/5 and 9C Table 5.</CardDescription>
          </div>
          {!draft && (
            <Button variant="outline" size="sm" onClick={startAdd}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add line
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ledger Head</TableHead>
                <TableHead className="w-20">Rate</TableHead>
                <TableHead className="text-right">Taxable Value</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !draft && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No outward supply lines entered yet.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                draft?.id === row.id ? null : (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.ledger_head}</TableCell>
                    <TableCell>{row.rate || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.taxable_value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.igst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.cgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.sgst)}</TableCell>
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
              {draft && (
                <TableRow>
                  <TableCell><Input value={draft.ledger_head} onChange={(e) => setDraft({ ...draft, ledger_head: e.target.value })} placeholder="e.g. Domestic Sales – 18%" /></TableCell>
                  <TableCell><Input value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} placeholder="18%" className="w-20" /></TableCell>
                  <TableCell><Input type="number" value={draft.taxable_value} onChange={(e) => setDraft({ ...draft, taxable_value: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell><Input type="number" value={draft.igst} onChange={(e) => setDraft({ ...draft, igst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell><Input type="number" value={draft.cgst} onChange={(e) => setDraft({ ...draft, cgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell><Input type="number" value={draft.sgst} onChange={(e) => setDraft({ ...draft, sgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" onClick={saveDraft} disabled={saving}>
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.taxable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.igst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.cgst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.sgst)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default BooksTurnoverCard;
