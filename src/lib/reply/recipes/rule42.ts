// Rule 42 reversal of common credit (issue ITC_RULE_42_43), as far as
// computeRule42Reversal goes: common credit = GSTR-3B 4A for the year less the
// ITC used only for exempt supplies (T1), times exempt ÷ aggregate turnover
// (typed for the year in the app), against what 4B(1) reversed. Approximate by
// the firm's own position (docs/INTEREST_LATE_FEE_POSITIONS.md §5): T2 / T3
// are not netted, the monthly-then-annual true-up is not modelled and Rule 43
// is out of scope — the documents the issue lists are still needed for those.
import type { AnnexureRow, Head, PortalData, RecipeContext, RecipeResult } from '../types';
import { HEAD_LABEL, HEADS } from '../types';
import { computeRule42Reversal } from '@/utils/interestLateFee';
import { addHeads, mapHeads, r2, sumHeads, zeroHeads } from '../portal';
import { fyMonths, fysOf, PERIOD_SOURCE_WORDS } from '../periods';
import {
  activeHeads, buildHeads, cellState, emptySummary, fetchPlan, fmtHeadsWords, fyCellSource, inputsOf, line, lookup, monthSource,
  noticeFigures, RECIPE_VERSION, rangeRef, rupees, statusOf, toPayOf,
} from './common';
import { needsPeriod } from './documentsOnly';

const cellsOf = (v: Record<Head, number>) => ({ ...Object.fromEntries(HEADS.map((h) => [`v_${h}`, r2(v[h])])), total: r2(sumHeads(v)) });

export function rule42(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'Rule 42 reversal of common credit';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const fys = fysOf(ctx.period.periods);
  const months = fys.flatMap(fyMonths).filter((p) => `${p.slice(3)}-${p.slice(0, 2)}-01` <= ctx.today);
  const turnoverOf = (fy: string) => (data.turnover ?? []).find((t) => t.financialYear === fy) ?? null;
  const usable = fys.filter((fy) => { const t = turnoverOf(fy); return !!t && t.exempt !== null && !!t.aggregate; });
  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months }), fyCellSource('TURNOVER', fys.map((fy) => ({
    period: `03/${Number(fy.slice(0, 4)) + 1}`, state: usable.includes(fy) ? 'ready' as const : 'not_fetched' as const,
    status: usable.includes(fy) ? null : 'type it on the client’s Edit page', pulled_at: turnoverOf(fy)?.updatedAt ?? null,
  })))];
  const readiness = { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] };
  const links = [{ label: 'Type the year’s turnover (Edit client)', to: `/edit-client/${ctx.client.id}` }];
  if (!usable.length) {
    return {
      recipe: 'rule_42', status: 'needs_data', title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
      summary: {
        ...emptySummary(`The exempt and aggregate turnover for FY ${fys.join(', ')} are not typed in the app, so the reversal cannot be worked out. Type them, or use the documents below.`, '—'),
        documents: ctx.documents, links,
      },
      tables: [], readiness, explained: null, toPay: null,
      inputs: { v: RECIPE_VERSION, periods: ctx.period.periods, turnover: null },
    };
  }
  let itc4a = zeroHeads(), rev4b1 = zeroHeads(), d1Heads = zeroHeads();
  let used = 0;
  const rows: AnnexureRow[] = [];
  for (const fy of usable) {
    const t = turnoverOf(fy)!;
    const ms = fyMonths(fy).filter((p) => cellState(l, 'GSTR3B', p, ctx).state === 'ready');
    used += ms.length;
    const a = ms.reduce((s, p) => { const g = l.g3b(p)!; return addHeads(s, g.itc.impg, g.itc.imps, g.itc.isrc, g.itc.isd, g.itc.oth); }, zeroHeads());
    const b = ms.reduce((s, p) => addHeads(s, l.g3b(p)!.rev.rul), zeroHeads());
    const res = computeRule42Reversal({ itcAvailable: sumHeads(a), itcDirectlyAttributableExempt: t.directExempt ?? 0, exemptTurnover: t.exempt, aggregateTurnover: t.aggregate });
    const total = sumHeads(a);
    const d1 = mapHeads(a, (v) => (total ? r2((res.reversal * v) / total) : 0));
    itc4a = addHeads(itc4a, a); rev4b1 = addHeads(rev4b1, b); d1Heads = addHeads(d1Heads, d1);
    const src = [...rangeRef(l, 'GSTR3B', ms), { table: 'client_annual_turnover', period: `FY ${fy}`, label: 'Annual turnover (typed)', pulled_at: t.updatedAt, row_id: t.id }];
    const ratio = res.ratio === null ? '—' : `${(res.ratio * 100).toFixed(2)}%`;
    rows.push(
      { kind: 'data', cells: { item: `FY ${fy}: ITC available 4A (${ms.length} months)`, ...cellsOf(a) }, _source: rangeRef(l, 'GSTR3B', ms) },
      { kind: 'data', cells: { item: `FY ${fy}: ITC used only for exempt supplies (T1)`, total: r2(t.directExempt ?? 0) }, _source: src.slice(-1) },
      { kind: 'data', cells: { item: `FY ${fy}: common credit`, total: res.commonCredit }, _source: src },
      { kind: 'data', cells: { item: `FY ${fy}: exempt ÷ aggregate turnover = ${ratio}`, total: null }, _source: src.slice(-1) },
      { kind: 'data', cells: { item: `FY ${fy}: reversal under rule 42 (D1), split by head in the ratio of 4A`, ...cellsOf(d1) }, _source: src },
      { kind: 'data', cells: { item: `FY ${fy}: reversed in GSTR-3B 4B(1)`, ...cellsOf(b) }, _source: rangeRef(l, 'GSTR3B', ms) },
    );
  }
  const heads: Head[] = activeHeads(itc4a);
  const short = mapHeads(addHeads(d1Heads, mapHeads(rev4b1, (v) => -v)), (v) => Math.max(0, v));
  const toPay = toPayOf(short);
  rows.push({ kind: 'total', cells: { item: 'Short reversal', ...cellsOf(short) }, _source: [] });
  const fig = noticeFigures(ctx, 'tax');
  const hl = buildHeads(heads, fig, short, toPay);
  const status = statusOf(used, months.length, used < months.length || usable.length < fys.length);
  return {
    recipe: 'rule_42', status, title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
    summary: {
      headline: hl.toPayTotal > 0
        ? `Rule 42 needs ${rupees(sumHeads(d1Heads))} reversed; 4B(1) shows ${rupees(sumHeads(rev4b1))}, so ${rupees(hl.toPayTotal)} is short (${fmtHeadsWords(toPay, heads)}). Approximate.`
        : `4B(1) reversals cover the rule 42 reversal of ${rupees(sumHeads(d1Heads))} (approximate).`,
      computed_label: 'Rule 42 reversal (D1) less 4B(1) reversed',
      heads: hl.lines,
      lines: [line('ITC available 4A', itc4a), line('Reversal under rule 42 (D1)', d1Heads), line('Reversed in 4B(1)', rev4b1, 'reconciling'), line('Short reversal', toPay, 'result')],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: [
        'Approximate (docs/INTEREST_LATE_FEE_POSITIONS.md §5): ITC for non-business use (T2) and blocked credit (T3) are not netted, so the reversal may be overstated; the annual true-up and Rule 43 are not covered.',
        '4B(1) also holds reversals under rules 38 and 43 and s.17(5), so it may cover more than rule 42.',
      ],
      missing: [], documents: ctx.documents, links,
    },
    tables: [{
      key: 'rule_42',
      title: 'Rule 42 working',
      columns: [{ key: 'item', label: 'Item', kind: 'text' }, ...HEADS.filter((h) => heads.includes(h)).map((h) => ({ key: `v_${h}`, label: HEAD_LABEL[h], kind: 'money' as const })), { key: 'total', label: 'Total', kind: 'money' }],
      rows,
    }],
    readiness, explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: ctx.period.periods, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR3B'], months),
      turnover: usable.map((fy) => { const t = turnoverOf(fy)!; return [t.id, t.updatedAt, t.aggregate, t.exempt, t.directExempt]; }),
    },
  };
}
