// Reverse charge (issue RCM_LIAB): month-wise per head, the credit taken in
// GSTR-3B 4A(2) + 4A(3) against the tax paid in 3.1(d). Credit may follow the
// payment in a later month (timing), but never exceed what was paid: what is
// left above the tax paid at the FY end is excess credit to reverse.
// Difference = credit − tax paid (positive: credit above tax paid).
import type { AnnexureTable, Head, PortalData, RecipeContext, RecipeResult } from '../types';
import { addHeads, mapHeads } from '../portal';
import { fyLong, fysOf, PERIOD_SOURCE_WORDS } from '../periods';
import {
  buildHeads, cellState, fetchPlan, fmtHeadsWords, fyContextMonths, headCells, headColumns, inputsOf, line, lookup, missingWords,
  monthSource, noticeFigures, RECIPE_VERSION, refOf, rupees, statusOf, toPayOf, type Lookup,
} from './common';
import { compareMonthly, missingSentences, type CompareCore, type MonthGet } from './compare';
import { needsPeriod } from './documentsOnly';

export const RCM_WORDING = {
  positive: 'credit above tax paid by', negative: 'tax paid, credit not yet taken', covered: 'tax paid earlier in',
  reversed: 'tax paid later in', settles: 'credit taken for', open: 'credit above tax paid in the FY',
};

export function rcmCore(ctx: RecipeContext, l: Lookup): CompareCore {
  const months = fyContextMonths(ctx.period.periods, ctx.today);
  const get = (p: string): MonthGet => {
    const s3 = cellState(l, 'GSTR3B', p, ctx);
    const refs = refOf(l.filed('GSTR3B', p));
    if (s3.state === 'ready') {
      const g3 = l.g3b(p)!;
      return { a: addHeads(g3.itc.imps, g3.itc.isrc), b: g3.t31d, refs };
    }
    return { missing: missingWords('GSTR3B', s3.state, s3.why), refs, notDue: s3.state === 'not_due' };
  };
  return compareMonthly(ctx, months, get, {
    key: 'rcm_monthly',
    title: 'Month-wise reverse charge: credit v tax paid',
    note: 'Credit = GSTR-3B 4A(2) import of services + 4A(3) other reverse charge; tax paid = 3.1(d). Difference = credit − tax paid (positive: credit above tax paid).',
    groupA: 'Credit 4A(2) + 4A(3)',
    groupB: 'Tax paid 3.1(d)',
    groupD: 'Difference (credit − tax)',
    wording: RCM_WORDING,
  });
}

/** The portal's RCM liability / ITC statement closing balance for each FY, when it was fetched. */
export function rcmStatementTable(ctx: RecipeContext, data: PortalData, heads: Head[]): AnnexureTable | null {
  if (!data.rcmStatement?.length) return null;
  const fys = fysOf(ctx.period.periods);
  const rows = fys.flatMap((fy) => {
    const list = data.rcmStatement!.filter((r) => r.financialYear === fyLong(fy) && !r.isOpening && r.period);
    const last = list[list.length - 1];
    return last ? [{ fy, row: last }] : [];
  });
  if (!rows.length) return null;
  return {
    key: 'rcm_statement',
    title: 'Portal RCM liability / ITC statement — closing balance',
    note: 'The portal’s own running balance of reverse-charge credit over tax paid; a positive balance is credit taken above tax paid.',
    columns: [{ key: 'fy', label: 'Financial year', kind: 'text' }, ...headColumns('v', 'Closing balance', heads)],
    rows: rows.map(({ fy, row }) => ({
      kind: 'info' as const,
      cells: { fy: `FY ${fy}`, ...headCells('v', heads, row.closing) },
      _source: [{ table: 'gst_rcm_liability_itc_entries', period: row.period, label: 'RCM liability / ITC statement', pulled_at: row.pulledAt, row_id: row.id }],
    })),
  };
}

export function rcm(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'Reverse charge: credit v tax paid';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const core = rcmCore(ctx, l);
  const toPay = toPayOf(core.totals.residual);
  const computed = mapHeads(core.totals.diff, (v) => Math.max(0, v));
  const fig = noticeFigures(ctx, 'tax');
  const heads = core.heads;
  const hl = buildHeads(heads, fig, computed, toPay);
  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months: core.months })];
  const status = statusOf(core.periodCompared.length, ctx.period.periods.length, core.missing.some((m) => !/not due/.test(m.words)));
  const statement = rcmStatementTable(ctx, data, heads);
  const headline = core.periodCompared.length
    ? hl.toPayTotal > 0
      ? `Reverse-charge credit for ${ctx.period.label} is above the tax paid by ${rupees(hl.toPayTotal)} after timing (${fmtHeadsWords(toPay, heads)}).`
      : `Reverse-charge credit for ${ctx.period.label} does not exceed the tax paid (within ₹10 per head, after timing).`
    : `Nothing could be compared for ${ctx.period.label} yet.`;
  return {
    recipe: 'rcm', status, title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
    summary: {
      headline,
      computed_label: 'Credit 4A(2)+4A(3) − tax paid 3.1(d) for the notice period (excess only)',
      heads: hl.lines,
      lines: [
        line('Tax paid on reverse charge 3.1(d)', core.totals.b),
        line('Credit taken 4A(2) + 4A(3)', core.totals.a),
        line('Difference (credit − tax paid)', core.totals.diff),
        line('Months with credit above tax (gross)', core.totals.gross),
        line('Tax paid in another month of the FY (timing)', core.totals.timing, 'reconciling'),
        line('Excess credit to reverse', toPay, 'result'),
        line('Tax paid, credit not taken (unused; not netted)', core.totals.unused, 'info'),
      ],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: [
        'From GSTR-3B as filed on the portal. Reverse-charge tax is paid in cash; credit may be taken in the month of payment or later, never above what was paid.',
        'A head counts as matched within ₹10. Heads are never netted.',
      ],
      missing: missingSentences(core),
    },
    tables: [core.table, ...(statement ? [statement] : [])],
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: ctx.period.periods, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR3B'], core.months),
      statement: (data.rcmStatement ?? []).map((r) => [r.id, r.pulledAt]),
    },
  };
}
