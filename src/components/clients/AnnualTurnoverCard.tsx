import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface TurnoverRow {
  id: string;
  financial_year: string;
  aggregate_turnover: number | null;
  exempt_turnover: number | null;
  itc_directly_attributable_exempt: number | null;
}

interface AnnualTurnoverCardProps {
  clientId: string;
}

// Current FY (Apr-Mar) plus the previous 2 and next 1 — covers what staff
// actually need to enter without an open-ended year picker.
const fyOptions = (): string[] => {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // getMonth() 3 = April
  const years: string[] = [];
  for (let i = -2; i <= 1; i++) {
    const y = startYear + i;
    years.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return years;
};

/**
 * Feeds the Phase-4 interest/late-fee and Rule 42 ITC-reversal reports —
 * see docs/INTEREST_LATE_FEE_POSITIONS.md for exactly how aggregate/exempt
 * turnover and the optional T1 figure are used. Nothing else in this app
 * tracks turnover, so this is entered by hand, one row per financial year.
 */
export const AnnualTurnoverCard: React.FC<AnnualTurnoverCardProps> = ({ clientId }) => {
  const [rows, setRows] = useState<TurnoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ fy: string; aggregate: string; exempt: string; t1: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('client_annual_turnover')
      .select('id, financial_year, aggregate_turnover, exempt_turnover, itc_directly_attributable_exempt')
      .eq('client_id', clientId)
      .order('financial_year', { ascending: false });
    if (error) toast.error('Could not load turnover data: ' + error.message);
    setRows((data || []) as TurnoverRow[]);
    setLoading(false);
  };

  useEffect(() => { if (clientId) load(); }, [clientId]);

  const startAdd = () => {
    const used = new Set(rows.map((r) => r.financial_year));
    const next = fyOptions().find((fy) => !used.has(fy)) || fyOptions()[0];
    setDraft({ fy: next, aggregate: '', exempt: '', t1: '' });
  };

  const startEdit = (row: TurnoverRow) => {
    setDraft({
      fy: row.financial_year,
      aggregate: row.aggregate_turnover != null ? String(row.aggregate_turnover) : '',
      exempt: row.exempt_turnover != null ? String(row.exempt_turnover) : '',
      t1: row.itc_directly_attributable_exempt != null ? String(row.itc_directly_attributable_exempt) : '',
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('client_annual_turnover').upsert({
        client_id: clientId,
        financial_year: draft.fy,
        aggregate_turnover: draft.aggregate === '' ? null : Number(draft.aggregate),
        exempt_turnover: draft.exempt === '' ? null : Number(draft.exempt),
        itc_directly_attributable_exempt: draft.t1 === '' ? null : Number(draft.t1),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,financial_year' });
      if (error) throw error;
      toast.success(`Turnover saved for FY ${draft.fy}.`);
      setDraft(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Save failed: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: TurnoverRow) => {
    const { error } = await supabase.from('client_annual_turnover').delete().eq('id', row.id);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success(`FY ${row.financial_year} turnover removed.`);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Annual Turnover</CardTitle>
            <CardDescription>
              Feeds the Interest/Late Fee and Rule 42 ITC-reversal reports (late-fee turnover slab, Rule 42 exempt-turnover ratio). Not used anywhere else in the app.
            </CardDescription>
          </div>
          {!draft && (
            <Button variant="outline" size="sm" onClick={startAdd}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Year
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
                <TableHead>Financial Year</TableHead>
                <TableHead className="text-right">Aggregate Turnover</TableHead>
                <TableHead className="text-right">Exempt Turnover</TableHead>
                <TableHead className="text-right">ITC excl. to Exempt (T1)</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !draft && (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No turnover on record yet.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                draft?.fy === row.financial_year ? null : (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">FY {row.financial_year}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.aggregate_turnover != null ? row.aggregate_turnover.toLocaleString('en-IN') : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.exempt_turnover != null ? row.exempt_turnover.toLocaleString('en-IN') : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.itc_directly_attributable_exempt != null ? row.itc_directly_attributable_exempt.toLocaleString('en-IN') : '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>Edit</Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRow(row)} aria-label={`Delete FY ${row.financial_year}`}>
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
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={draft.fy}
                      onChange={(e) => setDraft({ ...draft, fy: e.target.value })}
                    >
                      {fyOptions().map((fy) => <option key={fy} value={fy}>FY {fy}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={draft.aggregate} onChange={(e) => setDraft({ ...draft, aggregate: e.target.value })} placeholder="0" className="text-right" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={draft.exempt} onChange={(e) => setDraft({ ...draft, exempt: e.target.value })} placeholder="0" className="text-right" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={draft.t1} onChange={(e) => setDraft({ ...draft, t1: e.target.value })} placeholder="0 (optional)" className="text-right" />
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
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default AnnualTurnoverCard;
