// 2 of the roadmap's 4 PAN-Based reports, reclassified from "extends portal
// login" to "ready (approx.)": a GSTIN's PAN is embedded in the GSTIN itself
// (characters 3-12 of the standard 15-char format — state code, then PAN,
// then entity number, 'Z', checksum), so grouping every client under the
// same firm-PAN needs no portal call and no new schema. What DOES still need
// the portal (kept out of scope here) is the other two PAN reports — Net
// Output Liability and the PAN Ledger Report — since those need the actual
// filed/portal ledger figures, not this app's own draft.
//
// Both reports below roll up this app's own computed GSTR-1/GSTR-3B draft
// (same "approximate" caveat as the single-GSTIN GSTR-3B-vs-GSTR-1 reports)
// across every GSTIN sharing a PAN with the picked client.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { mmYyyyToShort, formatMonthLabel } from './allClientsReports';
import { buildGstr1Summary } from './buildGstr1Summary';
import { fetchGstr3b } from './fetchGstr3b';

interface ClientLite { id: string; name: string; gstin: string; }

const fileSafe = (s: string) => s.replace(/\s+/g, '_');

const derivePan = (gstin: string): string => (gstin || '').toUpperCase().trim().slice(2, 12);

const fetchPanGroup = async (clientId: string): Promise<{ pan: string; group: ClientLite[] }> => {
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
