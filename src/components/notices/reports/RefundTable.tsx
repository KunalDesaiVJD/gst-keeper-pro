// The refund list (the firm's request of 25 October 2026, after audit U-75-1..3,
// U-76-3): one line per refund that reads at a glance (its type and period,
// the steps it has passed as dots, where its claim stands as a bar, the next
// step with its date, the cases linked to it and how many documents it holds)
// and opens the refund's side panel, where everything else is. A table from lg
// up, cards below.
import React from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { dueWords, fmtDate, fmtInr, fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { SortHead } from './ReportBits';
import { daysTo } from './ledgerStatus';
import type { RefundRow } from './ledgerData';
import { LinkChips, MoneyBar, StepDots } from './RefundBits';
import { moneyOf, refundPeriod, refundSteps, typeCode, typeLong, typeShort, type Money } from './refundModel';

export type RefundSort = 'due' | 'filed' | 'client' | 'claimed' | 'sanctioned';

export interface RefundTableProps {
  rows: RefundRow[];
  today: string;
  showClient: boolean;
  sort: RefundSort;
  dir: 'asc' | 'desc';
  onSort: (k: RefundSort) => void;
  totals: Money;
  onOpen: (r: RefundRow) => void;
  onOpenArn: (arn: string) => void;
}

const Missing: React.FC<{ r: RefundRow }> = ({ r }) => {
  if (r.state.noDetails && r.fact.origin === 'case') return <span className="text-[11px] text-muted-foreground">application not fetched</span>;
  return r.hasFolder || !r.fact.arn ? null : <span className="text-[11px] text-muted-foreground">folder not fetched</span>;
};

const NextStep: React.FC<{ r: RefundRow; today: string }> = ({ r, today }) => {
  const s = r.state;
  if (!s.next) return <span className="text-xs text-muted-foreground">{s.open ? '—' : 'Nothing to do'}</span>;
  const d = daysTo(s.due, today);
  const late = d !== null && d < 0;
  return (
    <span className="block text-xs leading-tight">
      <span className={cn('block font-medium', s.group === 'action' && 'text-destructive-strong')}>{s.next}</span>
      {s.due && (
        <span className={cn('mt-0.5 inline-block rounded px-1 tabular-nums', late ? 'bg-destructive/10 font-semibold text-destructive-strong' : 'bg-muted text-foreground/80')}>
          by {fmtDate(s.due)} · {dueWords(d).replace('due ', '')}
        </span>
      )}
    </span>
  );
};

const Refund: React.FC<{ r: RefundRow }> = ({ r }) => {
  const code = typeCode(r);
  const period = refundPeriod(r);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-mono text-[13px] font-semibold text-primary">{r.fact.arn ?? 'ARN not captured'}</span>
        <Missing r={r} />
      </div>
      <div className="truncate text-xs" title={typeLong(code)}>
        <span className="font-medium">{typeShort(code)}</span>
        {period && <span className="text-muted-foreground"> · {period}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">filed {fmtDate(r.fact.filed_date)}{r.fact.origin === 'case' ? ' · portal case only' : ''}</div>
    </div>
  );
};

const Amounts: React.FC<{ r: RefundRow }> = ({ r }) => {
  const m = moneyOf(r);
  return (
    <div className="min-w-[9rem] text-right">
      <div className="text-sm font-semibold tabular-nums">{r.claimed === null ? <span className="text-muted-foreground">—</span> : fmtInr(r.claimed)}</div>
      <MoneyBar m={m} className="my-1" />
      <div className="text-[11px] tabular-nums">
        {r.sanctioned ? <span className="text-success-strong">{fmtInrShort(r.sanctioned)} sanctioned</span> : null}
        {r.sanctioned && r.rejected ? <span className="text-muted-foreground"> · </span> : null}
        {r.rejected ? <span className="text-destructive-strong">{fmtInrShort(r.rejected)} rejected</span> : null}
        {!r.sanctioned && !r.rejected && <span className="text-muted-foreground">{m.awaiting ? 'awaiting order' : m.withdrawn ? 'withdrawn' : 'outcome not read'}</span>}
      </div>
    </div>
  );
};

const Docs: React.FC<{ r: RefundRow }> = ({ r }) => (
  r.docs.length ? (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-foreground/80">
      <FileText className="h-3.5 w-3.5" aria-hidden />{r.docs.length}
    </span>
  ) : <span className="text-xs text-muted-foreground">—</span>
);

export const RefundTable: React.FC<RefundTableProps> = ({ rows, today, showClient, sort, dir, onSort, totals, onOpen, onOpenArn }) => (
  <>
    {/* Phones and tablets: cards. */}
    <ul className="space-y-2 lg:hidden">
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" onClick={() => onOpen(r)}
            className={cn('block w-full rounded-lg border bg-card p-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', r.state.group === 'action' && 'border-l-4 border-l-destructive')}>
            {showClient && <div className="truncate text-sm font-semibold">{r.fact.client_name}</div>}
            <div className="flex items-start justify-between gap-2">
              <Refund r={r} />
              <Badge variant={r.state.tone} className="shrink-0 whitespace-normal rounded-md text-left text-[11px] font-medium">{r.state.label}</Badge>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <StepDots steps={refundSteps(r)} />
              <Amounts r={r} />
            </div>
            <div className="mt-2"><NextStep r={r} today={today} /></div>
            {(r.links.length > 0 || r.docs.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><LinkChips r={r} onOpenRefund={onOpenArn} /><Docs r={r} /></div>
            )}
          </button>
        </li>
      ))}
    </ul>

    <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
      <table className={WS_TABLE}>
        <thead>
          <tr>
            {showClient && <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} />}
            <SortHead label="Refund" k="filed" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className={WS_TH}>Status</th>
            <th scope="col" className={WS_TH}>Steps</th>
            <SortHead label="Claimed / outcome" k="claimed" sort={sort} dir={dir} onSort={onSort} right />
            <SortHead label="Next step" k="due" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className={WS_TH}>Linked</th>
            <th scope="col" className={WS_TH}><span className="sr-only">Documents</span><FileText className="h-3.5 w-3.5" aria-hidden /></th>
            <th scope="col" className={cn(WS_TH, 'w-6')}><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }} tabIndex={0}
              aria-label={`Open refund ${r.fact.arn ?? ''}`}
              className={cn(WS_TR, 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', r.state.group === 'action' && 'bg-destructive/[0.03]')}>
              {showClient && (
                <td className={cn(WS_TD, 'max-w-[12rem]')}>
                  <div className="truncate font-medium">{r.fact.client_name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.fact.client_gstin}</div>
                </td>
              )}
              <td className={cn(WS_TD, 'min-w-[13rem] max-w-[16rem]', r.state.group === 'action' && 'border-l-2 border-l-destructive')}><Refund r={r} /></td>
              <td className={cn(WS_TD, 'max-w-[11rem]')}>
                <Badge variant={r.state.tone} className="whitespace-normal rounded-md text-left text-[11px] font-medium">{r.state.label}</Badge>
              </td>
              <td className={cn(WS_TD, 'min-w-[8rem]')}><StepDots steps={refundSteps(r)} /></td>
              <td className={WS_TD}><Amounts r={r} /></td>
              <td className={cn(WS_TD, 'min-w-[12rem] max-w-[16rem]')}><NextStep r={r} today={today} /></td>
              <td className={cn(WS_TD, 'max-w-[11rem]')}><LinkChips r={r} onOpenRefund={onOpenArn} max={2} /></td>
              <td className={WS_TD}><Docs r={r} /></td>
              <td className={cn(WS_TD, 'px-1')}><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={WS_TR_TOTAL}>
            <th scope="row" className={cn(WS_TD, 'text-left')} colSpan={showClient ? 4 : 3}>Total</th>
            <td className={WS_TD_NUM}>
              <div>{fmtInr(totals.claimed)}</div>
              <div className="text-[11px] font-normal">
                <span className="text-success-strong">{fmtInrShort(totals.sanctioned)} sanctioned</span> · <span className="text-destructive-strong">{fmtInrShort(totals.rejected)} rejected</span>
              </div>
            </td>
            <td className={WS_TD} colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  </>
);

export default RefundTable;
