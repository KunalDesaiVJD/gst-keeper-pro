import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, FolderOpen, Loader2, Mail, Paperclip, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import {
  docEmailOutcome, documentUrl, emailDocumentRequests, resolveRequest, uploadDocument, type FolderItem, type Workspace,
} from '@/lib/noticeWorkspace';
import { fmtDate, fmtDateTime } from '@/lib/noticeFormat';

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

export const DocumentsTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void; onAskClient: () => void }> = ({ ws, canEdit, onChanged, onAskClient }) => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState('evidence');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const n = ws.notice;

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

  const open = ws.requests.filter((r) => r.status === 'requested');

  return (
    <div className="space-y-3">
      <SectionCard title="Client documents" description={ws.requests.length ? `${ws.requests.filter((r) => r.status === 'received').length} received · ${open.length} pending · ${ws.requests.filter((r) => r.status === 'waived').length} waived` : 'Nothing asked of the client yet'}
        actions={canEdit && <>
          {open.length > 0 && (
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy === 'remind'} onClick={remind}>
              {busy === 'remind' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Remind client ({open.length})
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs" onClick={onAskClient}>Ask the client</Button>
        </>}>
        {ws.requests.length === 0 ? null : (
          <ul className="divide-y">
            {ws.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.item}</span>
                  <span className="block text-xs text-muted-foreground">
                    asked {fmtDate(r.requested_at.slice(0, 10))}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}
                    {r.due_date ? ` · needed by ${fmtDate(r.due_date)}` : ''}
                    {r.reminders_sent ? ` · ${r.reminders_sent} reminder${r.reminders_sent === 1 ? '' : 's'}` : ''}
                    {r.note ? ` · ${r.note}` : ''}
                  </span>
                </span>
                <Badge variant={r.status === 'received' ? 'success' : r.status === 'waived' ? 'secondary' : 'warning'} className="text-[11px]">
                  {r.status === 'received' ? 'Received' : r.status === 'waived' ? 'Waived' : 'Pending'}
                </Badge>
                {canEdit && (r.status === 'requested' ? (
                  <span className="flex gap-1">
                    <Popover>
                      <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === r.id}>Received</Button></PopoverTrigger>
                      <PopoverContent className="w-72 space-y-2 text-xs">
                        <div className="font-medium">Mark "{r.item}" received</div>
                        {ws.documents.length > 0 && (
                          <Select onValueChange={(v) => resolve(r.id, 'received', undefined, v === 'none' ? null : v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Link an uploaded file (optional)" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-xs">No file to link</SelectItem>
                              {ws.documents.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.title}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        <Button size="sm" className="h-7 w-full text-xs" onClick={() => resolve(r.id, 'received')}>Mark received</Button>
                      </PopoverContent>
                    </Popover>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === r.id} onClick={() => resolve(r.id, 'waived', 'Not needed')}>Waive</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === r.id} onClick={() => resolve(r.id, 'requested')}>Re-open</Button>
                ))}
              </li>
            ))}
          </ul>
        )}
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
