// Notices & Litigation · Hearings (audit U-03-1: the tab opens the hearings).
// Upcoming personal hearings on open notices and on open matters — the same
// rows the tab counts (public.notice_hearings_upcoming).
import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { StageBadge } from '@/components/notices/StageBadge';
import { loadUpcomingHearings } from '@/lib/noticeCommandCentre';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { dueWords, fmtDateTime, fmtDay } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { cn } from '@/lib/utils';

const NoticesHearingsPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const q = useQuery({ queryKey: ['notice-hearings'], queryFn: loadUpcomingHearings });
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  const rows = q.data ?? [];
  const today = istToday();
  const exportIcs = () => downloadIcs(rows.map((h) => ({
    uid: `hearing-${h.kind}-${h.ref_id}`, date: h.hearing_on,
    title: `Hearing — ${h.client_name}${h.title ? ` · ${h.title}` : ''}`,
    description: [h.reference, h.venue, h.note].filter(Boolean).join('\n'),
  })), 'hearings', 'GST Keeper hearings');

  return (
    <NoticesShell section="Hearings"
      actions={rows.length > 0 && <Button size="sm" variant="outline" className={WS_BTN} onClick={exportIcs}><CalendarPlus className="h-3.5 w-3.5" /> Add all to calendar (.ics)</Button>}>
      <h2 className="text-base font-semibold">Upcoming hearings <span className="text-muted-foreground">· {q.isLoading ? '…' : rows.length}</span></h2>
      {q.error ? <Note tone="warn">Couldn't load hearings: {q.error instanceof Error ? q.error.message : String(q.error)}</Note>
        : q.isLoading ? <Skeleton className="h-64 w-full" />
        : rows.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hearing is fixed on an open notice or matter. Fix one from the notice's Hearings tab.</div>
        : (
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead><tr>
                <th scope="col" className={WS_TH}>When</th><th scope="col" className={WS_TH}>Client</th>
                <th scope="col" className={WS_TH}>Notice / matter</th><th scope="col" className={WS_TH}>Stage</th>
                <th scope="col" className={WS_TH}>Venue · note</th><th scope="col" className={WS_TH}>Owner</th>
              </tr></thead>
              <tbody>
                {rows.map((h) => {
                  const d = daysBetween(today, h.hearing_on);
                  return (
                    <tr key={`${h.kind}-${h.ref_id}`} className={WS_TR}>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}>
                        <div className={cn('font-semibold', d <= 1 && 'text-destructive-strong')}>{h.hearing_at ? fmtDateTime(h.hearing_at) : fmtDay(h.hearing_on)}</div>
                        <div className="text-[11px] text-muted-foreground">{dueWords(d).replace('due ', '')}</div>
                      </td>
                      <td className={WS_TD}><Link to={`/notices-company/${h.client_id}`} className="font-medium hover:underline">{h.client_name}</Link></td>
                      <td className={WS_TD}>
                        <Link to={h.notice_id ? `/notices/${h.notice_id}?tab=hearings` : `/litigation/${h.matter_id}`} className="font-medium hover:underline">{h.title ?? 'Hearing'}</Link>
                        <div className="text-xs text-muted-foreground"><Badge variant="secondary" className="mr-1 text-[10px]">{h.kind === 'notice' ? 'Notice' : 'Matter'}</Badge><span className="font-mono">{h.reference}</span></div>
                      </td>
                      <td className={WS_TD}><StageBadge stage={h.stage} /></td>
                      <td className={cn(WS_TD, 'text-xs')}>{[h.venue, h.note].filter(Boolean).join(' · ') || '—'}</td>
                      <td className={cn(WS_TD, 'text-xs')}>{h.owner ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </NoticesShell>
  );
};

export default NoticesHearingsPage;
