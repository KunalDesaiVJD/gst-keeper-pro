// Reading a portal case folder (gst_case_folder_items.raw_json) into plain facts:
// what kind of case it is, decided from the items' forms and the case type rather
// than the folder code (audit U-62-1), one dated event per item in words (U-60-2,
// U-61-1, U-62-3, U-63-1), the portal's status apart from our stage (U-60-5) and
// the things that need a person (U-63-2). Field paths are the ones the extension
// captures (see the old AdditionalNoticeFolderPage notes, confirmed live Aug–Sep 2026).
import type { Database } from '@/integrations/supabase/types';
import { portalDateToIso } from '@/components/notices/workspace/DocumentsTab';
import { daysBetween } from '@/lib/noticeFacts';
import { fmtDate, fmtInr, sentenceCase } from '@/lib/noticeFormat';

export type FolderItem = Database['public']['Tables']['gst_case_folder_items']['Row'];
type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const first = (o: Obj, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');
/** "1,12,400" / 112400 → 112400. */
const money = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[₹,\s]/g, '')) : NaN;
  return Number.isFinite(n) && n !== 0 ? n : null;
};

// ── Sections ───────────────────────────────────────────────────────────────
const CODE: Record<string, string> = {
  INTIM: 'INTIM', INTIMATIONS: 'INTIM', NOTCE: 'NOTCE', NOTICE: 'NOTCE', NOTICES: 'NOTCE', REPLY: 'REPLY', REPLIES: 'REPLY',
  ORDRS: 'ORDRS', ORDER: 'ORDRS', ORDERS: 'ORDRS', CLSR: 'CLSR', CLOSR: 'CLSR', CLOSURE: 'CLSR', APLCN: 'APLCN', NOTAC: 'NOTAC', DRC7A: 'DRC7A',
};
export const sectionCode = (s: string | null | undefined) => CODE[(s || '').toUpperCase()] ?? ((s || 'OTHER').toUpperCase());

export const SECTION_LABEL: Record<string, string> = {
  APLCN: 'Applications', NOTAC: 'Notices and acknowledgements', INTIM: 'Intimations', NOTCE: 'Notices', REPLY: 'Replies',
  ORDRS: 'Orders', CLSR: 'Closure', DRC7A: 'Demand and recovery (DRC-07A)',
};
export const SECTION_ORDER = ['DRC7A', 'APLCN', 'NOTAC', 'INTIM', 'NOTCE', 'REPLY', 'ORDRS', 'CLSR'];
export const sectionLabel = (code: string) => SECTION_LABEL[code] ?? `Portal section ${code}`;

// ── Kinds of case ──────────────────────────────────────────────────────────
export type CaseKind = 'demand' | 'scrutiny' | 'audit' | 'enforcement' | 'appeal' | 'refund' | 'voluntary' | 'lut'
  | 'rectification' | 'waiver' | 'registration' | 'other';

export const KIND_LABEL: Record<CaseKind, string> = {
  demand: 'Demand case (DRC-01)',
  scrutiny: 'Scrutiny of returns (ASMT-10)',
  audit: 'Audit (ADT-01)',
  enforcement: 'Enforcement case',
  appeal: 'Appeal (APL-01)',
  refund: 'Refund claim (RFD-01)',
  voluntary: 'Voluntary payment (DRC-03)',
  lut: 'Letter of undertaking (RFD-11)',
  rectification: 'Rectification of an order',
  waiver: 'Waiver of interest and penalty (s.128A)',
  registration: 'Registration case',
  other: 'Case folder',
};

const TYPE_KIND: [RegExp, CaseKind][] = [
  [/appeal/i, 'appeal'], [/refund/i, 'refund'], [/enforcement|inspection|search|summons/i, 'enforcement'],
  [/determination of tax|drc[- ]?0?1a?\b|show cause/i, 'demand'], [/scrutiny|asmt/i, 'scrutiny'], [/\baudit\b|adt[- ]?0?1/i, 'audit'],
  [/voluntary payment|drc[- ]?0?3/i, 'voluntary'], [/letter of undertaking|\blut\b|rfd[- ]?11/i, 'lut'], [/rectification/i, 'rectification'],
  [/waiver|128a|spl[- ]?0?2/i, 'waiver'], [/registration|reg[- ]?\d/i, 'registration'],
];

const applicationForm = (items: FolderItem[]) =>
  items.filter((i) => sectionCode(i.folder_section) === 'APLCN').map((i) => text(obj(i.raw_json).formNo) ?? '').join(' ');

/**
 * What the case is: the application's form first (APL-01 vs RFD-01), then the
 * portal's case type, then the wording of the items and of the case's notices.
 */
export function caseKind(noticeType: string | null | undefined, items: FolderItem[], descriptions: string[] = []): CaseKind {
  const forms = applicationForm(items);
  if (/APL[- ]?0?1/i.test(forms)) return 'appeal';
  if (/RFD/i.test(forms)) return 'refund';
  const type = (noticeType || '').trim();
  if (type && !/^(notice|order|notices|orders)$/i.test(type)) {
    const hit = TYPE_KIND.find(([re]) => re.test(type));
    if (hit) return hit[1];
  }
  const words = [...items.map((i) => {
    const raw = obj(i.raw_json);
    return [itemType(raw), text(obj(raw.sdtls).tynotice), text(obj(raw.reply).replyty), text(raw.tyreply)].filter(Boolean).join(' ');
  }), ...descriptions].join(' ');
  if (items.some((i) => sectionCode(i.folder_section) === 'DRC7A') && /summons|inspection|search/i.test(words)) return 'enforcement';
  const hit = TYPE_KIND.find(([re]) => re.test(words));
  return hit ? hit[1] : 'other';
}

// ── One item → one event ───────────────────────────────────────────────────
const SUB_KEYS = ['dtscn', 'srscn', 'remnd', 'dtorder', 'sancordervo', 'payadviceordervo'];
const subDetail = (raw: Obj): Obj => {
  const s = obj(raw.sdtls);
  const key = SUB_KEYS.find((k) => Object.keys(obj(s[k])).length > 0);
  return key ? obj(s[key]) : {};
};
const itemType = (raw: Obj): string | null => text(subDetail(raw).type) ?? text(subDetail(raw).ordertype) ?? text(obj(raw.sdtls).type);

/** "DRC-01A" from "Intimation … (DRC-01A)" / "GST RFD-08 – Notice …". */
export function formOf(s: string | null | undefined): string | null {
  const m = (s || '').match(/\b(DRC|ASMT|ADT|RFD|APL|REG|GSTR|MOV|SPL|PMT|CMP|ITC)[- ]?(\d{1,2})([A-Z]?)\b/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  return `${prefix}-${prefix === 'GSTR' ? m[2] : m[2].padStart(2, '0')}${m[3].toUpperCase()}`;
}

/** A hearing written as "Yes – 15/10/2026", "21/10/2026 10:30" or "Y". */
function hearingOf(v: unknown): { date: string | null; time: string | null; asked: boolean } | null {
  const s = text(v);
  if (!s) return null;
  const m = s.match(/(\d{2})[/-](\d{2})[/-](\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (m) return { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] ?? null, asked: true };
  if (/^(y|yes)\b/i.test(s)) return { date: null, time: null, asked: true };
  return { date: null, time: null, asked: false };
}

const officer = (raw: Obj): string | null => {
  const t = obj(raw.todtls);
  return [text(t.nm), text(t.dg)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || null;
};

export interface Fact { label: string; value: string }

export interface CaseEvent {
  id: string;
  code: string;
  date: string | null;
  title: string;
  form: string | null;
  by: string | null;
  ref: string | null;
  subject: string | null;
  facts: Fact[];
  due: string | null;
  hearing: { date: string; time: string | null } | null;
  amount: number | null;
  outstanding: boolean;
  /** For a reply: the reference and date of what it answers. */
  answers: { ref: string | null; date: string | null } | null;
  attachments: { label: string; url: string }[];
  raw: Obj;
}

const attachmentsOf = (it: FolderItem) => (Array.isArray(it.attachments) ? it.attachments : [])
  .map((a) => obj(a)).filter((a) => typeof a.url === 'string')
  .map((a) => ({ label: String(a.label ?? 'Attachment'), url: String(a.url) }));

export function toEvent(it: FolderItem): CaseEvent {
  const raw = obj(it.raw_json);
  const code = sectionCode(it.folder_section);
  const sub = subDetail(raw);
  const base: CaseEvent = {
    id: it.id, code, date: portalDateToIso(raw.refdt), title: sectionLabel(code), form: null, by: officer(raw), ref: it.reference_number,
    subject: null, facts: [], due: null, hearing: null, amount: null, outstanding: false, answers: null, attachments: attachmentsOf(it), raw,
  };
  const fact = (label: string, v: unknown) => { const t = text(v); if (t) base.facts.push({ label, value: t }); };

  if (code === 'REPLY') {
    const r = obj(raw.reply);
    const nested = Object.keys(r).length > 0;
    const dec = obj(nested ? r.decdtls : raw.decdtls);
    base.title = text(nested ? r.replyty : raw.tyreply)?.replace(/^GST\s+/i, '') ?? 'Reply filed';
    base.date = portalDateToIso(dec.dt) ?? portalDateToIso(raw.replydt) ?? portalDateToIso(r.replydt);
    base.by = text(dec.asnm) ?? ([text(raw.sigfn), text(raw.sigln)].filter(Boolean).join(' ') || null);
    base.answers = { ref: text(nested ? r.ntcno : raw.ntcno), date: portalDateToIso(nested ? (r.ntcdt ?? r.intdt) : (raw.ntcdt ?? raw.intdt)) };
    const ph = hearingOf(nested ? r.pershrng : raw.pershrng);
    if (ph) base.facts.push({ label: 'Personal hearing asked', value: ph.asked ? 'yes' : 'no' });
  } else if (code === 'APLCN') {
    const form = text(raw.formNo) ?? '';
    const appeal = /APL/i.test(form);
    base.title = appeal ? 'Appeal filed (APL-01)' : /RFD/i.test(form) ? 'Refund application filed (RFD-01)' : `Application filed${form ? ` (${form.replace(/^GST\s+/i, '')})` : ''}`;
    base.date = portalDateToIso(raw.rfdSubDt) ?? portalDateToIso(raw.arndt) ?? portalDateToIso(raw.refdt);
    base.ref = text(raw.applnAckNum) ?? it.reference_number;
    base.by = 'Taxpayer';
    base.subject = text(raw.refundRsn);
    if (appeal) {
      const disputed = money(first(raw, ['disputedTax', 'disputed_tax', 'dsputTax', 'taxDisputed', 'disputedAmt']));
      const pre = money(first(raw, ['predeposit', 'preDeposit', 'pre_deposit', 'predepositAmt', 'preDepositAmt']));
      if (disputed) base.facts.push({ label: 'Disputed tax', value: fmtInr(disputed) });
      if (pre) base.facts.push({ label: 'Pre-deposit paid', value: fmtInr(pre) });
      fact('Order appealed', first(raw, ['orderNo', 'ordno', 'orderRefNo']));
      fact('Appellate authority', first(raw, ['appellateAuthority', 'aplAuth']));
      base.amount = disputed;
    }
  } else if (code === 'NOTAC') {
    const s = obj(raw.sdtls);
    base.title = text(s.tynotice)?.replace(/^GST\s+/i, '') ?? 'Notice or acknowledgement';
    base.subject = text(s.rsnnoticeother);
    base.due = portalDateToIso(s.duedate);
  } else if (code === 'DRC7A') {
    const s = obj(raw.sdtls);
    base.title = 'Demand / recovery (DRC-07A)';
    base.form = 'DRC-07A';
    base.amount = money(s.amount);
    base.outstanding = /outstanding|pending|unpaid|due/i.test(text(s.status) ?? '');
    fact('Demand ID', raw.demandId);
    fact('Period', raw.taxPeriod);
    fact('Type', s.dmdtype);
    if (base.amount) base.facts.push({ label: 'Amount', value: fmtInr(base.amount) });
    fact('Status', s.status);
  } else if (code === 'CLSR') {
    base.title = itemType(raw)?.replace(/^GST\s+/i, '') ?? 'Closed on the portal';
  } else if (code === 'INTIM' || code === 'NOTCE' || code === 'ORDRS') {
    base.title = itemType(raw)?.replace(/^GST\s+/i, '') ?? sectionLabel(code);
    base.due = portalDateToIso(raw.duedt) ?? portalDateToIso(sub.replyDuedt) ?? portalDateToIso(sub.duedt);
    base.subject = text(sub.facts) ?? text(sub.reason) ?? text(sub.grounds);
    const ph = hearingOf(sub.pershrng);
    if (ph?.date) base.hearing = { date: ph.date, time: ph.time };
    else if (ph) base.facts.push({ label: 'Personal hearing', value: ph.asked ? 'offered' : 'not offered' });
    if (text(sub.sec)) base.facts.push({ label: 'Section', value: text(sub.sec) as string });
    if (text(sub.fy)) base.facts.push({ label: 'FY', value: text(sub.fy) as string });
    if (code === 'ORDRS') base.amount = money(first(sub, ['amount', 'totalDemand', 'dmdamt']));
  } else {
    base.title = `${sectionLabel(code)} item`;
  }
  base.form = base.form ?? formOf(base.title);
  return base;
}

const byDate = (a: CaseEvent, b: CaseEvent) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0);

// ── The whole case ─────────────────────────────────────────────────────────
export interface CaseAlert { tone: 'destructive' | 'warning' | 'info'; text: string }

export interface CaseSummary {
  kind: CaseKind;
  label: string;
  events: CaseEvent[];
  opened: string | null;
  last: CaseEvent | null;
  portalStatus: string;
  closed: boolean;
  alerts: CaseAlert[];
  fy: string | null;
  outstanding: number;
  nextHearing: { date: string; time: string | null; event: CaseEvent } | null;
  /** The due date of the latest notice the portal shows no reply to. */
  pendingDue: string | null;
}

/** A reply's timing against what it answers: "on time" / "3 d late" (U-60-2). */
export function replyTiming(reply: CaseEvent, events: CaseEvent[]): string | null {
  if (!reply.answers || !reply.date) return null;
  const target = events.find((e) => e.id !== reply.id && e.code !== 'REPLY' && reply.answers?.ref && e.ref === reply.answers.ref)
    ?? events.filter((e) => e.code !== 'REPLY' && e.due && e.date && e.date <= reply.date!).sort(byDate).pop();
  if (!target?.due) return null;
  const late = daysBetween(target.due, reply.date);
  return late <= 0 ? `on time (due ${fmtDate(target.due)})` : `${late} d late (due ${fmtDate(target.due)})`;
}

export function summarizeCase(items: FolderItem[], opts: {
  noticeType?: string | null; descriptions?: string[]; today: string;
  /** What to call a case of no known kind (e.g. its notice's title). */
  fallbackLabel?: string | null;
  /** Titles of the case's notices by reference, for items the portal returned without a type. */
  noticeTitles?: Map<string, string>;
}): CaseSummary {
  const kind = caseKind(opts.noticeType, items, opts.descriptions);
  const events = items.map(toEvent).sort(byDate);
  events.forEach((e) => {
    const t = e.ref ? opts.noticeTitles?.get(e.ref) : undefined;
    if (t && e.title === sectionLabel(e.code)) { e.title = t; e.form = e.form ?? formOf(t); }
  });
  const dated = events.filter((e) => e.date);
  const last = dated.length ? dated[dated.length - 1] : events[events.length - 1] ?? null;
  const replies = events.filter((e) => e.code === 'REPLY');
  const answered = (e: CaseEvent) => replies.some((r) => (r.answers?.ref && r.answers.ref === e.ref) || (!!r.date && !!e.date && r.date >= e.date));
  const askers = events.filter((e) => ['INTIM', 'NOTCE', 'NOTAC'].includes(e.code) && e.due);
  const pendingAsk = askers.filter((e) => !answered(e)).sort(byDate).pop() ?? null;
  const orders = events.filter((e) => e.code === 'ORDRS');
  const closure = events.some((e) => e.code === 'CLSR');
  const paid = orders.some((e) => Object.keys(obj(obj(e.raw.sdtls).payadviceordervo)).length > 0);
  const demands = events.filter((e) => e.code === 'DRC7A' && e.outstanding);
  const outstanding = demands.reduce((s, e) => s + (e.amount ?? 0), 0);
  const hearings = events.filter((e) => e.hearing && e.hearing.date >= opts.today)
    .sort((a, b) => (a.hearing as { date: string }).date.localeCompare((b.hearing as { date: string }).date));
  const nextHearing = hearings[0]?.hearing ? { ...hearings[0].hearing, event: hearings[0] } : null;

  let portalStatus = 'Open on the portal';
  if (closure) portalStatus = 'Closed on the portal';
  else if (kind === 'refund' && paid) portalStatus = 'Refund paid';
  else if (demands.length) portalStatus = 'Recovery outstanding';
  else if (orders.length) portalStatus = `Order passed${orders[orders.length - 1].form ? ` (${orders[orders.length - 1].form})` : ''}`;
  else if (nextHearing && (!pendingAsk || pendingAsk.id === nextHearing.event.id)) portalStatus = 'Hearing fixed';
  else if (pendingAsk) portalStatus = pendingAsk.due && pendingAsk.due < opts.today ? 'Reply overdue' : 'Reply awaited';
  else if (last?.code === 'REPLY') portalStatus = 'Reply filed';
  else if (kind === 'appeal') portalStatus = 'Appeal filed';

  const alerts: CaseAlert[] = [];
  if (outstanding > 0) alerts.push({ tone: 'destructive', text: `Outstanding demand ${fmtInr(outstanding)}` });
  // A hearing notice's due date is the hearing itself: said once, as the hearing.
  if (pendingAsk?.due && pendingAsk.id !== nextHearing?.event.id) {
    const d = daysBetween(opts.today, pendingAsk.due);
    if (d < 0) alerts.push({ tone: 'destructive', text: `No reply on the portal to the ${pendingAsk.form ?? 'notice'} due ${fmtDate(pendingAsk.due)} (${-d} d ago)` });
    else if (d <= 7) alerts.push({ tone: 'warning', text: `Reply to the ${pendingAsk.form ?? 'notice'} due ${fmtDate(pendingAsk.due)} (${d === 0 ? 'today' : `in ${d} d`})` });
  }
  if (nextHearing) {
    const d = daysBetween(opts.today, nextHearing.date);
    alerts.push({ tone: d <= 7 ? 'warning' : 'info', text: `Hearing ${fmtDate(nextHearing.date)}${nextHearing.time ? `, ${nextHearing.time}` : ''} (${d === 0 ? 'today' : `in ${d} d`})` });
  }
  const fy = events.map((e) => e.facts.find((f) => f.label === 'FY')?.value).find(Boolean) ?? null;
  const label = kind === 'demand'
    ? (() => {
      const sec = events.map((e) => e.facts.find((f) => f.label === 'Section')?.value).find(Boolean);
      const scn = events.find((e) => e.code === 'NOTCE' && /DRC-01\b/.test(e.form ?? ''));
      return scn ? `Show cause notice${sec ? ` u/s ${sec}` : ''} (DRC-01)` : `Demand intimation${sec ? ` u/s ${sec}` : ''} (DRC-01A)`;
    })()
    : kind === 'other' && opts.noticeType && !/^(notice|order)s?$/i.test(opts.noticeType) ? sentenceCase(opts.noticeType)
      : kind === 'other' && opts.fallbackLabel ? opts.fallbackLabel : KIND_LABEL[kind];
  return {
    kind, label, events, opened: dated[0]?.date ?? null, last, portalStatus, closed: closure || (kind === 'refund' && paid),
    alerts, fy, outstanding, nextHearing, pendingDue: pendingAsk?.due ?? null,
  };
}

/** The sections a case of this kind normally fills, for "nothing yet under …". */
export function expectedSections(kind: CaseKind): string[] {
  if (kind === 'refund') return ['APLCN', 'NOTAC', 'REPLY', 'ORDRS'];
  if (kind === 'appeal') return ['APLCN', 'NOTCE', 'REPLY', 'ORDRS'];
  if (kind === 'demand' || kind === 'scrutiny' || kind === 'audit') return ['INTIM', 'NOTCE', 'REPLY', 'ORDRS', 'CLSR'];
  return ['NOTCE', 'REPLY', 'ORDRS', 'CLSR'];
}

// ── Raw fields, dates in the house format (U-63-3) ─────────────────────────
const HIDDEN = new Set(['docupdtl', 'dcupdtls', 'maindocs', 'suppdocs', 'docmodel', 'crn', 'state_cd']);
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function rawFields(raw: Obj, prefix = '', depth = 0): Fact[] {
  if (depth > 2) return [];
  const out: Fact[] = [];
  Object.entries(raw).forEach(([k, v]) => {
    if (HIDDEN.has(k.toLowerCase()) || v === null || v === undefined || v === '') return;
    const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
    if (Array.isArray(v)) {
      if (v.length && v.every((x) => x === null || typeof x !== 'object')) out.push({ label, value: v.join(', ') });
      return;
    }
    if (typeof v === 'object') { out.push(...rawFields(v as Obj, label, depth + 1)); return; }
    const s = String(v);
    const iso = /^\d{2}[/-]\d{2}[/-]\d{4}|^\d{4}-\d{2}-\d{2}/.test(s) ? portalDateToIso(s) : null;
    const time = s.match(/\s(\d{1,2}:\d{2}(?::\d{2})?)$/)?.[1];
    out.push({ label, value: iso ? `${fmtDate(iso)}${time ? `, ${time}` : ''}` : s });
  });
  return out;
}
