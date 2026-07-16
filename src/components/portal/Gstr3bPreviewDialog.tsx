import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Download, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildGstr3bJson, Gstr3bResult, ItcData, RcmTotals } from '@/utils/buildGstr3bJson';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShort = (mmYyyy: string) => { const [mm, yyyy] = mmYyyy.split('/'); return `${SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}`; };
const inr = (n: number) => (n || n === 0 ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '0');

const Row: React.FC<{ label: string; txval?: number; igst?: number; cgst?: number; sgst?: number; bold?: boolean }> = ({ label, txval, igst, cgst, sgst, bold }) => (
  <tr className={bold ? 'font-medium bg-muted/30' : ''}>
    <td className="border border-border p-1.5">{label}</td>
    <td className="border border-border p-1.5 text-right">{txval === undefined ? '' : inr(txval)}</td>
    <td className="border border-border p-1.5 text-right">{igst === undefined ? '' : inr(igst)}</td>
    <td className="border border-border p-1.5 text-right">{cgst === undefined ? '' : inr(cgst)}</td>
    <td className="border border-border p-1.5 text-right">{sgst === undefined ? '' : inr(sgst)}</td>
  </tr>
);

const Head: React.FC = () => (
  <thead>
    <tr className="bg-muted/60">
      <th className="border border-border p-1.5 text-left">Particulars</th>
      <th className="border border-border p-1.5 text-right w-24">Taxable</th>
      <th className="border border-border p-1.5 text-right w-24">IGST</th>
      <th className="border border-border p-1.5 text-right w-24">CGST</th>
      <th className="border border-border p-1.5 text-right w-24">SGST</th>
    </tr>
  </thead>
);

export const Gstr3bPreviewDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  gstin: string;
  periodMonth: string; // MM/YYYY
}> = ({ open, onOpenChange, clientId, gstin, periodMonth }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Gstr3bResult | null>(null);

  useEffect(() => {
    if (!open || !clientId || !periodMonth) return;
    (async () => {
      setLoading(true);
      setResult(null);
      try {
        const short = toShort(periodMonth);
        const [g, itcRes, rcmRes] = await Promise.all([
          supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', short).maybeSingle(),
          supabase.from('itc_summaries').select('data').eq('client_id', clientId).eq('period_month', periodMonth).maybeSingle(),
          supabase.from('rcm_data').select('taxable_value, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).eq('month', short),
        ]);

        let itc: ItcData | null = null;
        const rawItc = (itcRes.data as any)?.data;
        const parsed = typeof rawItc === 'string' ? JSON.parse(rawItc) : rawItc;
        if (parsed) itc = { section4A: parsed.section4A || [], section4B: parsed.section4B || [], section4D: parsed.section4D || [] };

        const rcmRows = ((rcmRes.data as any[]) || []);
        const rcm: RcmTotals = rcmRows.reduce((a, r) => ({
          taxable: a.taxable + (r.taxable_value || 0),
          igst: a.igst + (r.igst_5 || 0) + (r.igst_18 || 0),
          cgst: a.cgst + (r.cgst_2_5 || 0) + (r.cgst_9 || 0),
          sgst: a.sgst + (r.sgst_2_5 || 0) + (r.sgst_9 || 0),
        }), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

        setResult(buildGstr3bJson({ gstin, periodMonth, gstr1Raw: (g.data as any)?.raw_json ?? null, itc, rcm }));
      } catch (e: any) {
        toast.error('Failed to build GSTR-3B: ' + (e?.message || 'unknown'));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, clientId, periodMonth, gstin]);

  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gstr3b_${gstin}_${periodMonth.replace('/', '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = result?.summary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prepare GSTR-3B — {periodMonth}</DialogTitle>
          <DialogDescription>
            Draft assembled from GSTR-1 (outward), ITC Summary (Table 4) and RCM. <span className="text-warning font-medium">Review every figure</span> —
            this data is only SAVED on the portal; you still offset ITC and file (OTP/DSC) yourself.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : !s ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Nothing to preview.</div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-3">
            <p className="text-sm font-medium mb-1">3.1 Outward supplies &amp; inward RCM</p>
            <table className="w-full text-xs border-collapse mb-4">
              <Head />
              <tbody>
                <Row label="(a) Outward taxable (other than zero/nil/exempt)" txval={s.outward.txval} igst={s.outward.igst} cgst={s.outward.cgst} sgst={s.outward.sgst} />
                <Row label="(b) Outward zero-rated (exports/SEZ)" txval={s.zeroRated.txval} igst={s.zeroRated.igst} />
                <Row label="(c) Other outward (nil / exempt)" txval={s.nilExempt} />
                <Row label="(d) Inward liable to reverse charge" txval={s.rcmLiability.txval} igst={s.rcmLiability.igst} cgst={s.rcmLiability.cgst} sgst={s.rcmLiability.sgst} />
                <Row label="(e) Non-GST outward" txval={s.nonGst} />
                <Row label="Total liability (a + d)" igst={s.totalLiability.igst} cgst={s.totalLiability.cgst} sgst={s.totalLiability.sgst} bold />
              </tbody>
            </table>

            <p className="text-sm font-medium mb-1">4. Eligible ITC</p>
            <table className="w-full text-xs border-collapse mb-4">
              <Head />
              <tbody>
                <Row label="4A ITC available" igst={s.itcAvailable.igst} cgst={s.itcAvailable.cgst} sgst={s.itcAvailable.sgst} />
                <Row label="4B ITC reversed" igst={s.itcReversed.igst} cgst={s.itcReversed.cgst} sgst={s.itcReversed.sgst} />
                <Row label="4C Net ITC available" igst={s.itcNet.igst} cgst={s.itcNet.cgst} sgst={s.itcNet.sgst} bold />
                <Row label="4D(2) Ineligible (16(4)/PoS)" igst={s.itcIneligible.igst} cgst={s.itcIneligible.cgst} sgst={s.itcIneligible.sgst} />
              </tbody>
            </table>

            <table className="w-full text-xs border-collapse mb-3">
              <Head />
              <tbody>
                <Row label="Indicative net payable (liability − net ITC)*" igst={s.indicativeNetPayable.igst} cgst={s.indicativeNetPayable.cgst} sgst={s.indicativeNetPayable.sgst} bold />
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mb-3">
              *Indicative only. The actual set-off hierarchy (IGST→CGST/SGST etc.) and any cash payment are done by you on the portal.
            </p>

            {result!.flags.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning space-y-1">
                <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />Review before filing</div>
                {result!.flags.map((f, i) => <div key={i}>• {f}</div>)}
              </div>
            )}
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={download} disabled={!result}>
            <Download className="h-4 w-4 mr-2" />Download JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
