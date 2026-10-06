// Reply Factory (roadmap Phase 4; audit R-08, R-10, R-11, R-15, R-25): what the
// Reply Factory page and the client portal read and write — the Phase 4
// acceptance numbers (reply_factory_status), the lists behind each of them, the
// reply rules (reply_issue_types), the AI reading switches, spend and audit,
// client consent, and the client's own document requests (migrations
// 20261008100000–140000). One place for the words, so every screen says the
// same thing. Read docs/REPLY_FACTORY_POSITIONS.md before changing a rule here.
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { addDays, istToday } from '@/lib/noticeFacts';
import { fmtAgo, fmtDate, fmtInr } from '@/lib/noticeFormat';

type Tables = Database['public']['Tables'];
type Functions = Database['public']['Functions'];
export type AiSettings = Tables['ai_settings']['Row'];
export type IssueType = Tables['reply_issue_types']['Row'];
export type AuditRow = Tables['ai_audit_log']['Row'];
export type CoverageRow = Functions['notice_due_coverage']['Returns'][number];
export type ClientDocRequest = Functions['client_doc_requests']['Returns'][number];
export type Tone = 'success' | 'warning' | 'info' | 'destructive' | 'secondary';
export interface Actor { id: string; firstName: string }

export type FactoryTab = 'overview' | 'rules' | 'ai' | 'consent';

/** A list's page in the URL (?p= by default); links to another list leave it out, so a new list starts on page 1. */
export function useListPage(param = 'p', pageSize = 50) {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get(param)) || 1);
  const setPage = useCallback((n: number) => {
    const next = new URLSearchParams(sp);
    if (n <= 1) next.delete(param); else next.set(param, String(n));
    setSp(next);
  }, [sp, setSp, param]);
  const slice = <T,>(rows: T[]): T[] => rows.slice((page - 1) * pageSize, page * pageSize);
  return { page, pageSize, setPage, slice };
}

/** "/notices-reply-factory?show=cov:missing" — the overview is the default tab, so it is left out. */
export function factoryHref(tab: FactoryTab, params: Record<string, string | null | undefined> = {}): string {
  const sp = new URLSearchParams();
  if (tab !== 'overview') sp.set('tab', tab);
  Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return `/notices-reply-factory${s ? `?${s}` : ''}`;
}

// ── Targets (roadmap Phase 4 acceptance; REPLY_FACTORY_POSITIONS §9) ───────
export const DUE_COVERAGE_TARGET = 98;
export const AUTO_ANNEXURE_TARGET = 70;
export const DUE_EXACT_TARGET = 98;
/** Below this many verified fields an accuracy share says nothing yet. */
export const ACCURACY_MIN_SAMPLE = 20;
/** The forms whose evidence should build itself. */
export const ANNEXURE_FORMS = ['ASMT-10', 'DRC-01A', 'DRC-01B', 'DRC-01C'] as const;

// ── What reply_factory_status() returns ────────────────────────────────────
export interface AiReadStatus {
  settings: AiSettings | null;
  agent_online: boolean;
  spend_today_usd: number;
  queue: { queued: number; running: number; done_today: number; failed_today: number };
  consent: { clients: number; with_consent: number; opted_out: number };
  month: { calls: number; cost_usd: number; input_tokens: number; output_tokens: number };
}

export interface ReplyFactoryStatus {
  due_coverage: {
    open: number;
    covered: number;
    share: number | null;
    by_kind: Record<string, number>;
    by_source: Record<string, number>;
    missing_by_form: Record<string, number>;
  };
  annexures: {
    target_open: number;
    with_annexure: number;
    automatic: number;
    needs_data: number;
    share_automatic: number | null;
    by_form: Record<string, { open: number; automatic: number }>;
  };
  reading: {
    portal_read: number;
    portal_applied: number;
    issues_portal: number;
    issues_form: number;
    issues_extracted: number;
    issues_unverified: number;
    ai_done: number;
  };
  accuracy: {
    due_date_verified: number;
    due_date_exact: number;
    demand_verified: number;
    demand_within_1: number;
    fields_verified: number;
    fields_confirmed: number;
    fields_rejected: number;
  };
  documents: {
    open: number;
    open_over_7_days: number;
    received_90d: number;
    via_portal_90d: number;
    median_days_to_receive: number | null;
    from_catalogue: number;
  };
  ai: AiReadStatus;
  server_time: string;
}

type Loose = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const counts = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));

export function normaliseAiStatus(raw: unknown): AiReadStatus {
  const a = obj(raw);
  const q = obj(a.queue); const c = obj(a.consent); const m = obj(a.month);
  return {
    settings: a.settings && typeof a.settings === 'object' ? (a.settings as AiSettings) : null,
    agent_online: !!a.agent_online,
    spend_today_usd: num(a.spend_today_usd),
    queue: { queued: num(q.queued), running: num(q.running), done_today: num(q.done_today), failed_today: num(q.failed_today) },
    consent: { clients: num(c.clients), with_consent: num(c.with_consent), opted_out: num(c.opted_out) },
    month: { calls: num(m.calls), cost_usd: num(m.cost_usd), input_tokens: num(m.input_tokens), output_tokens: num(m.output_tokens) },
  };
}

export function normaliseFactoryStatus(raw: unknown): ReplyFactoryStatus {
  const s = obj(raw);
  const d = obj(s.due_coverage); const a = obj(s.annexures); const r = obj(s.reading);
  const acc = obj(s.accuracy); const doc = obj(s.documents);
  return {
    due_coverage: {
      open: num(d.open), covered: num(d.covered), share: numOrNull(d.share),
      by_kind: counts(d.by_kind), by_source: counts(d.by_source), missing_by_form: counts(d.missing_by_form),
    },
    annexures: {
      target_open: num(a.target_open), with_annexure: num(a.with_annexure), automatic: num(a.automatic),
      needs_data: num(a.needs_data), share_automatic: numOrNull(a.share_automatic),
      by_form: Object.fromEntries(Object.entries(obj(a.by_form)).map(([k, v]) => [k, { open: num(obj(v).open), automatic: num(obj(v).automatic) }])),
    },
    reading: {
      portal_read: num(r.portal_read), portal_applied: num(r.portal_applied), issues_portal: num(r.issues_portal),
      issues_form: num(r.issues_form), issues_extracted: num(r.issues_extracted), issues_unverified: num(r.issues_unverified),
      ai_done: num(r.ai_done),
    },
    accuracy: {
      due_date_verified: num(acc.due_date_verified), due_date_exact: num(acc.due_date_exact),
      demand_verified: num(acc.demand_verified), demand_within_1: num(acc.demand_within_1),
      fields_verified: num(acc.fields_verified), fields_confirmed: num(acc.fields_confirmed), fields_rejected: num(acc.fields_rejected),
    },
    documents: {
      open: num(doc.open), open_over_7_days: num(doc.open_over_7_days), received_90d: num(doc.received_90d),
      via_portal_90d: num(doc.via_portal_90d), median_days_to_receive: numOrNull(doc.median_days_to_receive),
      from_catalogue: num(doc.from_catalogue),
    },
    ai: normaliseAiStatus(s.ai),
    server_time: typeof s.server_time === 'string' ? s.server_time : new Date().toISOString(),
  };
}

/** Every number on the page; refreshes every 30 s. */
export function useReplyFactoryStatus() {
  return useQuery({
    queryKey: ['reply-factory-status'],
    queryFn: async (): Promise<ReplyFactoryStatus> => {
      const { data, error } = await supabase.rpc('reply_factory_status');
      if (error) throw error;
      return normaliseFactoryStatus(data);
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

// ── Labels ─────────────────────────────────────────────────────────────────
/** What an open notice's date is (notice_due_coverage().kind). */
export const COVERAGE_KINDS: { key: string; label: string; hint: string }[] = [
  { key: 'reply', label: 'Reply due date', hint: 'the date a reply is due (extended, stored or computed from the form)' },
  { key: 'hearing', label: 'Hearing date', hint: 'a hearing is fixed and no reply date is known' },
  { key: 'appeal', label: 'Appeal period', hint: "an order's appeal clock" },
  { key: 'appeal_lapsed', label: 'Appeal period over', hint: "an order whose appeal window, condonation included, has closed — review and close it" },
  { key: 'informational', label: 'No reply needed', hint: 'an acknowledgement that closes by itself' },
  { key: 'missing', label: 'No date', hint: 'nothing tells when it runs out — type the date' },
];
/** "appeal_lapsed" → "Appeal lapsed" (a kind or key the page has no words for yet). */
export const sentenceWords = (k: string) => { const w = k.replace(/_/g, ' '); return w.charAt(0).toUpperCase() + w.slice(1); };
export const coverageKindLabel = (k: string) => COVERAGE_KINDS.find((x) => x.key === k)?.label ?? sentenceWords(k);
/** The kinds to show: the known ones in their order, then any other kind the database reports. */
export const coverageKinds = (byKind: Record<string, number>) => [
  ...COVERAGE_KINDS,
  ...Object.keys(byKind).filter((k) => !COVERAGE_KINDS.some((x) => x.key === k)).map((k) => ({ key: k, label: sentenceWords(k), hint: '' })),
];

/** "portal notice list" → "Portal notice list"; null → "No date". */
export const sourceLabel = (s: string | null | undefined) => (!s || s === 'none' ? 'No date' : s.charAt(0).toUpperCase() + s.slice(1));

export const FAMILY_LABELS: Record<string, string> = {
  liability: 'Output tax',
  itc: 'Input tax credit',
  interest_fee: 'Interest and late fee',
  return: 'Returns',
  registration: 'Registration',
  refund: 'Refunds',
  procedure: 'Procedure',
  other: 'Other',
};
export const familyLabel = (f: string | null | undefined) => (f ? FAMILY_LABELS[f] ?? f : '—');

/** The evidence recipes (src/lib/reply), in words. */
export const RECIPE_LABELS: Record<string, string> = {
  gstr1_vs_3b: 'GSTR-1 v GSTR-3B, month by month',
  gstr3b_vs_2b: 'GSTR-3B v GSTR-2B, month by month and by head',
  gstr3b_vs_2a: 'GSTR-3B v GSTR-2A, supplier by supplier',
  rcm: 'Reverse charge: tax paid in cash v credit taken',
  interest: 'Interest u/s 50 on the cash portion',
  late_fee: 'Late fee u/s 47 by return and period',
  itc_16_4: 'Credit dates against the s.16(4) time limit',
  itc_17_5: 'Expenses against the s.17(5) blocked list',
  cancelled_suppliers: "Suppliers' registration status on the invoice dates",
  rule_42: 'Rules 42 / 43 reversal on the turnover split',
  gstr9_vs_3b: 'GSTR-9 v GSTR-3B for the year',
  filing_status: 'Filing status of the return',
};
export const recipeLabel = (k: string | null | undefined) => (k ? RECIPE_LABELS[k] ?? k.replace(/_/g, ' ') : null);

export const POSITION_STATUS: Record<string, { label: string; tone: Tone }> = {
  proposed: { label: 'Proposed', tone: 'secondary' },
  approved: { label: 'Approved', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
};
export const positionStatusDef = (s: string) => POSITION_STATUS[s] ?? { label: s, tone: 'secondary' as Tone };

/** An AI reading's state (notice_extractions.status). */
export const READ_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'secondary' },
  running: { label: 'Reading', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
  superseded: { label: 'Replaced by a later reading', tone: 'secondary' },
};
/** What a finished reading did (notice_extractions.outcome). */
export const READ_OUTCOME: Record<string, { label: string; tone: Tone }> = {
  applied: { label: 'Filled empty fields', tone: 'success' },
  needs_review: { label: 'Issues need review', tone: 'warning' },
  conflict: { label: 'Differs from typed values', tone: 'warning' },
  gstin_mismatch: { label: 'Addressed to another GSTIN', tone: 'destructive' },
  nothing_new: { label: 'Nothing new', tone: 'secondary' },
  rejected: { label: 'Rejected', tone: 'secondary' },
};
/** Why a reading was cancelled or failed (reason_class). */
export const READ_REASON: Record<string, string> = {
  off: 'AI reading was switched off',
  no_client: 'Client not found',
  opted_out: 'The client opted out',
  no_consent: 'No consent on file',
  no_document: 'No notice PDF to read',
  refused: 'The model declined',
  too_long: 'Too many pages',
  api_error: 'API error',
  error: 'Error',
};
export const readStateDef = (status: string, outcome: string | null) =>
  (outcome && READ_OUTCOME[outcome]) || READ_STATUS[status] || { label: status, tone: 'secondary' as Tone };
/** An outcome-or-status key (coalesce(outcome, status)) in words. */
export const readKeyDef = (k: string) => READ_OUTCOME[k] ?? READ_STATUS[k] ?? { label: k.replace(/_/g, ' '), tone: 'secondary' as Tone };
export const readReasonLabel = (r: string | null | undefined) => (r ? READ_REASON[r] ?? r.replace(/_/g, ' ') : null);

export const AUDIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: 'OK', tone: 'success' },
  refused: { label: 'Refused', tone: 'warning' },
  error: { label: 'Error', tone: 'destructive' },
};

/**
 * The models the reader may use, with Anthropic's list prices per million
 * tokens (input / output, USD) as published in September 2026 — only for the
 * "use the list price" helper; the prices saved in the settings are what the
 * estimates use.
 */
export const AI_MODELS: { id: string; note: string; priceIn: number; priceOut: number }[] = [
  { id: 'claude-opus-5-5', note: 'default, recommended', priceIn: 4, priceOut: 20 },
  { id: 'claude-sonnet-5-5', note: 'faster, lower cost', priceIn: 2, priceOut: 10 },
  { id: 'claude-haiku-4-5', note: 'lowest cost; takes no effort level', priceIn: 1, priceOut: 5 },
];
export const AI_EFFORTS: { id: string; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high (xhigh)' },
  { id: 'max', label: 'Max' },
];

/** Fields a reader fills on a notice (gst_notices.read_fields keys). */
export const READ_FIELD_LABELS: Record<string, string> = {
  due_date: 'Due date',
  demand: 'Demand',
  amount_of_demand: 'Demand total',
  section_of_law: 'Section',
  financial_year: 'Financial year',
  period_from: 'Period from',
  period_to: 'Period to',
  din: 'DIN',
  hearing_date: 'Hearing date',
  hearing_note: 'Hearing details',
  issued_by: 'Officer',
};
export const READ_FIELDS = Object.keys(READ_FIELD_LABELS);

export const ISSUE_SOURCE_LABELS: Record<string, string> = {
  portal: "Portal's case folder",
  form: 'Implied by the form',
  extracted: 'Read from the notice PDF',
  manual: 'Typed by staff',
};

// ── Money and numbers ──────────────────────────────────────────────────────
/** "$0.21"; small amounts keep more places ("$0.0333"). */
export function fmtUsd(n: number | null | undefined, places?: number): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const p = places ?? (v !== 0 && Math.abs(v) < 0.1 ? 4 : 2);
  return `$${v.toFixed(p)}`;
}
/** "$0.21 (₹18)". */
export const fmtUsdInr = (usd: number | null | undefined, rate: number | null | undefined, places?: number) =>
  (usd === null || usd === undefined ? '—' : `${fmtUsd(usd, places)} (${fmtInr(Number(usd) * Number(rate || 0))})`);
/** "41,260". */
export const fmtCount = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN'));
/** "89.8%", or "—" when there is nothing to divide. */
export const fmtShare = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1).replace(/\.0$/, '')}%`);
export const shareOf = (part: number, whole: number): number | null => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

/** Tone of a share against its target: on target, close (within 10 points), or off. */
export const targetTone = (share: number | null, target: number): 'ok' | 'warn' | 'error' | 'neutral' =>
  share === null ? 'neutral' : share >= target ? 'ok' : share >= target - 10 ? 'warn' : 'error';

/** The total of a demand by head ({"cgst": {"tax", "interest", …}}), like public.reply_demand_total. */
export function demandTotal(d: unknown): number {
  return Object.values(obj(d)).reduce<number>((sum, head) => {
    const h = obj(head);
    return sum + num(h.tax) + num(h.interest) + num(h.penalty) + num(h.fee) + num(h.others);
  }, 0);
}

/** A read field's value in words. */
export function readValueText(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'demand') return fmtInr(demandTotal(v));
  if (field === 'amount_of_demand') return fmtInr(Number(v));
  if (/_date$|^period_/.test(field) && typeof v === 'string') return fmtDate(v);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// ── Shared: the notices a list points at ───────────────────────────────────
export interface NoticeRef {
  id: string;
  client_id: string | null;
  client_name: string | null;
  client_gstin: string | null;
  reference_number: string | null;
  case_id: string | null;
  form_code: string | null;
  form_label: string | null;
  notice_type: string | null;
  description: string | null;
  financial_year: string | null;
  issue_date: string | null;
  effective_due: string | null;
  hearing_date: string | null;
  is_open: boolean | null;
}
const REF_SELECT = 'id, client_id, client_name, client_gstin, reference_number, case_id, form_code, form_label, notice_type, '
  + 'description, financial_year, issue_date, effective_due, hearing_date, is_open';

const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Notices by id (from notice_facts: removed notices are left out). */
export async function loadNoticeRefs(ids: string[]): Promise<Map<string, NoticeRef>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, NoticeRef>();
  for (const part of chunk(unique, 120)) {
    const { data, error } = await supabase.from('notice_facts').select(REF_SELECT).in('id', part);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as NoticeRef[]) out.set(r.id, r);
  }
  return out;
}

/** Every open notice (the coverage and annexure lists start here). */
export function useOpenNoticeRefs(enabled = true) {
  return useQuery({
    queryKey: ['reply-factory', 'open-notices'],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchAllRows<NoticeRef>('notice_facts', REF_SELECT, (q) => q.eq('is_open', true).order('id')),
  });
}

/** A set-returning RPC, every row (PostgREST caps a response at 1000). */
async function rpcAllRows<T>(fn: 'notice_due_coverage'): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.rpc(fn).range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

// ── (a) Due dates on open notices ──────────────────────────────────────────
export interface CoverageItem extends CoverageRow { notice: NoticeRef | null }

export function useCoverageRows(enabled = true) {
  return useQuery({
    queryKey: ['reply-factory', 'coverage'],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<CoverageItem[]> => {
      const rows = await rpcAllRows<CoverageRow>('notice_due_coverage');
      const refs = await loadNoticeRefs(rows.map((r) => r.notice_id));
      return rows.map((r) => ({ ...r, notice: refs.get(r.notice_id) ?? null }));
    },
  });
}

// ── (b) Annexures on the target forms ──────────────────────────────────────
export interface AnnexureLite {
  id: string;
  notice_id: string;
  recipe_key: string;
  version: number;
  is_current: boolean;
  status: string;
  title: string | null;
  generated_by_name: string | null;
  generated_at: string;
}
export interface AnnexureTarget {
  notice: NoticeRef;
  /** A current annexure that is ready or partial. */
  hasAnnexure: boolean;
  /** An annexure (any version) the app built without a click. */
  automatic: boolean;
  /** A current annexure waiting for portal data, and none usable. */
  needsData: boolean;
  latest: AnnexureLite | null;
}

/** Open ASMT-10 / DRC-01A / DRC-01B / DRC-01C notices and their annexures — the same tests as reply_factory_status(). */
export function useAnnexureTargets(enabled = true) {
  return useQuery({
    queryKey: ['reply-factory', 'annexure-targets'],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<AnnexureTarget[]> => {
      const notices = await fetchAllRows<NoticeRef>('notice_facts', REF_SELECT,
        (q) => q.eq('is_open', true).in('form_code', [...ANNEXURE_FORMS]).order('id'));
      const annexures: AnnexureLite[] = [];
      for (const part of chunk(notices.map((n) => n.id), 120)) {
        const rows = await fetchAllRows<AnnexureLite>('reply_annexures',
          'id, notice_id, recipe_key, version, is_current, status, title, generated_by_name, generated_at',
          (q) => q.in('notice_id', part).order('generated_at', { ascending: false }).order('id'));
        annexures.push(...rows);
      }
      const byNotice = new Map<string, AnnexureLite[]>();
      for (const a of annexures) byNotice.set(a.notice_id, [...(byNotice.get(a.notice_id) ?? []), a]);
      return notices.map((n) => {
        const list = byNotice.get(n.id) ?? [];
        const usable = (a: AnnexureLite) => a.status === 'ready' || a.status === 'partial';
        const hasAnnexure = list.some((a) => a.is_current && usable(a));
        return {
          notice: n,
          hasAnnexure,
          automatic: list.some((a) => usable(a) && a.generated_by_name === 'Auto'),
          needsData: !hasAnnexure && list.some((a) => a.is_current && a.status === 'needs_data'),
          latest: list.find((a) => a.is_current) ?? list[0] ?? null,
        };
      }).sort((a, b) => (a.notice.form_code ?? '').localeCompare(b.notice.form_code ?? '')
        || (a.notice.effective_due ?? '9999').localeCompare(b.notice.effective_due ?? '9999'));
    },
  });
}

export const ANNEXURE_STATUS: Record<string, { label: string; tone: Tone }> = {
  ready: { label: 'Ready', tone: 'success' },
  partial: { label: 'Partly built', tone: 'info' },
  needs_data: { label: 'Needs portal data', tone: 'warning' },
  not_applicable: { label: 'Not applicable', tone: 'secondary' },
  failed: { label: 'Failed', tone: 'destructive' },
};

// ── (c) Reading accuracy: the fields people verified ───────────────────────
type NoticeReadRow = {
  id: string;
  read_fields: Record<string, Loose> | null;
  demand_total: number | null;
} & Record<string, unknown>;

export interface ReadFieldRow {
  notice_id: string;
  field: string;
  value: unknown;
  current: unknown;
  verified: boolean;
  result: string | null;
  verified_by: string | null;
  verified_at: string | null;
  at: string | null;
  /** The due date read exactly, or the demand within ₹1 (the two accuracy tests). */
  exact: boolean;
  notice: NoticeRef | null;
}

/** Every field the AI reader filled, verified or not, with what it holds now. */
export function useAiReadFields(enabled = true) {
  return useQuery({
    queryKey: ['reply-factory', 'ai-fields'],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ReadFieldRow[]> => {
      const rows = await fetchAllRows<NoticeReadRow>('gst_notices', `id, read_fields, demand_total, ${READ_FIELDS.join(', ')}`,
        (q) => q.is('deleted_at', null).or(READ_FIELDS.map((f) => `read_fields->${f}->>source.eq.ai`).join(',')).order('id'));
      const out: Omit<ReadFieldRow, 'notice'>[] = [];
      for (const n of rows) {
        for (const [field, e] of Object.entries(n.read_fields ?? {})) {
          if (!e || e.source !== 'ai') continue;
          const verified = e.verified === true || e.verified === 'true';
          const result = typeof e.result === 'string' ? e.result : null;
          const exact = field === 'demand'
            ? result === 'confirmed' || Math.abs(demandTotal(e.value) - num(n.demand_total)) <= 1
            : result === 'confirmed';
          out.push({
            notice_id: n.id, field, value: e.value, current: n[field], verified, result,
            verified_by: typeof e.verified_by === 'string' ? e.verified_by : null,
            verified_at: typeof e.verified_at === 'string' ? e.verified_at : null,
            at: typeof e.at === 'string' ? e.at : null, exact,
          });
        }
      }
      const refs = await loadNoticeRefs(out.map((r) => r.notice_id));
      return out.map((r) => ({ ...r, notice: refs.get(r.notice_id) ?? null }))
        .sort((a, b) => (b.verified_at ?? b.at ?? '').localeCompare(a.verified_at ?? a.at ?? ''));
    },
  });
}

/** A field still shows "auto — verify": read by AI, not verified, and still holding what was read. */
export function isPendingVerify(r: ReadFieldRow): boolean {
  if (r.verified) return false;
  const same = r.field === 'demand'
    ? Math.abs(demandTotal(r.value) - demandTotal(r.current)) <= 0.5
    : String(r.current ?? '') === String(r.value ?? '');
  return same && r.current !== null && r.current !== undefined;
}

// ── (d) What the readers produced ──────────────────────────────────────────
export interface IssueRow {
  id: string;
  notice_id: string;
  seq: number;
  title: string;
  amount: number;
  issue_code: string | null;
  source: string;
  verified: boolean;
  page: number | null;
  created_at: string;
  notice: NoticeRef | null;
}
export type IssueFilter = 'portal' | 'form' | 'extracted' | 'unverified';

export function useIssueRows(filter: IssueFilter | null) {
  return useQuery({
    queryKey: ['reply-factory', 'issues', filter],
    enabled: !!filter,
    staleTime: 30_000,
    queryFn: async (): Promise<IssueRow[]> => {
      const rows = await fetchAllRows<Omit<IssueRow, 'notice'>>('notice_issues',
        'id, notice_id, seq, title, amount, issue_code, source, verified, page, created_at',
        (q) => (filter === 'unverified' ? q.eq('verified', false) : q.eq('source', filter)).order('created_at', { ascending: false }).order('id'));
      const refs = await loadNoticeRefs(rows.map((r) => r.notice_id));
      return rows.map((r) => ({ ...r, notice: refs.get(r.notice_id) ?? null }));
    },
  });
}

export interface ReadingRow {
  id: string;
  notice_id: string;
  source: string;
  status: string;
  outcome: string | null;
  priority: number;
  attempts: number;
  agent_id: string | null;
  finished_at: string | null;
  claimed_at: string | null;
  requested_by_name: string | null;
  document_label: string | null;
  pages: number | null;
  model: string | null;
  usage: Loose | null;
  error: string | null;
  reason_class: string | null;
  created_at: string;
  notice: NoticeRef | null;
}
const READING_SELECT = 'id, notice_id, source, status, outcome, priority, attempts, agent_id, finished_at, claimed_at, '
  + 'requested_by_name, document_label, pages, model, usage, error, reason_class, created_at';

/**
 * Readings of notices. Filters: 'portal' / 'portal_applied' (the portal
 * reader); 'queued' / 'running' / 'done_today' / 'failed_today' (the AI queue
 * counts); 'st:<status>'; 'oc:<key>' (coalesce(outcome, status), the key
 * reply_factory_status groups by); 'ai' = the last 100 AI readings.
 */
export type ReadingFilter = string;
export function readingFilterTitle(f: string): string {
  if (f === 'ai') return 'The last 100 AI readings';
  if (f === 'queued') return 'AI readings waiting in the queue';
  if (f === 'running') return 'AI readings in progress';
  if (f === 'done_today') return 'AI readings done today';
  if (f === 'failed_today') return 'AI readings that failed today';
  if (f.startsWith('st:') || f.startsWith('oc:')) return `AI readings: ${readKeyDef(f.slice(3)).label.toLowerCase()}`;
  return 'Readings';
}
export function useReadings(filter: ReadingFilter | null) {
  return useQuery({
    queryKey: ['reply-factory', 'readings', filter],
    enabled: !!filter,
    staleTime: 15_000,
    refetchInterval: filter === 'ai' || filter === 'queued' || filter === 'running' ? 20_000 : false,
    queryFn: async (): Promise<ReadingRow[]> => {
      const dayStart = new Date(`${istToday()}T00:00:00+05:30`).toISOString();
      let rows: Omit<ReadingRow, 'notice'>[];
      if (filter === 'ai') {
        const { data, error } = await supabase.from('notice_extractions').select(READING_SELECT)
          .eq('source', 'ai').order('created_at', { ascending: false }).order('id').limit(100);
        if (error) throw error;
        rows = (data ?? []) as unknown as Omit<ReadingRow, 'notice'>[];
      } else {
        rows = await fetchAllRows<Omit<ReadingRow, 'notice'>>('notice_extractions', READING_SELECT, (q) => {
          if (filter === 'portal') q = q.eq('source', 'portal');
          else if (filter === 'portal_applied') q = q.eq('source', 'portal').eq('outcome', 'applied');
          else if (filter === 'done_today' || filter === 'failed_today') {
            q = q.eq('source', 'ai').eq('status', filter === 'done_today' ? 'done' : 'failed').gte('finished_at', dayStart);
          } else if (filter === 'queued' || filter === 'running') q = q.eq('source', 'ai').eq('status', filter);
          else if (filter.startsWith('st:')) q = q.eq('source', 'ai').eq('status', filter.slice(3));
          else {
            const k = filter.replace(/^oc:/, '').replace(/[^a-z_]/g, '');
            q = q.eq('source', 'ai').or(`outcome.eq.${k},and(outcome.is.null,status.eq.${k})`);
          }
          return q.order('created_at', { ascending: false }).order('id');
        });
      }
      const refs = await loadNoticeRefs(rows.map((r) => r.notice_id));
      return rows.map((r) => ({ ...r, notice: refs.get(r.notice_id) ?? null }));
    },
  });
}

/**
 * AI readings by what became of them — coalesce(outcome, status), the key
 * reply_factory_status() uses. Counted here because the status's own
 * ai_outcomes keeps one row per (outcome, status) pair under the same key.
 */
export function useAiOutcomeCounts(enabled = true) {
  return useQuery({
    queryKey: ['reply-factory', 'ai-outcomes'],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const rows = await fetchAllRows<{ status: string; outcome: string | null }>('notice_extractions', 'status, outcome',
        (q) => q.eq('source', 'ai').order('id'));
      const out: Record<string, number> = {};
      for (const r of rows) { const k = r.outcome ?? r.status; out[k] = (out[k] ?? 0) + 1; }
      return out;
    },
  });
}

// ── (e) Client documents ───────────────────────────────────────────────────
export interface DocRequestRow {
  id: string;
  notice_id: string;
  item: string;
  status: string;
  due_date: string | null;
  requested_at: string;
  requested_by_name: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  client_uploaded_at: string | null;
  source: string;
  notice: NoticeRef | null;
}
export type DocFilter = 'open' | 'old' | 'received' | 'portal' | 'catalogue';

/** The requests behind each documents count (notices removed from the app are left out, as the status does). */
export function useDocRequestRows(filter: DocFilter | null) {
  return useQuery({
    queryKey: ['reply-factory', 'doc-requests', filter],
    enabled: !!filter,
    staleTime: 30_000,
    queryFn: async (): Promise<DocRequestRow[]> => {
      const now = Date.now();
      const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
      const rows = await fetchAllRows<Omit<DocRequestRow, 'notice'>>('notice_doc_requests',
        'id, notice_id, item, status, due_date, requested_at, requested_by_name, resolved_at, resolved_by_name, client_uploaded_at, source',
        (q) => {
          if (filter === 'open') q = q.eq('status', 'requested');
          else if (filter === 'old') q = q.eq('status', 'requested').lt('requested_at', ago(7));
          else if (filter === 'received') q = q.eq('status', 'received').gte('resolved_at', ago(90));
          else if (filter === 'portal') q = q.gte('client_uploaded_at', ago(90));
          else q = q.eq('source', 'catalogue');
          return q.order('requested_at', { ascending: true }).order('id');
        });
      const refs = await loadNoticeRefs(rows.map((r) => r.notice_id));
      return rows.filter((r) => refs.has(r.notice_id)).map((r) => ({ ...r, notice: refs.get(r.notice_id) ?? null }));
    },
  });
}

// ── Reply rules ────────────────────────────────────────────────────────────
export function useIssueTypes() {
  return useQuery({
    queryKey: ['reply-issue-types'],
    staleTime: 30_000,
    queryFn: async (): Promise<IssueType[]> => {
      const { data, error } = await supabase.from('reply_issue_types').select('*').order('sort').order('code');
      if (error) throw error;
      return (data ?? []) as IssueType[];
    },
  });
}

/** One document per line, blanks and repeats dropped. */
export function documentsFromText(text: string): string[] {
  const seen = new Set<string>();
  return text.split('\n').map((s) => s.trim().replace(/^[-•*]\s*/, '')).filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Edits the rule's position and documents. A changed position goes back to
 * "Proposed": an approval covers the words that were approved.
 */
export async function saveIssueType(t: IssueType, patch: { firm_position: string | null; documents: string[] }, actor: Actor | null) {
  const positionChanged = (patch.firm_position ?? '') !== (t.firm_position ?? '');
  const reset = positionChanged && t.position_status !== 'proposed';
  const { error } = await supabase.from('reply_issue_types').update({
    firm_position: patch.firm_position,
    documents: patch.documents,
    updated_by_name: actor?.firstName ?? null,
    ...(reset ? { position_status: 'proposed', approved_by_name: null, approved_at: null } : {}),
  }).eq('code', t.code);
  if (error) throw error;
  return { reset };
}

export async function approveIssueType(code: string, actor: Actor | null) {
  const { error } = await supabase.from('reply_issue_types').update({
    position_status: 'approved', approved_by_name: actor?.firstName ?? null, approved_at: new Date().toISOString(),
    updated_by_name: actor?.firstName ?? null,
  }).eq('code', code);
  if (error) throw error;
}

export async function requestIssueTypeChanges(code: string, actor: Actor | null) {
  const { error } = await supabase.from('reply_issue_types').update({
    position_status: 'changes_requested', approved_by_name: null, approved_at: null, updated_by_name: actor?.firstName ?? null,
  }).eq('code', code);
  if (error) throw error;
}

// ── AI reading: settings, agent, audit ─────────────────────────────────────
export async function saveAiSettings(patch: Partial<AiSettings>, actor: Actor | null): Promise<void> {
  const { id: _id, updated_at: _at, ...rest } = patch;
  const { error } = await supabase.from('ai_settings').update({ ...rest, updated_by_name: actor?.firstName ?? null }).eq('id', true);
  if (error) throw error;
}

export interface HeartbeatRow { agent_id: string; last_seen: string; info: Loose | null }
/** The office agents as they last reported (online = seen in the last 90 s, as the server counts it). */
export function useAgentHeartbeats() {
  return useQuery({
    queryKey: ['reply-factory', 'heartbeats'],
    refetchInterval: 30_000,
    staleTime: 10_000,
    queryFn: async (): Promise<HeartbeatRow[]> => {
      const { data, error } = await supabase.from('portal_agent_heartbeat').select('agent_id, last_seen, info')
        .order('last_seen', { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as HeartbeatRow[];
    },
  });
}

/**
 * What the agent says about its notice reader (heartbeat info.reader: enabled
 * — an API key is set and it is not paused —, busy, done_today,
 * last_claim_at, last_error), in words. Other shapes are read leniently.
 */
export function readerWords(info: Loose | null | undefined): { reported: boolean; parts: string[]; problem: string | null } {
  const r = info?.reader;
  if (r === undefined || r === null || r === false) return { reported: false, parts: [], problem: null };
  if (r === true) return { reported: true, parts: ['ready'], problem: null };
  if (typeof r === 'string') return { reported: true, parts: [r], problem: null };
  const o = obj(r);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const problem = str(o.last_error) ?? str(o.error);
  const parts: string[] = [];
  const on = o.enabled ?? o.active ?? o.on;
  if (on !== undefined) parts.push(on ? 'ready, API key set' : problem ? 'paused' : 'off: no API key on the office PC');
  if (on && typeof o.busy === 'boolean') parts.push(o.busy ? 'reading a notice now' : 'idle');
  if (o.done_today !== undefined && Number.isFinite(Number(o.done_today))) parts.push(`${Number(o.done_today)} read today`);
  const last = str(o.last_claim_at) ?? str(o.last_read_at);
  if (last) parts.push(`last took a notice ${fmtAgo(last)}`);
  if (typeof o.model === 'string') parts.push(o.model);
  return { reported: true, parts: parts.length ? parts : ['reported'], problem };
}

export interface AuditItem extends AuditRow { notice: NoticeRef | null }
export type AuditFilter = 'last' | 'today' | 'month';
/** The start of this IST day / month, as reply_factory_status counts "today" and "this month". */
export function istPeriodStart(kind: 'today' | 'month'): string {
  const today = istToday();
  return new Date(`${kind === 'today' ? today : `${today.slice(0, 8)}01`}T00:00:00+05:30`).toISOString();
}
/** Claude API calls: the last 100, or every call today / this month (IST). */
export function useAuditLog(filter: AuditFilter = 'last') {
  return useQuery({
    queryKey: ['reply-factory', 'audit', filter],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<AuditItem[]> => {
      let rows: AuditRow[];
      if (filter === 'last') {
        const { data, error } = await supabase.from('ai_audit_log').select('*').order('at', { ascending: false }).order('id', { ascending: false }).limit(100);
        if (error) throw error;
        rows = (data ?? []) as AuditRow[];
      } else {
        rows = await fetchAllRows<AuditRow>('ai_audit_log', '*',
          (q) => q.gte('at', istPeriodStart(filter)).order('at', { ascending: false }).order('id', { ascending: false }));
      }
      const refs = await loadNoticeRefs(rows.map((r) => r.notice_id ?? ''));
      return rows.map((r) => ({ ...r, notice: r.notice_id ? refs.get(r.notice_id) ?? null : null }));
    },
  });
}

// ── Client consent ─────────────────────────────────────────────────────────
export interface ConsentClient {
  id: string;
  name: string;
  gstin: string;
  ai_consent_at: string | null;
  ai_consent_note: string | null;
  ai_opt_out: boolean;
}
/** Active clients (as ai_read_status counts them). */
export function useConsentClients() {
  return useQuery({
    queryKey: ['reply-factory', 'consent-clients'],
    staleTime: 30_000,
    queryFn: () => fetchAllRows<ConsentClient>('clients', 'id, name, gstin, ai_consent_at, ai_consent_note, ai_opt_out',
      (q) => q.eq('inactive_at_hand', false).order('name').order('id')),
  });
}
export type ConsentState = 'with' | 'without' | 'opted_out';
export const consentState = (c: ConsentClient): ConsentState => (c.ai_opt_out ? 'opted_out' : c.ai_consent_at ? 'with' : 'without');

/**
 * Consent in bulk (ai_set_consent): mark = consent date and note, opt-out
 * cleared; withdraw = no consent; opt_out = no consent and opted out.
 */
export async function setConsent(ids: string[], action: 'mark' | 'withdraw' | 'opt_out', date?: string, note?: string): Promise<number> {
  const args = action === 'mark'
    ? { p_client_ids: ids, p_consent_at: date ?? istToday(), p_note: note?.trim() || null, p_opt_out: false }
    : { p_client_ids: ids, p_consent_at: null, p_note: null, p_opt_out: action === 'opt_out' ? true : null };
  const { data, error } = await supabase.rpc('ai_set_consent', args);
  if (error) throw error;
  return Number(data ?? 0);
}

// ── Client portal: documents the firm asked for ────────────────────────────
export function useClientDocRequests(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ['client-doc-requests', clientId ?? null],
    enabled: !!clientId,
    staleTime: 15_000,
    queryFn: async (): Promise<ClientDocRequest[]> => {
      const { data, error } = await supabase.rpc('client_doc_requests', { p_client_id: clientId as string });
      if (error) throw error;
      return (data ?? []) as ClientDocRequest[];
    },
  });
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** PDF, images, Excel, Word and zip. */
export const UPLOAD_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff',
  'xls', 'xlsx', 'xlsm', 'csv', 'doc', 'docx', 'zip'];
export const UPLOAD_ACCEPT = `${UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(',')},application/pdf,image/*`;

/** Why this file cannot be sent, in plain words; null when it can. */
export function uploadProblem(file: File): string | null {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) return 'Please choose a PDF, a photo or scan, an Excel or Word file, or a zip file.';
  if (file.size > MAX_UPLOAD_BYTES) return `This file is ${(file.size / 1048576).toFixed(1)} MB. Files can be up to 20 MB — please split it or send a zip.`;
  if (file.size === 0) return 'This file is empty.';
  return null;
}

const BUCKET = 'return-pdfs';

/**
 * The client's upload for one request: the file goes to storage, a document
 * row is added to the notice (kind client, from the client portal), and the
 * request is marked received with it.
 */
export async function uploadClientDocument(
  req: Pick<ClientDocRequest, 'request_id' | 'notice_id'>, file: File, note: string, client: { id: string; name: string },
): Promise<'received' | 'replaced' | 'gone' | 'no_document'> {
  const problem = uploadProblem(file);
  if (problem) throw new Error(problem);
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `notices/${client.id}/client-uploads/${req.notice_id}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('matter_documents').insert({
    notice_id: req.notice_id, matter_id: null, kind: 'client', title: file.name, storage_path: path,
    mime: file.type || null, size_bytes: file.size, source: 'client_portal', uploaded_by_name: client.name,
  }).select('id').single();
  if (error) throw error;
  const { data: res, error: rpcErr } = await supabase.rpc('client_doc_request_upload', {
    p_request_id: req.request_id, p_client_id: client.id, p_document_id: data.id, p_note: note.trim() || null, p_client_name: client.name,
  });
  if (rpcErr) throw rpcErr;
  return ((res as string | null) ?? 'gone') as 'received' | 'replaced' | 'gone' | 'no_document';
}

/** "Due today", "Overdue by 2 days", "Needed by 08 Oct 2026". */
export function neededByWords(due: string | null | undefined): { text: string; overdue: boolean; soon: boolean } {
  if (!due) return { text: 'As soon as you can', overdue: false, soon: false };
  const today = istToday();
  if (due < today) {
    const days = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
    return { text: `Overdue by ${days} ${days === 1 ? 'day' : 'days'} (was needed by ${fmtDate(due)})`, overdue: true, soon: false };
  }
  if (due === today) return { text: 'Needed today', overdue: false, soon: true };
  return { text: `Needed by ${fmtDate(due)}`, overdue: false, soon: due <= addDays(today, 2) };
}
