// The officer's mobile and e-mail beside the officer's name, as links (tap to
// call, to WhatsApp, to write), with "Add mobile" / edit for staff. The book is
// one per firm (notice_officers): a number saved on one case shows on every
// case of the same officer.
import React, { useState } from 'react';
import { Mail, MessageCircle, Pencil, Phone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { isOfficerName, officerKey, useOfficers, useSaveOfficer, type Officer } from '@/lib/noticeOfficers';

const waLink = (mobile: string) => {
  const d = mobile.replace(/\D/g, '');
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
};

export const OfficerForm: React.FC<{ name: string; officer?: Officer; onDone: () => void }> = ({ name, officer, onDone }) => {
  const { user } = useAuth();
  const save = useSaveOfficer();
  const [mobile, setMobile] = useState(officer?.mobile ?? '');
  const [email, setEmail] = useState(officer?.email ?? '');
  const [office, setOffice] = useState(officer?.office ?? '');
  const [notes, setNotes] = useState(officer?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await save({ name, mobile, email, office, notes, actor: user?.firstName ?? null });
      toast.success('Saved for every case of this officer.');
      onDone();
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="text-xs font-semibold">{name}</div>
      <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile, e.g. 98250 12345" inputMode="tel" aria-label="Mobile" className="h-8 text-sm" autoFocus />
      <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (optional)" type="email" aria-label="E-mail" className="h-8 text-sm" />
      <Input value={office} onChange={(e) => setOffice(e.target.value)} placeholder="Office or ward (optional)" aria-label="Office" className="h-8 text-sm" />
      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note, e.g. best after 3 pm" aria-label="Note" className="h-8 text-sm" />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy || !mobile.trim()}>Save</Button>
      </div>
    </form>
  );
};

export const OfficerContact: React.FC<{ name: string | null | undefined; canEdit?: boolean }> = ({ name, canEdit = true }) => {
  const officers = useOfficers();
  const [open, setOpen] = useState(false);
  if (!name || !isOfficerName(name)) return null;
  const o = officers.data?.get(officerKey(name) ?? '');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-xs">
      {o?.mobile && (
        <>
          <a href={`tel:${o.mobile.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Phone className="h-3 w-3" aria-hidden />{o.mobile}</a>
          <a href={waLink(o.mobile)} target="_blank" rel="noreferrer" className="inline-flex items-center text-success hover:underline" title="WhatsApp"><MessageCircle className="h-3.5 w-3.5" aria-label="WhatsApp" /></a>
        </>
      )}
      {o?.email && <a href={`mailto:${o.email}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Mail className="h-3 w-3" aria-hidden />{o.email}</a>}
      {o?.office && <span className="text-muted-foreground">{o.office}</span>}
      {o?.notes && <span className="text-muted-foreground">· {o.notes}</span>}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary">
              {o ? <><Pencil className="h-3 w-3" aria-hidden /><span className="sr-only">Edit contact</span></> : <><Plus className="h-3 w-3" aria-hidden />Add mobile</>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3">
            {open && <OfficerForm name={name} officer={o} onDone={() => setOpen(false)} />}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

export default OfficerContact;
