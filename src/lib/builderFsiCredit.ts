import { supabase } from '@/integrations/supabase/client';

export interface FsiCredit { igst: number; cgst: number; sgst: number }

/**
 * The credit of a month's TDR/FSI reverse charge that is available: the
 * commercial leg, in a REP other than an RREP, for a Claim-ITC or Partial-ITC
 * client (builder_rcm_postings.itc_cgst / itc_sgst, 20261025130000). The
 * residential leg's credit is never available. It is wholly attributable to
 * the commercial units, so it sits in 4A(3) outside the Partial-ITC carpet
 * apportionment (docs/BUILDER_GST_POSITIONS.md §12). Intra-state only: CGST
 * and SGST, never IGST.
 */
export async function fetchFsiCredit(clientId: string, periodMonth: string): Promise<FsiCredit> {
  const { data, error } = await supabase
    .from('builder_rcm_postings')
    .select('itc_cgst, itc_sgst')
    .eq('client_id', clientId).eq('period_month', periodMonth);
  if (error) throw new Error(`the FSI reverse charge credit (builder_rcm_postings) of ${periodMonth}: ${error.message}`);
  return sumFsiCredit(data as { itc_cgst: number | null; itc_sgst: number | null }[] | null);
}

export const sumFsiCredit = (rows: { itc_cgst?: number | null; itc_sgst?: number | null }[] | null | undefined): FsiCredit =>
  (rows || []).reduce<FsiCredit>(
    (acc, r) => ({ igst: 0, cgst: acc.cgst + (Number(r.itc_cgst) || 0), sgst: acc.sgst + (Number(r.itc_sgst) || 0) }),
    { igst: 0, cgst: 0, sgst: 0 },
  );
