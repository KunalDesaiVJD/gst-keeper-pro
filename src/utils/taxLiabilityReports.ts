// The 8 Tax Liability & ITC reports on the Reports Hub. Previously these
// sliced this app's own COMPUTED draft GSTR-3B (fetchGstr3b) — re-derived
// here to read gst_filed_returns instead: the portal's own as-filed GSTR-3B/
// GSTR-1 JSON (see filedReturnReports.ts, populated by content.js's
// handleGstr3bPull/handleGstr1Pull). A report only stays "computed" where
// the portal's own summary API genuinely doesn't expose the figure at the
// grain the old report used (e.g. rate-wise instead of section-wise) — each
// such case says so in its own subtitle rather than silently keeping the
// old, non-portal number.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel } from './allClientsReports';
import {
  fetchFiledReturn, notPulledMsg, gstr1Taxable, gstr1InvoiceValue,
  type Gstr3bSummary, type Gstr1Summary, type Gstr1Section, type HeadAmt, type TypedAmt,
} from './filedReturnReports';

interface ClientLite { id: string; name: string; gstin: string; }

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const fileSafe = (s: string) => s.replace(/\s+/g, '_');

const fetchClient = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '' }) as ClientLite;
};

const fetchFiledGstr3b = async (clientId: string, client: ClientLite, month: string) => {
  const row = await fetchFiledReturn(clientId, month, 'GSTR3B');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-3B'));
  return { row, s: row.summary as Gstr3bSummary };
};

const fetchFiledGstr1 = async (clientId: string, client: ClientLite, month: string) => {
  const row = await fetchFiledReturn(clientId, month, 'GSTR1');
  if (!row || !row.summary || Object.keys(row.summary).length === 0) throw new Error(notPulledMsg(client, month, 'GSTR-1'));
  return { row, s: row.summary as Gstr1Summary };
};

const findItc = (arr: TypedAmt[] | undefined, ty: string): HeadAmt =>
  (Array.isArray(arr) ? arr.find((x) => x.ty === ty) : undefined) || {};
const headSum = (...heads: (HeadAmt | undefined)[]) => ({
  igst: heads.reduce((a, h) => a + num(h?.iamt), 0),
  cgst: heads.reduce((a, h) => a + num(h?.camt), 0),
  sgst: heads.reduce((a, h) => a + num(h?.samt), 0),
});

// The 5 ITC-Available rows GSTR-3B Table 4(A) always presents in this order.
const ITC_AVL_ROWS: [string, string][] = [
  ['IMPG', 'Import of goods'],
  ['IMPS', 'Import of services'],
  ['ISRC', 'Inward supplies liable to reverse charge'],
  ['ISD', 'Input Service Distributor'],
  ['OTH', 'All other ITC'],
];

// ────────── REPORT 1: Difference in Liability Declared and Paid ──────────

export const buildLiabilityDeclaredVsPaidReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  // 3.1(b) carries the IGST on exports and SEZ supplies with payment, payable like the rest.
  const declared = headSum(s.sup_details?.osup_det, s.sup_details?.osup_zero, s.sup_details?.isup_rev);
  const tt = s.tt_val || {};

  const rows: (string | number)[][] = [
    ['IGST', declared.igst],
    ['CGST', declared.cgst],
    ['SGST', declared.sgst],
    ['Total', declared.igst + declared.cgst + declared.sgst],
    ['', ''],
    ['As-filed payment (aggregate — the portal\'s own summary API doesn\'t split this by tax head)', ''],
    ['Cash paid', num(tt.tt_csh_pd)],
    ['ITC utilised', num(tt.tt_itc_pd)],
    ['Total payable (as filed)', num(tt.tt_pay)],
  ];

  return {
    title: 'Difference in Liability Declared and Paid',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   "Declared" is the as-filed Total Output Liability (3.1a + 3.1b + 3.1d), from the portal's own GSTR-3B. "Paid" is the return's own as-filed cash/ITC/total-payable — the portal doesn't split it per tax head, so it's shown as one aggregate block instead of a per-head column.`,
    headers: ['Tax Head', 'Amount'],
    rows,
    fileNameBase: `Liability_Declared_vs_Paid_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [50, 20],
  };
};

// ────────── REPORT 2: Tax Liability and ITC Summary ──────────────────────

export const buildTaxLiabilityAndItcSummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const outward = headSum(s.sup_details?.osup_det);
  const zeroRated = headSum(s.sup_details?.osup_zero);
  const rcm = headSum(s.sup_details?.isup_rev);
  const total = headSum(s.sup_details?.osup_det, s.sup_details?.osup_zero, s.sup_details?.isup_rev);
  const itcAvailGross = headSum(...ITC_AVL_ROWS.map(([ty]) => findItc(s.itc_elg?.itc_avl, ty)));
  const itcRevSum = headSum(...(s.itc_elg?.itc_rev || []));
  const itcNet = { igst: num(s.itc_elg?.itc_net?.iamt), cgst: num(s.itc_elg?.itc_net?.camt), sgst: num(s.itc_elg?.itc_net?.samt) };
  const tt = s.tt_val || {};

  const rows: (string | number)[][] = [
    ['Outward Taxable Liability (3.1a)', outward.igst, outward.cgst, outward.sgst, outward.igst + outward.cgst + outward.sgst],
    ['Zero Rated Supplies, exports and SEZ (3.1b)', zeroRated.igst, zeroRated.cgst, zeroRated.sgst, zeroRated.igst + zeroRated.cgst + zeroRated.sgst],
    ['Reverse Charge Liability (3.1d)', rcm.igst, rcm.cgst, rcm.sgst, rcm.igst + rcm.cgst + rcm.sgst],
    ['Total Output Tax Liability', total.igst, total.cgst, total.sgst, total.igst + total.cgst + total.sgst],
    ['ITC Available (4A, gross)', itcAvailGross.igst, itcAvailGross.cgst, itcAvailGross.sgst, itcAvailGross.igst + itcAvailGross.cgst + itcAvailGross.sgst],
    ['ITC Reversed (4B)', itcRevSum.igst, itcRevSum.cgst, itcRevSum.sgst, itcRevSum.igst + itcRevSum.cgst + itcRevSum.sgst],
    ['Net ITC Available (4C)', itcNet.igst, itcNet.cgst, itcNet.sgst, itcNet.igst + itcNet.cgst + itcNet.sgst],
    ['Cash Paid (as filed)', '', '', '', num(tt.tt_csh_pd)],
    ['Total Payable (as filed)', '', '', '', num(tt.tt_pay)],
  ];

  return {
    title: 'Tax Liability and ITC Summary',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   One-page digest of the as-filed GSTR-3B, pulled directly from the portal — see GSTR-3B (Filed on Portal) for the full table-wise breakdown. The last two rows are aggregate-only (the portal doesn't split cash paid / total payable by tax head).`,
    headers: ['Component', 'IGST', 'CGST', 'SGST', 'Total'],
    rows,
    fileNameBase: `Tax_Liability_ITC_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [30, 14, 14, 14, 14],
  };
};

// ────────── REPORT 3: Tax Liability Other Than Export/Reverse Charge ─────

// Each section less its reverse charge, SEZ and export parts (B2B's parts are
// sections of their own; the notes' are sub_sections, CDNR's named by sec_nm,
// CDNUR's by typ). What is left is GSTR-3B 3.1(a)'s own tax: regular B2B
// (4A), deemed exports (6C), B2C, and their notes. An older pull without the
// parts keeps the whole section.
const DOMESTIC_SECTIONS: [string, string, string[]][] = [
  ['B2B', 'B2B Invoices', ['B2B_4B', 'B2B_SEZWP', 'B2B_SEZWOP']],
  ['B2CL', 'B2C (Large)', []],
  ['B2CS', 'B2C (Small)', []],
  ['CDNR', 'Credit/Debit Notes (Registered)', ['CDNR_4B', 'CDNR_SEZWP', 'CDNR_SEZWOP']],
  ['CDNUR', 'Credit/Debit Notes (Unregistered)', ['EXPWP', 'EXPWOP']],
];
const partOf = (byName: Map<string | undefined, Gstr1Section>, sec: Gstr1Section, part: string): Gstr1Section | undefined =>
  byName.get(part) ?? (sec.sub_sections || []).find((x) => x.sec_nm === part || x.typ === part);

export const buildTaxLiabilityExclExportRcmReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr1(clientId, client, month);
  const byName = new Map((s.sec_sum || []).map((sec) => [sec.sec_nm, sec]));

  let totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = DOMESTIC_SECTIONS
    .map(([code, label, leaveOut]) => {
      const sec = byName.get(code);
      if (!sec) return null;
      const parts = leaveOut.map((p) => partOf(byName, sec, p)).filter((p): p is Gstr1Section => !!p);
      const less = (f: (x: Gstr1Section) => number) => f(sec) - parts.reduce((a, p) => a + f(p), 0);
      // ttl_val is the invoice value, tax included; the taxable value is ttl_tax (see gstr1Taxable).
      const tx = less(gstr1Taxable), i = less((x) => num(x.ttl_igst)), c = less((x) => num(x.ttl_cgst)), sg = less((x) => num(x.ttl_sgst)), cess = less((x) => num(x.ttl_cess));
      totTx += tx; totI += i; totC += c; totS += sg; totCess += cess;
      return [label, tx, i, c, sg, cess, i + c + sg + cess];
    })
    .filter((r): r is (string | number)[] => r !== null);
  rows.push(['TOTAL', totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'Tax Liability Other Than Export/Reverse Charge',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   Domestic taxable supplies from the as-filed GSTR-1, by SECTION — the portal's own summary API totals each section but doesn't expose a rate-wise split within it, so this is grouped by section instead of by rate (the earlier computed-draft version of this report was rate-wise). B2B and the notes leave out reverse charge (4B), supplies to an SEZ and notes against exports, where the pull has those parts. Excludes exports/SEZ (their own report) and Nil-rated/Exempt.`,
    headers: ['Section', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `Tax_Liability_Excl_Export_RCM_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 14, 14, 14, 12, 14],
  };
};

// ────────── REPORT 4: Tax Liability Due to Reverse Charge ────────────────

interface BuilderRcmRow { taxable_value: number | null; cgst: number | null; sgst: number | null; }

export const buildTaxLiabilityRcmReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const rcm = s.sup_details?.isup_rev || {};
  const fsiRes = await supabase.from('builder_rcm_postings').select('taxable_value, cgst, sgst').eq('client_id', clientId).eq('period_month', month);
  const fsiRows = (fsiRes.data || []) as BuilderRcmRow[];

  const rows: (string | number)[][] = [
    ['Inward supplies liable to reverse charge (3.1d, as filed)', num(rcm.txval), num(rcm.iamt), num(rcm.camt), num(rcm.samt), num(rcm.iamt) + num(rcm.camt) + num(rcm.samt)],
  ];
  if (fsiRows.length > 0) {
    const fsiTotals = fsiRows.reduce((a, r) => ({ txval: a.txval + num(r.taxable_value), cgst: a.cgst + num(r.cgst), sgst: a.sgst + num(r.sgst) }), { txval: 0, cgst: 0, sgst: 0 });
    rows.push(['Builder TDR/FSI Reverse Charge (own books — not on the GST portal)', fsiTotals.txval, 0, fsiTotals.cgst, fsiTotals.sgst, fsiTotals.cgst + fsiTotals.sgst]);
  }
  const totTx = num(rcm.txval) + fsiRows.reduce((a, r) => a + num(r.taxable_value), 0);
  const totI = num(rcm.iamt);
  const totC = num(rcm.camt) + fsiRows.reduce((a, r) => a + num(r.cgst), 0);
  const totS = num(rcm.samt) + fsiRows.reduce((a, r) => a + num(r.sgst), 0);
  rows.push(['TOTAL', totTx, totI, totC, totS, totI + totC + totS]);

  return {
    title: 'Tax Liability Due to Reverse Charge',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   RCM liability as filed on the portal's GSTR-3B (Table 3.1(d)) — the portal reports this as one aggregate figure, not rate-wise, so the earlier computed-draft version's rate breakdown (5%/18% inter/intra-state) isn't reproducible from portal data and has been dropped. Builder TDR/FSI stays as a separate line since it's the firm's own books entry, not GST-portal data.`,
    headers: ['Head', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Tax'],
    rows,
    fileNameBase: `Tax_Liability_RCM_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [40, 18, 14, 14, 14, 14],
  };
};

// ────────── REPORT 5: Tax Liability Due to Export and SEZ Supplies ───────

// The zero rated supplies of GSTR-3B 3.1(b): exports (6A), supplies to an SEZ
// (6B) and the notes against them (9B). Deemed exports (6C) are not zero
// rated: they sit in 3.1(a) and are not here.
const ZERO_RATED_PARTS: [string, string, string, string?][] = [
  // [table, description, section, part]
  ['6A', 'Exports', 'EXP'],
  ['6B', 'Supplies to SEZ with payment of tax', 'B2B_SEZWP'],
  ['6B', 'Supplies to SEZ without payment of tax', 'B2B_SEZWOP'],
  ['9B', 'Credit/debit notes, SEZ with payment', 'CDNR', 'CDNR_SEZWP'],
  ['9B', 'Credit/debit notes, SEZ without payment', 'CDNR', 'CDNR_SEZWOP'],
  ['9B', 'Credit/debit notes, exports with payment', 'CDNUR', 'EXPWP'],
  ['9B', 'Credit/debit notes, exports without payment', 'CDNUR', 'EXPWOP'],
];

export const buildTaxLiabilityExportSezReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr1(clientId, client, month);
  const byName = new Map((s.sec_sum || []).map((sec) => [sec.sec_nm, sec]));

  const rows: (string | number)[][] = [];
  // Table 6A states each export's taxable value and its invoice value (taxable
  // plus the IGST on an export with payment) apart, so both are shown; ttl_val
  // is the invoice value, not the taxable value (see gstr1Taxable).
  for (const [table, label, code, part] of ZERO_RATED_PARTS) {
    const top = byName.get(code);
    const sec = top && part ? (top.sub_sections || []).find((x) => x.sec_nm === part || x.typ === part) : top;
    if (!sec) continue;
    // A note line only when there is a note: most months have none.
    if (part && !num(sec.ttl_rec) && !gstr1Taxable(sec) && !num(sec.ttl_igst) && !num(sec.ttl_cess)) continue;
    rows.push([table, label, num(sec.ttl_rec), gstr1Taxable(sec), gstr1InvoiceValue(sec) ?? '', num(sec.ttl_igst), num(sec.ttl_cgst), num(sec.ttl_sgst), num(sec.ttl_cess)]);
  }
  const tot = (c: number) => rows.reduce((a, r) => a + num(r[c]), 0);
  rows.push(['', 'TOTAL', '', tot(3), tot(4), tot(5), tot(6), tot(7), tot(8)]);

  return {
    title: 'Tax Liability Due to Export and SEZ Supplies',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   The zero rated supplies of GSTR-3B Table 3.1(b), from the as-filed GSTR-1: exports (6A), supplies to an SEZ unit or developer (6B, from the portal's B2B_SEZWP and B2B_SEZWOP), and the credit and debit notes against them (9B), shown as the portal states them. Deemed exports (6C) are not zero rated and stay in 3.1(a). An older pull without the B2B parts shows exports only.`,
    headers: ['Table', 'Description', 'Count', 'Taxable Value', 'Invoice Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    rows,
    fileNameBase: `Tax_Liability_Export_SEZ_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 45, 8, 16, 16, 14, 14, 14, 12],
  };
};

// ────────── REPORT 6: ITC Claimed and Due (Other Than Import of Goods) ───

export const buildItcClaimedExclImportGoodsReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const srNoOf = ['(1)', '(2)', '(3)', '(4)', '(5)'];

  let totI = 0, totC = 0, totS = 0;
  const rows: (string | number)[][] = ITC_AVL_ROWS.slice(1).map(([ty, label], idx) => {
    const r = findItc(s.itc_elg?.itc_avl, ty);
    const i = num(r.iamt), c = num(r.camt), sg = num(r.samt);
    totI += i; totC += c; totS += sg;
    return [srNoOf[idx + 1], label, i, c, sg, i + c + sg];
  });
  rows.push(['', 'TOTAL', totI, totC, totS, totI + totC + totS]);

  return {
    title: 'ITC Claimed and Due (Other Than Import of Goods)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   GSTR-3B Table 4(A) rows (2)-(5), as filed on the portal.`,
    headers: ['Row', 'Description', 'IGST', 'CGST', 'SGST', 'Total'],
    rows,
    fileNameBase: `ITC_Claimed_Excl_Import_Goods_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 50, 14, 14, 14, 14],
  };
};

// ────────── REPORT 7: ITC Claimed and Due (Import of Goods) ──────────────

export const buildItcClaimedImportGoodsReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const impg = findItc(s.itc_elg?.itc_avl, 'IMPG');
  const i = num(impg.iamt), c = num(impg.camt), sg = num(impg.samt);

  const rows: (string | number)[][] = [
    ['(1)', 'Import of goods', i, c, sg, i + c + sg],
  ];

  return {
    title: 'ITC Claimed and Due (Import of Goods)',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   GSTR-3B Table 4(A)(1) — import of goods, as filed on the portal.`,
    headers: ['Row', 'Description', 'IGST', 'CGST', 'SGST', 'Total'],
    rows,
    fileNameBase: `ITC_Claimed_Import_Goods_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 40, 14, 14, 14, 14],
  };
};

// ────────── REPORT 8: RCM Liability Declared and ITC Claimed Thereon ─────

export const buildRcmLiabilityVsItcReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClient(clientId);
  const { row, s } = await fetchFiledGstr3b(clientId, client, month);
  const rcmLiab = s.sup_details?.isup_rev || {};
  const rcmItc = findItc(s.itc_elg?.itc_avl, 'ISRC');

  const li = num(rcmLiab.iamt), lc = num(rcmLiab.camt), ls = num(rcmLiab.samt);
  const ii = num(rcmItc.iamt), ic = num(rcmItc.camt), is = num(rcmItc.samt);

  const rows: (string | number)[][] = [
    ['IGST', li, ii, li - ii],
    ['CGST', lc, ic, lc - ic],
    ['SGST', ls, is, ls - is],
    ['Total', li + lc + ls, ii + ic + is, (li + lc + ls) - (ii + ic + is)],
  ];

  return {
    title: 'Reverse Charge Liability Declared and ITC Claimed Thereon',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ARN: ${row.arn || '—'}   |   Table 3.1(d) RCM liability vs Table 4(A)(3) RCM ITC, both as filed on the portal's GSTR-3B. A variance here is real — it means the return itself declared RCM liability and RCM ITC that don't match, not a computation artifact.`,
    headers: ['Tax Head', 'RCM Liability Declared (3.1d)', 'RCM ITC Claimed (4A(3))', 'Variance'],
    rows,
    fileNameBase: `RCM_Liability_vs_ITC_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [12, 22, 20, 14],
  };
};
