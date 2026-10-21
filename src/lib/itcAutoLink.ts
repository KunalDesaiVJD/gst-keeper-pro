import { supabase } from '@/integrations/supabase/client';
import { fetchImport2BCreditNotes, fetchImport2BEligibleTotal, type HeadTotals } from './postImport2B';

// The live source figures behind ITC Summary's auto-linked rows — row 5.1
// ("ITC for the Month" = eligible + this period's reversal, per PR #68's
// "gross, not netted" fix), row 5.3 "Debit Note" (the month's 2B credit
// notes, only when its import read them: notesFromImport2B), row 5.4 /
// 4(D)(1) reclaim, 4(D)(1.2) expense-out reclaim, and 4(B)'s "current month
// as per 2B RECO" reversal. ITC Summary
// computes these live and only ever persists them into itc_summaries.data on
// a manual Save — so anything reading that saved snapshot (buildGstr3bJson.ts)
// silently drifts from what ITC Summary itself displays the moment Import 2B
// or 2B Reconciliation changes without someone reopening and resaving ITC
// Summary. Callers that need the CURRENT figures (not a possibly-stale
// snapshot) should use this instead of trusting the saved section4A/4B/4D
// rows for anything auto-linked.

export interface ItcAutoLinkTotals {
  eligibleFromImport2B: HeadTotals;
  // Row 5.3: Matched / Mismatched non-RCM credit notes (positive = the
  // reduction), and whether this month's import read notes at all.
  creditNotesFromImport2B: HeadTotals;
  notesFromImport2B: boolean;
  reversalFromReco: HeadTotals;
  reclaimFromReco: HeadTotals;
  expenseOutFromReco: HeadTotals;
}

const ZERO: HeadTotals = { igst: 0, cgst: 0, sgst: 0 };

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

const sumHeads = (rows: { input_igst: number | null; input_cgst: number | null; input_sgst: number | null }[]): HeadTotals =>
  rows.reduce((acc, r) => ({
    igst: acc.igst + (Number(r.input_igst) || 0),
    cgst: acc.cgst + (Number(r.input_cgst) || 0),
    sgst: acc.sgst + (Number(r.input_sgst) || 0),
  }), { igst: 0, cgst: 0, sgst: 0 });

export async function fetchItcAutoLinkTotals(clientId: string, periodMonth: string): Promise<ItcAutoLinkTotals> {
  const patterns = getMonthPatterns(periodMonth);

  const [eligibleFromImport2B, creditNotes, { data: reversalBills }, { data: reclaimBills }] = await Promise.all([
    fetchImport2BEligibleTotal(clientId, periodMonth),
    fetchImport2BCreditNotes(clientId, periodMonth),
    supabase.from('bills_not_in_2b')
      .select('input_igst, input_cgst, input_sgst, reversal_month')
      .eq('client_id', clientId).eq('period_month', periodMonth)
      .not('reversal_month', 'is', null),
    supabase.from('bills_not_in_2b')
      .select('input_igst, input_cgst, input_sgst, reclaim_month, reclaim_subtype')
      .eq('client_id', clientId).eq('period_month', periodMonth)
      .not('reclaim_month', 'is', null),
  ]);

  const reversalFromReco = sumHeads((reversalBills || []).filter((b) => monthMatches(b.reversal_month, patterns)));
  const matchingReclaims = (reclaimBills || []).filter((b) => monthMatches(b.reclaim_month, patterns));
  const reclaimFromReco = sumHeads(matchingReclaims.filter((b) => b.reclaim_subtype !== 'EXPENSE_OUT'));
  const expenseOutFromReco = sumHeads(matchingReclaims.filter((b) => b.reclaim_subtype === 'EXPENSE_OUT'));

  return {
    eligibleFromImport2B,
    creditNotesFromImport2B: creditNotes.total,
    notesFromImport2B: creditNotes.notesRead,
    reversalFromReco, reclaimFromReco, expenseOutFromReco,
  };
}

// A filed month's 2B Reconciliation figures as its ITC Summary was saved and
// locked when the return was filed: 4B(2)(i) "current month as per 2B RECO",
// 5.4 and 4D(1.2). A gate that reads a filed month (the next month's GST
// Receivable Reco; the month's own Suspended Reco portal side) reads these,
// not the month's live lists: a GST Manager's change to a filed month's books
// entries (docs §13) moves only the books side, never what was filed.
type SavedRow = { srNo?: string; particular?: string; igst?: unknown; cgst?: unknown; sgst?: unknown };
const heads = (r: SavedRow | undefined): HeadTotals => ({
  igst: Number(r?.igst) || 0, cgst: Number(r?.cgst) || 0, sgst: Number(r?.sgst) || 0,
});
export function savedReversalReclaim(data: unknown): { reversal: HeadTotals; reclaim: HeadTotals; expenseOut: HeadTotals } {
  const d = (typeof data === 'string' ? JSON.parse(data) : data) as { section4A?: SavedRow[]; section4B?: SavedRow[]; section4D?: SavedRow[] } | null;
  const rowsA = Array.isArray(d?.section4A) ? d.section4A : [];
  const rowsB = Array.isArray(d?.section4B) ? d.section4B : [];
  const rowsD = Array.isArray(d?.section4D) ? d.section4D : [];
  return {
    reversal: heads(rowsB.find((r) => typeof r?.particular === 'string' && r.particular.includes('current month as per 2B RECO'))),
    reclaim: heads(rowsA.find((r) => r?.srNo === '5.4')),
    expenseOut: heads(rowsD.find((r) => r?.srNo === '1.2')),
  };
}
