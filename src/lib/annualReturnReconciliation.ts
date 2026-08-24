import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

// Same Rs.10 rounding tolerance the rest of the app's books-vs-portal
// diffing uses (suspendedRecoCalc.ts).
export const RECONCILIATION_TOLERANCE = 10;

export type ReconLineKey = 'outward_tax' | 'itc_claimed' | 'itc_2b_vs_claimed';

export interface ReconLine {
  key: ReconLineKey;
  label: string;
  booksLabel: string;
  portalLabel: string;
  books: number | null; // null when the line has no books-side figure (2B vs claimed is portal-vs-portal)
  portal: number;
  difference: number;
  matched: boolean;
  reason: string;
  reasonEnteredBy: string | null;
  reasonUpdatedAt: string | null;
  reasonRequired: boolean; // false for a matched line, or a no-ITC-scheme client's ITC lines
}

interface Sums { taxable: number; igst: number; cgst: number; sgst: number; }

const sumLines = (rows: { igst: number | null; cgst: number | null; sgst: number | null }[]): Sums =>
  rows.reduce(
    (acc, r) => ({
      taxable: acc.taxable,
      igst: acc.igst + Number(r.igst || 0),
      cgst: acc.cgst + Number(r.cgst || 0),
      sgst: acc.sgst + Number(r.sgst || 0),
    }),
    { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
  );

/**
 * Computes the three books-vs-portal reconciliation lines for a (client, FY)
 * pair. Books and portal figures are always read fresh from the underlying
 * tables — never cached — so a reason can never end up attached to a value
 * that's since changed. Only the reason itself is persisted
 * (reconciliation_reasons).
 *
 * isNoItcBuilder clients (clients.builder_itc_type = 'NO_ITC') don't need a
 * reason on the two ITC lines — they're not meant to claim ITC at all, so a
 * gap there is expected, not a mismatch (firm decision, 24 Aug 2026).
 */
export async function fetchReconciliationLines(
  clientId: string,
  financialYear: string,
  isNoItcBuilder: boolean,
): Promise<ReconLine[]> {
  const months = monthsForFY(financialYear);

  const [turnoverRes, purchaseRes, filedRes, reasonRes] = await Promise.all([
    supabase.from('books_turnover_lines').select('igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
    supabase.from('books_purchase_lines').select('igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
    supabase.from('gst_filed_returns').select('period_month, return_type, summary').eq('client_id', clientId).in('period_month', months),
    supabase.from('reconciliation_reasons').select('line_key, reason, entered_by, updated_at').eq('client_id', clientId).eq('financial_year', financialYear),
  ]);

  if (turnoverRes.error) throw turnoverRes.error;
  if (purchaseRes.error) throw purchaseRes.error;
  if (filedRes.error) throw filedRes.error;
  if (reasonRes.error) throw reasonRes.error;

  const booksOutward = sumLines(turnoverRes.data || []);
  const booksItc = sumLines(purchaseRes.data || []);

  let portalOutward = 0;
  let portalItcClaimed = 0;
  let portal2b = 0;
  (filedRes.data || []).forEach((r: { return_type: string; summary: Record<string, number> | null }) => {
    const s = r.summary || {};
    if (r.return_type === 'GSTR-3B') {
      portalOutward += Number(s.outward_tax || 0);
      portalItcClaimed += Number(s.itc_claimed || 0);
    } else if (r.return_type === 'GSTR-2B') {
      portal2b += Number(s.itc_available || 0);
    }
  });

  const reasonMap: Record<string, { reason: string; entered_by: string | null; updated_at: string }> = {};
  (reasonRes.data || []).forEach((r: { line_key: string; reason: string; entered_by: string | null; updated_at: string }) => {
    reasonMap[r.line_key] = r;
  });

  // "books"/"portal" are just the two figures a line compares — for the
  // Table 8 line both sides are portal figures (2B available vs 3B
  // claimed), so `books` is left null there and the left-hand value is
  // passed as `leftValue` instead.
  const build = (
    key: ReconLineKey,
    label: string,
    booksLabel: string,
    portalLabel: string,
    leftValue: number,
    rightValue: number,
    books: number | null,
    skippable: boolean,
  ): ReconLine => {
    const difference = leftValue - rightValue;
    const matched = Math.abs(difference) <= RECONCILIATION_TOLERANCE;
    const r = reasonMap[key];
    return {
      key,
      label,
      booksLabel,
      portalLabel,
      books,
      portal: rightValue,
      difference,
      matched,
      reason: r?.reason || '',
      reasonEnteredBy: r?.entered_by || null,
      reasonUpdatedAt: r?.updated_at || null,
      reasonRequired: !matched && !(skippable && isNoItcBuilder),
    };
  };

  const booksOutwardTotal = booksOutward.igst + booksOutward.cgst + booksOutward.sgst;
  const booksItcTotal = booksItc.igst + booksItc.cgst + booksItc.sgst;

  return [
    build('outward_tax', 'Outward Tax Liability', 'Books (CGST+SGST+IGST)', 'Portal (GSTR-3B)', booksOutwardTotal, portalOutward, booksOutwardTotal, false),
    build('itc_claimed', 'Input Tax Credit (ITC) Claimed', 'Books (CGST+SGST+IGST)', 'Portal (GSTR-3B)', booksItcTotal, portalItcClaimed, booksItcTotal, true),
    build('itc_2b_vs_claimed', 'ITC as per 2B vs Claimed (Table 8)', 'Portal (GSTR-2B available)', 'Portal (GSTR-3B claimed)', portal2b, portalItcClaimed, null, true),
  ];
}

/** True once every reconciliation line either matches or has a reason on file (or is exempt). */
export const isFullyReconciled = (lines: ReconLine[]): boolean => lines.every((l) => l.matched || !l.reasonRequired || l.reason.trim().length > 0);
