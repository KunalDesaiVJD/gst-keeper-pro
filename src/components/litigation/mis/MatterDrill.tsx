// The matters behind an MIS number the Matters list cannot filter by (audit
// cross-cutting ui-c "MIS numbers are dead ends"; U-100-1, U-104-2, U-105-1):
// overdue clocks, untouched matters, a forum, a reviewer's queue… The URL holds
// the set (?show=), so the list is shareable and Back closes it. Its count and
// total are the number that was clicked.
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { mattersHref, type DrillView } from './misData';
import { Amount, ClockCell, EmptyBox, MatterAmount, MatterLink } from './ui';

// "Outstanding" lists show a refund matter's refund at stake instead of ₹0.
const Cell: React.FC<{ view: DrillView; m: DrillView['rows'][number]; className?: string }> = ({ view, m, className }) =>
  view.amountLabel === 'Outstanding' ? <MatterAmount m={m} className={className} />
    : <Amount value={view.amount(m)} recorded={m.recorded} className={className} />;

export const MatterDrill: React.FC<{ view: DrillView; closeTo: string }> = ({ view, closeTo }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ref.current?.focus({ preventScroll: true });
  }, [view.key]);
  const total = view.rows.reduce((s, m) => s + view.amount(m), 0);
  const recorded = view.rows.some((m) => m.recorded);

  return (
    <div ref={ref} tabIndex={-1} className="scroll-mt-20 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <SectionCard
        className="border-primary/40"
        title={<>{view.title} <span className="font-normal text-muted-foreground">· {plural(view.rows.length, 'matter')}{recorded && <> · {fmtInrShort(total)}</>}</span></>}
        description={view.description}
        actions={
          <Link to={closeTo} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-3.5 w-3.5" aria-hidden /> Close list
          </Link>
        }
      >
        {view.rows.length === 0 ? <EmptyBox>No matter is in this list.</EmptyBox> : (
          <>
            <ul className="space-y-2 md:hidden">
              {view.rows.map((m) => (
                <li key={m.id} className="rounded-lg border bg-card p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <MatterLink m={m} className="flex-1" />
                    <Cell view={view} m={m} className="shrink-0 font-semibold" />
                  </div>
                  <Link to={mattersHref({ client: m.clientId })} className="mt-0.5 block truncate text-xs text-muted-foreground hover:underline">{m.clientName}</Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StageBadge stage={m.stage} />
                    <OwnerChip name={m.ownerName} showName className="ml-auto" />
                  </div>
                  <div className="mt-2"><ClockCell clock={m.nextClock} /></div>
                  {view.note && <p className="mt-1 text-xs text-muted-foreground">{view.note(m)}</p>}
                </li>
              ))}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
              <table className={WS_TABLE}>
                <caption className="sr-only">{view.title}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={WS_TH}>Matter</th>
                    <th scope="col" className={WS_TH}>Client</th>
                    <th scope="col" className={WS_TH}>Stage</th>
                    <th scope="col" className={WS_TH}>Owner</th>
                    <th scope="col" className={WS_TH}>Next clock</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>{view.amountLabel}</th>
                    {view.note && <th scope="col" className={WS_TH}>Why it is listed</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((m) => (
                    <tr key={m.id} className={WS_TR}>
                      <td className={cn(WS_TD, 'min-w-[14rem]')}><MatterLink m={m} /></td>
                      <td className={cn(WS_TD, 'max-w-[12rem]')}>
                        <Link to={mattersHref({ client: m.clientId })} className="block truncate hover:underline">{m.clientName}</Link>
                        {m.isRefund && <Badge variant="info" className="mt-0.5 text-[10px]">Refund</Badge>}
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}><StageBadge stage={m.stage} /></td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}><OwnerChip name={m.ownerName} showName /></td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}><ClockCell clock={m.nextClock} /></td>
                      <td className={cn(WS_TD_NUM, 'font-semibold')}><Cell view={view} m={m} /></td>
                      {view.note && <td className={cn(WS_TD, 'text-xs')}>{view.note(m)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={WS_TR_TOTAL}>
                    <td className={WS_TD} colSpan={5}>Total · {plural(view.rows.length, 'matter')}</td>
                    <td className={WS_TD_NUM}>{recorded ? <Amount value={total} /> : '—'}</td>
                    {view.note && <td className={WS_TD} />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
};

export default MatterDrill;
