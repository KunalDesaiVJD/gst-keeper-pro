// GSTR-9 v GSTR-3B (issue GSTR9_V_3B): when the year's Annual Return working
// is in the app (annual_return_docs), its Table 9 tax payable — the portal's
// figure, the books (4N) or a superadmin's override, as the working shows it —
// against the tax the GSTR-3Bs of the year declared, 3.1(a)+(b)+(d), per
// head. Without the working the recipe needs data: open the Annual Return.
import type { AnnexureRow, Head, PortalData, RecipeContext, RecipeResult } from '../types';
import { HEADS } from '../types';
import { computeWorkings } from '@/lib/gstr9/engine';
import { normalizeDocs } from '@/lib/gstr9/defaults';
import type { DocKey } from '@/lib/gstr9/types';
import { addHeads, mapHeads, r2, zeroHeads } from '../portal';
import { fyMonths, fysOf, PERIOD_SOURCE_WORDS } from '../periods';
import {
  activeHeads, buildHeads, cellState, emptySummary, fetchPlan, fmtHeadsWords, inputsOf, line, lookup, monthSource,
  noticeFigures, RECIPE_VERSION, rangeRef, rupees, statusOf, toPayOf,
} from './common';
import { needsPeriod } from './documentsOnly';

const SOURCE_WORDS: Record<string, string> = { portal: 'GSTR-9 as computed on the portal', '4N': 'the books (Table 4N)', override: 'typed over by the superadmin' };

export function gstr9Vs3b(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'GSTR-9 v GSTR-3B: tax payable v declared';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const fys = fysOf(ctx.period.periods);
  const workings = fys.map((fy) => ({ fy, w: (data.annual ?? []).find((a) => a.financialYear === fy) ?? null }));
  const months = fys.flatMap(fyMonths).filter((p) => `${p.slice(3)}-${p.slice(0, 2)}-01` <= ctx.today);
  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months })];
  const readiness = { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] };
  const links = fys.map((fy) => ({ label: `Annual Return working, FY ${fy}`, to: `/annual-return?client=${ctx.client.id}&fy=${fy}` }));
  const have = workings.filter((x) => x.w);
  if (!have.length) {
    return {
      recipe: 'gstr9_vs_3b', status: 'needs_data', title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
      summary: { ...emptySummary(`The Annual Return working for FY ${fys.join(', ')} is not in the app. Build it (or pull the GSTR-9) to compare Table 9 with the GSTR-3Bs, or use the documents below.`, '—'), documents: ctx.documents, links },
      tables: [], readiness, explained: null, toPay: null,
      inputs: { v: RECIPE_VERSION, periods: ctx.period.periods, annual: null },
    };
  }
  let payable = zeroHeads(), declared = zeroHeads();
  let used = 0;
  const rows: AnnexureRow[] = [];
  for (const { fy, w } of have) {
    const docs = normalizeDocs(w!.docs as Partial<Record<DocKey, unknown>>);
    const wk = computeWorkings(docs, { clientName: ctx.client.name, gstin: ctx.client.gstin ?? '', financialYear: fy, noItcBuilder: false });
    const ms = fyMonths(fy).filter((p) => cellState(l, 'GSTR3B', p, ctx).state === 'ready');
    used += ms.length;
    const d = ms.reduce((s, p) => { const g = l.g3b(p)!; return addHeads(s, g.t31a, g.t31b, g.t31d); }, zeroHeads());
    const t9 = wk.g9.t9;
    const pay = { igst: t9.igst.payable, cgst: t9.cgst.payable, sgst: t9.sgst.payable, cess: t9.cess.payable };
    payable = addHeads(payable, pay); declared = addHeads(declared, d);
    const src = [
      { table: 'annual_return_docs', period: `FY ${fy}`, label: 'Annual Return working', pulled_at: Object.values(w!.updatedAt).sort().pop() ?? null },
      ...rangeRef(l, 'GSTR3B', ms),
    ];
    for (const h of HEADS) {
      if (!pay[h] && !d[h]) continue;
      rows.push({
        kind: 'data',
        cells: { fy: `FY ${fy}`, head: h.toUpperCase(), payable: r2(pay[h]), from: SOURCE_WORDS[t9[h].payableSource] ?? t9[h].payableSource, declared: r2(d[h]), diff: r2(pay[h] - d[h]) },
        _source: src,
      });
    }
  }
  const heads: Head[] = activeHeads(payable, declared);
  const diff = addHeads(payable, mapHeads(declared, (v) => -v));
  const toPay = toPayOf(mapHeads(diff, (v) => Math.max(0, v)));
  const fig = noticeFigures(ctx, 'tax');
  const hl = buildHeads(heads, fig, mapHeads(diff, (v) => Math.max(0, v)), toPay);
  const status = statusOf(used, months.length, used < months.length || have.length < fys.length);
  return {
    recipe: 'gstr9_vs_3b', status, title, periods: ctx.period.periods, financialYear: ctx.period.financialYear,
    summary: {
      headline: hl.toPayTotal > 0
        ? `Table 9 of GSTR-9 shows ${rupees(hl.toPayTotal)} more tax payable than the GSTR-3Bs declared (${fmtHeadsWords(toPay, heads)}).`
        : 'Table 9 of GSTR-9 does not exceed the tax the GSTR-3Bs declared (within ₹10 per head).',
      computed_label: 'GSTR-9 Table 9 payable − GSTR-3B 3.1(a)+(b)+(d)',
      heads: hl.lines,
      lines: [line('GSTR-9 Table 9 tax payable', payable), line('GSTR-3B 3.1(a)+(b)+(d) declared', declared), line('Difference (GSTR-9 − GSTR-3B)', diff), line('To pay', toPay, 'result')],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: ['Table 9 payable as the Annual Return working shows it (its source is named per row). A DRC-03 paid with the annual return is set off in that working’s payables step.'],
      missing: workings.filter((x) => !x.w).map((x) => `Annual Return working not in the app: FY ${x.fy}.`), links,
    },
    tables: [{
      key: 'gstr9_vs_3b',
      title: 'Table 9 v GSTR-3B by head',
      columns: [
        { key: 'fy', label: 'Year', kind: 'text' }, { key: 'head', label: 'Head', kind: 'text' },
        { key: 'payable', label: 'GSTR-9 Table 9 payable', kind: 'money' }, { key: 'from', label: 'Payable from', kind: 'text' },
        { key: 'declared', label: 'GSTR-3B 3.1(a)+(b)+(d)', kind: 'money' }, { key: 'diff', label: 'Difference (GSTR-9 − GSTR-3B)', kind: 'money' },
      ],
      rows,
    }],
    readiness, explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: ctx.period.periods, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR3B'], months),
      annual: have.map(({ fy, w }) => [fy, w!.updatedAt]),
    },
  };
}

