// The refund ledger's rows (audit U-75-1..3, U-76-3): status in a tone that
// points the right way, the next step with its date and legal basis, our stage
// in its own column, amounts that read "—" when not captured, the ARN linked
// only when there is a case folder to open (else "folder not fetched"; the
// page fetches the missing ones), and the documents as named links. A table
// from lg up, cards below.
import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { StageBadge } from '@/components/notices/StageBadge';
import { dueWords, fmtDate, fmtInr, fmtInrShort, sentenceCase } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { SortHead } from './ReportBits';
import { daysTo } from './ledgerStatus';
import type { RefundRow } from './ledgerData';

export type RefundSort = 'due' | 'filed' | 'client' | 'claimed' | 'sanctioned';

export interface RefundTableProps {
  rows: RefundRow[];
  today: string;
  showClient: boolean;
  sort: RefundSort;
  dir: 'asc' | 'desc';
  onSort: (k: RefundSort) => void;
  totals: { claimed: number; sanctioned: number };
}

const Arn: React.FC<{ r: RefundRow }> = ({ r }) => {
  const arn = r.fact.arn;
  if (!arn) return <span className="text-muted-foreground">ARN not captured</span>;
  return r.hasFolder ? (
    <Link to={`/notices-case-folder/${r.fact.client_id}/${encodeURIComponent(arn)}`}
      className="font-mono font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
      <span className="sr-only">Case folder </span>{arn}
    </Link>
  ) : <span className="font-mono font-medium">{arn}</span>;
};

/** Said in place of a link when there is no folder (or no application) to open yet; the page fetches them in one go. */
const Missing: React.FC<{ r: RefundRow }> = ({ r }) => {
  if (r.state.noDetails && r.fact.origin === 'case') return <span className="text-[11px] text-muted-foreground">application not fetched</span>;
  return r.hasFolder || !r.fact.arn ? null : <span className="text-[11px] text-muted-foreground">folder not fetched</span>;
};

const NextStep: React.FC<{ r: RefundRow; today: string }> = ({ r, today }) => {
  const s = r.state;
  if (!s.next) return <span className="text-xs text-muted-foreground">{s.open ? '—' : 'nothing to do'}</span>;
  const d = daysTo(s.due, today);
  const urgent = s.group === 'action' && d !== null && d <= 3;
  return (
    <span className="block text-xs leading-tight">
      <span className={cn('block font-medium', s.group === 'action' && 'text-destructive-strong')}>{s.next}</span>
      {s.due ? (
        <span className={cn('block tabular-nums', urgent ? 'font-semibold text-destructive-strong' : 'text-foreground')}>
          by {fmtDate(s.due)} · {dueWords(d).replace('due ', '')}
        </span>
      ) : null}
      {s.basis && <span className="block text-muted-foreground">{s.basis}</span>}
    </span>
  );
};

const Docs: React.FC<{ r: RefundRow }> = ({ r }) =>
  r.docs.length === 0 ? <span className="text-xs text-muted-foreground">none captured</span> : (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {r.docs.map((d, i) => (
        <a key={`${d.url}-${i}`} href={d.url} target="_blank" rel="noreferrer"
          className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
          {d.label}<span className="sr-only"> for {r.fact.arn ?? 'this refund'} (PDF, opens in a new tab)</span>
        </a>
      ))}
    </span>
  );

const Stage: React.FC<{ r: RefundRow }> = ({ r }) =>
  r.caseLink ? (
    <Link to={`/notices/${r.caseLink.id}`} className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="sr-only">Open the case, stage </span>
      <StageBadge stage={r.caseLink.stage} since={r.caseLink.stage_changed_at} by={r.caseLink.stage_changed_by} />
    </Link>
  ) : <span className="text-xs text-muted-foreground">—</span>;

const money = (v: number | null | undefined) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : fmtInr(v));

export const RefundTable: React.FC<RefundTableProps> = ({ rows, today, showClient, sort, dir, onSort, totals }) => (
  <>
    {/* Phones and tablets: cards. */}
    <ul className="space-y-2 lg:hidden">
      {rows.map((r) => (
        <li key={r.key} className={cn('rounded-lg border bg-card p-3', r.state.group === 'action' && 'border-destructive/50')}>
          {showClient && (
            <Link to={`/notices-company/${r.fact.client_id}`} className="block truncate text-sm font-semibold hover:underline">{r.fact.client_name}</Link>
          )}
          <div className="flex flex-wrap items-center gap-x-2 text-sm"><Arn r={r} /><Missing r={r} /></div>
          <Badge variant={r.state.tone} className="mt-1 whitespace-normal rounded-md text-left text-[11px] font-medium">{r.state.label}</Badge>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {r.fact.refund_type ? sentenceCase(r.fact.refund_type) : 'Type not captured'} · filed {fmtDate(r.fact.filed_date)}
          </div>
          <div className="mt-2"><NextStep r={r} today={today} /></div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div><dt className="text-muted-foreground">Claimed</dt><dd className="tabular-nums">{money(r.fact.claimed_amount)}</dd></div>
            <div>
              <dt className="text-muted-foreground">Sanctioned</dt>
              <dd className="tabular-nums">{money(r.fact.sanctioned_amount)}</dd>
            </div>
            <div><dt className="text-muted-foreground">Our stage</dt><dd><Stage r={r} /></dd></div>
            <div><dt className="text-muted-foreground">Documents</dt><dd><Docs r={r} /></dd></div>
          </dl>
        </li>
      ))}
    </ul>

    <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
      <table className={WS_TABLE}>
        <thead>
          <tr>
            {showClient && <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} />}
            <SortHead label="Refund · filed" k="filed" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className={WS_TH}>Portal status</th>
            <SortHead label="Next step" k="due" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className={WS_TH}>Our stage</th>
            <SortHead label="Claimed" k="claimed" sort={sort} dir={dir} onSort={onSort} right />
            <SortHead label="Sanctioned" k="sanctioned" sort={sort} dir={dir} onSort={onSort} right />
            <th scope="col" className={WS_TH}>Documents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn(WS_TR, r.state.group === 'action' && 'bg-destructive/[0.03]')}>
              {showClient && (
                <td className={cn(WS_TD, 'max-w-[13rem]')}>
                  <Link to={`/notices-company/${r.fact.client_id}`} className="block truncate font-medium hover:underline">{r.fact.client_name}</Link>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.fact.client_gstin}</div>
                </td>
              )}
              <td className={cn(WS_TD, 'min-w-[15rem]')}>
                <div className="flex flex-wrap items-center gap-x-2"><Arn r={r} /><Missing r={r} /></div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {r.fact.refund_type ? sentenceCase(r.fact.refund_type) : 'Type not captured'} · filed {fmtDate(r.fact.filed_date)}
                  {r.fact.origin === 'case' ? ' · portal case, no application record' : ''}
                </div>
              </td>
              <td className={cn(WS_TD, 'max-w-[13rem]')}>
                <Badge variant={r.state.tone} className="whitespace-normal rounded-md text-left text-[11px] font-medium">{r.state.label}</Badge>
                {r.state.rejectedAmount ? <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtInrShort(r.state.rejectedAmount)} not sanctioned</div> : null}
              </td>
              <td className={cn(WS_TD, 'min-w-[12rem]')}><NextStep r={r} today={today} /></td>
              <td className={WS_TD}><Stage r={r} /></td>
              <td className={WS_TD_NUM}>{money(r.fact.claimed_amount)}</td>
              <td className={WS_TD_NUM}>{money(r.fact.sanctioned_amount)}</td>
              <td className={cn(WS_TD, 'max-w-[10rem]')}><Docs r={r} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={WS_TR_TOTAL}>
            <th scope="row" className={cn(WS_TD, 'text-left')} colSpan={showClient ? 5 : 4}>Total of the amounts captured</th>
            <td className={WS_TD_NUM}>{fmtInr(totals.claimed)}</td>
            <td className={WS_TD_NUM}>{fmtInr(totals.sanctioned)}</td>
            <td className={WS_TD} />
          </tr>
        </tfoot>
      </table>
    </div>
  </>
);

export default RefundTable;
