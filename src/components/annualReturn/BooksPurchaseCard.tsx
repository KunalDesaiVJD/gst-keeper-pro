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

export const EXPENSE_HEADS = [
  'Purchases', 'Freight', 'Power & Fuel', 'Imported Goods',
  'Rent & Insurance', 'Goods Lost/Destroyed/Gifted', 'Royalties',
  "Employees' Cost", 'Conveyance', 'Bank Charges', 'Entertainment',
  'Stationery', 'Repair & Maintenance', 'Capital Goods', 'RCM', 'Other',
] as const;

interface PurchaseRow {
  id: string;
  ledger_head: string;
  rate: string | null;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  expense_head: string | null;
}

interface Draft {
  id?: string;
  ledger_head: string;
  rate: string;
  taxable_value: string;
  igst: string;
  cgst: string;
  sgst: string;
  expense_head: string;
}

const EMPTY_DRAFT: Draft = { ledger_head: '', rate: '', taxable_value: '', igst: '', cgst: '', sgst: '', expense_head: '' };

const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props {
  clientId: string;
  financialYear: string;
}

/**
 * PL-INPUT equivalent — books purchases/ITC, rate-wise, line by line. Each
 * line also carries an expense_head (the fixed GSTR-9C Table 14 buckets) so
 * that table falls out of this data later instead of being re-classified
 * from scratch. The expense_head picked here is remembered per ledger head
 * (expense_head_mappings) and offered back next time the same head is used.
 */
export const BooksPurchaseCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const [linesRes, mapRes] = await Promise.all([
      supabase
        .from('books_purchase_lines')
        .select('id, ledger_head, rate, taxable_value, igst, cgst, sgst, expense_head')
        .eq('client_id', clientId)
        .eq('financial_year', financialYear)
        .order('created_at', { ascending: true }),
      supabase
        .from('expense_head_mappings')
        .select('ledger_head, expense_head')
        .eq('client_id', clientId),
    ]);
    if (linesRes.error) toast.error('Could not load purchase lines: ' + linesRes.error.message);
    if (mapRes.error) toast.error('Could not load expense-head mappings: ' + mapRes.error.message);
    setRows((linesRes.data || []) as PurchaseRow[]);
    const m: Record<string, string> = {};
    (mapRes.data || []).forEach((r: { ledger_head: string; expense_head: string }) => { m[r.ledger_head] = r.expense_head; });
    setMappings(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = () => setDraft({ ...EMPTY_DRAFT });
  const startEdit = (row: PurchaseRow) => setDraft({
    id: row.id,
    ledger_head: row.ledger_head,
    rate: row.rate || '',
    taxable_value: String(row.taxable_value),
    igst: String(row.igst),
    cgst: String(row.cgst),
    sgst: String(row.sgst),
    expense_head: row.expense_head || '',
  });

  // Prefill the expense head from a remembered mapping once staff finish
  // typing a ledger head that's been classified before.
  const onLedgerHeadBlur = () => {
    if (!draft || draft.expense_head || !draft.ledger_head.trim()) return;
    const suggestion = mappings[draft.ledger_head.trim()];
    if (suggestion) setDraft({ ...draft, expense_head: suggestion });
  };

  const saveDraft = async () => {
    if (!draft || !draft.ledger_head.trim()) { toast.error('Ledger head is required.'); return; }
    setSaving(true);
    try {
      const ledgerHead = draft.ledger_head.trim();
      const payload = {
        client_id: clientId,
        financial_year: financialYear,
        ledger_head: ledgerHead,
        rate: draft.rate.trim() || null,
        taxable_value: num(draft.taxable_value),
        igst: num(draft.igst),
        cgst: num(draft.cgst),
        sgst: num(draft.sgst),
        expense_head: draft.expense_head || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('books_purchase_lines').update(payload).eq('id', draft.id)
        : await supabase.from('books_purchase_lines').insert(payload);
      if (error) throw error;

      if (draft.expense_head) {
        const { error: mapErr } = await supabase
          .from('expense_head_mappings')
          .upsert(
            { client_id: clientId, ledger_head: ledgerHead, expense_head: draft.expense_head, updated_at: new Date().toISOString() },
            { onConflict: 'client_id,ledger_head' },
          );
        if (mapErr) toast.error('Line saved, but the expense-head mapping could not be remembered: ' + mapErr.message);
      }

      toast.success('Purchase line saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: PurchaseRow) => {
    const { error } = await supabase.from('books_purchase_lines').delete().eq('id', row.id);
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
            <CardTitle className="text-lg">Inward Supplies / ITC (Books)</CardTitle>
            <CardDescription>Rate-wise books purchases — mirrors PL-Input. Feeds GSTR-9 Table 6 and 9C Table 12/14.</CardDescription>
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
                <TableHead>9C Head</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !draft && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No purchase/ITC lines entered yet.</TableCell></TableRow>
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
                      {row.expense_head
                        ? <Badge variant="outline">{row.expense_head}</Badge>
                        : <Badge variant="outline" className="border-dashed text-muted-foreground">Unmapped</Badge>}
                    </TableCell>
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
                  <TableCell>
                    <Input
                      value={draft.ledger_head}
                      onChange={(e) => setDraft({ ...draft, ledger_head: e.target.value })}
                      onBlur={onLedgerHeadBlur}
                      placeholder="e.g. Freight Inward (RCM)"
                    />
                  </TableCell>
                  <TableCell><Input value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} placeholder="18%" className="w-20" /></TableCell>
                  <TableCell><Input type="number" value={draft.taxable_value} onChange={(e) => setDraft({ ...draft, taxable_value: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell><Input type="number" value={draft.igst} onChange={(e) => setDraft({ ...draft, igst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell><Input type="number" value={draft.cgst} onChange={(e) => setDraft({ ...draft, cgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell><Input type="number" value={draft.sgst} onChange={(e) => setDraft({ ...draft, sgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
                  <TableCell>
                    <Select value={draft.expense_head || undefined} onValueChange={(v) => setDraft({ ...draft, expense_head: v })}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Select head" /></SelectTrigger>
                      <SelectContent>
                        {EXPENSE_HEADS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
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
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default BooksPurchaseCard;
