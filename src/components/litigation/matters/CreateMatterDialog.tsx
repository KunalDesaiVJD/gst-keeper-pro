// Create a matter (audit U-82-1..4, U-95-1, U-95-3): from the client's notices
// by default — ticking them fills the title, type, forum, officer, financial
// years, demand, reply due and appeal limitation — or blank. The client is
// searchable, the client's open matters are listed to avoid duplicates, Create
// waits for a valid form, and the matter is saved through createMatter, so it
// opens with its "created" event and its notices linked.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffList } from '@/hooks/useStaffList';
import { supabase } from '@/integrations/supabase/client';
import { STAGES, stageIndex, stageLabel, type StageKey } from '@/lib/noticeStages';
import { fmtDate, fmtFy, fmtInr, noticeTitle } from '@/lib/noticeFormat';
import {
  addMonths, createMatter, fetchMatters, FORUMS, isMatterOpen, LIFECYCLES, lifecycleForForm, lifecycleLabel, linkNoticesToMatter,
  type LitigationMatter, type SuggestedMatter,
} from '@/lib/litigationData';
import { ClientPicker, type ClientOption } from './ClientPicker';

interface PickNotice {
  id: string; form_code: string | null; form_label: string | null; notice_type: string | null; description: string | null;
  reference_number: string | null; case_id: string | null; issue_date: string | null; effective_due: string | null;
  is_replied: boolean | null; amount_of_demand: number | null; financial_year: string | null; issued_by: string | null;
  order_date: string | null; stage: string | null;
}

type Field = 'title' | 'lifecycle' | 'authority' | 'officer' | 'fys' | 'tax' | 'due' | 'limitation';
const HEADS = [['tax', 'Tax'], ['interest', 'Interest'], ['penalty', 'Penalty'], ['cess', 'Cess']] as const;
type Head = (typeof HEADS)[number][0];

const forumFor = (lifecycle: string) => (lifecycle === 'appeal' ? 'appellate' : lifecycle === 'tribunal' ? 'tribunal' : 'adjudicating');

/** What the ticked notices say about the matter. */
function prefillFrom(list: PickNotice[]): Partial<Record<Field, string | number | null>> & { stage: StageKey } {
  const sorted = [...list].sort((a, b) => (a.issue_date ?? '').localeCompare(b.issue_date ?? ''));
  const latest = sorted[sorted.length - 1];
  const withAmount = [...sorted].reverse().find((n) => Number(n.amount_of_demand) > 0);
  const forms = [...new Set(sorted.map((n) => n.form_code).filter(Boolean))] as string[];
  const fys = [...new Set(sorted.map((n) => fmtFy(n.financial_year)).filter(Boolean))];
  const dues = sorted.filter((n) => !n.is_replied && n.effective_due).map((n) => n.effective_due as string).sort();
  const order = sorted.filter((n) => n.order_date).map((n) => n.order_date as string).sort().pop();
  const lifecycle = lifecycleForForm(`${forms.join(' ')} ${sorted.map((n) => `${n.notice_type ?? ''} ${n.description ?? ''}`).join(' ')}`);
  const top = sorted.filter((n) => n.stage !== 'closed').reduce((hi, n) => Math.max(hi, stageIndex(n.stage)), stageIndex('triaged'));
  return {
    title: sorted.length === 1 ? noticeTitle(latest) : `${forms.join(' / ') || noticeTitle(latest, { fy: false })}${fys.length ? ` · FY ${fys.join(', ')}` : ''}`,
    lifecycle,
    authority: forumFor(lifecycle),
    officer: latest?.issued_by ?? '',
    fys: fys.join(', '),
    tax: withAmount ? Number(withAmount.amount_of_demand) : null,
    due: dues[0] ?? '',
    limitation: order ? addMonths(order, 3) : '',
    stage: STAGES[top]?.key ?? 'triaged',
  };
}

export const CreateMatterDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clients: ClientOption[];
  defaultClientId?: string | null;
  suggestion?: SuggestedMatter | null;
  onCreated: () => void;
}> = ({ open, onOpenChange, clients, defaultClientId, suggestion, onCreated }) => {
  const { user } = useAuth();
  const { staff } = useStaffList();
  const navigate = useNavigate();
  const [clientId, setClientId] = useState<string | null>(null);
  const [mode, setMode] = useState<'notices' | 'blank'>('notices');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Set<Field>>(new Set());
  const [title, setTitle] = useState('');
  const [lifecycle, setLifecycle] = useState('demand');
  const [authority, setAuthority] = useState('adjudicating');
  const [jurisdiction, setJurisdiction] = useState('');
  const [officer, setOfficer] = useState('');
  const [section, setSection] = useState('');
  const [fys, setFys] = useState('');
  const [heads, setHeads] = useState<Record<Head, number | null>>({ tax: null, interest: null, penalty: null, cess: null });
  const [due, setDue] = useState('');
  const [limitation, setLimitation] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [owner, setOwner] = useState('');
  const [stage, setStage] = useState<StageKey>('triaged');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId(suggestion?.client_id ?? defaultClientId ?? null);
    setMode('notices');
    setPicked(new Set(suggestion?.notices.map((n) => n.id) ?? []));
    setEdited(new Set());
    setTitle(suggestion?.title ?? ''); setLifecycle(suggestion?.lifecycle ?? 'demand'); setAuthority(forumFor(suggestion?.lifecycle ?? 'demand'));
    setJurisdiction(''); setOfficer(''); setSection(''); setFys('');
    setHeads({ tax: null, interest: null, penalty: null, cess: null });
    setDue(''); setLimitation(''); setPriority('Medium'); setOwner(user?.id ?? ''); setStage('triaged'); setTouched(false);
  }, [open, suggestion, defaultClientId, user?.id]);

  const notices = useQuery({
    queryKey: ['matter-create-notices', clientId],
    enabled: open && !!clientId,
    queryFn: async (): Promise<PickNotice[]> => {
      const { data, error } = await supabase.from('notice_facts')
        .select('id, form_code, form_label, notice_type, description, reference_number, case_id, issue_date, effective_due, is_replied, amount_of_demand, financial_year, issued_by, order_date, stage')
        .eq('client_id', clientId as string).is('matter_id', null).eq('is_open', true).order('issue_date', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as PickNotice[];
    },
  });
  const openMatters = useQuery({
    queryKey: ['matter-create-open', clientId],
    enabled: open && !!clientId,
    queryFn: async (): Promise<LitigationMatter[]> => {
      const { data, error } = await fetchMatters({ clientId: clientId as string });
      if (error) throw error;
      return (data ?? []).filter(isMatterOpen);
    },
  });
  const list = useMemo(() => notices.data ?? [], [notices.data]);

  // Ticking notices fills what the user has not typed over.
  useEffect(() => {
    if (mode !== 'notices') return;
    const chosen = list.filter((n) => picked.has(n.id));
    if (!chosen.length) return;
    const p = prefillFrom(chosen);
    const keep = (f: Field) => !edited.has(f);
    if (keep('title') && p.title) setTitle(String(p.title));
    if (keep('lifecycle')) { setLifecycle(String(p.lifecycle)); if (keep('authority')) setAuthority(String(p.authority)); }
    if (keep('officer')) setOfficer(String(p.officer ?? ''));
    if (keep('fys')) setFys(String(p.fys ?? ''));
    if (keep('tax')) setHeads((h) => ({ ...h, tax: (p.tax as number | null) ?? h.tax }));
    if (keep('due')) setDue(String(p.due ?? ''));
    if (keep('limitation')) setLimitation(String(p.limitation ?? ''));
    setStage(p.stage);
  }, [picked, list, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (clientId && suggestion?.client_id !== clientId) setPicked(new Set()); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (f: Field) => setEdited((s) => new Set(s).add(f));
  const total = HEADS.reduce((s, [k]) => s + (heads[k] ?? 0), 0);
  const client = clients.find((c) => c.id === clientId);
  const errors = {
    client: !clientId ? 'Pick the client' : '',
    title: !title.trim() ? 'Give the matter a title' : '',
    amounts: HEADS.some(([k]) => (heads[k] ?? 0) < 0) ? 'Amounts cannot be negative' : '',
  };
  const valid = !errors.client && !errors.title && !errors.amounts;

  const save = async () => {
    setTouched(true);
    if (!valid || !user || !clientId) return;
    setSaving(true);
    try {
      const chosen = mode === 'notices' ? list.filter((n) => picked.has(n.id)) : [];
      const { data, error } = await createMatter({
        client_id: clientId, lifecycle, title: title.trim(), section_of_law: section.trim() || null,
        financial_years: fys.split(/[,;]/).map((s) => fmtFy(s.trim())).filter(Boolean),
        authority, jurisdiction: jurisdiction.trim() || null, officer: officer.trim() || null,
        stage: chosen.length ? stage : 'triaged', priority, owner_user_id: owner || null,
        demand_tax: heads.tax ?? 0, demand_interest: heads.interest ?? 0, demand_penalty: heads.penalty ?? 0, demand_cess: heads.cess ?? 0,
        computed_due_date: due || null, limitation_date: limitation || null,
      }, user.id, user.firstName);
      if (error || !data) throw error ?? new Error('The matter was not created');
      if (chosen.length) {
        const link = await linkNoticesToMatter(data.id, chosen.map((n) => n.id), user,
          chosen.map((n) => [n.form_code, n.reference_number || n.case_id].filter(Boolean).join(' ')));
        if (link.error) throw link.error;
      }
      toast.success(`Matter ${data.matter_no} created${chosen.length ? ` with ${chosen.length} notice${chosen.length === 1 ? '' : 's'}` : ''}`);
      onOpenChange(false);
      onCreated();
      navigate(`/litigation/${data.id}`);
    } catch (e) {
      toast.error(`Couldn't create the matter: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  const others = openMatters.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New litigation matter</DialogTitle>
          <DialogDescription>Start from the client's notices — they fill in the facts — or create a blank matter.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <span id="nm-client-label" className="text-xs font-medium">Client <span className="text-destructive">*</span></span>
            <ClientPicker variant="field" id="nm-client" labelId="nm-client-label" clients={clients} value={clientId} onChange={setClientId} allowClear={false}
              invalid={touched && !!errors.client} />
            {client?.gstin && <p className="font-mono text-[11px] text-muted-foreground">GSTIN {client.gstin}</p>}
            {touched && errors.client && <p className="text-xs text-destructive-strong">{errors.client}</p>}
            {others.length > 0 && (
              <Note tone="warn">
                {client?.name} already has {others.length} open matter{others.length === 1 ? '' : 's'}:{' '}
                {others.slice(0, 4).map((m, i) => (
                  <React.Fragment key={m.id}>{i > 0 && '; '}
                    <Link to={`/litigation/${m.id}`} className="underline underline-offset-2" onClick={() => onOpenChange(false)}>{m.matter_no}</Link> {m.title || lifecycleLabel(m.lifecycle)} ({stageLabel(m.stage)})
                  </React.Fragment>
                ))}. Add the notices to one of those instead if it is the same dispute.
              </Note>
            )}
          </div>

          {clientId && (
            <>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'notices' | 'blank')} className="flex flex-wrap gap-4" aria-label="How to start">
                <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="notices" /> From notices{notices.data ? ` (${list.length} not in a matter)` : ''}</Label>
                <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="blank" /> Blank matter</Label>
              </RadioGroup>
              {mode === 'notices' && (
                notices.isLoading ? <p className="text-xs text-muted-foreground">Loading the client's notices…</p>
                  : notices.error ? <Note tone="warn">Couldn't load the notices: {notices.error instanceof Error ? notices.error.message : String(notices.error)}</Note>
                  : list.length === 0 ? <p className="text-xs text-muted-foreground">Every open notice of this client is already in a matter. Create a blank matter instead.</p>
                  : (
                    <fieldset className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                      <legend className="sr-only">Notices to put in the matter</legend>
                      {list.map((n) => (
                        <label key={n.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
                          <Checkbox className="mt-0.5" checked={picked.has(n.id)}
                            onCheckedChange={(v) => setPicked((s) => { const x = new Set(s); if (v) x.add(n.id); else x.delete(n.id); return x; })} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{noticeTitle(n)}</span>
                            <span className="block text-muted-foreground">
                              <span className="font-mono">{n.reference_number || n.case_id || 'no reference'}</span>
                              {n.issue_date ? ` · issued ${fmtDate(n.issue_date)}` : ''}{n.effective_due && !n.is_replied ? ` · due ${fmtDate(n.effective_due)}` : ''}
                              {Number(n.amount_of_demand) > 0 ? ` · ${fmtInr(n.amount_of_demand)}` : ''}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="nm-title" className="text-xs">Title <span className="text-destructive">*</span></Label>
                  <Input id="nm-title" value={title} onChange={(e) => { setTitle(e.target.value); edit('title'); }} className="h-9"
                    placeholder="e.g. DRC-01 · ITC mismatch · FY 2022-23" aria-invalid={touched && !!errors.title} />
                  {touched && errors.title && <p className="text-xs text-destructive-strong">{errors.title}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-type" className="text-xs">Type</Label>
                  <Select value={lifecycle} onValueChange={(v) => { setLifecycle(v); edit('lifecycle'); if (!edited.has('authority')) setAuthority(forumFor(v)); }}>
                    <SelectTrigger id="nm-type" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIFECYCLES.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{LIFECYCLES.find((l) => l.key === lifecycle)?.hint}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-forum" className="text-xs">Forum</Label>
                  <Select value={authority} onValueChange={(v) => { setAuthority(v); edit('authority'); }}>
                    <SelectTrigger id="nm-forum" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{FORUMS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-officer" className="text-xs">Officer and designation</Label>
                  <Input id="nm-officer" value={officer} onChange={(e) => { setOfficer(e.target.value); edit('officer'); }} className="h-9" placeholder="e.g. Assistant Commissioner, Division-II" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-jur" className="text-xs">Jurisdiction</Label>
                  <Input id="nm-jur" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="h-9" placeholder="e.g. Centre · Surat CGST Commissionerate" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-section" className="text-xs">Section of law</Label>
                  <Input id="nm-section" value={section} onChange={(e) => setSection(e.target.value)} className="h-9" placeholder="e.g. s.73, s.74A" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-fy" className="text-xs">Financial years</Label>
                  <Input id="nm-fy" value={fys} onChange={(e) => { setFys(e.target.value); edit('fys'); }} className="h-9" placeholder="e.g. 2021-22, 2022-23" />
                </div>
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium">Demand by head (₹) <span className="font-normal text-muted-foreground">· total {fmtInr(total)}</span></legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {HEADS.map(([k, label]) => (
                    <div key={k} className="space-y-1">
                      <Label htmlFor={`nm-${k}`} className="text-xs">{label}</Label>
                      <NumberInput id={`nm-${k}`} min={0} value={heads[k] ?? ''} className="h-9"
                        onChange={(e) => { setHeads((h) => ({ ...h, [k]: e.target.value === '' ? null : Number(e.target.value) })); if (k === 'tax') edit('tax'); }} />
                      {(heads[k] ?? 0) > 0 && <p className="text-[11px] text-muted-foreground">{fmtInr(heads[k])}</p>}
                    </div>
                  ))}
                </div>
                {touched && errors.amounts && <p className="text-xs text-destructive-strong">{errors.amounts}</p>}
                {mode === 'notices' && picked.size > 0 && !edited.has('tax') && heads.tax ? (
                  <p className="text-[11px] text-muted-foreground">Filled from the notice's demand — split it into heads when you read the order.</p>
                ) : null}
              </fieldset>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="nm-due" className="text-xs">Reply due</Label>
                  <Input id="nm-due" type="date" value={due} onChange={(e) => { setDue(e.target.value); edit('due'); }} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-lim" className="text-xs">Appeal limitation</Label>
                  <Input id="nm-lim" type="date" value={limitation} onChange={(e) => { setLimitation(e.target.value); edit('limitation'); }} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-priority" className="text-xs">Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="nm-priority" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{['High', 'Medium', 'Low'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nm-owner" className="text-xs">Owner</Label>
                  <Select value={owner || 'none'} onValueChange={(v) => setOwner(v === 'none' ? '' : v)}>
                    <SelectTrigger id="nm-owner" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nobody yet</SelectItem>
                      {user && !staff.some((s) => s.userId === user.id) && <SelectItem value={user.id}>{user.firstName} (me)</SelectItem>}
                      {staff.map((s) => <SelectItem key={s.userId} value={s.userId}>{s.name}{s.userId === user?.id ? ' (me)' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {mode === 'notices' && picked.size > 0 && (
                <p className="text-xs text-muted-foreground">The matter starts at <span className="font-medium text-foreground">{stageLabel(stage)}</span>, where its notices are.</p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !valid}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create matter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateMatterDialog;
