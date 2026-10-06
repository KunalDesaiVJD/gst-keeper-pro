// The year at a glance for a scrutiny notice (ASMT-10, DRC-01A) without a
// coded issue: liability (GSTR-1 v GSTR-3B), ITC (GSTR-3B v GSTR-2B from
// January 2022, GSTR-2A before) and reverse charge, per head, for the period —
// with each month-wise working as its own annexure table. What is left to pay
// is the sum of the three results per head (never netted across heads or
// against an excess elsewhere).
import type { AnnexureStatus, AnnexureTable, HeadAmounts, PortalData, RecipeContext, RecipeResult, SourceRef } from '../types';
import { addHeads, mapHeads, subHeads } from '../portal';
import { fyLong, fysOf, periodIndex, PERIOD_SOURCE_WORDS } from '../periods';
import {
  activeHeads, buildHeads, fetchPlan, fmtHeadsWords, headCells, headColumns, inputsOf, line, lookup, monthSource,
  noticeFigures, rangeRef, RECIPE_VERSION, reclaimSource, rupees, statusOf, toPayOf,
} from './common';
import { drc03For, drc03Table, missingSentences } from './compare';
import { liabilityCore } from './liability';
import { itcCore, outsideTable, reclaimTable } from './itc';
import { rcmCore, rcmStatementTable } from './rcm';
import { needsPeriod } from './documentsOnly';

export function fySummary(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'The year at a glance: liability, ITC and reverse charge';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const liab = liabilityCore(ctx, l);
  const ic = itcCore(ctx, l, data, 'auto');
  const itc = ic.core;
  const rc = rcmCore(ctx, l);
  // Only DRC-03s paid for a stated cause count here (a generic one could belong to any of the three).
  const solo = { ...ctx, soleRecipe: false };
  const dl = drc03For(solo, data, 'liability');
  const di = drc03For(solo, data, 'itc');

  const liabPay = toPayOf(mapHeads(subHeads(liab.totals.residual, dl.counted), (v) => Math.max(0, v)));
  const itcPay = toPayOf(mapHeads(subHeads(subHeads(itc.totals.residual, ic.rule364), di.counted), (v) => Math.max(0, v)));
  const rcmPay = toPayOf(rc.totals.residual);
  const toPay = addHeads(liabPay, itcPay, rcmPay);
  const pos = (v: HeadAmounts) => mapHeads(v, (x) => Math.max(0, x));
  const computed = addHeads(pos(liab.totals.diff), pos(itc.totals.diff), pos(rc.totals.diff));
  const heads = activeHeads(liab.totals.a, liab.totals.b, itc.totals.a, itc.totals.b, rc.totals.a, rc.totals.b);
  const fig = noticeFigures(ctx, 'tax');
  const hl = buildHeads(heads, fig, computed, toPay);

  const n = ctx.period.periods.length;
  const missingAny = (c: { missing: { words: string }[] }) => c.missing.some((m) => !/not due/.test(m.words));
  const parts: AnnexureStatus[] = [
    statusOf(liab.periodCompared.length, n, missingAny(liab)),
    statusOf(itc.periodCompared.length, ic.applicable.length, missingAny(itc) || ic.reclaimMissing.length > 0),
    statusOf(rc.periodCompared.length, n, missingAny(rc)),
  ];
  const status: AnnexureStatus = parts.every((s) => s === 'needs_data') ? 'needs_data' : parts.every((s) => s === 'ready') ? 'ready' : 'partial';

  const ps2b = itc.periodCompared.filter((p) => periodIndex(p) >= periodIndex('01/2022'));
  const ps2a = itc.periodCompared.filter((p) => periodIndex(p) < periodIndex('01/2022'));
  const srcLiab = [...rangeRef(l, 'GSTR1', liab.periodCompared), ...rangeRef(l, 'GSTR3B', liab.periodCompared)];
  const srcItc = [
    ...rangeRef(l, 'GSTR3B', itc.periodCompared), ...rangeRef(l, 'GSTR2B', ps2b), ...rangeRef(l, 'GSTR2A', ps2a),
    ...(itc.periodCompared.some((p) => ic.reclaims.has(p)) ? [{ table: 'gst_credit_reversal_reclaim_entries', period: ctx.period.label, label: '4D(1) re-claimed' }] : []),
  ];
  const srcRcm = rangeRef(l, 'GSTR3B', rc.periodCompared);
  const glanceRows: [string, HeadAmounts, SourceRef[]][] = [
    ['Liability — GSTR-1 total liability', liab.totals.a, rangeRef(l, 'GSTR1', liab.periodCompared)],
    ['Liability — GSTR-3B 3.1(a) + 3.1(b)', liab.totals.b, rangeRef(l, 'GSTR3B', liab.periodCompared)],
    ['Liability — difference (GSTR-1 − GSTR-3B)', liab.totals.diff, srcLiab],
    ['Liability — left to pay after timing and DRC-03', liabPay, srcLiab],
    ['ITC — GSTR-3B 4A(5) − 4D(1)', itc.totals.a, srcItc.filter((r) => r.label !== 'GSTR-2B' && r.label !== 'GSTR-2A')],
    ['ITC — GSTR-2B / 2A available', itc.totals.b, srcItc.filter((r) => r.label === 'GSTR-2B' || r.label === 'GSTR-2A')],
    ['ITC — difference (GSTR-3B − supplier side)', itc.totals.diff, srcItc],
    ['ITC — excess left after timing, Rule 36(4) and DRC-03', itcPay, srcItc],
    ['Reverse charge — tax paid 3.1(d)', rc.totals.b, srcRcm],
    ['Reverse charge — credit 4A(2) + 4A(3)', rc.totals.a, srcRcm],
    ['Reverse charge — excess credit after timing', rcmPay, srcRcm],
  ];
  const glance: AnnexureTable = {
    key: 'fy_glance',
    title: `At a glance: ${ctx.period.label}`,
    note: 'Totals of the months compared in the notice period. Differences: liability GSTR-1 − GSTR-3B; ITC GSTR-3B − supplier side; reverse charge credit − tax paid.',
    columns: [{ key: 'item', label: 'Item', kind: 'text' }, ...headColumns('v', 'Tax', heads)],
    rows: [
      ...glanceRows.map(([label, v, src]) => ({ kind: 'data' as const, cells: { item: label, ...headCells('v', heads, v) }, _source: src })),
      { kind: 'total' as const, cells: { item: 'Total to pay or reverse', ...headCells('v', heads, toPay) }, _source: [] },
    ],
  };
  const picks = [...dl.picks, ...di.picks.filter((p) => !dl.picks.some((q) => q.row.id === p.row.id))];
  const counted = addHeads(dl.counted, di.counted);
  const tables = [
    glance, liab.table, itc.table, reclaimTable(ic, heads), outsideTable(ic, heads), rc.table, rcmStatementTable(ctx, data, heads),
    picks.length ? drc03Table(picks, heads) : null,
  ].filter((t): t is AnnexureTable => !!t);

  const sources = [
    monthSource(l, ctx, { key: 'GSTR1', months: liab.months }),
    monthSource(l, ctx, { key: 'GSTR3B', months: liab.months }),
  ];
  const m2b = itc.months.filter((p) => periodIndex(p) >= periodIndex('01/2022'));
  const m2a = itc.months.filter((p) => !m2b.includes(p));
  if (m2b.length) sources.push(monthSource(l, ic.ctx, { key: 'GSTR2B', months: m2b }));
  if (m2a.length) sources.push(monthSource(l, ic.ctx, { key: 'GSTR2A', months: m2a }));
  const reclaimFys = fysOf(itc.months).filter((fy) => Number(fy.slice(0, 4)) >= 2022);
  if (reclaimFys.length) sources.push(reclaimSource(data, reclaimFys));

  const headline = liab.periodCompared.length || itc.periodCompared.length
    ? hl.toPayTotal > 0
      ? `For ${ctx.period.label}, ${rupees(hl.toPayTotal)} is left to pay or reverse after timing and DRC-03 (${fmtHeadsWords(toPay, heads)}).`
      : `For ${ctx.period.label}, liability, ITC and reverse charge match within ₹10 per head after timing and DRC-03.`
    : `Nothing could be compared for ${ctx.period.label} yet.`;
  return {
    recipe: 'fy_summary', status, title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
    summary: {
      headline,
      computed_label: 'Shortfall in liability + excess ITC + excess reverse-charge credit for the period',
      heads: hl.lines,
      lines: [
        line('Liability: GSTR-1 − GSTR-3B', liab.totals.diff),
        line('Liability: settled in another month (timing)', liab.totals.timing, 'reconciling'),
        line('Liability: DRC-03 paid', dl.counted, 'reconciling'),
        line('Liability: to pay', liabPay, 'result'),
        line('ITC: GSTR-3B − GSTR-2B / 2A', itc.totals.diff),
        line('ITC: in the supplier side in another month (timing)', itc.totals.timing, 'reconciling'),
        line('ITC: Rule 36(4) provisional credit allowed', ic.rule364, 'reconciling'),
        line('ITC: DRC-03 paid', di.counted, 'reconciling'),
        line('ITC: excess to reverse', itcPay, 'result'),
        line('Reverse charge: credit − tax paid', rc.totals.diff),
        line('Reverse charge: excess credit to reverse', rcmPay, 'result'),
        line('Total to pay or reverse', toPay, 'result'),
      ],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: [
        'Every figure is a return as filed / generated on the portal, pulled by the extension — never the app’s own drafts.',
        'ITC is matched with GSTR-2B from January 2022 (s.16(2)(aa)) and with GSTR-2A before it; Rule 36(4) allowed 20% / 10% / 5% above GSTR-2A from October 2019 to December 2021.',
        'A head counts as matched within ₹10; heads are never netted, and an excess in one area is not set against a shortfall in another.',
        ...(ic.reclaimMissing.length ? [`The credit reversal and re-claimed statement is not fetched for FY ${ic.reclaimMissing.join(', ')}: 4D(1) re-claims are not deducted.`] : []),
        ...(counted.igst + counted.cgst + counted.sgst + counted.cess === 0 && picks.length ? ['DRC-03s of the period without a stated cause are listed, not counted.'] : []),
      ],
      missing: [...new Set([...missingSentences(liab), ...missingSentences(itc), ...ic.reclaimMissing.map((fy) => `Credit reversal and re-claimed statement not fetched: FY ${fy}.`)])],
    },
    tables,
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: ctx.period.periods, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR1', 'GSTR3B', 'GSTR2B', 'GSTR2A'], liab.months),
      reclaims: (data.reclaims ?? []).filter((r) => reclaimFys.map(fyLong).includes(r.financialYear)).map((r) => [r.id, r.pulledAt]),
      statement: (data.rcmStatement ?? []).map((r) => [r.id, r.pulledAt]),
      drc03: picks.map((p) => [p.row.id, p.row.updatedAt, p.counted]),
    },
  };
}
