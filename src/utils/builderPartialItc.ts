/**
 * Partial ITC math for a Builder client on the carpet-area apportionment
 * (Rule 42/43) — shared by the ITC Summary page and the ITC & Cash working
 * paper, so the two never compute "how much ITC is left after the
 * residential reversal" two different ways. See docs/BUILDER_GST_POSITIONS.md
 * §7 for the elected position this implements.
 *
 * Mechanically extracted from ITCSummaryPage.tsx's existing row-driven
 * calculation — the formulas here are byte-identical to what that page
 * already computed inline, not a reinterpretation of them.
 */

export interface ItcTotals {
  igst: number;
  cgst: number;
  sgst: number;
}

export interface ItcRowLike {
  srNo: string;
  igst: number;
  cgst: number;
  sgst: number;
}

const ZERO: ItcTotals = { igst: 0, cgst: 0, sgst: 0 };

const round2 = (n: number): number => Math.round(n * 100) / 100;

const findRow = (rows: ItcRowLike[], srNo: string): ItcRowLike | undefined =>
  rows.find((r) => r.srNo === srNo);

const sum4 = (a: ItcTotals, b: ItcTotals, sign = 1): ItcTotals => ({
  igst: a.igst + sign * b.igst,
  cgst: a.cgst + sign * b.cgst,
  sgst: a.sgst + sign * b.sgst,
});

/** Total (5) of section 4A = 5.1 + 5.2 − 5.3 + 5.4 + 5.5. */
export const computeSection4ATotal5 = (section4A: ItcRowLike[]): ItcTotals => {
  const get = (srNo: string, field: 'igst' | 'cgst' | 'sgst') => findRow(section4A, srNo)?.[field] || 0;
  return {
    igst: get('5.1', 'igst') + get('5.2', 'igst') - get('5.3', 'igst') + get('5.4', 'igst') + get('5.5', 'igst'),
    cgst: get('5.1', 'cgst') + get('5.2', 'cgst') - get('5.3', 'cgst') + get('5.4', 'cgst') + get('5.5', 'cgst'),
    sgst: get('5.1', 'sgst') + get('5.2', 'sgst') - get('5.3', 'sgst') + get('5.4', 'sgst') + get('5.5', 'sgst'),
  };
};

/** Total 4A = rows (1)–(4) + Total (5). */
export const computeTotal4A = (section4A: ItcRowLike[]): ItcTotals => {
  const rows1To4 = section4A.slice(0, 4).reduce((acc, row) => sum4(acc, row), ZERO);
  return sum4(rows1To4, computeSection4ATotal5(section4A));
};

export interface PartialItcSplit {
  onITCAsPerA: ItcTotals;
  onOtherReversal: ItcTotals;
  /** 4(B)(1): the residential-attributable reversal — i) + ii) + iii). */
  main1Calculated: ItcTotals;
  /** 4(B)(2): the ordinary (non-apportionment) reversal, current + previous months. */
  row2Calculated: ItcTotals;
}

/**
 * The carpet-area apportionment itself: how much of Total 4A and of the
 * ordinary 4(B)(2) reversal is attributable to the residential share and so
 * added to 4(B)(1) — i.e., never available as credit at all.
 *
 * Returns null where there is no carpet area to apportion by (a partial-ITC
 * client with no project areas synced yet), matching the page's own guard.
 */
export const computePartialItcSplit = (params: {
  section4A: ItcRowLike[];
  section4B: (ItcRowLike & { particular: string })[];
  commercialArea: number;
  residentialArea: number;
}): PartialItcSplit | null => {
  const totalArea = params.commercialArea + params.residentialArea;
  if (totalArea === 0) return null;
  const residentialRatio = params.residentialArea / totalArea;

  const total4AValues = computeTotal4A(params.section4A);
  const onITCAsPerA: ItcTotals = {
    igst: round2(total4AValues.igst * residentialRatio),
    cgst: round2(total4AValues.cgst * residentialRatio),
    sgst: round2(total4AValues.sgst * residentialRatio),
  };

  const prevMonthAdjRow = params.section4B.find((r) => r.particular.includes('Previous Month Adjustment'));
  const prevMonthAdj: ItcTotals = {
    igst: prevMonthAdjRow?.igst || 0, cgst: prevMonthAdjRow?.cgst || 0, sgst: prevMonthAdjRow?.sgst || 0,
  };

  const recoReversalRow = params.section4B.find((r) => r.particular.includes('current month as per 2B RECO'));
  const prevMonthsReversalRow = params.section4B.find((r) => r.particular.includes('previous months, if any'));
  const row2Calculated: ItcTotals = {
    igst: (recoReversalRow?.igst || 0) + (prevMonthsReversalRow?.igst || 0),
    cgst: (recoReversalRow?.cgst || 0) + (prevMonthsReversalRow?.cgst || 0),
    sgst: (recoReversalRow?.sgst || 0) + (prevMonthsReversalRow?.sgst || 0),
  };

  const onOtherReversal: ItcTotals = {
    igst: round2(-row2Calculated.igst * residentialRatio),
    cgst: round2(-row2Calculated.cgst * residentialRatio),
    sgst: round2(-row2Calculated.sgst * residentialRatio),
  };

  const main1Calculated: ItcTotals = {
    igst: round2(onITCAsPerA.igst + prevMonthAdj.igst + onOtherReversal.igst),
    cgst: round2(onITCAsPerA.cgst + prevMonthAdj.cgst + onOtherReversal.cgst),
    sgst: round2(onITCAsPerA.sgst + prevMonthAdj.sgst + onOtherReversal.sgst),
  };

  return { onITCAsPerA, onOtherReversal, main1Calculated, row2Calculated };
};

/**
 * Total 4B — for a partial-ITC client this is 4(B)(1) + 4(B)(2) as
 * calculated above; for everyone else it's the plain sum of the non-header
 * section 4B rows.
 */
export const computeTotal4B = (params: {
  isPartialITCClient: boolean;
  section4B: (ItcRowLike & { isHeader?: boolean })[];
  partial: PartialItcSplit | null;
}): ItcTotals => {
  if (params.isPartialITCClient && params.partial) {
    return sum4(params.partial.main1Calculated, params.partial.row2Calculated);
  }
  return params.section4B.filter((row) => !row.isHeader).reduce((acc, row) => sum4(acc, row), ZERO);
};

/** Net ITC 4(C) = Total 4A − Total 4B — what remains available after every reversal. */
export const computeNet4C = (total4A: ItcTotals, total4B: ItcTotals): ItcTotals => sum4(total4A, total4B, -1);
