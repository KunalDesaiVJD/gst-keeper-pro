import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { docEmailOutcome, emailDocumentRequests, requestDocuments } from '@/lib/noticeWorkspace';
import { addDays, istToday } from '@/lib/noticeFacts';
import { noticeTitle } from '@/lib/noticeFormat';
import type { NoticeRef } from './NoticeContext';

// What the firm usually needs, by form family (a start; staff edit freely).
const SUGGESTIONS: { match: RegExp; items: string[] }[] = [
  { match: /DRC-01C|2B|ITC/i, items: ['Purchase register for the period', 'GSTR-2B reconciliation working', 'Supplier invoices for the differences'] },
  { match: /DRC-01B|GSTR-1|liability/i, items: ['Sales register for the period', 'Credit / debit notes issued', 'GSTR-1 v 3B reconciliation working'] },
  { match: /ASMT-10|scrutiny/i, items: ['Sales and purchase registers for the year', 'Books of account (trial balance)', 'Reconciliation of returns with books'] },
  { match: /REG|registration/i, items: ['Proof of principal place of business', 'Rent agreement / ownership proof', 'Electricity bill of the premises'] },
  { match: /RFD|refund/i, items: ['Shipping bills / export invoices', 'BRC / FIRC', 'Statement 3 / 3A'] },
];
const GENERIC = ['Bank statement for the period', 'Ledger extracts', 'Invoices listed in the notice'];

/**
 * Ask the client for documents (audit R-11, U-41-1): a tracked list per notice,
 * e-mailed to the client (a preview while alerts are in preview). The notice
 * moves to Waiting on client; when every item is in or waived, back to Evidence.
 */
export const RequestDocumentsDialog: React.FC<{
  notice: NoticeRef;
  clientEmail: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ notice, clientEmail, open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState(addDays(istToday(), 5));
  const [email, setEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems([]); setDraft(''); setDue(addDays(istToday(), 5)); setEmail(!!clientEmail);
  }, [open, clientEmail]);

  const hay = `${notice.form_code ?? ''} ${notice.form_label ?? ''} ${notice.notice_type ?? ''} ${notice.description ?? ''}`;
  const suggestions = [...(SUGGESTIONS.find((s) => s.match.test(hay))?.items ?? []), ...GENERIC].filter((s) => !items.includes(s));
  const add = (v: string) => { const t = v.trim(); if (t && !items.includes(t)) setItems((xs) => [...xs, t]); };

  const save = async () => {
    if (!user || items.length === 0) return;
    setSaving(true);
    try {
      await requestDocuments(notice.id, items, due || null, user);
      if (email && clientEmail) {
        const o = docEmailOutcome(await emailDocumentRequests(notice.id, user), 'request');
        toast[o.tone](o.text);
      } else toast.success(`${items.length} document${items.length === 1 ? '' : 's'} requested.`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(`Couldn't save the request: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask the client · {notice.client_name}</DialogTitle>
          <DialogDescription>{notice.reference_number || notice.case_id || 'No reference'} · {noticeTitle(notice)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="doc-item" className="text-xs">Documents needed</Label>
            <div className="flex gap-2">
              <Input id="doc-item" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a document and press Enter"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); setDraft(''); } }} className="h-9" />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Add document" onClick={() => { add(draft); setDraft(''); }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {items.length > 0 && (
              <ul className="space-y-1 pt-1">
                {items.map((it) => (
                  <li key={it} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                    <span>{it}</span>
                    <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${it}`} onClick={() => setItems((xs) => xs.filter((x) => x !== it))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {suggestions.slice(0, 6).map((s) => (
                  <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
                    + {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="doc-due" className="text-xs">Needed by</Label>
              <Input id="doc-due" type="date" value={due} min={istToday()} onChange={(e) => setDue(e.target.value)} className="h-9" />
            </div>
            <Label className="flex items-start gap-2 pt-5 text-xs font-normal">
              <Checkbox checked={email && !!clientEmail} disabled={!clientEmail} onCheckedChange={(v) => setEmail(!!v)} className="mt-0.5" />
              <span>E-mail the client now{clientEmail ? <> at <span className="font-mono">{clientEmail}</span></> : ' (no e-mail on file — add it in Edit Client)'}</span>
            </Label>
          </div>
          <Note tone="info">The notice moves to Waiting on client. Each item can be marked received or waived on the Documents tab; reminders re-send only what is still open.</Note>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={items.length === 0 || saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Request {items.length || ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestDocumentsDialog;
