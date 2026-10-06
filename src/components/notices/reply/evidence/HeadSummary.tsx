// The result per tax head — what the notice says, what the portal returns
// show, the difference, how much of the notice is explained and what is left
// to pay — and the reconciliation lines behind it. Heads are never netted.
import React from 'react';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { fmtAmount } from './look';
import type { AnnexureSummary, Head } from '@/lib/reply';
import { HEAD_LABEL } from '@/lib/reply';
import { cn } from '@/lib/utils';

const m = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmtAmount(v));

export const HeadSummary: React.FC<{ summary: AnnexureSummary }> = ({ summary: s }) => {
  if (!s.heads.length) return null;
  const heads = s.heads.map((h) => h.head);
  const lineHeads: Head[] = heads;
  return (
    <div className="space-y-3">
      <div className="min-w-0 space-y-1">
        <h4 className="text-sm font-semibold">By head</h4>
        <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="By head">
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th scope="col" className={WS_TH}>Head</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>Per the notice</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>Computed</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>Difference</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>Explained</th>
                <th scope="col" className={cn(WS_TH, 'text-right')}>To pay</th>
              </tr>
            </thead>
            <tbody>
              {s.heads.map((h) => (
                <tr key={h.head} className={WS_TR}>
                  <th scope="row" className={cn(WS_TD, 'text-left font-medium')}>{HEAD_LABEL[h.head]}</th>
                  <td className={WS_TD_NUM}>{m(h.notice)}</td>
                  <td className={WS_TD_NUM}>{m(h.computed)}</td>
                  <td className={WS_TD_NUM}>{m(h.difference)}</td>
                  <td className={WS_TD_NUM}>{m(h.explained)}</td>
                  <td className={cn(WS_TD_NUM, h.to_pay > 0 && 'font-semibold text-destructive-strong')}>{m(h.to_pay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={WS_TR_TOTAL}>
                <th scope="row" className={cn(WS_TD, 'text-left')}>Total</th>
                <td className={WS_TD_NUM}>{m(s.notice_total)}</td>
                <td className={WS_TD_NUM}>{m(s.computed_total)}</td>
                <td className={WS_TD_NUM}>{s.notice_total === null ? '—' : m(s.notice_total - s.computed_total)}</td>
                <td className={WS_TD_NUM}>{m(s.explained_total)}</td>
                <td className={WS_TD_NUM}>{m(s.to_pay_total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Computed: {s.computed_label}.{s.notice_basis ? ` Per the notice: ${s.notice_basis}.` : ' The notice states no figure for this.'}
        </p>
      </div>
      {s.lines.length > 0 && (
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold">How it reconciles</h4>
          <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="How it reconciles">
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={WS_TH}>Line</th>
                  {lineHeads.map((h) => <th key={h} scope="col" className={cn(WS_TH, 'text-right')}>{HEAD_LABEL[h]}</th>)}
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.label} className={l.kind === 'result' ? WS_TR_TOTAL : WS_TR}>
                    <th scope="row" className={cn(WS_TD, 'min-w-[14rem] text-left text-xs font-normal', l.kind === 'result' && 'font-semibold', l.kind === 'info' && 'text-muted-foreground')}>{l.label}</th>
                    {lineHeads.map((h) => <td key={h} className={cn(WS_TD_NUM, l.kind === 'info' && 'text-muted-foreground')}>{m(l.values[h] ?? 0)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default HeadSummary;
