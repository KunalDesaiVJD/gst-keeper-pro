import { supabase } from '@/integrations/supabase/client';
import {
  fetchGstr9cTable5TurnoverReco, computeGstr9cTable5P,
  fetchGstr9cTable7TaxableTurnoverReco,
  fetchGstr9cTable9RateWiseLiabilityReco, computeGstr9cTable9P,
  fetchGstr9cTable11AdditionalLiability,
  fetchGstr9cTable12NetItc,
  fetchGstr9cTable14ByExpenseHead,
  fetchGstr9cTable16TaxPayable,
  fetchGstr9cPartVAdditionalLiability,
  fetchGstr9cCertification,
  fetchReconciliationReason,
} from '@/lib/annualReturnAggregates';

/**
 * GSTR-9C data export, "unverified format" (roadmap step 9, portal-push
 * path 1b, 28 Aug 2026). Mirrors the real GSTR_9C_Offline_Utility.xlsm's
 * (v2.8) own sheet/row layout — same table numbers, same letter-coded
 * rows, same field groupings — but this is NOT the utility's actual JSON
 * import/export schema, which is not available to verify against. Field
 * NAMES here are descriptive labels chosen for readability, not the
 * utility's real internal keys. Treat this as a structured cross-check
 * export, not an upload-ready file, until someone has tried importing it
 * into the real offline utility and confirmed what it actually accepts.
 */
export async function buildGstr9cExport(clientId: string, financialYear: string): Promise<Record<string, unknown>> {
  const { data: client } = await supabase.from('clients').select('name, gstin').eq('id', clientId).maybeSingle();

  const [t5, t7, t9, t11, t12, t14, t16, partV, cert, reason6, reason8, reason10, reason13, reason15] = await Promise.all([
    fetchGstr9cTable5TurnoverReco(clientId, financialYear),
    fetchGstr9cTable7TaxableTurnoverReco(clientId, financialYear),
    fetchGstr9cTable9RateWiseLiabilityReco(clientId, financialYear),
    fetchGstr9cTable11AdditionalLiability(clientId, financialYear),
    fetchGstr9cTable12NetItc(clientId, financialYear),
    fetchGstr9cTable14ByExpenseHead(clientId, financialYear),
    fetchGstr9cTable16TaxPayable(clientId, financialYear),
    fetchGstr9cPartVAdditionalLiability(clientId, financialYear),
    fetchGstr9cCertification(clientId, financialYear),
    fetchReconciliationReason(clientId, financialYear, 'gstr9c_table6_gross_turnover'),
    fetchReconciliationReason(clientId, financialYear, 'gstr9c_table8_taxable_turnover'),
    fetchReconciliationReason(clientId, financialYear, 'gstr9c_table10_rate_wise_liability'),
    fetchReconciliationReason(clientId, financialYear, 'gstr9c_table13_itc_reasons'),
    fetchReconciliationReason(clientId, financialYear, 'gstr9c_table15_itc_reasons'),
  ]);

  const t5P = computeGstr9cTable5P(t5);
  const t5R = t5.Q - t5P;

  const t7E = t7 ? (computeGstr9cTable5P(t5) - t7.B - t7.C - t7.D - t7.D1) : 0;
  const t7G = t7.F - t7E;

  const t9P = computeGstr9cTable9P(t9);
  const t9R = {
    central_tax: t9.Q.central_tax - t9P.central_tax,
    state_tax: t9.Q.state_tax - t9P.state_tax,
    integrated_tax: t9.Q.integrated_tax - t9P.integrated_tax,
    cess: t9.Q.cess - t9P.cess,
  };

  const t12D = t12.itc_per_financials + t12.itc_earlier_fy_claimed_this_fy - t12.itc_this_fy_claimed_later_fy;
  const t14TotalItc = Object.values(t14.heads).reduce((s, h) => s + h.totalItc, 0);
  const t14T = t14TotalItc - t14.gstr9InputTotal;

  return {
    _disclaimer: 'Best-effort structured export mirroring the GSTR-9C offline utility\'s own sheet/row layout (GSTR_9C_Offline_Utility.xlsm v2.8). NOT verified against the utility\'s actual JSON import/export format — test by importing into the real offline utility before relying on this for filing.',
    gstin: client?.gstin || '',
    legal_name: client?.name || '',
    financial_year: financialYear,
    generated_at: new Date().toISOString(),
    part_ii: {
      table_5_reconciliation_of_gross_turnover: { ...t5, P_annual_turnover_after_adjustments: t5P, R_unreconciled_turnover: t5R },
      table_6_reasons_for_unreconciled_turnover: reason6,
      table_7_reconciliation_of_taxable_turnover: { A_annual_turnover_after_adjustments: t5P, ...t7, E_taxable_turnover: t7E, G_unreconciled_taxable_turnover: t7G },
      table_8_reasons_for_unreconciled_taxable_turnover: reason8,
    },
    part_iii: {
      table_9_reconciliation_of_rate_wise_liability: { rows: t9, P_total_amount_payable: t9P, R_unreconciled_payment: t9R },
      table_10_reasons_for_unreconciled_payment: reason10,
      table_11_additional_amount_payable_but_not_paid: t11,
    },
    part_iv: {
      table_12_reconciliation_of_net_itc: {
        A_itc_per_audited_financials: t12.itc_per_financials,
        B_itc_earlier_fy_claimed_this_fy: t12.itc_earlier_fy_claimed_this_fy,
        C_itc_this_fy_claimed_later_fy: t12.itc_this_fy_claimed_later_fy,
        D_itc_per_books: t12D,
        E_itc_claimed_in_gstr9: t14.gstr9InputTotal,
        F_unreconciled_itc: t14.gstr9InputTotal - t12D,
      },
      table_13_reasons_for_unreconciled_itc: reason13,
      table_14_itc_by_expense_head: { heads: t14.heads, S_itc_claimed_in_gstr9: t14.gstr9InputTotal, T_unreconciled: t14T },
      table_15_reasons_for_unreconciled_itc_by_head: reason15,
      table_16_tax_payable_on_unreconciled_itc: t16,
    },
    part_v: {
      additional_liability_due_to_non_reconciliation: partV,
      certification: cert,
    },
  };
}

export async function downloadGstr9cExport(clientId: string, financialYear: string): Promise<void> {
  const payload = await buildGstr9cExport(clientId, financialYear);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GSTR9C_${String(payload.legal_name || 'client').replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}_UNVERIFIED.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
