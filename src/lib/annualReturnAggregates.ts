import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';
import { extractGstr1HsnRows } from '@/utils/buildGstr1Summary';

export interface TaxSum { taxable: number; igst: number; cgst: number; sgst: number; }
const zero = (): TaxSum => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const add = (a: TaxSum, b: Partial<TaxSum>, sign = 1): TaxSum => ({
  taxable: a.taxable + sign * (b.taxable || 0), igst: a.igst + sign * (b.igst || 0),
  cgst: a.cgst + sign * (b.cgst || 0), sgst: a.sgst + sign * (b.sgst || 0),
});
export const taxTotal = (t: TaxSum) => t.igst + t.cgst + t.sgst;

/** PL-Input, totalled per section — the root figures GSTR 9-Input's Input/Input Services/Capital Goods rows read. */
export async function fetchPlInputTotals(clientId: string, financialYear: string) {
  const { data, error } = await supabase.from('pl_input_lines').select('section, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals: Record<'purchase' | 'expense' | 'capital_goods', TaxSum> = { purchase: zero(), expense: zero(), capital_goods: zero() };
  (data || []).forEach((r: { section: 'purchase' | 'expense' | 'capital_goods'; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
    totals[r.section] = add(totals[r.section], { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst });
  });
  return totals;
}

/** PL-Output, totalled per part. */
export async function fetchPlOutputTotals(clientId: string, financialYear: string) {
  const { data, error } = await supabase.from('pl_output_lines').select('part, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals: Record<'A' | 'B', TaxSum> = { A: zero(), B: zero() };
  (data || []).forEach((r: { part: 'A' | 'B'; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
    totals[r.part] = add(totals[r.part], { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst });
  });
  return totals;
}

/** PL-Output Part B, totalled per bifurcation — GSTR-9 Table 5A/5B/5F. */
export async function fetchPlOutputPartBByBifurcation(clientId: string, financialYear: string) {
  const { data, error } = await supabase.from('pl_output_lines').select('bifurcation, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear).eq('part', 'B');
  if (error) throw error;
  const totals: Record<'export_wo_tax' | 'sez_wo_tax' | 'non_gst', TaxSum> = { export_wo_tax: zero(), sez_wo_tax: zero(), non_gst: zero() };
  (data || []).forEach((r: { bifurcation: 'export_wo_tax' | 'sez_wo_tax' | 'non_gst' | null; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
    if (r.bifurcation && totals[r.bifurcation]) totals[r.bifurcation] = add(totals[r.bifurcation], { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst });
  });
  return totals;
}

export interface DutiesTaxesInputAnnual {
  purchase: TaxSum; debitNote: TaxSum; suspendedReversed: TaxSum; suspendedReversed180d: TaxSum;
  suspendedReclaim: TaxSum; suspendedReclaim180d: TaxSum; asPer3b: TaxSum; netPurchase: TaxSum;
  netSuspended: TaxSum; // reversed + reversed180d - reclaim - reclaim180d, still outstanding
  reclaimTotal: TaxSum; // reclaim + reclaim180d, feeds GSTR 9-Input's "ITC Reclaim" row
  reversalTotal: TaxSum; // reversed + reversed180d, feeds GSTR 9-Input's "ITC Reversal" row
  monthsPresent: number;
}

/** Duties & Taxes-Input, summed across the whole FY (including "Last Year Effect"). */
export async function fetchDutiesTaxesInputAnnual(clientId: string, financialYear: string): Promise<DutiesTaxesInputAnnual> {
  const { data, error } = await supabase.from('duties_taxes_input_monthly').select('*').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const acc = {
    purchase: zero(), debitNote: zero(), suspendedReversed: zero(), suspendedReversed180d: zero(),
    suspendedReclaim: zero(), suspendedReclaim180d: zero(), asPer3b: zero(), monthsPresent: 0,
  };
  (data || []).forEach((r: Record<string, number>) => {
    acc.purchase = add(acc.purchase, { igst: r.purchase_igst, cgst: r.purchase_cgst, sgst: r.purchase_sgst });
    acc.debitNote = add(acc.debitNote, { igst: r.debit_note_igst, cgst: r.debit_note_cgst, sgst: r.debit_note_sgst });
    acc.suspendedReversed = add(acc.suspendedReversed, { igst: r.suspended_reversed_igst, cgst: r.suspended_reversed_cgst, sgst: r.suspended_reversed_sgst });
    acc.suspendedReversed180d = add(acc.suspendedReversed180d, { igst: r.suspended_reversed_180d_igst, cgst: r.suspended_reversed_180d_cgst, sgst: r.suspended_reversed_180d_sgst });
    acc.suspendedReclaim = add(acc.suspendedReclaim, { igst: r.suspended_reclaim_igst, cgst: r.suspended_reclaim_cgst, sgst: r.suspended_reclaim_sgst });
    acc.suspendedReclaim180d = add(acc.suspendedReclaim180d, { igst: r.suspended_reclaim_180d_igst, cgst: r.suspended_reclaim_180d_cgst, sgst: r.suspended_reclaim_180d_sgst });
    acc.asPer3b = add(acc.asPer3b, { igst: r.as_per_3b_igst, cgst: r.as_per_3b_cgst, sgst: r.as_per_3b_sgst });
    acc.monthsPresent += 1;
  });
  const netSuspended = add(add(acc.suspendedReversed, acc.suspendedReversed180d), add(acc.suspendedReclaim, acc.suspendedReclaim180d), -1);
  const reclaimTotal = add(acc.suspendedReclaim, acc.suspendedReclaim180d);
  const reversalTotal = add(acc.suspendedReversed, acc.suspendedReversed180d);
  const netPurchase = add(add(acc.purchase, acc.debitNote, -1), netSuspended, -1);
  return { ...acc, netPurchase, netSuspended, reclaimTotal, reversalTotal };
}

export interface DutiesTaxesOutputAnnual { sales: TaxSum; creditNote: TaxSum; netSales: TaxSum; asPer3b: TaxSum; monthsPresent: number; }
export async function fetchDutiesTaxesOutputAnnual(clientId: string, financialYear: string): Promise<DutiesTaxesOutputAnnual> {
  const { data, error } = await supabase.from('duties_taxes_output_monthly').select('*').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const acc = { sales: zero(), creditNote: zero(), asPer3b: zero(), monthsPresent: 0 };
  (data || []).forEach((r: Record<string, number>) => {
    acc.sales = add(acc.sales, { igst: r.sales_igst, cgst: r.sales_cgst, sgst: r.sales_sgst });
    acc.creditNote = add(acc.creditNote, { igst: r.credit_note_igst, cgst: r.credit_note_cgst, sgst: r.credit_note_sgst });
    acc.asPer3b = add(acc.asPer3b, { igst: r.as_per_3b_igst, cgst: r.as_per_3b_cgst, sgst: r.as_per_3b_sgst });
    acc.monthsPresent += 1;
  });
  const netSales = add(acc.sales, acc.creditNote, -1);
  return { ...acc, netSales };
}

export interface RcmTotals { partA: TaxSum & { monthsPresent: number }; partB: TaxSum; }
export async function fetchRcmTotals(clientId: string, financialYear: string): Promise<RcmTotals> {
  const months = monthsForFY(financialYear);
  const [portalRes, booksRes] = await Promise.all([
    supabase.from('gst_filed_returns').select('summary').eq('client_id', clientId).eq('return_type', 'RCM').in('period_month', months),
    supabase.from('rcm_annual_return_lines').select('taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
  ]);
  if (portalRes.error) throw portalRes.error;
  if (booksRes.error) throw booksRes.error;
  let partA = { ...zero(), monthsPresent: 0 };
  (portalRes.data || []).forEach((r: { summary: Record<string, number> | null }) => {
    const s = r.summary || {};
    partA = { taxable: partA.taxable + (s.rcm_taxable || 0), igst: partA.igst + (s.rcm_igst || 0), cgst: partA.cgst + (s.rcm_cgst || 0), sgst: partA.sgst + (s.rcm_sgst || 0), monthsPresent: partA.monthsPresent + 1 };
  });
  let partB = zero();
  (booksRes.data || []).forEach((r: { taxable_value: number; igst: number; cgst: number; sgst: number }) => { partB = add(partB, { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst }); });
  return { partA, partB };
}

/** GSTR-3B ITC claimed, summed across the FY from Portal Capture. */
export async function fetchPortalItcClaimedAnnual(clientId: string, financialYear: string): Promise<TaxSum> {
  const months = monthsForFY(financialYear);
  const { data, error } = await supabase.from('gst_filed_returns').select('summary').eq('client_id', clientId).eq('return_type', 'GSTR-3B').in('period_month', months);
  if (error) throw error;
  let total = zero();
  (data || []).forEach((r: { summary: Record<string, number> | null }) => {
    const s = r.summary || {};
    total = add(total, { igst: s.itc_igst, cgst: s.itc_cgst, sgst: s.itc_sgst });
  });
  return total;
}

/** GSTR-1 turnover, summed across the FY from Portal Capture — the "as per auto-calculated GSTR-9" figure Annexure 1 checks against. */
export async function fetchPortalTurnoverAnnual(clientId: string, financialYear: string): Promise<TaxSum> {
  const months = monthsForFY(financialYear);
  const { data, error } = await supabase.from('gst_filed_returns').select('summary').eq('client_id', clientId).eq('return_type', 'GSTR-1').in('period_month', months);
  if (error) throw error;
  let total = zero();
  (data || []).forEach((r: { summary: Record<string, number> | null }) => {
    const s = r.summary || {};
    total = add(total, { taxable: s.turnover_taxable, igst: s.turnover_igst, cgst: s.turnover_cgst, sgst: s.turnover_sgst });
  });
  return total;
}

export interface TaxHeadPayment { payable: number; paidCash: number; paidItc: number; }
/** Payable vs. paid, per tax head, for the FY — Annexure 1's "Paid & Payable" section and GSTR-9 Table 9. */
export async function fetchTaxPaymentTotals(clientId: string, financialYear: string): Promise<Record<'igst' | 'cgst' | 'sgst', TaxHeadPayment>> {
  const { data, error } = await supabase.from('portal_tax_payment_entries').select('tax_head, payable, paid_cash, paid_itc').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals: Record<'igst' | 'cgst' | 'sgst', TaxHeadPayment> = {
    igst: { payable: 0, paidCash: 0, paidItc: 0 }, cgst: { payable: 0, paidCash: 0, paidItc: 0 }, sgst: { payable: 0, paidCash: 0, paidItc: 0 },
  };
  (data || []).forEach((r: { tax_head: string; payable: number; paid_cash: number; paid_itc: number }) => {
    if (r.tax_head === 'igst' || r.tax_head === 'cgst' || r.tax_head === 'sgst') {
      totals[r.tax_head] = { payable: Number(r.payable), paidCash: Number(r.paid_cash), paidItc: Number(r.paid_itc) };
    }
  });
  return totals;
}

/** ITC as per GSTR-2B, summed across the FY from Portal Capture — Table 8A. */
export async function fetchPortal2bAnnual(clientId: string, financialYear: string): Promise<TaxSum> {
  const months = monthsForFY(financialYear);
  const { data, error } = await supabase.from('gst_filed_returns').select('summary').eq('client_id', clientId).eq('return_type', 'GSTR-2B').in('period_month', months);
  if (error) throw error;
  let total = zero();
  (data || []).forEach((r: { summary: Record<string, number> | null }) => {
    const s = r.summary || {};
    total = add(total, { igst: s.itc2b_igst, cgst: s.itc2b_cgst, sgst: s.itc2b_sgst });
  });
  return total;
}

/** GSTR-1 turnover, summed across the FY, bucketed by portal category (b2c/b2b/sez_with/...) — Table 4/5. */
export async function fetchPortalCategoryTotals(clientId: string, financialYear: string) {
  const { data, error } = await supabase.from('portal_gstr1_category_figures').select('category, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals: Record<string, TaxSum> = { b2c: zero(), b2b: zero(), sez_with: zero(), sez_without: zero(), zero_rated: zero(), deemed_export: zero(), credit_note: zero() };
  (data || []).forEach((r: { category: string; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
    if (totals[r.category]) totals[r.category] = { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst };
  });
  return totals;
}

/** ITC reversal lines (Table 7), summed by rule and combined — closes the gap R4 flagged. */
export async function fetchItcReversalTotals(clientId: string, financialYear: string) {
  const { data, error } = await supabase.from('itc_reversal_lines').select('rule, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  let total = zero();
  const byRule: Record<string, TaxSum> = {};
  (data || []).forEach((r: { rule: string; igst: number; cgst: number; sgst: number }) => {
    const v = { taxable: 0, igst: r.igst, cgst: r.cgst, sgst: r.sgst };
    byRule[r.rule] = v;
    total = add(total, v);
  });
  return { total, byRule };
}

/** Next-year carry-forward items for a (client, FY), split by direction. */
export async function fetchCarryForwardTotals(clientId: string, financialYear: string) {
  const { data, error } = await supabase.from('annual_return_carry_forward').select('direction, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals: Record<string, TaxSum> = {
    claimed_in_next_fy: zero(), claimed_from_prev_fy: zero(), turnover_declared_next_fy: zero(), turnover_reduced_next_fy: zero(),
  };
  (data || []).forEach((r: { direction: string; taxable_value: number; igst: number; cgst: number; sgst: number }) => {
    if (totals[r.direction]) totals[r.direction] = add(totals[r.direction], { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst });
  });
  return totals;
}

export interface Table17Row {
  hsn: string; desc: string; uqc: string; qty: number; rate: number;
  taxable: number; igst: number; cgst: number; sgst: number; cess: number;
}
/**
 * GSTR-9 Table 17 — HSN-wise summary of outward supplies (portal roadmap,
 * 27 Aug 2026). Aggregated across every imported month of gstr1_data for
 * the FY, keyed by (HSN code, rate) — the same pairing the portal itself
 * groups by, since one HSN can carry line items at more than one rate.
 * Nothing here is manually entered; it's entirely derived from GSTR-1 data
 * already imported elsewhere in the app.
 */
export async function fetchTable17HsnOutward(clientId: string, financialYear: string): Promise<{ rows: Table17Row[]; monthsPresent: number; monthsTotal: number }> {
  const months = monthsForFY(financialYear);
  const { data, error } = await supabase.from('gstr1_data').select('period_month, raw_json').eq('client_id', clientId).in('period_month', months);
  if (error) throw error;
  const byKey: Record<string, Table17Row> = {};
  let monthsPresent = 0;
  (data || []).forEach((r: { period_month: string; raw_json: unknown }) => {
    if (!r.raw_json) return;
    monthsPresent += 1;
    extractGstr1HsnRows(r.raw_json).forEach((h) => {
      const key = `${h.hsn_sc}__${h.rt}`;
      if (!byKey[key]) byKey[key] = { hsn: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: 0, rate: h.rt, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      const row = byKey[key];
      if (!row.desc && h.desc) row.desc = h.desc;
      if (!row.uqc && h.uqc) row.uqc = h.uqc;
      row.qty += h.qty;
      row.taxable += h.txval;
      row.igst += h.iamt;
      row.cgst += h.camt;
      row.sgst += h.samt;
      row.cess += h.csamt;
    });
  });
  return {
    rows: Object.values(byKey).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
    monthsPresent,
    monthsTotal: months.length,
  };
}

export type Table14TaxHead = 'igst' | 'cgst' | 'sgst' | 'cess' | 'interest';
export interface Table14Row { payable: number; paid: number; }
/** GSTR-9 Table 14 — differential tax paid on the Table 10/11 declarations (portal roadmap, 27 Aug 2026). */
export async function fetchTable14DifferentialTax(clientId: string, financialYear: string): Promise<Record<Table14TaxHead, Table14Row>> {
  const { data, error } = await supabase.from('gstr9_table14_differential_tax').select('tax_head, payable, paid').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals: Record<Table14TaxHead, Table14Row> = {
    igst: { payable: 0, paid: 0 }, cgst: { payable: 0, paid: 0 }, sgst: { payable: 0, paid: 0 }, cess: { payable: 0, paid: 0 }, interest: { payable: 0, paid: 0 },
  };
  (data || []).forEach((r: { tax_head: Table14TaxHead; payable: number; paid: number }) => {
    if (totals[r.tax_head]) totals[r.tax_head] = { payable: Number(r.payable), paid: Number(r.paid) };
  });
  return totals;
}

export type Table15RowKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export interface Table15Row { central_tax: number; state_tax: number; integrated_tax: number; cess: number; interest: number; penalty: number; }
const TABLE15_ROW_KEYS: Table15RowKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** GSTR-9 Table 15 — Demands and Refunds (portal roadmap, 27 Aug 2026). Standalone manual entry. */
export async function fetchTable15DemandsRefunds(clientId: string, financialYear: string): Promise<Record<Table15RowKey, Table15Row>> {
  const { data, error } = await supabase.from('gstr9_table15_demands_refunds')
    .select('row_key, central_tax, state_tax, integrated_tax, cess, interest, penalty').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals = {} as Record<Table15RowKey, Table15Row>;
  TABLE15_ROW_KEYS.forEach((k) => { totals[k] = { central_tax: 0, state_tax: 0, integrated_tax: 0, cess: 0, interest: 0, penalty: 0 }; });
  (data || []).forEach((r: { row_key: Table15RowKey } & Table15Row) => {
    if (totals[r.row_key]) totals[r.row_key] = { central_tax: Number(r.central_tax), state_tax: Number(r.state_tax), integrated_tax: Number(r.integrated_tax), cess: Number(r.cess), interest: Number(r.interest), penalty: Number(r.penalty) };
  });
  return totals;
}

export type Table16RowKey = 'A' | 'B' | 'C';
export interface Table16Row { taxable_value: number; central_tax: number; state_tax: number; integrated_tax: number; cess: number; }
const TABLE16_ROW_KEYS: Table16RowKey[] = ['A', 'B', 'C'];
/** GSTR-9 Table 16 — Composition/deemed-supply/approval-basis (portal roadmap, 27 Aug 2026). Standalone manual entry. */
export async function fetchTable16CompositionDeemedApproval(clientId: string, financialYear: string): Promise<Record<Table16RowKey, Table16Row>> {
  const { data, error } = await supabase.from('gstr9_table16_composition_deemed_approval')
    .select('row_key, taxable_value, central_tax, state_tax, integrated_tax, cess').eq('client_id', clientId).eq('financial_year', financialYear);
  if (error) throw error;
  const totals = {} as Record<Table16RowKey, Table16Row>;
  TABLE16_ROW_KEYS.forEach((k) => { totals[k] = { taxable_value: 0, central_tax: 0, state_tax: 0, integrated_tax: 0, cess: 0 }; });
  (data || []).forEach((r: { row_key: Table16RowKey } & Table16Row) => {
    if (totals[r.row_key]) totals[r.row_key] = { taxable_value: Number(r.taxable_value), central_tax: Number(r.central_tax), state_tax: Number(r.state_tax), integrated_tax: Number(r.integrated_tax), cess: Number(r.cess) };
  });
  return totals;
}
