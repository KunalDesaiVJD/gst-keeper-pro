// The notice's documents, organised (src/lib/caseDocuments.ts): the case file
// on the Documents tab, split into the department's documents and the
// assessee's submissions (each stage by stage) or as one stage-wise list, and the evidence apart, named by what it
// proves, on the Evidence tab (or on the Documents tab for a kind of case that
// has no Evidence tab). Every file keeps its original filename as a second
// line; a person can rename it, give its evidence type or move it between the
// two lists (case_document_labels), never changing the portal's file.
// Type set again on 27 October 2026 (the firm: small fonts put people off
// reading): each stage leads with its number and name, each item with its
// title, and nothing is smaller than 12px.
import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, ChevronDown, Download, ExternalLink, FileCheck2, FileQuestion, FileText, FolderOpen, Gavel, Inbox, Loader2, Pencil,
  Reply, ScrollText, ShieldCheck, Upload, UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  CATEGORY, SIDES, downloadHref, evidenceSource, saveDocLabel, stagesOfSide,
  type CaseDoc, type CaseDocuments, type DocCategory, type DocSide, type StageGroup,
} from '@/lib/caseDocuments';
import { EVIDENCE_TYPES } from '@/lib/evidenceTypes';
import { uploadDocument, type Workspace } from '@/lib/noticeWorkspace';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const ICON: Record<DocCategory, React.ComponentType<{ className?: string }>> = {
  notice: ScrollText, reply: Reply, order: Gavel, acknowledgement: FileCheck2, application: FileText,
  annexure: FileText, evidence: ShieldCheck, working: FileText, other: FileQuestion,
};

const NAME_FROM: Record<CaseDoc['nameFrom'], string> = {
  person: 'Named by staff',
  ai: 'Named from what the AI read in the file',
  type: 'Named by the type of evidence',
  portal: 'Named from the portal item it came with',
};

const ACTION = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10';

/** Rename, set the evidence type, or move a file between the case file and the evidence. */
const LabelEditor: React.FC<{ ws: Workspace; doc: CaseDoc; onSaved: () => void }> = ({ ws, doc, onSaved }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [evidence, setEvidence] = useState(doc.isEvidence);
  const [type, setType] = useState(doc.label?.evidence_type ?? doc.evidenceTypes[0]?.key ?? 'other');
  const [busy, setBusy] = useState(false);
  const reset = (o: boolean) => {
    setOpen(o);
    if (o) { setTitle(doc.label?.title ?? ''); setEvidence(doc.isEvidence); setType(doc.label?.evidence_type ?? doc.evidenceTypes[0]?.key ?? 'other'); }
  };
  const save = async (v: Parameters<typeof saveDocLabel>[2], done: string) => {
    if (!user) return;
    setBusy(true);
    try { await saveDocLabel(ws.notice, doc.key, v, user); toast.success(done); setOpen(false); onSaved(); }
    catch (e) { toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const id = `lbl-${doc.key.slice(-24).replace(/\W/g, '')}`;
  return (
    <Popover open={open} onOpenChange={reset}>
      <PopoverTrigger asChild>
        <button type="button" className={ACTION} title="Rename or change where this file is kept"><Pencil className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">Rename {doc.name}</span></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-xs">
        <div>
          <div className="font-medium">Name this file</div>
          <p className="break-all text-muted-foreground">Original: {doc.original}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-t`} className="text-xs">Name shown</Label>
          <Input id={`${id}-t`} value={title} maxLength={200} placeholder={doc.name} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" />
          <p className="text-muted-foreground">Leave empty to keep the automatic name.</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-e`} className="text-xs">Evidence (kept on the Evidence list)</Label>
          <Switch id={`${id}-e`} checked={evidence} onCheckedChange={setEvidence} />
        </div>
        {evidence && (
          <div className="space-y-1">
            <Label className="text-xs">Type of evidence</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-8 text-xs" aria-label="Type of evidence"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVIDENCE_TYPES.map((t) => (
                  <SelectItem key={t.key} value={t.key} className="text-xs">{t.label}<span className="ml-1 text-muted-foreground">· {t.hint}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-1.5">
          {doc.label && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
              onClick={() => save({ title: null, evidence_type: null, is_evidence: null }, 'Back to the automatic name and place.')}>
              Reset to automatic
            </Button>
          )}
          <Button size="sm" className="ml-auto h-7 gap-1 text-xs" disabled={busy}
            onClick={() => save({ title: title.trim() || null, is_evidence: evidence, evidence_type: evidence ? type : null }, 'Saved.')}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** One file: readable name and type, date and source, the original filename, what the AI read, and Open / Download. */
export const DocRow: React.FC<{
  ws: Workspace; doc: CaseDoc; canEdit: boolean; onSaved: () => void;
  /** The line under the name (date, where it came from); defaults to the date. */
  meta?: React.ReactNode;
}> = ({ ws, doc, canEdit, onSaved, meta }) => {
  const [more, setMore] = useState(false);
  const Icon = ICON[doc.category];
  const look = CATEGORY[doc.category];
  const dl = downloadHref(doc);
  const detail = doc.summary || (doc.description && doc.description !== doc.name ? doc.description : null);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        doc.isEvidence ? 'bg-success/15 text-success' : doc.category === 'order' ? 'bg-destructive/10 text-destructive'
          : doc.category === 'notice' ? 'bg-warning/20 text-amber-700 dark:text-amber-300' : 'bg-info/10 text-info')}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {doc.exhibit > 0 && <span className="rounded bg-primary px-1.5 py-px text-xs font-semibold tabular-nums text-primary-foreground" title="Evidence number">E-{doc.exhibit}</span>}
          <span className="break-words text-[15px] font-medium leading-snug" title={NAME_FROM[doc.nameFrom]}>{doc.name}</span>
          {!doc.isEvidence && <Badge variant={look.tone} className="px-1.5 py-0 text-xs font-normal">{look.label}</Badge>}
          {doc.url && doc.url === ws.notice.pdf_url && <Badge variant="info" className="px-1.5 py-0 text-xs">This notice</Badge>}
          {doc.slot === 'form' && !doc.isEvidence && <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal" title="The form the portal generated">Portal form</Badge>}
        </div>
        {doc.isEvidence && doc.description && doc.description !== doc.name && <p className="break-words text-[13px]">{doc.description}</p>}
        <p className="break-words text-[13px] text-muted-foreground">{meta ?? (doc.date ? fmtDate(doc.date) : 'no date on the file')}</p>
        <p className="truncate font-mono text-xs text-muted-foreground/80" title={`Original filename: ${doc.original}`}>
          <span className="sr-only">Original filename: </span>{doc.original}
        </p>
        {detail && (
          <div className="text-[13px]">
            <button type="button" className="inline-flex items-center gap-0.5 font-medium text-primary" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', more && 'rotate-180')} aria-hidden /> {more ? 'Hide what it says' : 'What it says'}
            </button>
            {more && <p className="mt-0.5 whitespace-pre-line break-words rounded-md bg-muted/50 px-2.5 py-1.5 leading-relaxed text-foreground/80">{detail}</p>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {doc.url ? (
          <>
            <a href={doc.url} target="_blank" rel="noreferrer" className={ACTION}>Open <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">{doc.name}</span></a>
            {dl && dl !== doc.url && (
              <a href={dl} className={ACTION} title={`Download as "${doc.isEvidence && doc.exhibit ? `E-${doc.exhibit} ` : ''}${doc.name}"`}>
                <Download className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">Download {doc.name}</span>
              </a>
            )}
          </>
        ) : <span className="text-xs text-muted-foreground">no file</span>}
        {canEdit && <LabelEditor ws={ws} doc={doc} onSaved={onSaved} />}
      </div>
    </li>
  );
};

/** "Ref ZD… · 01 Aug 2024 · reply due 30 Aug 2024 · answers ZD…" */
const eventMeta = (e: StageGroup['events'][number]['event']) => [
  e.ref, e.date ? fmtDate(e.date) : null, e.due ? `reply due ${fmtDate(e.due)}` : null,
  e.answers?.ref ? `answers ${e.answers.ref}` : null, e.code === 'REPLY' && e.by ? `signed by ${e.by}` : null,
].filter(Boolean).join(' · ');

/** One stage of the case, with its items and their files. */
const StageSection: React.FC<{ ws: Workspace; g: StageGroup; anchor?: string; canEdit: boolean; onSaved: () => void }> = ({ ws, g, anchor, canEdit, onSaved }) => (
  <section id={anchor} className="scroll-mt-20 rounded-md border">
    <header className="flex items-start gap-2.5 border-b bg-muted/40 px-3 py-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-label={`Stage ${g.n}`}>{g.n}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-base font-semibold">{g.label}</h3>
          {g.date && <span className="text-sm text-muted-foreground">{fmtDate(g.date)}</span>}
        </div>
        <p className="text-[13px] text-muted-foreground">{g.hint}</p>
      </div>
    </header>
    <div className="divide-y">
      {g.events.map(({ event: e, docs, evidence }) => (
        <div key={e.id} className="px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h4 className="text-[15px] font-semibold">{e.title}</h4>
            <span className="text-[13px] text-muted-foreground">{eventMeta(e)}</span>
          </div>
          {docs.length > 0 ? (
            <ul className="divide-y pl-2">
              {docs.map((d) => <DocRow key={d.key} ws={ws} doc={d} canEdit={canEdit} onSaved={onSaved} />)}
            </ul>
          ) : !evidence.length && <p className="py-1 text-[13px] text-muted-foreground">No file on the portal for this item.</p>}
          {evidence.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1 rounded-md bg-success/5 px-2 py-1 text-[13px] text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              Filed with it, {plural(evidence.length, 'evidence file')} (on the Evidence list): {evidence.map((d) => `E-${d.exhibit} ${d.name}`).join('; ')}.
            </p>
          )}
        </div>
      ))}
    </div>
  </section>
);

const SIDE_ICON: Record<DocSide, React.ComponentType<{ className?: string }>> = { department: Building2, assessee: UserRound };
const SIDE_LOOK: Record<DocSide, string> = {
  department: 'border-amber-300/70 bg-warning/10 text-amber-800 dark:text-amber-300',
  assessee: 'border-info/40 bg-info/10 text-info',
};

type CaseFileView = 'side' | 'stage';
const VIEW_KEY = 'gstk.caseFileView';
const readView = (): CaseFileView => {
  try { return localStorage.getItem(VIEW_KEY) === 'stage' ? 'stage' : 'side'; } catch { return 'side'; }
};

/** The portal case file: the department's documents and the assessee's submissions apart, or every stage in one list. */
export const CaseFileCard: React.FC<{
  ws: Workspace; model: CaseDocuments | null; canEdit: boolean; onSaved: () => void;
  /** Opens the Evidence tab; absent when the evidence is listed on this tab. */
  onOpenEvidence?: () => void;
}> = ({ ws, model, canEdit, onSaved, onOpenEvidence }) => {
  const n = ws.notice;
  const [view, setViewState] = useState<CaseFileView>(readView);
  const setView = (v: CaseFileView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* the choice just isn't remembered */ } };
  const files = model ? model.stages.reduce((s, g) => s + g.events.reduce((t, e) => t + e.docs.length, 0), 0) : 0;
  const moved = model ? model.evidence.filter((d) => d.source === 'portal').length : 0;
  const sides = useMemo(() => (model ? (['department', 'assessee'] as const).map((side) => {
    const stages = stagesOfSide(model.stages, side);
    return { side, stages, files: stages.reduce((s, g) => s + g.events.reduce((t, e) => t + e.docs.length, 0), 0) };
  }) : []), [model]);
  // In the split view a stage chip leads to the first copy of its stage: the department's if it has one.
  const anchorSide = useMemo(() => {
    const m = new Map<string, DocSide>();
    sides.forEach((x) => x.stages.forEach((g) => { if (!m.has(g.id)) m.set(g.id, x.side); }));
    return m;
  }, [sides]);
  const anchorOf = (g: StageGroup) => (view === 'stage' ? `stage-${g.id}` : `stage-${anchorSide.get(g.id) ?? 'department'}-${g.id}`);
  const sidesOf = (g: StageGroup) => {
    const all = g.events.flatMap((e) => e.docs);
    return (['department', 'assessee'] as const).filter((s) => all.some((d) => d.side === s) || (s === 'assessee' && g.events.some((e) => e.evidence.length)));
  };
  return (
    <SectionCard
      title="Case file"
      description={n.case_id ? `Case ${n.case_id} · as on the portal${model ? ` · ${plural(files, 'document')} in ${plural(model.stages.length, 'stage')}` : ''}` : 'This notice has no case folder on the portal'}
      info="Every document of the portal's case folder, in the order the case went: intimation, notice, reply, order. By side lists the department's documents (intimations, notices, orders, acknowledgements) apart from the assessee's submissions (replies, applications, appeals), each stage by stage with the stage numbers of the whole case; Stage-wise lists both together. Each file is named from what is in it (read by the AI) or from the portal item it came with; the portal's own filename is the grey line under it. Evidence filed with a reply or application is kept apart, named by what it proves."
      actions={<>
        {model && model.stages.length > 0 && (
          <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Show the case file">
            {(['side', 'stage'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={cn('rounded px-2.5 py-1', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {v === 'side' ? 'By side' : 'Stage-wise'}
              </button>
            ))}
          </div>
        )}
        {n.case_id && (
          <Link to={`/notices-case-folder/${n.client_id}/${encodeURIComponent(n.case_id)}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Open case folder
          </Link>
        )}
      </>}>
      {model?.noticePdf && (
        <ul className="rounded-md border bg-muted/20 px-2.5"><DocRow ws={ws} doc={model.noticePdf} canEdit={false} onSaved={onSaved}
          meta={<>The notice you are on{n.reference_number ? ` · ${n.reference_number}` : ''}{n.issue_date ? ` · issued ${fmtDate(n.issue_date)}` : ''}</>} /></ul>
      )}
      {!n.pdf_url && <p className="text-xs text-muted-foreground">The notice's PDF is not captured yet; the next sync fetches it.</p>}
      {!model && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Organising the documents…</p>}

      {model && model.stages.length > 1 && (
        <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Stages of the case">
          {model.stages.map((g, i) => (
            <li key={g.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground" aria-hidden>→</span>}
              <a href={`#${anchorOf(g)}`} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 hover:border-primary">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{g.n}</span>
                <span className="font-medium">{g.label}</span>
                {g.date && <span className="text-xs text-muted-foreground">{fmtDate(g.date)}</span>}
                {sidesOf(g).map((s) => {
                  const Icon = SIDE_ICON[s];
                  return <Icon key={s} className={cn('h-3.5 w-3.5', s === 'department' ? 'text-amber-700 dark:text-amber-300' : 'text-info')} aria-label={SIDES[s].label} />;
                })}
              </a>
            </li>
          ))}
        </ol>
      )}

      {model && moved > 0 && (
        <p className="flex flex-wrap items-center gap-1 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
          {plural(moved, 'evidence file')} filed on the portal {moved === 1 ? 'is' : 'are'} kept {onOpenEvidence ? 'on the Evidence tab' : 'in Evidence below'}, named by what {moved === 1 ? 'it proves' : 'they prove'}.
          {onOpenEvidence && <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={onOpenEvidence}>Open Evidence</button>}
        </p>
      )}

      {model && view === 'stage' && model.stages.map((g) => (
        <StageSection key={g.id} ws={ws} g={g} anchor={`stage-${g.id}`} canEdit={canEdit} onSaved={onSaved} />
      ))}

      {model && view === 'side' && model.stages.length > 0 && sides.map(({ side, stages, files: count }) => {
        const Icon = SIDE_ICON[side];
        return (
          <section key={side} aria-labelledby={`side-${side}`} className="space-y-2">
            <header className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2', SIDE_LOOK[side])}>
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 id={`side-${side}`} className="text-base font-semibold">{SIDES[side].label}</h3>
                  <span className="text-sm opacity-80">{plural(count, 'document')}{stages.length ? ` · ${plural(stages.length, 'stage')}` : ''}</span>
                </div>
                <p className="text-[13px] opacity-80">{SIDES[side].hint}</p>
              </div>
            </header>
            {stages.length
              ? stages.map((g) => <StageSection key={g.id} ws={ws} g={g} anchor={`stage-${side}-${g.id}`} canEdit={canEdit} onSaved={onSaved} />)
              : <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">{side === 'department' ? 'No document from the department in the case folder.' : 'Nothing filed by the assessee in the case folder yet.'}</p>}
          </section>
        );
      })}
    </SectionCard>
  );
};

/** Upload a file as evidence of a chosen type (it is named by the type until someone renames it). */
const EvidenceUpload: React.FC<{ ws: Workspace; onDone: () => void }> = ({ ws, onDone }) => {
  const { user } = useAuth();
  const ref = useRef<HTMLInputElement | null>(null);
  const [type, setType] = useState('purchase_invoices');
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const id = await uploadDocument(ws.notice, f, 'evidence', user);
        await saveDocLabel(ws.notice, `upload:${id}`, { evidence_type: type, is_evidence: true }, user);
      }
      toast.success(files.length === 1 ? 'Evidence uploaded' : `${files.length} evidence files uploaded`);
      onDone();
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="h-8 w-52 text-xs" aria-label="Type of evidence to upload"><SelectValue /></SelectTrigger>
        <SelectContent>{EVIDENCE_TYPES.map((t) => <SelectItem key={t.key} value={t.key} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
      </Select>
      <Input ref={ref} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} aria-label="Choose evidence files to upload" />
      <Button size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />} Upload evidence
      </Button>
    </div>
  );
};

/** The evidence: every file that proves something, numbered E-1 … and grouped by type. */
export const EvidenceDocumentsCard: React.FC<{ ws: Workspace; model: CaseDocuments | null; canEdit: boolean; onSaved: () => void; onUploaded: () => void }> = ({ ws, model, canEdit, onSaved, onUploaded }) => {
  const [view, setView] = useState<'type' | 'date'>('type');
  const ev = model?.evidence ?? [];
  const groups = new Map<string, { label: string; docs: CaseDoc[] }>();
  ev.forEach((d) => {
    const t = d.evidenceTypes[0];
    const key = t?.key ?? 'other';
    groups.set(key, { label: t?.label ?? 'Other evidence', docs: [...(groups.get(key)?.docs ?? []), d] });
  });
  const ordered = EVIDENCE_TYPES.map((t) => groups.get(t.key) && { key: t.key, ...groups.get(t.key)! }).filter(Boolean) as { key: string; label: string; docs: CaseDoc[] }[];
  const row = (d: CaseDoc) => (
    <DocRow key={d.key} ws={ws} doc={d} canEdit={canEdit} onSaved={onSaved}
      meta={<>{evidenceSource(d, fmtDate)}{d.sameAs ? ` · the same file as E-${d.sameAs}` : ''}{d.evidenceTypes.length > 1 ? ` · also ${d.evidenceTypes.slice(1).map((t) => t.label).join(', ')}` : ''}</>} />
  );
  return (
    <SectionCard
      title="Evidence documents"
      description={model ? (ev.length ? `${plural(ev.length, 'file')} · ${plural(ordered.length, 'type')}` : 'No evidence on record yet') : 'Organising…'}
      info="Documents that prove the taxpayer's case: those filed with replies and applications on the portal, and those uploaded here or by the client. Each is numbered (E-1, E-2 …) and named by the type of evidence; Download saves it under that name. The original filename stays under each. Rename a file, change its type or move it back to the case file with the pencil."
      actions={<>
        {ev.length > 1 && (
          <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Group the evidence">
            {(['type', 'date'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={cn('rounded px-2.5 py-1', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {v === 'type' ? 'By type' : 'By date'}
              </button>
            ))}
          </div>
        )}
        {canEdit && <EvidenceUpload ws={ws} onDone={onUploaded} />}
      </>}>
      {!model && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Organising the documents…</p>}
      {model && !ev.length && (
        <p className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-3 text-xs text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden /> No evidence yet. Files filed with a reply or application on the portal appear here by themselves; upload more with Upload evidence.
        </p>
      )}
      {model && ev.length > 0 && view === 'date' && <ul className="divide-y">{ev.map(row)}</ul>}
      {model && ev.length > 0 && view === 'type' && ordered.map((g) => (
        <section key={g.key} className="rounded-md border">
          <header className="flex flex-wrap items-baseline gap-x-2 border-b bg-success/5 px-3 py-2">
            <h3 className="text-base font-semibold">{g.label}</h3>
            <span className="text-[13px] text-muted-foreground">{plural(g.docs.length, 'file')} · {g.docs.map((d) => `E-${d.exhibit}`).join(', ')}</span>
          </header>
          <ul className="divide-y px-3">{g.docs.map(row)}</ul>
        </section>
      ))}
    </SectionCard>
  );
};
