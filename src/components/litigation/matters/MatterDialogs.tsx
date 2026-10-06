// The matter's step dialogs (audit U-84-2, U-89-1, U-89-3, U-90-1..4,
// U-92-1, U-96-1): record the reply filed, record the order (which starts the
// appeal clock from the date of communication), close with how it ended — a
// lost or partly allowed matter asks whether to appeal, and opens the appeal
// as its own matter — reopen with a reason, and edit the details or the demand
// with where the figures come from. Closing is a primary action, not a red one.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffList } from '@/hooks/useStaffList';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtFy, fmtInr, noticeTitle } from '@/lib/noticeFormat';
import {
  addMonths, changeMatterStage, editDemand, editMatterDetails, forumKey, FORUMS, LIFECYCLES, MATTER_OUTCOMES, recordOrder, recordReply,
  reopenMatter, startAppeal, type DemandHeads, type MatterWorkspace,
} from '@/lib/litigationData';

type Common = { open: boolean; onOpenChange: (o: boolean) => void; ws: MatterWorkspace; onDone: () => void };
const HEADS = [['tax', 'Tax'], ['interest', 'Interest'], ['penalty', 'Penalty'], ['cess', 'Cess']] as const;

const Heads: React.FC<{ value: DemandHeads; onChange: (v: DemandHeads) => void; idPrefix: string; legend: string }> = ({ value, onChange, idPrefix, legend }) => (
  <fieldset className="space-y-1.5">
    <legend className="text-xs font-medium">{legend} <span className="font-normal text-muted-foreground">· total {fmtInr(value.tax + value.interest + value.penalty + value.cess)}</span></legend>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {HEADS.map(([k, label]) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${k}`} className="text-xs">{label} (₹)</Label>
          <NumberInput id={`${idPrefix}-${k}`} min={0} value={value[k] || ''} className="h-9"
            onChange={(e) => onChange({ ...value, [k]: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })} />
          {value[k] > 0 && <p className="text-[11px] text-muted-foreground">{fmtInr(value[k])}</p>}
        </div>
      ))}
    </div>
  </fieldset>
);

const headsOf = (m: MatterWorkspace['matter']): DemandHeads => ({
  tax: Number(m.demand_tax) || 0, interest: Number(m.demand_interest) || 0, penalty: Number(m.demand_penalty) || 0, cess: Number(m.demand_cess) || 0,
});

/** The appeal period for an order of this forum (s.107 from the adjudicating authority, s.112 from the Appellate Authority). */
export function appealPeriod(forum: string, rules: Map<string, number>): { months: number | null; condonation: number | null; to: string } {
  if (forum === 'adjudicating') return { months: rules.get('appeal_months.s107') ?? 3, condonation: rules.get('appeal_condonation.s107') ?? 1, to: 'the Appellate Authority (s.107)' };
  if (forum === 'appellate') return { months: rules.get('appeal_months.s112') ?? 3, condonation: rules.get('appeal_condonation.s112') ?? 3, to: 'the Tribunal (s.112)' };
  return { months: null, condonation: null, to: 'the next forum' };
}

export const RecordReplyDialog: React.FC<Common> = ({ open, onOpenChange, ws, onDone }) => {
  const { user } = useAuth();
  const [date, setDate] = useState(istToday());
  const [arn, setArn] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const replied = ws.notices.filter((n) => n.reply_date).sort((a, b) => (b.reply_date ?? '').localeCompare(a.reply_date ?? ''))[0];
    setDate(replied?.reply_date ?? istToday());
    setArn(replied?.submission_arn ?? replied?.reply_ref_number ?? '');
  }, [open, ws.notices]);
  const save = async () => {
    if (!user || !date) return;
    setSaving(true);
    try { await recordReply(ws.matter, { date, arn: arn.trim() || null }, user); toast.success('Reply recorded — the matter is at Filed'); onOpenChange(false); onDone(); }
    catch (e) { toast.error(`Couldn't record the reply: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record the reply filed</DialogTitle>
          <DialogDescription>{ws.matter.matter_no} · {ws.client?.name}. The matter moves to Filed.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="rr-date" className="text-xs">Filed on <span className="text-destructive">*</span></Label>
            <Input id="rr-date" type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-arn" className="text-xs">ARN or reference</Label>
            <Input id="rr-arn" value={arn} onChange={(e) => setArn(e.target.value)} className="h-9 font-mono" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Log the reply on each notice too (its workspace) so the notice's own clock is met.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !date || date > istToday()}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Record reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const RecordOrderDialog: React.FC<Common> = ({ open, onOpenChange, ws, onDone }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const forum = forumKey(m);
  const period = appealPeriod(forum, ws.rules);
  const [num, setNum] = useState('');
  const [date, setDate] = useState(istToday());
  const [served, setServed] = useState('');
  const [heads, setHeads] = useState<DemandHeads>(headsOf(m));
  const [update, setUpdate] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const order = ws.notices.filter((n) => n.order_date).sort((a, b) => (b.order_date ?? '').localeCompare(a.order_date ?? ''))[0];
    setNum(order?.order_number ?? '');
    setDate(order?.order_date ?? istToday());
    setServed('');
    setHeads(headsOf(m));
    setUpdate(true);
  }, [open, ws.notices, m]);
  const base = served || date;
  const limitation = period.months && base ? addMonths(base, period.months) : null;
  const outer = limitation && period.condonation ? addMonths(limitation, period.condonation) : null;
  const save = async () => {
    if (!user || !date) return;
    setSaving(true);
    try {
      await recordOrder(m, { number: num.trim() || null, date, servedOn: served || null, demand: update ? heads : null, months: period.months }, user);
      toast.success(limitation ? `Order recorded — appeal by ${fmtDate(limitation)}` : 'Order recorded');
      onOpenChange(false); onDone();
    } catch (e) { toast.error(`Couldn't record the order: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record the order</DialogTitle>
          <DialogDescription>{m.matter_no} · {ws.client?.name}. The matter moves to Order and the appeal clock starts.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ro-no" className="text-xs">Order no.</Label>
            <Input id="ro-no" value={num} onChange={(e) => setNum(e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ro-date" className="text-xs">Order dated <span className="text-destructive">*</span></Label>
            <Input id="ro-date" type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ro-served" className="text-xs">Received on</Label>
            <Input id="ro-served" type="date" value={served} min={date} max={istToday()} onChange={(e) => setServed(e.target.value)} className="h-9" />
          </div>
        </div>
        <label htmlFor="ro-update" className="flex items-center gap-2 text-xs">
          <Checkbox id="ro-update" checked={update} onCheckedChange={(v) => setUpdate(!!v)} /> Set the demand to the order's figures
        </label>
        {update && <Heads value={heads} onChange={setHeads} idPrefix="ro" legend="Demand confirmed by the order" />}
        {limitation ? (
          <Note tone="position" open>
            Appeal to {period.to} by <span className="font-semibold">{fmtDate(limitation)}</span> — {period.months} months from {served ? 'receipt' : 'the order date'}
            {outer ? `; with condonation up to ${fmtDate(outer)}` : ''}. The period runs from the date the order is communicated: enter it when it differs.
          </Note>
        ) : <Note tone="info">No appeal period is computed for an order of this forum — set the limitation on the matter.</Note>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !date || date > istToday()}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Record order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const CloseMatterDialog: React.FC<Common & { preset?: 'appeal' | null }> = ({ open, onOpenChange, ws, onDone, preset }) => {
  const { user } = useAuth();
  const { staff } = useStaffList();
  const navigate = useNavigate();
  const m = ws.matter;
  const nextForum: 'appellate' | 'tribunal' = forumKey(m) === 'appellate' ? 'tribunal' : 'appellate';
  const [outcome, setOutcome] = useState('');
  const [num, setNum] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [appeal, setAppeal] = useState<'yes' | 'no' | ''>('');
  const [title, setTitle] = useState('');
  const [limitation, setLimitation] = useState('');
  const [approver, setApprover] = useState('');
  const [saving, setSaving] = useState(false);
  const def = MATTER_OUTCOMES.find((o) => o.key === outcome);
  useEffect(() => {
    if (!open) return;
    const order = ws.notices.filter((n) => n.order_date).sort((a, b) => (b.order_date ?? '').localeCompare(a.order_date ?? ''))[0];
    setOutcome(preset === 'appeal' ? 'lost' : '');
    setNum(order?.order_number ?? '');
    setDate(order?.order_date ?? '');
    setNote('');
    setAppeal(preset === 'appeal' ? 'yes' : '');
    setTitle(`Appeal against ${order?.order_number ? `order ${order.order_number}` : 'the order'} — ${m.title ?? m.matter_no}`);
    setLimitation(m.limitation_date ?? (order?.order_date ? addMonths(order.order_date, 3) : ''));
    setApprover('');
  }, [open, preset, ws.notices, m]);

  const valid = !!outcome && (outcome !== 'other' || !!note.trim()) && (!def?.appealable || (appeal === 'yes' ? !!title.trim() : appeal === 'no' && !!approver));

  const save = async () => {
    if (!user || !valid) return;
    setSaving(true);
    try {
      let child: { id: string; matter_no: string } | null = null;
      if (def?.appealable && appeal === 'yes') child = await startAppeal(m, { title: title.trim(), forum: nextForum, limitation: limitation || null, ownerId: m.owner_user_id }, user);
      const approverName = staff.find((s) => s.userId === approver)?.name;
      const reason = [
        `${def?.label}${note.trim() ? ` — ${note.trim()}` : ''}`,
        num || date ? `order${num ? ` ${num}` : ''}${date ? ` dated ${fmtDate(date)}` : ''}` : '',
        child ? `appealed in ${child.matter_no}` : def?.appealable && approverName ? `not appealed, approved by ${approverName}` : '',
      ].filter(Boolean).join(' · ');
      await changeMatterStage(m, 'closed', user, { reason });
      onOpenChange(false);
      onDone();
      if (child) {
        toast.success(`Closed — appeal ${child.matter_no} opened`, { action: { label: 'Open', onClick: () => navigate(`/litigation/${child?.id}`) } });
      } else toast.success('Matter closed');
    } catch (e) { toast.error(`Couldn't close the matter: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{preset === 'appeal' ? 'Decide on the order' : 'Close the matter'}</DialogTitle>
          <DialogDescription>{m.matter_no} · {ws.client?.name}. Say how it ended; a closed matter can be reopened.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cm-outcome" className="text-xs">How it ended <span className="text-destructive">*</span></Label>
            <Select value={outcome} onValueChange={(v) => { setOutcome(v); if (!MATTER_OUTCOMES.find((o) => o.key === v)?.appealable) setAppeal(''); }}>
              <SelectTrigger id="cm-outcome" className="h-9 text-sm"><SelectValue placeholder="Pick the outcome" /></SelectTrigger>
              <SelectContent>{MATTER_OUTCOMES.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cm-no" className="text-xs">Order or closing reference</Label>
              <Input id="cm-no" value={num} onChange={(e) => setNum(e.target.value)} className="h-9 font-mono" placeholder="e.g. DRC-07, ASMT-12, APL-04 no." />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cm-date" className="text-xs">Dated</Label>
              <Input id="cm-date" type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cm-note" className="text-xs">Note{outcome === 'other' && <span className="text-destructive"> *</span>}</Label>
            <Textarea id="cm-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="text-sm" placeholder="e.g. demand dropped on reply; DRC-03 AD… paid" />
          </div>
          {def?.appealable && (
            <fieldset className="space-y-2 rounded-md border p-2">
              <legend className="px-1 text-xs font-medium">Appeal? <span className="text-destructive">*</span></legend>
              <RadioGroup value={appeal} onValueChange={(v) => setAppeal(v as 'yes' | 'no')} className="space-y-1">
                <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="yes" /> Yes — open the appeal before {nextForum === 'tribunal' ? 'the Tribunal' : 'the Appellate Authority'} as a matter now</Label>
                <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="no" /> No — the order is accepted</Label>
              </RadioGroup>
              {appeal === 'yes' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="cm-title" className="text-xs">Appeal matter title</Label>
                    <Input id="cm-title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cm-lim" className="text-xs">File by</Label>
                    <Input id="cm-lim" type="date" value={limitation} onChange={(e) => setLimitation(e.target.value)} className="h-9" />
                  </div>
                  <p className="text-[11px] text-muted-foreground sm:col-span-3">It carries this matter's demand, client and team; record the pre-deposit on it when paid.</p>
                </div>
              )}
              {appeal === 'no' && (
                <div className="space-y-1">
                  <Label htmlFor="cm-approver" className="text-xs">Decision approved by <span className="text-destructive">*</span></Label>
                  <Select value={approver} onValueChange={setApprover}>
                    <SelectTrigger id="cm-approver" className="h-9 text-sm"><SelectValue placeholder="Partner or GST manager" /></SelectTrigger>
                    <SelectContent>{staff.map((s) => <SelectItem key={s.userId} value={s.userId}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </fieldset>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {def?.appealable && appeal === 'yes' ? 'Close and open the appeal' : 'Close matter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const ReopenDialog: React.FC<Common> = ({ open, onOpenChange, ws, onDone }) => {
  const { user } = useAuth();
  const [why, setWhy] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setWhy(''); }, [open]);
  const save = async () => {
    if (!user || !why.trim()) return;
    setSaving(true);
    try {
      const { error } = await reopenMatter(ws.matter.id, user.id, user.firstName, why.trim());
      if (error) throw error;
      toast.success('Reopened at Triaged'); onOpenChange(false); onDone();
    } catch (e) { toast.error(`Couldn't reopen: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen {ws.matter.matter_no}?</DialogTitle>
          <DialogDescription>It goes back to Triaged and counts as open again in every list and report.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="rm-why" className="text-xs">Why <span className="text-destructive">*</span></Label>
          <Textarea id="rm-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} className="text-sm" placeholder="e.g. Rectification order received; demand revived" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !why.trim()}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Reopen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const EditMatterDialog: React.FC<Common> = ({ open, onOpenChange, ws, onDone }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const [v, setV] = useState({ title: '', lifecycle: 'demand', authority: 'adjudicating', officer: '', jurisdiction: '', section: '', fys: '', due: '', override: '', limitation: '', next: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setV({
      title: m.title ?? '', lifecycle: m.lifecycle, authority: forumKey(m), officer: m.officer ?? '', jurisdiction: m.jurisdiction ?? '',
      section: m.section_of_law ?? '', fys: (m.financial_years ?? []).join(', '), due: m.computed_due_date ?? '', override: m.override_due_date ?? '',
      limitation: m.limitation_date ?? '', next: m.next_action ?? '',
    });
  }, [open, m]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!user || !v.title.trim()) return;
    setSaving(true);
    try {
      await editMatterDetails(m, {
        title: v.title.trim(), lifecycle: v.lifecycle, authority: v.authority, officer: v.officer.trim() || null, jurisdiction: v.jurisdiction.trim() || null,
        section_of_law: v.section.trim() || null, financial_years: v.fys.split(/[,;]/).map((s) => fmtFy(s.trim())).filter(Boolean),
        computed_due_date: v.due || null, override_due_date: v.override || null, limitation_date: v.limitation || null, next_action: v.next.trim() || null,
      }, user);
      toast.success('Saved'); onOpenChange(false); onDone();
    } catch (e) { toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };
  const field = (id: string, label: string, k: keyof typeof v, type = 'text', span = '') => (
    <div className={`space-y-1 ${span}`}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type={type} value={v[k]} onChange={set(k)} className="h-9" />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {m.matter_no}</DialogTitle>
          <DialogDescription>Every change is logged with the old and new value.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('em-title', 'Title', 'title', 'text', 'sm:col-span-2')}
          <div className="space-y-1">
            <Label htmlFor="em-type" className="text-xs">Type</Label>
            <Select value={v.lifecycle} onValueChange={(x) => setV((s) => ({ ...s, lifecycle: x }))}>
              <SelectTrigger id="em-type" className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!LIFECYCLES.some((l) => l.key === v.lifecycle) && <SelectItem value={v.lifecycle}>{v.lifecycle.replace(/_/g, ' ')}</SelectItem>}
                {LIFECYCLES.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-forum" className="text-xs">Forum</Label>
            <Select value={v.authority} onValueChange={(x) => setV((s) => ({ ...s, authority: x }))}>
              <SelectTrigger id="em-forum" className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{FORUMS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {field('em-officer', 'Officer and designation', 'officer')}
          {field('em-jur', 'Jurisdiction', 'jurisdiction')}
          {field('em-section', 'Section of law', 'section')}
          {field('em-fy', 'Financial years', 'fys')}
          {field('em-due', 'Reply due', 'due', 'date')}
          {field('em-override', 'Other due date (submissions, documents)', 'override', 'date')}
          {field('em-lim', 'Appeal limitation', 'limitation', 'date')}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="em-next" className="text-xs">Next action</Label>
            <Textarea id="em-next" rows={2} value={v.next} onChange={set('next')} className="text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !v.title.trim()}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SOURCES = ['Show cause notice', 'Order (DRC-07)', 'Appeal order (APL-04)', 'Rectification order', 'Client working', 'Other'];

export const EditDemandDialog: React.FC<Common> = ({ open, onOpenChange, ws, onDone }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const [heads, setHeads] = useState<DemandHeads>(headsOf(m));
  const [source, setSource] = useState(SOURCES[0]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const fromNotices = useMemo(() => ws.notices.filter((n) => Number(n.amount_of_demand) > 0), [ws.notices]);
  useEffect(() => {
    if (!open) return;
    setHeads(headsOf(m));
    setSource(ws.notices.some((n) => n.order_date) ? SOURCES[1] : SOURCES[0]);
    setReason('');
  }, [open, m, ws.notices]);
  const before = headsOf(m);
  const total = (h: DemandHeads) => h.tax + h.interest + h.penalty + h.cess;
  const changed = HEADS.some(([k]) => heads[k] !== before[k]);
  const save = async () => {
    if (!user || !changed) return;
    setSaving(true);
    try { await editDemand(m, heads, source, reason.trim() || null, user); toast.success('Demand saved'); onOpenChange(false); onDone(); }
    catch (e) { toast.error(`Couldn't save the demand: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Demand · {m.matter_no}</DialogTitle>
          <DialogDescription>Now {fmtInr(total(before))}. Take the figures from the notice or the order, by head.</DialogDescription>
        </DialogHeader>
        {fromNotices.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fromNotices.map((n) => (
              <Button key={n.id} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setHeads({ tax: Number(n.amount_of_demand), interest: 0, penalty: 0, cess: 0 })}>
                Use {noticeTitle(n, { fy: false })}: {fmtInr(n.amount_of_demand)}
              </Button>
            ))}
          </div>
        )}
        <Heads value={heads} onChange={setHeads} idPrefix="ed" legend="Demand by head" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ed-source" className="text-xs">Figures from</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="ed-source" className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed-reason" className="text-xs">Reason for the change</Label>
            <Input id="ed-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" placeholder="e.g. SCN para 12 split" />
          </div>
        </div>
        {changed && <p className="text-xs text-muted-foreground">{fmtInr(total(before))} → <span className="font-semibold text-foreground">{fmtInr(total(heads))}</span></p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !changed}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save demand</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
