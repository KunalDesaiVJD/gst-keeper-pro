// Loaders for the Refunds and DRC-03 ledgers (audit U-75-2, U-77-2, U-77-3).
// Rows are public.refund_facts / public.drc03_facts (each case once: the
// application or filing, plus the portal cases no record covers), joined in
// the browser with what the page needs beside them: the refund's case folder
// (dates, and whether there is a folder to open), the case on the notices
// side (our stage) and, for a DRC-03, the notice or matter it was paid
// against, or the one it most likely settles.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { istToday, type Drc03Fact, type RefundFact } from '@/lib/noticeFacts';
import { fmtFy } from '@/lib/noticeFormat';
import {
  drc03State, folderSignals, refundState,
  type Drc03State, type FolderItemLite, type FolderSignals, type LinkedCase, type RefundState,
} from './ledgerStatus';

const chunks = <T,>(xs: T[], n = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const uniq = <T,>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined && x !== ''))];
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
const byClient = (clientId?: string) => (q: Q) => (clientId ? q.eq('client_id', clientId) : q);

async function folderItems(arns: string[]): Promise<FolderItemLite[]> {
  const out: FolderItemLite[] = [];
  for (const part of chunks(arns)) {
    const { data, error } = await supabase.from('gst_case_folder_items')
      .select('client_id, case_id, folder_section, raw_json').in('case_id', part).is('deleted_at', null);
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

interface CaseLink extends LinkedCase { client_id: string | null; case_id: string | null; stage_changed_at: string | null; stage_changed_by: string | null; pdf_url: string | null }

// ── Refunds ─────────────────────────────────────────────────────────────────
export interface RefundDoc { label: string; url: string }

export interface RefundRow {
  key: string;
  fact: RefundFact;
  state: RefundState;
  /** The case on the notices side (stage, workspace link). */
  caseLink: CaseLink | null;
  hasFolder: boolean;
  docs: RefundDoc[];
}

function refundDocs(f: RefundFact, c: CaseLink | null): RefundDoc[] {
  const list = Array.isArray(f.documents) ? (f.documents as { label?: string; url?: string; tab?: string }[]) : [];
  const docs = list.filter((d) => typeof d?.url === 'string' && /^https?:\/\//.test(d.url))
    .map((d, i) => ({ label: d.label || d.tab || `Document ${i + 1}`, url: d.url as string }));
  if (!docs.length && c?.pdf_url) docs.push({ label: 'Case PDF', url: c.pdf_url });
  return docs;
}

export async function loadRefundLedger(clientId?: string): Promise<RefundRow[]> {
  const today = istToday();
  const [facts, cases] = await Promise.all([
    fetchAllRows<RefundFact>('refund_facts', '*', (q: Q) => byClient(clientId)(q).order('filed_date', { ascending: false }).order('id')),
    fetchAllRows<CaseLink>('notice_facts', 'id, client_id, case_id, is_open, close_reason, stage, stage_changed_at, stage_changed_by, pdf_url',
      (q: Q) => byClient(clientId)(q).eq('is_refund_case', true).order('id')),
  ]);
  const items = await folderItems(uniq(facts.map((f) => f.arn)));
  const folder = new Map<string, FolderItemLite[]>();
  items.forEach((it) => { const k = `${it.client_id}|${it.case_id}`; folder.set(k, [...(folder.get(k) ?? []), it]); });
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const caseByArn = new Map(cases.filter((c) => c.case_id).map((c) => [`${c.client_id}|${c.case_id}`, c]));
  return facts.map((f, i) => {
    const k = `${f.client_id}|${f.arn}`;
    const signals: FolderSignals | undefined = f.arn && folder.has(k) ? folderSignals(folder.get(k) as FolderItemLite[]) : undefined;
    const caseLink = (f.origin === 'case' && f.notice_id ? caseById.get(f.notice_id) : caseByArn.get(k)) ?? null;
    return {
      key: `${f.origin}-${f.id ?? i}`,
      fact: f,
      state: refundState(f, signals, caseLink ?? undefined, today),
      caseLink,
      hasFolder: !!signals && signals.items > 0,
      docs: refundDocs(f, caseLink),
    };
  });
}

// ── DRC-03 ──────────────────────────────────────────────────────────────────
interface FilingDetail {
  id: string;
  financial_year: string | null;
  section: string | null;
  period_from: string | null;
  period_to: string | null;
  igst_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  cess_amount: number | null;
  interest_amount: number | null;
  late_fee_amount: number | null;
  penalty_amount: number | null;
  cash_amount: number | null;
  credit_amount: number | null;
}

export interface NoticeRef {
  id: string;
  client_id: string | null;
  form_code: string | null;
  form_label: string | null;
  notice_type: string | null;
  description: string | null;
  financial_year: string | null;
  reference_number: string | null;
  case_id: string | null;
  issue_date: string | null;
  is_open: boolean | null;
  stage: string | null;
}

export interface MatterRef { id: string; client_id: string; matter_no: string; title: string | null; stage: string; status: string; financial_years: string[] | null }

export type Heads = { igst: number | null; cgst: number | null; sgst: number | null; cess: number | null; interest: number | null; lateFee: number | null; penalty: number | null };

export interface Drc03Row {
  key: string;
  fact: Drc03Fact;
  state: Drc03State;
  section: string | null;
  fy: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  heads: Heads | null;
  cash: number | null;
  credit: number | null;
  /** Tax + interest + penalty + late fee; null when no figure was captured. */
  total: number | null;
  /** The case on the notices side for a case-only row. */
  caseNotice: NoticeRef | null;
  /** The portal case folder for this ARN has been captured. */
  hasFolder: boolean;
  against: { notices: NoticeRef[]; matters: MatterRef[] };
  suggestion: { kind: 'notice'; notice: NoticeRef } | { kind: 'matter'; matter: MatterRef } | null;
}

const NOTICE_COLS = 'id, client_id, form_code, form_label, notice_type, description, financial_year, reference_number, case_id, issue_date, is_open, stage';

/** The forms a DRC-03 of this cause usually settles, most likely first (finding R-21). */
export function formsForCause(cause: string | null, section: string | null): string[] {
  const c = `${cause ?? ''} ${section ?? ''}`.toLowerCase();
  if (/107\s*\(6\)|pre-?deposit/.test(c)) return ['DRC-07', 'APL-04'];
  if (/drc-?01a|intimation/.test(c)) return ['DRC-01A'];
  if (/liability mismatch|gstr-1 to gstr-3b|drc-?01b/.test(c)) return ['DRC-01B'];
  if (/itc mismatch|2b|drc-?01c/.test(c)) return ['DRC-01C'];
  if (/\bscn\b|show cause/.test(c)) return ['DRC-01', 'DRC-01A', 'ASMT-14'];
  if (/audit/.test(c)) return ['ADT-02', 'ADT-01'];
  if (/scrutiny|asmt/.test(c)) return ['ASMT-10'];
  if (/voluntary/.test(c)) return ['ASMT-10', 'DRC-01A', 'DRC-01B', 'DRC-01C', 'DRC-01'];
  return [];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (iso: string | null) => (iso && /^\d{4}-\d{2}/.test(iso) ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : null);

/** "Apr 2021 – Mar 2022" for the tax period a DRC-03 covers. */
export function periodText(r: Pick<Drc03Row, 'periodFrom' | 'periodTo'>): string | null {
  const a = month(r.periodFrom);
  const b = month(r.periodTo);
  return a && b ? (a === b ? a : `${a} – ${b}`) : a ?? b ?? null;
}

async function selectIn<T>(table: 'notice_facts' | 'litigation_matters' | 'notice_payments' | 'matter_payments' | 'gst_drc03_filings',
  cols: string, column: string, values: string[], extra: (q: Q) => Q = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(values)) {
    const query: Q = supabase.from(table as never).select(cols);
    const { data, error } = await extra(query.in(column, part));
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function loadDrc03Ledger(clientId?: string): Promise<Drc03Row[]> {
  const facts = await fetchAllRows<Drc03Fact>('drc03_facts', '*', (q: Q) => byClient(clientId)(q).order('filed_date', { ascending: false }).order('id'));
  const filingIds = uniq(facts.filter((f) => f.origin === 'filing').map((f) => f.id));
  const arns = uniq(facts.map((f) => f.arn));
  const caseNoticeIds = uniq(facts.filter((f) => f.origin === 'case').map((f) => f.notice_id));
  const [details, noticePays, matterPays, folders] = await Promise.all([
    selectIn<FilingDetail>('gst_drc03_filings', 'id, financial_year, section, period_from, period_to, igst_amount, cgst_amount, sgst_amount, cess_amount, '
      + 'interest_amount, late_fee_amount, penalty_amount, cash_amount, credit_amount', 'id', filingIds),
    selectIn<{ notice_id: string; drc03_arn: string | null }>('notice_payments', 'notice_id, drc03_arn', 'drc03_arn', arns, (q) => q.eq('kind', 'drc03')),
    selectIn<{ matter_id: string; drc03_arn: string | null }>('matter_payments', 'matter_id, drc03_arn', 'drc03_arn', arns),
    folderItems(arns),
  ]);
  const withFolder = new Set(folders.map((f) => `${f.client_id}|${f.case_id}`));
  const detailById = new Map(details.map((d) => [d.id, d]));

  // Unlinked filings: the open notices / matters of those clients that could be what they settle.
  const linkedArns = new Set([...noticePays, ...matterPays].map((p) => p.drc03_arn));
  const looseClients = uniq(facts.filter((f) => f.origin === 'filing' && !linkedArns.has(f.arn)).map((f) => f.client_id));
  const forms = uniq(facts.flatMap((f) => formsForCause(f.cause_of_payment, f.id ? detailById.get(f.id)?.section ?? null : null)));
  const [linkedNotices, linkedMatters, candidates, openMatters] = await Promise.all([
    selectIn<NoticeRef>('notice_facts', NOTICE_COLS, 'id', uniq([...noticePays.map((p) => p.notice_id), ...caseNoticeIds])),
    selectIn<MatterRef>('litigation_matters', 'id, client_id, matter_no, title, stage, status, financial_years', 'id', uniq(matterPays.map((p) => p.matter_id))),
    forms.length ? selectIn<NoticeRef>('notice_facts', NOTICE_COLS, 'client_id', looseClients, (q) => q.eq('is_open', true).in('form_code', forms)) : Promise.resolve([]),
    selectIn<MatterRef>('litigation_matters', 'id, client_id, matter_no, title, stage, status, financial_years', 'client_id', looseClients, (q) => q.neq('status', 'Closed')),
  ]);
  const noticeById = new Map(linkedNotices.map((n) => [n.id, n]));
  const matterById = new Map(linkedMatters.map((m) => [m.id, m]));

  return facts.map((f, i) => {
    const d = f.origin === 'filing' && f.id ? detailById.get(f.id) : undefined;
    const heads: Heads | null = d ? {
      igst: num(d.igst_amount), cgst: num(d.cgst_amount), sgst: num(d.sgst_amount), cess: num(d.cess_amount),
      interest: num(d.interest_amount), lateFee: num(d.late_fee_amount), penalty: num(d.penalty_amount),
    } : null;
    const headValues = heads ? Object.values(heads).filter((v): v is number => v !== null) : [];
    const cash = d ? num(d.cash_amount) : null;
    const credit = d ? num(d.credit_amount) : null;
    const total = headValues.length ? headValues.reduce((a, b) => a + b, 0)
      : cash !== null || credit !== null ? (cash ?? 0) + (credit ?? 0) : null;
    const caseNotice = f.origin === 'case' && f.notice_id ? noticeById.get(f.notice_id) ?? null : null;
    const against = {
      notices: noticePays.filter((p) => p.drc03_arn === f.arn).map((p) => noticeById.get(p.notice_id)).filter((n): n is NoticeRef => !!n && n.client_id === f.client_id),
      matters: matterPays.filter((p) => p.drc03_arn === f.arn).map((p) => matterById.get(p.matter_id)).filter((m): m is MatterRef => !!m && m.client_id === f.client_id),
    };
    let suggestion: Drc03Row['suggestion'] = null;
    if (f.origin === 'filing' && !against.notices.length && !against.matters.length) {
      const section = d?.section ?? null;
      const fy = fmtFy(d?.financial_year ?? null);
      if (/107\s*\(6\)|pre-?deposit/i.test(`${f.cause_of_payment ?? ''} ${section ?? ''}`)) {
        const m = openMatters.filter((x) => x.client_id === f.client_id && ['appeal', 'order'].includes(x.stage))
          .sort((a, b) => Number((b.financial_years ?? []).map(fmtFy).includes(fy)) - Number((a.financial_years ?? []).map(fmtFy).includes(fy)))[0];
        if (m) suggestion = { kind: 'matter', matter: m };
      }
      if (!suggestion) {
        const want = formsForCause(f.cause_of_payment, section);
        const pick = candidates
          // Same client, a form that fits the cause, and the same year: without a year there is no suggestion.
          .filter((n) => n.client_id === f.client_id && want.includes(n.form_code ?? '') && !!fy && fmtFy(n.financial_year) === fy)
          .sort((a, b) => {
            const byForm = want.indexOf(a.form_code ?? '') - want.indexOf(b.form_code ?? '');
            if (byForm) return byForm;
            const before = (n: NoticeRef) => (n.issue_date && f.filed_date && n.issue_date <= f.filed_date ? 0 : 1);
            return before(a) - before(b) || (b.issue_date ?? '').localeCompare(a.issue_date ?? '');
          })[0];
        if (pick) suggestion = { kind: 'notice', notice: pick };
      }
    }
    return {
      key: `${f.origin}-${f.id ?? i}`,
      fact: f,
      state: drc03State(f.origin, f.status, caseNotice?.is_open ?? null),
      section: d?.section ?? null,
      fy: d?.financial_year ?? caseNotice?.financial_year ?? null,
      periodFrom: d?.period_from ?? null,
      periodTo: d?.period_to ?? null,
      heads, cash, credit, total, caseNotice, against, suggestion,
      hasFolder: withFolder.has(`${f.client_id}|${f.arn}`),
    };
  });
}

// ── Queries (one cache for the ledgers and the Notice summary's ledger card) ─
export const useRefundLedger = (clientId?: string) =>
  useQuery({ queryKey: ['refund-ledger', clientId ?? 'all'], queryFn: () => loadRefundLedger(clientId), staleTime: 30_000 });

export const useDrc03Ledger = (clientId?: string) =>
  useQuery({ queryKey: ['drc03-ledger', clientId ?? 'all'], queryFn: () => loadDrc03Ledger(clientId), staleTime: 30_000 });
