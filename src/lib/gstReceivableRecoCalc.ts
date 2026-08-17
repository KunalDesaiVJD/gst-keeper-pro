import { supabase } from '@/integrations/supabase/client';
import { previousPeriodMonthKey } from '@/utils/parseElectronicCreditLedgerCsv';
import { buildGstr3bJson } from '@/utils/buildGstr3bJson';
import type { RecoDiffResult } from './suspendedRecoCalc';

// Mirrors the "DIFFERENCE" figure on the GST Receivable Reco page
// (src/pages/GstReceivableRecoPage.tsx) — same source tables, same cross-head
// set-off simulation, same Rs.10 tolerance. Kept here so the GSTR-3B push
// validation can read the live figure without re-deriving it independently;
// if that page's formula changes, update both.

// GST Receivable Reco only exists from Jun-26 (06/2026) onward.
const RECEIVABLE_FROM = 202606;

interface HeadTriple { igst: number; cgst: number; sgst: number }

function simulateCrossHeadSetOff(liability: HeadTriple, credit: HeadTriple): { debit: HeadTriple; closing: HeadTriple } {
  let Li = Math.max(0, liability.igst), Lc = Math.max(0, liability.cgst), Ls = Math.max(0, liability.sgst);
  let Ci = Math.max(0, credit.igst), Cc = Math.max(0, credit.cgst), Cs = Math.max(0, credit.sgst);
  const take = (avail: number, need: number) => Math.min(Math.max(0, avail), Math.max(0, need));
  let x = take(Ci, Li); Ci -= x; Li -= x;
  x = take(Ci, Math.max(0, Lc - Cc)); Ci -= x; Lc -= x;
  x = take(Ci, Math.max(0, Ls - Cs)); Ci -= x; Ls -= x;
  x = take(Ci, Lc); Ci -= x; Lc -= x;
  x = take(Ci, Ls); Ci -= x; Ls -= x;
  x = take(Cc, Lc); Cc -= x; Lc -= x;
  x = take(Cs, Ls); Cs -= x; Ls -= x;
  x = take(Cc, Li); Cc -= x; Li -= x;
  x = take(Cs, Li); Cs -= x; Li -= x;
  return {
    debit: { igst: Math.max(0, credit.igst) - Ci, cgst: Math.max(0, credit.cgst) - Cc, sgst: Math.max(0, credit.sgst) - Cs },
    closing: { igst: Ci, cgst: Cc, sgst: Cs },
  };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShortMonth = (mmYyyy: string): string => {
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return '';
  return `${MONTH_SHORT[mm - 1]}-${String(yyyy).slice(-2)}`;
};

const getMonthPatterns = (monthStr: string) => {
  const [monthNum, year] = monthStr.split('/');
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthName = monthNames[parseInt(monthNum) - 1] || '';
  const yearShort = year?.slice(-2) || '';
  const yearSingle = year?.slice(-1) || '';
  return { monthName, yearShort, yearSingle, fullYear: year || '' };
};
const monthMatches = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
  if (!storedMonth) return false;
  const stored = storedMonth.toLowerCase().trim();
  const { monthName, yearShort, yearSingle, fullYear } = patterns;
  const hasMonth = stored.includes(monthName);
  const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
  return hasMonth && hasYear;
};

const applyTolerance = (v: number) => (Math.abs(v) <= 10 ? 0 : v);

// Returns null for periods before GST Receivable Reco existed (Jun-26) — the
// page itself has nothing to reconcile before that, so there's no diff to flag.
export async function computeGstReceivableRecoDiff(clientId: string, periodMonth: string): Promise<RecoDiffResult | null> {
  const [mm, yyyy] = periodMonth.split('/').map(Number);
  const monthSortKey = mm && yyyy ? yyyy * 100 + mm : 0;
  if (monthSortKey < RECEIVABLE_FROM) return null;

  const { data: rowData } = await supabase
    .from('gst_receivable_reco' as any)
    .select('opening_cgst, opening_sgst, opening_igst, books_closing_cgst, books_closing_sgst, books_closing_igst, utilized_cgst, utilized_sgst, utilized_igst, drc_cgst, drc_sgst, drc_igst')
    .eq('client_id', clientId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  const r = rowData as any;
  const openingCgst = Number(r?.opening_cgst) || 0;
  const openingSgst = Number(r?.opening_sgst) || 0;
  const openingIgst = Number(r?.opening_igst) || 0;
  const booksClosingCgst = Number(r?.books_closing_cgst) || 0;
  const booksClosingSgst = Number(r?.books_closing_sgst) || 0;
  const booksClosingIgst = Number(r?.books_closing_igst) || 0;
  const drcCgst = Number(r?.drc_cgst) || 0;
  const drcSgst = Number(r?.drc_sgst) || 0;
  const drcIgst = Number(r?.drc_igst) || 0;
  const utilizedFromCsv = r?.utilized_cgst !== null && r?.utilized_cgst !== undefined;
  let utilizedCgst = utilizedFromCsv ? Number(r.utilized_cgst) || 0 : 0;
  let utilizedSgst = utilizedFromCsv ? Number(r.utilized_sgst) || 0 : 0;
  let utilizedIgst = utilizedFromCsv ? Number(r.utilized_igst) || 0 : 0;

  const prevMonth = previousPeriodMonthKey(periodMonth);

  const [{ data: itcData }, { data: prevFilingRows }] = prevMonth
    ? await Promise.all([
        supabase.from('itc_summaries').select('data').eq('client_id', clientId).eq('period_month', prevMonth).maybeSingle(),
        supabase.from('filing_status').select('status').eq('client_id', clientId).eq('period_month', prevMonth).in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']),
      ])
    : [{ data: null }, { data: null }];
  const prevReturnFiled = !!prevFilingRows?.some((f: any) => f.status === 'Filed');

  let availedCgst = 0, availedSgst = 0, availedIgst = 0;
  if (itcData?.data && prevReturnFiled) {
    const itc = itcData.data as any;
    const rowsA: any[] = itc.section4A || [];
    const rowsB: any[] = itc.section4B || [];
    const findRow = (rows: any[], srNo: string) => rows.find((row) => row?.srNo === srNo) || { cgst: 0, sgst: 0, igst: 0 };
    const num = (v: any) => Number(v) || 0;
    const zero3 = { cgst: 0, sgst: 0, igst: 0 };

    const prevShortMonth = prevMonth ? toShortMonth(prevMonth) : '';
    const patterns = prevMonth ? getMonthPatterns(prevMonth) : null;
    const [{ data: rcmRows }, { data: reversalBills }, { data: reclaimBills }] = await Promise.all([
      prevShortMonth
        ? supabase.from('rcm_data').select('cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).eq('month', prevShortMonth)
        : Promise.resolve({ data: null }),
      prevMonth
        ? supabase.from('bills_not_in_2b').select('input_igst, input_cgst, input_sgst, reversal_month').eq('client_id', clientId).eq('period_month', prevMonth).not('reversal_month', 'is', null)
        : Promise.resolve({ data: null }),
      prevMonth
        ? supabase.from('bills_not_in_2b').select('input_igst, input_cgst, input_sgst, reclaim_month, reclaim_subtype').eq('client_id', clientId).eq('period_month', prevMonth).not('reclaim_month', 'is', null)
        : Promise.resolve({ data: null }),
    ]);
    const liveRcmItc = (rcmRows || []).reduce(
      (acc: any, row: any) => ({
        igst: acc.igst + (Number(row.igst_5) || 0) + (Number(row.igst_18) || 0),
        cgst: acc.cgst + (Number(row.cgst_2_5) || 0) + (Number(row.cgst_9) || 0),
        sgst: acc.sgst + (Number(row.sgst_2_5) || 0) + (Number(row.sgst_9) || 0),
      }),
      zero3,
    );
    const liveReversal = patterns
      ? (reversalBills || [])
          .filter((b: any) => monthMatches(b.reversal_month, patterns))
          .reduce((acc: any, b: any) => ({ igst: acc.igst + (b.input_igst || 0), cgst: acc.cgst + (b.input_cgst || 0), sgst: acc.sgst + (b.input_sgst || 0) }), zero3)
      : zero3;
    const liveReclaim = patterns
      ? (reclaimBills || [])
          .filter((b: any) => b.reclaim_subtype !== 'EXPENSE_OUT' && monthMatches(b.reclaim_month, patterns))
          .reduce((acc: any, b: any) => ({ igst: acc.igst + (b.input_igst || 0), cgst: acc.cgst + (b.input_cgst || 0), sgst: acc.sgst + (b.input_sgst || 0) }), zero3)
      : zero3;

    const r51 = findRow(rowsA, '5.1');
    const r52 = findRow(rowsA, '5.2');
    const r53 = findRow(rowsA, '5.3');
    const r55 = findRow(rowsA, '5.5');
    const total5 = {
      cgst: num(r51.cgst) + num(r52.cgst) - num(r53.cgst) + liveReclaim.cgst + num(r55.cgst),
      sgst: num(r51.sgst) + num(r52.sgst) - num(r53.sgst) + liveReclaim.sgst + num(r55.sgst),
      igst: num(r51.igst) + num(r52.igst) - num(r53.igst) + liveReclaim.igst + num(r55.igst),
    };
    const rows1To4 = rowsA.slice(0, 4).reduce(
      (acc, row) => ({
        cgst: acc.cgst + (row?.srNo === '(3)' ? liveRcmItc.cgst : num(row?.cgst)),
        sgst: acc.sgst + (row?.srNo === '(3)' ? liveRcmItc.sgst : num(row?.sgst)),
        igst: acc.igst + (row?.srNo === '(3)' ? liveRcmItc.igst : num(row?.igst)),
      }),
      { cgst: 0, sgst: 0, igst: 0 },
    );
    const total4A = { cgst: rows1To4.cgst + total5.cgst, sgst: rows1To4.sgst + total5.sgst, igst: rows1To4.igst + total5.igst };

    const { data: clientRow } = await supabase
      .from('clients')
      .select('builder_itc_type, commercial_area, residential_area')
      .eq('id', clientId)
      .maybeSingle();
    const isNoITC = (clientRow as any)?.builder_itc_type === 'NO_ITC';
    const isPartialITC = (clientRow as any)?.builder_itc_type === 'PARTIAL_ITC' || isNoITC;

    let total4B: { cgst: number; sgst: number; igst: number };
    if (isPartialITC) {
      const commercialArea = isNoITC ? 0 : (Number((clientRow as any)?.commercial_area) || 0);
      const residentialArea = isNoITC ? 1 : (Number((clientRow as any)?.residential_area) || 0);
      const totalArea = commercialArea + residentialArea;
      const residentialRatio = totalArea > 0 ? residentialArea / totalArea : 0;

      const prevMonthAdjRow = rowsB.find((row: any) => typeof row?.particular === 'string' && row.particular.includes('Previous Month Adjustment'));
      const ii = { cgst: num(prevMonthAdjRow?.cgst), sgst: num(prevMonthAdjRow?.sgst), igst: num(prevMonthAdjRow?.igst) };
      const prevMonthsReversalRow = rowsB.find((row: any) => typeof row?.particular === 'string' && row.particular.includes('previous months, if any'));
      const row2 = {
        cgst: liveReversal.cgst + num(prevMonthsReversalRow?.cgst),
        sgst: liveReversal.sgst + num(prevMonthsReversalRow?.sgst),
        igst: liveReversal.igst + num(prevMonthsReversalRow?.igst),
      };
      const rIn = (x: number) => Math.round(x * 100) / 100;
      const iRow = { cgst: rIn(total4A.cgst * residentialRatio), sgst: rIn(total4A.sgst * residentialRatio), igst: rIn(total4A.igst * residentialRatio) };
      const iiiRow = { cgst: rIn(-row2.cgst * residentialRatio), sgst: rIn(-row2.sgst * residentialRatio), igst: rIn(-row2.igst * residentialRatio) };
      const row1 = { cgst: rIn(iRow.cgst + ii.cgst + iiiRow.cgst), sgst: rIn(iRow.sgst + ii.sgst + iiiRow.sgst), igst: rIn(iRow.igst + ii.igst + iiiRow.igst) };
      total4B = { cgst: row1.cgst + row2.cgst, sgst: row1.sgst + row2.sgst, igst: row1.igst + row2.igst };
    } else {
      total4B = rowsB
        .filter((row) => !row?.isHeader)
        .reduce(
          (acc, row) => {
            const isRecoReversalRow = typeof row?.particular === 'string' && row.particular.includes('current month as per 2B RECO');
            const vals = isRecoReversalRow ? liveReversal : { cgst: num(row?.cgst), sgst: num(row?.sgst), igst: num(row?.igst) };
            return { cgst: acc.cgst + vals.cgst, sgst: acc.sgst + vals.sgst, igst: acc.igst + vals.igst };
          },
          { cgst: 0, sgst: 0, igst: 0 },
        );
    }
    availedCgst = total4A.cgst - total4B.cgst;
    availedSgst = total4A.sgst - total4B.sgst;
    availedIgst = total4A.igst - total4B.igst;
  }

  if (!utilizedFromCsv) {
    const shortMonth = prevMonth ? toShortMonth(prevMonth) : '';
    const { data: gstr1Data } = shortMonth
      ? await supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', shortMonth).maybeSingle()
      : { data: null };
    if (gstr1Data?.raw_json) {
      const { summary } = buildGstr3bJson({
        gstin: '', periodMonth: prevMonth || '', gstr1Raw: gstr1Data.raw_json,
        itc: null, rcm: { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
        alreadyFiled: true,
      });
      utilizedCgst = summary.outward.cgst;
      utilizedSgst = summary.outward.sgst;
      utilizedIgst = summary.outward.igst;
    }
  }

  const availableCgst = openingCgst + availedCgst;
  const availableSgst = openingSgst + availedSgst;
  const availableIgst = openingIgst + availedIgst;
  const safeAvailableCgst = Math.max(0, availableCgst);
  const safeAvailableSgst = Math.max(0, availableSgst);
  const safeAvailableIgst = Math.max(0, availableIgst);

  let portalClosingCgst: number, portalClosingSgst: number, portalClosingIgst: number;
  if (utilizedFromCsv) {
    portalClosingCgst = availableCgst - utilizedCgst;
    portalClosingSgst = availableSgst - utilizedSgst;
    portalClosingIgst = availableIgst - utilizedIgst;
  } else {
    const sim = simulateCrossHeadSetOff(
      { igst: utilizedIgst, cgst: utilizedCgst, sgst: utilizedSgst },
      { igst: safeAvailableIgst, cgst: safeAvailableCgst, sgst: safeAvailableSgst },
    );
    portalClosingIgst = sim.closing.igst;
    portalClosingCgst = sim.closing.cgst;
    portalClosingSgst = sim.closing.sgst;
  }
  portalClosingCgst = Math.max(0, portalClosingCgst - drcCgst);
  portalClosingSgst = Math.max(0, portalClosingSgst - drcSgst);
  portalClosingIgst = Math.max(0, portalClosingIgst - drcIgst);

  const portalClosingTotal = portalClosingCgst + portalClosingSgst + portalClosingIgst;
  const booksClosingTotal = booksClosingCgst + booksClosingSgst + booksClosingIgst;

  return {
    cgst: applyTolerance(portalClosingCgst - booksClosingCgst),
    sgst: applyTolerance(portalClosingSgst - booksClosingSgst),
    igst: applyTolerance(portalClosingIgst - booksClosingIgst),
    total: applyTolerance(portalClosingTotal - booksClosingTotal),
  };
}
