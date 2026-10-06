// The AI reader's readings (roadmap Phase 4; audit R-15): the last 100, or
// the readings behind a count (queued, reading now, done or failed today, an
// outcome) — each with its notice, what became of it and why, who asked, and
// what it cost. The filter lives in the URL (?reads=…).
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtWhen } from '@/lib/autopilot';
import { plural } from '@/lib/noticeFormat';
import {
  fmtUsdInr, readReasonLabel, readStateDef, readingFilterTitle, useListPage, useReadings, type ReadingRow,
} from '@/lib/replyFactory';
import { NoticeCell } from './parts';
import { cn } from '@/lib/utils';

const FILTERS: { value: string; label: string }[] = [
  { value: 'queued', label: 'Waiting in the queue' },
  { value: 'running', label: 'Reading now' },
  { value: 'done_today', label: 'Done today' },
  { value: 'failed_today', label: 'Failed today' },
  { value: 'st:failed', label: 'Every failed reading' },
  { value: 'st:cancelled', label: 'Every cancelled reading' },
];

const cost = (x: ReadingRow) => {
  const c = x.usage && x.usage.cost_usd !== undefined && x.usage.cost_usd !== null ? Number(x.usage.cost_usd) : null;
  return Number.isFinite(c) ? c : null;
};

const StateCell: React.FC<{ x: ReadingRow }> = ({ x }) => {
  const def = readStateDef(x.status, x.outcome);
  const why = readReasonLabel(x.reason_class);
  return (
    <div className="space-y-0.5">
      <ToneBadge tone={def.tone}>{def.label}</ToneBadge>
      {(x.status === 'failed' || x.status === 'cancelled') && why && <div className="text-xs font-medium">{why}</div>}
      {x.error && <div className="line-clamp-2 break-words text-[11px] text-muted-foreground" title={x.error}>{x.error}</div>}
    </div>
  );
};

const whenText = (x: ReadingRow) => (x.finished_at ? `finished ${fmtWhen(x.finished_at)}` : x.claimed_at ? `started ${fmtWhen(x.claimed_at)}` : `queued ${fmtWhen(x.created_at)}`);

export const AiReadingsCard: React.FC<{ rate: number }> = ({ rate }) => {
  const [sp, setSp] = useSearchParams();
  const reads = sp.get('reads') || 'ai';
  const q = useReadings(reads);
  const rows = q.data ?? [];
  const pager = useListPage('rp');
  const pageRows = pager.slice(rows);
  const setReads = (v: string) => {
    const next = new URLSearchParams(sp);
    if (v === 'all' || v === 'ai') next.delete('reads'); else next.set('reads', v);
    next.delete('rp');
    setSp(next);
  };
  const extra = FILTERS.some((f) => f.value === reads) || reads === 'ai' ? [] : [{ value: reads, label: readingFilterTitle(reads).replace(/^AI readings: /, '') }];

  return (
    <SectionCard title="Readings" description={`${readingFilterTitle(reads)}${q.data ? ` · ${plural(rows.length, 'reading')}` : ''}`}
      actions={<FilterPill label="Show" allLabel="The last 100" value={reads === 'ai' ? 'all' : reads} onChange={setReads} options={[]}
        extraOptions={[...FILTERS, ...extra]} />}>
      {q.error ? <LoadError what="the readings" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-32 w-full" />
        : rows.length === 0 ? <EmptyBox>{reads === 'ai' ? 'No notice has been read with AI yet.' : 'No reading matches.'}</EmptyBox>
        : (
          <>
            <ul className="space-y-1.5 md:hidden">
              {pageRows.map((x) => (
                <li key={x.id} className="space-y-1 rounded-md border bg-card p-2.5">
                  <div className="flex items-start justify-between gap-2"><NoticeCell n={x.notice} id={x.notice_id} /><StateCell x={x} /></div>
                  <div className="text-[11px] text-muted-foreground">
                    {whenText(x)}{x.requested_by_name ? ` · asked by ${x.requested_by_name}` : ' · automatic'}{x.pages ? ` · ${x.pages} pages` : ''}
                    {cost(x) !== null ? ` · ${fmtUsdInr(cost(x), rate)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden max-h-[32rem] md:block')} tabIndex={0} role="region" aria-label="Readings">
              <table className={WS_TABLE}>
                <caption className="sr-only">{readingFilterTitle(reads)}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={WS_TH}>When</th>
                    <th scope="col" className={WS_TH}>Notice</th>
                    <th scope="col" className={WS_TH}>What became of it</th>
                    <th scope="col" className={WS_TH}>Asked by</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Pages</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((x) => (
                    <tr key={x.id} className={WS_TR}>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{whenText(x)}</td>
                      <td className={cn(WS_TD, 'max-w-[16rem]')}><NoticeCell n={x.notice} id={x.notice_id} /></td>
                      <td className={cn(WS_TD, 'min-w-[11rem] max-w-[18rem]')}><StateCell x={x} /></td>
                      <td className={cn(WS_TD, 'text-xs')}>{x.requested_by_name ?? 'Automatic'}</td>
                      <td className={WS_TD_NUM}>{x.pages ?? '—'}</td>
                      <td className={cn(WS_TD_NUM, 'text-xs')}>{cost(x) === null ? '—' : fmtUsdInr(cost(x), rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
          </>
        )}
    </SectionCard>
  );
};

export default AiReadingsCard;
