// 3 of the roadmap's 4 PAN-Based reports, reclassified from "extends portal
// login" to "ready (approx.)": a GSTIN's PAN is embedded in the GSTIN itself
// (characters 3-12 of the standard 15-char format — state code, then PAN,
// then entity number, 'Z', checksum), so grouping every client under the
// same firm-PAN needs no portal call and no new schema. What DOES still need
// the portal (out of scope here — see reportsPage.tsx's registry comments
// for the explicit decision) is the 4th PAN report, "Ledger Report" — that
// needs actual filed/portal ledger figures at PAN level, which this app
// doesn't have automated yet.
//
// All reports below roll up this app's own computed GSTR-1/GSTR-3B draft
// (same "approximate" caveat as the single-GSTIN GSTR-3B-vs-GSTR-1 reports)
// across every GSTIN sharing a PAN with the picked client.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { mmYyyyToShort, formatMonthLabel } from './allClientsReports';
import { buildGstr1Summary } from './buildGstr1Summary';
import { fetchGstr3b } from './fetchGstr3b';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');

export const derivePan = (gstin: string): string => (gstin || '').toUpperCase().trim().slice(2, 12);

export const fetchPanGroup = async (clientId: string): Promise<{ pan: string; group: ClientLite[] }> => {
  const { data: clientRow } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  const client = (clientRow || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
  const pan = derivePan(client.gstin);
  if (pan.length !== 10) throw new Error(`${client.name}'s GSTIN (${client.gstin || '—'}) doesn't look like a valid 15-character GSTIN — can't derive a PAN to group by.`);
  const { data: allClients } = await supabase.from('clients').select('id, name, gstin').order('name');
  const group = ((allClients || []) as ClientLite[]).filter((c) => derivePan(c.gstin) === pan);
  return { pan, group };
};

// ────── REPORT 1: Output Liability as per GSTR 1 and GSTR 3B (PAN) ───────

export const buildPanOutputLiabilityReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);
  const shortMonth = mmYyyyToShort(month);

  let totG1 = 0, totG3b = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const [gstr1Res, g3b] = await Promise.all([
      supabase.from('gstr1_data').select('raw_json').eq('client_id', c.id).eq('period_month', shortMonth).maybeSingle(),
      fetchGstr3b(c.id, c.gstin || '', month).catch(() => null),
    ]);
    const g1Summary = gstr1Res.data ? buildGstr1Summary(gstr1Res.data.raw_json).totals : null;
    const g1Tax = g1Summary ? g1Summary.igst + g1Summary.cgst + g1Summary.sgst : 0;
    const s = g3b?.summary;
    const g3bTax = s ? s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst : 0;
    totG1 += g1Tax; totG3b += g3bTax;
    rows.push([c.name, c.gstin || '—', g1Tax, g3bTax, g3bTax - g1Tax]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', totG1, totG3b, totG3b - totG1]);

  return {
    title: 'Output Liability as per GSTR 1 and GSTR 3B (PAN-Based)',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s)   |   Period: ${formatMonthLabel(month)}   |   Approximate — this app's own computed GSTR-1/GSTR-3B draft, not the as-filed portal figures.`,
    headers: ['Entity (GSTIN)', 'GSTIN', 'GSTR-1 Output Tax', 'GSTR-3B Output Liability', 'Variance'],
    rows,
    fileNameBase: `PAN_Output_Liability_${pan}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 18, 20, 14],
  };
};

// ──── REPORT 2: Liability per GSTR 1 and ITC Claimed per GSTR 3B (PAN) ───

export const buildPanLiabilityVsItcClaimedReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);
  const shortMonth = mmYyyyToShort(month);

  let totLiab = 0, totItc = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const [gstr1Res, g3b] = await Promise.all([
      supabase.from('gstr1_data').select('raw_json').eq('client_id', c.id).eq('period_month', shortMonth).maybeSingle(),
      fetchGstr3b(c.id, c.gstin || '', month).catch(() => null),
    ]);
    const g1Summary = gstr1Res.data ? buildGstr1Summary(gstr1Res.data.raw_json).totals : null;
    const liab = g1Summary ? g1Summary.igst + g1Summary.cgst + g1Summary.sgst : 0;
    const s = g3b?.summary;
    const itc = s ? s.itcAvailable.igst + s.itcAvailable.cgst + s.itcAvailable.sgst : 0;
    totLiab += liab; totItc += itc;
    rows.push([c.name, c.gstin || '—', liab, itc, liab - itc]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', totLiab, totItc, totLiab - totItc]);

  return {
    title: 'Liability as per GSTR 1 and ITC Claimed as per GSTR 3B (PAN-Based)',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s)   |   Period: ${formatMonthLabel(month)}   |   Approximate — this app's own computed GSTR-1/GSTR-3B draft, not the as-filed portal figures.`,
    headers: ['Entity (GSTIN)', 'GSTIN', 'GSTR-1 Output Liability', 'GSTR-3B ITC Claimed (Table 4A)', 'Liability − ITC'],
    rows,
    fileNameBase: `PAN_Liability_vs_ITC_Claimed_${pan}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 20, 24, 16],
  };
};

// ────── REPORT 3: GSTR 2A/2B Multiple Company Report (PAN) ───────────────
// Rolls up the already-imported gstr2a_import_docs / twob_import_docs across
// every GSTIN sharing a PAN — no new portal call beyond the per-GSTIN 2A/2B
// pulls each entity already needs (Import 2B's own pull + GSTR-2A Import
// card). "Approximate" because it inherits the GSTR-2A rate-derivation
// caveat, not because this rollup itself is uncertain.

export const buildPanMultipleCompany2A2BReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  let tot2a = 0, tot2b = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const [gstr2aRes, gstr2bRes] = await Promise.all([
      supabase.from('gstr2a_import_docs').select('taxable_value, input_igst, input_cgst, input_sgst').eq('client_id', c.id).eq('period_month', month),
      supabase.from('twob_import_docs').select('taxable_value, input_igst, input_cgst, input_sgst').eq('client_id', c.id).eq('period_month', month),
    ]);
    const sum = (docs: { taxable_value: number | null; input_igst: number | null; input_cgst: number | null; input_sgst: number | null }[] | null) =>
      (docs || []).reduce((a, d) => a + num(d.taxable_value) + num(d.input_igst) + num(d.input_cgst) + num(d.input_sgst), 0);
    const g2a = sum(gstr2aRes.data);
    const g2b = sum(gstr2bRes.data);
    tot2a += g2a; tot2b += g2b;
    rows.push([c.name, c.gstin || '—', (gstr2aRes.data || []).length, g2a, (gstr2bRes.data || []).length, g2b, g2b - g2a]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', '', tot2a, '', tot2b, tot2b - tot2a]);

  return {
    title: 'GSTR 2A/2B Multiple Company Report',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s)   |   Period: ${formatMonthLabel(month)}   |   Approximate — GSTR-2A totals inherit the rate-derivation caveat from the GSTR-2A Rate Wise Report; zero for a GSTIN means it hasn't been imported for this period yet.`,
    headers: ['Entity (GSTIN)', 'GSTIN', '2A Doc Count', '2A Total (Value + Tax)', '2B Doc Count', '2B Total (Value + Tax)', '2B − 2A'],
    rows,
    fileNameBase: `PAN_Multiple_Company_2A2B_${pan}_${month.replace('/', '-')}`,
    columnWidths: [28, 18, 12, 18, 12, 18, 14],
  };
};

// ────── REPORT 4: Net Output Liability Report (PAN) ───────────────────────
// Distinct from "Output Liability as per GSTR 1 and GSTR 3B" above: that
// report compares two independent computations of the same GROSS liability;
// this one rolls up the NET indicative payable (after ITC set-off) per
// GSTIN under a PAN — the actual cash-flow exposure across the group.

export const buildPanNetOutputLiabilityReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { pan, group } = await fetchPanGroup(clientId);

  let totLiab = 0, totItcNet = 0, totPayable = 0;
  const rows: (string | number)[][] = [];
  for (const c of group) {
    const g3b = await fetchGstr3b(c.id, c.gstin || '', month).catch(() => null);
    const s = g3b?.summary;
    const liab = s ? s.totalLiability.igst + s.totalLiability.cgst + s.totalLiability.sgst : 0;
    const itcNet = s ? s.itcNet.igst + s.itcNet.cgst + s.itcNet.sgst : 0;
    const payable = s ? s.indicativeNetPayable.igst + s.indicativeNetPayable.cgst + s.indicativeNetPayable.sgst : 0;
    totLiab += liab; totItcNet += itcNet; totPayable += payable;
    rows.push([c.name, c.gstin || '—', liab, itcNet, payable]);
  }
  rows.push(['TOTAL — PAN ' + pan, '', totLiab, totItcNet, totPayable]);

  return {
    title: 'Net Output Liability Report (PAN-Based)',
    subtitle: `PAN: ${pan}   |   ${group.length} GSTIN(s)   |   Period: ${formatMonthLabel(month)}   |   Approximate — this app's own computed GSTR-3B draft, not the as-filed portal figures.`,
    headers: ['Entity (GSTIN)', 'GSTIN', 'Total Liability', 'Net ITC Available', 'Indicative Net Payable'],
    rows,
    fileNameBase: `PAN_Net_Output_Liability_${pan}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 18, 18, 20],
  };
};
