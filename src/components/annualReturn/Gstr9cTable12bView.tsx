import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchDutiesTaxesInputAnnual, taxTotal } from '@/lib/annualReturnAggregates';
import { EXPENSE_HEADS } from '@/components/annualReturn/PLInputCard';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface HeadTotals { value: number; totalItc: number; }

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR 9C Table 12B — the 16 expense-head categories, from PL-Input lines
 * grouped by expense_head. Net suspended ITC (from Duties & Taxes-Input) is
 * deducted from the Purchases bucket only, matching the sheet — every other
 * head is unaffected.
 */
export const Gstr9cTable12bView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<string, HeadTotals>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('pl_input_lines').select('expense_head, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
    ]).then(([linesRes, dt]) => {
      if (cancelled) return;
      if (linesRes.error) throw linesRes.error;
      const next: Record<string, HeadTotals> = {};
      EXPENSE_HEADS.forEach((h) => { next[h] = { value: 0, totalItc: 0 }; });
      (linesRes.data || []).forEach((r: { expense_head: string | null; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
        if (!r.expense_head || !next[r.expense_head]) return;
        next[r.expense_head].value += Number(r.taxable_value);
        next[r.expense_head].totalItc += Number(r.igst) + Number(r.cgst) + Number(r.sgst);
      });
      const netSuspended = taxTotal(dt.netSuspended);
      next['Purchases'].totalItc -= netSuspended;
      setRows(next);
    }).catch((err) => toast.error('Could not compute GSTR 9C Table 12B: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const totalValue = Object.values(rows).reduce((a, r) => a + r.value, 0);
  const totalItc = Object.values(rows).reduce((a, r) => a + r.totalItc, 0);
  const visibleHeads = EXPENSE_HEADS.filter((h) => {
    const r = rows[h] || { value: 0, totalItc: 0 };
    return r.value !== 0 || r.totalItc !== 0;
  });
  const hiddenCount = EXPENSE_HEADS.length - visibleHeads.length;

  if (visibleHeads.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">GSTR 9C — Table 12B</CardTitle>
          <CardDescription>ITC by expense head — Purchases net of suspended ITC, matching the sheet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">No PL-Input entries for this client/year yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">GSTR 9C — Table 12B</CardTitle>
        <CardDescription>ITC by expense head — Purchases net of suspended ITC, matching the sheet.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-6 py-2 text-xs text-muted-foreground">
          Showing {visibleHeads.length} of {EXPENSE_HEADS.length} expense heads
          {hiddenCount > 0 ? ` (${hiddenCount} with no ITC hidden)` : ''}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expense head</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Total ITC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {EXPENSE_HEADS.map((h) => {
              const r = rows[h] || { value: 0, totalItc: 0 };
              if (r.value === 0 && r.totalItc === 0) return null;
              return (
                <TableRow key={h}>
                  <TableCell className="font-medium">{h}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.value)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.totalItc)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total eligible ITC availed</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totalValue)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totalItc)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Gstr9cTable12bView;
