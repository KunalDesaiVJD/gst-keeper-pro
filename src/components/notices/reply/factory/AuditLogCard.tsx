// The Claude API audit log (roadmap Phase 4; audit R-15: every call on
// record): when, which notice, the model, tokens, the estimated cost in USD
// and ₹, and whether the call was answered, refused or failed. The last 100
// calls, or every call today / this month (IST) — the spend line's numbers.
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { fmtWhen } from '@/lib/autopilot';
import { plural } from '@/lib/noticeFormat';
import { AUDIT_STATUS, fmtCount, fmtUsdInr, useAuditLog, useListPage, type AuditFilter, type AuditItem } from '@/lib/replyFactory';
import { NoticeCell } from './parts';
import { cn } from '@/lib/utils';

const TITLES: Record<AuditFilter, string> = { last: 'The last 100 calls', today: 'Every call today (India time)', month: 'Every call this month (India time)' };

const Status: React.FC<{ r: AuditItem }> = ({ r }) => {
  const st = AUDIT_STATUS[r.status] ?? { label: r.status, tone: 'secondary' as const };
  return (
    <div className="space-y-0.5">
      <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
      {r.error && <div className="line-clamp-2 break-words text-[11px] text-muted-foreground" title={r.error}>{r.error}</div>}
    </div>
  );
};

export const AuditLogCard: React.FC<{ rate: number }> = ({ rate }) => {
  const [sp, setSp] = useSearchParams();
  const filter = (['today', 'month'].includes(sp.get('audit') ?? '') ? sp.get('audit') : 'last') as AuditFilter;
  const q = useAuditLog(filter);
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const pager = useListPage('ap');
  const pageRows = pager.slice(rows);
  const setFilter = (v: string) => {
    const next = new URLSearchParams(sp);
    if (v === 'all') next.delete('audit'); else next.set('audit', v);
    next.delete('ap');
    setSp(next);
  };

  return (
    <SectionCard title="Audit log: calls to the Claude API"
      description={`${TITLES[filter]}${q.data ? ` · ${plural(rows.length, 'call')} · ${fmtUsdInr(total, rate, 2)}` : ''}. Written by the database as each reading finishes; nobody can edit it from the app.`}
      actions={<FilterPill label="Show" allLabel="The last 100" value={filter === 'last' ? 'all' : filter} onChange={setFilter} options={[]}
        extraOptions={[{ value: 'today', label: 'Today' }, { value: 'month', label: 'This month' }]} />}>
      {q.error ? <LoadError what="the audit log" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-32 w-full" />
        : rows.length === 0 ? <EmptyBox>{filter === 'last' ? 'No call to the Claude API yet. Nothing has been sent.' : 'No call in this period.'}</EmptyBox>
        : (
          <>
            <ul className="space-y-1.5 md:hidden">
              {pageRows.map((r) => (
                <li key={r.id} className="space-y-1 rounded-md border bg-card p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    {r.notice_id ? <NoticeCell n={r.notice} id={r.notice_id} /> : <span className="text-sm">{r.purpose}</span>}
                    <Status r={r} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmtWhen(r.at)} · {r.model ?? '—'} · {fmtCount(r.input_tokens)} in / {fmtCount(r.output_tokens)} out · {fmtUsdInr(r.cost_usd, rate)}
                  </div>
                </li>
              ))}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden max-h-[36rem] md:block')} tabIndex={0} role="region" aria-label="Audit log">
              <table className={WS_TABLE}>
                <caption className="sr-only">{TITLES[filter]}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={WS_TH}>When</th>
                    <th scope="col" className={WS_TH}>Notice</th>
                    <th scope="col" className={WS_TH}>Model</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Tokens in</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Tokens out</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Cost (USD · ₹)</th>
                    <th scope="col" className={WS_TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id} className={WS_TR}>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtWhen(r.at)}</td>
                      <td className={cn(WS_TD, 'max-w-[16rem]')}>{r.notice_id ? <NoticeCell n={r.notice} id={r.notice_id} /> : <span className="text-xs">{r.purpose}</span>}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap font-mono text-[11px]')}>{r.model ?? '—'}</td>
                      <td className={WS_TD_NUM}>{fmtCount(r.input_tokens)}</td>
                      <td className={WS_TD_NUM}>{fmtCount(r.output_tokens)}</td>
                      <td className={cn(WS_TD_NUM, 'text-xs')}>{fmtUsdInr(r.cost_usd, rate)}</td>
                      <td className={cn(WS_TD, 'min-w-[8rem] max-w-[16rem]')}><Status r={r} /></td>
                    </tr>
                  ))}
                  <tr className={WS_TR_TOTAL}>
                    <th scope="row" colSpan={3} className={cn(WS_TD, 'text-left text-xs')}>{plural(rows.length, 'call')}</th>
                    <td className={WS_TD_NUM}>{fmtCount(rows.reduce((s, r) => s + Number(r.input_tokens ?? 0), 0))}</td>
                    <td className={WS_TD_NUM}>{fmtCount(rows.reduce((s, r) => s + Number(r.output_tokens ?? 0), 0))}</td>
                    <td className={cn(WS_TD_NUM, 'text-xs')}>{fmtUsdInr(total, rate, 2)}</td>
                    <td className={WS_TD} />
                  </tr>
                </tbody>
              </table>
            </div>
            <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
          </>
        )}
    </SectionCard>
  );
};

export default AuditLogCard;
