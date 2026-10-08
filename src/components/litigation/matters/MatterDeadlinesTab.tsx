// The matter's clocks (audit U-84-3): what is running now — reply dues,
// hearings, appeal and limitation dates, with their basis — and every
// statutory clock the database wrote for the linked notices
// (matter_deadlines, keyed by notice), which can be marked met.
import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { markDeadlineMet } from '@/lib/noticeWorkspace';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { fmtDate } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import type { MatterWorkspace } from '@/lib/litigationData';
import { clockWhen, DaysChip } from './ClockCell';
import { noticeLabel } from './MatterNoticesTab';
import { cn } from '@/lib/utils';

const LABEL: Record<string, string> = {
  reply_due: 'Reply due', hearing: 'Personal hearing', appeal_s107: 'Appeal to the Appellate Authority (s.107)',
  appeal_s107_condonation: 'Appeal, last day with condonation (s.107(4))', appeal_s112: 'Appeal to the Tribunal (s.112)',
  appeal_s112_condonation: 'Tribunal appeal, last day with condonation', attachment_expiry: 'Provisional attachment lapses (s.83)',
};

export const MatterDeadlinesTab: React.FC<{ ws: MatterWorkspace; canEdit: boolean; onChanged: () => void }> = ({ ws, canEdit, onChanged }) => {
  const { user } = useAuth();
  const today = istToday();
  const notices = new Map(ws.notices.map((n) => [n.id as string, n]));
  const toggle = async (id: string, met: boolean) => {
    if (!user) return;
    try { await markDeadlineMet(id, met, user); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const exportIcs = () => downloadIcs(ws.clocks.map((c, i) => ({
    uid: `matter-${ws.matter.id}-${c.kind}-${i}`, date: c.date,
    title: `${c.label} — ${ws.client?.name ?? ''} · ${ws.matter.matter_no}`, description: [ws.matter.title, c.basis, c.detail].filter(Boolean).join('\n'),
  })), `clocks-${ws.matter.matter_no}`);

  return (
    <div className="space-y-3">
      <SectionCard title="Running now" description={ws.clocks.length ? 'Earliest first; overdue in red' : 'No clock is running on this matter'}
        actions={ws.clocks.length > 0 && <Button size="sm" variant="outline" className={WS_BTN} onClick={exportIcs}><CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Add to calendar (.ics)</Button>}>
        {ws.clocks.length > 0 && (
          <ul className="divide-y">
            {ws.clocks.map((c, i) => (
              <li key={`${c.kind}-${i}`} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.noticeId && notices.get(c.noticeId) ? <>from <Link to={`/notices/${c.noticeId}?tab=deadlines`} className="text-primary underline underline-offset-2">{noticeLabel(notices.get(c.noticeId)!)}</Link></> : 'set on this matter'}
                    {c.basis ? ` · ${c.basis}` : ''}{c.detail && !c.noticeId ? ` · ${c.detail}` : ''}
                  </span>
                </span>
                <span className={cn('whitespace-nowrap font-semibold tabular-nums', c.days < 0 && 'text-destructive-strong')}>{clockWhen(c)}</span>
                <DaysChip days={c.days} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Statutory clocks of the linked notices" description={ws.deadlines.length ? `${ws.deadlines.filter((d) => !d.is_met).length} open of ${ws.deadlines.length}` : 'None written yet'}>
        {ws.deadlines.length > 0 && (
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead><tr>
                <th scope="col" className={WS_TH}>Clock</th><th scope="col" className={WS_TH}>Date</th><th scope="col" className={WS_TH}>Notice</th>
                <th scope="col" className={WS_TH}>Status</th>{canEdit && <th scope="col" className={cn(WS_TH, 'w-10')}><span className="sr-only">Mark met</span></th>}
              </tr></thead>
              <tbody>
                {ws.deadlines.map((d) => {
                  const n = notices.get(d.notice_id);
                  const days = daysBetween(today, d.deadline_date);
                  return (
                    <tr key={d.id} className={WS_TR}>
                      <td className={WS_TD}><div className="font-medium">{LABEL[d.deadline_type] ?? d.deadline_type}</div>{d.statutory_basis && <div className="text-xs text-muted-foreground">{d.statutory_basis}</div>}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}>
                        <div className={cn('font-semibold', !d.is_met && days < 0 && 'text-destructive-strong')}>{fmtDate(d.deadline_date)}</div>
                        {!d.is_met && <DaysChip days={days} />}
                      </td>
                      <td className={cn(WS_TD, 'text-xs')}>{n ? <Link to={`/notices/${n.id}?tab=deadlines`} className="text-primary underline underline-offset-2">{noticeLabel(n)}</Link> : '—'}</td>
                      <td className={WS_TD}>
                        <Badge variant={d.is_met ? 'success' : d.source === 'override' ? 'info' : 'secondary'} className="text-[10px]">
                          {d.is_met ? `Met${d.met_by ? ` · ${d.met_by}` : ''}` : d.source === 'override' ? 'Your date' : 'Computed'}
                        </Badge>
                      </td>
                      {canEdit && <td className={WS_TD}>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggle(d.id, !d.is_met)}
                          aria-label={`${d.is_met ? 'Mark not met' : 'Mark met'}: ${LABEL[d.deadline_type] ?? d.deadline_type}`}>
                          <Check className={cn('h-3.5 w-3.5', d.is_met && 'text-success-strong')} />
                        </Button>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Note tone="position">Periods come from the firm's litigation rules and run from the date on the notice or order; confirm against the date the order was communicated.</Note>
      </SectionCard>
    </div>
  );
};
