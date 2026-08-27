import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPlInputTotals, fetchPlOutputPartBByBifurcation, fetchDutiesTaxesInputAnnual, fetchRcmTotals,
  fetchPortalItcClaimedAnnual, fetchPortal2bAnnual, fetchPortalCategoryTotals, fetchItcReversalTotals,
  fetchTaxPaymentTotals, fetchCarryForwardTotals, fetchTable14DifferentialTax,
  fetchTable15DemandsRefunds, fetchTable16CompositionDeemedApproval, taxTotal,
  type Table15RowKey, type Table15Row, type Table16RowKey, type Table16Row,
} from '@/lib/annualReturnAggregates';
import { supabase } from '@/integrations/supabase/client';
import { exportGstr9FormToPDF, type Gstr9PdfSection } from '@/utils/gstr9FormPdfExport';

const TOLERANCE = 10;

// Accounting-style negatives — parentheses, not a leading minus, so a
// credit note or an ITC-reversed-in-next-FY figure doesn't get lost in a
// column of tax amounts.
const fmt = (v: number): string => {
  const abs = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
};

interface Props { clientId: string; financialYear: string; }

type BadgeVariant = 'success' | 'warning' | 'secondary' | 'outline' | 'destructive';

interface Gstr9RowSpec {
  tableNo: string;
  description: string;
  value: number;
  tag?: string;
  tagVariant?: BadgeVariant;
  strong?: boolean;
}

interface Gstr9CardSpec {
  title: string;
  description?: string;
  rows: Gstr9RowSpec[];
}

const Gstr9Row: React.FC<Gstr9RowSpec> = ({ tableNo, description, value, tag, tagVariant = 'secondary', strong }) => (
  <TableRow>
    <TableCell className={strong ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>{description}</TableCell>
    <TableCell className="text-sm text-muted-foreground">{tableNo}</TableCell>
    <TableCell className={`text-right tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'}`}>{fmt(value)}</TableCell>
    <TableCell>{tag && <Badge variant={tagVariant} className="text-[10px]">{tag}</Badge>}</TableCell>
  </TableRow>
);

const Gstr9Table: React.FC<{ rows: Gstr9RowSpec[] }> = ({ rows }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Description</TableHead>
        <TableHead>Table No.</TableHead>
        <TableHead className="text-right">Value</TableHead>
        <TableHead>Status</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((r, i) => <Gstr9Row key={i} {...r} />)}
    </TableBody>
  </Table>
);

interface Computed {
  t4A: number; t4B: number; t4D: number; t4E: number; t4G: number; t4I: number; t4H: number; t4M: number; t4N: number;
  t5A: number; t5B: number; t5F: number; t5G: number; t5M: number; t5N: number;
  totalTurnover: number;
  t6A: number; t6B: number; t6C_D: number; t6H: number; t6I: number; t6O: number;
  t7Rulewise: number; t7H1: number; t7I: number; t7J: number;
  t8A: number; t8B: number; t8C: number; t8D: number;
  payIgst: { payable: number; paid: number }; payCgst: { payable: number; paid: number }; paySgst: { payable: number; paid: number };
  t10: number; t11: number; t12: number; t13: number;
  t14: Record<'igst' | 'cgst' | 'sgst' | 'cess' | 'interest', { payable: number; paid: number }>;
  t15: Record<Table15RowKey, Table15Row>;
  t16: Record<Table16RowKey, Table16Row>;
}

const GROUPS = [
  { id: 'outward', label: 'Table 4–5 · Outward' },
  { id: 'itc', label: 'Table 6–7 · ITC' },
  { id: 'reco8', label: 'Table 8 · ITC vs 2B' },
  { id: 'taxpaid', label: 'Table 9 · Tax paid' },
  { id: 'nextyear', label: 'Table 10–16 · Next year' },
] as const;

// Builds the on-screen table sections and the PDF export from the same data
// — one source of truth for which figure carries which table number, tag
// and description.
const buildGroups = (c: Computed): Record<typeof GROUPS[number]['id'], Gstr9CardSpec[]> => ({
  outward: [
    {
      title: 'Table 4 — Supplies on which tax is payable',
      description: "4A–4N, from GSTR 9-Output's auto-populated column and RCM Part A.",
      rows: [
        { tableNo: '4A', description: 'B2C', value: c.t4A },
        { tableNo: '4B', description: 'B2B', value: c.t4B },
        { tableNo: '4D', description: 'SEZ with payment', value: c.t4D },
        { tableNo: '4E', description: 'Deemed exports', value: c.t4E },
        { tableNo: '4G', description: 'RCM inward (Part A)', value: c.t4G, tag: 'Portal', tagVariant: 'outline' },
        { tableNo: '4H', description: 'Sub-total', value: c.t4H },
        { tableNo: '4I', description: 'Credit notes (−)', value: c.t4I },
        { tableNo: '4N', description: 'Supplies & advances on which tax payable', value: c.t4N, strong: true },
      ],
    },
    {
      title: 'Table 5 — Supplies on which tax is not payable',
      rows: [
        { tableNo: '5A', description: 'Export without payment of tax', value: c.t5A },
        { tableNo: '5B', description: 'SEZ without payment', value: c.t5B },
        { tableNo: '5F', description: 'Non-GST supply', value: c.t5F },
        { tableNo: '5G / 5M', description: 'Sub-total', value: c.t5M },
        { tableNo: '5N', description: 'Total turnover (4N + 5M − 4G)', value: c.totalTurnover, strong: true },
      ],
    },
  ],
  itc: [
    {
      title: 'Table 6 — ITC availed',
      rows: [
        { tableNo: '6A', description: 'Total ITC via GSTR-3B', value: c.t6A, tag: 'Portal', tagVariant: 'outline' },
        { tableNo: '6B', description: 'Inputs', value: c.t6B },
        { tableNo: '6C/6D', description: 'RCM', value: c.t6C_D },
        { tableNo: '—', description: 'Input Services + Capital Goods', value: c.t6H },
        {
          tableNo: '6O', description: 'Total ITC availed', value: c.t6O, strong: true,
          tag: Math.abs(c.t6O - c.t6A) <= TOLERANCE ? 'Matches 6A' : `Diff vs 6A: ${fmt(c.t6O - c.t6A)}`,
          tagVariant: Math.abs(c.t6O - c.t6A) <= TOLERANCE ? 'success' : 'warning',
        },
      ],
    },
    {
      title: 'Table 7 — ITC Reversed & Ineligible',
      rows: [
        { tableNo: '—', description: 'Rule-wise (37/37A/38/39/42/43) + s.17(5)', value: c.t7Rulewise },
        { tableNo: 'H1', description: 'Other reversal', value: c.t7H1 },
        { tableNo: '7I', description: 'Total ITC reversed', value: c.t7I },
        { tableNo: '7J', description: 'Net ITC available for utilisation', value: c.t7J, strong: true },
      ],
    },
  ],
  reco8: [
    {
      title: 'Table 8 — ITC as per GSTR-2B',
      rows: [
        { tableNo: '8A', description: 'ITC as per GSTR-2B', value: c.t8A, tag: 'Portal', tagVariant: 'outline' },
        { tableNo: '8B', description: 'ITC per 6B', value: c.t8B, tag: 'Computed', tagVariant: 'outline' },
        { tableNo: '8C', description: 'Claimed in next FY', value: c.t8C },
        {
          tableNo: '8D', description: 'Difference [A−(B+C)]', value: c.t8D, strong: true,
          tag: Math.abs(c.t8D) <= TOLERANCE ? 'Matched — lockable' : 'Needs a reason',
          tagVariant: Math.abs(c.t8D) <= TOLERANCE ? 'success' : 'destructive',
        },
      ],
    },
  ],
  taxpaid: [
    {
      title: 'Table 9 — Tax paid',
      rows: ([['IGST', c.payIgst], ['CGST', c.payCgst], ['SGST', c.paySgst]] as [string, { payable: number; paid: number }][]).map(
        ([label, v]) => ({
          tableNo: '9',
          description: `${label} — payable / paid`,
          value: v.payable,
          tag: `Paid ${fmt(v.paid)}`,
          tagVariant: (Math.abs(v.payable - v.paid) <= TOLERANCE ? 'success' : 'destructive') as BadgeVariant,
        }),
      ),
    },
  ],
  nextyear: [
    {
      title: 'Tables 10–13 — Next-year amendments',
      description: "From Annexure 4's carry-forward entries.",
      rows: [
        { tableNo: '10', description: 'Supplies declared through amendments (+)', value: c.t10 },
        { tableNo: '11', description: 'Supplies reduced through amendments (−)', value: c.t11 },
        { tableNo: '12', description: 'ITC of the FY reversed in next FY', value: c.t12 },
        { tableNo: '13', description: 'ITC of the FY availed in next FY', value: c.t13 },
      ],
    },
    {
      title: 'Table 14 — Differential tax paid',
      description: "On account of the declarations in Table 10 & 11 — from the Annexure tab's Table 14 entry.",
      rows: (['igst', 'cgst', 'sgst', 'cess', 'interest'] as const).map((h) => {
        const v = c.t14[h];
        const diff = v.payable - v.paid;
        return {
          tableNo: '14',
          description: h === 'igst' ? 'Integrated Tax' : h === 'cgst' ? 'Central Tax' : h === 'sgst' ? 'State/UT Tax' : h === 'cess' ? 'Cess' : 'Interest',
          value: v.payable,
          tag: Math.abs(diff) <= TOLERANCE ? `Matched (paid ${fmt(v.paid)})` : `Diff ${fmt(diff)} (paid ${fmt(v.paid)})`,
          tagVariant: (Math.abs(diff) <= TOLERANCE ? 'success' : 'destructive') as BadgeVariant,
        };
      }),
    },
    {
      title: 'Table 15 — Demands and Refunds',
      description: "From the Annexure tab's Table 15 entry.",
      rows: (['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map((k) => {
        const v = c.t15[k];
        const total = v.central_tax + v.state_tax + v.integrated_tax + v.cess + v.interest + v.penalty;
        const label = {
          A: 'Total Refund claimed', B: 'Total Refund sanctioned', C: 'Total Refund Rejected', D: 'Total Refund Pending',
          E: 'Total demand of taxes', F: 'Total taxes paid in respect of E above', G: 'Total demands pending out of E above',
        }[k];
        return { tableNo: `15${k}`, description: label, value: total };
      }),
    },
    {
      title: 'Table 16 — Composition / Deemed Supply / Approval Basis',
      description: "From the Annexure tab's Table 16 entry.",
      rows: (['A', 'B', 'C'] as const).map((k) => {
        const v = c.t16[k];
        const total = v.taxable_value + v.central_tax + v.state_tax + v.integrated_tax + v.cess;
        const label = {
          A: 'Supplies received from Composition taxpayers', B: 'Deemed supply under Section 143', C: 'Goods sent on approval basis but not returned',
        }[k];
        return { tableNo: `16${k}`, description: label, value: total };
      }),
    },
  ],
});

/**
 * The terminal assembly — GSTR-9 Tables 4 through 13, built from every
 * earlier phase's data. Nothing is entered here. Where the sheet's formula
 * chain genuinely needs a figure the schema doesn't produce cleanly, that's
 * noted rather than approximated silently.
 */
export const Gstr9FormView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [group, setGroup] = useState<typeof GROUPS[number]['id']>('outward');
  const [c, setC] = useState<Computed | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!clientId || !financialYear) { setStatus('idle'); setC(null); return; }
    let cancelled = false;
    setStatus('loading');
    setC(null);
    Promise.all([
      fetchPlInputTotals(clientId, financialYear),
      fetchPlOutputPartBByBifurcation(clientId, financialYear),
      fetchDutiesTaxesInputAnnual(clientId, financialYear),
      fetchRcmTotals(clientId, financialYear),
      fetchPortalItcClaimedAnnual(clientId, financialYear),
      fetchPortal2bAnnual(clientId, financialYear),
      fetchPortalCategoryTotals(clientId, financialYear),
      fetchItcReversalTotals(clientId, financialYear),
      fetchTaxPaymentTotals(clientId, financialYear),
      fetchCarryForwardTotals(clientId, financialYear),
      fetchTable14DifferentialTax(clientId, financialYear),
      fetchTable15DemandsRefunds(clientId, financialYear),
      fetchTable16CompositionDeemedApproval(clientId, financialYear),
    ]).then(([pl, plOutB, dt, rcm, portalItc, portal2b, cat, itcRev, pay, cf, t14, t15, t16]) => {
      if (cancelled) return;
      const t4A = taxTotal(cat.b2c), t4B = taxTotal(cat.b2b), t4D = taxTotal(cat.sez_with), t4E = taxTotal(cat.deemed_export);
      const t4G = taxTotal(rcm.partA);
      const t4I = -Math.abs(taxTotal(cat.credit_note));
      const t4H = t4A + t4B + t4D + t4E + t4G;
      const t4M = t4I;
      const t4N = t4H + t4M;

      const t5A = taxTotal(plOutB.export_wo_tax), t5B = taxTotal(plOutB.sez_wo_tax), t5F = taxTotal(plOutB.non_gst);
      const t5G = t5A + t5B + t5F;
      const t5M = t5G;
      const t5N = t4N + t5M - t4G;

      const t6A = taxTotal(portalItc);
      const t6B = taxTotal(pl.purchase);
      const t6C_D = taxTotal(rcm.partB);
      const t6H = taxTotal(pl.expense) + taxTotal(pl.capital_goods);
      const t6I = t6B + t6C_D + t6H + taxTotal(dt.reclaimTotal);
      const t6O = t6I;

      const t7Rulewise = taxTotal(itcRev.total);
      const t7H1 = taxTotal(dt.reversalTotal);
      const t7I = t7Rulewise + t7H1;
      const t7J = t6O - t7I;

      const t8A = taxTotal(portal2b);
      const t8B = t6B;
      const t8C = taxTotal(cf.claimed_in_next_fy);
      const t8D = t8A - (t8B + t8C);

      const payIgst = { payable: pay.igst.payable, paid: pay.igst.paidCash + pay.igst.paidItc };
      const payCgst = { payable: pay.cgst.payable, paid: pay.cgst.paidCash + pay.cgst.paidItc };
      const paySgst = { payable: pay.sgst.payable, paid: pay.sgst.paidCash + pay.sgst.paidItc };

      setC({
        t4A, t4B, t4D, t4E, t4G, t4I, t4H, t4M, t4N,
        t5A, t5B, t5F, t5G, t5M, t5N, totalTurnover: t5N,
        t6A, t6B, t6C_D, t6H, t6I, t6O,
        t7Rulewise, t7H1, t7I, t7J,
        t8A, t8B, t8C, t8D,
        payIgst, payCgst, paySgst,
        t10: taxTotal(cf.turnover_declared_next_fy), t11: taxTotal(cf.turnover_reduced_next_fy),
        t12: taxTotal(cf.claimed_in_next_fy) * -1, t13: taxTotal(cf.claimed_in_next_fy),
        t14, t15, t16,
      });
      setStatus('ready');
    }).catch((err) => {
      toast.error('Could not assemble GSTR-9: ' + (err instanceof Error ? err.message : 'Unknown error'));
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [clientId, financialYear, retryTick]);

  if (status === 'idle') return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Select a client and financial year to view this.</CardContent></Card>;
  if (status === 'loading') return (
    <Card>
      <CardContent role="status" aria-live="polite" className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading...</span>
      </CardContent>
    </Card>
  );
  if (status === 'error' || !c) return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="text-sm text-muted-foreground">Could not load this client's GSTR-9 summary.</span>
        <Button size="sm" variant="outline" onClick={() => setRetryTick((t) => t + 1)}>Retry</Button>
      </CardContent>
    </Card>
  );

  const groups = buildGroups(c);

  const handleExportPdf = async () => {
    const { data: client } = await supabase.from('clients').select('name, gstin').eq('id', clientId).maybeSingle();
    const sections: Gstr9PdfSection[] = GROUPS.flatMap((g) => groups[g.id]).map((card) => ({
      title: card.title,
      rows: card.rows.map((r) => ({ tableNo: r.tableNo, description: r.description, value: r.value, status: r.tag })),
    }));
    exportGstr9FormToPDF({
      clientName: client?.name || 'Unknown',
      clientGstin: client?.gstin || '',
      financialYear,
      sections,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleExportPdf} className="gap-2">
          <FileText className="h-4 w-4" />
          Export PDF
        </Button>
      </div>

      <Tabs value={group} onValueChange={(v) => setGroup(v as typeof GROUPS[number]['id'])}>
        <TabsList className="h-auto flex-wrap">
          {GROUPS.map((g) => (
            <TabsTrigger key={g.id} value={g.id}>{g.label}</TabsTrigger>
          ))}
        </TabsList>

        {GROUPS.map((g) => (
          <TabsContent key={g.id} value={g.id} className="space-y-4">
            {groups[g.id].map((card, i) => (
              <Card key={i}>
                <CardHeader>
                  <CardTitle className="text-lg">{card.title}</CardTitle>
                  {card.description && <CardDescription>{card.description}</CardDescription>}
                </CardHeader>
                <CardContent className="p-0">
                  <Gstr9Table rows={card.rows} />
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default Gstr9FormView;
