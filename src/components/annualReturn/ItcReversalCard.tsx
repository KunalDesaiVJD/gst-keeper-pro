import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const RULES = ['37', '37A', '38', '39', '42', '43', '17_5'] as const;
const RULE_LABEL: Record<string, string> = {
  '37': 'Rule 37 (180-day payment)', '37A': 'Rule 37A', '38': 'Rule 38', '39': 'Rule 39',
  '42': 'Rule 42', '43': 'Rule 43', '17_5': 'Section 17(5) — ineligible ITC',
};

interface Row { rule: string; igst: string; cgst: string; sgst: string; }
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9 Table 7 — rule-wise ITC reversals. Added in R6 to close the gap R4
 * flagged: this figure genuinely didn't exist anywhere in the schema before,
 * and GSTR 9-Input's Table 7J previously showed it as "not captured" rather
 * than a real number.
 */
export const ItcReversalCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({}); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('itc_reversal_lines').select('rule, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load ITC reversals: ' + error.message); setLoading(false); return; }
    const next: Record<string, Row> = {};
    RULES.forEach((r) => { next[r] = { rule: r, igst: '0', cgst: '0', sgst: '0' }; });
    (data || []).forEach((r: { rule: string; igst: number; cgst: number; sgst: number }) => {
      next[r.rule] = { rule: r.rule, igst: String(r.igst), cgst: String(r.cgst), sgst: String(r.sgst) };
    });
    setRows(next);
    setDirty({});
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (rule: string, field: keyof Row, value: string) => {
    setRows((prev) => ({ ...prev, [rule]: { ...prev[rule], [field]: value } }));
    setDirty((prev) => ({ ...prev, [rule]: true }));
  };

  const dirtyRules = RULES.filter((r) => dirty[r]);

  const saveAll = async () => {
    if (dirtyRules.length === 0) return;
    setSaving(true);
    try {
      const payload = dirtyRules.map((rule) => {
        const r = rows[rule];
        return { client_id: clientId, financial_year: financialYear, rule, igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst), updated_at: new Date().toISOString() };
      });
      const { error } = await supabase.from('itc_reversal_lines').upsert(payload, { onConflict: 'client_id,financial_year,rule' });
      if (error) throw error;
      toast.success(`${dirtyRules.length} row${dirtyRules.length === 1 ? '' : 's'} saved.`);
      setDirty((prev) => {
        const next = { ...prev };
        dirtyRules.forEach((rule) => { next[rule] = false; });
        return next;
      });
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const totals = RULES.reduce((acc, r) => {
    const row = rows[r];
    if (!row) return acc;
    return { igst: acc.igst + num(row.igst), cgst: acc.cgst + num(row.cgst), sgst: acc.sgst + num(row.sgst) };
  }, { igst: 0, cgst: 0, sgst: 0 });

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-lg">GSTR-9 Table 7 — ITC Reversed &amp; Ineligible</CardTitle>
          <CardDescription>Rule-wise, for the financial year. Feeds Table 7J and GSTR 9C Table 14.</CardDescription>
        </div>
        <Button size="sm" disabled={dirtyRules.length === 0 || saving} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyRules.length > 0 ? ` (${dirtyRules.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead className="text-right">IGST</TableHead>
              <TableHead className="text-right">CGST</TableHead>
              <TableHead className="text-right">SGST</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RULES.map((r) => {
              const row = rows[r] || { rule: r, igst: '0', cgst: '0', sgst: '0' };
              return (
                <TableRow key={r}>
                  <TableCell className="font-medium">{RULE_LABEL[r]}</TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={row.igst} disabled={saving} onChange={(e) => update(r, 'igst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={row.cgst} disabled={saving} onChange={(e) => update(r, 'cgst', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right h-8" value={row.sgst} disabled={saving} onChange={(e) => update(r, 'sgst', e.target.value)} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.igst)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.cgst)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totals.sgst)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
};

export default ItcReversalCard;
