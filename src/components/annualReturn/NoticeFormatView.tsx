import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchTaxPaymentTotals, fetchPortal2bAnnual, fetchPortalItcClaimedAnnual, taxTotal } from '@/lib/annualReturnAggregates';

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * NOTICE FORMATE — the same Table 9 / Table 8 figures reformatted the way a
 * departmental notice reply reads: net tax payable, and net ITC excess
 * used. Pre-audit reference only, no data of its own.
 */
export const NoticeFormatView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [outward, setOutward] = useState<{ igst: number; cgst: number; sgst: number; net: { igst: number; cgst: number; sgst: number } } | null>(null);
  const [inward, setInward] = useState<{ t8A: number; used: number } | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setStatus('idle'); setOutward(null); setInward(null); return; }
    let cancelled = false;
    setStatus('loading');
    setOutward(null);
    setInward(null);
    Promise.all([
      fetchTaxPaymentTotals(clientId, financialYear),
      fetchPortal2bAnnual(clientId, financialYear),
      fetchPortalItcClaimedAnnual(clientId, financialYear),
    ]).then(([pay, t8a, used]) => {
      if (cancelled) return;
      setOutward({
        igst: pay.igst.payable, cgst: pay.cgst.payable, sgst: pay.sgst.payable,
        net: {
          igst: pay.igst.payable - (pay.igst.paidCash + pay.igst.paidItc),
          cgst: pay.cgst.payable - (pay.cgst.paidCash + pay.cgst.paidItc),
          sgst: pay.sgst.payable - (pay.sgst.paidCash + pay.sgst.paidItc),
        },
      });
      setInward({ t8A: taxTotal(t8a), used: taxTotal(used) });
      setStatus('ready');
    }).catch((err) => {
      toast.error('Could not compute Notice Format: ' + (err instanceof Error ? err.message : 'Unknown error'));
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [clientId, financialYear, retryTick]);

  if (status === 'idle') return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Select a client and financial year to view this.</CardContent></Card>;
  if (status === 'loading') return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  if (status === 'error' || !outward || !inward) return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="text-sm text-muted-foreground">Could not load this client's Notice Format summary.</span>
        <Button size="sm" variant="outline" onClick={() => setRetryTick((t) => t + 1)}>Retry</Button>
      </CardContent>
    </Card>
  );

  const netExcessUsed = inward.t8A - inward.used;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">Outward</CardTitle><CardDescription>Net tax payable, referenced to GSTR-9 Table 9.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Description</TableHead><TableHead>Table No. in GSTR-9</TableHead><TableHead className="text-right">IGST</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>Total output tax liability</TableCell><TableCell>9</TableCell><TableCell className="text-right tabular-nums">{fmt(outward.igst)}</TableCell><TableCell className="text-right tabular-nums">{fmt(outward.cgst)}</TableCell><TableCell className="text-right tabular-nums">{fmt(outward.sgst)}</TableCell></TableRow>
              <TableRow className="font-semibold"><TableCell>Net tax payable</TableCell><TableCell>9</TableCell><TableCell className="text-right tabular-nums">{fmt(outward.net.igst)}</TableCell><TableCell className="text-right tabular-nums">{fmt(outward.net.cgst)}</TableCell><TableCell className="text-right tabular-nums">{fmt(outward.net.sgst)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Inward</CardTitle><CardDescription>ITC as per Table 8A against what's actually been used.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Description</TableHead><TableHead>Table No. in GSTR-9</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>ITC as per Table 8A of GSTR-9</TableCell><TableCell>8A</TableCell><TableCell className="text-right tabular-nums">{fmt(inward.t8A)}</TableCell></TableRow>
              <TableRow><TableCell>ITC used as per 4A(5) of GSTR-3B</TableCell><TableCell>—</TableCell><TableCell className="text-right tabular-nums">{fmt(inward.used)}</TableCell></TableRow>
              <TableRow className="font-semibold"><TableCell>Net excess used</TableCell><TableCell>—</TableCell><TableCell className="text-right tabular-nums">{fmt(netExcessUsed)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default NoticeFormatView;
