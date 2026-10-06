// ITC taken after the s.16(4) time limit (issue ITC_16_4), document by
// document from GSTR-2B (from January 2022) or GSTR-2A (before). The credit
// for a document is taken to be claimed in the GSTR-3B of the month whose
// GSTR-2B / 2A shows it, on the day that GSTR-3B was filed. The last date for
// a document's financial year is 30 November after it (FY 2017-18 to 2020-21:
// 30 November 2021, s.16(5) — itcCutoffDate), or the day that year's GSTR-9
// was filed when that is earlier and on record.
import type { AnnexureRow, FiledReturn, HeadAmounts, PortalData, RecipeContext, RecipeResult, SourceRef } from '../types';
import { itcCutoffDate } from '@/components/gstr9/notice/cutoff';
import { addHeads, docSign, mapHeads, zeroHeads, isNotFiledStatus } from '../portal';
import { dateLabel, fyMarch, fyOfDate, periodIndex, periodLabel, PERIOD_SOURCE_WORDS } from '../periods';
import {
  activeHeads, buildHeads, cellState, fetchPlan, fmtHeadsWords, headCells, headColumns, inputsOf, line, lookup, missingWords,
  monthSource, noticeFigures, RECIPE_VERSION, refOf, rupees, statusOf, toPayOf,
} from './common';
import { filingRow } from './interest';
import { needsPeriod } from './documentsOnly';

const JAN_2022 = periodIndex('01/2022');

/** "2022-23" → "2023-11-30"; FY 2017-18 to 2020-21 → "2021-11-30" (itcCutoffDate). */
export const cutoffIso = (fy: string): string => {
  const d = itcCutoffDate(fy);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The day the FY's GSTR-9 was filed, when on record (the portal pull first, then the Filing Status tracker). */
export function gstr9FiledOn(data: PortalData, fy: string): { date: string; ref: SourceRef } | null {
  const row: FiledReturn | undefined = data.gstr9.find((r) => r.period === fyMarch(fy) && r.filedDate && !isNotFiledStatus(r.status));
  if (row?.filedDate) return { date: row.filedDate, ref: { table: 'gst_filed_returns', period: `FY ${fy}`, label: 'GSTR-9', arn: row.arn, pulled_at: row.updatedAt, row_id: row.id } };
  const fs = (data.filingStatus ?? []).find((r) => r.returnType === 'GSTR-9' && (r.period === fyMarch(fy) || r.period === fy) && r.status === 'Filed' && r.filedDate);
  if (fs?.filedDate) return { date: fs.filedDate, ref: { table: 'filing_status', period: `FY ${fy}`, label: 'GSTR-9 (Filing Status)', arn: fs.arn, pulled_at: fs.updatedAt, row_id: fs.id } };
  return null;
}

export function itc164(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'ITC after the s.16(4) time limit';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const months = ctx.period.periods;
  const rows: AnnexureRow[] = [];
  const missing: string[] = [];
  let barred = zeroHeads();
  let checked = 0, docsChecked = 0, withheld = 0;
  const g9Used = new Map<string, string | null>();
  const bodies: { cells: AnnexureRow['cells']; tax: HeadAmounts; refs: SourceRef[] }[] = [];
  for (const p of months) {
    const basis = periodIndex(p) >= JAN_2022 ? 'GSTR2B' : 'GSTR2A';
    const s3 = cellState(l, 'GSTR3B', p, ctx);
    const sb = cellState(l, basis, p, ctx);
    if (s3.state !== 'ready' || sb.state !== 'ready') {
      if (s3.state === 'not_due' || sb.state === 'not_due') continue;
      missing.push(`${periodLabel(p)}: ${[s3.state !== 'ready' ? missingWords('GSTR3B', s3.state, s3.why) : null, sb.state !== 'ready' ? missingWords(basis, sb.state, sb.why) : null].filter(Boolean).join('; ')}`);
      continue;
    }
    const r3 = l.filed('GSTR3B', p);
    const fs = filingRow(data, ['GSTR-3B', 'GSTR-3B (Q)'], p);
    const filed = r3?.filedDate ?? (fs?.status === 'Filed' ? fs.filedDate : null);
    if (!filed) { missing.push(`${periodLabel(p)}: GSTR-3B filed date not on record`); continue; }
    checked += 1;
    const docs = basis === 'GSTR2B'
      ? l.g2b(p)!.docs.filter((d) => {
        if (d.itcAvailable === false && /C/i.test(d.reason ?? '')) withheld += 1;
        return (d.section === 'B2B' || (d.section === 'CDNR' && d.type === 'DN')) && d.itcAvailable !== false;
      })
      : l.g2a(p)!;
    for (const d of docs) {
      if (!d.date) continue;
      docsChecked += 1;
      const fy = fyOfDate(d.date);
      let last = cutoffIso(fy);
      const g9 = gstr9FiledOn(data, fy);
      if (!g9Used.has(fy)) g9Used.set(fy, g9?.date ?? null);
      if (g9 && g9.date < last) last = g9.date;
      if (filed <= last) continue;
      const tax = mapHeads(d.tax, (v) => v * docSign(d));
      barred = addHeads(barred, tax);
      bodies.push({
        cells: {
          ctin: d.ctin ?? '—', name: d.name ?? '—', doc: `${d.type === 'DN' ? 'Debit note ' : ''}${d.number ?? '—'}${d.rev ? ' (reverse charge)' : ''}`,
          date: dateLabel(d.date), fy: `FY ${fy}`, last: `${dateLabel(last)}${g9 && g9.date === last ? ' (GSTR-9 filed)' : ''}`,
          month: periodLabel(p), filed: dateLabel(filed),
        },
        tax,
        refs: [...refOf(l.filed(basis, p)), ...refOf(r3), ...(g9 && g9.date === last ? [g9.ref] : [])],
      });
    }
  }
  const heads = activeHeads(barred);
  for (const b of bodies) rows.push({ kind: 'data', cells: { ...b.cells, ...headCells('t', heads, b.tax) }, _source: b.refs });
  if (bodies.length) rows.push({ kind: 'total', cells: { ctin: `${bodies.length} document(s)`, ...headCells('t', heads, barred) }, _source: [] });
  const toPay = toPayOf(mapHeads(barred, (v) => Math.max(0, v)));
  const fig = noticeFigures(ctx, 'tax');
  const hl = buildHeads(heads, fig, mapHeads(barred, (v) => Math.max(0, v)), toPay);
  const m2b = months.filter((p) => periodIndex(p) >= JAN_2022);
  const m2a = months.filter((p) => periodIndex(p) < JAN_2022);
  const sources = [
    monthSource(l, ctx, { key: 'GSTR3B', months }),
    ...(m2b.length ? [monthSource(l, ctx, { key: 'GSTR2B', months: m2b })] : []),
    ...(m2a.length ? [monthSource(l, ctx, { key: 'GSTR2A', months: m2a })] : []),
  ];
  const status = statusOf(checked, months.length, missing.length > 0);
  const headline = checked
    ? bodies.length
      ? `${bodies.length} document(s) in ${ctx.period.label} were claimed after the s.16(4) date: ${rupees(hl.toPayTotal)} (${fmtHeadsWords(toPay, heads)}).`
      : `No document in ${ctx.period.label} was claimed after the s.16(4) date (${docsChecked} checked).`
    : `Nothing could be checked for ${ctx.period.label} yet.`;
  return {
    recipe: 'itc_16_4', status, title, periods: months, financialYear: ctx.period.financialYear,
    summary: {
      headline,
      computed_label: 'Tax on documents claimed after the s.16(4) date',
      heads: hl.lines,
      lines: [line('ITC on documents claimed after the time limit', barred), line('To reverse or pay', toPay, 'result')],
      notice_total: fig.total, notice_basis: fig.basis,
      computed_total: hl.computedTotal, to_pay_total: hl.toPayTotal, explained_total: hl.explainedTotal,
      notes: [
        'Assumption: the credit for a document is claimed in the GSTR-3B of the month whose GSTR-2B (GSTR-2A before January 2022) shows it, on the day that return was filed.',
        'Last date: 30 November after the document’s financial year (FY 2017-18 to 2020-21: 30 November 2021 under s.16(5)), or the day that year’s GSTR-9 was filed if earlier.',
        ...(withheld ? [`${withheld} document(s) GSTR-2B already shows as not available for this reason are left out.`] : []),
        ...([...g9Used.values()].some((d) => !d) ? ['GSTR-9 filing dates not on record for some years: 30 November is used.'] : []),
      ],
      missing,
    },
    tables: [{
      key: 'itc_16_4_docs',
      title: 'Documents claimed after the s.16(4) date',
      columns: [
        { key: 'ctin', label: 'Supplier GSTIN', kind: 'text' }, { key: 'name', label: 'Supplier', kind: 'text' },
        { key: 'doc', label: 'Document', kind: 'text' }, { key: 'date', label: 'Dated', kind: 'text' },
        { key: 'fy', label: 'Its FY', kind: 'text' }, { key: 'last', label: 'Last date for ITC', kind: 'text' },
        { key: 'month', label: 'Claimed in (2B month)', kind: 'text' }, { key: 'filed', label: 'GSTR-3B filed on', kind: 'text' },
        ...headColumns('t', 'ITC', heads),
      ],
      rows,
    }],
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: hl.explainedTotal, toPay: hl.toPayTotal,
    inputs: {
      v: RECIPE_VERSION, periods: months, notice: [fig.perHead, fig.total, fig.basis],
      filed: inputsOf(l, ['GSTR3B', 'GSTR2B', 'GSTR2A'], months),
      gstr9: [...g9Used.entries()],
    },
  };
}
