// Add notice (audit U-05-1…5): log a notice or order the portal sync has not
// captured. The PDF comes first; the form (ASMT-10, DRC-01 …) sets the type,
// default priority and statutory reply window; owner, priority and FY are set
// here so the notice does not need two more edits; a reference or case ID
// already on record is caught while it is typed. Insert first, attach second,
// so a failed save never leaves an orphan file. Writes gst_notices with source
// 'notices' and a 'manual:' portal_key (the sync never marks it missing), then
// opens the new notice's workspace.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { matchStaffByName, useStaffList } from '@/hooks/useStaffList';
import { insertManualNotice } from '@/lib/noticeWrites';
import { fmtFy } from '@/lib/noticeFormat';
import { istToday } from '@/lib/noticeFacts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';

const OTHER = '__other__';
const NONE = '__none__';

interface FormChoice { form_code: string; label: string; default_priority: string | null; clock_basis: string | null }
interface ClientRow { id: string; name: string; gstin: string | null; assigned_accountant: string | null }
interface Duplicate { id: string; client_name: string; reference: string }

const EMPTY = {
  clientId: '', form: '', typeText: '', ref: '', caseId: '', issuedBy: '', issueDate: '', dueDate: '',
  fy: '', amount: '', priority: '', owner: '', description: '',
};
type FormState = typeof EMPTY;

/** The last six financial years, newest first ("2026-27"). */
function recentFys(): string[] {
  const t = istToday();
  const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < 4 ? 1 : 0);
  return Array.from({ length: 6 }, (_, i) => `${y - i}-${String((y - i + 1) % 100).padStart(2, '0')}`);
}

const Field: React.FC<{ id: string; label: string; required?: boolean; error?: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  id, label, required, error, hint, className, children,
}) => (
  <div className={cn('space-y-1', className)}>
    <Label htmlFor={id} className="text-xs">{label}{required && <span className="text-destructive"> *</span>}</Label>
    {children}
    {error ? <p id={`${id}-error`} className="text-[11px] text-destructive-strong">{error}</p>
      : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
  </div>
);

export const AddNoticeDialog: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { staff } = useStaffList();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<Duplicate | null>(null);
  const set = (k: keyof FormState) => (v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const clientsQ = useQuery({
    queryKey: ['add-notice-clients'], enabled: open, staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, gstin, assigned_accountant').order('name');
      if (error) throw error;
      return (data ?? []) as ClientRow[];
    },
  });
  const formsQ = useQuery({
    queryKey: ['notice-form-choices'], enabled: open, staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('notice_form_choices').select('form_code, label, default_priority, clock_basis').order('form_code');
      if (error) throw error;
      return (data ?? []) as FormChoice[];
    },
  });
  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data]);
  const forms = useMemo(() => formsQ.data ?? [], [formsQ.data]);
  const rule = forms.find((r) => r.form_code === f.form) ?? null;
  const fys = useMemo(recentFys, []);

  // The client's accountant owns it unless someone else is picked.
  useEffect(() => {
    if (!f.clientId || f.owner) return;
    const c = clients.find((x) => x.id === f.clientId);
    const m = matchStaffByName(staff, c?.assigned_accountant);
    if (m) setF((s) => ({ ...s, owner: m.userId }));
  }, [f.clientId, f.owner, clients, staff]);

  // A reference or case ID already on record is caught while it is typed.
  useEffect(() => {
    const ref = f.ref.trim();
    const caseId = f.caseId.trim();
    if (!open || (ref.length < 6 && caseId.length < 6)) { setDup(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const probes = [ref, caseId].filter((v) => v.length >= 6);
      const results = await Promise.all(probes.flatMap((v) => [
        supabase.from('gst_notices').select('id, client_id, reference_number').eq('reference_number', v).is('deleted_at', null).limit(1),
        supabase.from('gst_notices').select('id, client_id, reference_number').eq('case_id', v).is('deleted_at', null).limit(1),
      ]));
      const hit = results.map((r) => r.data?.[0]).find(Boolean);
      if (!live) return;
      if (!hit) { setDup(null); return; }
      const name = clients.find((c) => c.id === hit.client_id)?.name ?? 'another client';
      setDup({ id: hit.id, client_name: name, reference: hit.reference_number ?? ref });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [f.ref, f.caseId, open, clients]);

  const reset = () => { setF(EMPTY); setFile(null); setErrors({}); setDup(null); };

  const pickFile = (fl: File | null | undefined) => {
    if (!fl) return;
    if (fl.type && fl.type !== 'application/pdf') { toast.error('Attach the notice as a PDF.'); return; }
    setFile(fl);
  };

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!f.clientId) e.clientId = 'Pick the client.';
    if (!f.form) e.form = 'Pick the form, or "Other".';
    if (f.form === OTHER && !f.typeText.trim()) e.typeText = 'Say what the notice is, as written on it.';
    if (!f.ref.trim()) e.ref = 'The reference number is on the notice.';
    if (!f.issueDate) e.issueDate = 'The date the notice was issued.';
    if (f.issueDate && f.issueDate > istToday()) e.issueDate = 'This date is in the future.';
    if (f.dueDate && f.issueDate && f.dueDate < f.issueDate) e.dueDate = 'The reply date is before the issue date.';
    if (f.amount.trim() && !Number.isFinite(Number(f.amount))) e.amount = 'Enter the amount in rupees.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate() || dup) return;
    setSaving(true);
    const owner = staff.find((s) => s.userId === f.owner) ?? null;
    const { id, error } = await insertManualNotice({
      client_id: f.clientId,
      source: 'notices',
      portal_key: `manual:${crypto.randomUUID()}`,
      reference_number: f.ref.trim(),
      case_id: f.caseId.trim() || null,
      // The form's own label: the classifier reads the form back from it.
      notice_type: f.form === OTHER ? f.typeText.trim() : rule?.label ?? f.form,
      issued_by: f.issuedBy.trim() || null,
      issue_date: f.issueDate,
      due_date: f.dueDate || null,
      financial_year: f.fy || null,
      amount_of_demand: f.amount.trim() ? Number(f.amount) : null,
      priority: f.priority || null,
      assign_to_user_id: owner?.userId ?? null,
      assign_to: owner?.name ?? null,
      stage: owner ? 'triaged' : 'new',
      description: f.description.trim() || null,
      pulled_at: new Date().toISOString(),
    }, user);
    if (error || !id) {
      setSaving(false);
      toast.error(`Couldn't add the notice: ${error?.message ?? 'no row returned'}`);
      return;
    }
    if (file) {
      const path = `manual/${f.clientId}/${id}/${file.name.replace(/[^\w.-]+/g, '_')}`;
      const up = await supabase.storage.from('return-pdfs').upload(path, file, { contentType: 'application/pdf' });
      if (up.error) {
        toast.warning(`Notice added, but the PDF did not upload (${up.error.message}). Upload it from the notice's Documents tab.`);
      } else {
        const pdfUrl = supabase.storage.from('return-pdfs').getPublicUrl(path).data.publicUrl;
        await supabase.from('gst_notices').update({ pdf_url: pdfUrl }).eq('id', id);
      }
    }
    setSaving(false);
    toast.success('Notice added');
    reset();
    setOpen(false);
    onSuccess();
    navigate(`/notices/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={WS_BTN}><Plus className="h-3.5 w-3.5" /> Add notice</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a notice</DialogTitle>
          <DialogDescription>Log a notice or order the portal sync has not captured. It opens in its own page once saved.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          <label
            htmlFor="add-notice-pdf"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]); }}
            className={cn('flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 text-sm focus-within:ring-2 focus-within:ring-ring',
              dragging ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}>
            <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              {file ? <span className="block truncate font-medium">{file.name}</span> : <span className="block font-medium">Drop the notice PDF here, or choose a file</span>}
              <span className="block text-xs text-muted-foreground">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · stored with the notice` : 'Optional — you can upload it later from the notice'}</span>
            </span>
            {file && (
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove the PDF"
                onClick={(e) => { e.preventDefault(); setFile(null); }}><X className="h-3.5 w-3.5" /></Button>
            )}
            <input id="add-notice-pdf" type="file" accept="application/pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="add-notice-client" label="Client (GSTIN)" required error={errors.clientId} className="sm:col-span-2">
              <SearchableSelect id="add-notice-client"
                options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin ?? undefined }))}
                value={f.clientId} onValueChange={set('clientId')}
                placeholder={clientsQ.isLoading ? 'Loading clients…' : 'Pick the client'} searchPlaceholder="Name or GSTIN…" />
            </Field>
            <Field id="add-notice-form" label="Form" required error={errors.form}
              hint={rule?.clock_basis ?? (f.form === OTHER ? 'Type below what the notice is.' : undefined)} className="sm:col-span-2">
              <Select value={f.form} onValueChange={set('form')}>
                <SelectTrigger id="add-notice-form" className="h-9 text-sm"><SelectValue placeholder={formsQ.isLoading ? 'Loading forms…' : 'ASMT-10, DRC-01, REG-17…'} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {forms.map((r) => <SelectItem key={r.form_code} value={r.form_code} className="text-sm">{r.label}</SelectItem>)}
                  <SelectItem value={OTHER} className="text-sm">Other — not in this list</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {f.form === OTHER && (
              <Field id="add-notice-type" label="What the notice is" required error={errors.typeText} className="sm:col-span-2">
                <Input id="add-notice-type" value={f.typeText} onChange={(e) => set('typeText')(e.target.value)} className="h-9" placeholder="As written on the notice" />
              </Field>
            )}
            <Field id="add-notice-ref" label="Reference no." required error={errors.ref}>
              <Input id="add-notice-ref" value={f.ref} onChange={(e) => set('ref')(e.target.value)} className="h-9 font-mono" autoComplete="off"
                aria-invalid={!!errors.ref} aria-describedby={errors.ref ? 'add-notice-ref-error' : undefined} />
            </Field>
            <Field id="add-notice-case" label="Case ID" hint="If the portal shows one">
              <Input id="add-notice-case" value={f.caseId} onChange={(e) => set('caseId')(e.target.value)} className="h-9 font-mono" autoComplete="off" />
            </Field>
            {dup && (
              <Note tone="warn" className="sm:col-span-2">
                {dup.reference} is already on record for {dup.client_name} —{' '}
                <Link to={`/notices/${dup.id}`} className="font-medium underline underline-offset-2" onClick={() => setOpen(false)}>open it</Link> instead.
              </Note>
            )}
            <Field id="add-notice-issued" label="Issued on" required error={errors.issueDate}>
              <Input id="add-notice-issued" type="date" max={istToday()} value={f.issueDate} onChange={(e) => set('issueDate')(e.target.value)} className="h-9" />
            </Field>
            <Field id="add-notice-due" label="Reply due" error={errors.dueDate} hint="Leave empty to use the form's statutory window">
              <Input id="add-notice-due" type="date" value={f.dueDate} onChange={(e) => set('dueDate')(e.target.value)} className="h-9" />
            </Field>
            <Field id="add-notice-by" label="Issued by">
              <Input id="add-notice-by" value={f.issuedBy} onChange={(e) => set('issuedBy')(e.target.value)} className="h-9" placeholder="Officer and office" />
            </Field>
            <Field id="add-notice-fy" label="Financial year">
              <Select value={f.fy || NONE} onValueChange={(v) => set('fy')(v === NONE ? '' : v)}>
                <SelectTrigger id="add-notice-fy" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-sm">Not stated</SelectItem>
                  {fys.map((y) => <SelectItem key={y} value={y} className="text-sm">{fmtFy(y)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field id="add-notice-amount" label="Demand (₹)" error={errors.amount}>
              <NumberInput id="add-notice-amount" inputMode="decimal" value={f.amount} onChange={(e) => set('amount')(e.target.value)} className="h-9" placeholder="0" />
            </Field>
            <Field id="add-notice-priority" label="Priority">
              <Select value={f.priority || NONE} onValueChange={(v) => set('priority')(v === NONE ? '' : v)}>
                <SelectTrigger id="add-notice-priority" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-sm">{rule?.default_priority ? `The form's default (${rule.default_priority})` : 'Not set'}</SelectItem>
                  {['High', 'Medium', 'Low'].map((p) => <SelectItem key={p} value={p} className="text-sm">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field id="add-notice-owner" label="Owner" className="sm:col-span-2" hint={f.owner ? undefined : 'Nobody yet — it goes to the unassigned list'}>
              <Select value={f.owner || NONE} onValueChange={(v) => set('owner')(v === NONE ? '' : v)}>
                <SelectTrigger id="add-notice-owner" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE} className="text-sm">Unassigned</SelectItem>
                  {staff.map((s) => <SelectItem key={s.userId} value={s.userId} className="text-sm">{s.name}{s.userId === user?.id ? ' (me)' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field id="add-notice-desc" label="What it is about" className="sm:col-span-2">
              <Textarea id="add-notice-desc" rows={3} value={f.description} onChange={(e) => set('description')(e.target.value)} className="text-sm"
                placeholder="e.g. ITC in GSTR-3B exceeds GSTR-2B for FY 2023-24" />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !!dup}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? 'Saving…' : 'Add notice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddNoticeDialog;
