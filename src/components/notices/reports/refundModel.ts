// What the Refunds page shows of each refund, worked out once (the firm's
// request of 25 October 2026: one page for refunds, a bird's-eye view first and
// every aspect of a refund in one place): the steps it has passed with their
// dates, where its money stands, its type in a few words and its period.
import { REFUND_REASONS } from '@/lib/noticeCases';
import type { RefundRow } from './ledgerData';

const UNKNOWN = '0000-00-00';
const dateOf = (d: string | null | undefined) => (d && d !== UNKNOWN ? d : null);

// ── Type and period ─────────────────────────────────────────────────────────
const SHORT: Record<string, string> = {
  EXPWP: 'Export, tax paid', EXPWOP: 'Export under LUT', SEZWP: 'SEZ, tax paid', SEZWOP: 'SEZ under LUT',
  INVITC: 'Inverted duty', XSPAY: 'Excess tax paid', EXBCL: 'Cash ledger balance', ASSESS: 'After an order or appeal',
  INTRA: 'Wrong tax head', DEEMEXP: 'Deemed export', UNJUST: 'Supply not made', ANYOTH: 'Other reason',
};

export const typeCode = (r: RefundRow) => (r.fact.refund_type ?? '').trim().toUpperCase();
/** "Export under LUT" for EXPWOP; the portal's own words for a type not known here. */
export const typeShort = (code: string) => SHORT[code] ?? (code ? code : 'Type not captured');
export const typeLong = (code: string) => REFUND_REASONS[code] ?? (code || 'Type not captured');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Apr–Jun 2026", "Jan 2025 – Mar 2026", "Apr 2026". */
export function periodText(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const m = (iso: string) => MON[Number(iso.slice(5, 7)) - 1];
  const y = (iso: string) => iso.slice(0, 4);
  if (!to || to.slice(0, 7) === from.slice(0, 7)) return `${m(from)} ${y(from)}`;
  return y(from) === y(to) ? `${m(from)}–${m(to)} ${y(to)}` : `${m(from)} ${y(from)} – ${m(to)} ${y(to)}`;
}
export const refundPeriod = (r: RefundRow) => periodText(r.read?.periodFrom ?? null, r.read?.periodTo ?? null);

// ── Steps ───────────────────────────────────────────────────────────────────
export interface RefundStep {
  key: 'filed' | 'ack' | 'query' | 'reply' | 'provisional' | 'order' | 'paid';
  label: string;
  short: string;
  done: boolean;
  date: string | null;
  /** The step went against the client (a rejection order, a memo that closed the application). */
  bad?: boolean;
}

/**
 * The refund's road, RFD-01 to the payment: the steps every refund takes, plus
 * a query (deficiency memo or show cause), a reply and a provisional order only
 * when the refund had one. A step is done when the case folder holds it, or when
 * the portal's status says the refund is past it.
 */
export function refundSteps(r: RefundRow): RefundStep[] {
  const f = r.signals;
  const st = `${r.fact.status ?? ''} ${r.state.label}`.toLowerCase();
  const ordered = !!f?.order || !!f?.paid || /sanction|reject|disburs|paid|re-?credit|rfd-?0?5|rfd-?06|pmt-?03/.test(st);
  const paid = !!f?.paid || /disburs|paid|rfd-?0?5|re-?credit|pmt-?03/.test(st);
  const memo = !!f?.deficiency || /deficien|rfd-?03/.test(st);
  const scn = !!f?.scn || /rfd-?08|show cause/.test(st);
  const replied = !!f?.replied || /reply filed|rfd-?09/.test(st);
  const withdrawn = /withdraw/.test(st);
  const rejected = /reject/.test(st) && !/partial/.test(st) && !(r.sanctioned && r.sanctioned > 0);
  const steps: RefundStep[] = [
    { key: 'filed', label: 'Applied (RFD-01)', short: 'Applied', done: true, date: r.fact.filed_date },
    { key: 'ack', label: 'Acknowledged (RFD-02)', short: 'Acknowledged', done: !!f?.ack || /acknowledg|rfd-?02/.test(st) || ordered || scn || replied, date: dateOf(f?.ack) },
  ];
  if (memo || scn) {
    steps.push({
      key: 'query', label: memo && !scn ? 'Deficiency memo (RFD-03)' : 'Show cause (RFD-08)', short: memo && !scn ? 'Memo' : 'Show cause',
      done: true, date: dateOf(scn ? f?.scn?.date : f?.deficiency), bad: memo && !scn,
    });
  }
  if (scn) steps.push({ key: 'reply', label: 'Replied (RFD-09)', short: 'Replied', done: replied || ordered, date: dateOf(f?.replied) });
  if (f?.provisional) steps.push({ key: 'provisional', label: 'Provisional (RFD-04)', short: 'Provisional', done: true, date: dateOf(f.provisional) });
  if (withdrawn) {
    steps.push({ key: 'order', label: 'Withdrawn', short: 'Withdrawn', done: true, date: null, bad: true });
    return steps;
  }
  if (memo && !scn && !ordered) return steps;
  steps.push({ key: 'order', label: rejected ? 'Rejected (RFD-06)' : 'Order (RFD-06)', short: rejected ? 'Rejected' : 'Order', done: ordered, date: dateOf(f?.order?.date), bad: rejected });
  if (!rejected) steps.push({ key: 'paid', label: 'Paid (RFD-05)', short: 'Paid', done: paid, date: dateOf(f?.paid) });
  return steps;
}

// ── Money ───────────────────────────────────────────────────────────────────
export interface Money {
  claimed: number;
  sanctioned: number;
  rejected: number;
  /** Claimed on refunds still open with no order yet. */
  awaiting: number;
  withdrawn: number;
  /** Claimed on decided refunds whose outcome is not read yet (no amounts on the portal, no order read). */
  unread: number;
}

export const NO_MONEY: Money = { claimed: 0, sanctioned: 0, rejected: 0, awaiting: 0, withdrawn: 0, unread: 0 };

/** Where one refund's claim stands; the parts add up to the claim. */
export function moneyOf(r: RefundRow): Money {
  const c = r.claimed ?? 0;
  const st = (r.fact.status ?? '').toLowerCase();
  if (/withdraw/.test(st)) return { ...NO_MONEY, claimed: c, withdrawn: c };
  const s = Math.min(r.sanctioned ?? 0, c);
  if (r.state.open && s === 0 && !r.rejected) return { ...NO_MONEY, claimed: c, awaiting: c };
  let rj = Math.min(r.rejected ?? 0, c - s);
  let rest = c - s - rj;
  // Rejected in full on the portal, nothing read: the whole claim is rejected.
  if (rest > 0 && s === 0 && /reject/.test(st) && !/partial/.test(st)) { rj += rest; rest = 0; }
  return { ...NO_MONEY, claimed: c, sanctioned: s, rejected: rj, unread: Math.max(0, rest) };
}

export function addMoney(a: Money, b: Money): Money {
  return {
    claimed: a.claimed + b.claimed, sanctioned: a.sanctioned + b.sanctioned, rejected: a.rejected + b.rejected,
    awaiting: a.awaiting + b.awaiting, withdrawn: a.withdrawn + b.withdrawn, unread: a.unread + b.unread,
  };
}

export const sumMoney = (rows: RefundRow[]) => rows.reduce((t, r) => addMoney(t, moneyOf(r)), NO_MONEY);

/** The parts of a claim in the order the bars show them, with their colour. */
export const MONEY_PARTS: { key: Exclude<keyof Money, 'claimed'>; label: string; bar: string; dot: string }[] = [
  { key: 'sanctioned', label: 'Sanctioned', bar: 'bg-success', dot: 'bg-success' },
  { key: 'rejected', label: 'Rejected', bar: 'bg-destructive', dot: 'bg-destructive' },
  { key: 'awaiting', label: 'Awaiting a decision', bar: 'bg-info', dot: 'bg-info' },
  { key: 'unread', label: 'Decided, amounts not read yet', bar: 'bg-muted-foreground/30', dot: 'bg-muted-foreground/40' },
  { key: 'withdrawn', label: 'Withdrawn', bar: 'bg-muted-foreground/60', dot: 'bg-muted-foreground/70' },
];

// ── Links ───────────────────────────────────────────────────────────────────
const LINK_WORDS: Record<string, { child: string; parent: string }> = {
  appeal: { child: 'Appeal', parent: 'Appeal of' },
  waiver: { child: 'Waiver application', parent: 'Waiver of' },
  rectification: { child: 'Rectification', parent: 'Rectifies' },
  reapplication: { child: 'Fresh application', parent: 'Re-filed after' },
  related: { child: 'Related', parent: 'Related' },
};
/** What the linked case is to this refund: "Appeal", "Fresh application", "Re-filed after". */
export const linkWord = (kind: string, dir: 'child' | 'parent') => (LINK_WORDS[kind] ?? LINK_WORDS.related)[dir];
