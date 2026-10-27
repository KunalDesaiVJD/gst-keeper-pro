// One status map for refund applications and DRC-03 payments (audit U-75-1,
// U-75-2, U-76-1, U-77-2; finding L-37). Every refund lands in one group with a
// tone that points the right way (needs action red, with the officer blue,
// sanctioned or paid green, rejected or withdrawn grey) and, where the law
// gives one, the next step and its date:
//   RFD-08 show cause      → reply in RFD-09 within 15 days (rule 92(3))
//   RFD-03 deficiency memo → correct and file a fresh RFD-01
//   rejection, in full or in part → appeal within 3 months of the order
//                            (s.107(1)); the row stays open until that window
//                            and the 1-month condonation have run, or staff
//                            close the refund's case
//   filed / acknowledged   → RFD-02 or a memo within 15 days (rule 90), the
//                            order within 60 days (s.54(7))
//   sanction, payment (RFD-05), re-credit (PMT-03) → closed.
// Dates come from the refund's case folder (gst_case_folder_items for the ARN)
// when the portal sync captured it. The database's refund_facts.is_closed still
// uses the older rule (no sanction, no hyphenated "Re-credit"); this map is what
// the Refunds page, its tiles and the Notice summary count.
import type { Json } from '@/integrations/supabase/types';
import { addDays, daysBetween } from '@/lib/noticeFacts';

export type Tone = 'destructive' | 'warning' | 'info' | 'success' | 'secondary';

// ── Case folder ─────────────────────────────────────────────────────────────
export interface FolderItemLite {
  client_id: string;
  case_id: string;
  folder_section: string | null;
  raw_json: Json | null;
}

/** What a refund's case folder says (the latest date of each kind of item). */
export interface FolderSignals {
  items: number;
  ack: string | null;
  deficiency: string | null;
  scn: { date: string | null; due: string | null } | null;
  replied: string | null;
  provisional: string | null;
  /**
   * The latest RFD-06; "ambiguous" when its title names both sanction and
   * rejection (every RFD-06 is titled "Refund Sanction/Rejection Order") and it
   * carries no figures to tell which.
   */
  order: { date: string | null; rejected: boolean; ambiguous: boolean; figures: OrderFigures | null } | null;
  paid: string | null;
  /** The application is a NIL refund application (nothing claimed; no order follows). */
  nil: boolean;
}

/** An RFD-06's own figures (sdtls.sancordervo.sancamtdtl), all heads together. */
export interface OrderFigures { claimed: number; provisional: number; sanctioned: number; rejected: number }

/** "28/09/2026", "28-09-2026 11:05:12" or "2026-09-28" → "2026-09-28". */
export function portalDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

/** The item's detail block (sdtls.dtscn / srscn / remnd / dtorder …, or sdtls itself). */
function detail(j: Obj): Obj | null {
  const s = obj(j.sdtls);
  if (!s) return null;
  return Object.values(s).map(obj).find((o) => o && ('duedt' in o || 'replyDuedt' in o || 'type' in o)) ?? s;
}

// "Present, date unknown" sorts below every real date.
const UNKNOWN = '0000-00-00';
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

const amount = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * The figures of a sanction order, summed over IGST, CGST, SGST and cess and
 * over tax, interest, penalty, fee and other: clmamt claimed, provamt sanctioned
 * provisionally (RFD-04), grsamt sanctioned by this order, inadmamt held
 * inadmissible (rejected). As the database reads it (refund_order_amount,
 * migration 20261027110000). Null when the order carries no figures.
 */
export function orderFigures(sanc: Obj | null): OrderFigures | null {
  const dtl = obj(sanc?.sancamtdtl);
  if (!dtl) return null;
  const part = (k: string) => Object.values(dtl).reduce<number>((t, h) => t + Object.values(obj(obj(h)?.[k]) ?? {}).reduce<number>((a, v) => a + amount(v), 0), 0);
  const provisional = part('provamt');
  return { claimed: part('clmamt'), provisional, sanctioned: provisional + part('grsamt'), rejected: part('inadmamt') };
}

export function folderSignals(items: FolderItemLite[]): FolderSignals {
  const out: FolderSignals = { items: items.length, ack: null, deficiency: null, scn: null, replied: null, provisional: null, order: null, paid: null, nil: false };
  items.forEach((it) => {
    const j = obj(it.raw_json) ?? {};
    const sec = (it.folder_section || '').toUpperCase().trim();
    const d = detail(j);
    const sdtls = obj(j.sdtls);
    const date = portalDate(j.refdt) ?? portalDate(j.rfdSubDt) ?? portalDate(d?.refdt) ?? portalDate(obj(obj(j.reply)?.decdtls)?.dt);
    const due = portalDate(j.duedt) ?? portalDate(d?.replyDuedt) ?? portalDate(d?.duedt) ?? portalDate(sdtls?.duedate);
    if (sec === 'APLCN' || sec === 'APPLICATIONS') {
      if (j.nilFile === true || /\bNIL\b/i.test(String(j.formDesc ?? ''))) out.nil = true;
      return;
    }
    if (sec.startsWith('REPL')) { out.replied = later(out.replied, date ?? UNKNOWN); return; }
    const pay = obj(sdtls?.payadviceordervo);
    const sanc = obj(sdtls?.sancordervo);
    // The item's own title when the portal gives one, else everything it holds.
    const kind = String(sanc?.ordertype ?? pay?.ordertype ?? sdtls?.tynotice ?? d?.type ?? '').toUpperCase()
      || JSON.stringify(it.raw_json ?? '').toUpperCase();
    if (pay || /PMT-?03|RFD-?05/.test(kind)) { out.paid = later(out.paid, date ?? UNKNOWN); return; }
    if (/RFD-?04|PROVISIONAL/.test(kind)) { out.provisional = later(out.provisional, date ?? UNKNOWN); return; }
    if (sanc || sec.startsWith('ORD') || /RFD-?06/.test(kind)) {
      // By its figures when it carries them (an amount held inadmissible, or nothing sanctioned of a
      // claim), as the closing sweep reads it (refund_order_rejects); else by its title, where a
      // combined "Sanction/Rejection" title says neither.
      const figures = orderFigures(sanc);
      const ambiguous = !figures && /SANCTION\s*\/\s*REJECT/.test(kind);
      const rejected = figures ? figures.rejected > 0 || (figures.claimed > 0 && figures.sanctioned <= 0) : /REJECT/.test(kind) && !ambiguous;
      if (!out.order || (date && (!out.order.date || date > out.order.date))) out.order = { date, rejected, ambiguous, figures };
      return;
    }
    if (/RFD-?08|SHOW CAUSE|REJECTION OF APPLICATION/.test(kind)) {
      if (!out.scn || (date && (!out.scn.date || date > out.scn.date))) out.scn = { date, due };
      return;
    }
    if (/RFD-?03|DEFICIEN/.test(kind)) { out.deficiency = later(out.deficiency, date ?? UNKNOWN); return; }
    if (/RFD-?02|ACKNOWLEDG/.test(kind)) out.ack = later(out.ack, date ?? UNKNOWN);
  });
  return out;
}

const known = (d: string | null | undefined): string | null => (d && d !== UNKNOWN ? d : null);

// ── Refunds ─────────────────────────────────────────────────────────────────
export type RefundGroup = 'action' | 'process' | 'paid' | 'rejected' | 'nil' | 'unknown';

export const REFUND_GROUPS: { key: RefundGroup; label: string; hint: string; tone: Tone }[] = [
  { key: 'action', label: 'Needs action', hint: 'reply, re-file or decide on an appeal', tone: 'destructive' },
  { key: 'process', label: 'In process', hint: 'with the officer', tone: 'info' },
  { key: 'paid', label: 'Sanctioned or paid', hint: 'sanctioned, paid or re-credited', tone: 'success' },
  { key: 'rejected', label: 'Rejected or withdrawn', hint: 'no appeal pending', tone: 'secondary' },
  { key: 'nil', label: 'Nil or re-filed', hint: 'nothing claimed, or replaced by a fresh application', tone: 'secondary' },
  { key: 'unknown', label: 'Closed, no details', hint: 'case closed; application not captured', tone: 'secondary' },
];

export type RefundShow = 'all' | 'open' | 'closed' | RefundGroup;

export const REFUND_SHOW: { key: RefundShow; label: string }[] = [
  { key: 'open', label: 'Open (needs action or in process)' },
  ...REFUND_GROUPS.map((g) => ({ key: g.key as RefundShow, label: g.label })),
  { key: 'closed', label: 'Closed (any outcome)' },
];

/** ?status= from links old and new ("Open", "open", "action" …). */
export function parseRefundShow(v: string | null): RefundShow {
  const s = (v || '').toLowerCase();
  return REFUND_SHOW.some((o) => o.key === s) ? (s as RefundShow) : 'all';
}

export const refundShowLabel = (s: RefundShow) => REFUND_SHOW.find((o) => o.key === s)?.label ?? 'All';

export interface RefundInput {
  origin: string | null;
  status: string | null;
  filed_date: string | null;
  claimed_amount: number | null;
  sanctioned_amount: number | null;
}

/** The refund's case on the notices side (same ARN), when there is one. */
export interface LinkedCase { id: string; is_open: boolean | null; close_reason: string | null; stage: string | null }

export interface RefundState {
  group: RefundGroup;
  open: boolean;
  /** The status as shown: the portal's words, or what the case folder says. */
  label: string;
  tone: Tone;
  next: string | null;
  due: string | null;
  /** Why the date is what it is. */
  basis: string | null;
  /** Rejected part of a partly sanctioned claim. */
  rejectedAmount: number | null;
  /** A case with neither an application record nor folder items. */
  noDetails: boolean;
  /** The fresh application (ARN) that took the place of this one after a deficiency memo. */
  refiledAs?: string | null;
}

const addMonths = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

/** Can the order still be appealed (3 months + 1 month condonation, s.107(1),(4))? */
function appealOpen(orderDate: string | null, filed: string | null, today: string): boolean {
  if (orderDate) return today <= addMonths(orderDate, 4);
  // Order date not captured: assume the order came on the s.54(7) day and allow the full window after it.
  return filed ? today <= addMonths(addDays(filed, 60), 4) : false;
}

const FOLDER_LABELS: [RegExp, string][] = [
  [/rfd-08/, 'Show cause notice (RFD-08)'], [/rfd-09/, 'Reply filed (RFD-09)'], [/rfd-04/, 'Provisional order (RFD-04)'],
  [/rfd-03/, 'Deficiency memo (RFD-03)'], [/acknowledg/, 'Acknowledged (RFD-02)'],
];

export function refundState(r: RefundInput, f: FolderSignals | undefined, linked: LinkedCase | undefined, today: string): RefundState {
  const none = { rejectedAmount: null as number | null, noDetails: false };
  const staffClosed = linked?.is_open === false;
  const claimed = r.claimed_amount === null ? null : Number(r.claimed_amount);
  const sanctioned = r.sanctioned_amount === null ? null : Number(r.sanctioned_amount);
  const scnDate = known(f?.scn?.date);
  const replied = known(f?.replied) ?? (f?.replied ? UNKNOWN : null);
  const answered = !!f?.scn && !!replied && (!scnDate || replied === UNKNOWN || replied >= scnDate);

  const appeal = (label: string, orderDate: string | null, rejectedAmount: number | null): RefundState => {
    if (!staffClosed && appealOpen(orderDate, r.filed_date, today)) {
      return {
        ...none, group: 'action', open: true, label, tone: rejectedAmount ? 'warning' : 'destructive',
        next: rejectedAmount ? 'Decide on an appeal for the part rejected' : 'Decide on an appeal (APL-01)',
        due: orderDate ? addMonths(orderDate, 3) : null,
        basis: orderDate ? '3 months from the order, s.107(1)' : '3 months from the order (order date not captured), s.107(1)',
        rejectedAmount,
      };
    }
    return rejectedAmount
      ? { ...none, group: 'paid', open: false, label, tone: 'success', next: null, due: null, basis: null, rejectedAmount }
      : { ...none, group: 'rejected', open: false, label, tone: 'secondary', next: null, due: null, basis: null };
  };

  const fromStatus = (st: string, label: string): RefundState => {
    if (/rfd-?08|show cause/.test(st)) {
      if (answered) return { ...none, group: 'process', open: true, label, tone: 'info', next: 'Await the order on the RFD-09 reply', due: null, basis: null };
      const due = known(f?.scn?.due) ?? (scnDate ? addDays(scnDate, 15) : null);
      return {
        ...none, group: 'action', open: true, label, tone: 'destructive', next: 'Reply in RFD-09', due,
        basis: known(f?.scn?.due) ? 'reply-by date on the RFD-08' : scnDate ? '15 days from the RFD-08, rule 92(3)' : '15 days from the RFD-08 (notice date not captured)',
      };
    }
    if (/rfd-?03|deficien/.test(st)) {
      return { ...none, group: 'action', open: true, label, tone: 'destructive', next: 'Correct and file a fresh RFD-01', due: null, basis: 'the memo closes this application, rule 90(3)' };
    }
    if (/withdraw/.test(st)) return { ...none, group: 'rejected', open: false, label, tone: 'secondary', next: null, due: null, basis: null };
    if (/reject/.test(st)) return appeal(label, known(f?.order?.date), null);
    if (/provisional|rfd-?04/.test(st)) {
      return { ...none, group: 'process', open: true, label, tone: 'info', next: 'Await the final order (RFD-06)', due: r.filed_date ? addDays(r.filed_date, 60) : null, basis: 'order due 60 days after the application, s.54(7)' };
    }
    if (/disburs|sanction|re-?credit|paid|rfd-?0?5|rfd-?06|pmt-?03/.test(st)) {
      if (sanctioned === 0 && claimed && claimed > 0) return appeal(label, known(f?.order?.date), null);
      const part = claimed !== null && sanctioned !== null && sanctioned > 0 && sanctioned < claimed ? claimed - sanctioned : null;
      if (part) return appeal(label, known(f?.order?.date), part);
      return { ...none, group: 'paid', open: false, label, tone: 'success', next: null, due: null, basis: null };
    }
    if (/reply filed|rfd-?09/.test(st)) {
      return { ...none, group: 'process', open: true, label, tone: 'info', next: 'Await the order on the RFD-09 reply', due: null, basis: null };
    }
    const orderBy = r.filed_date ? addDays(r.filed_date, 60) : null;
    if (/acknowledg|rfd-?02/.test(st) || f?.ack) {
      return { ...none, group: 'process', open: true, label, tone: 'info', next: 'Follow up if no order by then', due: orderBy, basis: 'order due 60 days after the application, s.54(7)' };
    }
    const ackBy = r.filed_date ? addDays(r.filed_date, 15) : null;
    if (ackBy && today > ackBy) {
      return { ...none, group: 'process', open: true, label, tone: 'info', next: 'Follow up: no acknowledgement on record', due: orderBy, basis: 'order due 60 days after the application, s.54(7)' };
    }
    return { ...none, group: 'process', open: true, label, tone: 'info', next: 'Await RFD-02 or a deficiency memo', due: ackBy, basis: 'acknowledgement or memo within 15 days, rule 90' };
  };

  // A NIL refund application ("NIL Refund Application", nilFile on the RFD-01) claims nothing
  // and covers a period with nothing to claim: no acknowledgement or order follows.
  if ((f?.nil || claimed === 0) && !f?.order && !f?.paid && !/withdraw|reject|sanction|disburs|deficien|rfd-?0[3-9]/i.test(r.status || '')) {
    return { ...none, group: 'nil', open: false, label: 'Nil refund application', tone: 'secondary', next: null, due: null, basis: null };
  }

  if (r.origin !== 'case') return fromStatus((r.status || '').toLowerCase(), r.status || 'Status not captured');

  // A case with no application record: read its folder, else its notice.
  if (!f || f.items === 0) {
    if (linked?.is_open === false) {
      const paid = /refund_paid|paid|sanction/i.test(linked.close_reason || '');
      return paid
        ? { ...none, group: 'paid', open: false, label: 'Paid (case closed)', tone: 'success', next: null, due: null, basis: null }
        : { ...none, group: 'unknown', open: false, label: 'Case closed', tone: 'secondary', next: null, due: null, basis: null, noDetails: true };
    }
    return { ...none, group: 'process', open: true, label: 'Details not fetched', tone: 'warning', next: 'Fetch the application and its folder', due: null, basis: null, noDetails: true };
  }
  // No amounts on a case, so as the closing sweep holds (positions §3): paid only on a payment
  // advice with no rejection on file; a rejection, or an order that may be one, has an appeal clock.
  if (f.order && (f.order.rejected || f.order.ambiguous)) {
    return appeal(`${f.order.rejected ? 'Rejected' : 'Order'} (RFD-06) · from the case folder`, known(f.order.date), null);
  }
  if (f.paid) return { ...none, group: 'paid', open: false, label: 'Paid (RFD-05) · from the case folder', tone: 'success', next: null, due: null, basis: null };
  if (f.order) {
    return { ...none, group: 'process', open: true, label: 'Sanctioned (RFD-06) · from the case folder', tone: 'info', next: 'Await the payment advice (RFD-05)', due: null, basis: null };
  }
  const st = f.scn && !answered ? 'rfd-08' : replied ? 'rfd-09' : f.provisional ? 'rfd-04' : f.deficiency ? 'rfd-03' : f.ack ? 'acknowledged' : 'filed';
  const label = `${FOLDER_LABELS.find(([re]) => re.test(st))?.[1] ?? 'Application filed'} · from the case folder`;
  return fromStatus(st, label);
}

export function matchesRefundShow(s: RefundState, show: RefundShow): boolean {
  if (show === 'all') return true;
  if (show === 'open') return s.open;
  if (show === 'closed') return !s.open;
  return s.group === show;
}

/** Whole days from today to a date (negative when past). */
export const daysTo = (iso: string | null, today: string): number | null => (iso ? daysBetween(today, iso) : null);

// ── DRC-03 ──────────────────────────────────────────────────────────────────
export type Drc03Group = 'pending' | 'acknowledged' | 'nodetails';

export const DRC03_GROUPS: { key: Drc03Group; label: string; hint: string; tone: Tone }[] = [
  { key: 'pending', label: 'Awaiting acknowledgement', hint: 'paid; DRC-04 not issued yet', tone: 'info' },
  { key: 'acknowledged', label: 'Acknowledged', hint: 'DRC-04 issued', tone: 'success' },
  { key: 'nodetails', label: 'Details not fetched', hint: 'case only; no filing captured', tone: 'warning' },
];

export type Drc03Show = 'all' | 'open' | 'closed' | Drc03Group;

export const DRC03_SHOW: { key: Drc03Show; label: string }[] = [
  ...DRC03_GROUPS.map((g) => ({ key: g.key as Drc03Show, label: g.label })),
  { key: 'open', label: 'Open (not acknowledged)' },
  { key: 'closed', label: 'Closed' },
];

export function parseDrc03Show(v: string | null): Drc03Show {
  const s = (v || '').toLowerCase();
  return DRC03_SHOW.some((o) => o.key === s) ? (s as Drc03Show) : 'all';
}

export const drc03ShowLabel = (s: Drc03Show) => DRC03_SHOW.find((o) => o.key === s)?.label ?? 'All';

export interface Drc03State { group: Drc03Group; label: string; tone: Tone }

/** A DRC-03 is a payment already made: "pending" waits on the officer's DRC-04, not on the firm (L-37). */
export function drc03State(origin: string | null, status: string | null, caseOpen: boolean | null): Drc03State {
  if (origin === 'case') {
    return caseOpen === false ? { group: 'nodetails', label: 'Case closed · details not fetched', tone: 'secondary' } : { group: 'nodetails', label: 'Details not fetched', tone: 'warning' };
  }
  const s = (status || '').toLowerCase();
  if (/acknowledg/.test(s)) return { group: 'acknowledged', label: 'Acknowledged (DRC-04)', tone: 'success' };
  if (/reject/.test(s)) return { group: 'pending', label: status || 'Rejected', tone: 'destructive' };
  return { group: 'pending', label: /pending/.test(s) ? 'With the officer' : (status || 'Status not captured'), tone: 'info' };
}

/** ?status=open|closed (older links) follows the database's flag: acknowledged, or a closed case, is closed. */
export function matchesDrc03Show(st: Drc03State, isClosed: boolean, show: Drc03Show): boolean {
  if (show === 'all') return true;
  if (show === 'open') return !isClosed;
  if (show === 'closed') return isClosed;
  return st.group === show;
}
