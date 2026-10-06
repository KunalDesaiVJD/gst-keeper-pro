// Loading a notice's evidence: the notice, its issues and the issue codes, the
// client, then the portal data every planned recipe needs — one query per
// table for the whole range of months (never a round trip per month). A table
// the app cannot read (an optional statement) is noted, not fatal; the
// returns themselves (gst_filed_returns) must be readable.
import { supabase } from '@/integrations/supabase/client';
import { istToday } from '@/lib/noticeFacts';
import { pnum } from '@/lib/gstr9/portalParser';
import type {
  AnnualWorking, ClientLite, Drc03Row, FiledReturn, FiledType, FilingStatusRow, HeadAmounts, IssueLite, IssueTypeLite, NoticeLite,
  PortalData, RcmStatementRow, ReclaimRow, TurnoverRow,
} from './types';
import { computeEvidence, contextsOf, type EvidenceCard, type EvidenceInputs } from './evidence';
import { loadNeeds, type Plan } from './registry';
import { fyLong, normalizeFy } from './periods';

export interface SavedAnnexure {
  id: string;
  issueId: string | null;
  recipe: string;
  version: number;
  isCurrent: boolean;
  status: string;
  title: string | null;
  periods: string[];
  financialYear: string | null;
  inputsHash: string | null;
  explained: number | null;
  toPay: number | null;
  generatedBy: string | null;
  generatedAt: string;
}

export interface EvidenceBundle {
  inputs: EvidenceInputs;
  cards: EvidenceCard[];
  uncovered: Plan['uncovered'];
  saved: SavedAnnexure[];
  errors: string[];
}

type Obj = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const heads = (o: Obj, prefix: string): HeadAmounts => ({
  igst: pnum(o[`${prefix}_igst`]), cgst: pnum(o[`${prefix}_cgst`]), sgst: pnum(o[`${prefix}_sgst`]), cess: pnum(o[`${prefix}_cess`]),
});

const FILED_COLS = 'id, period_month, return_type, arn, filed_date, status, summary, updated_at';

const toFiled = (r: Obj): FiledReturn => ({
  id: String(r.id), period: String(r.period_month), type: String(r.return_type) as FiledType, arn: s(r.arn), filedDate: s(r.filed_date),
  status: s(r.status), summary: r.summary ?? {}, updatedAt: s(r.updated_at),
});

export const toNotice = (r: Obj): NoticeLite => ({
  id: String(r.id), clientId: String(r.client_id), formCode: s(r.form_code), referenceNumber: s(r.reference_number), issueDate: s(r.issue_date),
  financialYear: s(r.financial_year), periodFrom: s(r.period_from), periodTo: s(r.period_to), demand: r.demand ?? null,
  demandTotal: n(r.demand_total), amountOfDemand: n(r.amount_of_demand),
});

export const toIssue = (r: Obj): IssueLite => ({
  id: String(r.id), seq: Number(r.seq ?? 0), title: String(r.title ?? ''), issueCode: s(r.issue_code), amount: Number(r.amount ?? 0),
  explainedAmount: Number(r.explained_amount ?? 0), explainedBy: s(r.explained_by), periodFrom: s(r.period_from), periodTo: s(r.period_to),
  demand: r.demand ?? null, status: String(r.status ?? 'open'),
});

const toClient = (r: Obj | null, id: string): ClientLite => ({
  id, name: s(r?.name) ?? 'Client', gstin: s(r?.gstin), dueDay1: n(r?.target_date_group1), dueDay2: n(r?.target_date_group2),
});

const toSaved = (r: Obj): SavedAnnexure => ({
  id: String(r.id), issueId: s(r.issue_id), recipe: String(r.recipe_key), version: Number(r.version), isCurrent: !!r.is_current,
  status: String(r.status), title: s(r.title), periods: Array.isArray(r.periods) ? (r.periods as string[]) : [], financialYear: s(r.financial_year),
  inputsHash: s(r.inputs_hash), explained: n(r.explained_amount), toPay: n(r.to_pay_amount), generatedBy: s(r.generated_by_name),
  generatedAt: String(r.generated_at),
});

export const SAVED_COLS = 'id, issue_id, recipe_key, version, is_current, status, title, periods, financial_year, inputs_hash, explained_amount, to_pay_amount, generated_by_name, generated_at';

/** The notice side: notice, issues, issue codes, client, linked DRC-03s and saved versions. */
export async function loadNoticeSide(noticeId: string) {
  const [noticeRes, issuesRes, typesRes, payRes, savedRes] = await Promise.all([
    supabase.from('gst_notices')
      .select('id, client_id, form_code, reference_number, issue_date, financial_year, period_from, period_to, demand, demand_total, amount_of_demand, deleted_at')
      .eq('id', noticeId).maybeSingle(),
    supabase.from('notice_issues').select('*').eq('notice_id', noticeId).order('seq').order('created_at'),
    supabase.from('reply_issue_types').select('code, title, recipe_key, documents, forms, is_active').order('sort'),
    supabase.from('notice_payments').select('drc03_arn, kind').eq('notice_id', noticeId),
    supabase.from('reply_annexures').select(SAVED_COLS).eq('notice_id', noticeId).order('generated_at', { ascending: false }),
  ]);
  for (const r of [noticeRes, issuesRes, typesRes, payRes, savedRes]) if (r.error) throw new Error(r.error.message);
  const nrow = noticeRes.data as Obj | null;
  if (!nrow || nrow.deleted_at) throw new Error('This notice is not on record.');
  const notice = toNotice(nrow);
  const clientRes = await supabase.from('clients').select('*').eq('id', notice.clientId).maybeSingle();
  if (clientRes.error) throw new Error(clientRes.error.message);
  const types: IssueTypeLite[] = ((typesRes.data ?? []) as Obj[]).filter((t) => t.is_active !== false).map((t) => ({
    code: String(t.code), title: String(t.title), recipeKey: s(t.recipe_key),
    documents: Array.isArray(t.documents) ? (t.documents as string[]) : [], forms: Array.isArray(t.forms) ? (t.forms as string[]) : [],
  }));
  return {
    notice,
    client: toClient(clientRes.data as Obj | null, notice.clientId),
    issues: ((issuesRes.data ?? []) as Obj[]).map(toIssue),
    types,
    linkedDrc03: ((payRes.data ?? []) as Obj[]).filter((p) => p.kind === 'drc03' && p.drc03_arn).map((p) => String(p.drc03_arn)),
    saved: ((savedRes.data ?? []) as Obj[]).map(toSaved),
  };
}

/** Everything the planned recipes read, one query per table. */
export async function loadPortalData(clientId: string, needs: ReturnType<typeof loadNeeds>): Promise<PortalData> {
  const errors: string[] = [];
  const optional = async <T,>(label: string, run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, map: (r: Obj) => T): Promise<T[] | null> => {
    const { data, error } = await run();
    if (error) { errors.push(`${label}: ${error.message}`); return null; }
    return ((data ?? []) as Obj[]).map(map);
  };
  const groups = (Object.entries(needs.filed) as [FiledType, string[]][]).filter(([, ms]) => ms.length);
  const orFilter = groups.map(([t, ms]) => `and(return_type.eq.${t},period_month.in.(${ms.join(',')}))`).join(',');
  const fys = [...new Set([...needs.reclaimFys, ...needs.rcmStatementFys])];

  const [filed, gstr9, filingStatus, reclaims, rcmStatement, drc03, turnover, annual] = await Promise.all([
    groups.length
      ? supabase.from('gst_filed_returns').select(FILED_COLS).eq('client_id', clientId).or(orFilter)
      : Promise.resolve({ data: [], error: null }),
    needs.gstr9
      ? optional('GSTR-9', () => supabase.from('gst_filed_returns').select('id, period_month, return_type, arn, filed_date, status, updated_at').eq('client_id', clientId).eq('return_type', 'GSTR9_CALC'),
        (r) => toFiled({ ...r, summary: {} }))
      : Promise.resolve([] as FiledReturn[]),
    needs.filingStatus || needs.gstr9
      ? optional<FilingStatusRow>('Filing Status', () => supabase.from('filing_status').select('id, return_type, period_month, status, filed_date, arn, target_date, updated_at').eq('client_id', clientId)
        .in('return_type', ['GSTR-1', 'GSTR-3B', 'GSTR-1 (IFF)', 'GSTR-3B (Q)', 'GSTR-9']),
      (r) => ({ id: String(r.id), returnType: String(r.return_type), period: String(r.period_month), status: s(r.status), filedDate: s(r.filed_date), arn: s(r.arn), targetDate: n(r.target_date), updatedAt: s(r.updated_at) }))
      : Promise.resolve([] as FilingStatusRow[]),
    needs.reclaimFys.length
      ? optional<ReclaimRow>('Credit reversal and re-claimed statement', () => supabase.from('gst_credit_reversal_reclaim_entries').select('*').eq('client_id', clientId).in('financial_year', needs.reclaimFys.map(fyLong)).order('transaction_date', { ascending: true }),
        (r) => ({ id: String(r.id), financialYear: String(r.financial_year), period: s(r.return_period), isOpening: !!r.is_opening_balance, description: s(r.description),
          claimed: heads(r, 'itc_claimed'), reversed: heads(r, 'itc_reversed'), reclaimed: heads(r, 'itc_reclaimed'), closing: heads(r, 'closing_balance'), pulledAt: s(r.pulled_at) }))
      : Promise.resolve([] as ReclaimRow[]),
    needs.rcmStatementFys.length
      ? optional<RcmStatementRow>('RCM liability / ITC statement', () => supabase.from('gst_rcm_liability_itc_entries').select('id, financial_year, return_period, is_opening_balance, description, closing_balance_igst, closing_balance_cgst, closing_balance_sgst, closing_balance_cess, pulled_at, transaction_date')
        .eq('client_id', clientId).in('financial_year', needs.rcmStatementFys.map(fyLong)).order('transaction_date', { ascending: true }),
      (r) => ({ id: String(r.id), financialYear: String(r.financial_year), period: s(r.return_period), isOpening: !!r.is_opening_balance, description: s(r.description), closing: heads(r, 'closing_balance'), pulledAt: s(r.pulled_at) }))
      : Promise.resolve([] as RcmStatementRow[]),
    needs.drc03
      ? optional<Drc03Row>('DRC-03', () => supabase.from('gst_drc03_filings').select('id, arn, cause_of_payment, filed_date, period_from, period_to, cash_amount, credit_amount, igst_amount, cgst_amount, sgst_amount, cess_amount, status, updated_at')
        .eq('client_id', clientId).is('deleted_at', null),
      (r) => {
        const h = { igst: pnum(r.igst_amount), cgst: pnum(r.cgst_amount), sgst: pnum(r.sgst_amount), cess: pnum(r.cess_amount) };
        const total = pnum(r.cash_amount) + pnum(r.credit_amount);
        const anyHead = ['igst_amount', 'cgst_amount', 'sgst_amount', 'cess_amount'].some((k) => r[k] !== null && r[k] !== undefined);
        // A summary-only row (heads blank, or all zero against a paid total) does not split the tax by head.
        const split = anyHead && (h.igst + h.cgst + h.sgst + h.cess > 0 || total === 0);
        return {
          id: String(r.id), arn: s(r.arn), cause: s(r.cause_of_payment), filedDate: s(r.filed_date), periodFrom: s(r.period_from), periodTo: s(r.period_to),
          heads: split ? h : null, total, status: s(r.status), updatedAt: s(r.updated_at),
        };
      })
      : Promise.resolve([] as Drc03Row[]),
    needs.turnover
      ? optional<TurnoverRow>('Annual turnover', () => supabase.from('client_annual_turnover').select('id, financial_year, aggregate_turnover, exempt_turnover, itc_directly_attributable_exempt, updated_at').eq('client_id', clientId),
        (r) => ({ id: String(r.id), financialYear: normalizeFy(String(r.financial_year)) ?? String(r.financial_year), aggregate: n(r.aggregate_turnover), exempt: n(r.exempt_turnover), directExempt: n(r.itc_directly_attributable_exempt), updatedAt: s(r.updated_at) }))
      : Promise.resolve([] as TurnoverRow[]),
    needs.annualFys.length
      ? optional<{ fy: string; key: string; data: unknown; at: string }>('Annual Return working', () => supabase.from('annual_return_docs').select('financial_year, doc_key, data, updated_at').eq('client_id', clientId).in('financial_year', needs.annualFys),
        (r) => ({ fy: String(r.financial_year), key: String(r.doc_key), data: r.data, at: String(r.updated_at) }))
      : Promise.resolve([] as { fy: string; key: string; data: unknown; at: string }[]),
  ]);
  if ('error' in filed && filed.error) throw new Error(`The returns pulled from the portal could not be read: ${filed.error.message}`);
  const byFy = new Map<string, AnnualWorking>();
  for (const d of annual ?? []) {
    const w = byFy.get(d.fy) ?? { financialYear: d.fy, docs: {}, updatedAt: {} };
    w.docs[d.key] = d.data;
    w.updatedAt[d.key] = d.at;
    byFy.set(d.fy, w);
  }
  return {
    filed: (((filed as { data: unknown }).data ?? []) as Obj[]).map(toFiled),
    gstr9: gstr9 ?? [],
    filingStatus,
    reclaims,
    reclaimFys: needs.reclaimFys,
    rcmStatement,
    drc03,
    turnover,
    annual: annual === null ? null : [...byFy.values()],
    errors,
  };
}

/** A notice's evidence, computed: what the Evidence tab shows and the batch builder saves. */
export async function loadEvidence(noticeId: string, today: string = istToday()): Promise<EvidenceBundle> {
  const side = await loadNoticeSide(noticeId);
  const base = { notice: side.notice, client: side.client, issues: side.issues, types: side.types, linkedDrc03: side.linkedDrc03, today };
  const { ctxs } = contextsOf(base);
  const data = await loadPortalData(side.notice.clientId, loadNeeds(ctxs));
  const inputs: EvidenceInputs = { ...base, data };
  const { cards, uncovered } = computeEvidence(inputs);
  return { inputs, cards, uncovered, saved: side.saved, errors: data.errors };
}

/** The saved versions of a notice's workings (light: no tables). */
export async function loadSavedAnnexures(noticeId: string): Promise<SavedAnnexure[]> {
  const { data, error } = await supabase.from('reply_annexures').select(SAVED_COLS).eq('notice_id', noticeId).order('generated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Obj[]).map(toSaved);
}

/** One saved version in full (to view or export an earlier one). */
export async function loadAnnexureVersion(id: string) {
  const { data, error } = await supabase.from('reply_annexures').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
