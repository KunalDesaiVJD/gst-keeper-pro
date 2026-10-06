import React, { useState } from 'react';
import { CalendarPlus, Check, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { markDeadlineMet, overrideDeadline, type Deadline, type Workspace } from '@/lib/noticeWorkspace';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { dueWords, fmtDate, noticeTitle } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { cn } from '@/lib/utils';

export const DEADLINE_LABELS: Record<string, string> = {
  reply_due: 'Reply due',
  hearing: 'Personal hearing',
  appeal_s107: 'Appeal to the Appellate Authority (s.107)',
  appeal_s107_condonation: 'Appeal, last day with condonation (s.107(4))',
  appeal_s112: 'Appeal to the Tribunal (s.112)',
  appeal_s112_condonation: 'Tribunal appeal, last day with condonation',
  attachment_expiry: 'Provisional attachment lapses (s.83)',
};

const OverrideButton: React.FC<{ d: Deadline; onDone: () => void }> = ({ d, onDone }) => {
  const [date, setDate] = useState(d.deadline_date);
  const [note, setNote] = useState(d.notes ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Change the date of ${DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}`}><Pencil className="h-3.5 w-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <div className="text-sm font-semibold">Your date for this clock</div>
        <p className="text-xs text-muted-foreground">It is kept when the rules recompute; the computed date stays visible beside it.</p>
        <div className="space-y-1">
          <Label htmlFor={`ovr-${d.id}`} className="text-xs">Date</Label>
          <Input id={`ovr-${d.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ovr-note-${d.id}`} className="text-xs">Why</Label>
          <Input id={`ovr-note-${d.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. order served on 12 Oct" className="h-8 text-xs" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="h-8 text-xs" disabled={!date || saving} onClick={async () => {
            setSaving(true);
            try { await overrideDeadline(d.id, date, note || null); toast.success('Date saved'); onDone(); }
            catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setSaving(false); }
          }}>{saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/**
 * The notice's clocks, written by the database (statutory clocks writer,
 * migration 20261006114000): each with its basis, computed or overridden, and
 * whether the firm has confirmed the period (audit U-43-2).
 */
export const DeadlinesTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void }> = ({ ws, canEdit, onChanged }) => {
  const { user } = useAuth();
  const today = istToday();
  const rows = ws.deadlines;
  const exportIcs = () => downloadIcs(rows.filter((d) => !d.is_met).map((d) => ({
    uid: d.id, date: d.deadline_date,
    title: `${DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type} — ${ws.client?.name ?? ''}`,
    description: `${noticeTitle(ws.fact)} · ${ws.notice.reference_number ?? ws.notice.case_id ?? ''}${d.statutory_basis ? `\n${d.statutory_basis}` : ''}`,
  })), `deadlines-${ws.notice.reference_number || ws.notice.id}`);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No clocks for this notice: it has no due date, hearing or order on record yet.</p>;
  }
  return (
    <div className="space-y-2">
      <div className={WS_TABLE_WRAP}>
        <table className={WS_TABLE}>
          <thead><tr>
            <th scope="col" className={WS_TH}>Clock</th><th scope="col" className={WS_TH}>Date</th>
            <th scope="col" className={WS_TH}>Basis</th><th scope="col" className={WS_TH}>Status</th>
            {canEdit && <th scope="col" className={cn(WS_TH, 'w-20')}><span className="sr-only">Actions</span></th>}
          </tr></thead>
          <tbody>
            {rows.map((d) => {
              const days = daysBetween(today, d.deadline_date);
              const overridden = d.source === 'override';
              return (
                <tr key={d.id} className={cn(WS_TR, d.is_met && 'opacity-60')}>
                  <td className={cn(WS_TD, 'font-medium')}>{DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>
                    <div className={cn('font-semibold', !d.is_met && days < 0 && 'text-destructive-strong')}>{fmtDate(d.deadline_date)}</div>
                    <div className="text-[11px] text-muted-foreground">{d.is_met ? `met${d.met_by ? ` · ${d.met_by}` : ''}` : dueWords(days)}</div>
                    {overridden && d.computed_date && d.computed_date !== d.deadline_date && (
                      <div className="text-[11px] text-muted-foreground">rule says {fmtDate(d.computed_date)}</div>
                    )}
                  </td>
                  <td className={cn(WS_TD, 'text-xs')}>
                    {d.statutory_basis || '—'}
                    {d.base_date && <div className="text-[11px] text-muted-foreground">runs from {fmtDate(d.base_date)}</div>}
                    {d.notes && <div className="text-[11px] text-muted-foreground">{d.notes}</div>}
                  </td>
                  <td className={WS_TD}>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={overridden ? 'info' : 'secondary'} className="text-[10px]">{overridden ? 'Your date' : 'Computed'}</Badge>
                      {d.period_confirmed === false && <Badge variant="warning" className="text-[10px]">period unconfirmed</Badge>}
                    </div>
                  </td>
                  {canEdit && (
                    <td className={cn(WS_TD, 'whitespace-nowrap')}>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={d.is_met ? 'Mark not met' : 'Mark met'}
                        onClick={async () => { if (!user) return; try { await markDeadlineMet(d.id, !d.is_met, user); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } }}>
                        <Check className={cn('h-3.5 w-3.5', d.is_met && 'text-success-strong')} />
                      </Button>
                      <OverrideButton d={d} onDone={onChanged} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Note tone="position" className="flex-1">Periods come from the firm's litigation rules; any marked "period unconfirmed" still needs the firm's confirmation.</Note>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={exportIcs}><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar (.ics)</Button>
      </div>
    </div>
  );
};

export default DeadlinesTab;
