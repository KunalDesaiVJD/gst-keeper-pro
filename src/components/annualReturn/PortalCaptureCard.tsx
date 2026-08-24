import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Pencil, Save, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

const NUMERIC_KEYS = [
  'turnover_taxable', 'turnover_igst', 'turnover_cgst', 'turnover_sgst',
  'outward_igst', 'outward_cgst', 'outward_sgst',
  'itc_igst', 'itc_cgst', 'itc_sgst',
  'itc2b_igst', 'itc2b_cgst', 'itc2b_sgst',
  'rcm_taxable', 'rcm_igst', 'rcm_cgst', 'rcm_sgst',
] as const;
type NumericKey = typeof NUMERIC_KEYS[number];
type MonthRow = { month: string; hasGstr1: boolean; hasGstr3b: boolean; hasGstr2b: boolean; hasRcm: boolean } & Record<NumericKey, number>;

const emptyMonth = (month: string): MonthRow => {
  const base = { month, hasGstr1: false, hasGstr3b: false, hasGstr2b: false, hasRcm: false } as MonthRow;
  NUMERIC_KEYS.forEach((k) => { base[k] = 0; });
  return base;
};

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v: string) => (v === '' ? 0 : Number(v));

const FIELD_GROUPS: { title: string; keys: NumericKey[] }[] = [
  { title: 'GSTR-1 turnover', keys: ['turnover_taxable', 'turnover_igst', 'turnover_cgst', 'turnover_sgst'] },
  { title: 'GSTR-3B outward tax', keys: ['outward_igst', 'outward_cgst', 'outward_sgst'] },
  { title: 'GSTR-3B ITC claimed', keys: ['itc_igst', 'itc_cgst', 'itc_sgst'] },
  { title: 'GSTR-2B ITC available', keys: ['itc2b_igst', 'itc2b_cgst', 'itc2b_sgst'] },
  { title: 'RCM (Part A — as per portal)', keys: ['rcm_taxable', 'rcm_igst', 'rcm_cgst', 'rcm_sgst'] },
];
const FIELD_LABEL: Record<string, string> = { turnover_taxable: 'Taxable', turnover_igst: 'IGST', turnover_cgst: 'CGST', turnover_sgst: 'SGST', outward_igst: 'IGST', outward_cgst: 'CGST', outward_sgst: 'SGST', itc_igst: 'IGST', itc_cgst: 'CGST', itc_sgst: 'SGST', itc2b_igst: 'IGST', itc2b_cgst: 'CGST', itc2b_sgst: 'SGST', rcm_taxable: 'Taxable', rcm_igst: 'IGST', rcm_cgst: 'CGST', rcm_sgst: 'SGST' };

interface Props { clientId: string; financialYear: string; }

/**
 * Phase 2 (R3) — month-wise "as filed on the portal" figures, now split by
 * tax head, with RCM Part A added. Stored on the existing gst_filed_returns
 * table as four return_type rows per month ('GSTR-1' | 'GSTR-3B' | 'GSTR-2B'
 * | 'RCM') rather than a new table. Table 6A/8A are the FY sum of the
 * months here, not separate fields — see the summary tiles below.
 */
export const PortalCaptureCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const months = monthsForFY(financialYear);
  const [data, setData] = useState<Record<string, MonthRow>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MonthRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setData({}); setLoading(false); return; }
    setLoading(true);
    const { data: rows, error } = await supabase.from('gst_filed_returns').select('period_month, return_type, summary').eq('client_id', clientId).in('period_month', months);
    if (error) { toast.error('Could not load portal figures: ' + error.message); setLoading(false); return; }
    const next: Record<string, MonthRow> = {};
    months.forEach((m) => { next[m] = emptyMonth(m); });
    (rows || []).forEach((r: { period_month: string; return_type: string; summary: Record<string, number> | null }) => {
      const bucket = next[r.period_month];
      if (!bucket) return;
      const s = r.summary || {};
      if (r.return_type === 'GSTR-1') {
        bucket.turnover_taxable = Number(s.turnover_taxable) || Number(s.turnover) || 0; // fallback for pre-R3 rows
        bucket.turnover_igst = Number(s.turnover_igst) || 0;
        bucket.turnover_cgst = Number(s.turnover_cgst) || 0;
        bucket.turnover_sgst = Number(s.turnover_sgst) || 0;
        bucket.hasGstr1 = true;
      } else if (r.return_type === 'GSTR-3B') {
        bucket.outward_igst = Number(s.outward_igst) || 0;
        bucket.outward_cgst = Number(s.outward_cgst) || 0;
        bucket.outward_sgst = Number(s.outward_sgst) || 0;
        bucket.itc_igst = Number(s.itc_igst) || 0;
        bucket.itc_cgst = Number(s.itc_cgst) || 0;
        bucket.itc_sgst = Number(s.itc_sgst) || 0;
        bucket.hasGstr3b = true;
      } else if (r.return_type === 'GSTR-2B') {
        bucket.itc2b_igst = Number(s.itc2b_igst) || Number(s.itc_available) || 0;
        bucket.itc2b_cgst = Number(s.itc2b_cgst) || 0;
        bucket.itc2b_sgst = Number(s.itc2b_sgst) || 0;
        bucket.hasGstr2b = true;
      } else if (r.return_type === 'RCM') {
        bucket.rcm_taxable = Number(s.rcm_taxable) || 0;
        bucket.rcm_igst = Number(s.rcm_igst) || 0;
        bucket.rcm_cgst = Number(s.rcm_cgst) || 0;
        bucket.rcm_sgst = Number(s.rcm_sgst) || 0;
        bucket.hasRcm = true;
      }
    });
    setData(next);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const upserts = [
        { client_id: clientId, period_month: editing.month, return_type: 'GSTR-1', summary: { turnover_taxable: editing.turnover_taxable, turnover_igst: editing.turnover_igst, turnover_cgst: editing.turnover_cgst, turnover_sgst: editing.turnover_sgst }, updated_at: now },
        { client_id: clientId, period_month: editing.month, return_type: 'GSTR-3B', summary: { outward_igst: editing.outward_igst, outward_cgst: editing.outward_cgst, outward_sgst: editing.outward_sgst, itc_igst: editing.itc_igst, itc_cgst: editing.itc_cgst, itc_sgst: editing.itc_sgst }, updated_at: now },
        { client_id: clientId, period_month: editing.month, return_type: 'GSTR-2B', summary: { itc2b_igst: editing.itc2b_igst, itc2b_cgst: editing.itc2b_cgst, itc2b_sgst: editing.itc2b_sgst }, updated_at: now },
        { client_id: clientId, period_month: editing.month, return_type: 'RCM', summary: { rcm_taxable: editing.rcm_taxable, rcm_igst: editing.rcm_igst, rcm_cgst: editing.rcm_cgst, rcm_sgst: editing.rcm_sgst }, updated_at: now },
      ];
      const { error } = await supabase.from('gst_filed_returns').upsert(upserts, { onConflict: 'client_id,period_month,return_type' });
      if (error) throw error;
      toast.success(`${editing.month} portal figures saved.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const confirmedCount = months.filter((m) => data[m]?.hasGstr1 && data[m]?.hasGstr3b && data[m]?.hasGstr2b).length;
  const table6A = months.reduce((sum, m) => sum + (data[m]?.hasGstr3b ? data[m].itc_igst + data[m].itc_cgst + data[m].itc_sgst : 0), 0);
  const table8A = months.reduce((sum, m) => sum + (data[m]?.hasGstr2b ? data[m].itc2b_igst + data[m].itc2b_cgst + data[m].itc2b_sgst : 0), 0);
  const allConfirmed = confirmedCount === months.length;

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${allConfirmed ? 'bg-success/5 border-success/20 text-success' : 'bg-warning/5 border-warning/20 text-warning'}`}>
        {allConfirmed && <CheckCircle2 className="h-4 w-4 shrink-0" />}
        {confirmedCount} of {months.length} months confirmed
        {!allConfirmed && ' — figures for the rest still need entry before this year can rely on them.'}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="mb-0"><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Table 6A · Total ITC via GSTR-3B</div>
          <div className="flex items-baseline justify-between"><div className="text-xl font-semibold font-heading tabular-nums">{fmt(table6A)}</div><Badge variant={allConfirmed ? 'success' : 'warning'}>{allConfirmed ? 'Complete' : 'Partial'}</Badge></div>
        </CardContent></Card>
        <Card className="mb-0"><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Table 8A · ITC as per GSTR-2B</div>
          <div className="flex items-baseline justify-between"><div className="text-xl font-semibold font-heading tabular-nums">{fmt(table8A)}</div><Badge variant={allConfirmed ? 'success' : 'warning'}>{allConfirmed ? 'Complete' : 'Partial'}</Badge></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Month-wise return figures</CardTitle>
          <CardDescription>GSTR-1 turnover, GSTR-3B outward tax &amp; ITC claimed, GSTR-2B ITC available, and RCM Part A — all IGST/CGST/SGST split.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">GSTR-1 Turnover</TableHead>
                <TableHead className="text-right">3B Outward</TableHead>
                <TableHead className="text-right">3B ITC</TableHead>
                <TableHead className="text-right">2B ITC</TableHead>
                <TableHead className="text-right">RCM</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => {
                const r = data[m] || emptyMonth(m);
                const confirmed = r.hasGstr1 && r.hasGstr3b && r.hasGstr2b;
                return (
                  <TableRow key={m}>
                    <TableCell className="font-medium">{m}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.turnover_taxable)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.outward_igst + r.outward_cgst + r.outward_sgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.itc_igst + r.itc_cgst + r.itc_sgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.itc2b_igst + r.itc2b_cgst + r.itc2b_sgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.rcm_igst + r.rcm_cgst + r.rcm_sgst)}</TableCell>
                    <TableCell><Badge variant={confirmed ? 'success' : 'outline'} className={confirmed ? '' : 'border-dashed text-muted-foreground'}>{confirmed ? 'Confirmed' : 'Needs entry'}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(r)} aria-label={`Edit ${m}`}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.month} — Portal figures</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {FIELD_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</div>
                  {group.keys.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">{FIELD_LABEL[key]}</span>
                      <Input type="number" className="w-40 text-right" value={String(editing[key])} onChange={(e) => setEditing({ ...editing, [key]: num(e.target.value) })} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalCaptureCard;
