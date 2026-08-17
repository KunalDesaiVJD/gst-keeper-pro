import { supabase } from '@/integrations/supabase/client';

// Mirrors the "DIFFERENCE" figure on the Suspended Reco page
// (src/pages/SuspendedRecoPage.tsx) — same source tables, same formula, same
// Rs.10 tolerance. Kept here so the GSTR-3B push validation can read the
// live figure without re-deriving it independently; if that page's formula
// changes, update both.

export interface RecoDiffResult {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

const getMonthPatterns = (monthStr: string) => {
  const [monthNum, year] = monthStr.split('/');
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthName = monthNames[parseInt(monthNum) - 1] || '';
  const yearShort = year?.slice(-2) || '';
  const yearSingle = year?.slice(-1) || '';
  return { monthName, yearShort, yearSingle, fullYear: year || '' };
};

const monthMatchesFn = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
  if (!storedMonth) return false;
  const stored = storedMonth.toLowerCase().trim();
  const { monthName, yearShort, yearSingle, fullYear } = patterns;
  const hasMonth = stored.includes(monthName);
  const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
  return hasMonth && hasYear;
};

const normalizeZero = (num: number): number => {
  if (Object.is(num, -0)) return 0;
  const rounded = Math.round(num * 100) / 100;
  if (rounded === 0 || Object.is(rounded, -0)) return 0;
  return rounded;
};

// Rs.10 rounding tolerance applies from Jun-26 (06/2026) onward, same cutoff
// as the Suspended Reco page's opening-balance flow change.
const NEW_FLOW_FROM = 202606;

export async function computeSuspendedRecoDiff(clientId: string, periodMonth: string): Promise<RecoDiffResult> {
  const [mm, yyyy] = periodMonth.split('/').map(Number);
  const monthSortKey = mm && yyyy ? yyyy * 100 + mm : 0;
  const useNewFlow = monthSortKey >= NEW_FLOW_FROM;
  const applyTolerance = (value: number): number => (useNewFlow ? (Math.abs(value) <= 10 ? 0 : value) : value);

  const { data: suspendedData } = await supabase
    .from('suspended_reco')
    .select('opening_cgst, opening_sgst, opening_igst')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  const openingCgst = Number((suspendedData as any)?.opening_cgst) || 0;
  const openingSgst = Number((suspendedData as any)?.opening_sgst) || 0;
  const openingIgst = Number((suspendedData as any)?.opening_igst) || 0;

  const patterns = getMonthPatterns(periodMonth);

  // 4B(2)(i): reversal bills where reversal_month matches current month
  const { data: reversalBills } = await supabase
    .from('bills_not_in_2b')
    .select('input_igst, input_cgst, input_sgst, reversal_month')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .not('reversal_month', 'is', null);
  const matchingReversals = (reversalBills || []).filter((b) => monthMatchesFn(b.reversal_month, patterns));
  const row4B2i = matchingReversals.reduce((acc, b) => ({
    cgst: acc.cgst + (Number(b.input_cgst) || 0),
    sgst: acc.sgst + (Number(b.input_sgst) || 0),
    igst: acc.igst + (Number(b.input_igst) || 0),
  }), { cgst: 0, sgst: 0, igst: 0 });

  // 5.4 / 4(D) 1.2: reclaim bills where reclaim_month matches current month
  const { data: reclaimBills } = await supabase
    .from('bills_not_in_2b')
    .select('input_igst, input_cgst, input_sgst, reclaim_month, reclaim_subtype')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .not('reclaim_month', 'is', null);
  const matchingReclaims = (reclaimBills || []).filter((b) => monthMatchesFn(b.reclaim_month, patterns));
  const normalReclaims = matchingReclaims.filter((b) => (b as any).reclaim_subtype !== 'EXPENSE_OUT');
  const expenseOutReclaims = matchingReclaims.filter((b) => (b as any).reclaim_subtype === 'EXPENSE_OUT');
  const sumHeads = (bills: typeof matchingReclaims) => bills.reduce((acc, b) => ({
    cgst: acc.cgst + (Number(b.input_cgst) || 0),
    sgst: acc.sgst + (Number(b.input_sgst) || 0),
    igst: acc.igst + (Number(b.input_igst) || 0),
  }), { cgst: 0, sgst: 0, igst: 0 });
  const row54 = sumHeads(normalReclaims);
  const row4D12FromBills = sumHeads(expenseOutReclaims);

  let row4B2ii = { cgst: 0, sgst: 0, igst: 0 };
  let row55 = { cgst: 0, sgst: 0, igst: 0 };
  let row4D12FromItc = { cgst: 0, sgst: 0, igst: 0 };
  const { data: itcData } = await supabase
    .from('itc_summaries')
    .select('data')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (itcData?.data) {
    const itc = itcData.data as any;
    const section4A = itc.section4A || [];
    const section4B = itc.section4B || [];
    const section4D = itc.section4D || [];
    const found4B2ii = section4B.find((r: any) => r.srNo === '(ii)' || r.srNo === '4(B)(2)(ii)' || (r.particular && r.particular.includes('ITC Reversal for previous months')));
    if (found4B2ii) row4B2ii = { cgst: Number(found4B2ii.cgst) || 0, sgst: Number(found4B2ii.sgst) || 0, igst: Number(found4B2ii.igst) || 0 };
    const found55 = section4A.find((r: any) => r.srNo === '5.5');
    if (found55) row55 = { cgst: Number(found55.cgst) || 0, sgst: Number(found55.sgst) || 0, igst: Number(found55.igst) || 0 };
    const found4D12 = section4D.find((r: any) => r.srNo === '1.2');
    row4D12FromItc = {
      cgst: Number(found4D12?.cgst) || 0,
      sgst: Number(found4D12?.sgst) || 0,
      igst: Number(found4D12?.igst) || 0,
    };
  }
  const row4D12 = {
    cgst: Math.max(row4D12FromBills.cgst, row4D12FromItc.cgst),
    sgst: Math.max(row4D12FromBills.sgst, row4D12FromItc.sgst),
    igst: Math.max(row4D12FromBills.igst, row4D12FromItc.igst),
  };

  const portalCgst = row4B2i.cgst + row4B2ii.cgst - row54.cgst - row55.cgst - row4D12.cgst;
  const portalSgst = row4B2i.sgst + row4B2ii.sgst - row54.sgst - row55.sgst - row4D12.sgst;
  const portalIgst = row4B2i.igst + row4B2ii.igst - row54.igst - row55.igst - row4D12.igst;

  const { data: booksData } = await supabase
    .from('bills_not_in_2b')
    .select('input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth);
  let booksCgst = 0, booksSgst = 0, booksIgst = 0;
  if (booksData && booksData.length > 0) {
    const filtered = booksData.filter((row) => {
      const reversalBlank = row.reversal_month === null || row.reversal_month === '';
      const reclaimBlank = row.reclaim_month === null || row.reclaim_month === '';
      return reclaimBlank && !reversalBlank;
    });
    const totals = filtered.reduce((acc, row) => ({
      cgst: acc.cgst + (Number(row.input_cgst) || 0),
      sgst: acc.sgst + (Number(row.input_sgst) || 0),
      igst: acc.igst + (Number(row.input_igst) || 0),
    }), { cgst: 0, sgst: 0, igst: 0 });
    booksCgst = totals.cgst; booksSgst = totals.sgst; booksIgst = totals.igst;
  }

  const openingTotal = openingCgst + openingSgst + openingIgst;
  const portalTotal = portalCgst + portalSgst + portalIgst;
  const booksTotal = booksCgst + booksSgst + booksIgst;

  return {
    cgst: applyTolerance(normalizeZero(openingCgst + portalCgst - booksCgst)),
    sgst: applyTolerance(normalizeZero(openingSgst + portalSgst - booksSgst)),
    igst: applyTolerance(normalizeZero(openingIgst + portalIgst - booksIgst)),
    total: applyTolerance(normalizeZero(openingTotal + portalTotal - booksTotal)),
  };
}
