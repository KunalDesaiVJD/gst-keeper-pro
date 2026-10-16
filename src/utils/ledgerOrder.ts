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
//   - a day the balances do not put in exactly one order (the cash ledger's
//     balance is the portal's tot_rng_bal, which carries interest, fee and
//     other amounts its tax heads do not, so a deposit with them chains to
//     nothing) keeps the order the rows were stored in: the pull writes a
//     month in the portal's own order, and the database hands it back that
//     way. Only when the balances prove that order wrong (an entry moving a
//     known balance less than its amount or the other way, or the day not
//     ending on the Closing Balance) does the order they fit strictly better
//     replace it: more entries chaining from the one before, then more moving
//     the balance their own way. Never a rule like "credits first", which put
//     a later deposit ahead of the set-off it followed. Nothing is dropped or
//     repeated: the result holds every line given, once.
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
  /** The convention the order was built on (for 'auto', the one whose balances chain more often). */
  convention: BalanceConvention;
  /** Days with more than one entry whose order the serial numbers or the balances settled. */
  settled: number;
  /** Days with more than one entry no unique chain orders: as stored, unless the balances fit another order better. */
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
// counts as unsettled (bestFit) rather than hold the report up.
const SEARCH_BUDGET = 20000;
const CHAIN_CAP = 8;
// A day the balances do not settle is fitted over every order up to this
// many entries (2^n × n² steps); a longer one keeps its stored order.
const FIT_CAP = 12;

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
      // An entry of no amount (a fee only) would chain from any equal balance: never a link.
      if (prev !== null && (Math.abs(l.amount) < 0.005 || !near(l.balance as number, prev + signedAmount(l, convention)))) continue;
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

type Step = 'chain' | 'way' | 'against' | 'unknown';

/**
 * How a step from the balance `prev` to entry `l` reads: 'chain' when its
 * balance is `prev` plus its signed amount; 'way' when it moves the balance
 * its own way by more than its amount (the balance also carries interest,
 * fees and other amounts the stored tax heads leave out, which only ever add
 * to an entry's movement: a deposit with interest rises by more than its
 * amount, a set-off of a late fee falls by more); 'against' when it moves the
 * balance less than its amount or the other way, which its true place never
 * does; 'unknown' when a balance is not known. An entry of no amount (a fee
 * or interest only: the stored tax heads are all 0) is never a chain, since it
 * would "chain" from any balance equal to its own, the opening's included.
 */
const stepFit = (prev: number | null, l: LedgerLine, convention: BalanceConvention): Step => {
  if (prev === null || l.balance === null || !Number.isFinite(l.balance) || l.isDebit === null) return 'unknown';
  const signed = signedAmount(l, convention);
  if (Math.abs(l.amount) >= 0.005 && near(l.balance, prev + signed)) return 'chain';
  const adds = convention === 'debit-adds' ? l.isDebit : !l.isDebit;
  // What the step moved beyond its own amount, its own way.
  const beyond = adds ? l.balance - prev - signed : signed - (l.balance - prev);
  return beyond > -0.005 ? 'way' : 'against';
};

/**
 * Whether a stored order is proven wrong by the balances: a step from a
 * known balance moving it less than its amount or the other way ('against'),
 * or the day's last balance not
 * reaching `end` (the period's Closing Balance after its last day). A step
 * from an unknown balance (no opening row, or after a day the balances did
 * not settle) proves nothing.
 */
function contradicted<T>(order: Stored<T>[], start: number | null, end: number | null, convention: BalanceConvention): boolean {
  let prev = start;
  for (const s of order) {
    if (stepFit(prev, s.line, convention) === 'against') return true;
    prev = s.line.balance;
  }
  return end !== null && prev !== null && Number.isFinite(prev) && !near(prev, end);
}

/**
 * An order's fit to the running balance, as one number: first the fewer
 * contradictions (a step 'against', the day's last balance missing `end`),
 * then the more steps that chain. Each step and the end score `sound` unless
 * they contradict, and a chain adds 1, so one contradiction outweighs every
 * chain a day of n entries can have (n + 2 against at most n).
 */
const sound = (n: number): number => n + 2;
const fitOf = (k: Step, n: number): number => (k === 'against' ? 0 : sound(n) + (k === 'chain' ? 1 : 0));
const endFit = (last: number | null, end: number | null, n: number): number =>
  (last === null || end === null || near(last, end) ? sound(n) : 0);

function fitScore<T>(order: Stored<T>[], start: number | null, end: number | null, convention: BalanceConvention): number {
  const n = order.length;
  let score = 0;
  let prev = start;
  for (const s of order) {
    score += fitOf(stepFit(prev, s.line, convention), n);
    prev = s.line.balance;
  }
  return score + endFit(prev, end, n);
}

/**
 * A day no unique chain orders. Its stored order is the portal's own (the
 * pull writes a month as the portal lists it), so it stays unless the
 * balances prove it wrong (contradicted): then the order fitting them best
 * (fitScore) is taken, if strictly better, so rows read back in some other
 * order are put right while a day whose balances fit several orders as well
 * is not guessed. Of the orders fitting best, the one nearest the stored
 * order: at each place, the earliest stored entry that still lets the best
 * fit be reached. `start` is the balance before the day as best known (after
 * a day the balances did not settle, that day's last balance as listed).
 * Searched by subsets (for each set of entries placed and the last of them,
 * the best fit of the entries still to come); a day of more than FIT_CAP
 * entries keeps its stored order.
 */
function bestFit<T>(group: Stored<T>[], start: number | null, end: number | null, convention: BalanceConvention): Stored<T>[] {
  const stored = [...group].sort((a, b) => a.at - b.at);
  const n = stored.length;
  if (n > FIT_CAP || !contradicted(stored, start, end, convention)) return stored;
  const full = (1 << n) - 1;
  const step = (prev: number | null, j: number) => fitOf(stepFit(prev, stored[j].line, convention), n);
  // rest[mask * n + i]: the best fit of the entries not in `mask`, placed after entry i (in mask) ends it.
  const rest = new Int32Array((1 << n) * n);
  for (let mask = full; mask >= 1; mask--) {
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const bal = stored[i].line.balance;
      if (mask === full) { rest[mask * n + i] = endFit(bal, end, n); continue; }
      let top = 0;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        top = Math.max(top, step(bal, j) + rest[(mask | (1 << j)) * n + j]);
      }
      rest[mask * n + i] = top;
    }
  }
  let best = 0;
  for (let j = 0; j < n; j++) best = Math.max(best, step(start, j) + rest[(1 << j) * n + j]);
  if (best <= fitScore(stored, start, end, convention)) return stored;
  const order: Stored<T>[] = [];
  let mask = 0;
  let prev = start;
  let need = best;
  while (mask !== full) {
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) continue;
      const here = step(prev, j);
      if (here + rest[(mask | (1 << j)) * n + j] !== need) continue;
      order.push(stored[j]);
      mask |= 1 << j;
      need -= here;
      prev = stored[j].line.balance;
      break;
    }
  }
  return order;
}

/**
 * The ledger in its order under one convention, and the evidence for that
 * convention: how many entries chain (chainScore) with each unsettled day as
 * stored. Not as listed: bestFit searches for the order fitting the balances
 * best, so under the wrong convention it could find a chance chain there
 * that the rows themselves never showed.
 */
function orderWith<T>(lines: LedgerLine<T>[], convention: BalanceConvention): { order: LedgerOrder<T>; evidence: number } {
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
  const asStored: LedgerLine<T>[] = [];
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
    // The same, each unsettled day as stored: the convention's evidence.
    const shadow: Stored<T>[] = [...openings];
    const lastOpening = openings[openings.length - 1]?.line.balance;
    // `start`: the balance before the day, proven (a chain may open only from
    // it); `listed`: the last balance as listed so far, proven or not.
    let start: number | null = typeof lastOpening === 'number' ? lastOpening : null;
    let listed: number | null = start;
    const closingBalance = closings[0]?.line.balance;
    days.forEach((day, k) => {
      if (day.length === 1) {
        placed.push(day[0]);
        shadow.push(day[0]);
        start = day[0].line.balance;
        listed = start;
        return;
      }
      const isLast = k === days.length - 1;
      const end = isLast && typeof closingBalance === 'number' ? closingBalance : null;
      const nextStarts = isLast ? null : days[k + 1]
        .filter((s) => s.line.balance !== null)
        .map((s) => (s.line.balance as number) - signedAmount(s.line, convention));
      const serial = bySerial(day);
      let ordered = serial ?? byChain(day, start, end, nextStarts, convention);
      // A chain opened from an unknown balance (after a day the balances did
      // not settle) proves less than one from a known one: it may open with
      // any entry. Unless it is the stored order itself, it replaces that
      // order only when the balance as listed before the day contradicts the
      // stored order and not the chain; otherwise the day is judged as an
      // unsettled one (kept as stored unless the balances prove it wrong).
      if (!serial && ordered && start === null && listed !== null) {
        const asStored = [...day].sort((a, b) => a.at - b.at);
        const same = ordered.every((s, i) => s === asStored[i]);
        if (!same && (contradicted(ordered, listed, end, convention) || !contradicted(asStored, listed, end, convention))) ordered = null;
      }
      if (ordered) {
        settled += 1;
        placed.push(...ordered);
        shadow.push(...ordered);
        start = ordered[ordered.length - 1].line.balance;
        listed = start;
      } else {
        unsettled.push({ period, date: dateOf(day[0].line) as string, count: day.length });
        const fitted = bestFit(day, start ?? listed, end, convention);
        placed.push(...fitted);
        shadow.push(...[...day].sort((a, b) => a.at - b.at));
        // The day's last balance is not proven, so no chain of the next day
        // has to open from it; as listed, it is still the best word on it.
        start = null;
        listed = fitted[fitted.length - 1].line.balance;
      }
    });
    const tail = [...(bySerial(undated) ?? undated), ...closings];
    out.push(...[...placed, ...tail].map((s) => s.line));
    asStored.push(...[...shadow, ...tail].map((s) => s.line));
  }
  return { order: { lines: out, convention, settled, unsettled }, evidence: chainScore(asStored, convention) };
}

/**
 * How many entries chain from the row before them in a period, in the
 * order built. An entry of no amount chains under either convention alike,
 * so it does not count.
 */
function chainScore<T>(lines: LedgerLine<T>[], convention: BalanceConvention): number {
  let score = 0;
  let prev: LedgerLine<T> | null = null;
  for (const l of lines) {
    if (prev && prev.period === l.period && l.role === 'entry' && prev.balance !== null && l.balance !== null
      && Math.abs(l.amount) >= 0.005 && near(l.balance, prev.balance + signedAmount(l, convention))) score += 1;
    prev = l;
  }
  return score;
}

/** The ledger's lines in its own order (see the header comment). */
export function orderLedger<T>(lines: LedgerLine<T>[], options: LedgerOrderOptions): LedgerOrder<T> {
  if (options.convention !== 'auto') return orderWith(lines, options.convention).order;
  const prefer = options.prefer ?? 'credit-adds';
  const other: BalanceConvention = prefer === 'credit-adds' ? 'debit-adds' : 'credit-adds';
  const a = orderWith(lines, prefer);
  const b = orderWith(lines, other);
  return (b.evidence > a.evidence ? b : a).order;
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
