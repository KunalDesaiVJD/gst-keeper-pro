// A client's refunds on the client page, short (the firm, 25 October 2026:
// "the page is too long and also irrelevant information"): the four numbers,
// what needs action, and the way to the client's quarter grid and register on
// the Refunds page. Each refund has its own page; it is not listed again here.
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { useRefundLedger } from '@/components/notices/reports/ledgerData';
import { NeedsAction, RefundNumbers } from '@/components/notices/reports/RefundSummary';
import { fyLabel, placeOf, refundHref } from '@/components/notices/reports/refundModel';
import { istToday } from '@/lib/noticeFacts';
import { plural } from '@/lib/noticeFormat';

export const ClientRefunds: React.FC<{ clientId: string }> = ({ clientId }) => {
  const q = useRefundLedger(clientId);
  const nav = useNavigate();
  const rows = q.data ?? [];
  const places = rows.map(placeOf).filter((p): p is NonNullable<typeof p> => !!p && !p.byFiling);
  const first = places.reduce<number | null>((m, p) => (m === null || p.fy < m ? p.fy : m), null);
  const last = places.reduce<number | null>((m, p) => (m === null || p.fy > m ? p.fy : m), null);
  return (
    <SectionCard title={`Refunds · ${rows.length}`}
      description={first !== null && last !== null ? `${first === last ? fyLabel(first) : `${fyLabel(first)} to ${fyLabel(last).replace('FY ', '')}`}` : 'Applications for refund on the portal'}
      actions={<Link to={`/refunds-all?client=${clientId}`} className="text-xs font-medium text-primary hover:underline">Quarter grid and register →</Link>}>
      {q.isLoading ? <Skeleton className="h-20 w-full" />
        : q.error ? <Note tone="warn">Couldn't load the refunds: {q.error instanceof Error ? q.error.message : String(q.error)}</Note>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">No refund application on record.</p>
        : (
          <div className="space-y-2">
            <RefundNumbers rows={rows} />
            <NeedsAction rows={rows} today={istToday()} showClient={false} onOpen={(r) => nav(refundHref(clientId, r.fact.arn as string))} />
            {!rows.some((r) => r.state.group === 'action') && (
              <p className="text-xs text-muted-foreground">Nothing needs action on {plural(rows.length, 'refund')}.</p>
            )}
          </div>
        )}
    </SectionCard>
  );
};

export default ClientRefunds;
