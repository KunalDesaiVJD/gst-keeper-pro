// The order of a portal ledger's rows (the Cash Ledger, the Liability
// Register, the Credit Ledger's transaction detail), rebuilt from what the
// rows themselves say. The tables keep no sequence: ids are random uuids and
// created_at is one timestamp for a whole pull, and the Opening / Closing
// Balance rows carry no date. Ordered by date alone, a financial year's
// monthly balances fell to the end of the list and entries of one day came in
// whatever order the database returned them. So:
//   - periods in their own order: 'MM/YYYY' read as a month count across
//     years, never as text (as text 01/2027 sorts before 04/2026);
//   - within a period its Opening Balance first, then the dated entries by
//     date, then any undated entry (a "PULL FAILED" breadcrumb), then its
//     Closing Balance;
//   - entries of one day in the order the running balance proves: from the
//     balance before them, the next entry is the one whose own balance is that
//     balance plus or minus its amount. The portal's own serial number, where
//     a row carries one (the credit ledger's row text does), settles it first:
//     the portal printed the rows in that order, so it is a chain already;
//   - a day the balances do not put in exactly one order keeps a stable
//     fallback: the entries that add to the balance first (deposits before
//     their use in the cash ledger, a liability before its discharge in the
//     liability register), then the order the rows were stored in. Nothing
//     is dropped or repeated: the result holds every line given, once.
// Pure (no Supabase, no React), so scripts/verify-ledger-order.mjs runs it under Node.

export type LedgerRole = 'opening' | 'closing' | 'entry';

/**
 * Which way an entry moves the running balance. The cash and credit ledgers
 * hold money or credit: a credit adds to it, a debit uses it. The liability
 * register holds what is owed: a debit (the return's liability) adds, a credit
 * (its discharge) reduces.
 */
export type BalanceConvention = 'credit-adds' | 'debit-adds';

export interface LedgerLine<T = unknown> {
  row: T;
  /** The return period, 'MM/YYYY'. */
  period: string;
  role: LedgerRole;
  /** The entry's date, 'YYYY-MM-DD' (anything else counts as undated). */
  date: string | null;
  /** true a debit, false a credit, null neither (a balance row). */
  isDebit: boolean | null;
  /** The entry's own amount over every head. */
  amount: number;
  /** The running balance after the row, or null where the ledger carries none. */
  balance: number | null;
  /** The portal's own serial number of the row, where it prints one. */
  serial?: number | null;
}

export interface UnsettledDay { period: string; date: string; count: number }

export interface LedgerOrder<T> {
  /** Every line given, once, in the ledger's order. */
  lines: LedgerLine<T>[];
  /** The convention the order was built on (for 'auto', the one whose balances chain). */
  convention: BalanceConvention;
  /** Days with more than one entry whose order the serial numbers or the balances settled. */
  settled: number;
  /** Days with more than one entry no unique chain orders: listed by the fallback. */
  unsettled: UnsettledDay[];
}

export interface LedgerOrderOptions {
  /** 'auto': try both and keep the one whose balances chain more often. */
  convention: BalanceConvention | 'auto';
  /** Under 'auto', the convention kept when neither chains better. */
  prefer?: BalanceConvention;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const PERIOD_RE = /^(\d{1,2})\/(\d{4})$/;
// A same-day group is searched for chains within these bounds; past them it
// takes the fallback rather than hold the report up.
const SEARCH_BUDGET = 20000;
const CHAIN_CAP = 8;

/** 'MM/YYYY' as a month count (year × 12 + month), so periods order across years; anything else sorts last. */
export const periodIndex = (period: string): number => {
  const m = PERIOD_RE.exec(String(period ?? '').trim());
  if (!m || +m[1] < 1 || +m[1] > 12) return Number.POSITIVE_INFINITY;
  return +m[2] * 12 + (+m[1] - 1);
};

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
const dateOf = (l: LedgerLine): string | null => (l.date && ISO_DATE_RE.test(l.date) ? l.date.slice(0, 10) : null);

/** The entry's movement of the running balance under a convention. */
const signedAmount = (l: LedgerLine, convention: BalanceConvention): number => {
  if (l.isDebit === null) return 0;
  const adds = convention === 'debit-adds' ? l.isDebit : !l.isDebit;
  return adds ? l.amount : -l.amount;
};

interface Stored<T> { line: LedgerLine<T>; at: number }

/** One day's entries in the portal's serial order, when every one carries a distinct serial. */
function bySerial<T>(group: Stored<T>[]): Stored<T>[] | null {
  const serials = group.map((s) => s.line.serial);
  if (serials.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  if (new Set(serials).size !== serials.length) return null;
  return [...group].sort((a, b) => (a.line.serial as number) - (b.line.serial as number));
}

/**
 * One day's entries in the only order their balances chain in, or null. A
 * chain starts from `start` (the balance before the day; null when unknown,
 * so any entry may open it), each entry's balance is the one before it plus
 * its signed amount, and it ends on `end` when that is known (the period's
 * Closing Balance after its last day). Entries alike in direction, amount and
 * balance are interchangeable, so orders differing only in them count once
 * (and keep their stored order). Several chains left: `nextStarts`, the
 * balances the next day can start from, may single one out.
 */
function byChain<T>(
  group: Stored<T>[], start: number | null, end: number | null, nextStarts: number[] | null, convention: BalanceConvention,
): Stored<T>[] | null {
  if (group.some((s) => s.line.balance === null || !Number.isFinite(s.line.balance))) return null;
  const n = group.length;
  const used = new Array<boolean>(n).fill(false);
  const path: number[] = [];
  const chains: number[][] = [];
  let nodes = 0;
  let aborted = false;
  const dfs = (prev: number | null) => {
    if (++nodes > SEARCH_BUDGET) { aborted = true; return; }
    if (path.length === n) {
      if (end === null || (prev !== null && near(prev, end))) chains.push([...path]);
      return;
    }
    const alike = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const l = group[i].line;
      const sig = `${l.isDebit}|${Math.round(l.amount * 100)}|${Math.round((l.balance as number) * 100)}`;
      if (alike.has(sig)) continue;
      alike.add(sig);
      if (prev !== null && !near(l.balance as number, prev + signedAmount(l, convention))) continue;
      used[i] = true;
      path.push(i);
      dfs(l.balance);
      path.pop();
      used[i] = false;
      if (aborted || chains.length > CHAIN_CAP) return;
    }
  };
  dfs(start);
  if (aborted || chains.length > CHAIN_CAP || !chains.length) return null;
  let pick = chains;
  if (pick.length > 1 && nextStarts?.length) {
    pick = pick.filter((c) => nextStarts.some((v) => near(v, group[c[n - 1]].line.balance as number)));
  }
  return pick.length === 1 ? pick[0].map((i) => group[i]) : null;
}

/** The stable fallback: entries that add to the balance, then those that reduce it, then the rest; each as stored. */
function fallback<T>(group: Stored<T>[], convention: BalanceConvention): Stored<T>[] {
  const rank = (l: LedgerLine) => (l.isDebit === null ? 2 : signedAmount(l, convention) >= 0 ? 0 : 1);
  return [...group].sort((a, b) => rank(a.line) - rank(b.line) || a.at - b.at);
}

function orderWith<T>(lines: LedgerLine<T>[], convention: BalanceConvention): LedgerOrder<T> {
  const stored: Stored<T>[] = lines.map((line, at) => ({ line, at }));
  // Periods in their own order; an unreadable period after the rest, by its text.
  const byPeriod = new Map<string, Stored<T>[]>();
  for (const s of stored) {
    const key = String(s.line.period ?? '');
    const list = byPeriod.get(key);
    if (list) list.push(s);
    else byPeriod.set(key, [s]);
  }
  const periods = [...byPeriod.keys()].sort((a, b) => {
    const ia = periodIndex(a);
    const ib = periodIndex(b);
    if (ia !== ib) return ia < ib ? -1 : 1;
    return Number.isFinite(ia) ? 0 : a < b ? -1 : a > b ? 1 : 0;
  });

  const out: LedgerLine<T>[] = [];
  let settled = 0;
  const unsettled: UnsettledDay[] = [];
  for (const period of periods) {
    const rows = byPeriod.get(period) as Stored<T>[];
    const openings = rows.filter((s) => s.line.role === 'opening');
    const closings = rows.filter((s) => s.line.role === 'closing');
    const entries = rows.filter((s) => s.line.role === 'entry');
    const dated = entries.flatMap((s) => { const d = dateOf(s.line); return d ? [{ s, d }] : []; })
      .sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.s.at - y.s.at));
    const undated = entries.filter((s) => dateOf(s.line) === null);
    const days: Stored<T>[][] = [];
    dated.forEach(({ s, d }, k) => {
      if (k > 0 && dated[k - 1].d === d) days[days.length - 1].push(s);
      else days.push([s]);
    });

    const placed: Stored<T>[] = [...openings];
    const lastOpening = openings[openings.length - 1]?.line.balance;
    let start: number | null = typeof lastOpening === 'number' ? lastOpening : null;
    const closingBalance = closings[0]?.line.balance;
    days.forEach((day, k) => {
      if (day.length === 1) {
        placed.push(day[0]);
        start = day[0].line.balance;
        return;
      }
      const isLast = k === days.length - 1;
      const end = isLast && typeof closingBalance === 'number' ? closingBalance : null;
      const nextStarts = isLast ? null : days[k + 1]
        .filter((s) => s.line.balance !== null)
        .map((s) => (s.line.balance as number) - signedAmount(s.line, convention));
      const ordered = bySerial(day) ?? byChain(day, start, end, nextStarts, convention);
      if (ordered) {
        settled += 1;
        placed.push(...ordered);
        start = ordered[ordered.length - 1].line.balance;
      } else {
        unsettled.push({ period, date: dateOf(day[0].line) as string, count: day.length });
        placed.push(...fallback(day, convention));
        // The day's last balance is not proven, so the next day starts unknown.
        start = null;
      }
    });
    placed.push(...(bySerial(undated) ?? undated), ...closings);
    out.push(...placed.map((s) => s.line));
  }
  return { lines: out, convention, settled, unsettled };
}

/** How many entries chain from the row before them in a period, under the order built. */
function chainScore<T>(order: LedgerOrder<T>): number {
  let score = 0;
  let prev: LedgerLine<T> | null = null;
  for (const l of order.lines) {
    if (prev && prev.period === l.period && l.role === 'entry' && prev.balance !== null && l.balance !== null
      && near(l.balance, prev.balance + signedAmount(l, order.convention))) score += 1;
    prev = l;
  }
  return score;
}

/** The ledger's lines in its own order (see the header comment). */
export function orderLedger<T>(lines: LedgerLine<T>[], options: LedgerOrderOptions): LedgerOrder<T> {
  if (options.convention !== 'auto') return orderWith(lines, options.convention);
  const prefer = options.prefer ?? 'credit-adds';
  const other: BalanceConvention = prefer === 'credit-adds' ? 'debit-adds' : 'credit-adds';
  const a = orderWith(lines, prefer);
  const b = orderWith(lines, other);
  return chainScore(b) > chainScore(a) ? b : a;
}

// ── The credit ledger's row text ─────────────────────────────────────────────
// The credit ledger's transaction detail is scraped from the portal page as
// each row's whole text: "2 18/04/2026 AB2403269852622 Mar-26 ITC accrued
// through - Inputs Credit 1,632.00 8,055.00 8,055.00 0.00 17,742.00 23,465.00
// 55,751.00 57,171.00 0.00 1,36,387.00" — the serial, the date, the reference,
// the tax period, the description, the type, then the amount block and the
// balance block (IGST, CGST, SGST, Cess, Total each). Read back here only to
// order the rows; a part that does not read is left null and the order falls
// back without it.

export interface CreditLedgerText {
  serial: number | null;
  /** 'YYYY-MM-DD'. */
  date: string | null;
  /** The amount block's total (its last figure when it has five). */
  amount: number | null;
  /** The balance block's total after the row. */
  balance: number | null;
}

const NUM_TOKEN_RE = /^-?\d[\d,]*(\.\d+)?$/;

export function readCreditLedgerText(text: string | null | undefined): CreditLedgerText {
  const tokens = String(text ?? '').replace(/₹/g, ' ').split(/\s+/).filter(Boolean);
  const serial = tokens.length > 1 && /^\d{1,6}$/.test(tokens[0]) ? Number(tokens[0]) : null;
  const dm = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(tokens.slice(0, 4).join(' '));
  const date = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
  // The trailing run of figures: an amount block and a balance block of equal length.
  const run: number[] = [];
  for (let k = tokens.length - 1; k >= 0 && NUM_TOKEN_RE.test(tokens[k]); k--) run.unshift(Number(tokens[k].replace(/,/g, '')));
  let amount: number | null = null;
  let balance: number | null = null;
  if (run.length >= 6 && run.length % 2 === 0 && run.every(Number.isFinite)) {
    const half = run.length / 2;
    const total = (xs: number[]) => (xs.length === 5 ? xs[4] : xs.reduce((s, x) => s + x, 0));
    amount = total(run.slice(0, half));
    balance = total(run.slice(half));
  }
  return { serial, date, amount, balance };
}
