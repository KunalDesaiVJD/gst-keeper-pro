// What the Refunds page shows of each refund, worked out once (the firm's
// request of 25 October 2026: one page for refunds, a bird's-eye view first and
// every aspect of a refund in one place): the steps it has passed with their
// dates, where its money stands, its type in a few words and its period.
import { REFUND_REASONS } from '@/lib/noticeCases';
import type { RefundRow } from './ledgerData';

const UNKNOWN = '0000-00-00';
const dateOf = (d: string | null | undefined) => (d && d !== UNKNOWN ? d : null);

/** A refund's own page. */
export const refundHref = (clientId: string, arn: string) => `/refunds/${clientId}/${encodeURIComponent(arn)}`;

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
export const refundPeriod = (r: RefundRow) => periodText(r.period?.from ?? null, r.period?.to ?? null);

// ── Financial years and quarters (Q1 = Apr–Jun) ────────────────────────────
export interface FyQuarter { fy: number; q: 1 | 2 | 3 | 4 }
/** "2025-07" or "2025-07-23" → FY 2025-26, Q2. */
export function quarterOf(iso: string): FyQuarter {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return { fy: m >= 4 ? y : y - 1, q: (m >= 4 ? Math.ceil((m - 3) / 3) : 4) as FyQuarter['q'] };
}
export const fyLabel = (fy: number) => `FY ${fy}-${String(fy + 1).slice(2)}`;
export const QUARTERS: { q: FyQuarter['q']; label: string; months: string }[] = [
  { q: 1, label: 'Q1', months: 'Apr–Jun' }, { q: 2, label: 'Q2', months: 'Jul–Sep' },
  { q: 3, label: 'Q3', months: 'Oct–Dec' }, { q: 4, label: 'Q4', months: 'Jan–Mar' },
];
/** How many quarters a period spans (1 for a month or a quarter). */
export function quarterSpan(from: string, to: string): number {
  const a = quarterOf(from);
  const b = quarterOf(to);
  return Math.max(1, (b.fy - a.fy) * 4 + (b.q - a.q) + 1);
}
/** The quarter a refund sits in: its period's first month, else (marked) the month it was filed. */
export function placeOf(r: RefundRow): (FyQuarter & { byFiling: boolean }) | null {
  if (r.period) return { ...quarterOf(r.period.from), byFiling: false };
  return r.fact.filed_date ? { ...quarterOf(r.fact.filed_date), byFiling: true } : null;
}

// ── One word for where a refund stands (the grid's and the register's colours) ─
/** A refund's financial year and period, the same words on every page that shows it. */
export interface RefundWhen { fy: string; period: string | null; byFiling: boolean; fromAi: boolean }
export function refundWhen(r: RefundRow): RefundWhen | null {
  const p = placeOf(r);
  if (!p) return null;
  const end = r.period?.to ? quarterOf(r.period.to).fy : p.fy;
  const fy = end > p.fy ? `FY ${p.fy}-${String(p.fy + 1).slice(2)} to ${end}-${String(end + 1).slice(2)}` : fyLabel(p.fy);
  return { fy, period: refundPeriod(r), byFiling: p.byFiling, fromAi: r.period?.source === 'ai' };
}
/** "FY 2024-25 · Apr–Jun 2024", for a title or an export. */
export function refundWhenText(r: RefundRow): string | null {
  const w = refundWhen(r);
  return w ? `${w.fy} · ${w.period ?? 'period not captured'}` : null;
}

export type Tone = 'action' | 'open' | 'full' | 'part' | 'rejected' | 'withdrawn' | 'refiled' | 'nil' | 'closed';
export const TONE_LABEL: Record<Tone, string> = {
  action: 'Needs action', open: 'With the officer', full: 'Sanctioned', part: 'Part rejected',
  rejected: 'Rejected', withdrawn: 'Withdrawn', refiled: 'Re-filed', nil: 'Nil application', closed: 'Closed',
};
/** Fill of a grid cell, by where the refund stands. */
export const TONE_CELL: Record<Tone, string> = {
  action: 'border-destructive bg-destructive/10', open: 'border-info/40 bg-info/10', full: 'border-success/40 bg-success/10',
  part: 'border-warning/60 bg-warning/15', rejected: 'border-destructive/40 bg-destructive/[0.06]', withdrawn: 'border-border bg-muted/60',
  refiled: 'border-border bg-muted/60', nil: 'border-border bg-muted/40', closed: 'border-border bg-muted/40',
};
/** Text colour of a tone's word. */
export const TONE_TEXT: Record<Tone, string> = {
  action: 'text-destructive-strong', open: 'text-info', full: 'text-success-strong', part: 'text-amber-700 dark:text-amber-400',
  rejected: 'text-destructive-strong', withdrawn: 'text-muted-foreground', refiled: 'text-muted-foreground', nil: 'text-muted-foreground', closed: 'text-muted-foreground',
};

export function toneOf(r: RefundRow): Tone {
  if (/withdraw/i.test(r.fact.status ?? '')) return 'withdrawn';
  if (r.state.refiledAs) return 'refiled';
  if (r.state.group === 'nil') return 'nil';
  if (r.state.group === 'action') return 'action';
  if (r.state.open) return 'open';
  if ((r.sanctioned ?? 0) > 0) return (r.rejected ?? 0) > 0 ? 'part' : 'full';
  if (r.state.group === 'paid') return 'full';
  if (r.state.group === 'rejected') return 'rejected';
  return 'closed';
}

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
  const paid = !!f?.paid || !!r.read?.paid || /disburs|paid|rfd-?0?5|re-?credit|pmt-?03/.test(st);
  const memo = !!f?.deficiency || /deficien|rfd-?03/.test(st);
  const scn = !!f?.scn || /rfd-?08|show cause/.test(st);
  const replied = !!f?.replied || /reply filed|rfd-?09/.test(st);
  const withdrawn = /withdraw/.test(st);
  const rejected = /reject/.test(st) && !/partial/.test(st) && !(r.sanctioned && r.sanctioned > 0);
  const steps: RefundStep[] = [
    { key: 'filed', label: 'Applied (RFD-01)', short: 'Applied', done: true, date: r.fact.filed_date },
  ];
  // A NIL application claims nothing, so nothing follows it.
  if (r.state.group === 'nil' && !r.state.refiledAs) return steps;
  steps.push(
    { key: 'ack', label: 'Acknowledged (RFD-02)', short: 'Acknowledged', done: !!f?.ack || /acknowledg|rfd-?02/.test(st) || ordered || scn || replied, date: dateOf(f?.ack) },
  );
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
  // Withdrawn, or replaced by a fresh application after a memo: the claim is counted once, on the fresh one.
  if (/withdraw/.test(st) || r.state.refiledAs) return { ...NO_MONEY, claimed: c, withdrawn: c };
  if (r.state.group === 'nil') return { ...NO_MONEY, claimed: c };
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

// ── Time limits (L12 of the law audit, 26 Oct 2026) ────────────────────────
// s.54(1): a claim within 2 years of the relevant date (Explanation 2 to
// s.54); rule 90(3): after a deficiency memo a fresh claim, the time from
// filing to the memo left out of the 2 years (from 26 Dec 2022); s.54(7): the
// order within 60 days of a complete application; s.56: 6% interest after
// that (9% where an appeal or court orders the refund, not tracked here). The
// relevant date is estimated from the type and period, never read: a person
// confirms it on the papers.

/** The day n days on. */
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The same day n years on (29 Feb → 28 Feb). */
const plusYears = (iso: string, n: number) => {
  const y = Number(iso.slice(0, 4)) + n;
  const md = iso.slice(5, 10);
  return md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? `${y}-02-28` : `${y}-${md}`;
};
const monthEnd = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface RefundClocks {
  /** The relevant date as estimated, and how. Null when the type has none (cash ledger) or the period is unknown. */
  relevantDate: string | null;
  relevantBasis: string;
  /** The last day to file the claim (2 years). */
  limitBy: string | null;
  /** After a deficiency memo: the last day for a fresh claim, with the time the first claim was pending left out. */
  refileBy: string | null;
  /** s.54(7): the order is due 60 days after the application. */
  orderDue: string | null;
  /** s.56: interest at 6% a year on the claim from the 61st day while no order is on record. */
  interestDays: number;
  interest: number;
  /** One line per clock, for the page. */
  lines: { label: string; date: string | null; tone: 'ok' | 'warn' | 'danger' | 'muted'; note: string }[];
}

const NO_LIMIT = new Set(['EXBCL']);

export function refundClocks(r: RefundRow, today: string): RefundClocks {
  const code = typeCode(r);
  const filed = dateOf(r.fact.filed_date);
  const st = `${r.fact.status ?? ''}`.toLowerCase();
  const memo = dateOf(r.signals?.deficiency) ?? null;
  const decided = /sanction|reject|disburs|paid|withdraw|re-?credit|processed/.test(st) || !!r.signals?.order;
  let relevantDate: string | null = null;
  let relevantBasis = 'Period not captured: the relevant date cannot be estimated.';
  if (NO_LIMIT.has(code)) {
    relevantBasis = 'Refund of the cash ledger balance: no time limit applies.';
  } else if (code === 'ASSESS') {
    relevantBasis = 'After an order or appeal: 2 years from the communication of that order. Check its date on the papers.';
  } else if (r.period?.to) {
    const end = monthEnd(r.period.to);
    if (code === 'INVITC') {
      relevantDate = plusDays(end, 20);
      relevantBasis = 'Inverted duty: the due date of the return for the period (Explanation 2(e) to s.54), taken as the 20th of the next month.';
    } else {
      relevantDate = end;
      relevantBasis = 'Estimated as the end of the period claimed; for exports it is the date of shipment or of payment, which can be earlier.';
    }
  }
  const limitBy = relevantDate ? plusYears(relevantDate, 2) : null;
  const refileBy = limitBy && memo && filed && memo !== UNKNOWN && memo >= '2022-12-26' && memo >= filed
    ? plusDays(limitBy, days(filed, memo)) : null;
  const orderDue = filed ? plusDays(filed, 60) : null;
  const pending = !decided && !memo && !/withdraw/.test(st);
  const interestDays = pending && orderDue && today > orderDue ? days(orderDue, today) : 0;
  const interest = interestDays > 0 && r.claimed ? Math.round((r.claimed * 6 * interestDays) / 36500) : 0;

  const lines: RefundClocks['lines'] = [];
  if (limitBy) {
    lines.push({
      label: 'Time to claim (2 years)', date: limitBy,
      tone: filed && filed <= limitBy ? 'ok' : filed ? 'danger' : today > limitBy ? 'danger' : 'warn',
      note: filed ? (filed <= limitBy ? 'Filed within the time.' : 'Filed after the 2 years on this estimate: check the relevant date on the papers.') : 'Not filed yet.',
    });
  }
  if (memo) {
    lines.push({
      label: 'Fresh claim after the deficiency memo', date: refileBy,
      tone: !refileBy ? 'muted' : today > refileBy ? 'danger' : 'warn',
      note: !refileBy ? 'The memo is before 26 Dec 2022 or the period is unknown: the fresh claim runs from the relevant date with no time left out.'
        : today > refileBy ? 'The time for a fresh claim is over: close the memo with a note, unless a fresh claim was filed.'
        : `The ${days(filed as string, memo)} days the first claim was pending are left out of the 2 years (rule 90(3)).`,
    });
  }
  if (orderDue && !memo && !/withdraw/.test(st)) {
    lines.push({
      label: 'Order due (60 days)', date: orderDue,
      tone: decided ? 'muted' : today > orderDue ? 'danger' : 'warn',
      note: decided ? 'An order is on record.'
        : interestDays > 0 ? `No order yet: interest at 6% a year runs from the 61st day, about ${interestDays} days so far (s.56).`
        : 'The officer must order within 60 days of a complete application (s.54(7)).',
    });
  }
  return { relevantDate, relevantBasis, limitBy, refileBy, orderDue, interestDays, interest, lines };
}

/**
 * A quarter with no claim on the grid (section C of the law audit of 26 Oct
 * 2026): the last day a claim for it can still be filed, two years from its
 * relevant date as refundClocks estimates it (the quarter's end; for inverted
 * duty the 20th of the month after). Null for a type with no time limit or one
 * whose relevant date is an order's.
 */
export function quarterLimit(fy: number, q: FyQuarter['q'], code: string): string | null {
  if (NO_LIMIT.has(code) || code === 'ASSESS') return null;
  const lastMonth = q === 4 ? `${fy + 1}-03` : `${fy}-${String(q * 3 + 3).padStart(2, '0')}`;
  const end = monthEnd(lastMonth);
  return plusYears(code === 'INVITC' ? plusDays(end, 20) : end, 2);
}
