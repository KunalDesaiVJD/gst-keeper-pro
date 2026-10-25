// The quarter grid of one client's refunds (the firm's choice of 25 October
// 2026, option A): a row per financial year, a column per quarter, a lane per
// type of refund. Each cell is the refund claimed for that quarter, coloured by
// where it stands, with what was sanctioned and rejected; a quarter missing
// between the first and the latest refund of a lane reads "not filed". A refund
// sits in the quarter its period starts in (the application's own period, else
// the one the AI read, else, marked, the month it was filed).
import React, { useMemo } from 'react';
import { WS_TABLE, WS_TABLE_WRAP, WS_TH } from '@/components/workspace/theme';
import { fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { RefundRow } from './ledgerData';
import { MoneyBar } from './RefundBits';
import {
  QUARTERS, TONE_CELL, TONE_TEXT, TONE_LABEL, fyLabel, moneyOf, placeOf, quarterSpan, sumMoney, toneOf, typeCode, typeLong, typeShort,
} from './refundModel';

const idx = (fy: number, q: number) => fy * 4 + q;

const RefundBlock: React.FC<{ r: RefundRow; compact: boolean; onOpen: (r: RefundRow) => void }> = ({ r, compact, onOpen }) => {
  const tone = toneOf(r);
  const m = moneyOf(r);
  const place = placeOf(r);
  const span = r.period ? quarterSpan(r.period.from, r.period.to) : 1;
  return (
    <button type="button" onClick={() => onOpen(r)} title={`${r.fact.arn ?? ''} · ${r.fact.status ?? ''}`}
      className={cn('flex w-full min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110', TONE_CELL[tone])}>
      <span className="flex items-baseline justify-between gap-1.5">
        <span className="text-[13px] font-semibold tabular-nums">{r.claimed !== null ? fmtInrShort(r.claimed) : '—'}</span>
        <span className={cn('truncate text-[10.5px] font-semibold', TONE_TEXT[tone])}>{TONE_LABEL[tone]}</span>
      </span>
      {!compact && tone !== 'withdrawn' && <MoneyBar m={m} className="h-1" />}
      {!compact && (
        <span className="truncate text-[11px] tabular-nums text-muted-foreground">
          {tone === 'action' || tone === 'open' ? (r.state.next ?? 'with the officer')
            : r.sanctioned ? `${fmtInrShort(r.sanctioned)} sanctioned${r.rejected ? ` · ${fmtInrShort(r.rejected)} rejected` : ''}`
            : tone === 'withdrawn' ? 'withdrawn' : 'amounts not read yet'}
        </span>
      )}
      {span > 1 && <span className="text-[10.5px] text-muted-foreground">covers {span} quarters</span>}
      {place?.byFiling && <span className="text-[10.5px] italic text-muted-foreground">period not captured; placed by filing date</span>}
    </button>
  );
};

export const RefundGrid: React.FC<{ rows: RefundRow[]; onOpen: (r: RefundRow) => void }> = ({ rows, onOpen }) => {
  const model = useMemo(() => {
    const placed = rows.map((r) => ({ r, p: placeOf(r) })).filter((x): x is { r: RefundRow; p: NonNullable<ReturnType<typeof placeOf>> } => !!x.p);
    const lanes = [...new Set(placed.map((x) => typeCode(x.r)))]
      .map((code) => ({ code, claimed: sumMoney(placed.filter((x) => typeCode(x.r) === code).map((x) => x.r)).claimed }))
      .sort((a, b) => b.claimed - a.claimed).map((l) => l.code);
    const span = new Map<string, { lo: number; hi: number }>();
    const cells = new Map<string, RefundRow[]>();
    placed.forEach(({ r, p }) => {
      const code = typeCode(r);
      const i = idx(p.fy, p.q);
      const s = span.get(code);
      span.set(code, { lo: Math.min(s?.lo ?? i, i), hi: Math.max(s?.hi ?? i, i) });
      const k = `${p.fy}|${p.q}|${code}`;
      cells.set(k, [...(cells.get(k) ?? []), r]);
    });
    // A refund covering several quarters fills the ones after its first too (not "not filed").
    const covered = new Set<string>();
    placed.forEach(({ r, p }) => {
      const n = r.period ? quarterSpan(r.period.from, r.period.to) : 1;
      for (let j = 1; j < n; j += 1) {
        const i = idx(p.fy, p.q) + j;
        covered.add(`${Math.floor((i - 1) / 4)}|${((i - 1) % 4) + 1}|${typeCode(r)}`);
      }
    });
    const fys = [...new Set(placed.map((x) => x.p.fy))].sort((a, b) => b - a);
    return { lanes, span, cells, covered, fys, placed };
  }, [rows]);

  if (!model.placed.length) return <p className="py-6 text-center text-sm text-muted-foreground">No refund to place on the grid.</p>;

  return (
    <div className={WS_TABLE_WRAP}>
      <table className={cn(WS_TABLE, 'min-w-[56rem] table-fixed')}>
        <colgroup>
          <col className="w-[7.5rem]" /><col className="w-[8.5rem]" />
          {QUARTERS.map((q) => <col key={q.q} />)}
          <col className="w-[8.5rem]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>Financial year</th>
            <th scope="col" className={WS_TH}>Type</th>
            {QUARTERS.map((q) => <th key={q.q} scope="col" className={WS_TH}>{q.label} <span className="font-normal text-muted-foreground">· {q.months}</span></th>)}
            <th scope="col" className={cn(WS_TH, 'text-right')}>Year total</th>
          </tr>
        </thead>
        <tbody>
          {model.fys.map((fy) => {
            const yearRows = model.placed.filter((x) => x.p.fy === fy).map((x) => x.r);
            const ym = sumMoney(yearRows);
            const kept = ym.claimed - ym.withdrawn;
            return model.lanes.map((code, li) => {
              const s = model.span.get(code);
              return (
                <tr key={`${fy}-${code}`} className={cn(li === model.lanes.length - 1 ? '[&>td]:border-b [&>th]:border-b' : '[&>td]:border-b-0')}>
                  {li === 0 && (
                    <th scope="rowgroup" rowSpan={model.lanes.length} className="border-b border-r bg-card px-2 py-2 text-left align-middle text-sm font-semibold">
                      {fyLabel(fy)}
                    </th>
                  )}
                  <td className="border-r px-2 py-1.5 align-middle text-xs text-muted-foreground" title={typeLong(code)}>{typeShort(code)}</td>
                  {QUARTERS.map(({ q }) => {
                    const list = (model.cells.get(`${fy}|${q}|${code}`) ?? [])
                      .sort((a, b) => Number(toneOf(a) === 'withdrawn') - Number(toneOf(b) === 'withdrawn'));
                    const i = idx(fy, q);
                    const inRange = !!s && i >= s.lo && i <= s.hi;
                    return (
                      <td key={q} className="border-r px-1.5 py-1.5 align-top">
                        {list.length ? (
                          <div className="flex flex-col gap-1">
                            {list.map((r) => <RefundBlock key={r.key} r={r} compact={list.length > 2 || toneOf(r) === 'withdrawn'} onOpen={onOpen} />)}
                          </div>
                        ) : model.covered.has(`${fy}|${q}|${code}`) ? (
                          <div className="flex h-full min-h-[3.25rem] items-center justify-center rounded-md border border-dashed border-border/70 text-[11px] text-muted-foreground">in the claim before</div>
                        ) : inRange ? (
                          <div className="flex h-full min-h-[3.25rem] items-center justify-center rounded-md border border-dashed border-warning/60 text-[11px] font-medium text-amber-700 dark:text-amber-400">not filed</div>
                        ) : <div className="min-h-[3.25rem]" />}
                      </td>
                    );
                  })}
                  {li === 0 && (
                    <td rowSpan={model.lanes.length} className="border-b px-2 py-2 text-right align-middle">
                      <div className="text-sm font-semibold tabular-nums">{fmtInrShort(kept)}</div>
                      <div className="text-[11px] tabular-nums text-success-strong">{fmtInrShort(ym.sanctioned)} sanctioned</div>
                      {ym.rejected > 0 && <div className="text-[11px] tabular-nums text-destructive-strong">{fmtInrShort(ym.rejected)} rejected</div>}
                      {ym.awaiting > 0 && <div className="text-[11px] tabular-nums text-info">{fmtInrShort(ym.awaiting)} awaiting</div>}
                    </td>
                  )}
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RefundGrid;
