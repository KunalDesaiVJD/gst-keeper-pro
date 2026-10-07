// Litigation MIS · By client (audit U-101-1..4): pre-deposit and paid in their
// own columns, outstanding = demand − both, "—" where nothing was typed, each
// client's share of the outstanding with a bar, its next clock, overdue and
// hearings, a top-5 line, and the client opening its matters (notices behind a
// small icon). Cards on phones; a total row on the table.
import React from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { ClientRow, MisLinks, MisReport } from './misData';
import { Amount, ClockCell, CountLink, EmptyBox } from './ui';

const ShareBar: React.FC<{ share: number }> = ({ share }) => (
  <span className="flex items-center justify-end gap-1.5">
    <span className="h-1.5 w-14 rounded-full bg-muted" aria-hidden>
      {share > 0 && <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(3, share * 100)}%` }} />}
    </span>
    <span className="w-9 text-right tabular-nums">{Math.round(share * 100)}%</span>
  </span>
);

const NoticesIcon: React.FC<{ c: ClientRow }> = ({ c }) => (
  <Link to={`/notices-company/${c.clientId}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={`Notices of ${c.name}`} title="Notices of this client">
    <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
  </Link>
);

export const MisClients: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const rows = r.byClient;
  const top = rows.slice(0, 5);
  const topShare = top.reduce((s, c) => s + c.share, 0);
  const missing = r.sets.nodemand.length;
  const m = r.money;
  return (
    <SectionCard
      title="By client"
      description="Open matters, largest outstanding first · outstanding = demand − pre-deposit − paid"
      actions={<Badge variant="secondary" className="text-[11px]">{plural(rows.length, 'client')}</Badge>}
    >
      {rows.length === 0 ? <EmptyBox>No client has an open matter.</EmptyBox> : (
        <>
          <p className="text-xs text-muted-foreground">
            {top.length > 1 && m.outstanding > 0 && (
              <>The top {top.length} clients hold <span className="font-semibold text-foreground">{Math.round(topShare * 100)}%</span> of{' '}
                {fmtInrShort(m.outstanding)} outstanding{rows[0].share >= 0.5 ? <>; {rows[0].name} alone holds {Math.round(rows[0].share * 100)}%</> : null}.{' '}</>
            )}
            {missing > 0 && (
              <Link to={links.drill('nodemand')} className="font-medium text-primary underline underline-offset-2">
                {plural(missing, 'matter')} with no amount recorded
              </Link>
            )}
          </p>

          <ul className="space-y-2 md:hidden">
            {rows.map((c) => (
              <li key={c.clientId} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link to={links.matters({ client: c.clientId })} className="block truncate font-semibold hover:underline">{c.name}</Link>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.gstin ?? '—'}</span>
                  </div>
                  <NoticesIcon c={c} />
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Outstanding</span>
                  <Amount value={c.money.outstanding} recorded={c.money.recorded > 0} className="font-semibold" />
                </div>
                <ShareBar share={c.share} />
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span><CountLink n={c.rows.length} to={links.matters({ client: c.clientId })} noun="open matters" className="text-foreground" /> open</span>
                  <span><CountLink n={c.overdue} to={links.matters({ client: c.clientId, clock: 'overdue' })} noun="overdue matters" bad /> overdue</span>
                  <span><CountLink n={c.hearings14} to={links.tab('hearings', { client: c.clientId })} noun="hearings in 14 days" className="text-foreground" /> hearings in 14 d</span>
                </div>
                <div className="mt-1.5"><ClockCell clock={c.next?.clock ?? null} /></div>
              </li>
            ))}
          </ul>

          <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
            <table className={WS_TABLE}>
              <caption className="sr-only">Open litigation by client</caption>
              <thead>
                <tr>
                  <th scope="col" className={WS_TH}>Client</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Matters</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Demand</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Pre-deposit</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Paid</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')} title="Demand − pre-deposit − paid">Outstanding</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Share</th>
                  <th scope="col" className={WS_TH}>Next clock</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')} title="Matters whose next clock is already past">Overdue</th>
                  <th scope="col" className={cn(WS_TH, 'text-right')}>Hearings 14 d</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const rec = c.money.recorded > 0;
                  return (
                    <tr key={c.clientId} className={WS_TR}>
                      <td className={cn(WS_TD, 'max-w-[16rem]')}>
                        <div className="flex items-center gap-1">
                          <Link to={links.matters({ client: c.clientId })} className="min-w-0 truncate font-medium hover:underline">{c.name}</Link>
                          <NoticesIcon c={c} />
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">{c.gstin ?? '—'}</div>
                      </td>
                      <td className={WS_TD_NUM}><CountLink n={c.rows.length} to={links.matters({ client: c.clientId })} noun={`open matters of ${c.name}`} /></td>
                      <td className={WS_TD_NUM}><Amount value={c.money.demand} recorded={rec} /></td>
                      <td className={WS_TD_NUM}><Amount value={c.money.preDeposit} recorded={rec} /></td>
                      <td className={WS_TD_NUM}><Amount value={c.money.paid} recorded={rec} /></td>
                      <td className={cn(WS_TD_NUM, 'font-semibold')}><Amount value={c.money.outstanding} recorded={rec} /></td>
                      <td className={WS_TD_NUM}><ShareBar share={c.share} /></td>
                      <td className={cn(WS_TD, 'min-w-[10rem]')}>
                        <ClockCell clock={c.next?.clock ?? null} />
                        {c.next && c.rows.length > 1 && (
                          <Link to={`/litigation/${c.next.matter.id}`} className="block truncate font-mono text-[11px] text-muted-foreground hover:underline">{c.next.matter.matterNo}</Link>
                        )}
                      </td>
                      <td className={WS_TD_NUM}><CountLink n={c.overdue} to={links.matters({ client: c.clientId, clock: 'overdue' })} noun={`overdue matters of ${c.name}`} bad /></td>
                      <td className={WS_TD_NUM}><CountLink n={c.hearings14} to={links.tab('hearings', { client: c.clientId })} noun={`hearings of ${c.name} in 14 days`} /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={WS_TR_TOTAL}>
                  <td className={WS_TD}>Total · {plural(rows.length, 'client')}</td>
                  <td className={WS_TD_NUM}>{r.open.length.toLocaleString('en-IN')}</td>
                  <td className={WS_TD_NUM}><Amount value={m.demand} /></td>
                  <td className={WS_TD_NUM}><Amount value={m.preDeposit} /></td>
                  <td className={WS_TD_NUM}><Amount value={m.paid} /></td>
                  <td className={WS_TD_NUM}><Amount value={m.outstanding} /></td>
                  <td className={WS_TD_NUM}>{m.outstanding > 0 ? '100%' : '—'}</td>
                  <td className={WS_TD} />
                  <td className={WS_TD_NUM}>{r.sets.overdue.length.toLocaleString('en-IN')}</td>
                  <td className={WS_TD_NUM}>{r.hearings.next14.length.toLocaleString('en-IN')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {m.refund > 0 && (
            <p className="text-xs text-muted-foreground">
              Refund at stake ({fmtInrShort(m.refund)} on{' '}
              <Link to={links.matters({ lifecycle: 'refund' })} className="text-primary underline underline-offset-2">{plural(r.sets.refund.length, 'refund matter')}</Link>)
              {' '}is kept out of demand and outstanding.
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
};

export default MisClients;
