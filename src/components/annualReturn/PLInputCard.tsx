import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardPaste, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PasteFromExcelDialog, PasteImportResult } from './PasteFromExcelDialog';

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

// Every row is always its own editable form. `key` is a stable React/dirty-
// tracking key: the real DB id for a row loaded from the database, or a
// client-side `new-<uuid>` for a row added via "Add line" and never saved.
// `id` is only set once the row actually exists in the database.
interface EditableRow {
  key: string;
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

const lineToRow = (l: Line): EditableRow => ({
  key: l.id, id: l.id, section: l.section, ledger_head: l.ledger_head, expense_head: l.expense_head || '',
  rate: l.rate || '', taxable_value: String(l.taxable_value), igst: String(l.igst), cgst: String(l.cgst), sgst: String(l.sgst),
});

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
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteSection, setPasteSection] = useState<Section | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setRows([]); setDirty(new Set()); setLoading(false); return; }
    setLoading(true);
    const [linesRes, mapRes] = await Promise.all([
      supabase.from('pl_input_lines').select('id, section, ledger_head, expense_head, rate, taxable_value, igst, cgst, sgst')
        .eq('client_id', clientId).eq('financial_year', financialYear).order('created_at', { ascending: true }),
      supabase.from('expense_head_mappings').select('ledger_head, expense_head').eq('client_id', clientId),
    ]);
    if (linesRes.error) toast.error('Could not load PL-Input: ' + linesRes.error.message);
    setRows(((linesRes.data || []) as Line[]).map(lineToRow));
    setDirty(new Set());
    const m: Record<string, string> = {};
    (mapRes.data || []).forEach((r: { ledger_head: string; expense_head: string }) => { m[r.ledger_head] = r.expense_head; });
    setMappings(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDirty = (key: string) => setDirty((prev) => { const next = new Set(prev); next.add(key); return next; });

  const updateRow = (key: string, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    markDirty(key);
  };

  const addLine = (section: Section) => {
    const key = `new-${crypto.randomUUID()}`;
    const row: EditableRow = { key, section, ledger_head: '', expense_head: SECTION_DEFAULT_HEAD[section] || '', rate: '', taxable_value: '', igst: '', cgst: '', sgst: '' };
    setRows((prev) => [...prev, row]);
    markDirty(key);
  };

  const handlePasteImport = (section: Section) => (pasted: string[][]): PasteImportResult => {
    const newRows: EditableRow[] = [];
    const warnings: string[] = [];
    const cleanNum = (v: string | undefined) => {
      if (!v || !v.trim()) return 0;
      const n = Number(v.replace(/[₹,\s]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    pasted.forEach((cells, i) => {
      const rowNum = i + 1;
      const isBlank = cells.every((c) => !c || !c.trim());
      if (isBlank) { warnings.push(`Row ${rowNum}: empty row skipped.`); return; }

      const [ledgerHeadRaw, rateRaw, taxableRaw, igstRaw, cgstRaw, sgstRaw, expenseHeadRaw] = cells;
      const ledgerHead = (ledgerHeadRaw || '').trim();
      if (!ledgerHead) { warnings.push(`Row ${rowNum}: Ledger Head is required.`); return; }

      let expenseHead: string;
      if (section === 'expense') {
        const raw = (expenseHeadRaw || '').trim();
        if (raw) {
          const match = EXPENSE_HEADS.find((h) => h.toLowerCase() === raw.toLowerCase());
          if (!match) { warnings.push(`Row ${rowNum}: "${raw}" is not a recognized 9C Head.`); return; }
          expenseHead = match;
        } else {
          expenseHead = mappings[ledgerHead] || '';
        }
      } else {
        expenseHead = SECTION_DEFAULT_HEAD[section] || '';
      }

      newRows.push({
        key: `new-${crypto.randomUUID()}`,
        section,
        ledger_head: ledgerHead,
        expense_head: expenseHead,
        rate: (rateRaw || '').trim(),
        taxable_value: String(cleanNum(taxableRaw)),
        igst: String(cleanNum(igstRaw)),
        cgst: String(cleanNum(cgstRaw)),
        sgst: String(cleanNum(sgstRaw)),
      });
    });

    if (newRows.length > 0) {
      setRows((prev) => [...prev, ...newRows]);
      setDirty((prev) => { const next = new Set(prev); newRows.forEach((r) => next.add(r.key)); return next; });
    }

    const result: PasteImportResult = { imported: newRows.length, skipped: warnings.length, warnings };
    const summary = `Imported ${result.imported} row${result.imported === 1 ? '' : 's'}.${result.skipped > 0 ? ` ${result.skipped} skipped — see below:` : ''}`;
    const detail = warnings.slice(0, 3).join(' ');
    if (result.skipped > 0) {
      toast.error(`${summary} ${detail}`, { duration: 10000 });
    } else {
      toast.success(summary);
    }
    return result;
  };

  const onLedgerHeadBlur = (row: EditableRow) => {
    if (row.section !== 'expense' || row.expense_head || !row.ledger_head.trim()) return;
    const suggestion = mappings[row.ledger_head.trim()];
    if (suggestion) updateRow(row.key, { expense_head: suggestion });
  };

  const saveAll = async () => {
    const dirtyRows = rows.filter((r) => dirty.has(r.key));
    if (dirtyRows.length === 0) return;

    for (const r of dirtyRows) {
      if (!r.ledger_head.trim()) {
        const sectionRows = rows.filter((x) => x.section === r.section);
        const rowNum = sectionRows.findIndex((x) => x.key === r.key) + 1;
        toast.error(`Ledger head is required — ${SECTION_LABEL[r.section]}, row ${rowNum}.`);
        return;
      }
    }

    setSaving(true);
    try {
      const toPayload = (r: EditableRow) => {
        const ledgerHead = r.ledger_head.trim();
        const expenseHead = r.section === 'expense' ? (r.expense_head || null) : SECTION_DEFAULT_HEAD[r.section];
        return {
          client_id: clientId, financial_year: financialYear, section: r.section,
          ledger_head: ledgerHead, expense_head: expenseHead, rate: r.rate.trim() || null,
          taxable_value: num(r.taxable_value), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst),
          updated_at: new Date().toISOString(),
        };
      };

      const newRows = dirtyRows.filter((r) => !r.id);
      const existingRows = dirtyRows.filter((r) => r.id);

      if (newRows.length > 0) {
        const { error } = await supabase.from('pl_input_lines').insert(newRows.map(toPayload));
        if (error) throw new Error('new lines: ' + error.message);
      }
      if (existingRows.length > 0) {
        const { error } = await supabase.from('pl_input_lines').upsert(
          existingRows.map((r) => ({ id: r.id, ...toPayload(r) })),
          { onConflict: 'id' },
        );
        if (error) throw new Error('existing lines: ' + error.message);
      }

      const mapUpserts = dirtyRows
        .filter((r) => r.section === 'expense' && r.expense_head && r.ledger_head.trim())
        .map((r) => ({ client_id: clientId, ledger_head: r.ledger_head.trim(), expense_head: r.expense_head, updated_at: new Date().toISOString() }));
      if (mapUpserts.length > 0) {
        const { error: mapErr } = await supabase.from('expense_head_mappings').upsert(mapUpserts, { onConflict: 'client_id,ledger_head' });
        if (mapErr) toast.error('Lines saved, but the expense-head mappings could not be remembered: ' + mapErr.message);
      }

      toast.success(`${dirtyRows.length} PL-Input line${dirtyRows.length > 1 ? 's' : ''} saved.`);
      setDirty(new Set());
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: EditableRow) => {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setDirty((prev) => { const next = new Set(prev); next.delete(row.key); return next; });
      return;
    }
    const { error } = await supabase.from('pl_input_lines').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success('Line removed.');
    load();
  };

  const totals = (section: Section) => rows.filter((r) => r.section === section).reduce(
    (acc, r) => ({ taxable: acc.taxable + num(r.taxable_value), igst: acc.igst + num(r.igst), cgst: acc.cgst + num(r.cgst), sgst: acc.sgst + num(r.sgst) }),
    { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
  );
  const sections: Section[] = ['purchase', 'expense', 'capital_goods'];
  const grand = sections.reduce((acc, s) => { const t = totals(s); return { taxable: acc.taxable + t.taxable, igst: acc.igst + t.igst, cgst: acc.cgst + t.cgst, sgst: acc.sgst + t.sgst }; }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

  const renderTable = (section: Section) => {
    const rowsForSection = rows.filter((r) => r.section === section);
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
          {rowsForSection.length === 0 && (
            <TableRow><TableCell colSpan={section === 'expense' ? 7 : 6} className="text-center text-sm text-muted-foreground py-6">No lines yet.</TableCell></TableRow>
          )}
          {rowsForSection.map((row) => (
            <TableRow key={row.key}>
              <TableCell><Input value={row.ledger_head} onChange={(e) => updateRow(row.key, { ledger_head: e.target.value })} onBlur={() => onLedgerHeadBlur(row)} placeholder="Ledger head" /></TableCell>
              <TableCell><Input value={row.rate} onChange={(e) => updateRow(row.key, { rate: e.target.value })} placeholder="18%" className="w-20" /></TableCell>
              <TableCell><Input type="number" value={row.taxable_value} onChange={(e) => updateRow(row.key, { taxable_value: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              <TableCell><Input type="number" value={row.igst} onChange={(e) => updateRow(row.key, { igst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              <TableCell><Input type="number" value={row.cgst} onChange={(e) => updateRow(row.key, { cgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              <TableCell><Input type="number" value={row.sgst} onChange={(e) => updateRow(row.key, { sgst: e.target.value })} placeholder="0" className="text-right" /></TableCell>
              {section === 'expense' && (
                <TableCell>
                  <Select value={row.expense_head || undefined} onValueChange={(v) => updateRow(row.key, { expense_head: v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Select head" /></SelectTrigger>
                    <SelectContent>{EXPENSE_HEADS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              )}
              <TableCell>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label={`Delete ${row.ledger_head || 'line'}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {rowsForSection.length > 0 && (
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
    <>
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">PL-INPUT</CardTitle>
            <CardDescription>Books purchases/ITC, annual, by ledger head — three sections, exactly as the sheet has them.</CardDescription>
          </div>
          <Button size="sm" onClick={saveAll} disabled={saving || dirty.size === 0}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save changes{dirty.size > 0 ? ` (${dirty.size})` : ''}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((s) => (
          <div key={s}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">{SECTION_LABEL[s]}</h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPasteSection(s)}><ClipboardPaste className="h-3.5 w-3.5 mr-1.5" /> Paste from Excel</Button>
                <Button variant="outline" size="sm" onClick={() => addLine(s)}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add line</Button>
              </div>
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
    {pasteSection && (
      <PasteFromExcelDialog
        open={!!pasteSection}
        onOpenChange={(o) => { if (!o) setPasteSection(null); }}
        title={`Paste ${SECTION_LABEL[pasteSection]} lines from Excel`}
        columnLabels={pasteSection === 'expense'
          ? ['Ledger Head', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', '9C Head']
          : ['Ledger Head', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST']}
        onImport={handlePasteImport(pasteSection)}
      />
    )}
    </>
  );
};

export default PLInputCard;
