import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Inbox, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchTable17HsnOutward, Table17Row } from '@/lib/annualReturnAggregates';
import { exportGstr9HsnToExcel } from '@/utils/gstr9HsnExcelExport';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR-9 TABLE 17 — HSN-wise summary of outward supplies. Entirely
 * computed from GSTR-1 data already imported elsewhere in the app — no
 * manual entry here, matching the portal's own read-only HSN grid but
 * without the per-row click-to-edit affordance, since nothing is edited.
 * Table 18 (inward HSN) was confirmed out of scope (27 Aug 2026) — most
 * filings leave it blank, including the client this module was verified
 * against.
 */
export const Table17HsnOutwardCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Table17Row[]>([]);
  const [monthsPresent, setMonthsPresent] = useState(0);
  const [monthsTotal, setMonthsTotal] = useState(12);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchTable17HsnOutward(clientId, financialYear)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setMonthsPresent(result.monthsPresent);
        setMonthsTotal(result.monthsTotal);
      })
      .catch((err) => toast.error('Could not compute Table 17: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return (
    <Card>
      <CardHeader><CardTitle className="text-lg">TABLE 17 — HSN-wise summary of outward supplies</CardTitle></CardHeader>
      <CardContent className="flex items-center justify-center gap-2 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </CardContent>
    </Card>
  );

  const complete = monthsPresent === monthsTotal;
  const totals = rows.reduce((a, r) => ({
    taxable: a.taxable + r.taxable, igst: a.igst + r.igst, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst, cess: a.cess + r.cess,
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

  const handleExportExcel = async () => {
    const { data: client } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
    exportGstr9HsnToExcel(client?.name || 'Unknown', financialYear, rows);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">TABLE 17 — HSN-wise summary of outward supplies</CardTitle>
          <CardDescription>Computed from imported GSTR-1 data, aggregated by HSN code and rate across the year. Nothing is entered here.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={complete ? 'success' : 'warning'}>{monthsPresent} of {monthsTotal} months present</Badge>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={handleExportExcel} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!complete && (
          <p className="px-6 pb-2 text-xs text-muted-foreground">
            Only {monthsPresent} of {monthsTotal} months of GSTR-1 data are imported — this table will be incomplete until the rest are in (Import 2B tab is unrelated; GSTR-1 is imported separately per month).
          </p>
        )}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">No HSN data found in the imported GSTR-1 months for this client/year.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>HSN Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>UQC</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Taxable Value</TableHead>
                  <TableHead className="text-right">Rate (%)</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">Cess</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.hsn}-${r.rate}-${i}`}>
                    <TableCell className="font-medium whitespace-nowrap">{r.hsn}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{r.desc || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.uqc || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.taxable)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.rate}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.igst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.cgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.sgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.cess)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>Total ({rows.length} HSN/rate lines)</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.taxable)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{fmt(totals.igst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.cgst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.sgst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.cess)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Table17HsnOutwardCard;
