import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

interface MonthFigures {
  turnover: string;
  outwardTax: string;
  itcClaimed: string;
  itcAvailable: string;
  hasGstr1: boolean;
  hasGstr3b: boolean;
  hasGstr2b: boolean;
}

const EMPTY: MonthFigures = { turnover: '', outwardTax: '', itcClaimed: '', itcAvailable: '', hasGstr1: false, hasGstr3b: false, hasGstr2b: false };

const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props {
  clientId: string;
  financialYear: string;
}

interface FiledRow {
  period_month: string;
  return_type: string;
  summary: Record<string, number> | null;
}

/**
 * Phase 2 of the Annual Return roadmap — month-wise "as filed on the
 * portal" figures. Reuses gst_filed_returns (added 21 Aug 2026 for a
 * different purpose, unused until now) rather than a new table: one row
 * per (client, month, return_type — 'GSTR-1' / 'GSTR-3B' / 'GSTR-2B').
 *
 * Table 6A (total ITC via 3B) and Table 8A (ITC per 2B) aren't separate
 * entry fields — they're just the FY sum of the monthly figures captured
 * here, so a hardcoded annual figure never has to agree with 12 monthly
 * ones by coincidence.
 */
export const PortalCaptureCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const months = useMemo(() => monthsForFY(financialYear), [financialYear]);
  const [data, setData] = useState<Record<string, MonthFigures>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingMonth, setSavingMonth] = useState<string | null>(null);

  const load = async () => {
    if (!clientId || !financialYear) { setData({}); setLoading(false); return; }
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('gst_filed_returns')
      .select('period_month, return_type, summary')
      .eq('client_id', clientId)
      .in('period_month', months);
    if (error) { toast.error('Could not load portal figures: ' + error.message); setLoading(false); return; }

    const next: Record<string, MonthFigures> = {};
    months.forEach((m) => { next[m] = { ...EMPTY }; });
    (rows as FiledRow[] || []).forEach((r) => {
      const bucket = next[r.period_month];
      if (!bucket) return;
      const s = r.summary || {};
      if (r.return_type === 'GSTR-1') {
        bucket.turnover = s.turnover != null ? String(s.turnover) : '';
        bucket.hasGstr1 = true;
      } else if (r.return_type === 'GSTR-3B') {
        bucket.outwardTax = s.outward_tax != null ? String(s.outward_tax) : '';
        bucket.itcClaimed = s.itc_claimed != null ? String(s.itc_claimed) : '';
        bucket.hasGstr3b = true;
      } else if (r.return_type === 'GSTR-2B') {
        bucket.itcAvailable = s.itc_available != null ? String(s.itc_available) : '';
        bucket.hasGstr2b = true;
      }
    });
    setData(next);
    setDirty({});
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = (month: string, field: keyof MonthFigures, value: string) => {
    setData((prev) => ({ ...prev, [month]: { ...prev[month], [field]: value } }));
    setDirty((prev) => ({ ...prev, [month]: true }));
  };

  const saveMonth = async (month: string) => {
    const row = data[month];
    if (!row) return;
    setSavingMonth(month);
    try {
      const now = new Date().toISOString();
      const upserts = [
        { client_id: clientId, period_month: month, return_type: 'GSTR-1', summary: { turnover: num(row.turnover) }, updated_at: now },
        { client_id: clientId, period_month: month, return_type: 'GSTR-3B', summary: { outward_tax: num(row.outwardTax), itc_claimed: num(row.itcClaimed) }, updated_at: now },
        { client_id: clientId, period_month: month, return_type: 'GSTR-2B', summary: { itc_available: num(row.itcAvailable) }, updated_at: now },
      ];
      const { error } = await supabase.from('gst_filed_returns').upsert(upserts, { onConflict: 'client_id,period_month,return_type' });
      if (error) throw error;
      toast.success(`${month} portal figures saved.`);
      setDirty((prev) => ({ ...prev, [month]: false }));
      setData((prev) => ({ ...prev, [month]: { ...prev[month], hasGstr1: true, hasGstr3b: true, hasGstr2b: true } }));
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSavingMonth(null);
    }
  };

  const confirmedCount = months.filter((m) => data[m]?.hasGstr1 && data[m]?.hasGstr3b && data[m]?.hasGstr2b).length;
  const table6A = months.reduce((sum, m) => sum + (data[m]?.hasGstr3b ? num(data[m].itcClaimed) : 0), 0);
  const table8A = months.reduce((sum, m) => sum + (data[m]?.hasGstr2b ? num(data[m].itcAvailable) : 0), 0);
  const allConfirmed = confirmedCount === months.length;

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${allConfirmed ? 'bg-success/5 border-success/20 text-success' : 'bg-warning/5 border-warning/20 text-warning'}`}>
        {allConfirmed ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Loader2 className={`h-4 w-4 shrink-0 ${loading ? 'animate-spin' : 'opacity-0'}`} />}
        {loading ? 'Loading…' : `${confirmedCount} of ${months.length} months confirmed`}
        {!loading && !allConfirmed && ' — figures for the rest still need entry before this year can rely on them.'}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="mb-0">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Table 6A · Total ITC via GSTR-3B</div>
            <div className="flex items-baseline justify-between">
              <div className="text-xl font-semibold font-heading tabular-nums">{fmt(table6A)}</div>
              <Badge variant={allConfirmed ? 'success' : 'warning'}>{allConfirmed ? 'Complete' : 'Partial'}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card className="mb-0">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Table 8A · ITC as per GSTR-2B</div>
            <div className="flex items-baseline justify-between">
              <div className="text-xl font-semibold font-heading tabular-nums">{fmt(table8A)}</div>
              <Badge variant={allConfirmed ? 'success' : 'warning'}>{allConfirmed ? 'Complete' : 'Partial'}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Month-wise return figures</CardTitle>
          <CardDescription>GSTR-1 turnover, GSTR-3B outward tax &amp; ITC claimed, and ITC as per GSTR-2B — as actually filed.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">GSTR-1 Turnover</TableHead>
                  <TableHead className="text-right">3B Outward Tax</TableHead>
                  <TableHead className="text-right">3B ITC Claimed</TableHead>
                  <TableHead className="text-right">2B ITC Available</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => {
                  const row = data[m] || EMPTY;
                  const confirmed = row.hasGstr1 && row.hasGstr3b && row.hasGstr2b;
                  return (
                    <TableRow key={m}>
                      <TableCell className="font-medium">{m}</TableCell>
                      <TableCell><Input type="number" value={row.turnover} onChange={(e) => updateField(m, 'turnover', e.target.value)} placeholder="0" className="text-right h-8" /></TableCell>
                      <TableCell><Input type="number" value={row.outwardTax} onChange={(e) => updateField(m, 'outwardTax', e.target.value)} placeholder="0" className="text-right h-8" /></TableCell>
                      <TableCell><Input type="number" value={row.itcClaimed} onChange={(e) => updateField(m, 'itcClaimed', e.target.value)} placeholder="0" className="text-right h-8" /></TableCell>
                      <TableCell><Input type="number" value={row.itcAvailable} onChange={(e) => updateField(m, 'itcAvailable', e.target.value)} placeholder="0" className="text-right h-8" /></TableCell>
                      <TableCell>
                        <Badge variant={confirmed ? 'success' : 'outline'} className={confirmed ? '' : 'border-dashed text-muted-foreground'}>
                          {confirmed ? 'Confirmed' : 'Needs entry'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={dirty[m] ? 'default' : 'ghost'}
                          disabled={savingMonth === m}
                          onClick={() => saveMonth(m)}
                        >
                          {savingMonth === m ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PortalCaptureCard;
