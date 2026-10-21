import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Paperclip } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL, WS_FILTER_LABEL } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { arnProblem, attachManual, isPullOnly, manualPdfPath } from '@/lib/filingPull';
import { readFiledPdf, type ReadFiledPdf } from '@/lib/filedPdfCheck';
import type { ManualSourceAllowance } from '@/lib/manualSourceAllowances';

export interface ManualAttachTarget {
  clientId: string;
  clientName: string;
  gstin: string;
  returnType: string;
  periodMonth: string;
  /** The ARN the row already holds (a pull without a PDF): the PDF must show it. */
  arn: string | null;
  /** The superadmin's allowance, for a return that is pulled only. */
  allowance: ManualSourceAllowance | null;
  allowedByName?: string;
}

/**
 * Attach a filed return by hand: the PDF is read in the browser (the same
 * checker the extension uses), its ARN and ARN date fill the form, and it is
 * attached only when it is that return showing that ARN. For a return that is
 * pulled only this needs the superadmin's allowance, which it uses up.
 */
const ManualAttachDialog: React.FC<{
  target: ManualAttachTarget | null;
  userId: string | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ target, userId, onClose, onDone }) => {
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState<ReadFiledPdf | null>(null);
  const [reading, setReading] = useState(false);
  const [arn, setArn] = useState('');
  const [filedDate, setFiledDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFile(null); setRead(null); setReading(false); setBusy(false);
    setArn(target?.arn || ''); setFiledDate('');
  }, [target?.clientId, target?.returnType, target?.periodMonth, target?.arn]);

  if (!target) return null;

  const onFile = async (f: File | null) => {
    setFile(f); setRead(null);
    if (!f) return;
    setReading(true);
    try {
      const r = await readFiledPdf(f);
      setRead(r);
      if (!target.arn && r.arn) setArn(r.arn);
      if (r.arnDate) setFiledDate(r.arnDate);
    } catch (e) {
      toast.error('Could not read the PDF: ' + ((e as Error)?.message || e));
    } finally {
      setReading(false);
    }
  };

  const arnUpper = arn.trim().toUpperCase();
  const problem = arnUpper ? arnProblem(target.gstin, target.returnType, target.periodMonth, arnUpper) : null;
  const check = read && !read.problem && arnUpper ? read.check({ arn: arnUpper, returnType: target.returnType }) : null;
  const sameArn = !target.arn || target.arn === arnUpper;
  // A return with no pull yet (ITC-04's PDFs are often scans) may be attached
  // when its PDF has no text to check; one that is pulled only may not.
  const unreadable = !!read?.problem && read.problem !== 'This file is not a PDF.';
  const lenient = unreadable && !isPullOnly(target.returnType);
  const canAttach = !!file && !!read && (!!check?.ok || lenient) && !!arnUpper && !problem && sameArn && !!filedDate && !!userId && !busy;

  const attach = async () => {
    if (!file || !userId) return;
    setBusy(true);
    try {
      const path = manualPdfPath(target.clientId, target.returnType, target.periodMonth, arnUpper);
      const { error: upErr } = await supabase.storage.from('return-pdfs').upload(path, file, { upsert: false, contentType: 'application/pdf' });
      if (upErr) throw new Error('The PDF could not be uploaded: ' + upErr.message);
      const { data: { publicUrl } } = supabase.storage.from('return-pdfs').getPublicUrl(path);
      const r = await attachManual({
        actorId: userId, clientId: target.clientId, returnType: target.returnType, periodMonth: target.periodMonth,
        arn: arnUpper, filedDate, pdfUrl: publicUrl,
      });
      toast.success(`${r.return_type} ${target.periodMonth} for ${target.clientName} is Filed, marked manual.`);
      // The confirmation e-mail was queued by the database; send it now.
      void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
      onDone();
    } catch (e) {
      toast.error((e as Error)?.message || String(e), { duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Attach the filed return</DialogTitle>
          <DialogDescription className="text-xs">
            {target.clientName} · {target.returnType} · {target.periodMonth}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {isPullOnly(target.returnType) ? (
            <Note tone="warn">
              {target.returnType} is normally pulled from the portal. The superadmin allowed one manual upload
              {target.allowedByName ? ` (${target.allowedByName})` : ''}: {target.allowance?.reason || 'no reason'}. It is used up when you attach,
              and the return shows as manual.
            </Note>
          ) : (
            <Note tone="info">
              {target.returnType} has no portal pull yet, so it is attached by hand. It shows as manual.
            </Note>
          )}

          <label className="block space-y-1">
            <span className={WS_FILTER_LABEL}>Filed return (PDF downloaded from the portal)</span>
            <Input type="file" accept=".pdf,application/pdf" className={WS_CONTROL} disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </label>
          {reading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the PDF…</div>}
          {read?.problem && (
            <p className={lenient ? 'text-xs text-amber-700 dark:text-amber-400' : 'text-xs text-destructive'}>
              {read.problem}{lenient ? ' It is attached unchecked: type the ARN and the date as shown on it.' : ''}
            </p>
          )}
          {read && !read.problem && (
            <p className="text-xs text-muted-foreground">Read from the PDF: {read.form || 'no title'}{read.arn ? ` · ARN ${read.arn}` : ''}{read.arnDate ? ` · ARN date ${read.arnDate}` : ''}</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={WS_FILTER_LABEL}>ARN</span>
              <Input value={arn} onChange={(e) => setArn(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15))}
                className={`${WS_CONTROL} font-mono`} disabled={busy || !!target.arn || !!read?.arn} placeholder="From the PDF" />
            </label>
            <label className="space-y-1">
              <span className={WS_FILTER_LABEL}>Filing date (date of ARN)</span>
              <Input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} className={WS_CONTROL}
                disabled={busy || !!read?.arnDate} />
            </label>
          </div>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
          {!sameArn && <p className="text-xs text-destructive">This return already holds ARN {target.arn}. The PDF must show that ARN.</p>}
          {check && !check.ok && !problem && <p className="text-xs text-destructive">{check.reason}</p>}
          {check?.ok && <p className="text-xs text-success">The PDF is the filed {target.returnType} and shows ARN {arnUpper}.</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-1">
          <Button variant="outline" size="sm" className={WS_BTN} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" className={WS_BTN} onClick={attach} disabled={!canAttach}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            Attach and mark Filed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualAttachDialog;
