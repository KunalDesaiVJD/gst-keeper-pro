// A notice's documents, organised: every file of its portal case folder and
// every file uploaded on the notice page, each with a readable name, a type
// and a date, grouped by the stage of the case it belongs to (intimation →
// notice → reply → order …), with the evidence set apart and named by what it
// proves. What the app knows about a file comes from, in this order: a
// person's choice (case_document_labels), the AI reader (ai_documents, keyed
// by the file's URL), and the portal's own JSON (which slot of the item the
// file sits in: the portal's form or a supporting upload). The original
// filename is always kept next to the name shown.
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { sectionCode, toEvent, type CaseEvent } from '@/components/notices/clients/caseFolder';
import { caseDocsKey, loadCaseDocuments, type AiDocument } from '@/lib/noticeAi';
import { documentUrl, type Workspace } from '@/lib/noticeWorkspace';
import type { NoticeActor } from '@/lib/noticeWrites';
import { detectEvidenceTypes, downloadName, evidenceType, joinTypeLabels, type EvidenceType } from '@/lib/evidenceTypes';

export type DocLabel = Database['public']['Tables']['case_document_labels']['Row'];
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

// ── Stages ─────────────────────────────────────────────────────────────────
export type StageKey = 'audit' | 'intimation' | 'notice' | 'reply' | 'order' | 'recovery' | 'application' | 'acknowledgement' | 'closure' | 'proceedings' | 'uploads' | 'other';

export const STAGES: Record<StageKey, { label: string; hint: string }> = {
  audit: { label: 'Audit', hint: 'Audit notices and reports' },
  intimation: { label: 'Intimation', hint: 'Before the notice: the officer\'s intimation (DRC-01A, ASMT-10)' },
  notice: { label: 'Notice', hint: 'The show cause notice or other notice issued' },
  reply: { label: 'Reply', hint: 'What the taxpayer filed in reply, with its annexures' },
  order: { label: 'Order', hint: 'Orders and decisions of the officer' },
  recovery: { label: 'Demand and recovery', hint: 'DRC-07A and recovery of the demand' },
  application: { label: 'Application', hint: 'Applications filed: refund, appeal, others' },
  acknowledgement: { label: 'Acknowledgement', hint: 'Acknowledgements and deficiency memos' },
  closure: { label: 'Closure', hint: 'The case closed on the portal' },
  proceedings: { label: 'Proceedings', hint: 'Enforcement proceedings' },
  uploads: { label: 'Uploaded by the firm', hint: 'Files staff or the client uploaded here' },
  other: { label: 'Other', hint: 'Portal items of no known stage' },
};

const STAGE_OF: Record<string, StageKey> = {
  RTAUD: 'audit', INTIM: 'intimation', NOTCE: 'notice', REPLY: 'reply', ORDRS: 'order', DRC7A: 'recovery',
  APLCN: 'application', NOTAC: 'acknowledgement', CLSR: 'closure', PRCED: 'proceedings',
};
const STAGE_RANK: StageKey[] = ['audit', 'application', 'acknowledgement', 'intimation', 'notice', 'reply', 'order', 'recovery', 'proceedings', 'closure', 'other', 'uploads'];
/** Sections where the taxpayer files (their supporting uploads are evidence). */
const TAXPAYER_SECTIONS = new Set(['REPLY', 'APLCN']);

// ── Kinds of document ──────────────────────────────────────────────────────
export type DocCategory = 'notice' | 'reply' | 'order' | 'acknowledgement' | 'application' | 'annexure' | 'evidence' | 'working' | 'other';
export const CATEGORY: Record<DocCategory, { label: string; tone: 'info' | 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  notice: { label: 'Notice', tone: 'warning' },
  reply: { label: 'Reply', tone: 'info' },
  order: { label: 'Order', tone: 'destructive' },
  acknowledgement: { label: 'Acknowledgement', tone: 'success' },
  application: { label: 'Application', tone: 'info' },
  annexure: { label: 'Annexure', tone: 'secondary' },
  evidence: { label: 'Evidence', tone: 'success' },
  working: { label: 'Working', tone: 'secondary' },
  other: { label: 'Other', tone: 'secondary' },
};
const AI_KINDS = new Set<DocCategory>(['notice', 'reply', 'order', 'acknowledgement', 'application', 'annexure', 'evidence', 'other']);
const SECTION_CATEGORY: Record<string, DocCategory> = {
  INTIM: 'notice', NOTCE: 'notice', RTAUD: 'notice', PRCED: 'notice', REPLY: 'reply', ORDRS: 'order', CLSR: 'order',
  DRC7A: 'order', APLCN: 'application', NOTAC: 'acknowledgement',
};

/** Where the portal put a file inside its item: the portal's own form, or a supporting upload. */
export type PortalSlot = 'form' | 'supporting' | null;

/**
 * Each document the item's JSON lists, by its portal document id and by its
 * filename: in a "main" slot (maindocs, mainDoc, docupload …) the portal's form
 * or the officer's main document; in any other list (suppdocs, annxdocs …) a
 * supporting upload. With the file's hash, so the same file filed twice is
 * known as one.
 */
export function portalSlots(raw: unknown): Map<string, { slot: PortalSlot; hash: string | null }> {
  const out = new Map<string, { slot: PortalSlot; hash: string | null }>();
  const walk = (v: unknown, slot: PortalSlot, depth: number) => {
    if (depth > 8 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, slot, depth + 1)); return; }
    const o = v as Obj;
    const d = obj(o.dcupdtls);
    const flat = !!(str(o.ct) || str(o.docName) || str(o.hash));
    const id = str(d.id) ?? (flat ? str(o.id) : null);
    const name = str(d.docName) ?? (flat ? str(o.docName) ?? str(o.name) : null);
    const hash = str(d.hash) ?? (flat ? str(o.hash) : null);
    if (id && (slot || !out.has(id))) out.set(id, { slot, hash });
    if (name && (slot || !out.has(`name:${name}`))) out.set(`name:${name}`, { slot, hash });
    for (const [k, x] of Object.entries(o)) {
      if (!x || typeof x !== 'object') continue;
      const s: PortalSlot = /^(maindocs?|maindocuments|maindoc|docupload|docupdtl|strformupload)$/i.test(k) ? 'form'
        : /(supp|annx|annex|docothers|scndoc|docappeal|sancdoc)/i.test(k) ? 'supporting' : slot;
      walk(x, s, depth + 1);
    }
  };
  walk(raw, null, 0);
  return out;
}

/** "REPLY" → "Reply filed", "ISSUE ACKNOWLEDGEMENT" → "Issue acknowledgement"; mixed-case titles stay. */
export function tidyTitle(t: string): string {
  if (t !== t.toUpperCase() || !/[A-Z]{4}/.test(t)) return t;
  const words = t.trim().split(/\s+/).map((w) => (/\d/.test(w) || w.length <= 3 ? w : w.toLowerCase()));
  const out = words.join(' ').replace(/^./, (c) => c.toUpperCase());
  return /^reply$/i.test(out) ? 'Reply filed' : /^notice$/i.test(out) ? 'Notice issued' : out;
}

const fileId = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');

// ── One document ───────────────────────────────────────────────────────────
export interface CaseDoc {
  /** case_document_labels.doc_key: the file's URL, or upload:<id>. */
  key: string;
  url: string | null;
  /** The filename as the portal or the uploader gave it. */
  original: string;
  /** The readable name shown. */
  name: string;
  /** Where the name came from. */
  nameFrom: 'person' | 'ai' | 'type' | 'portal';
  /** One line on what the file is (the AI's title when the name is the evidence type). */
  description: string | null;
  summary: string | null;
  category: DocCategory;
  date: string | null;
  isEvidence: boolean;
  evidenceTypes: EvidenceType[];
  stage: StageKey;
  source: 'portal' | 'upload';
  slot: PortalSlot;
  /** The portal item it came with (folder files). */
  event: CaseEvent | null;
  /** Upload facts (files uploaded here). */
  uploadedBy: string | null;
  uploadedAt: string | null;
  uploadKind: string | null;
  aiStatus: string | null;
  label: DocLabel | null;
  /** Evidence number on the Evidence tab ("E-3"), 0 for others. */
  exhibit: number;
  /** The portal's hash of the file; the same file filed twice has the same hash. */
  hash: string | null;
  /** For evidence filed again: the number of its first filing. */
  sameAs: number;
}

export interface StageGroup {
  /** Unique within the case (a stage can come twice: a reply to the intimation, then to the notice). */
  id: string;
  key: StageKey;
  label: string;
  hint: string;
  date: string | null;
  events: { event: CaseEvent; docs: CaseDoc[]; evidence: CaseDoc[] }[];
}

export interface CaseDocuments {
  stages: StageGroup[];
  /** Every non-evidence document, in stage order. */
  documents: CaseDoc[];
  /** Every evidence document, numbered E-1 … by date. */
  evidence: CaseDoc[];
  uploads: CaseDoc[];
  /** The notice's own PDF, when it is not one of the folder's files. */
  noticePdf: CaseDoc | null;
}

const PORTAL_NAME: Record<string, { form: string; supporting: string }> = {
  INTIM: { form: 'portal copy', supporting: 'officer\'s attachment' },
  NOTCE: { form: 'portal summary', supporting: 'detailed notice from the officer' },
  ORDRS: { form: 'portal summary', supporting: 'detailed order from the officer' },
  REPLY: { form: 'form as filed', supporting: 'attachment filed' },
  APLCN: { form: 'form as filed', supporting: 'document filed with it' },
  NOTAC: { form: 'portal copy', supporting: 'attachment' },
};

const REPLY_LIKE = /reply|drc-?0?6|asmt-?1[12]|apl-?0?1|rfd-?0?[1-9]\b|application|form ?gst|acknowledg|adjournment|extension request|submission/i;

function folderDoc(att: { label: string; url: string }, ev: CaseEvent, slot: PortalSlot, hash: string | null, ai: AiDocument | undefined, label: DocLabel | undefined): CaseDoc {
  const code = ev.code;
  const read = ai && ai.status === 'done' ? ai : undefined;
  const aiKind = read?.doc_kind && AI_KINDS.has(read.doc_kind as DocCategory) ? (read.doc_kind as DocCategory) : null;
  const taxpayer = TAXPAYER_SECTIONS.has(code);

  let evidence: boolean;
  if (label?.is_evidence != null) evidence = label.is_evidence;
  else if (aiKind) evidence = aiKind === 'evidence' || (taxpayer && slot !== 'form' && (aiKind === 'annexure' || aiKind === 'other'));
  else evidence = taxpayer && slot !== 'form' && !REPLY_LIKE.test(att.label);

  const types = label?.evidence_type ? [evidenceType(label.evidence_type)]
    : detectEvidenceTypes({ aiTitle: read?.title, aiSummary: read?.summary, filename: att.label });
  const category: DocCategory = evidence ? 'evidence' : aiKind && aiKind !== 'evidence' ? aiKind : SECTION_CATEGORY[code] ?? 'other';

  const portal = PORTAL_NAME[code];
  const portalName = `${ev.title}${portal && slot ? `, ${slot === 'form' ? portal.form : portal.supporting}` : ''}`;
  let name: string; let nameFrom: CaseDoc['nameFrom']; let description: string | null = null;
  if (label?.title) { name = label.title; nameFrom = 'person'; description = read?.title ?? null; }
  else if (evidence) { name = joinTypeLabels(types); nameFrom = 'type'; description = read?.title ?? null; }
  else if (read?.title) { name = read.title; nameFrom = 'ai'; }
  else { name = portalName; nameFrom = 'portal'; }

  return {
    key: att.url, url: att.url, original: att.label, name, nameFrom, description, summary: read?.summary ?? null,
    category, date: read?.doc_date ?? ev.date, isEvidence: evidence, evidenceTypes: types,
    stage: STAGE_OF[code] ?? 'other', source: 'portal', slot, event: ev,
    uploadedBy: null, uploadedAt: null, uploadKind: null, aiStatus: ai?.status ?? null, label: label ?? null, exhibit: 0,
    hash, sameAs: 0,
  };
}

const UPLOAD_CATEGORY: Record<string, DocCategory> = {
  evidence: 'evidence', client: 'evidence', reply: 'reply', acknowledgement: 'acknowledgement', order: 'order', other: 'other',
};

function uploadDoc(d: Workspace['documents'][number], label: DocLabel | undefined): CaseDoc {
  const evidence = label?.is_evidence ?? (d.kind === 'evidence' || d.kind === 'client');
  const types = label?.evidence_type ? [evidenceType(label.evidence_type)] : detectEvidenceTypes({ filename: d.title });
  const name = label?.title ?? (evidence ? joinTypeLabels(types) : d.title);
  return {
    key: `upload:${d.id}`, url: documentUrl(d.storage_path), original: d.title, name,
    nameFrom: label?.title ? 'person' : evidence ? 'type' : 'portal', description: null, summary: null,
    category: evidence ? 'evidence' : UPLOAD_CATEGORY[d.kind] ?? 'working',
    date: new Date(d.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    isEvidence: evidence, evidenceTypes: types, stage: 'uploads', source: 'upload', slot: null, event: null,
    uploadedBy: d.uploaded_by_name, uploadedAt: d.created_at, uploadKind: d.kind, aiStatus: null, label: label ?? null, exhibit: 0,
    hash: null, sameAs: 0,
  };
}

const byDate = (a: { date: string | null }, b: { date: string | null }) =>
  a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0;

/** The notice's documents organised. Pure: the hook below feeds it. */
export function organiseCaseDocuments(ws: Pick<Workspace, 'notice' | 'folder' | 'documents'>, ai: AiDocument[], labels: DocLabel[]): CaseDocuments {
  const aiByUrl = new Map<string, AiDocument>();
  ai.forEach((a) => { const u = a.source_ref || a.url; if (u && (!aiByUrl.has(u) || a.status === 'done')) aiByUrl.set(u, a); });
  const labelBy = new Map(labels.map((l) => [l.doc_key, l]));

  // Each file's slot and hash; a file the AI has not read borrows the reading of the same file (by hash) filed elsewhere.
  const items = ws.folder.map((it) => {
    const ev = toEvent(it);
    ev.title = tidyTitle(ev.title);
    const slots = portalSlots(it.raw_json);
    return { it, ev, files: ev.attachments.map((a) => ({ a, info: slots.get(fileId(a.url)) ?? slots.get(`name:${a.label}`) ?? { slot: null, hash: null } })) };
  });
  const aiByHash = new Map<string, AiDocument>();
  items.forEach(({ files }) => files.forEach(({ a, info }) => {
    const read = aiByUrl.get(a.url);
    if (info.hash && read?.status === 'done' && !aiByHash.has(info.hash)) aiByHash.set(info.hash, read);
  }));
  const readingOf = (url: string, hash: string | null) => {
    const own = aiByUrl.get(url);
    return own?.status === 'done' ? own : (hash && aiByHash.get(hash)) || own;
  };

  // Stages in the order the case went: the items by date, a run of items of one stage as one stage
  // (a reply to the intimation and a reply to the notice are two stages, with the notice between).
  const all: CaseDoc[] = [];
  const dated = items.map(({ it, ev, files }) => {
    const docs = files.map(({ a, info }) => folderDoc(a, ev, info.slot, info.hash, readingOf(a.url, info.hash), labelBy.get(a.url)));
    // The portal's form first, then the rest as the portal lists them.
    docs.sort((a, b) => (a.slot === 'form' ? 0 : 1) - (b.slot === 'form' ? 0 : 1));
    all.push(...docs);
    return { key: (STAGE_OF[sectionCode(it.folder_section)] ?? 'other') as StageKey, ev, docs };
  }).sort((a, b) => byDate(a.ev, b.ev) || STAGE_RANK.indexOf(a.key) - STAGE_RANK.indexOf(b.key));
  const stages: StageGroup[] = [];
  for (const x of dated) {
    let g = stages[stages.length - 1];
    if (!g || g.key !== x.key) {
      const before = g?.key;
      const label = x.key === 'reply' && before === 'intimation' ? 'Reply to the intimation'
        : x.key === 'reply' && (before === 'notice' || before === 'audit') ? 'Reply to the notice'
        : x.key === 'reply' && before === 'order' ? 'Reply after the order'
        : STAGES[x.key].label;
      g = { id: `${x.key}-${stages.length + 1}`, key: x.key, label, hint: STAGES[x.key].hint, date: x.ev.date, events: [] };
      stages.push(g);
    }
    g.events.push({ event: x.ev, docs: x.docs.filter((d) => !d.isEvidence), evidence: x.docs.filter((d) => d.isEvidence) });
    g.date = g.date ?? x.ev.date;
  }

  const uploads = ws.documents.map((d) => uploadDoc(d, labelBy.get(`upload:${d.id}`)));
  const n = ws.notice;
  const inFolder = n.pdf_url ? all.some((d) => d.url === n.pdf_url) : true;
  const noticeAi = n.pdf_url ? aiByUrl.get(n.pdf_url) : undefined;
  const noticePdf: CaseDoc | null = n.pdf_url && !inFolder ? {
    key: n.pdf_url, url: n.pdf_url, original: decodeURIComponent(n.pdf_url.split('?')[0].split('/').pop() ?? 'notice.pdf'),
    name: noticeAi?.status === 'done' && noticeAi.title ? noticeAi.title : 'This notice', nameFrom: noticeAi?.title ? 'ai' : 'portal',
    description: null, summary: noticeAi?.summary ?? null, category: 'notice', date: n.issue_date, isEvidence: false,
    evidenceTypes: [], stage: 'notice', source: 'portal', slot: 'form', event: null, uploadedBy: null, uploadedAt: null,
    uploadKind: null, aiStatus: noticeAi?.status ?? null, label: null, exhibit: 0, hash: null, sameAs: 0,
  } : null;

  const evidence = [...all, ...uploads].filter((d) => d.isEvidence).sort(byDate);
  const firstOf = new Map<string, number>();
  evidence.forEach((d, i) => {
    d.exhibit = i + 1;
    if (!d.hash) return;
    const first = firstOf.get(d.hash);
    if (first) d.sameAs = first; else firstOf.set(d.hash, d.exhibit);
  });
  const documents = stages.flatMap((g) => g.events.flatMap((e) => e.docs));
  return { stages, documents: [...documents, ...uploads.filter((d) => !d.isEvidence)], evidence, uploads, noticePdf };
}

/** Where an evidence file came from, in words: "Filed with Reply to SCN on 14 Aug 2024". */
export function evidenceSource(d: CaseDoc, fmtDate: (iso: string | null) => string): string {
  if (d.source === 'upload') {
    const who = d.uploadKind === 'client' ? 'From the client' : 'Uploaded here';
    return `${who}${d.uploadedBy ? ` by ${d.uploadedBy}` : ''}${d.uploadedAt ? ` on ${fmtDate(d.date)}` : ''}`;
  }
  const ev = d.event;
  if (!ev) return 'From the portal';
  const what = ev.code === 'REPLY' ? `Filed with the reply${ev.ref ? ` ${ev.ref}` : ''}`
    : ev.code === 'APLCN' ? `Filed with ${ev.title}${ev.ref ? ` (${ev.ref})` : ''}`
    : `Came with ${ev.title}${ev.ref ? ` (${ev.ref})` : ''}`;
  return `${what}${ev.date ? ` on ${fmtDate(ev.date)}` : ''}`;
}

/** The file's URL, set to download under its readable name (storage URLs only; others open as they are). */
export function downloadHref(d: CaseDoc): string | null {
  if (!d.url) return null;
  if (!/\/storage\/v1\/object\/public\//.test(d.url)) return d.url;
  const name = downloadName(d.isEvidence && d.exhibit ? `E-${d.exhibit} ${d.name}` : d.name, d.original);
  return `${d.url}${d.url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
}

// ── Loading and saving ─────────────────────────────────────────────────────
/** Labels are kept per case (or per notice when it has no case folder). */
export const labelCaseKey = (n: Pick<Workspace['notice'], 'id' | 'case_id'>) => n.case_id ?? `notice:${n.id}`;
export const docLabelsKey = (clientId: string, caseKey: string) => ['case-doc-labels', clientId, caseKey] as const;

export async function loadDocLabels(clientId: string, caseKey: string): Promise<DocLabel[]> {
  const { data, error } = await supabase.from('case_document_labels').select('*').eq('client_id', clientId).eq('case_id', caseKey);
  if (error) throw error;
  return data ?? [];
}

export async function saveDocLabel(
  n: Pick<Workspace['notice'], 'id' | 'case_id' | 'client_id'>,
  docKey: string,
  v: { title?: string | null; evidence_type?: string | null; is_evidence?: boolean | null },
  actor: NoticeActor,
) {
  const title = v.title === undefined ? undefined : (v.title?.trim() || null);
  const { error } = await supabase.from('case_document_labels').upsert({
    client_id: n.client_id, case_id: labelCaseKey(n), doc_key: docKey,
    ...(title !== undefined ? { title } : {}),
    ...(v.evidence_type !== undefined ? { evidence_type: v.evidence_type } : {}),
    ...(v.is_evidence !== undefined ? { is_evidence: v.is_evidence } : {}),
    set_by: actor.id ?? null, set_by_name: actor.firstName ?? null,
  }, { onConflict: 'client_id,doc_key' });
  if (error) throw error;
}

/** The notice's documents organised, with the AI's reading and people's labels; null while loading. */
export function useCaseDocuments(ws: Workspace | undefined) {
  const n = ws?.notice;
  const qc = useQueryClient();
  const clientId = n?.client_id ?? '';
  const caseKey = n ? labelCaseKey(n) : '';
  const ai = useQuery({
    queryKey: caseDocsKey(n?.id ?? ''), queryFn: () => loadCaseDocuments(clientId, n?.case_id ?? null, n?.id ?? ''),
    enabled: !!n, staleTime: 60_000,
  });
  const labels = useQuery({ queryKey: docLabelsKey(clientId, caseKey), queryFn: () => loadDocLabels(clientId, caseKey), enabled: !!n, staleTime: 60_000 });
  // A failed read of either still organises the files, by the portal's JSON alone.
  const ready = !!ws && (ai.isSuccess || ai.isError) && (labels.isSuccess || labels.isError);
  const model = useMemo(() => (ready && ws ? organiseCaseDocuments(ws, ai.data ?? [], labels.data ?? []) : null), [ready, ws, ai.data, labels.data]);
  return {
    model,
    labelsFailed: labels.isError,
    refreshLabels: () => qc.invalidateQueries({ queryKey: docLabelsKey(clientId, caseKey) }),
  };
}
