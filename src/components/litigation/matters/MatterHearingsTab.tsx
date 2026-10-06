// The matter's hearings (audit U-85-1..4, U-91-4): upcoming and held apart,
// each a card with the date and time in IST, mode, venue, officer, who
// attends and the notes; upcoming ones can be changed, cancelled (with a
// reason) or added to a calendar; an outcome is recorded only once the hearing
// has started, and adjournments are counted against the three s.75(5) allows.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Loader2, Pencil, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffList } from '@/hooks/useStaffList';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { fmtDateTime } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { cancelHearing, hearingModeLabel, isoToIst, istDate, outcomeDef, type MatterHearing, type MatterWorkspace } from '@/lib/litigationData';
import { DaysChip } from './ClockCell';
import { cn } from '@/lib/utils';

const CancelDialog: React.FC<{ h: MatterHearing | null; onClose: () => void; onDone: () => void }> = ({ h, onClose, onDone }) => {
  const { user } = useAuth();
  const [why, setWhy] = useState('');
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { setWhy(''); }, [h]);
  if (!h) return null;
  const save = async () => {
    if (!user || !why.trim()) return;
    setSaving(true);
    try { await cancelHearing(h, why.trim(), user); toast.success('Hearing cancelled'); onClose(); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel the hearing of {fmtDateTime(h.scheduled_at)}?</DialogTitle>
          <DialogDescription>It comes off the Hearings page and the calendar; the matter's log keeps it with your reason.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="hc-why" className="text-xs">Why <span className="text-destructive">*</span></Label>
          <Input id="hc-why" value={why} onChange={(e) => setWhy(e.target.value)} className="h-9" placeholder="e.g. Notice withdrawn by the officer" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button onClick={save} disabled={saving || !why.trim()}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Cancel hearing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const MatterHearingsTab: React.FC<{
  ws: MatterWorkspace; canEdit: boolean; onSchedule: () => void; onChange: (h: MatterHearing) => void; onOutcome: (h: MatterHearing) => void; onChanged: () => void;
}> = ({ ws, canEdit, onSchedule, onChange, onOutcome, onChanged }) => {
  const { staff } = useStaffList();
  const [cancelling, setCancelling] = useState<MatterHearing | null>(null);
  const now = Date.now();
  const today = istToday();
  const upcoming = ws.hearings.filter((h) => !h.outcome && new Date(h.scheduled_at).getTime() > now);
  const held = ws.hearings.filter((h) => !upcoming.includes(h)).reverse();
  const adjourned = ws.hearings.filter((h) => h.adjourned).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const names = (ids: string[] | null) => (ids ?? []).map((id) => staff.find((s) => s.userId === id)?.name ?? 'staff').join(', ');

  const ics = (h: MatterHearing) => downloadIcs([{
    uid: `matter-hearing-${h.id}`, date: istDate(h.scheduled_at),
    title: `Hearing ${isoToIst(h.scheduled_at).time} IST — ${ws.client?.name ?? ''} · ${ws.matter.matter_no}`,
    description: [ws.matter.title, hearingModeLabel(h.mode), h.venue, h.officer, h.notes].filter(Boolean).join('\n'),
  }], `hearing-${ws.matter.matter_no}-${istDate(h.scheduled_at)}`);

  const Card: React.FC<{ h: MatterHearing; past: boolean }> = ({ h, past }) => {
    const o = outcomeDef(h.outcome);
    const n = adjourned.findIndex((x) => x.id === h.id) + 1;
    return (
      <li className={cn('rounded-lg border bg-card p-3', past && !h.outcome && 'border-warning/60')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {fmtDateTime(h.scheduled_at)} IST
              {!past && <DaysChip days={daysBetween(today, istDate(h.scheduled_at))} />}
            </div>
            <div className="text-xs text-muted-foreground">{[hearingModeLabel(h.mode), h.venue, h.officer].filter(Boolean).join(' · ') || 'venue not recorded'}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {!past && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => ics(h)}><CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Calendar (.ics)</Button>}
            {canEdit && !past && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => onChange(h)}><Pencil className="h-3.5 w-3.5" aria-hidden /> Change</Button>}
            {canEdit && !past && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setCancelling(h)}><X className="h-3.5 w-3.5" aria-hidden /> Cancel</Button>}
            {canEdit && past && <Button size="sm" variant={h.outcome ? 'outline' : 'default'} className={WS_BTN} onClick={() => onOutcome(h)}>{h.outcome ? 'Edit outcome' : 'Record outcome'}</Button>}
          </div>
        </div>
        {past && (
          <div className="mt-1.5 text-sm">
            {o ? (
              <span className="font-medium">
                {o.label}{h.adjourned && h.next_date ? ` → ${fmtDateTime(h.next_date)}` : ''}{h.adjourned && n ? ` (adjournment ${n} of 3)` : ''}
              </span>
            ) : <Badge variant="warning" className="text-[11px]">Outcome not recorded</Badge>}
          </div>
        )}
        {(h.attended_by?.length ?? 0) > 0 && <div className="mt-1 text-xs"><span className="text-muted-foreground">{past ? 'Attended' : 'Attending'}:</span> {names(h.attended_by)}</div>}
        {h.notes && <p className="mt-1 whitespace-pre-wrap text-xs">{h.notes}</p>}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Upcoming <span className="font-normal text-muted-foreground">· {upcoming.length}</span></h3>
        {canEdit && <Button size="sm" className={WS_BTN} onClick={onSchedule}><Plus className="h-3.5 w-3.5" aria-hidden /> Fix a hearing</Button>}
      </div>
      {upcoming.length ? <ul className="space-y-2">{upcoming.map((h) => <Card key={h.id} h={h} past={false} />)}</ul>
        : <p className="text-sm text-muted-foreground">No hearing is fixed.</p>}
      {adjourned.length >= 2 && <Note tone="warn">{adjourned.length} adjournments so far — s.75(5) allows no more than three in a proceeding.</Note>}
      <h3 className="text-sm font-semibold">Held <span className="font-normal text-muted-foreground">· {held.length}</span></h3>
      {held.length ? <ul className="space-y-2">{held.map((h) => <Card key={h.id} h={h} past />)}</ul>
        : <p className="text-sm text-muted-foreground">None yet.</p>}
      <p className="text-xs text-muted-foreground">Upcoming hearings also show on the <Link to="/notices-hearings" className="text-primary underline underline-offset-2">Hearings page</Link>.</p>
      <CancelDialog h={cancelling} onClose={() => setCancelling(null)} onDone={onChanged} />
    </div>
  );
};
