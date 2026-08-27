import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchGstr9cTable5TurnoverReco, computeGstr9cTable5P, type Table5RowKey } from '@/lib/annualReturnAggregates';

const TOLERANCE = 10;
const REASON_LINE_KEY = 'gstr9c_table6_gross_turnover';

const ROW_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
type RowKey = typeof ROW_KEYS[number];

const ROW_LABEL: Record<RowKey, string> = {
  A: 'Turnover (incl. exports) as per Audited Financial Statement',
  B: 'Unbilled revenue at the beginning of the Financial Year (+)',
  C: 'Unadjusted advances at the end of the Financial Year (+)',
  D: 'Deemed Supply under Schedule I (+)',
  E: 'Credit Notes issued after the end of the FY but reflected in the annual return (−)',
  F: 'Trade Discounts accounted for in the financials but not permissible under GST (+)',
  G: 'Turnover from April 2017 to June 2017 (−)',
  H: 'Unbilled revenue as at the end of the Financial Year (−)',
  I: 'Unadjusted Advances as at the beginning of the Financial Year (−)',
  J: 'Credit notes accounted for in the financials but not permissible under GST (+)',
  K: 'Adjustments on account of supply of goods by SEZ units to DTA Units (−)',
  L: 'Turnover for the period under composition scheme (−)',
  M: 'Adjustments in turnover under section 15 and rules thereunder (+)',
  N: 'Adjustments in Turnover due to foreign exchange fluctuation (+)',
  O: 'Adjustment in Turnover due to reasons not listed above (+)',
};

type Rows = Record<RowKey, string>;
const emptyRows = (): Rows => { const r = {} as Rows; ROW_KEYS.forEach((k) => { r[k] = '0'; }); return r; };
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9C TABLE 5 — Reconciliation of Gross Turnover, plus Table 6's
 * reason for the unreconciled difference. Verified field-by-field against
 * the real GSTR_9C_Offline_Utility.xlsm (v2.8), sheet "PT II (5)"/"(6)",
 * 27 Aug 2026. Q ("Turnover as per GSTR9") is kept manual — see the
 * migration's note on why it isn't auto-linked to this app's existing
 * GSTR-9 Table 4/5 view.
 */
export const Gstr9cTable5TurnoverRecoCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Rows>(emptyRows());
  const [q, setQ] = useState('0');
  const [reason, setReason] = useState('');
  const [savedReason, setSavedReason] = useState('');
  const [dirty, setDirty] = useState<Record<RowKey | 'Q', boolean>>({} as Record<RowKey | 'Q', boolean>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows(emptyRows()); setQ('0'); setLoading(false); return; }
    setLoading(true);
    try {
      const [data, reasonRes] = await Promise.all([
        fetchGstr9cTable5TurnoverReco(clientId, financialYear),
        supabase.from('reconciliation_reasons').select('reason').eq('client_id', clientId).eq('financial_year', financialYear).eq('line_key', REASON_LINE_KEY).maybeSingle(),
      ]);
      const next = emptyRows();
      ROW_KEYS.forEach((k) => { next[k] = String(data[k]); });
      setRows(next);
      setQ(String(data.Q));
      setReason(reasonRes.data?.reason || '');
      setSavedReason(reasonRes.data?.reason || '');
      setDirty({} as Record<RowKey | 'Q', boolean>);
    } catch (err) {
      toast.error('Could not load Table 5: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (k: RowKey, v: string) => { setRows((prev) => ({ ...prev, [k]: v })); setDirty((prev) => ({ ...prev, [k]: true })); };
  const updateQ = (v: string) => { setQ(v); setDirty((prev) => ({ ...prev, Q: true })); };

  const rowAmounts = { ...Object.fromEntries(ROW_KEYS.map((k) => [k, num(rows[k])])), Q: num(q) } as Record<Table5RowKey, number>;
  const p = computeGstr9cTable5P(rowAmounts);
  const r = num(q) - p;
  const reasonDirty = reason !== savedReason;
  const dirtyRowKeys = (Object.keys(dirty) as (RowKey | 'Q')[]).filter((k) => dirty[k]);

  const saveAll = async () => {
    if (dirtyRowKeys.length === 0 && !reasonDirty) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (dirtyRowKeys.length > 0) {
        const payload = dirtyRowKeys.map((k) => ({
          client_id: clientId, financial_year: financialYear, row_key: k,
          amount: k === 'Q' ? num(q) : num(rows[k as RowKey]), updated_at: now,
        }));
        const { error } = await supabase.from('gstr9c_table5_turnover_reco').upsert(payload, { onConflict: 'client_id,financial_year,row_key' });
        if (error) throw error;
      }
      if (reasonDirty) {
        const { error } = await supabase.from('reconciliation_reasons').upsert(
          { client_id: clientId, financial_year: financialYear, line_key: REASON_LINE_KEY, reason: reason.trim(), entered_by: user?.id || null, updated_at: now },
          { onConflict: 'client_id,financial_year,line_key' },
        );
        if (error) throw error;
        setSavedReason(reason.trim());
      }
      toast.success('Table 5 saved.');
      setDirty({} as Record<RowKey | 'Q', boolean>);
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const dirtyCount = dirtyRowKeys.length + (reasonDirty ? 1 : 0);

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">TABLE 5 — Reconciliation of Gross Turnover</CardTitle>
        <CardDescription>Audited financials vs. GSTR-9 — matches the offline utility's Part II(5) exactly.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center gap-2 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">TABLE 5 — Reconciliation of Gross Turnover</CardTitle>
          <CardDescription>Audited financials vs. GSTR-9 — matches the offline utility's Part II(5) exactly.</CardDescription>
        </div>
        <Button size="sm" disabled={saving || dirtyCount === 0} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-40">Amount (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">A</TableCell>
              <TableCell className="text-sm font-medium">{ROW_LABEL.A}</TableCell>
              <TableCell><Input type="number" className="text-right h-8" value={rows.A} disabled={saving} onChange={(e) => updateRow('A', e.target.value)} aria-label={ROW_LABEL.A} /></TableCell>
            </TableRow>
            {ROW_KEYS.filter((k) => k !== 'A').map((k) => (
              <TableRow key={k}>
                <TableCell className="font-medium text-muted-foreground">{k}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{ROW_LABEL[k]}</TableCell>
                <TableCell><Input type="number" className="text-right h-8" value={rows[k]} disabled={saving} onChange={(e) => updateRow(k, e.target.value)} aria-label={ROW_LABEL[k]} /></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">Q</TableCell>
              <TableCell className="text-sm font-medium">Turnover as declared in Annual Return (GSTR-9)</TableCell>
              <TableCell><Input type="number" className="text-right h-8" value={q} disabled={saving} onChange={(e) => updateQ(e.target.value)} aria-label="Turnover as declared in Annual Return GSTR9" /></TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>P — Annual Turnover after adjustments (A+B+C+D−E+F−G−H−I+J−K−L+M+N+O)</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{fmt(p)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={2}>R — Un-Reconciled turnover (Q − P)</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {fmt(r)}{' '}
                <Badge variant={Math.abs(r) <= TOLERANCE ? 'success' : 'destructive'} className="ml-1 text-[10px] align-middle">
                  {Math.abs(r) <= TOLERANCE ? 'Matched' : 'Needs a reason'}
                </Badge>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {Math.abs(r) > TOLERANCE && (
          <div className="p-4 border-t space-y-2">
            <div className="text-sm font-medium">Table 6 — Reason for the Un-Reconciled difference</div>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does the turnover not reconcile?" rows={3} disabled={saving} className="text-sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Gstr9cTable5TurnoverRecoCard;
