import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Download, Loader2, Mail, Paperclip } from 'lucide-react';
import { prettyPeriod } from '@/lib/gstReminders';
import { formatINR } from '@/utils/builderRates';
import {
  billsWorkbookName, buildBillsWorkbook, isEmailList, lastBillsMail, loadBillsNotInBooks, sendBillsNotInBooks, summariseBills,
  type BillNotInBooks, type LastSent,
} from '@/lib/billsNotInBooksMail';

/**
 * Import 2B: one button that e-mails the client its bills not in books, the
 * list attached as an Excel working paper (src/lib/billsNotInBooksMail.ts).
 * The pop-up shows who it goes to and what it says, with the recipient filled
 * from the client's e-mail; Send queues it and sends it at once.
 */
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

const EmailBillsNotInBooksDialog: React.FC<{
  clientId: string; clientName: string; clientGstin: string; periodMonth: string;
  blockedReason?: string | null; triggerClassName?: string;
}> = ({ clientId, clientName, clientGstin, periodMonth, blockedReason, triggerClassName }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [rows, setRows] = useState<BillNotInBooks[]>([]);
  const [duplicates, setDuplicates] = useState<BillNotInBooks[]>([]);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [replyBy, setReplyBy] = useState(plusDays(5));
  const [last, setLast] = useState<LastSent | null>(null);

  const staffName = user?.firstName || '';
  const sum = summariseBills(rows);

  const start = async () => {
    if (blockedReason) { toast.error(blockedReason); return; }
    setLoading(true);
    try {
      const [bills, clientRes, lastRes] = await Promise.all([
        loadBillsNotInBooks(clientId, periodMonth),
        supabase.from('clients').select('email').eq('id', clientId).maybeSingle(),
        lastBillsMail(clientId, periodMonth),
      ]);
      if (bills.rows.length === 0) {
        toast.info(`No bills not in books for ${clientName}, ${prettyPeriod(periodMonth)}: nothing to send.`);
        return;
      }
      setRows(bills.rows);
      setDuplicates(bills.duplicates);
      setTo(clientRes.data?.email || '');
      setCc('');
      setReplyBy(plusDays(5));
      setLast(lastRes);
      setOpen(true);
    } catch (e: any) {
      toast.error('Could not load the bills not in books: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    try {
      const bytes = await buildBillsWorkbook({ clientName, gstin: clientGstin, periodMonth, rows, preparedBy: staffName || 'GST Team', replyBy: longDate(replyBy) });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = billsWorkbookName(clientName, periodMonth);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e: any) {
      toast.error('Could not build the Excel: ' + (e?.message || e));
    }
  };

  const send = async () => {
    if (!isEmailList(to)) { toast.error('Enter the client\'s e-mail address (several can be separated by commas).'); return; }
    if (cc.trim() && !isEmailList(cc)) { toast.error('The CC address is not valid.'); return; }
    setSending(true);
    try {
      const res = await sendBillsNotInBooks({
        clientId, clientName, gstin: clientGstin, periodMonth, to, cc, replyBy: longDate(replyBy), rows,
        staffName: staffName || 'GST Team', userId: user?.id ?? null,
      });
      if (res.ok) {
        toast.success(`Sent to ${to.trim()}: ${sum.count} bill${sum.count === 1 ? '' : 's'} not in books, Excel attached.`);
        setOpen(false);
      } else if (res.status === 'pending' || res.status === 'sending') {
        toast.warning('Queued, but not sent yet: it goes out with the next send run. ' + (res.error || ''));
        setOpen(false);
      } else {
        toast.error('Not sent: ' + (res.error || res.status));
      }
    } catch (e: any) {
      toast.error('Not sent: ' + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const fileName = billsWorkbookName(clientName, periodMonth);
  const months = sum.months.length > 1 ? `${sum.months[0]} to ${sum.months[sum.months.length - 1]}` : sum.months[0] || '';

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={triggerClassName}
        onClick={() => void start()}
        disabled={loading || !clientId || !periodMonth}
        title={blockedReason || 'E-mail the client its bills not in books, with the list attached as Excel'}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
        Email bills not in books
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (!sending) setOpen(v); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email bills not in books to {clientName}</DialogTitle>
            <DialogDescription>
              {sum.count} document{sum.count === 1 ? '' : 's'} in GSTR-2B not recorded in the client's books ({months}),
              tax ₹{formatINR(sum.tax)}. The full list goes as an Excel attachment, from gst@vjdesai.com.
            </DialogDescription>
          </DialogHeader>

          {last && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Last {last.status === 'sent' ? 'sent' : `attempt (${last.status})`} {when(last.at)} to {last.to}{last.by ? ` by ${last.by}` : ''}.
            </p>
          )}
          {duplicates.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              {duplicates.length} ledger row{duplicates.length === 1 ? ' repeats' : 's repeat'} a document already listed (same supplier, number and
              figures, a day apart): each is sent once. Clean the repeats on 2B Reconciliation ({duplicates.slice(0, 3).map((d) => d.docNo).join(', ')}{duplicates.length > 3 ? ', …' : ''}).
            </p>
          )}
          {sum.unposted > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              Includes {sum.unposted} document{sum.unposted === 1 ? '' : 's'} marked Not in Books this month but not yet posted to Reconciliation.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="bnib-to">To</Label>
              <Input id="bnib-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
              {!to.trim() && <p className="text-[11px] text-destructive">The client has no e-mail on record: type it here (and add it in Edit Client).</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="bnib-cc">CC (optional)</Label>
              <Input id="bnib-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="accounts@client.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bnib-reply">Reply requested by</Label>
              <Input id="bnib-reply" type="date" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
              <span className="font-medium">By supplier</span>
              <span className="flex items-center gap-1 text-muted-foreground"><Paperclip className="h-3 w-3" />{fileName}</span>
            </div>
            <ul className="max-h-48 divide-y overflow-y-auto text-xs">
              {sum.bySupplier.map((s) => (
                <li key={s.gstin || s.name} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{s.name || s.gstin} <span className="text-muted-foreground">{s.gstin}</span></span>
                  <span className="shrink-0 tabular-nums">{s.count} · ₹{formatINR(s.tax)}</span>
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => void download()} disabled={sending}>
              <Download className="h-3.5 w-3.5" />Download the Excel
            </Button>
            <Button type="button" size="sm" onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {sending ? 'Sending…' : 'Send email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EmailBillsNotInBooksDialog;
