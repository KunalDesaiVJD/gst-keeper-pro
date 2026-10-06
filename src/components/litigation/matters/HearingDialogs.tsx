// Fixing, changing and recording a hearing (audit U-91-1..4, U-92-1..4).
// Times are entered and shown in IST and saved with their offset; venue and
// officer come from the last hearing or the matter; a new hearing must be in
// the future and same-day clashes are flagged; the outcome is required, an
// adjournment needs the next date (and adds that hearing), and an order passed
// leads straight to recording the order.
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffList } from '@/hooks/useStaffList';
import { supabase } from '@/integrations/supabase/client';
import { addDays, istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtDateTime } from '@/lib/noticeFormat';
import { stageIndex } from '@/lib/noticeStages';
import {
  editHearing, editMatterDetails, forumKey, HEARING_MODES, HEARING_OUTCOMES, isoToIst, istToIso, outcomeDef, recordHearingOutcome, scheduleHearing,
  type MatterHearing, type MatterWorkspace,
} from '@/lib/litigationData';

const PURPOSE: Record<string, string> = {
  adjudicating: 'Personal hearing u/s 75(4)', appellate: 'Appeal hearing before the Appellate Authority',
  tribunal: 'Hearing before the Tribunal', high_court: 'High Court hearing', supreme_court: 'Supreme Court hearing',
};

/** Staff tick-list for who attends (attended_by). */
const Attendees: React.FC<{ value: string[]; onChange: (v: string[]) => void; idPrefix: string }> = ({ value, onChange, idPrefix }) => {
  const { staff } = useStaffList();
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium">Who attends</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {staff.map((s) => (
          <label key={s.userId} htmlFor={`${idPrefix}-${s.userId}`} className="flex items-center gap-1.5 text-xs">
            <Checkbox id={`${idPrefix}-${s.userId}`} checked={value.includes(s.userId)}
              onCheckedChange={(v) => onChange(v ? [...value, s.userId] : value.filter((x) => x !== s.userId))} />
            {s.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
};

export const HearingDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ws: MatterWorkspace;
  /** Change this hearing; otherwise fix a new one. */
  hearing?: MatterHearing | null;
  onDone: () => void;
}> = ({ open, onOpenChange, ws, hearing, onDone }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const last = useMemo(() => [...ws.hearings].reverse().find((h) => h.venue || h.officer) ?? null, [ws.hearings]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('11:00');
  const [mode, setMode] = useState('physical');
  const [venue, setVenue] = useState('');
  const [officer, setOfficer] = useState('');
  const [notes, setNotes] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [why, setWhy] = useState('');
  const [toHearing, setToHearing] = useState(true);
  const [clash, setClash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const at = isoToIst(hearing?.scheduled_at);
    setDate(at.date || addDays(istToday(), 7));
    setTime(at.time || '11:00');
    const prevMode = hearing?.mode ?? last?.mode ?? 'physical';
    setMode(HEARING_MODES.find((x) => x.key === prevMode || x.label.toLowerCase() === prevMode.toLowerCase())?.key ?? 'physical');
    setVenue(hearing?.venue ?? last?.venue ?? m.jurisdiction ?? '');
    setOfficer(hearing?.officer ?? last?.officer ?? m.officer ?? '');
    setNotes(hearing ? hearing.notes ?? '' : PURPOSE[forumKey(m)] ?? '');
    setWho(hearing?.attended_by ?? (m.owner_user_id ? [m.owner_user_id] : []));
    setWhy('');
    setToHearing(!hearing && stageIndex(m.stage) < stageIndex('hearing'));
    setClash(null);
  }, [open, hearing, last, m]);

  const at = date && time ? istToIso(date, time) : '';
  const past = !!at && new Date(at).getTime() <= Date.now();
  const moved = !!hearing && !!at && new Date(hearing.scheduled_at).getTime() !== new Date(at).getTime();

  // Same-day hearings of the owner or anyone attending, on other matters.
  useEffect(() => {
    if (!open || !date) return;
    let off = false;
    (async () => {
      const { data } = await supabase.from('matter_hearings').select('id, matter_id, scheduled_at, attended_by')
        .gte('scheduled_at', istToIso(date, '00:00')).lt('scheduled_at', istToIso(addDays(date, 1), '00:00')).is('outcome', null);
      const others = (data ?? []).filter((h) => h.id !== hearing?.id && h.matter_id !== m.id);
      if (!others.length) { if (!off) setClash(null); return; }
      const { data: ms } = await supabase.from('litigation_matters').select('id, matter_no, owner_user_id').in('id', others.map((h) => h.matter_id));
      const people = new Set([...who, m.owner_user_id].filter(Boolean));
      const hits = others.filter((h) => people.has(ms?.find((x) => x.id === h.matter_id)?.owner_user_id ?? '') || (h.attended_by ?? []).some((p) => people.has(p)));
      if (!off) setClash(hits.length ? hits.map((h) => `${ms?.find((x) => x.id === h.matter_id)?.matter_no ?? 'another matter'} at ${isoToIst(h.scheduled_at).time}`).join(', ') : null);
    })();
    return () => { off = true; };
  }, [open, date, who, hearing?.id, m.id, m.owner_user_id]);

  const valid = !!date && !!time && (hearing ? true : !past);

  const save = async () => {
    if (!user || !valid) return;
    setSaving(true);
    try {
      const input = { scheduled_at: at, mode, venue: venue.trim() || null, officer: officer.trim() || null, attended_by: who.length ? who : null, notes: notes.trim() || null };
      if (hearing) await editHearing(hearing, input, user, moved ? why.trim() || null : null);
      else await scheduleHearing(m, input, user, toHearing);
      toast.success(hearing ? (moved ? `Hearing moved to ${fmtDateTime(at)}` : 'Hearing updated') : `Hearing fixed for ${fmtDateTime(at)}`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(`Couldn't save the hearing: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{hearing ? 'Change the hearing' : 'Fix a hearing'}</DialogTitle>
          <DialogDescription>
            {m.matter_no} · {ws.client?.name}{hearing ? ` · now ${fmtDateTime(hearing.scheduled_at)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hd-date" className="text-xs">Date <span className="text-destructive">*</span></Label>
            <Input id="hd-date" type="date" value={date} min={hearing ? undefined : istToday()} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hd-time" className="text-xs">Time (IST) <span className="text-destructive">*</span></Label>
            <Input id="hd-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9" />
          </div>
          {past && !hearing && <p className="text-xs text-destructive-strong sm:col-span-2">Pick a date and time still to come — record a past hearing's outcome from the list instead.</p>}
          <div className="space-y-1">
            <Label htmlFor="hd-mode" className="text-xs">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="hd-mode" className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{HEARING_MODES.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hd-officer" className="text-xs">Officer</Label>
            <Input id="hd-officer" value={officer} onChange={(e) => setOfficer(e.target.value)} className="h-9" placeholder="e.g. Assistant Commissioner, Division-II" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="hd-venue" className="text-xs">{mode === 'video' ? 'Video link' : 'Venue'}</Label>
            <Input id="hd-venue" value={venue} onChange={(e) => setVenue(e.target.value)} className="h-9" placeholder={mode === 'video' ? 'https://…' : 'e.g. Room 204, CGST Bhavan, Surat'} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="hd-notes" className="text-xs">Purpose, notice reference and what to carry</Label>
            <Textarea id="hd-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm" />
          </div>
          <div className="sm:col-span-2"><Attendees value={who} onChange={setWho} idPrefix="hd-who" /></div>
          {moved && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="hd-why" className="text-xs">Why it moved</Label>
              <Input id="hd-why" value={why} onChange={(e) => setWhy(e.target.value)} className="h-9" placeholder="e.g. Rescheduled by the department" />
            </div>
          )}
        </div>
        {clash && <Note tone="warn">Same day for the people attending: {clash}.</Note>}
        {!hearing && stageIndex(m.stage) < stageIndex('hearing') && (
          <label htmlFor="hd-stage" className="flex items-center gap-2 text-xs">
            <Checkbox id="hd-stage" checked={toHearing} onCheckedChange={(v) => setToHearing(!!v)} /> Move the matter to the Hearing stage
          </label>
        )}
        <p className="text-[11px] text-muted-foreground">Upcoming hearings show on the Hearings page and the owner's list for the day; add one to your calendar from the hearing card.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !valid}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {hearing ? 'Save' : 'Fix hearing'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const OutcomeDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ws: MatterWorkspace;
  hearing: MatterHearing | null;
  onDone: () => void;
  /** After "Order passed" and similar: record the order. */
  onOrder: () => void;
}> = ({ open, onOpenChange, ws, hearing, onDone, onOrder }) => {
  const { user } = useAuth();
  const [outcome, setOutcome] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('11:00');
  const [dueBy, setDueBy] = useState('');
  const [notes, setNotes] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const def = outcomeDef(outcome);
  // Adjournments already granted in this matter, before this hearing.
  const prior = ws.hearings.filter((h) => h.adjourned && h.id !== hearing?.id && hearing && h.scheduled_at < hearing.scheduled_at).length;

  useEffect(() => {
    if (!open || !hearing) return;
    setOutcome(hearing.outcome ?? '');
    const n = isoToIst(hearing.next_date);
    setNextDate(n.date); setNextTime(n.time || '11:00');
    setDueBy(ws.matter.override_due_date ?? '');
    setNotes(hearing.notes ?? '');
    setWho(hearing.attended_by ?? (ws.matter.owner_user_id ? [ws.matter.owner_user_id] : []));
  }, [open, hearing, ws.matter.override_due_date, ws.matter.owner_user_id]);

  if (!hearing) return null;
  const nextAt = nextDate && nextTime ? istToIso(nextDate, nextTime) : '';
  const nextOk = def?.next !== 'hearing' || (!!nextAt && new Date(nextAt).getTime() > new Date(hearing.scheduled_at).getTime());
  const dueOk = def?.next !== 'due' || !!dueBy;
  const valid = !!outcome && nextOk && dueOk;

  const save = async () => {
    if (!user || !valid) return;
    setSaving(true);
    try {
      await recordHearingOutcome(hearing, { outcome, nextAt: def?.next === 'hearing' ? nextAt : null, notes: notes.trim() || null, attended_by: who.length ? who : null },
        user, def?.next === 'hearing' ? prior + 1 : null);
      if (def?.next === 'due') {
        await editMatterDetails(ws.matter, { override_due_date: dueBy, next_action: `File the written submissions by ${fmtDate(dueBy)}` }, user);
      }
      toast.success(def?.next === 'hearing' ? `Recorded — next hearing ${fmtDateTime(nextAt)} added` : 'Outcome recorded');
      onOpenChange(false);
      onDone();
      if (def?.next === 'order') onOrder();
    } catch (e) {
      toast.error(`Couldn't record the outcome: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record the hearing</DialogTitle>
          <DialogDescription>Hearing of {fmtDateTime(hearing.scheduled_at)}{hearing.venue ? ` · ${hearing.venue}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ho-outcome" className="text-xs">What happened <span className="text-destructive">*</span></Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger id="ho-outcome" className="h-9 text-sm"><SelectValue placeholder="Pick the outcome" /></SelectTrigger>
              <SelectContent>{HEARING_OUTCOMES.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {def?.next === 'hearing' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ho-next" className="text-xs">Next hearing on <span className="text-destructive">*</span></Label>
                <Input id="ho-next" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ho-next-time" className="text-xs">at (IST) <span className="text-destructive">*</span></Label>
                <Input id="ho-next-time" type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} className="h-9" />
              </div>
              {!nextOk && nextDate && <p className="text-xs text-destructive-strong sm:col-span-2">The next hearing must be after this one.</p>}
              <p className="text-[11px] text-muted-foreground sm:col-span-2">The next hearing is added with the same venue, officer and mode.</p>
              {outcome === 'Adjourned' && prior >= 2 && (
                <Note tone="warn" className="sm:col-span-2">This is adjournment {prior + 1}: s.75(5) allows no more than three in a proceeding.</Note>
              )}
            </div>
          )}
          {def?.next === 'due' && (
            <div className="space-y-1">
              <Label htmlFor="ho-due" className="text-xs">Submissions due by <span className="text-destructive">*</span></Label>
              <Input id="ho-due" type="date" value={dueBy} min={istToday()} onChange={(e) => setDueBy(e.target.value)} className="h-9" />
              <p className="text-[11px] text-muted-foreground">Becomes the matter's due date and next action, so it shows as its clock.</p>
            </div>
          )}
          {def?.next === 'order' && <p className="text-xs text-muted-foreground">Next you record the order — its date starts the appeal clock.</p>}
          <Attendees value={who} onChange={setWho} idPrefix="ho-who" />
          <div className="space-y-1">
            <Label htmlFor="ho-notes" className="text-xs">Notes</Label>
            <Textarea id="ho-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm"
              placeholder="What the officer asked for, what was agreed, what to file next" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !valid}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save outcome</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
