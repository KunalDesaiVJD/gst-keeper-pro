// The matter's papers in one place (audit U-87-1, U-87-3, U-94-1..3): the
// linked notices' portal PDFs, their case-folder attachments and the files
// uploaded here, grouped by stage of the proceeding with counts, each with its
// source, what it relates to, who added it and an Open link. Uploading takes
// several files at once, with the kind defaulted from the stage.
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Loader2, Paperclip, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { documentUrl } from '@/lib/noticeWorkspace';
import { fmtDate, fmtDateTime, noticeTitle } from '@/lib/noticeFormat';
import { DOC_KINDS, DOC_SOURCE_LABEL, docKindKey, toStageKey, uploadMatterDocument, type MatterWorkspace } from '@/lib/litigationData';
import { noticeLabel } from './MatterNoticesTab';

const SECTION_KIND: Record<string, string> = {
  INTIM: 'notice', NOTCE: 'notice', NOTAC: 'notice', REPLY: 'reply', ORDRS: 'order', CLSR: 'order', CLOSR: 'order', CLOSURE: 'order', APLCN: 'appeal',
};
const STAGE_KIND: Record<string, string> = { draft: 'reply', partner_review: 'reply', filed: 'reply', hearing: 'hearing', order: 'order', appeal: 'appeal' };

interface Item { id: string; kind: string; title: string; source: string; url: string | null; relates: string | null; by: string | null; date: string | null }

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const portalDate = (v: unknown) => {
  const m = typeof v === 'string' ? v.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};

function items(ws: MatterWorkspace): Item[] {
  const byId = new Map(ws.notices.map((n) => [n.id as string, n]));
  const out: Item[] = [];
  ws.notices.forEach((n) => {
    if (n.pdf_url) out.push({ id: `pdf-${n.id}`, kind: n.order_date && /DRC-07|order/i.test(`${n.form_code} ${n.notice_type}`) ? 'order' : 'notice', title: noticeTitle(n), source: 'portal', url: n.pdf_url, relates: noticeLabel(n), by: null, date: n.issue_date });
  });
  ws.folder.forEach((f) => {
    const j = asObj(f.raw_json);
    const date = portalDate(asObj(j.decdtls).dt) ?? portalDate(j.replydt) ?? portalDate(j.ntcdt) ?? portalDate(j.intdt) ?? null;
    const atts = Array.isArray(f.attachments) ? f.attachments.map(asObj).filter((a) => typeof a.url === 'string') : [];
    atts.forEach((a, i) => out.push({
      id: `folder-${f.id}-${i}`, kind: SECTION_KIND[(f.folder_section ?? '').toUpperCase()] ?? 'other', title: String(a.label ?? 'Attachment'), source: 'portal',
      url: String(a.url), relates: `case ${f.case_id}${f.reference_number ? ` · ${f.reference_number}` : ''}`, by: null, date,
    }));
  });
  ws.documents.forEach((d) => {
    const n = d.notice_id ? byId.get(d.notice_id) : undefined;
    out.push({ id: d.id, kind: docKindKey(d.kind), title: d.title, source: d.source, url: documentUrl(d.storage_path), relates: n ? noticeLabel(n) : 'the matter', by: d.uploaded_by_name, date: d.created_at });
  });
  return out;
}

export const MatterDocumentsTab: React.FC<{ ws: MatterWorkspace; canEdit: boolean; onChanged: () => void }> = ({ ws, canEdit, onChanged }) => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState(STAGE_KIND[toStageKey(ws.matter.stage)] ?? 'evidence');
  const [relates, setRelates] = useState('matter');
  const [uploading, setUploading] = useState(false);
  const all = items(ws);
  const groups = DOC_KINDS.map((k) => ({ ...k, list: all.filter((i) => i.kind === k.key) })).filter((g) => g.list.length);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) await uploadMatterDocument(ws.matter, f, { kind, noticeId: relates === 'matter' ? null : relates }, user);
      toast.success(files.length === 1 ? `${files[0].name} uploaded` : `${files.length} files uploaded`);
      onChanged();
    } catch (e) { toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
          <div className="space-y-1">
            <Label htmlFor="md-kind" className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="md-kind" className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{DOC_KINDS.map((k) => <SelectItem key={k.key} value={k.key} className="text-xs">{k.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="md-relates" className="text-xs">Relates to</Label>
            <Select value={relates} onValueChange={setRelates}>
              <SelectTrigger id="md-relates" className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="matter" className="text-xs">The matter</SelectItem>
                {ws.notices.map((n) => <SelectItem key={n.id} value={n.id as string} className="text-xs">{noticeLabel(n)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} aria-label="Choose files to upload" tabIndex={-1} />
          <Button size="sm" className={WS_BTN} disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" aria-hidden />} Upload files
          </Button>
          <span className="text-xs text-muted-foreground">or drop them here · the file name becomes the title</span>
        </div>
      )}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No papers yet: link the notices (their portal PDFs appear here) or upload the reply, workings and orders.</p>
      ) : groups.map((g) => (
        <SectionCard key={g.key} title={<>{g.label} <span className="font-normal text-muted-foreground">· {g.list.length}</span></>}>
          <ul className="divide-y">
            {g.list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                {i.source === 'portal' ? <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{i.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {i.relates ? `Relates to ${i.relates}` : ''}{i.by ? ` · added by ${i.by}` : ''}
                    {i.date ? ` · ${i.date.length > 10 ? fmtDateTime(i.date) : fmtDate(i.date)}` : ''}
                  </span>
                </span>
                <Badge variant={i.source === 'portal' ? 'info' : 'secondary'} className="text-[10px]">{DOC_SOURCE_LABEL[i.source] ?? i.source}</Badge>
                {i.url
                  ? <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2">Open<span className="sr-only"> {i.title}</span> <ExternalLink className="h-3 w-3" aria-hidden /></a>
                  : <span className="text-xs text-muted-foreground">no file attached</span>}
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}
      {ws.notices.length > 0 && (
        <p className="text-xs text-muted-foreground">
          To ask the client for a document, use the notice's Documents tab — requests are tracked and chased there
          {ws.notices.length <= 3 && <>: {ws.notices.map((n, i) => <React.Fragment key={n.id}>{i > 0 && ', '}<Link to={`/notices/${n.id}?tab=documents`} className="text-primary underline underline-offset-2">{noticeLabel(n)}</Link></React.Fragment>)}</>}.
        </p>
      )}
    </div>
  );
};
