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

type Section = 'purchase' | 'expense' | 'capital_goods';
const SECTION_LABEL: Record<Section, string> = { purchase: '(A) Purchase', expense: '(B) Direct & Indirect Expense', capital_goods: '(C) Capital Goods' };
// Purchase and Capital Goods roll up to one fixed 9C head each — only
// Expense lines need per-line classification (matches how GSTR 9C's table
// is actually built: rows A/O pull the section totals directly).
const SECTION_DEFAULT_HEAD: Record<Section, string | null> = { purchase: 'Purchases', expense: null, capital_goods: 'Capital Goods' };

interface Line {
  id: string;
  section: Section;
  ledger_head: string;
  expense_head: string | null;
  rate: string | null;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
}

interface Draft {
  id?: string;
  section: Section;
  ledger_head: string;
  expense_head: string;
  rate: string;
  taxable_value: string;
  igst: string;
  cgst: string;
  sgst: string;
}

const emptyDraft = (section: Section): Draft => ({ section, ledger_head: '', expense_head: SECTION_DEFAULT_HEAD[section] || '', rate: '', taxable_value: '', igst: '', cgst: '', sgst: '' });
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props {
  clientId: string;
  financialYear: string;
}

/**
 * PL-INPUT — (A) Purchase, (B) Expense, (C) Capital Goods, annual, by
 * ledger head, exactly as the firm's sheet has it (no month — Duties &
 * Taxes-Input is the separate monthly entry). The "SUSPENDED ITC" and "RCM
 * CREDIT" summary rows the real sheet shows below these sections are
 * computed from Duties & Taxes-Input and RCM respectively, not entered here
 * — see the Duties & Taxes and RCM tabs.
 */
export const PLInputCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [lines, setLines] = useState<Line[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setLines([]); setLoading(false); return; }
    setLoading(true);
    const [linesRes, mapRes] = await Promise.all([
      supabase.from('pl_input_lines').select('id, section, ledger_head, expense_head, rate, taxable_value, igst, cgst, sgst')
        .eq('client_id', clientId).eq('financial_year', financialYear).order('created_at', { ascending: true }),
      supabase.from('expense_head_mappings').select('ledger_head, expense_head').eq('client_id', clientId),
    ]);
    if (linesRes.error) toast.error('Could not load PL-Input: ' + linesRes.error.message);
    setLines((linesRes.data || []) as Line[]);
    const m: Record<string, string> = {};
    (mapRes.data || []).forEach((r: { ledger_head: string; expense_head: string }) => { m[r.ledger_head] = r.expense_head; });
    setMappings(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = (section: Section) => setDraft(emptyDraft(section));
  const startEdit = (row: Line) => setDraft({
    id: row.id, section: row.section, ledger_head: row.ledger_head, expense_head: row.expense_head || '',
    rate: row.rate || '', taxable_value: String(row.taxable_value), igst: String(row.igst), cgst: String(row.cgst), sgst: String(row.sgst),
  });

  const onLedgerHeadBlur = () => {
    if (!draft || draft.section !== 'expense' || draft.expense_head || !draft.ledger_head.trim()) return;
    const suggestion = mappings[draft.ledger_head.trim()];
    if (suggestion) setDraft({ ...draft, expense_head: suggestion });
  };

  const saveDraft = async () => {
    if (!draft || !draft.ledger_head.trim()) { toast.error('Ledger head is required.'); return; }
    setSaving(true);
    try {
      const ledgerHead = draft.ledger_head.trim();
      const expenseHead = draft.section === 'expense' ? (draft.expense_head || null) : SECTION_DEFAULT_HEAD[draft.section];
      const payload = {
        client_id: clientId, financial_year: financialYear, section: draft.section,
        ledger_head: ledgerHead, expense_head: expenseHead, rate: draft.rate.trim() || null,
        taxable_value: num(draft.taxable_value), igst: num(draft.igst), cgst: num(draft.cgst), sgst: num(draft.sgst),
        updated_at: new Date().toISOString(),
      };
      const { error } = draft.id
        ? await supabase.from('pl_input_lines').update(payload).eq('id', draft.id)
        : await supabase.from('pl_input_lines').insert(payload);
      if (error) throw error;

      if (draft.section === 'expense' && expenseHead) {
        const { error: mapErr } = await supabase.from('expense_head_mappings').upsert(
          { client_id: clientId, ledger_head: ledgerHead, expense_head: expenseHead, updated_at: new Date().toISOString() },
          { onConflict: 'client_id,ledger_head' },
        );
        if (mapErr) toast.error('Line saved, but the expense-head mapping could not be remembered: ' + mapErr.message);
      }

      toast.success('PL-Input line saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: Line) => {
    const { error } = await supabase.from('pl_input_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totals = (section: Section) => lines.filter((l) => l.section === section).reduce(
    (acc, r) => ({ taxable: acc.taxable + Number(r.taxable_value), igst: acc.igst + Number(r.igst), cgst: acc.cgst + Number(r.cgst), sgst: acc.sgst + Number(r.sgst) }),
    { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
  );
  const sections: Section[] = ['purchase', 'expense', 'capital_goods'];
  const grand = sections.reduce((acc, s) => { const t = totals(s); return { taxable: acc.taxable + t.taxable, igst: acc.igst + t.igst, cgst: acc.cgst + t.cgst, sgst: acc.sgst + t.sgst }; }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

  const renderTable = (section: Section) => {
    const rows = lines.filter((l) => l.section === section);
    const t = totals(section);
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ledger Head</TableHead>
            <TableHead className="w-20">Rate</TableHead>
            <TableHead className="text-right">Taxable Value</TableHead>
            <TableHead className="text-right">IGST</TableHead>
            <TableHead className="text-right">CGST</TableHead>
            <TableHead className="text-right">SGST</TableHead>
            {section === 'expense' && <TableHead>9C Head</TableHead>}
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && !(draft && draft.section === section && !draft.id) && (
            <TableRow><TableCell colSpan={section === 'expense' ? 7 : 6} className="text-center text-sm text-muted-foreground py-6">No lines yet.</TableCell></TableRow>
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
                {section === 'expense' && <TableCell>{row.expense_head ? <Badge variant="outline">{row.expense_head}</Badge> : <Badge variant="outline" className="border-dashed text-muted-foreground">Unmapped</Badge>}</TableCell>}
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
          {draft && draft.section === section && (
            <TableRow>
              <TableCell><Input value={draft.ledger_head} onChange={(e) => setDraft({ ...draft, ledger_head: e.target.value })} onBlur={onLedgerHeadBlur} placeholder="Ledger head" /></TableCell>
              <TableCell><Input value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} placeholder="18%" className="w-20" /></TableCell>
              <TableCell><Input type="number" value={draft.taxable_value} onChange={(e) => setDraft({ ...draft, taxable_value: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              <TableCell><Input type="number" value={draft.igst} onChange={(e) => setDraft({ ...draft, igst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              <TableCell><Input type="number" value={draft.cgst} onChange={(e) => setDraft({ ...draft, cgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              <TableCell><Input type="number" value={draft.sgst} onChange={(e) => setDraft({ ...draft, sgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              {section === 'expense' && (
                <TableCell>
                  <Select value={draft.expense_head || undefined} onValueChange={(v) => setDraft({ ...draft, expense_head: v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Select head" /></SelectTrigger>
                    <SelectContent>{EXPENSE_HEADS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              )}
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
              <TableCell colSpan={2}>Total {SECTION_LABEL[section]}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(t.taxable)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(t.igst)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(t.cgst)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(t.sgst)}</TableCell>
              {section === 'expense' && <TableCell />}
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
        <CardTitle className="text-lg">PL-INPUT</CardTitle>
        <CardDescription>Books purchases/ITC, annual, by ledger head — three sections, exactly as the sheet has them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((s) => (
          <div key={s}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">{SECTION_LABEL[s]}</h4>
              {!draft && <Button variant="outline" size="sm" onClick={() => startAdd(s)}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>}
            </div>
            {renderTable(s)}
          </div>
        ))}
        <div className="rounded-md border px-4 py-3 text-sm">
          <span className="text-muted-foreground">Total ITC as per P&amp;L: </span>
          <span className="font-medium text-foreground tabular-nums">{fmt(grand.taxable)}</span>
          <span className="text-muted-foreground"> taxable / </span>
          <span className="font-medium text-foreground tabular-nums">{fmt(grand.igst + grand.cgst + grand.sgst)}</span>
          <span className="text-muted-foreground"> tax</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default PLInputCard;
