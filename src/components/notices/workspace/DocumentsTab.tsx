// The notice's documents (audit R-11, R-25, U-41-*; roadmap Phase 4 "Client
// document requests"): what the client was asked for — from the issue codes'
// lists or typed, the issue each serves, age, reminders and what the client
// uploaded in the client portal — the notice and its case folder, and files
// uploaded here.
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, FolderOpen, ListChecks, Loader2, Mail, Paperclip, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import {
  catalogueFor, catalogueWhyNot, clientEmailSettingsQuery, docEmailOutcome, documentUrl, emailDocumentRequests, generateDocRequests,
  issueTypesQuery, reminderNote, resolveRequest, uploadDocument, type DocRequest, type FolderItem, type GenerateResult, type Workspace,
} from '@/lib/noticeWorkspace';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { fmtAgo, fmtDate, fmtDateTime, plural } from '@/lib/noticeFormat';

const SECTION: Record<string, string> = {
  INTIM: 'Intimations', NOTCE: 'Notices', REPLY: 'Replies', ORDRS: 'Orders', CLSR: 'Closure', CLOSR: 'Closure', CLOSURE: 'Closure',
  APLCN: 'Applications', NOTAC: 'Notice / acknowledgement', AUDIT: 'Audit history',
};
const ORDER = ['APLCN', 'NOTAC', 'INTIM', 'NOTCE', 'REPLY', 'ORDRS', 'CLSR', 'CLOSR', 'CLOSURE'];

/** A portal date (DD/MM/YYYY, DD-MM-YYYY or ISO) as YYYY-MM-DD. */
export function portalDateToIso(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  let m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** The date a folder item carries (filed / issued), from the portal's JSON. */
export function folderItemDate(it: FolderItem): string | null {
  const j = asObj(it.raw_json);
  const dec = asObj(j.decdtls);
  return portalDateToIso(dec.dt) ?? portalDateToIso(j.replydt) ?? portalDateToIso(j.refdt) ?? portalDateToIso(j.ntcdt)
    ?? portalDateToIso(j.intdt) ?? portalDateToIso(j.arndt) ?? null;
}

/** The reply the portal shows in this case's folder, to pre-fill "Log reply" (U-30-2). */
export function portalReplyFrom(folder: FolderItem[]): { date: string | null; ref: string | null } | null {
  const replies = folder.filter((f) => (f.folder_section || '').toUpperCase() === 'REPLY');
  if (!replies.length) return null;
  const latest = replies.map((r) => ({ r, d: folderItemDate(r) })).sort((a, b) => (b.d || '').localeCompare(a.d || ''))[0];
  const j = asObj(latest.r.raw_json);
  return { date: latest.d, ref: (typeof j.arn === 'string' && j.arn) || latest.r.reference_number || null };
}

const attachmentsOf = (it: FolderItem): { label: string; url: string }[] =>
  (Array.isArray(it.attachments) ? it.attachments : [])
    .map((a) => asObj(a))
    .filter((a) => typeof a.url === 'string')
    .map((a) => ({ label: String(a.label ?? 'Attachment'), url: String(a.url) }));

const KINDS = [
  { key: 'evidence', label: 'Evidence / working' },
  { key: 'client', label: 'From the client' },
  { key: 'reply', label: 'Reply filed' },
  { key: 'acknowledgement', label: 'Acknowledgement' },
  { key: 'order', label: 'Order' },
  { key: 'other', label: 'Other' },
];

/** The IST calendar date of a timestamp. */
const istDate = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const LINK = 'inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2';

/** One request: the issue it serves, where it came from, its age and reminders, and what the client uploaded. */
const RequestRow: React.FC<{
  r: DocRequest;
  ws: Workspace;
  canEdit: boolean;
  busy: boolean;
  onResolve: (status: 'received' | 'waived' | 'requested', note?: string, documentId?: string | null) => void;
}> = ({ r, ws, canEdit, busy, onResolve }) => {
  const seq = ws.issues.findIndex((i) => i.id === r.issue_id);
  const issue = seq >= 0 ? ws.issues[seq] : null;
  const doc = r.document_id ? ws.documents.find((d) => d.id === r.document_id) : null;
  const url = doc ? documentUrl(doc.storage_path) : null;
  const open = r.status === 'requested';
  const age = daysBetween(istDate(r.requested_at), istToday());
  const meta = [
    `asked ${fmtDate(istDate(r.requested_at))}${r.requested_by_name ? ` by ${r.requested_by_name}` : ''}`,
    r.due_date ? `needed by ${fmtDate(r.due_date)}` : '',
    open ? `open ${age} d` : '',
    r.reminders_sent ? `${plural(r.reminders_sent, 'reminder')}${r.last_reminded_at ? `, last ${fmtAgo(r.last_reminded_at)}` : ''}` : '',
    !open && r.resolved_by_name && !r.client_uploaded_at ? `${r.status === 'waived' ? 'waived' : 'received'} by ${r.resolved_by_name}` : '',
    r.note ?? '',
  ].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-wrap items-start gap-2 py-2 text-sm">
      <div className="min-w-0 flex-[1_1_14rem] space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words font-medium">{r.item}</span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal" title={r.source === 'catalogue' ? 'From the issue type\'s list of documents' : 'Typed or picked by staff'}>
            {r.source === 'catalogue' ? 'Catalogue' : 'Typed'}
          </Badge>
        </div>
        {issue && <p className="break-words text-xs text-muted-foreground">For issue {seq + 1} · {issue.title}</p>}
        <p className="break-words text-xs text-muted-foreground">{meta}</p>
        {r.client_uploaded_at && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Badge variant="success" className="px-1.5 py-0 text-[10px]">Uploaded by the client</Badge>
            <span>{fmtDateTime(r.client_uploaded_at)}</span>
            {r.client_note && <span className="break-words">· “{r.client_note}”</span>}
          </div>
        )}
        {url && <a href={url} target="_blank" rel="noreferrer" className={`${LINK} text-xs`}>{doc?.title ?? 'Open the file'} <ExternalLink className="h-3 w-3" aria-hidden /></a>}
      </div>
      <Badge variant={r.status === 'received' ? 'success' : r.status === 'waived' ? 'secondary' : 'warning'} className="text-[11px]">
        {r.status === 'received' ? 'Received' : r.status === 'waived' ? 'Waived' : 'Pending'}
      </Badge>
      {canEdit && (open ? (
        <span className="flex gap-1">
          <Popover>
            <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy}>Received<span className="sr-only">: {r.item}</span></Button></PopoverTrigger>
            <PopoverContent className="w-72 space-y-2 text-xs">
              <div className="font-medium">Mark "{r.item}" received</div>
              {ws.documents.length > 0 && (
                <Select onValueChange={(v) => onResolve('received', undefined, v === 'none' ? null : v)}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Link an uploaded file"><SelectValue placeholder="Link an uploaded file (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">No file to link</SelectItem>
                    {ws.documents.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" className="h-7 w-full text-xs" onClick={() => onResolve('received')}>Mark received</Button>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => onResolve('waived', 'Not needed')}>Waive<span className="sr-only">: {r.item}</span></Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => onResolve('requested')}>Re-open<span className="sr-only">: {r.item}</span></Button>
      ))}
    </li>
  );
};

export const DocumentsTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void; onAskClient: () => void }> = ({ ws, canEdit, onChanged, onAskClient }) => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState('evidence');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [gen, setGen] = useState<(GenerateResult & { why?: string }) | null>(null);
  const types = useQuery(issueTypesQuery);
  const mail = useQuery(clientEmailSettingsQuery);
  const n = ws.notice;
  const waiting = catalogueFor(ws.issues, types.data ?? [], ws.requests.map((r) => r.item)).length;

  const sections = new Map<string, FolderItem[]>();
  ws.folder.forEach((it) => {
    const code = (it.folder_section || 'OTHER').toUpperCase();
    sections.set(code, [...(sections.get(code) ?? []), it]);
  });
  const sectionKeys = [...sections.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

  const upload = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) await uploadDocument(n, f, kind, user);
      toast.success(files.length === 1 ? 'Uploaded' : `${files.length} files uploaded`);
      onChanged();
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const resolve = async (id: string, status: 'received' | 'waived' | 'requested', note?: string, documentId?: string | null) => {
    if (!user) return;
    setBusy(id);
    try { await resolveRequest(id, status, user, note ?? null, documentId); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const remind = async () => {
    if (!user) return;
    setBusy('remind');
    try {
      const o = docEmailOutcome(await emailDocumentRequests(n.id, user, true), 'reminder');
      toast[o.tone](o.text);
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const generate = async () => {
    if (!user) return;
    setBusy('generate');
    try {
      const why = catalogueWhyNot(ws.issues, types.data ?? []);
      const r = await generateDocRequests(n.id, user);
      if (r.error) throw new Error(r.error === 'gone' ? 'This notice is no longer on record.' : r.error);
      setGen(r.added ? r : { ...r, why });
      if (r.added) toast.success(`${plural(r.added, 'document')} asked of the client, needed by ${fmtDate(r.dueDate)}.`);
      if (r.added) onChanged();
    } catch (e) { toast.error(`Couldn't ask for the documents: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  const emailNow = async () => {
    if (!user) return;
    setBusy('email');
    try {
      const o = docEmailOutcome(await emailDocumentRequests(n.id, user), 'request');
      toast[o.tone](o.text);
      setGen(null);
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const open = ws.requests.filter((r) => r.status === 'requested');
  const reminderLine = ws.requests.length ? reminderNote(mail.data) : null;

  return (
    <div className="space-y-3">
      <SectionCard title="Client documents" description={ws.requests.length ? `${ws.requests.filter((r) => r.status === 'received').length} received · ${open.length} pending · ${ws.requests.filter((r) => r.status === 'waived').length} waived` : 'Nothing asked of the client yet'}
        actions={canEdit && <>
          {open.length > 0 && (
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy === 'remind'} onClick={remind}>
              {busy === 'remind' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Remind client ({open.length})
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy === 'generate'} onClick={generate}>
            {busy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ListChecks className="h-3.5 w-3.5" aria-hidden />}
            Ask for what the issues need{waiting ? ` (${waiting})` : ''}
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onAskClient}>Ask the client</Button>
        </>}>
        {gen && (
          <div role="status" className="flex flex-wrap items-start gap-2 rounded-md border border-info/40 bg-info/5 px-2.5 py-1.5 text-xs">
            <p className="min-w-0 flex-[1_1_14rem] break-words">
              {gen.added
                ? <>Asked for {plural(gen.added, 'document')}, needed by {fmtDate(gen.dueDate)}: {gen.items.join('; ')}. They are listed below; nothing was e-mailed yet{ws.client?.email ? '.' : ' — the client has no e-mail on file (add it in Edit Client).'}</>
                : <>Nothing added. {gen.why}</>}
            </p>
            <span className="flex items-center gap-1">
              {gen.added > 0 && ws.client?.email && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === 'email'} onClick={emailNow}>
                  {busy === 'email' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mail className="h-3.5 w-3.5" aria-hidden />} E-mail the client
                </Button>
              )}
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Dismiss" onClick={() => setGen(null)}><X className="h-3.5 w-3.5" /></Button>
            </span>
          </div>
        )}
        {ws.requests.length > 0 && (
          <ul className="divide-y">
            {ws.requests.map((r) => (
              <RequestRow key={r.id} r={r} ws={ws} canEdit={canEdit} busy={busy === r.id}
                onResolve={(status, note, documentId) => resolve(r.id, status, note, documentId)} />
            ))}
          </ul>
        )}
        {reminderLine && <p className="text-xs text-muted-foreground">{reminderLine}</p>}
      </SectionCard>

      <SectionCard title="Notice and case folder" description={n.case_id ? `Case ${n.case_id} · as on the portal` : 'This notice has no case folder on the portal'}
        actions={n.case_id && (
          <Link to={`/notices-case-folder/${n.client_id}/${encodeURIComponent(n.case_id)}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <FolderOpen className="h-3.5 w-3.5" /> Open case folder
          </Link>
        )}>
        <ul className="divide-y">
          <li className="flex items-center gap-2 py-1.5 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">The notice</span>
              <span className="block text-xs text-muted-foreground">{n.reference_number || 'no reference'}{n.issue_date ? ` · issued ${fmtDate(n.issue_date)}` : ''}</span>
            </span>
            {n.pdf_url
              ? <a href={n.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open PDF <ExternalLink className="h-3 w-3" /></a>
              : <span className="text-xs text-muted-foreground">PDF not captured yet — the next sync fetches it</span>}
          </li>
          {sectionKeys.flatMap((code) => (sections.get(code) ?? []).map((it) => {
            const att = attachmentsOf(it);
            const d = folderItemDate(it);
            return (
              <li key={it.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{SECTION[code] ?? code}</span>
                  <span className="block text-xs text-muted-foreground">{it.reference_number || '—'}{d ? ` · ${fmtDate(d)}` : ''}</span>
                </span>
                {att.length ? att.map((a) => (
                  <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{a.label} <ExternalLink className="h-3 w-3" /></a>
                )) : <span className="text-xs text-muted-foreground">no file</span>}
              </li>
            );
          }))}
        </ul>
      </SectionCard>

      <SectionCard title="Uploaded here" description={ws.documents.length ? `${ws.documents.length} file${ws.documents.length === 1 ? '' : 's'}` : 'Workings, the client\'s documents, the reply and its acknowledgement'}
        actions={canEdit && (
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Kind of document"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k.key} value={k.key} className="text-xs">{k.label}</SelectItem>)}</SelectContent>
            </Select>
            <Input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} aria-label="Choose files to upload" />
            <Button size="sm" className="h-8 gap-1 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </Button>
          </div>
        )}>
        {ws.documents.length > 0 && (
          <ul className="divide-y">
            {ws.documents.map((d) => {
              const url = documentUrl(d.storage_path);
              return (
                <li key={d.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {KINDS.find((k) => k.key === d.kind)?.label ?? d.kind} · {d.uploaded_by_name ? `${d.uploaded_by_name} · ` : ''}{fmtDateTime(d.created_at)}
                      {d.matter_id && !d.notice_id ? ' · on the matter' : ''}
                    </span>
                  </span>
                  {url && <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open <ExternalLink className="h-3 w-3" /></a>}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
};

export default DocumentsTab;
