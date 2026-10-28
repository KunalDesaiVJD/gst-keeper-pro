// Engagement letters on Reply Factory → Client consent (the firm's request of
// 28 October 2026; src/lib/engagementLetters.ts, docs/ENGAGEMENT_LETTERS.md):
// the letter's template (a GST Manager or the superadmin reads it, fills the
// firm's details and publishes it; a published version is never changed, a
// save starts the next version), the dialog that sends it to the clients
// picked (one letter each, to the e-mail on file or a typed address for one
// client), each client's letter as a chip in the list, and the letter's record:
// every step with its time, network address and browser, the signature, the
// consents, resend, withdraw, and the signed PDF with its certificate.
import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, FilePenLine, Loader2, Mail, Plus, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { ToneBadge } from '@/components/notices/autopilot/parts';
import { SectionCard } from '@/components/notices/ui/Panel';
import { useAuth } from '@/contexts/AuthContext';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import {
  downloadLetterPdf, EVENT_LABEL, FIRM_FIELDS, istDateTime, latestByClient, LETTER_STATE, letterState, PLACEHOLDERS, publishTemplate,
  resendLetter, revokeLetter, saveTemplate, SERVICE_OPTIONS, sendLetters, useEngagementLetters, useLetterAudit, useLetterTemplates,
  type EngagementLetter, type LetterClause, type LetterFirm, type LetterTemplate,
} from '@/lib/engagementLetters';
import type { ConsentClient } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const useActor = () => {
  const { user } = useAuth();
  return user ? { id: user.id, name: user.firstName || user.email || 'Staff' } : null;
};
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['engagement-letters'] });
  qc.invalidateQueries({ queryKey: ['engagement-letter-templates'] });
  qc.invalidateQueries({ queryKey: ['engagement-letter-audit'] });
  qc.invalidateQueries({ queryKey: ['reply-factory', 'consent-clients'] });
};

/** A client's latest letter in a word, for the list. */
export const LetterChip: React.FC<{ letter: EngagementLetter | undefined; onClick?: () => void }> = ({ letter, onClick }) => {
  if (!letter) return <span className="text-xs text-muted-foreground">Not sent</span>;
  const st = LETTER_STATE[letterState(letter)];
  const when = letter.signed_at ?? letter.sent_at ?? letter.created_at;
  return (
    <button type="button" onClick={onClick} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Open the letter's record">
      <ToneBadge tone={st.tone}>{st.label} {fmtDate(when)}</ToneBadge>
    </button>
  );
};

/** The card at the top of Client consent: the template's state, the counts, the buttons. */
export const EngagementLetterCard: React.FC<{ clients: ConsentClient[]; canEdit: boolean; onEditTemplate: () => void; onSend: () => void }> = ({ clients, canEdit, onEditTemplate, onSend }) => {
  const t = useLetterTemplates();
  const l = useEngagementLetters();
  const published = (t.data ?? []).find((x) => x.status === 'published');
  const draft = (t.data ?? []).find((x) => x.status === 'draft');
  const latest = latestByClient(l.data);
  const states = clients.map((c) => (latest.get(c.id) ? letterState(latest.get(c.id)!) : 'none'));
  const n = (k: string) => states.filter((s) => s === k).length;
  const awaiting = states.filter((s) => ['sent', 'opened', 'read', 'changes'].includes(s)).length;
  return (
    <SectionCard title="Engagement letter"
      info="The client gets a short e-mail with the link to the letter: it opens the one page summary, each line opening its clause of the full letter. The client reads it in full and e-signs with a code e-mailed to them; signing is the consent to the whole letter, its personal data and technology clauses included, and records the AI consent on this page by itself. Every step is kept with its time, network address and browser. The letter covers the GST services, confidentiality and the Digital Personal Data Protection Act, 2023 (roles, consent, safeguards, retention, rights, grievances, breaches)."
      description={published ? `Version ${published.version} published ${fmtDate(published.published_at)}${published.published_by ? ` by ${published.published_by}` : ''}` : 'Not published yet'}
      actions={<div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={WS_BTN} onClick={onEditTemplate}><FilePenLine className="h-3.5 w-3.5" /> {canEdit ? 'Read and edit the letter' : 'Read the letter'}</Button>
        {canEdit && <Button size="sm" className={WS_BTN} disabled={!published} onClick={onSend}><Send className="h-3.5 w-3.5" /> Send to clients</Button>}
      </div>}>
      {t.isLoading ? <Skeleton className="h-10 w-full" /> : (
        <div className="space-y-2">
          {!published && draft && (
            <Note tone="warn">
              Version {draft.version} is a draft{draft.note ? `: ${draft.note.trim().replace(/\.+$/, '')}` : ''}. {canEdit ? 'Read it, fill the firm\'s details and publish it to start sending.' : 'A GST Manager or the superadmin publishes it.'}
            </Note>
          )}
          {published && draft && <Note tone="info">Version {draft.version} is being drafted; letters go out as version {published.version} until it is published.</Note>}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span><strong className="tabular-nums">{n('signed')}</strong> signed</span>
            <span><strong className="tabular-nums">{awaiting}</strong> awaiting signature</span>
            {n('expired') > 0 && <span><strong className="tabular-nums">{n('expired')}</strong> link expired</span>}
            {n('failed') > 0 && <span className="text-destructive-strong"><strong className="tabular-nums">{n('failed')}</strong> not e-mailed</span>}
            <span className="text-muted-foreground"><strong className="tabular-nums">{n('none')}</strong> not sent</span>
          </p>
        </div>
      )}
    </SectionCard>
  );
};

/** The template: the firm's details and the clauses; save (a draft, or the next version) and publish. */
export const TemplateDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void }> = ({ open, onOpenChange }) => {
  const t = useLetterTemplates();
  const qc = useQueryClient();
  const actor = useActor();
  const { canManageNoticeAlerts } = useAuth();
  const canEdit = canManageNoticeAlerts();
  const base = useMemo(() => (t.data ?? []).find((x) => x.status === 'draft') ?? (t.data ?? []).find((x) => x.status === 'published') ?? (t.data ?? [])[0], [t.data]);
  const [form, setForm] = useState<Pick<LetterTemplate, 'version' | 'title' | 'intro' | 'clauses' | 'firm' | 'note'> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && base) setForm({ version: base.version, title: base.title, intro: base.intro, clauses: base.clauses, firm: base.firm ?? {}, note: base.note }); }, [open, base]);
  if (!form || !base) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify({ version: base.version, title: base.title, intro: base.intro, clauses: base.clauses, firm: base.firm ?? {}, note: base.note });
  const setFirm = (k: keyof LetterFirm, v: string) => setForm({ ...form, firm: { ...form.firm, [k]: v } });
  const setClause = (i: number, patch: Partial<LetterClause>) => setForm({ ...form, clauses: form.clauses.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const move = (i: number, d: -1 | 1) => {
    const c = [...form.clauses];
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    setForm({ ...form, clauses: c });
  };
  const missing = FIRM_FIELDS.filter((f) => f.required && !String(form.firm[f.key] ?? '').trim());
  const save = async (): Promise<number | null> => {
    if (!actor) return null;
    setBusy(true);
    try {
      const r = await saveTemplate(form, actor);
      toast.success(r.new ? `Saved as version ${r.version}, a draft.` : `Version ${r.version} saved.`);
      invalidate(qc);
      return r.version;
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); return null; } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!actor) return;
    const v = dirty || base.status !== 'draft' ? await save() : base.version;
    if (!v) return;
    setBusy(true);
    try { await publishTemplate(v, actor); toast.success(`Version ${v} published: letters now go out as it.`); invalidate(qc); onOpenChange(false); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Engagement letter · version {base.version} ({base.status})</DialogTitle>
          <DialogDescription>
            {base.status === 'draft' ? 'A draft: change it freely, then publish it.' : 'Published versions are never changed: saving starts the next version as a draft.'}
            {' '}Placeholders in double braces are filled for each client when a letter is made.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">The firm's details</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {FIRM_FIELDS.map((f) => (
                <div key={f.key} className={cn('space-y-1', f.key === 'address' && 'sm:col-span-2')}>
                  <Label className="text-xs">{f.label}{f.required ? '' : ' (optional)'}</Label>
                  <Input value={String(form.firm[f.key] ?? '')} onChange={(e) => setFirm(f.key, e.target.value)} className="h-8 text-sm" />
                  {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
            {missing.length > 0 && <p className="text-xs text-warning">To publish, fill: {missing.map((f) => f.label).join(', ')}.</p>}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Title and opening</h3>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-8 text-sm" />
            <Textarea value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} rows={5} className="text-sm" />
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Clauses ({form.clauses.length})</h3>
            <p className="text-xs text-muted-foreground">
              Each clause has its line for the one page summary. Placeholders: {PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(', ')}. A line starting with "• " is a list item.
            </p>
            {form.clauses.map((c, i) => (
              <div key={`${c.key}-${i}`} className="space-y-1.5 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 text-sm font-semibold text-muted-foreground">{i + 1}.</span>
                  <Input value={c.heading} onChange={(e) => setClause(i, { heading: e.target.value })} className="h-8 flex-1 text-sm font-semibold" aria-label={`Clause ${i + 1} heading`} />
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remove the clause"
                    onClick={() => setForm({ ...form, clauses: form.clauses.filter((_, k) => k !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <Input value={c.summary} onChange={(e) => setClause(i, { summary: e.target.value })} className="h-8 text-xs" placeholder="Its line on the one page summary" aria-label={`Clause ${i + 1} summary`} />
                <Textarea value={c.text} onChange={(e) => setClause(i, { text: e.target.value })} rows={6} className="text-sm leading-relaxed" aria-label={`Clause ${i + 1} text`} />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className={WS_BTN}
              onClick={() => setForm({ ...form, clauses: [...form.clauses, { key: `clause_${Date.now()}`, heading: 'New clause', summary: '', text: '' }] })}>
              <Plus className="h-3.5 w-3.5" /> Add a clause
            </Button>
          </section>
          <section className="space-y-1">
            <Label className="text-xs">Note for the firm (not in the letter)</Label>
            <Input value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} className="h-8 text-sm" />
          </section>
        </fieldset>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {canEdit && <Button variant="outline" disabled={busy || !dirty} onClick={() => void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>}
          {canEdit && (base.status === 'draft' || dirty) && (
            <Button disabled={busy || missing.length > 0} onClick={() => void publish()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save and publish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Send the published letter to the clients picked. */
export const SendLetterDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; clients: ConsentClient[]; onDone: () => void }> = ({ open, onOpenChange, clients, onDone }) => {
  const qc = useQueryClient();
  const actor = useActor();
  const letters = useEngagementLetters();
  const latest = latestByClient(letters.data);
  const single = clients.length === 1 ? clients[0] : null;
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [services, setServices] = useState<string[]>(SERVICE_OPTIONS.slice(0, 3));
  const [extra, setExtra] = useState('');
  const [fees, setFees] = useState('');
  // The fees only where the published letter quotes them (version 2 has no fees clause).
  const templates = useLetterTemplates();
  const published = (templates.data ?? []).find((t) => t.status === 'published') ?? null;
  const needsFees = !!published && JSON.stringify([published.intro, published.clauses]).includes('{{fees}}');
  const [start, setStart] = useState(istToday());
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTo(single?.email ?? ''); setCc(''); setReplace(false); } }, [open, single]);
  const open_ = clients.filter((c) => { const l = latest.get(c.id); return !!l && ['sent', 'opened', 'read', 'changes', 'ready', 'failed'].includes(letterState(l)); });
  const noEmail = clients.filter((c) => !c.email?.trim());
  const allServices = [...services, ...extra.split('\n').map((s) => s.trim()).filter(Boolean)];
  const send = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      const r = await sendLetters({ clientIds: clients.map((c) => c.id), to: single ? to : null, cc, services: allServices, fees: needsFees ? fees : '', startDate: start, validDays: days, message, replace }, actor);
      if (r.sent.length) toast.success(`Engagement letter e-mailed to ${plural(r.sent.length, 'client')}.`);
      if (r.failed.length) toast.error(`The e-mail failed for ${r.failed.map((x) => x.name).join(', ')}. Resend it from its record.`);
      if (r.skipped.length) toast.warning(`Not sent: ${r.skipped.map((x) => `${x.name} (${x.why})`).join('; ')}`, { duration: 10_000 });
      invalidate(qc);
      onDone();
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send the engagement letter to {single ? single.name : plural(clients.length, 'client')}</DialogTitle>
          <DialogDescription>Each client gets its own letter and link. The e-mail carries only the link: it opens the letter's one page summary, whose lines open the full letter, where the client e-signs.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {single ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" required /></div>
              <div className="space-y-1"><Label className="text-xs">CC (optional)</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-9" placeholder="a@x.com, b@y.com" /></div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm">Each letter goes to the client's e-mail on file.{noEmail.length > 0 && <span className="text-destructive-strong"> {plural(noEmail.length, 'client')} without one will be left out: {noEmail.map((c) => c.name).join(', ')}.</span>}</p>
              <Label className="text-xs">CC on every letter (optional)</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-9" placeholder="a@x.com" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Services (clause 2)</Label>
            <div className="space-y-1.5 rounded-md border p-2.5">
              {SERVICE_OPTIONS.map((s) => (
                <label key={s} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={services.includes(s)} onCheckedChange={(v) => setServices((p) => (v ? [...p, s] : p.filter((x) => x !== s)))} className="mt-0.5" />
                  <span>{s}</span>
                </label>
              ))}
              <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} className="text-sm" placeholder="Any other service, one a line" />
            </div>
          </div>
          {needsFees && (
            <div className="space-y-1">
              <Label className="text-xs">Fees</Label>
              <Textarea value={fees} onChange={(e) => setFees(e.target.value)} rows={2} className="text-sm" required placeholder="e.g. Rs. 6,000 a month for returns and reconciliation; Rs. 15,000 for the annual return; appeals as agreed for each" />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Engagement starts on</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" /></div>
            <div className="space-y-1"><Label className="text-xs">Link valid for (days)</Label><Input type="number" min={3} max={90} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} className="h-9" /></div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">A line for the e-mail (optional)</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className="text-sm" />
          </div>
          {open_.length > 0 && (
            <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-sm">
              <Checkbox checked={replace} onCheckedChange={(v) => setReplace(!!v)} className="mt-0.5" />
              <span>{plural(open_.length, 'client')} already {open_.length === 1 ? 'has' : 'have'} a letter open ({open_.map((c) => c.name).join(', ')}). Withdraw {open_.length === 1 ? 'it' : 'them'} and send the new one; without this, {open_.length === 1 ? 'that client is' : 'they are'} left out.</span>
            </label>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || (needsFees && !fees.trim()) || allServices.length === 0 || (!!single && !to.trim())}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send {clients.length > 1 ? `${clients.length} letters` : 'the letter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** A letter's record: where it stands, every step, the signature, and what can be done. */
export const LetterDialog: React.FC<{ letter: EngagementLetter | null; onOpenChange: (o: boolean) => void; onSendNew: (clientId: string) => void }> = ({ letter, onOpenChange, onSendNew }) => {
  const qc = useQueryClient();
  const actor = useActor();
  const confirm = useConfirm();
  const { canManageNoticeAlerts } = useAuth();
  const canEdit = canManageNoticeAlerts();
  const audit = useLetterAudit(letter?.id ?? null, actor?.id);
  const [busy, setBusy] = useState(false);
  if (!letter) return null;
  const st = letterState(letter);
  const c = letter.consents ?? {};
  const resend = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      const ok = await resendLetter(letter.id, 30, actor);
      if (ok) toast.success('A new link is e-mailed; the earlier link stops working.');
      else toast.error('The e-mail failed. Check the address and try again.');
      invalidate(qc);
    }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!actor) return;
    const ok = await confirm({ title: 'Withdraw this letter?', description: 'Its link stops working. The record is kept. You can send a new letter after.', confirmText: 'Withdraw the letter', destructive: true });
    if (!ok) return;
    setBusy(true);
    try { await revokeLetter(letter.id, 'withdrawn by the firm', actor); toast.success('Letter withdrawn.'); invalidate(qc); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const pdf = () => downloadLetterPdf({
    ref: letter.id.replace(/-/g, '').slice(0, 8).toUpperCase(), title: letter.title, intro: letter.intro, clauses: letter.clauses, firm: letter.firm,
    version: letter.template_version, doc_sha256: letter.doc_sha256, client_name: letter.client_name, gstin: letter.client_gstin, to: letter.to_email,
    sent_at: letter.sent_at, signed_at: letter.signed_at, signer_name: letter.signer_name, signer_capacity: letter.signer_capacity, consents: letter.consents,
    ai_withdrawn_at: letter.ai_withdrawn_at, audit: audit.data ?? null,
  }).catch((e) => toast.error(`Could not make the PDF: ${e instanceof Error ? e.message : String(e)}`));
  const facts: [string, React.ReactNode][] = [
    ['Where it stands', <ToneBadge key="s" tone={LETTER_STATE[st].tone}>{LETTER_STATE[st].label}</ToneBadge>],
    ['Version', `${letter.template_version} · ref ${letter.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`],
    ['Sent to', `${letter.to_email}${letter.cc_email ? `, CC ${letter.cc_email}` : ''}`],
    ['Sent', letter.sent_at ? `${istDateTime(letter.sent_at)}${letter.sends > 1 ? ` (${letter.sends} e-mails)` : ''}` : letter.send_error ? `Failed: ${letter.send_error}` : 'Not yet'],
    ['Link valid until', istDateTime(letter.expires_at)],
    ['Summary opened', istDateTime(letter.first_opened_at) || 'Not yet'],
    ['Full letter opened', istDateTime(letter.full_opened_at) || 'Not yet'],
    ['Signed', letter.signed_at ? `${letter.signer_name} (${letter.signer_capacity}) at ${letter.signer_email}, ${istDateTime(letter.signed_at)}` : 'Not yet'],
    ['Consents', letter.signed_at ? `The whole letter, its personal data and technology clauses included${c.ai_processing === false || letter.ai_withdrawn_at ? ` · AI tools withdrawn${letter.ai_withdrawn_at ? ` ${istDateTime(letter.ai_withdrawn_at)}` : ''}` : ''}` : null],
    ['Changes asked', letter.decline_reason ? `${letter.decline_reason} (${istDateTime(letter.declined_at)})` : null],
    ['Signed copy', letter.copy_sent_at ? (letter.copy_error ? `Failed: ${letter.copy_error}` : `E-mailed ${istDateTime(letter.copy_sent_at)}`) : null],
    ['Withdrawn', letter.revoked_at ? `${istDateTime(letter.revoked_at)} by ${letter.revoked_by ?? 'staff'}${letter.revoke_reason ? `: ${letter.revoke_reason}` : ''}` : null],
    ['Fingerprint (SHA-256)', <span key="h" className="break-all font-mono text-xs">{letter.doc_sha256}</span>],
  ];
  return (
    <Dialog open={!!letter} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Engagement letter · {letter.client_name}</DialogTitle>
          <DialogDescription>{letter.client_gstin ? `GSTIN ${letter.client_gstin} · ` : ''}made {istDateTime(letter.created_at)} by {letter.created_by_name ?? 'staff'}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>
          ))}
        </dl>
        {audit.data?.signature?.drawn_png && (
          <div className="space-y-1"><div className="text-xs text-muted-foreground">Drawn signature</div>
            <img src={audit.data.signature.drawn_png} alt="The drawn signature" className="h-20 rounded border bg-white" /></div>
        )}
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold">Every step</h3>
          {audit.isLoading ? <Skeleton className="h-24 w-full" /> : audit.error ? <Note tone="warn">Couldn't load the record: {audit.error instanceof Error ? audit.error.message : String(audit.error)}</Note> : (
            <ol className="divide-y rounded-md border text-xs">
              {(audit.data?.events ?? []).map((e, i) => (
                <li key={i} className="grid gap-x-3 px-3 py-1.5 sm:grid-cols-[10rem_9rem_minmax(0,1fr)]">
                  <span className="tabular-nums text-muted-foreground">{istDateTime(e.at).replace(' IST', '')}</span>
                  <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}{e.actor ? ` · ${e.actor}` : ''}</span>
                  <span className="min-w-0 break-words text-muted-foreground">{[e.ip, e.user_agent].filter(Boolean).join(' · ')}{e.detail && (e.detail as Record<string, unknown>).reason ? ` · ${String((e.detail as Record<string, unknown>).reason)}` : ''}{e.detail && (e.detail as Record<string, unknown>).error ? ` · ${String((e.detail as Record<string, unknown>).error)}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" className={WS_BTN} onClick={() => void pdf()}><Download className="h-3.5 w-3.5" /> {letter.signed_at ? 'Signed letter (PDF)' : 'Letter (PDF)'}</Button>
          {canEdit && !['signed', 'revoked'].includes(letter.status) && (
            <>
              <Button variant="outline" className={WS_BTN} disabled={busy} onClick={() => void resend()}><RotateCcw className="h-3.5 w-3.5" /> E-mail a new link</Button>
              <Button variant="outline" className={cn(WS_BTN, 'text-destructive-strong')} disabled={busy} onClick={() => void revoke()}><Undo2 className="h-3.5 w-3.5" /> Withdraw</Button>
            </>
          )}
          {canEdit && letter.client_id && ['signed', 'revoked'].includes(letter.status) && (
            <Button variant="outline" className={WS_BTN} onClick={() => onSendNew(letter.client_id as string)}><Send className="h-3.5 w-3.5" /> Send a new letter</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
