// What the system read from a notice, and where each fact came from (roadmap
// Phase 4 "Document intelligence"; audit R-08, R-28; per-notice spec "Header
// facts": a source badge per field). Two readers fill gst_notices: the portal's
// case-folder JSON (always on, applied as verified) and the notice PDF read by
// the office agent with the Claude API (ships off; "auto — verify" until a
// person confirms). Readers only fill empty fields and never replace a value a
// person typed; a different value is kept as a conflict on the reading
// (migrations 20261008100000 / 110000; docs/REPLY_FACTORY_POSITIONS.md).
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { updateNotices, type NoticeActor } from '@/lib/noticeWrites';
import { fmtDate, fmtFy, fmtInr, fmtInrShort } from '@/lib/noticeFormat';

type NoticeRow = Database['public']['Tables']['gst_notices']['Row'];
type FolderItem = Database['public']['Tables']['gst_case_folder_items']['Row'];
export type Extraction = Database['public']['Tables']['notice_extractions']['Row'];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

// ── Fields a reader fills ──────────────────────────────────────────────────
export const READ_FIELDS = [
  'section_of_law', 'financial_year', 'period_from', 'period_to', 'din', 'demand', 'due_date',
  'hearing_date', 'hearing_note', 'issued_by', 'amount_of_demand',
] as const;
export type ReadField = (typeof READ_FIELDS)[number];
export const isReadField = (k: string): k is ReadField => (READ_FIELDS as readonly string[]).includes(k);

export const FIELD_LABEL: Record<ReadField | 'officer' | 'gstin', string> = {
  section_of_law: 'Section', financial_year: 'Financial year', period_from: 'Tax period from', period_to: 'Tax period to',
  din: 'DIN', demand: 'Demand by head', due_date: 'Reply due', hearing_date: 'Hearing', hearing_note: 'Hearing time and place',
  issued_by: 'Officer', amount_of_demand: 'Amount of demand', officer: 'Officer', gstin: 'GSTIN',
};

const DATE_FIELDS = new Set<string>(['period_from', 'period_to', 'due_date', 'hearing_date']);

/** read_fields[<column>]: who filled it, the value it put there and whether a person confirmed it. */
export interface ReadEntry {
  source: string;
  extraction_id?: string | null;
  value?: Json;
  at?: string | null;
  verified?: boolean;
  verified_by?: string | null;
  verified_at?: string | null;
  result?: string | null;
  cleared?: boolean;
}

export function readEntries(n: Pick<NoticeRow, 'read_fields'>): Partial<Record<ReadField, ReadEntry>> {
  const rf = obj(n.read_fields);
  const out: Partial<Record<ReadField, ReadEntry>> = {};
  for (const k of READ_FIELDS) {
    const e = obj(rf[k]);
    if (typeof e.source === 'string') out[k] = e as unknown as ReadEntry;
  }
  return out;
}

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(x) ? x : 0;
};

function isEmptyValue(k: ReadField, v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (k === 'amount_of_demand') return num(v) === 0;
  if (k === 'demand') return demandRows(v as Json).length === 0;
  return false;
}

/** The same value, the way the database compares it (amounts within ₹1, dates by day, demand by figures). */
export function sameValue(k: ReadField, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (k === 'amount_of_demand') return Math.abs(num(a) - num(b)) <= 1;
  if (k === 'demand') {
    const key = (d: unknown) => JSON.stringify(demandRows(d as Json).map((r) => [r.head, ...DEMAND_PARTS.map((p) => Math.round(r.parts[p]))]));
    return key(a) === key(b);
  }
  if (DATE_FIELDS.has(k)) return String(a).slice(0, 10) === String(b).slice(0, 10);
  return String(a).trim() === String(b).trim();
}

// ── Where a value came from ────────────────────────────────────────────────
export type SourceKind =
  | 'portal' | 'portal_list' | 'case_folder' | 'verify' | 'confirmed' | 'form' | 'typed' | 'computed' | 'extended' | 'empty';

export interface Provenance { kind: SourceKind; entry?: ReadEntry; note?: string | null }

export const SOURCE_CHIP: Record<Exclude<SourceKind, 'empty'>, { label: string; tone: 'info' | 'warning' | 'success' | 'secondary' }> = {
  portal: { label: 'Portal', tone: 'info' },
  portal_list: { label: 'Portal list', tone: 'info' },
  case_folder: { label: 'Case folder', tone: 'info' },
  verify: { label: 'Read from the PDF — verify', tone: 'warning' },
  confirmed: { label: 'From the PDF · confirmed', tone: 'success' },
  form: { label: 'From the form', tone: 'secondary' },
  typed: { label: 'Typed', tone: 'secondary' },
  computed: { label: 'Computed — verify', tone: 'warning' },
  extended: { label: 'Extended', tone: 'secondary' },
};

/**
 * A reader's value is "auto — verify" while it is unconfirmed and still the
 * value on the notice; once a person changes it, it is theirs (Typed). Values
 * no reader filled are Typed, except the officer and the reply date the
 * portal's notice list carries.
 */
export function provenance(n: NoticeRow, k: ReadField): Provenance {
  const v = n[k];
  if (isEmptyValue(k, v)) return { kind: 'empty' };
  const e = readEntries(n)[k];
  if (e && !e.cleared && sameValue(k, v, e.value)) {
    if (e.source === 'portal') return { kind: 'portal', entry: e };
    if (e.source === 'ai') return { kind: e.verified ? 'confirmed' : 'verify', entry: e };
    if (e.source === 'form') return { kind: 'form', entry: e };
  }
  if (k === 'due_date') {
    if (n.due_date_source === 'case_folder') return { kind: 'case_folder' };
    if (n.due_date_source === 'manual') return { kind: 'typed' };
    return { kind: 'portal_list' };
  }
  if (k === 'issued_by' && !(n.portal_key ?? '').startsWith('manual:')) return { kind: 'portal_list' };
  return { kind: 'typed' };
}

/** The reply date's source: extended by staff, computed from the form, or the stored date's own source. */
export function replyDueSource(f: { due_basis: string | null; due_basis_note: string | null }, n: NoticeRow): Provenance {
  if (f.due_basis === 'extended') return { kind: 'extended' };
  if (f.due_basis === 'computed') return { kind: 'computed', note: f.due_basis_note };
  if (f.due_basis === 'portal') return provenance(n, 'due_date');
  return { kind: 'empty' };
}

// ── Formats ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Apr 2019" for a YYYY-MM(-DD) date. */
export function fmtMonth(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** "Apr 2019 – Mar 2020", "Apr 2019" for one month, "" when unknown. */
export function fmtPeriod(from: string | null | undefined, to: string | null | undefined): string {
  const a = fmtMonth(from);
  const b = fmtMonth(to);
  if (!a) return b ? `up to ${b}` : '';
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

/** "2019-04" → "2019-04-01"; "2020-03" → "2020-03-31". */
export const monthStart = (ym: string) => `${ym}-01`;
export function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
export const toMonth = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 7) : '');

/** A value as the page shows it. */
export function fmtField(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'section_of_law') return `s.${String(v).replace(/^s(ection)?\.?\s*/i, '')}`;
  if (k === 'financial_year') return fmtFy(String(v));
  if (DATE_FIELDS.has(k)) return fmtDate(String(v));
  if (k === 'amount_of_demand') return fmtInr(num(v));
  if (k === 'demand') return demandSummary(v as Json) || '—';
  return String(v);
}

// ── Demand by head ─────────────────────────────────────────────────────────
export const DEMAND_PARTS = ['tax', 'interest', 'penalty', 'fee', 'others'] as const;
export type DemandPart = (typeof DEMAND_PARTS)[number];
export const PART_LABEL: Record<DemandPart, string> = { tax: 'Tax', interest: 'Interest', penalty: 'Penalty', fee: 'Fee', others: 'Others' };
const HEAD_ORDER = ['igst', 'cgst', 'sgst', 'cess'];
const HEAD_LABEL: Record<string, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST / UTGST', cess: 'Cess', unspecified: 'Head not stated' };

export interface DemandRow { head: string; label: string; parts: Record<DemandPart, number>; total: number }

/** {"igst": {"tax": …, "interest": …}, …} as rows, heads in the usual order, empty heads left out. */
export function demandRows(d: Json | null | undefined): DemandRow[] {
  const o = obj(d);
  const rank = (h: string) => (HEAD_ORDER.includes(h) ? HEAD_ORDER.indexOf(h) : 9);
  return Object.keys(o)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((head) => {
      const p = obj(o[head]);
      const parts = Object.fromEntries(DEMAND_PARTS.map((k) => [k, num(p[k])])) as Record<DemandPart, number>;
      return { head, label: HEAD_LABEL[head] ?? head.toUpperCase(), parts, total: DEMAND_PARTS.reduce((s, k) => s + parts[k], 0) };
    })
    .filter((r) => DEMAND_PARTS.some((k) => r.parts[k] !== 0));
}

/** The columns worth showing: tax always, the rest when any head has them. */
export const demandPartsShown = (rows: DemandRow[]): DemandPart[] =>
  DEMAND_PARTS.filter((k) => k === 'tax' || rows.some((r) => r.parts[k] !== 0));

/** "IGST ₹2.46 L · CGST ₹61,250 · interest ₹18,420" — tax by head, then the other parts. */
export function demandSummary(d: Json | null | undefined): string {
  const rows = demandRows(d);
  if (!rows.length) return '';
  const tax = rows.filter((r) => r.parts.tax !== 0).map((r) => `${r.label.split(' ')[0]} ${fmtInrShort(r.parts.tax)}`);
  const rest = DEMAND_PARTS.filter((k) => k !== 'tax')
    .map((k) => [k, rows.reduce((s, r) => s + r.parts[k], 0)] as const)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${PART_LABEL[k].toLowerCase()} ${fmtInrShort(v)}`);
  return [...tax, ...rest].join(' · ');
}

// ── Readings ───────────────────────────────────────────────────────────────
export interface AiReadStatus { readEnabled: boolean; agentOnline: boolean | null }
export interface ClientConsent { at: string | null; note: string | null; optOut: boolean }
export interface Reading {
  /** The portal's case-folder reading (one per notice). */
  portal: Extraction | null;
  /** The latest PDF reading, whatever its state. */
  ai: Extraction | null;
  /** The latest PDF reading that finished. */
  aiDone: Extraction | null;
  status: AiReadStatus | null;
  consent: ClientConsent | null;
}

export async function loadReading(noticeId: string, clientId: string): Promise<Reading> {
  const [x, st, c] = await Promise.all([
    supabase.from('notice_extractions').select('*').eq('notice_id', noticeId).order('created_at', { ascending: false }).limit(20),
    supabase.rpc('ai_read_status'),
    supabase.from('clients').select('ai_consent_at, ai_consent_note, ai_opt_out').eq('id', clientId).maybeSingle(),
  ]);
  if (x.error) throw x.error;
  const rows = x.data ?? [];
  const ai = rows.filter((r) => r.source === 'ai');
  // An older database (or a failed call) reads as switched off: nothing is offered that would not run.
  const s = st.error ? null : obj(st.data);
  return {
    portal: rows.find((r) => r.source === 'portal') ?? null,
    ai: ai[0] ?? null,
    aiDone: ai.find((r) => r.status === 'done') ?? null,
    status: s ? { readEnabled: obj(s.settings).read_enabled === true, agentOnline: typeof s.agent_online === 'boolean' ? s.agent_online : null } : null,
    consent: c.error || !c.data ? null : { at: c.data.ai_consent_at, note: c.data.ai_consent_note, optOut: !!c.data.ai_opt_out },
  };
}

export const isActiveRead = (x: Extraction | null | undefined) => !!x && (x.status === 'queued' || x.status === 'running');

/** The PDF a read would use: the notice's own, else a PDF attached to its case-folder item (notice_read_document). */
export function readableDocument(n: Pick<NoticeRow, 'pdf_url' | 'reference_number'>, folder: FolderItem[]): string | null {
  if (n.pdf_url) return n.pdf_url;
  for (const it of folder) {
    if (!n.reference_number || it.reference_number !== n.reference_number || it.deleted_at) continue;
    for (const a of Array.isArray(it.attachments) ? it.attachments : []) {
      const url = obj(a).url;
      if (typeof url === 'string' && /\.pdf($|\?)/i.test(url)) return url;
    }
  }
  return null;
}

export type ReadBlock = 'off' | 'opted_out' | 'no_consent' | 'no_document' | 'already';

/** Why "Read the PDF" cannot run now (the same order notice_read_request checks), or null. */
export function readBlock(r: Reading | undefined, hasDocument: boolean): ReadBlock | null {
  if (!r?.status?.readEnabled) return 'off';
  if (r.consent?.optOut) return 'opted_out';
  if (!r.consent?.at) return 'no_consent';
  if (!hasDocument) return 'no_document';
  if (isActiveRead(r.ai)) return 'already';
  return null;
}

export interface ReadRequestResult { queued: boolean; reason?: string; extraction_id?: string }

export async function requestRead(noticeId: string, actor: NoticeActor): Promise<ReadRequestResult> {
  const { data, error } = await supabase.rpc('notice_read_request', {
    p_notice_id: noticeId, p_actor_id: actor.id ?? null, p_actor_name: actor.firstName ?? null,
  });
  if (error) throw error;
  const o = obj(data);
  return { queued: o.queued === true, reason: typeof o.reason === 'string' ? o.reason : undefined, extraction_id: typeof o.extraction_id === 'string' ? o.extraction_id : undefined };
}

/** Confirm a value a reader filled (it stays, marked verified) or clear an unverified one. */
export async function verifyField(noticeId: string, field: ReadField, action: 'confirm' | 'clear', actor: NoticeActor): Promise<string> {
  const { data, error } = await supabase.rpc('notice_read_verify', {
    p_notice_id: noticeId, p_field: field, p_action: action, p_actor_name: actor.firstName ?? null,
  });
  if (error) throw error;
  return String(data ?? '');
}

/** Confirm an issue the PDF reader added. */
export async function verifyIssue(issueId: string, actor: NoticeActor): Promise<boolean> {
  const { data, error } = await supabase.rpc('notice_issue_verify', { p_issue_id: issueId, p_actor_name: actor.firstName ?? null });
  if (error) throw error;
  return !!data;
}

/** The tax period typed by staff (first day of the first month, last day of the last). */
export async function setPeriod(noticeId: string, fromMonth: string, toMonth: string, actor: NoticeActor): Promise<void> {
  const { error } = await updateNotices([noticeId], { period_from: monthStart(fromMonth), period_to: monthEnd(toMonth) }, actor);
  if (error) throw new Error(error.message);
}

// ── What a reading found that is not on the notice ─────────────────────────
export interface Conflict { field: ReadField; label: string; kept: string; read: string; reader: 'portal' | 'ai'; held: 'portal' | 'typed' }

/** Values a reader found that differ from the notice and were not applied — while the notice still holds the kept value. */
export function conflictsOf(x: Extraction | null | undefined, n: NoticeRow): Conflict[] {
  if (!x) return [];
  return Object.entries(obj(obj(x.checks).conflicts)).flatMap(([k, raw]) => {
    if (!isReadField(k)) return [];
    const c = obj(raw);
    if (!sameValue(k, n[k], c.current)) return [];
    const kind = provenance(n, k).kind;
    return [{
      field: k, label: FIELD_LABEL[k], kept: fmtField(k, n[k]), read: fmtField(k, c.read),
      reader: x.source === 'portal' ? 'portal' as const : 'ai' as const,
      held: kind === 'portal' || kind === 'portal_list' || kind === 'case_folder' ? 'portal' as const : 'typed' as const,
    }];
  });
}

export interface Unapplied {
  /** The reading's field (section_of_law, issued_by, …). */
  key: string; label: string; value: string; why: string }

/** Fields the PDF reader found but did not apply because they failed a check. */
export function unappliedOf(x: Extraction | null | undefined): Unapplied[] {
  if (!x) return [];
  const sumsFailed = obj(obj(x.checks).sums).ok === false;
  return Object.entries(obj(x.fields)).flatMap(([k, raw]) => {
    if (k === 'gstin') return [];
    const f = obj(raw);
    const label = (FIELD_LABEL as Record<string, string>)[k] ?? k.replace(/_/g, ' ');
    if (f.quote_ok !== true) return [{ key: k, label, value: fmtField(k, f.value), why: 'its words were not found on the page' }];
    if (k === 'demand' && sumsFailed) return [{ key: k, label, value: fmtField(k, f.value), why: 'the amounts do not add up' }];
    return [];
  });
}

/** How many of the notice's fields this reading filled (and are still its value). */
export function appliedBy(x: Extraction | null | undefined, n: NoticeRow): ReadField[] {
  if (!x) return [];
  const rf = readEntries(n);
  return READ_FIELDS.filter((k) => rf[k]?.extraction_id === x.id && !rf[k]?.cleared);
}

export interface PortalText { subject: string | null; facts: string | null; grounds: string | null; reason: string | null; hearingAsked: boolean | null }

/** The officer's own text from the portal's case folder. */
export function portalText(x: Extraction | null | undefined): PortalText | null {
  const d = obj(x?.detail);
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const t = { subject: s(d.subject), facts: s(d.facts), grounds: s(d.grounds), reason: s(d.reason),
    hearingAsked: typeof d.personal_hearing === 'boolean' ? d.personal_hearing : null };
  return t.subject || t.facts || t.grounds || t.reason ? t : null;
}

/** The PDF reader's one-line summary and the documents the notice asks for (none from a PDF addressed to another GSTIN). */
export function aiDetail(x: Extraction | null | undefined): { summary: string | null; documentsAsked: string[] } {
  const d = obj(x?.outcome === 'gstin_mismatch' ? null : x?.detail);
  return {
    summary: typeof d.summary === 'string' && d.summary.trim() ? d.summary.trim() : null,
    documentsAsked: Array.isArray(d.documents_asked) ? d.documents_asked.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [],
  };
}

/** The GSTIN the PDF names when it is not the client's. */
export function gstinMismatch(x: Extraction | null | undefined): { found: string | null; expected: string | null } | null {
  if (!x || x.outcome !== 'gstin_mismatch') return null;
  const g = obj(obj(x.checks).gstin);
  return { found: typeof g.found === 'string' ? g.found : null, expected: typeof g.expected === 'string' ? g.expected : null };
}
