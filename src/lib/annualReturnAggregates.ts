import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

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
