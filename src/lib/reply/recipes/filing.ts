// Return filing status (GSTR-3A, issue RETURN_NOT_FILED): for each month of
// the period, whether GSTR-3B and GSTR-1 are filed on the portal (the
// extension's pull), with the filing date and ARN, the due date and the days
// late — and the GSTR-9 when the period is a whole financial year. The
// firm's own Filing Status tracker fills in a month the portal pull has not
// reached, and says so.
import type { AnnexureRow, FiledType, PortalData, RecipeContext, RecipeResult, SourceRef } from '../types';
import { dueDayForReturn } from '@/utils/interestLateFee';
import { daysBetween, dateLabel, dueDateIso, fyMarch, fyMonths, fysOf, periodLabel, PERIOD_SOURCE_WORDS } from '../periods';
import { isNotFiledStatus } from '../portal';
import { cellState, emptySummary, fetchPlan, FILED_LABEL, fyCellSource, inputsOf, lookup, monthSource, RECIPE_VERSION, refOf, statusOf } from './common';
import { filingRow } from './interest';
import { gstr9FiledOn } from './itc164';
import { needsPeriod } from './documentsOnly';

export function filingStatus(ctx: RecipeContext, data: PortalData): RecipeResult {
  const title = 'Return filing status';
  if (!ctx.period.periods.length) return needsPeriod(ctx, title);
  const l = lookup(data);
  const months = ctx.period.periods;
  const rows: AnnexureRow[] = [];
  let known = 0, total = 0, notFiled = 0, filed = 0;
  const pending: string[] = [];
  for (const p of months) {
    for (const type of ['GSTR3B', 'GSTR1'] as FiledType[]) {
      const names = type === 'GSTR3B' ? ['GSTR-3B', 'GSTR-3B (Q)'] : ['GSTR-1', 'GSTR-1 (IFF)'];
      const fs = filingRow(data, names, p);
      const due = dueDateIso(p, fs?.targetDate ?? dueDayForReturn(names[0], ctx.client.dueDay1, ctx.client.dueDay2));
      const s = cellState(l, type, p, ctx);
      if (s.state === 'not_due') continue;
      total += 1;
      const row = l.filed(type, p);
      const trackerRef: SourceRef[] = fs ? [{ table: 'filing_status', period: p, label: 'Filing Status (tracker)', arn: fs.arn, pulled_at: fs.updatedAt, row_id: fs.id }] : [];
      let status: string, filedOn: string | null = null, arn: string | null = null, refs: SourceRef[] = refOf(row), days: number | null = null;
      if (s.state === 'ready') {
        filedOn = row?.filedDate ?? null; arn = row?.arn ?? null; status = 'Filed'; known += 1; filed += 1;
        if (filedOn) days = Math.max(0, daysBetween(due, filedOn));
      } else if (s.state === 'not_filed') {
        status = 'Not filed (portal)'; known += 1; notFiled += 1;
        days = Math.max(0, daysBetween(due, ctx.today));
        pending.push(`${FILED_LABEL[type]} ${periodLabel(p)}`);
      } else if (fs?.status === 'Filed') {
        status = 'Filed (Filing Status tracker; not fetched from the portal)'; filedOn = fs.filedDate; arn = fs.arn; refs = trackerRef; filed += 1;
        if (filedOn) days = Math.max(0, daysBetween(due, filedOn));
      } else {
        status = s.state === 'failed' ? 'Portal pull failed' : 'Not fetched';
        refs = [...refs, ...trackerRef];
      }
      rows.push({
        kind: s.state === 'ready' || s.state === 'not_filed' ? 'data' : 'missing',
        cells: { ret: FILED_LABEL[type], month: periodLabel(p), status, filed: dateLabel(filedOn), arn: arn ?? '—', due: dateLabel(due), days },
        _source: refs,
      });
    }
  }
  // A whole financial year: the annual return too.
  const fullFys = fysOf(months).filter((fy) => fyMonths(fy).every((p) => months.includes(p)));
  for (const fy of fullFys) {
    const g9 = gstr9FiledOn(data, fy);
    const row = data.gstr9.find((r) => r.period === fyMarch(fy));
    total += 1;
    if (g9) { known += 1; filed += 1; }
    else if (row && isNotFiledStatus(row.status)) { known += 1; notFiled += 1; pending.push(`GSTR-9 FY ${fy}`); }
    rows.push({
      kind: g9 || (row && isNotFiledStatus(row.status)) ? 'data' : 'missing',
      cells: { ret: 'GSTR-9', month: `FY ${fy}`, status: g9 ? 'Filed' : row && isNotFiledStatus(row.status) ? 'Not filed (portal)' : 'Not fetched', filed: dateLabel(g9?.date ?? null), arn: g9?.ref.arn ?? '—', due: '—', days: null },
      _source: g9 ? [g9.ref] : row ? refOf(row) : [],
    });
  }
  const sources = [monthSource(l, ctx, { key: 'GSTR3B', months }), monthSource(l, ctx, { key: 'GSTR1', months })];
  if (fullFys.length) {
    sources.push(fyCellSource('GSTR9', fullFys.map((fy) => {
      const row = data.gstr9.find((r) => r.period === fyMarch(fy));
      const st = gstr9FiledOn(data, fy) ? 'ready' : row && isNotFiledStatus(row.status) ? 'not_filed' : 'not_fetched';
      return { period: fyMarch(fy), state: st, status: row?.status ?? null, pulled_at: row?.updatedAt ?? null, arn: row?.arn ?? null };
    })));
  }
  const status = statusOf(known, total, known < total);
  const headline = known
    ? notFiled
      ? `${notFiled} return(s) are not filed on the portal: ${pending.slice(0, 6).join(', ')}${pending.length > 6 ? ` and ${pending.length - 6} more` : ''}.`
      : `Every return of ${ctx.period.label} on record is filed (${filed} of ${total}).`
    : `The filing status for ${ctx.period.label} has not been fetched from the portal yet.`;
  return {
    recipe: 'filing_status', status, title, periods: months, financialYear: ctx.period.financialYear,
    summary: {
      ...emptySummary(headline, '—'),
      notes: [
        'Status as the portal shows it (pulled by the extension); a month the pull has not reached shows the firm’s Filing Status tracker instead, marked as such.',
        `Days overdue are counted to ${dateLabel(ctx.today)}, the day this was built.`,
      ],
      missing: rows.filter((r) => r.kind === 'missing').map((r) => `${r.cells.ret} ${r.cells.month}: ${r.cells.status}`),
    },
    tables: [{
      key: 'filing_status',
      title: 'Returns of the period',
      columns: [
        { key: 'ret', label: 'Return', kind: 'text' }, { key: 'month', label: 'Period', kind: 'text' },
        { key: 'status', label: 'Status', kind: 'text' }, { key: 'filed', label: 'Filed on', kind: 'text' },
        { key: 'arn', label: 'ARN', kind: 'text' }, { key: 'due', label: 'Due on', kind: 'text' },
        { key: 'days', label: 'Days late / overdue', kind: 'int' },
      ],
      rows,
    }],
    readiness: { period: ctx.period, sources, plan: fetchPlan(sources), notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
    explained: null, toPay: null,
    inputs: {
      v: RECIPE_VERSION, periods: months, due: [ctx.client.dueDay1, ctx.client.dueDay2],
      filed: inputsOf(l, ['GSTR3B', 'GSTR1'], months),
      gstr9: data.gstr9.map((r) => [r.id, r.updatedAt, r.status]),
      tracker: (data.filingStatus ?? []).filter((r) => months.includes(r.period) || r.returnType === 'GSTR-9').map((r) => [r.id, r.updatedAt, r.status]),
    },
  };
}
