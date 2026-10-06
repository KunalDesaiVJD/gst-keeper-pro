// Ask the client for documents from the notice page (audit R-11, U-41-1;
// roadmap Phase 4 "Client document requests"). What the notice's coded issues
// need comes first — each such request serves its issue and is marked as from
// the catalogue (reply_issue_types.documents) — then what the notice PDF asks
// for and the usual items for the form; anything can be typed. The list is
// tracked per notice and e-mailed to the client (a preview while alerts are in
// preview). It replaced the older RequestDocumentsDialog.
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import {
  catalogueFor, docDueDefault, docEmailOutcome, emailDocumentRequests, issueTypesQuery, requestDocumentItems,
  type CatalogueItem, type DocItem, type DocRequest, type NoticeIssue,
} from '@/lib/noticeWorkspace';
import { istToday } from '@/lib/noticeFacts';
import { noticeTitle } from '@/lib/noticeFormat';
import type { NoticeRef } from '@/components/notices/actions/NoticeContext';

// What the firm usually needs, by form family (a start; staff edit freely).
const SUGGESTIONS: { match: RegExp; items: string[] }[] = [
  { match: /DRC-01C|2B|ITC/i, items: ['Purchase register for the period', 'GSTR-2B reconciliation working', 'Supplier invoices for the differences'] },
  { match: /DRC-01B|GSTR-1|liability/i, items: ['Sales register for the period', 'Credit / debit notes issued', 'GSTR-1 v 3B reconciliation working'] },
  { match: /ASMT-10|scrutiny/i, items: ['Sales and purchase registers for the year', 'Books of account (trial balance)', 'Reconciliation of returns with books'] },
  { match: /REG|registration/i, items: ['Proof of principal place of business', 'Rent agreement / ownership proof', 'Electricity bill of the premises'] },
  { match: /RFD|refund/i, items: ['Shipping bills / export invoices', 'BRC / FIRC', 'Statement 3 / 3A'] },
];
const GENERIC = ['Bank statement for the period', 'Ledger extracts', 'Invoices listed in the notice'];

type Picked = DocItem & { issueSeq?: number };
const key = (s: string) => s.trim().toLowerCase();

const Chip: React.FC<{ label: string; onAdd: () => void }> = ({ label, onAdd }) => (
  <button type="button" onClick={onAdd}
    className="rounded-full border border-dashed px-2 py-0.5 text-left text-[11px] text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    + {label}
  </button>
);

export const AskClientDialog: React.FC<{
  notice: NoticeRef;
  clientEmail: string | null;
  issues: NoticeIssue[];
  requests: DocRequest[];
  /** Documents the notice PDF itself asks for (the AI reader's list). */
  noticeAsks?: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ notice, clientEmail, issues, requests, noticeAsks = [], open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const types = useQuery({ ...issueTypesQuery, enabled: open });
  const [items, setItems] = useState<Picked[]>([]);
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState(docDueDefault(notice.effective_due));
  const [email, setEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems([]); setDraft(''); setDue(docDueDefault(notice.effective_due)); setEmail(!!clientEmail);
  }, [open, clientEmail, notice.effective_due]);

  const taken = useMemo(() => new Set([...requests.map((r) => key(r.item)), ...items.map((i) => key(i.item))]), [requests, items]);
  const catalogue = useMemo(() => catalogueFor(issues, types.data ?? [], [...taken]), [issues, types.data, taken]);
  const byIssue = useMemo(() => {
    const m = new Map<string, CatalogueItem[]>();
    catalogue.forEach((c) => m.set(c.issueId, [...(m.get(c.issueId) ?? []), c]));
    return [...m.values()];
  }, [catalogue]);
  const hay = `${notice.form_code ?? ''} ${notice.form_label ?? ''} ${notice.notice_type ?? ''} ${notice.description ?? ''}`;
  const asks = noticeAsks.filter((s) => !taken.has(key(s)));
  const usual = [...(SUGGESTIONS.find((s) => s.match.test(hay))?.items ?? []), ...GENERIC].filter((s) => !taken.has(key(s)));

  const add = (d: Picked) => { const t = d.item.trim(); if (t && !taken.has(key(t))) setItems((xs) => [...xs, { ...d, item: t }]); };
  const addTyped = () => { add({ item: draft, source: 'manual' }); setDraft(''); };
  const fromCatalogue = (c: CatalogueItem): Picked => ({ item: c.item, issue_id: c.issueId, source: 'catalogue', issueSeq: c.issueSeq });

  const save = async () => {
    if (!user || items.length === 0) return;
    setSaving(true);
    try {
      await requestDocumentItems(notice.id, items, due || null, user);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask the client · {notice.client_name}</DialogTitle>
          <DialogDescription>{notice.reference_number || notice.case_id || 'No reference'} · {noticeTitle(notice)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {byIssue.length > 0 && (
            <section className="space-y-1.5 rounded-md border px-2.5 py-2" aria-labelledby="ask-catalogue">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="ask-catalogue" className="text-xs font-semibold">What the issues need</h3>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => catalogue.forEach((c) => add(fromCatalogue(c)))}>
                  Add all {catalogue.length}
                </Button>
              </div>
              {byIssue.map((group) => (
                <div key={group[0].issueId} className="space-y-1">
                  <p className="break-words text-[11px] text-foreground/80">Issue {group[0].issueSeq} · {group[0].issueTitle}</p>
                  <div className="flex flex-wrap gap-1">
                    {group.map((c) => <Chip key={c.item} label={c.item} onAdd={() => add(fromCatalogue(c))} />)}
                  </div>
                </div>
              ))}
            </section>
          )}

          <div className="space-y-1">
            <Label htmlFor="ask-doc-item" className="text-xs">Documents needed</Label>
            <div className="flex gap-2">
              <Input id="ask-doc-item" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a document and press Enter"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} className="h-9" />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Add document" onClick={addTyped}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {items.length > 0 && (
              <ul className="space-y-1 pt-1">
                {items.map((it) => (
                  <li key={it.item} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                    <span className="min-w-0 break-words">{it.item}{it.issueSeq ? <span className="text-muted-foreground"> · for issue {it.issueSeq}</span> : null}</span>
                    <button type="button" className="shrink-0 rounded p-0.5 hover:bg-muted" aria-label={`Remove ${it.item}`}
                      onClick={() => setItems((xs) => xs.filter((x) => x.item !== it.item))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {asks.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[11px] text-foreground/80">Asked in the notice</p>
                <div className="flex flex-wrap gap-1">{asks.map((s) => <Chip key={s} label={s} onAdd={() => add({ item: s, source: 'manual' })} />)}</div>
              </div>
            )}
            {usual.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[11px] text-foreground/80">Usual for this form</p>
                <div className="flex flex-wrap gap-1">{usual.slice(0, 6).map((s) => <Chip key={s} label={s} onAdd={() => add({ item: s, source: 'manual' })} />)}</div>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ask-doc-due" className="text-xs">Needed by</Label>
              <Input id="ask-doc-due" type="date" value={due} min={istToday()} onChange={(e) => setDue(e.target.value)} className="h-9" />
            </div>
            <Label className="flex items-start gap-2 pt-5 text-xs font-normal">
              <Checkbox checked={email && !!clientEmail} disabled={!clientEmail} onCheckedChange={(v) => setEmail(!!v)} className="mt-0.5" />
              <span>E-mail the client now{clientEmail ? <> at <span className="break-all font-mono">{clientEmail}</span></> : ' (no e-mail on file — add it in Edit Client)'}</span>
            </Label>
          </div>
          <Note tone="info">The notice moves to Waiting on client. The client sees the list in the client portal and can upload there; each item is marked received or waived on the Documents tab.</Note>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={items.length === 0 || saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Request {items.length || ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AskClientDialog;
