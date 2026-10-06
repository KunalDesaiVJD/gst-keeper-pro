// Interest on a late GSTR-3B (s.50(1), issue INTEREST_50), per
// docs/INTEREST_LATE_FEE_POSITIONS.md: 18% a year on a 365-day year, from the
// day after the due date to the day of filing, on the part of the tax paid in
// cash only. The cash part is the return's own payment table when the pulled
// summary carries it; otherwise an estimate — reverse-charge tax (always paid
// in cash) plus the forward-charge tax left after the ITC set-off of
// computeItcOffset (Rule 88A order) — and the annexure says so. Interest paid
// in Table 5.1 of the same returns is set against it.
import type { AnnexureRow, AnnexureTable, FilingStatusRow, HeadAmounts, PortalData, RecipeContext, RecipeResult } from '../types';
import { computeItcOffset } from '@/utils/gstr3bReports';
import { computeInterest, dueDayForReturn } from '@/utils/interestLateFee';
import { addHeads, mapHeads, r2, subHeads, zeroHeads } from '../portal';
import { daysBetween, dateLabel, dueDateIso, periodLabel, PERIOD_SOURCE_WORDS } from '../periods';
import {
  activeHeads, buildHeads, cellState, fetchPlan, fmtHeadsWords, headCells, headColumns, inputsOf, line, lookup, missingWords,
  monthSource, noticeFigures, RECIPE_VERSION, refOf, rupees, statusOf, toPayOf,
} from './common';
import { needsPeriod } from './documentsOnly';

/** The firm's Filing Status row for a month's GSTR-3B (monthly or quarterly). */
export const filingRow = (data: PortalData, returnTypes: string[], p: string): FilingStatusRow | undefined =>
  (data.filingStatus ?? []).find((r) => r.period === p && returnTypes.includes(r.returnType));

/** Interest on cash for `days` (computeInterest covers IGST / CGST / SGST; cess is worked the same way). */
export function interestOn(cash: HeadAmounts, days: number): HeadAmounts {
  const i = computeInterest({ igst: cash.igst, cgst: cash.cgst, sgst: cash.sgst }, days);
  const c = computeInterest({ igst: cash.cess, cgst: 0, sgst: 0 }, days);
  return { igst: i.igst, cgst: i.cgst, sgst: i.sgst, cess: c.igst };
}

/** Cash part of a month's tax: as paid when the return shows it, else the Rule 88A estimate (RCM always in cash). */
export function cashPortion(g3: NonNullable<ReturnType<ReturnType<typeof lookup>['g3b']>>): { cash: HeadAmounts; asPaid: boolean } {
  if (g3.cashPaid) return { cash: g3.cashPaid, asPaid: true };
  const fwd = addHeads(g3.t31a, g3.t31b);
  const itc = mapHeads(g3.net, (v) => Math.max(0, v));
  const off = computeItcOffset({ igst: fwd.igst, cgst: fwd.cgst, sgst: fwd.sgst }, { igst: itc.igst, cgst: itc.cgst, sgst: itc.sgst }).cashPayable;
  const fwdCash: HeadAmounts = { igst: off.igst, cgst: off.cgst, sgst: off.sgst, cess: Math.max(0, fwd.cess - itc.cess) };
  return { cash: mapHeads(addHeads(fwdCash, g3.t31d), r2), asPaid: false };
}

export function interest(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'Interest on late GSTR-3B (s.50)';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const months = ctx.period.periods;
  let computed = zeroHeads(), paid = zeroHeads(), cashAll = zeroHeads();
  let estimates = 0, accruing = 0;
  const used: string[] = [];
  const missing: string[] = [];
  const rows: { p: string; cash?: HeadAmounts; int?: HeadAmounts; paid?: HeadAmounts; due: string; filed: string | null; days: number; basis: string; refs: AnnexureRow['_source']; words?: string }[] = [];
  for (const p of months) {
    const fs = filingRow(data, ['GSTR-3B', 'GSTR-3B (Q)'], p);
    const due = dueDateIso(p, fs?.targetDate ?? dueDayForReturn('GSTR-3B', ctx.client.dueDay1, ctx.client.dueDay2));
    const s = cellState(l, 'GSTR3B', p, ctx);
    const row = l.filed('GSTR3B', p);
    const refs = [...refOf(row), ...(fs ? [{ table: 'filing_status', period: p, label: 'Filing Status (tracker)', arn: fs.arn, pulled_at: fs.updatedAt, row_id: fs.id }] : [])];
    if (s.state === 'ready') {
      const filed = row?.filedDate ?? (fs?.status === 'Filed' ? fs.filedDate : null);
      if (!filed) { rows.push({ p, due, filed: null, days: 0, basis: '', refs, words: 'GSTR-3B filed date not on record' }); missing.push(p); continue; }
      const g3 = l.g3b(p)!;
      const days = Math.max(0, daysBetween(due, filed));
      const { cash, asPaid } = cashPortion(g3);
      if (!asPaid) estimates += 1;
      const int = interestOn(cash, days);
      computed = addHeads(computed, int); paid = addHeads(paid, g3.interest); cashAll = addHeads(cashAll, cash);
      used.push(p);
      rows.push({ p, cash, int, paid: g3.interest, due, filed, days, basis: asPaid ? 'As paid' : 'Estimate', refs });
    } else if (s.state === 'not_filed') {
      accruing += 1;
      const days = Math.max(0, daysBetween(due, ctx.today));
      rows.push({ p, due, filed: null, days, basis: '', refs, words: `Not filed on the portal: interest runs from ${dateLabel(due)} (${days} days to today); no figures to compute on` });
      missing.push(p);
    } else {
      rows.push({ p, due, filed: null, days: 0, basis: '', refs, words: missingWords('GSTR3B', s.state, s.why) });
      missing.push(p);
    }
  }
  const heads = activeHeads(cashAll, computed, paid);
  const toPay = toPayOf(mapHeads(subHeads(computed, paid), (v) => Math.max(0, v)));
  const fig = noticeFigures(ctx, 'interest');
  const hl = buildHeads(heads, fig, mapHeads(computed, r2), toPay);
  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months })];
  const status = statusOf(used.length, months.length, missing.some((p) => cellState(l, 'GSTR3B', p, ctx).state !== 'not_due'));
  const table: AnnexureTable = {
    key: 'interest_monthly',
    title: 'Interest month by month',
    note: 'Days late = filing date − due date. Interest = cash part × 18% ÷ 365 × days late, per head.',
    columns: [
      { key: 'month', label: 'Month', kind: 'text' as const },
      { key: 'due', label: 'Due on', kind: 'text' as const },
      { key: 'filed', label: 'Filed on', kind: 'text' as const },
      { key: 'days', label: 'Days late', kind: 'int' as const },
      { key: 'basis', label: 'Cash part', kind: 'text' as const },
      ...headColumns('c', 'Paid in cash', heads),
      ...headColumns('i', 'Interest', heads),
      ...headColumns('p', 'Paid in 5.1', heads),
    ],
    rows: [
      ...rows.map((r): AnnexureRow => (r.words
        ? { kind: 'missing', cells: { month: periodLabel(r.p), due: dateLabel(r.due), filed: '—', days: null, basis: r.words }, _source: r.refs }
        : {
          kind: 'data',
          cells: {
            month: periodLabel(r.p), due: dateLabel(r.due), filed: dateLabel(r.filed), days: r.days, basis: r.basis,
            ...headCells('c', heads, r.cash!), ...headCells('i', heads, r.int!), ...headCells('p', heads, r.paid!),
          },
          _source: r.refs,
        })),
      { kind: 'total' as const, cells: { month: 'Total', ...headCells('c', heads, cashAll), ...headCells('i', heads, computed), ...headCells('p', heads, paid) }, _source: [] },
    ],
  };
  const late = rows.filter((r) => !r.words && r.days > 0).length;
  const headline = used.length
    ? hl.toPayTotal > 0
      ? `${late} of ${used.length} returns were filed late; interest of ${rupees(hl.computedTotal)} works out, ${rupees(hl.toPayTotal)} more than Table 5.1 shows paid (${fmtHeadsWords(toPay, heads)}).`
      : late ? `${late} returns were filed late; the interest that works out (${rupees(hl.computedTotal)}) is covered by Table 5.1.` : `Every GSTR-3B of ${ctx.period.label} that could be read was filed on time.`
    : `Nothing could be computed for ${ctx.period.label} yet.`;
  return {
    recipe: 'interest', status, title, periods: months, financialYear: ctx.period.financialYear,
    summary: {
      headline,
      computed_label: 'Interest at 18% on the cash part for the days late',
      heads: hl.lines,
      lines: [
        line('Tax paid in cash (as paid or estimated)', cashAll),
        line('Interest worked out', computed),
        line('Interest paid in GSTR-3B Table 5.1', paid, 'reconciling'),
        line('Interest left to pay', toPay, 'result'),
      ],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: [
        'Firm position: interest only on the tax paid in cash (Rule 88B(1)), 18% a year on a 365-day year, from the day after the due date to the filing date.',
        ...(estimates ? [`Estimate for ${estimates} month(s): the pulled return does not show the cash paid per head, so reverse-charge tax plus the forward tax left after the ITC set-off (Rule 88A order) is taken as paid in cash.`] : []),
        ...(accruing ? [`${accruing} month(s) not filed: interest is still running and is not computed here.`] : []),
        'Interest paid in Table 5.1 of the same returns is set against it; the portal may post a month’s interest in the next return instead.',
      ],
      missing: missing.map((p) => `${periodLabel(p)}: ${rows.find((r) => r.p === p)?.words}.`),
    },
    tables: [table],
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: months, notice: [fig.perHead, fig.total, fig.basis], due: [ctx.client.dueDay1, ctx.client.dueDay2],
      filed: inputsOf(l, ['GSTR3B'], months),
      tracker: months.map((p) => filingRow(data, ['GSTR-3B', 'GSTR-3B (Q)'], p)).filter(Boolean).map((r) => [r!.id, r!.updatedAt, r!.filedDate, r!.targetDate]),
    },
  };
}
