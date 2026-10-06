// One document the firm asked a client for, as the client sees it in the
// client portal (roadmap Phase 4 "Client document requests"; audit R-11, R-25):
// what is asked, for which notice, by when (overdue said in words), and an
// upload — a file of up to 20 MB (PDF, photos and scans, Excel, Word or zip)
// with an optional note. Plain words; built for a phone first.
import React, { useId, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fmtDate } from '@/lib/noticeFormat';
import { UPLOAD_ACCEPT, neededByWords, uploadClientDocument, uploadProblem, type ClientDocRequest } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const sizeWords = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const ClientDocRequestCard: React.FC<{
  r: ClientDocRequest;
  client: { id: string; name: string };
  onUploaded: () => void;
}> = ({ r, client, onUploaded }) => {
  const uid = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const due = neededByWords(r.due_date);

  const pick = (f: File | null) => {
    setFile(f);
    setProblem(f ? uploadProblem(f) : null);
  };
  const send = async () => {
    if (!file || problem) return;
    setSending(true);
    try {
      const res = await uploadClientDocument(r, file, note, client);
      if (res === 'gone') toast.info('This request was closed by the firm in the meantime, so nothing more is needed for it. Thank you.');
      else if (res === 'no_document') toast.error('The file could not be attached. Please try again.');
      else toast.success(`Thank you — we have received "${file.name}".`);
      setFile(null);
      setNote('');
      if (input.current) input.current.value = '';
      onUploaded();
    } catch (e) {
      toast.error(`The upload did not go through: ${e instanceof Error ? e.message : String(e)} Please try again.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <li className={cn('space-y-3 rounded-lg border bg-card p-4 shadow-sm', due.overdue && 'border-destructive/50')}>
      <div className="space-y-1">
        <h3 className="break-words text-base font-semibold leading-snug">{r.item}</h3>
        <p className="text-sm text-foreground/80">
          For: {r.notice_label ?? 'a notice'}{r.reference_number && <> · <span className="break-all font-mono text-xs">{r.reference_number}</span></>}
        </p>
        {r.issue_title && <p className="text-sm text-foreground/80">About: {r.issue_title}</p>}
        <p className={cn('flex items-center gap-1.5 text-sm font-medium', due.overdue ? 'text-destructive-strong' : due.soon ? 'text-foreground' : 'text-foreground/80')}>
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden /> {due.text}
        </p>
      </div>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="space-y-1">
          <Label htmlFor={`${uid}-file`} className="text-sm">Choose the file</Label>
          <input ref={input} id={`${uid}-file`} type="file" accept={UPLOAD_ACCEPT} disabled={sending}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            aria-describedby={`${uid}-hint${problem ? ` ${uid}-problem` : ''}`}
            className="block w-full max-w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted" />
          <p id={`${uid}-hint`} className="text-xs text-muted-foreground">PDF, a photo or scan, Excel, Word or a zip file — up to 20 MB.</p>
          {file && !problem && <p className="flex items-center gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" aria-hidden /> {file.name} · {sizeWords(file.size)}</p>}
          {problem && <p id={`${uid}-problem`} className="text-xs font-medium text-destructive-strong" role="alert">{problem}</p>}
        </div>
        {file && !problem && (
          <div className="space-y-1">
            <Label htmlFor={`${uid}-note`} className="text-sm">Add a note for your CA team <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} disabled={sending}
              placeholder="For example: pages 3 to 7 are the March statements" className="text-sm" />
          </div>
        )}
        <Button type="submit" className="h-10 w-full gap-2 sm:w-auto" disabled={!file || !!problem || sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {sending ? 'Uploading…' : 'Upload'}<span className="sr-only"> {r.item}</span>
        </Button>
      </form>
    </li>
  );
};

/** A request the firm has received (in the last 30 days). */
export const ClientDocReceived: React.FC<{ r: ClientDocRequest }> = ({ r }) => {
  const on = r.client_uploaded_at ?? r.resolved_at;
  const day = on ? new Date(on).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null;
  return (
    <li className="flex items-start gap-2.5 rounded-lg border bg-card p-3">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-strong" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="break-words text-sm font-medium">{r.item}</p>
        <p className="text-sm text-foreground/80">Received on {fmtDate(day)}{r.client_uploaded_at ? ' · you uploaded it here' : ' · sent to the firm'}</p>
        <p className="text-xs text-muted-foreground">
          For: {r.notice_label ?? 'a notice'}{r.reference_number && <> · <span className="break-all font-mono">{r.reference_number}</span></>}
        </p>
      </div>
    </li>
  );
};

export default ClientDocRequestCard;
