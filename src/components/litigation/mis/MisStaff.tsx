// Litigation MIS · Per staff (audit U-105-1..3): workload and risk per person —
// open matters, overdue, due within 7 days, hearings within 14 days, matters
// waiting on them as reviewer, matters with no next action and the longest
// untouched — riskiest first, keyed by user id (U-105-2), each name opening the
// Matters list filtered to that owner (U-105-3). Cards on phones.
import React from 'react';
import { Link } from 'react-router-dom';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { initials, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { ROLE_LABEL, type MisLinks, type MisReport, type StaffRow } from './misData';
import { Amount, CountLink, EmptyBox } from './ui';

const Person: React.FC<{ s: StaffRow; links: MisLinks }> = ({ s, links }) => (
  <span className="flex min-w-0 items-center gap-2">
    <span aria-hidden className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
      s.userId ? 'bg-primary text-primary-foreground' : 'border border-dashed border-muted-foreground/60 text-muted-foreground')}>
      {s.userId ? initials(s.name) : '?'}
    </span>
    <span className="min-w-0">
      <Link to={links.matters({ owner: s.key })} className="block truncate font-medium hover:underline">{s.name}</Link>
      {s.role && <Badge variant="secondary" className="text-[10px] font-normal">{ROLE_LABEL[s.role] ?? s.role}</Badge>}
    </span>
  </span>
);

const Stalest: React.FC<{ s: StaffRow }> = ({ s }) =>
  s.stalest ? (
    <span className="block text-xs leading-tight">
      <span className={cn('font-semibold tabular-nums', s.stalest.idleDays >= 30 && 'text-destructive-strong')}>{plural(s.stalest.idleDays, 'day')}</span>
      <Link to={`/litigation/${s.stalest.id}`} className="block max-w-[11rem] truncate font-mono text-[11px] text-muted-foreground hover:underline">{s.stalest.matterNo}</Link>
    </span>
  ) : <span className="text-xs text-muted-foreground">—</span>;

export const MisStaff: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const rows = r.byStaff;
  const t = rows.reduce((a, s) => ({
    open: a.open + s.rows.length, overdue: a.overdue + s.overdue, due7: a.due7 + s.due7, hearings: a.hearings + s.hearings14,
    reviews: a.reviews + s.reviews.length, noAction: a.noAction + s.noAction, outstanding: a.outstanding + s.money.outstanding,
  }), { open: 0, overdue: 0, due7: 0, hearings: 0, reviews: 0, noAction: 0, outstanding: 0 });
  const owner = (s: StaffRow) => ({ owner: s.key });
  return (
    <SectionCard title="Per staff" description="Open matters by owner, riskiest first · reviews are matters in Partner review with the person as reviewer"
      actions={<Badge variant="secondary" className="text-[11px]">{plural(rows.length, 'person', 'people')}</Badge>}>
      {rows.length === 0 ? <EmptyBox>No open matter has an owner or a reviewer.</EmptyBox> : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map((s) => (
              <li key={s.key} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <Person s={s} links={links} />
                  <Amount value={s.money.outstanding} recorded={s.money.recorded > 0 || s.rows.length === 0} className="shrink-0 font-semibold" />
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                  {([
                    ['Open', <CountLink key="o" n={s.rows.length} to={links.matters(owner(s))} noun="open matters" />],
                    ['Overdue', <CountLink key="d" n={s.overdue} to={links.matters({ ...owner(s), clock: 'overdue' })} noun="overdue matters" bad />],
                    ['Due ≤ 7 d', <CountLink key="7" n={s.due7} to={links.drill('due7', owner(s))} noun="matters due within 7 days" />],
                    ['Hearings 14 d', <CountLink key="h" n={s.hearings14} to={links.tab('hearings', owner(s))} noun="hearings in 14 days" />],
                    ['To review', <CountLink key="r" n={s.reviews.length} to={links.drill(`review:${s.key}`)} noun="matters to review" />],
                    ['No next action', <CountLink key="n" n={s.noAction} to={links.drill('noaction', owner(s))} noun="matters without a next action" />],
                  ] as [string, React.ReactNode][]).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {s.stalest && <div className="mt-1.5 text-xs text-muted-foreground">Longest untouched: <Stalest s={s} /></div>}
              </li>
            ))}
          </ul>

          <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
            <table className={WS_TABLE}>
              <caption className="sr-only">Open litigation per staff member</caption>
              <thead>
                <tr>
                  <th scope="col" className={WS_TH}>Person</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Open</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')} title="Next clock already past">Overdue</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Due ≤ 7 d</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Hearings 14 d</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>To review</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>No next action</th>
                  <th scope="col" className={WS_TH}>Longest untouched</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.key} className={WS_TR}>
                    <td className={cn(WS_TD, 'min-w-[11rem]')}><Person s={s} links={links} /></td>
                    <td className={WS_TD_NUM}><CountLink n={s.rows.length} to={links.matters(owner(s))} noun={`open matters, ${s.name}`} /></td>
                    <td className={WS_TD_NUM}><CountLink n={s.overdue} to={links.matters({ ...owner(s), clock: 'overdue' })} noun={`overdue matters, ${s.name}`} bad /></td>
                    <td className={WS_TD_NUM}><CountLink n={s.due7} to={links.drill('due7', owner(s))} noun={`matters due within 7 days, ${s.name}`} /></td>
                    <td className={WS_TD_NUM}><CountLink n={s.hearings14} to={links.tab('hearings', owner(s))} noun={`hearings in 14 days, ${s.name}`} /></td>
                    <td className={WS_TD_NUM}><CountLink n={s.reviews.length} to={links.drill(`review:${s.key}`)} noun={`matters waiting for review by ${s.name}`} /></td>
                    <td className={WS_TD_NUM}><CountLink n={s.noAction} to={links.drill('noaction', owner(s))} noun={`matters without a next action, ${s.name}`} /></td>
                    <td className={WS_TD}><Stalest s={s} /></td>
                    <td className={cn(WS_TD_NUM, 'font-semibold')}><Amount value={s.money.outstanding} recorded={s.money.recorded > 0 || s.rows.length === 0} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={WS_TR_TOTAL}>
                  <td className={WS_TD}>Total</td>
                  <td className={WS_TD_NUM}>{t.open}</td>
                  <td className={WS_TD_NUM}>{t.overdue}</td>
                  <td className={WS_TD_NUM}>{t.due7}</td>
                  <td className={WS_TD_NUM}>{t.hearings}</td>
                  <td className={WS_TD_NUM}>{t.reviews}</td>
                  <td className={WS_TD_NUM}>{t.noAction}</td>
                  <td className={WS_TD} />
                  <td className={WS_TD_NUM}><Amount value={t.outstanding} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
};

export default MisStaff;
