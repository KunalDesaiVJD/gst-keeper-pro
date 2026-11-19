import { supabase } from '@/integrations/supabase/client';

export interface Table4Heads { igst: number; cgst: number; sgst: number }

/**
 * The GSTR-3B Adjustments rows of a month that fall in Table 4: 4A(5) (added
 * to All other ITC) and 4B(1) (added to the Rule 38/42/43 & 17(5) reversal).
 * GSTR-3B folds them in on top of ITC Summary (buildGstr3bJson.ts, sumAdj),
 * and they never sit in itc_summaries.data. The Builder ITC reversal at
 * completion (Rule 42/43, builder_itc_reversal_workings) is posted this way
 * as a 4B(1) row, so a reader of Net ITC that skips them overstates 4C by the
 * whole reversal (GST Receivable Reco, gst_receivable_reco_difference,
 * 20261119100000).
 */
export interface Table4Adjustments { a5: Table4Heads; b1: Table4Heads; count: number }

const zero = (): Table4Heads => ({ igst: 0, cgst: 0, sgst: 0 });

export const sumTable4Adjustments = (
  rows: { table_ref?: string | null; igst?: number | string | null; cgst?: number | string | null; sgst?: number | string | null }[] | null | undefined,
): Table4Adjustments => {
  const out: Table4Adjustments = { a5: zero(), b1: zero(), count: 0 };
  for (const r of rows || []) {
    const into = r.table_ref === '4A(5)' ? out.a5 : r.table_ref === '4B(1)' ? out.b1 : null;
    if (!into) continue;
    into.igst += Number(r.igst) || 0;
    into.cgst += Number(r.cgst) || 0;
    into.sgst += Number(r.sgst) || 0;
    out.count += 1;
  }
  return out;
};

export async function fetchTable4Adjustments(clientId: string, periodMonth: string): Promise<Table4Adjustments> {
  const { data, error } = await supabase
    .from('gstr3b_adjustments')
    .select('table_ref, igst, cgst, sgst')
    .eq('client_id', clientId).eq('period_month', periodMonth)
    .in('table_ref', ['4A(5)', '4B(1)']);
  if (error) throw new Error(`the GSTR-3B adjustments (gstr3b_adjustments) of ${periodMonth}: ${error.message}`);
  return sumTable4Adjustments(data as any);
}
