// Fetches the three sources GSTR-3B is assembled from — GSTR-1 (outward),
// ITC Summary (Table 4) and RCM Summary (inward RCM) — and runs them through
// buildGstr3bJson(). Shared by the GSTR-3B page and the "Prepare GSTR-3B"
// dialog so both compute the return the exact same way.

import { supabase } from '@/integrations/supabase/client';
import { buildGstr3bJson, type Gstr3bResult, type ItcData, type RcmTotals } from './buildGstr3bJson';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShort = (mmYyyy: string) => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}` : '';
};

export async function fetchGstr3b(
  clientId: string,
  gstin: string,
  periodMonth: string, // MM/YYYY
): Promise<Gstr3bResult> {
  const short = toShort(periodMonth);
  const [g, itcRes, rcmRes] = await Promise.all([
    supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', short).maybeSingle(),
    supabase.from('itc_summaries').select('data').eq('client_id', clientId).eq('period_month', periodMonth).maybeSingle(),
    supabase.from('rcm_data').select('taxable_value, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).eq('month', short),
  ]);

  let itc: ItcData | null = null;
  const rawItc = (itcRes.data as any)?.data;
  const parsed = typeof rawItc === 'string' ? JSON.parse(rawItc) : rawItc;
  if (parsed) itc = { section4A: parsed.section4A || [], section4B: parsed.section4B || [], section4D: parsed.section4D || [] };

  const rcmRows = ((rcmRes.data as any[]) || []);
  const rcm: RcmTotals = rcmRows.reduce((a, r) => ({
    taxable: a.taxable + (r.taxable_value || 0),
    igst: a.igst + (r.igst_5 || 0) + (r.igst_18 || 0),
    cgst: a.cgst + (r.cgst_2_5 || 0) + (r.cgst_9 || 0),
    sgst: a.sgst + (r.sgst_2_5 || 0) + (r.sgst_9 || 0),
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

  return buildGstr3bJson({ gstin, periodMonth, gstr1Raw: (g.data as any)?.raw_json ?? null, itc, rcm });
}
