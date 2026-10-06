// GSTR-1 v GSTR-3B (DRC-01B, issue LIAB_GSTR1_V_3B): month-wise per head, the
// liability GSTR-1 declares (its own Total Liability, TTL_LIAB — as the
// existing GSTR 3B vs GSTR 1 Tax Report reads it) against GSTR-3B 3.1(a)+(b).
// A shortfall settled by GSTR-3B in another month of the same FY is timing;
// DRC-03s paid for this comparison are reconciling items; what is left is to
// pay. Differences are GSTR-1 − GSTR-3B, per head, never netted across heads.
import type { PortalData, RecipeContext, RecipeResult } from '../types';
import { addHeads, mapHeads, subHeads } from '../portal';
import { PERIOD_SOURCE_WORDS } from '../periods';
import {
  buildHeads, cellState, fetchPlan, fmtHeadsWords, fyContextMonths, inputsOf, line, lookup, missingWords, monthSource,
  noticeFigures, RECIPE_VERSION, refOf, rupees, statusOf, toPayOf, type Lookup,
} from './common';
import { compareMonthly, drc03For, drc03Table, missingSentences, type CompareCore, type MonthGet } from './compare';
import { needsPeriod } from './documentsOnly';

export const LIABILITY_WORDING = {
  positive: 'short in GSTR-3B', negative: 'paid more in GSTR-3B', covered: 'paid earlier in', reversed: 'paid later in',
  settles: 'settles', open: 'not paid in the FY',
};

export function liabilityCore(ctx: RecipeContext, l: Lookup): CompareCore {
  const months = fyContextMonths(ctx.period.periods, ctx.today);
  const get = (p: string): MonthGet => {
    const s1 = cellState(l, 'GSTR1', p, ctx);
    const s3 = cellState(l, 'GSTR3B', p, ctx);
    const refs = [...refOf(l.filed('GSTR1', p)), ...refOf(l.filed('GSTR3B', p))];
    if (s1.state === 'ready' && s3.state === 'ready') {
      const g1 = l.g1(p)!;
      const g3 = l.g3b(p)!;
      return { a: g1.liability, b: addHeads(g3.t31a, g3.t31b), refs };
    }
    const words = [s1, s3].map((s, i) => (s.state === 'ready' ? null : missingWords(i ? 'GSTR3B' : 'GSTR1', s.state, s.why))).filter(Boolean).join('; ');
    return { missing: words, refs, notDue: s1.state === 'not_due' || s3.state === 'not_due' };
  };
  return compareMonthly(ctx, months, get, {
    key: 'liability_monthly',
    title: 'Month-wise liability: GSTR-1 v GSTR-3B',
    note: 'GSTR-1 = its Total Liability section; GSTR-3B = Table 3.1(a) + 3.1(b). Difference = GSTR-1 − GSTR-3B (positive: less paid in GSTR-3B).',
    groupA: 'GSTR-1 total liability',
    groupB: 'GSTR-3B 3.1(a)+(b)',
    groupD: 'Difference (GSTR-1 − GSTR-3B)',
    wording: LIABILITY_WORDING,
  });
}

export function gstr1Vs3b(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'GSTR-1 v GSTR-3B: output tax';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const core = liabilityCore(ctx, l);
  const { picks, counted } = drc03For(ctx, data, 'liability');
  const residualAfterDrc = mapHeads(subHeads(core.totals.residual, counted), (v) => Math.max(0, v));
  const toPay = toPayOf(residualAfterDrc);
  const computed = mapHeads(core.totals.diff, (v) => Math.max(0, v));
  const fig = noticeFigures(ctx, 'tax');
  const heads = core.heads;
  const hl = buildHeads(heads, fig, computed, toPay);

  const sources = [monthSource(l, ctx, { key: 'GSTR1', months: core.months }), monthSource(l, ctx, { key: 'GSTR3B', months: core.months })];
  const anyMissing = core.missing.some((m) => !/not due/.test(m.words));
  const status = statusOf(core.periodCompared.length, ctx.period.periods.length, anyMissing);
  const notes = [
    'Both sides are the returns as filed on the portal, pulled by the extension — never the app’s own GSTR-1 / GSTR-3B drafts.',
    'A head counts as matched within ₹10. Heads are never netted against each other.',
    'Timing: a shortfall settled by GSTR-3B in another month of the same financial year (first in, first out).',
  ];
  if (picks.some((p) => !p.counted)) notes.push('DRC-03s of the period paid for another cause are listed but not counted.');
  const headline = core.periodCompared.length
    ? toPay.igst + toPay.cgst + toPay.sgst + toPay.cess > 0
      ? `GSTR-1 exceeds GSTR-3B for ${ctx.period.label}; ${rupees(hl.toPayTotal)} is left to pay after timing and DRC-03 (${fmtHeadsWords(toPay, heads)}).`
      : `No shortfall is left for ${ctx.period.label}: every head matches within ₹10 after timing and DRC-03.`
    : `Nothing could be compared for ${ctx.period.label} yet.`;

  return {
    recipe: 'gstr1_vs_3b', status, title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
    summary: {
      headline,
      computed_label: 'GSTR-1 − GSTR-3B for the notice period (shortfall only)',
      heads: hl.lines,
      lines: [
        line('GSTR-1 total liability', core.totals.a),
        line('GSTR-3B 3.1(a) + 3.1(b)', core.totals.b),
        line('Difference (GSTR-1 − GSTR-3B)', core.totals.diff),
        line('Months short in GSTR-3B (gross)', core.totals.gross),
        line('Settled in another month of the FY (timing)', core.totals.timing, 'reconciling'),
        line('DRC-03 paid for this difference', counted, 'reconciling'),
        line('To pay', toPay, 'result'),
        line('Paid more in GSTR-3B (unused; not netted across heads)', core.totals.unused, 'info'),
      ],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes, missing: missingSentences(core),
    },
    tables: [core.table, ...(picks.length ? [drc03Table(picks, heads)] : [])],
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: ctx.period.periods, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR1', 'GSTR3B'], core.months),
      drc03: picks.map((p) => [p.row.id, p.row.updatedAt, p.counted]),
    },
  };
}
