// Late fee on late GSTR-1 and GSTR-3B (s.47, issue LATE_FEE_47), with
// computeLateFee and the slabs of docs/INTEREST_LATE_FEE_POSITIONS.md §4: the
// turnover tier from the annual turnover typed for the FY (client_annual_
// turnover); when it is missing, the middle tier, and the annexure says so.
// Late fee paid in GSTR-3B Table 5.1 is set against it.
import type { AnnexureRow, Head, HeadAmounts, PortalData, RecipeContext, RecipeResult, FiledType } from '../types';
import { computeLateFee, dueDayForReturn, type LateFeeTier } from '@/utils/interestLateFee';
import { addHeads, isZeroHeads, mapHeads, subHeads, zeroHeads } from '../portal';
import { daysBetween, dateLabel, dueDateIso, fyOfPeriod, periodLabel, PERIOD_SOURCE_WORDS } from '../periods';
import {
  buildHeads, cellState, fetchPlan, fmtHeadsWords, FILED_LABEL, headCells, headColumns, inputsOf, line, lookup, missingWords,
  monthSource, noticeFigures, RECIPE_VERSION, refOf, rupees, statusOf, toPayOf,
} from './common';
import { filingRow } from './interest';
import { needsPeriod } from './documentsOnly';

const TIER_WORDS: Record<LateFeeTier, string> = {
  nil: 'Nil return (₹20 a day, up to ₹500)',
  upTo1_5Cr: 'Turnover up to ₹1.5 crore (₹50 a day, up to ₹2,000)',
  from1_5CrTo5Cr: 'Turnover ₹1.5–5 crore (₹50 a day, up to ₹5,000)',
  above5Cr: 'Turnover above ₹5 crore (₹50 a day, up to ₹10,000)',
};
const FEE_HEADS: Head[] = ['cgst', 'sgst'];

export function lateFee(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'Late fee on late returns (s.47)';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const months = ctx.period.periods;
  let computed = zeroHeads(), paid = zeroHeads();
  let onTime = 0, assumed = false, checked = 0;
  const missing: string[] = [];
  const rows: AnnexureRow[] = [];
  const turnoverOf = (p: string) => (data.turnover ?? []).find((t) => t.financialYear === fyOfPeriod(p)) ?? null;
  for (const p of months) {
    for (const type of ['GSTR3B', 'GSTR1'] as FiledType[]) {
      const fs = filingRow(data, type === 'GSTR3B' ? ['GSTR-3B', 'GSTR-3B (Q)'] : ['GSTR-1', 'GSTR-1 (IFF)'], p);
      const due = dueDateIso(p, fs?.targetDate ?? dueDayForReturn(type === 'GSTR3B' ? 'GSTR-3B' : 'GSTR-1', ctx.client.dueDay1, ctx.client.dueDay2));
      const s = cellState(l, type, p, ctx);
      const row = l.filed(type, p);
      const refs = [...refOf(row), ...(fs ? [{ table: 'filing_status', period: p, label: 'Filing Status (tracker)', arn: fs.arn, pulled_at: fs.updatedAt, row_id: fs.id }] : [])];
      const base = { ret: FILED_LABEL[type], month: periodLabel(p), due: dateLabel(due) };
      if (s.state !== 'ready') {
        if (s.state === 'not_due') continue;
        missing.push(`${FILED_LABEL[type]} ${periodLabel(p)}: ${missingWords(type, s.state, s.why)}`);
        rows.push({ kind: 'missing', cells: { ...base, filed: '—', days: null, tier: missingWords(type, s.state, s.why) }, _source: refs });
        continue;
      }
      const filed = row?.filedDate ?? (fs?.status === 'Filed' ? fs.filedDate : null);
      if (!filed) {
        missing.push(`${FILED_LABEL[type]} ${periodLabel(p)}: filed date not on record`);
        rows.push({ kind: 'missing', cells: { ...base, filed: '—', days: null, tier: 'Filed date not on record' }, _source: refs });
        continue;
      }
      checked += 1;
      if (type === 'GSTR3B') paid = addHeads(paid, l.g3b(p)!.lateFee);
      const days = Math.max(0, daysBetween(due, filed));
      if (!days) { onTime += 1; continue; }
      let isNil = false;
      if (type === 'GSTR3B') { const g = l.g3b(p)!; isNil = isZeroHeads(addHeads(g.t31a, g.t31b, g.t31d)); }
      else { const g = l.g1(p)!; isNil = g.empty || (isZeroHeads(g.liability) && Math.abs(g.value) < 0.005); }
      const fee = computeLateFee(isNil, days, turnoverOf(p)?.aggregate ?? null);
      if (fee.turnoverAssumed && !isNil) assumed = true;
      const v: HeadAmounts = { igst: 0, cgst: fee.cgst, sgst: fee.sgst, cess: 0 };
      computed = addHeads(computed, v);
      rows.push({
        kind: 'data',
        cells: { ...base, filed: dateLabel(filed), days, tier: `${TIER_WORDS[fee.tier]}${fee.turnoverAssumed && !isNil ? ' — turnover not typed, middle tier assumed' : ''}`, ...headCells('f', FEE_HEADS, v), f_total: fee.total },
        _source: refs,
      });
    }
  }
  rows.push({ kind: 'total', cells: { ret: 'Total', ...headCells('f', FEE_HEADS, computed), f_total: computed.cgst + computed.sgst }, _source: [] });
  const toPay = toPayOf(mapHeads(subHeads(computed, paid), (v) => Math.max(0, v)));
  const fig = noticeFigures(ctx, 'fee');
  const hl = buildHeads(FEE_HEADS, fig, computed, toPay);
  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months }), monthSource(l, ctx, { key: 'GSTR1', months })];
  const late = rows.filter((r) => r.kind === 'data').length;
  const status = statusOf(checked, months.length * 2, missing.length > 0);
  const turnoverRows = (data.turnover ?? []).filter((t) => months.some((p) => fyOfPeriod(p) === t.financialYear));
  const headline = checked
    ? late
      ? `${late} return(s) of ${ctx.period.label} were filed late; late fee of ${rupees(hl.computedTotal)} works out${hl.toPayTotal ? `, ${rupees(hl.toPayTotal)} more than Table 5.1 shows paid (${fmtHeadsWords(toPay, FEE_HEADS)})` : ', covered by Table 5.1'}.`
      : `Every return of ${ctx.period.label} that could be read was filed on time.`
    : `Nothing could be checked for ${ctx.period.label} yet.`;
  return {
    recipe: 'late_fee', status, title, periods: months, financialYear: ctx.period.financialYear,
    summary: {
      headline,
      computed_label: 'Late fee under s.47 for the days late',
      heads: hl.lines,
      lines: [
        line('Late fee worked out', computed),
        line('Late fee paid in GSTR-3B Table 5.1', paid, 'reconciling'),
        line('Late fee left to pay', toPay, 'result'),
      ],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: [
        `${onTime} return(s) filed on time are not listed.`,
        'Slabs as in docs/INTEREST_LATE_FEE_POSITIONS.md §4 (CGST and SGST each); waivers and amnesty notifications for particular periods are not applied — check them for the period.',
        ...(assumed ? ['The annual turnover for the year is not typed in the app: the middle tier (₹5,000 cap) is assumed.'] : []),
        'A nil return here means GSTR-3B with no outward or reverse-charge tax, or a GSTR-1 with nothing in it — an approximation of the portal’s own test.',
      ],
      missing,
    },
    tables: [{
      key: 'late_fee_returns',
      title: 'Returns filed late',
      columns: [
        { key: 'ret', label: 'Return', kind: 'text' }, { key: 'month', label: 'Month', kind: 'text' },
        { key: 'due', label: 'Due on', kind: 'text' }, { key: 'filed', label: 'Filed on', kind: 'text' },
        { key: 'days', label: 'Days late', kind: 'int' }, { key: 'tier', label: 'Slab', kind: 'text' },
        ...headColumns('f', 'Late fee', FEE_HEADS), { key: 'f_total', label: 'Total', kind: 'money', group: 'Late fee' },
      ],
      rows,
    }],
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: months, notice: [fig.perHead, fig.total, fig.basis], due: [ctx.client.dueDay1, ctx.client.dueDay2],
      filed: inputsOf(l, ['GSTR3B', 'GSTR1'], months),
      turnover: turnoverRows.map((t) => [t.id, t.updatedAt, t.aggregate]),
      tracker: (data.filingStatus ?? []).filter((r) => months.includes(r.period)).map((r) => [r.id, r.updatedAt, r.filedDate, r.targetDate]),
    },
  };
}
