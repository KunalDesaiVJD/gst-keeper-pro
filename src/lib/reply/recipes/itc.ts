// ITC claimed in GSTR-3B v what the supplier side shows (DRC-01C, issues
// ITC_2B_V_3B, ITC_2A_V_3B, ITC_NONFILER). Month-wise per head: GSTR-3B 4A(5)
// "all other ITC" less what 4D(1) re-claimed (ITC reversed earlier, from the
// credit reversal and re-claimed statement) against GSTR-2B's ITC available
// from registered suppliers (B2B invoices and notes, not reverse charge) — the
// basis from 1 January 2022 (s.16(2)(aa)) — or GSTR-2A before it. Imports,
// ISD and reverse charge are outside the comparison and listed separately.
// Difference = GSTR-3B − GSTR-2B/2A (positive: claimed above the supplier side).
import type { Head, HeadAmounts, PortalData, RecipeContext, RecipeResult, ReclaimRow, SourceRef, AnnexureTable } from '../types';
import { HEADS } from '../types';
import {
  addHeads, allOtherItc2a, allOtherItc2b, impgItc, isdItc, mapHeads, r2, rcmItcDocs, reclaimsByPeriod, subHeads, zeroHeads, classifyStatement,
} from '../portal';
import { fyLong, fyOfPeriod, periodIndex, periodLabel, PERIOD_SOURCE_WORDS, fysOf } from '../periods';
import {
  buildHeads, cellState, fetchPlan, fmtHeadsWords, fyContextMonths, headCells, headColumns, inputsOf, line, lookup, missingWords,
  monthSource, noticeFigures, RECIPE_VERSION, rangeRef, reclaimSource, refOf, rupees, statusOf, toPayOf, type Lookup,
} from './common';
import { compareMonthly, drc03For, drc03Table, missingSentences, type CompareCore, type MonthGet } from './compare';
import { needsPeriod } from './documentsOnly';

export type ItcBasis = '2B' | '2A' | 'auto';
const JAN_2022 = periodIndex('01/2022');
const basisOf = (p: string, mode: ItcBasis): 'GSTR2B' | 'GSTR2A' | null => {
  if (mode === '2A') return 'GSTR2A';
  if (mode === '2B') return periodIndex(p) >= JAN_2022 ? 'GSTR2B' : null;
  return periodIndex(p) >= JAN_2022 ? 'GSTR2B' : 'GSTR2A';
};
/** Rule 36(4): provisional credit allowed above GSTR-2A (9 Oct 2019 – 31 Dec 2021). */
export const rule364Pct = (p: string): number => {
  const i = periodIndex(p);
  if (i >= periodIndex('10/2019') && i <= periodIndex('12/2019')) return 0.2;
  if (i >= periodIndex('01/2020') && i <= periodIndex('12/2020')) return 0.1;
  if (i >= periodIndex('01/2021') && i <= periodIndex('12/2021')) return 0.05;
  return 0;
};
/** The 4D(1) table and the re-claimed statement exist from FY 2022-23. */
const reclaimFy = (fy: string) => Number(fy.slice(0, 4)) >= 2022;

export const ITC_WORDING = {
  positive: 'claimed above the supplier side by', negative: 'claimed below the supplier side by', covered: 'in GSTR-2B earlier in',
  reversed: 'in GSTR-2B later in', settles: 'claimed for', open: 'not in GSTR-2B in the FY',
};

export interface ItcCore {
  core: CompareCore;
  ctx: RecipeContext;
  reclaims: Map<string, { tax: HeadAmounts; rows: ReclaimRow[] }>;
  reclaimMissing: string[];
  rule364: HeadAmounts;
  outside: { label: string; v: HeadAmounts; refs: SourceRef[] }[];
  amendments: { count: number; tax: HeadAmounts };
  otherSections: string[];
  basisUsed: Set<'GSTR2B' | 'GSTR2A'>;
  /** Months of the period this basis covers (2B: from January 2022). */
  applicable: string[];
}

export function itcCore(ctxIn: RecipeContext, l: Lookup, data: PortalData, mode: ItcBasis): ItcCore {
  const applicable = ctxIn.period.periods.filter((p) => !!basisOf(p, mode));
  const ctx: RecipeContext = { ...ctxIn, period: { ...ctxIn.period, periods: applicable } };
  const months = fyContextMonths(ctxIn.period.periods, ctx.today).filter((p) => !!basisOf(p, mode));
  const fys = fysOf(months).filter(reclaimFy);
  const reclaimRows = data.reclaims ?? [];
  const reclaims = reclaimsByPeriod(reclaimRows);
  const reclaimMissing = fys.filter((fy) => classifyStatement(data.reclaims === null ? null : reclaimRows.filter((r) => r.financialYear === fyLong(fy))).state !== 'ready');
  const basisUsed = new Set<'GSTR2B' | 'GSTR2A'>();
  const get = (p: string): MonthGet => {
    const basis = basisOf(p, mode) as 'GSTR2B' | 'GSTR2A';
    const s3 = cellState(l, 'GSTR3B', p, ctx);
    const sb = cellState(l, basis, p, ctx);
    const rc = reclaimFy(fyOfPeriod(p)) ? reclaims.get(p) : undefined;
    const refs: SourceRef[] = [
      ...refOf(l.filed('GSTR3B', p)), ...refOf(l.filed(basis, p)),
      ...(rc ? rc.rows.map((r) => ({ table: 'gst_credit_reversal_reclaim_entries', period: p, label: '4D(1) re-claimed', pulled_at: r.pulledAt, row_id: r.id })) : []),
    ];
    if (s3.state === 'ready' && sb.state === 'ready') {
      basisUsed.add(basis);
      const g3 = l.g3b(p)!;
      const b = basis === 'GSTR2B' ? allOtherItc2b(l.g2b(p)!.docs) : allOtherItc2a(l.g2a(p)!);
      const a = subHeads(g3.itc.oth, rc?.tax ?? zeroHeads());
      return { a, b, refs, extra: mode === 'auto' ? { basis: basis === 'GSTR2B' ? 'GSTR-2B' : 'GSTR-2A' } : undefined };
    }
    const words = [['GSTR3B', s3], [basis, sb]].map(([t, s]) => {
      const st = s as { state: Parameters<typeof missingWords>[1]; why: string | null };
      return st.state === 'ready' ? null : missingWords(t as 'GSTR3B', st.state, st.why);
    }).filter(Boolean).join('; ');
    return { missing: words, refs, notDue: s3.state === 'not_due' || sb.state === 'not_due' };
  };
  const supplier = mode === '2B' ? 'GSTR-2B' : mode === '2A' ? 'GSTR-2A' : 'GSTR-2B / 2A';
  const core = compareMonthly(ctx, months, get, {
    key: 'itc_monthly',
    title: `Month-wise ITC: GSTR-3B v ${supplier}`,
    note: `GSTR-3B = Table 4A(5) all other ITC less 4D(1) re-claimed; ${supplier} = ITC available from registered suppliers (B2B invoices and notes, not reverse charge). Difference = GSTR-3B − ${supplier} (positive: claimed above the supplier side).`,
    groupA: 'GSTR-3B 4A(5) − 4D(1)',
    groupB: supplier,
    groupD: `Difference (GSTR-3B − ${supplier})`,
    wording: ITC_WORDING,
    extraColumns: mode === 'auto' ? [{ key: 'basis', label: 'Basis', kind: 'text' }] : undefined,
  });

  // Rule 36(4) allowance on what stayed open in a GSTR-2A month.
  const rule364 = zeroHeads();
  for (const p of core.periodCompared) {
    if (basisOf(p, mode) !== 'GSTR2A') continue;
    const pct = rule364Pct(p);
    if (!pct) continue;
    const b = core.rows.get(p)!.b;
    for (const h of HEADS) rule364[h] += Math.min(core.fifo[h].get(p)?.residual ?? 0, Math.max(0, b[h]) * pct);
  }

  // Outside the comparison, over the period's compared months.
  let impg3 = zeroHeads(), isd3 = zeroHeads(), isrc3 = zeroHeads(), imps3 = zeroHeads(), rul = zeroHeads(), oth = zeroHeads();
  let impg2 = zeroHeads(), isd2 = zeroHeads(), rcm2 = zeroHeads();
  const amendments = { count: 0, tax: zeroHeads() };
  const otherSections = new Set<string>();
  const pc2b: string[] = [], pc2a: string[] = [];
  for (const p of core.periodCompared) {
    const g3 = l.g3b(p)!;
    impg3 = addHeads(impg3, g3.itc.impg); isd3 = addHeads(isd3, g3.itc.isd); isrc3 = addHeads(isrc3, g3.itc.isrc); imps3 = addHeads(imps3, g3.itc.imps);
    rul = addHeads(rul, g3.rev.rul); oth = addHeads(oth, g3.rev.oth);
    if (basisOf(p, mode) === 'GSTR2B') {
      const d = l.g2b(p)!;
      impg2 = addHeads(impg2, impgItc(d.docs)); isd2 = addHeads(isd2, isdItc(d.docs)); rcm2 = addHeads(rcm2, rcmItcDocs(d.docs));
      amendments.count += d.amendments.count; amendments.tax = addHeads(amendments.tax, d.amendments.tax);
      d.otherSections.forEach((s) => otherSections.add(s));
      pc2b.push(p);
    } else {
      rcm2 = addHeads(rcm2, rcmItcDocs(l.g2a(p)!));
      pc2a.push(p);
    }
  }
  const r3 = rangeRef(l, 'GSTR3B', core.periodCompared);
  const r2b = rangeRef(l, 'GSTR2B', pc2b);
  const r2a = rangeRef(l, 'GSTR2A', pc2a);
  const outside = [
    { label: 'Import of goods — GSTR-3B 4A(1)', v: impg3, refs: r3 },
    ...(pc2b.length ? [{ label: 'Import of goods — GSTR-2B (IMPG, IMPGSEZ)', v: impg2, refs: r2b }] : []),
    { label: 'Import of services — GSTR-3B 4A(2)', v: imps3, refs: r3 },
    { label: 'Reverse charge — GSTR-3B 4A(3)', v: isrc3, refs: r3 },
    { label: `Reverse charge — ${pc2b.length ? 'GSTR-2B' : 'GSTR-2A'} documents on reverse charge`, v: rcm2, refs: [...r2b, ...r2a] },
    { label: 'ISD — GSTR-3B 4A(4)', v: isd3, refs: r3 },
    ...(pc2b.length ? [{ label: 'ISD — GSTR-2B', v: isd2, refs: r2b }] : []),
    { label: 'Reversed — GSTR-3B 4B(1) (rules 38, 42, 43; s.17(5))', v: rul, refs: r3 },
    { label: 'Reversed — GSTR-3B 4B(2) (others)', v: oth, refs: r3 },
    ...(amendments.count ? [{ label: `GSTR-2B amendments (${amendments.count} documents, not compared)`, v: amendments.tax, refs: r2b }] : []),
  ];
  return { core, ctx, reclaims, reclaimMissing, rule364, outside, amendments, otherSections: [...otherSections], basisUsed, applicable };
}

export function outsideTable(ic: ItcCore, heads: Head[]): AnnexureTable {
  return {
    key: 'itc_outside',
    title: 'Outside the comparison (notice period)',
    note: 'Imports, ISD and reverse charge are claimed in other rows of Table 4A; shown for completeness, not compared above.',
    columns: [{ key: 'item', label: 'Item', kind: 'text' }, ...headColumns('v', 'Tax', heads)],
    rows: ic.outside.map((o) => ({ kind: 'data' as const, cells: { item: o.label, ...headCells('v', heads, o.v) }, _source: o.refs })),
  };
}

export function reclaimTable(ic: ItcCore, heads: Head[]): AnnexureTable | null {
  const ps = ic.core.compared.filter((p) => ic.reclaims.has(p));
  if (!ps.length) return null;
  return {
    key: 'itc_reclaims',
    title: 'ITC re-claimed in 4D(1) (credit reversal and re-claimed statement)',
    note: 'Re-claimed ITC was reversed in an earlier month and sits in that month’s GSTR-2B, so it is taken out of 4A(5) before the comparison.',
    columns: [{ key: 'month', label: 'Month', kind: 'text' }, ...headColumns('v', 'Re-claimed', heads)],
    rows: ps.map((p) => {
      const rc = ic.reclaims.get(p)!;
      return {
        kind: 'data' as const,
        cells: { month: periodLabel(p), ...headCells('v', heads, rc.tax) },
        _source: rc.rows.map((r) => ({ table: 'gst_credit_reversal_reclaim_entries', period: p, label: '4D(1) re-claimed', pulled_at: r.pulledAt, row_id: r.id })),
      };
    }),
  };
}

export function itcResult(ctxIn: RecipeContext, data: PortalData, mode: '2B' | '2A'): RecipeResult {
  const recipe = mode === '2B' ? 'gstr3b_vs_2b' : 'gstr3b_vs_2a';
  const supplier = mode === '2B' ? 'GSTR-2B' : 'GSTR-2A';
  const title = `GSTR-3B v ${supplier}: input tax credit`;
  if (!ctxIn.period.periods.length) return needsPeriod(ctxIn, title);
  const l = lookup(data);
  const ic = itcCore(ctxIn, l, data, mode);
  const { core, ctx } = ic;
  const fig = noticeFigures(ctxIn, 'tax');
  const notes: string[] = [
    `Both sides are as filed / generated on the portal, pulled by the extension. A head counts as matched within ₹10; heads are never netted.`,
    'Timing: ITC claimed in one month for documents that appear in GSTR-2B in another month of the same financial year (first in, first out).',
  ];
  if (mode === '2B' && ic.applicable.length < ctxIn.period.periods.length) notes.push('Months before January 2022 are compared with GSTR-2A (s.16(2)(aa) applies from 1 January 2022).');
  if (mode === '2A') notes.push('The extension’s GSTR-2A pull has B2B invoices only — no credit or debit notes, ISD or imports.');
  if (ic.otherSections.length) notes.push(`GSTR-2B sections not read: ${ic.otherSections.join(', ')}.`);
  if (ic.amendments.count) notes.push(`${ic.amendments.count} amended documents in GSTR-2B are listed, not compared — check them against the originals.`);
  if (ic.reclaimMissing.length) notes.push(`The credit reversal and re-claimed statement is not fetched for FY ${ic.reclaimMissing.join(', ')}: 4D(1) re-claims are not deducted, so the excess may be overstated.`);

  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months: core.months }), monthSource(l, ctx, { key: mode === '2B' ? 'GSTR2B' : 'GSTR2A', months: core.months })];
  const reclaimFys = fysOf(core.months).filter(reclaimFy);
  if (reclaimFys.length) sources.push(reclaimSource(data, reclaimFys));
  const readiness = { period: ctxIn.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctxIn.period.source]}.`] };

  if (!ic.applicable.length) {
    return {
      recipe, status: 'not_applicable', title, periods: ctxIn.period.periods, financialYear: ctxIn.period.financialYear,
      summary: {
        headline: `${ctxIn.period.label} is before January 2022: ITC is matched with GSTR-2A, not GSTR-2B (s.16(2)(aa)).`, computed_label: '—',
        heads: [], lines: [], notice_total: fig.total, notice_basis: fig.basis, computed_total: 0, to_pay_total: 0, explained_total: null,
        notes, missing: [],
      },
      tables: [], readiness, explained: null, toPay: null,
      inputs: { v: RECIPE_VERSION, recipe, periods: ctxIn.period.periods, na: true },
    };
  }

  const { picks, counted } = drc03For(ctxIn, data, 'itc');
  const residual = mapHeads(subHeads(subHeads(core.totals.residual, ic.rule364), counted), (v) => Math.max(0, v));
  const toPay = toPayOf(residual);
  const computed = mapHeads(core.totals.diff, (v) => Math.max(0, v));
  const heads = core.heads;
  const hl = buildHeads(heads, fig, computed, toPay);
  const anyMissing = core.missing.some((m) => !/not due/.test(m.words)) || ic.reclaimMissing.length > 0;
  const status = statusOf(core.periodCompared.length, ic.applicable.length, anyMissing);
  const reclaimed = core.periodCompared.reduce((s, p) => addHeads(s, ic.reclaims.get(p)?.tax ?? zeroHeads()), zeroHeads());
  const claimed4a5 = addHeads(core.totals.a, reclaimed);
  const headline = core.periodCompared.length
    ? hl.toPayTotal > 0
      ? `GSTR-3B claims ${rupees(hl.toPayTotal)} more ITC than ${supplier} for ${ctx.period.label} after timing${mode === '2A' ? ', Rule 36(4)' : ''} and DRC-03 (${fmtHeadsWords(toPay, heads)}).`
      : `No excess ITC is left for ${ctx.period.label}: every head is within ₹10 of ${supplier} after timing${mode === '2A' ? ' and Rule 36(4)' : ''}.`
    : `Nothing could be compared for ${ctx.period.label} yet.`;
  const extra = [reclaimTable(ic, heads), outsideTable(ic, heads), picks.length ? drc03Table(picks, heads) : null].filter((t): t is AnnexureTable => !!t);
  return {
    recipe, status, title, periods: ctxIn.period.periods, financialYear: ctxIn.period.financialYear,
    summary: {
      headline,
      computed_label: `GSTR-3B − ${supplier} for the notice period (excess only)`,
      heads: hl.lines,
      lines: [
        line('GSTR-3B 4A(5) all other ITC', claimed4a5),
        line('less 4D(1) re-claimed (reversed earlier)', reclaimed, 'reconciling'),
        line(`${supplier}: ITC available (B2B, not reverse charge)`, core.totals.b),
        line(`Difference (GSTR-3B − ${supplier})`, core.totals.diff),
        line(`Months claimed above ${supplier} (gross)`, core.totals.gross),
        line(`In ${supplier} in another month of the FY (timing)`, core.totals.timing, 'reconciling'),
        ...(mode === '2A' ? [line('Rule 36(4) provisional credit allowed', ic.rule364, 'reconciling')] : []),
        line('DRC-03 paid for this difference', counted, 'reconciling'),
        line('Excess ITC to reverse or pay', toPay, 'result'),
        line(`Claimed below ${supplier} (unused; not netted across heads)`, core.totals.unused, 'info'),
      ],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes, missing: [...missingSentences(core), ...ic.reclaimMissing.map((fy) => `Credit reversal and re-claimed statement not fetched: FY ${fy}.`)],
    },
    tables: [core.table, ...extra],
    readiness,
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, recipe, periods: ctxIn.period.periods, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR3B', mode === '2B' ? 'GSTR2B' : 'GSTR2A'], core.months),
      reclaims: (data.reclaims ?? []).filter((r) => reclaimFys.map(fyLong).includes(r.financialYear)).map((r) => [r.id, r.pulledAt]),
      drc03: picks.map((p) => [p.row.id, p.row.updatedAt, p.counted]),
    },
  };
}

export const gstr3bVs2b = (ctx: RecipeContext, data: PortalData) => itcResult(ctx, data, '2B');
export const gstr3bVs2a = (ctx: RecipeContext, data: PortalData) => itcResult(ctx, data, '2A');

