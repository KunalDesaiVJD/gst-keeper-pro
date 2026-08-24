import { supabase } from '@/integrations/supabase/client';
import {
  fetchPlOutputTotals, fetchPlInputTotals, fetchDutiesTaxesOutputAnnual, fetchDutiesTaxesInputAnnual,
  fetchRcmTotals, fetchPortalItcClaimedAnnual, fetchPortal2bAnnual, fetchPortalCategoryTotals,
  fetchPortalTurnoverAnnual, fetchTaxPaymentTotals, fetchCarryForwardTotals, taxTotal,
} from '@/lib/annualReturnAggregates';

// Same Rs.10 rounding tolerance the rest of the app's books-vs-portal
// diffing uses (suspendedRecoCalc.ts).
export const RECONCILIATION_TOLERANCE = 10;

export type ReconLineKey =
  | 'pl_vs_duties_output' | 'pl_vs_duties_input' | 'rcm_part_a_vs_b'
  | 'gstr9_output_books_vs_portal' | 'table_6_vs_3b' | 'table_8d'
  | 'table_9_igst' | 'table_9_cgst' | 'table_9_sgst'
  | 'income_reco' | 'itc_reco';

export interface ReconLine {
  key: ReconLineKey;
  label: string;
  booksLabel: string;
  portalLabel: string;
  books: number | null;
  portal: number;
  difference: number;
  matched: boolean;
  reason: string;
  reasonEnteredBy: string | null;
  reasonUpdatedAt: string | null;
  reasonRequired: boolean;
}

/**
 * The reconciliation engine, rewired (R7) against the sheet-faithful tables
 * R1-R6 built — replaces the 3-line version that read the old flat
 * books_turnover_lines/books_purchase_lines tables. Every line is computed
 * fresh, never cached; only the reason is persisted (reconciliation_reasons).
 *
 * isNoItcBuilder clients (clients.builder_itc_type = 'NO_ITC') don't need a
 * reason on ITC-related lines — they're not meant to claim ITC at all, so a
 * gap there is expected, not a mismatch (firm decision, 24 Aug 2026).
 */
export async function fetchReconciliationLines(
  clientId: string,
  financialYear: string,
  isNoItcBuilder: boolean,
): Promise<ReconLine[]> {
  const [
    plOutput, plInput, dtOutput, dtInput, rcm, portalItc, portal2b, portalCat, portalTurnover, taxPay, carryForward, reasonsRes,
  ] = await Promise.all([
    fetchPlOutputTotals(clientId, financialYear),
    fetchPlInputTotals(clientId, financialYear),
    fetchDutiesTaxesOutputAnnual(clientId, financialYear),
    fetchDutiesTaxesInputAnnual(clientId, financialYear),
    fetchRcmTotals(clientId, financialYear),
    fetchPortalItcClaimedAnnual(clientId, financialYear),
    fetchPortal2bAnnual(clientId, financialYear),
    fetchPortalCategoryTotals(clientId, financialYear),
    fetchPortalTurnoverAnnual(clientId, financialYear),
    fetchTaxPaymentTotals(clientId, financialYear),
    fetchCarryForwardTotals(clientId, financialYear),
    supabase.from('reconciliation_reasons').select('line_key, reason, entered_by, updated_at').eq('client_id', clientId).eq('financial_year', financialYear),
  ]);
  if (reasonsRes.error) throw reasonsRes.error;

  const reasonMap: Record<string, { reason: string; entered_by: string | null; updated_at: string }> = {};
  (reasonsRes.data || []).forEach((r: { line_key: string; reason: string; entered_by: string | null; updated_at: string }) => { reasonMap[r.line_key] = r; });

  const gstr9OutputBooksRes = await supabase.from('gstr9_output_lines').select('igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear);
  const gstr9OutputBooks = (gstr9OutputBooksRes.data || []).reduce((s: number, r: { igst: number; cgst: number; sgst: number }) => s + Number(r.igst) + Number(r.cgst) + Number(r.sgst), 0);
  const gstr9OutputPortal = ['b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note']
    .reduce((s, c) => s + taxTotal(portalCat[c]), 0);

  const build = (
    key: ReconLineKey, label: string, booksLabel: string, portalLabel: string,
    leftValue: number, rightValue: number, books: number | null, skippable: boolean,
  ): ReconLine => {
    const difference = leftValue - rightValue;
    const matched = Math.abs(difference) <= RECONCILIATION_TOLERANCE;
    const r = reasonMap[key];
    return {
      key, label, booksLabel, portalLabel, books, portal: rightValue, difference, matched,
      reason: r?.reason || '', reasonEnteredBy: r?.entered_by || null, reasonUpdatedAt: r?.updated_at || null,
      reasonRequired: !matched && !(skippable && isNoItcBuilder),
    };
  };

  const plOutputA = taxTotal(plOutput.A);
  const plInputTotal = taxTotal(plInput.purchase) + taxTotal(plInput.expense) + taxTotal(plInput.capital_goods);
  const netSalesDt = taxTotal(dtOutput.netSales);
  const netPurchaseDt = taxTotal(dtInput.netPurchase);
  const rcmA = taxTotal(rcm.partA);
  const rcmB = taxTotal(rcm.partB);
  const itc6O = plInputTotal + rcmB + taxTotal(dtInput.reclaimTotal);
  const portalItcTotal = taxTotal(portalItc);
  const portal2bTotal = taxTotal(portal2b);
  const claimedInNextFy = taxTotal(carryForward.claimed_in_next_fy);
  const table8b = taxTotal(plInput.purchase);

  const portalTurnoverTotal = taxTotal(portalTurnover);
  const netItcAvailed = taxTotal(dtInput.purchase) + rcmB - taxTotal(dtInput.debitNote) - taxTotal(dtInput.netSuspended);
  const annexure2Total = netItcAvailed - claimedInNextFy;
  const annexure2NetItc = portalItcTotal - taxTotal(dtInput.reversalTotal) - taxTotal(carryForward.claimed_from_prev_fy);

  return [
    build('pl_vs_duties_output', 'PL-Output vs Duties & Taxes-Output', 'PL-Output (Part A)', 'Duties & Taxes (Net Sales)', plOutputA, netSalesDt, plOutputA, false),
    build('pl_vs_duties_input', 'PL-Input vs Duties & Taxes-Input', 'PL-Input (all sections)', 'Duties & Taxes (Net Purchase)', plInputTotal, netPurchaseDt, plInputTotal, true),
    build('rcm_part_a_vs_b', 'RCM — Part A vs Part B', 'Part B (books)', 'Part A (portal)', rcmB, rcmA, rcmB, false),
    build('gstr9_output_books_vs_portal', 'GSTR 9-Output — Books vs Portal', 'Books', 'Auto-populated', gstr9OutputBooks, gstr9OutputPortal, gstr9OutputBooks, false),
    build('table_6_vs_3b', 'Table 6O vs 6A (ITC via 3B)', 'Computed (6O)', 'Portal (3B)', itc6O, portalItcTotal, itc6O, true),
    build('table_8d', 'Table 8D — ITC as per 2B vs Claimed', 'Portal (2B available)', 'Computed (6B)', portal2bTotal, table8b, null, true),
    build('table_9_igst', 'Table 9 — IGST payable vs paid', 'Payable', 'Paid (cash+ITC)', taxPay.igst.payable, taxPay.igst.paidCash + taxPay.igst.paidItc, taxPay.igst.payable, false),
    build('table_9_cgst', 'Table 9 — CGST payable vs paid', 'Payable', 'Paid (cash+ITC)', taxPay.cgst.payable, taxPay.cgst.paidCash + taxPay.cgst.paidItc, taxPay.cgst.payable, false),
    build('table_9_sgst', 'Table 9 — SGST payable vs paid', 'Payable', 'Paid (cash+ITC)', taxPay.sgst.payable, taxPay.sgst.paidCash + taxPay.sgst.paidItc, taxPay.sgst.payable, false),
    build('income_reco', 'Annexure 1 — Income Reconciliation', 'Books (turnover + RCM)', 'Portal (GSTR-1)', plOutputA + rcmB, portalTurnoverTotal, plOutputA + rcmB, false),
    build('itc_reco', 'Annexure 2 — Excess ITC Claimed', 'As per reco', 'Net ITC', annexure2Total, annexure2NetItc, annexure2Total, true),
  ];
}

/** True once every reconciliation line either matches or has a reason on file (or is exempt). */
export const isFullyReconciled = (lines: ReconLine[]): boolean => lines.every((l) => l.matched || !l.reasonRequired || l.reason.trim().length > 0);
