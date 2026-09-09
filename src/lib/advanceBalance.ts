// Open-advance balance engine — derived entirely from GSTR-1 JSONs already
// imported into gstr1_data, plus any manually entered opening balance.
//
// This is Layer 1 of the advance set-off module: no data entry, works
// retroactively for every non-builder client from their first imported month.
// It gives the BALANCE, never the linkage — GSTR-1 Table 11A/11B carry only
// place of supply, supply type and rate, with no counterparty GSTIN and no
// invoice number. Party- and invoice-wise linkage is Layer 2 (the register).
//
// Read docs/ADVANCE_SETOFF_POSITIONS.md §2 and §3 before changing the maths.
// Two positions are load-bearing here and are not obvious from the code alone:
//
//   An amendment REPLACES the figure it corrects — it is not added to it. A
//   GSTR-1 amendment row states the revised value in full.
//
//   An amendment belongs to the month it corrects (`omon`), not the month it
//   was filed in. Applying it to the filing month would show an advance as
//   still open in every month in between.

import { supabase } from '@/integrations/supabase/client';

export interface TaxAmount {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export const zeroTax = (): TaxAmount => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

export const addTax = (a: TaxAmount, b: TaxAmount): TaxAmount => ({
  taxable: a.taxable + b.taxable,
  igst: a.igst + b.igst,
  cgst: a.cgst + b.cgst,
  sgst: a.sgst + b.sgst,
  cess: a.cess + b.cess,
});

export const subTax = (a: TaxAmount, b: TaxAmount): TaxAmount => ({
  taxable: a.taxable - b.taxable,
  igst: a.igst - b.igst,
  cgst: a.cgst - b.cgst,
  sgst: a.sgst - b.sgst,
  cess: a.cess - b.cess,
});

export const totalTax = (t: TaxAmount): number => t.igst + t.cgst + t.sgst + t.cess;

/** True when every component is within a rupee of zero (rounding noise only). */
export const isTaxZero = (t: TaxAmount): boolean =>
  Math.abs(t.taxable) < 1 && Math.abs(totalTax(t)) < 1;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Period helpers. Three formats are in play and mixing them up is the easiest
// way to get this wrong:
//   MM/YYYY  — MonthContext, the app's shared value
//   Mmm-YY   — gstr1_data.period_month ("Jul-26")
//   MMYYYY   — the portal's `fp` and `omon`
// ---------------------------------------------------------------------------

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const mmYyyyToShort = (mmYyyy: string): string => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  const m = Number(mm);
  if (!m || !yyyy) return '';
  return `${MONTH_SHORT[m - 1]}-${String(yyyy).slice(-2)}`;
};

export const shortToMmYyyy = (short: string): string => {
  const [mon, yr] = (short || '').split('-');
  const idx = MONTH_SHORT.indexOf(mon);
  if (idx < 0 || !yr) return '';
  return `${String(idx + 1).padStart(2, '0')}/20${yr}`;
};

/** "MMYYYY" (portal `omon`/`fp`) -> "MM/YYYY". '' if unparseable. */
export const fpToMmYyyy = (fp: string): string => {
  const m = /^(\d{2})(\d{4})$/.exec(String(fp || '').trim());
  if (!m) return '';
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return '';
  return `${m[1]}/${m[2]}`;
};

/**
 * Sortable ordinal for a "MM/YYYY". Comparing the strings themselves is wrong
 * ("02/2027" < "12/2026" lexically), which is a real trap in a module whose
 * whole job is "everything up to and including month M".
 */
export const periodOrdinal = (mmYyyy: string): number => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  const m = Number(mm), y = Number(yyyy);
  if (!m || !y) return NaN;
  return y * 12 + m;
};

// ---------------------------------------------------------------------------
// Keying. A balance is only meaningful per place of supply + rate + supply
// type, because that is the granularity Table 11A/11B is reported at.
// ---------------------------------------------------------------------------

export interface AdvanceKey {
  pos: string;
  ratePct: number;
  splyTy: string; // 'INTRA' | 'INTER'
}

export const keyOf = (k: AdvanceKey): string => `${k.pos}__${k.ratePct}__${k.splyTy}`;

export const parseKey = (s: string): AdvanceKey => {
  const [pos, rate, splyTy] = s.split('__');
  return { pos, ratePct: Number(rate), splyTy };
};

export const describeKey = (k: AdvanceKey): string =>
  `POS ${k.pos} @ ${k.ratePct}% (${k.splyTy === 'INTRA' ? 'intra-state' : 'inter-state'})`;

/**
 * A group's supply type. Real portal JSON carries `sply_ty` on the group, but
 * a hand-built or older row may not — fall back to POS vs the client's home
 * state, the same derivation gstr1ManualBuild uses when assembling.
 */
const splyTyOf = (group: any, homeState: string): string => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const declared = String(group?.sply_ty || '').toUpperCase();
  if (declared === 'INTRA' || declared === 'INTER') return declared;
  const pos = String(group?.pos || '');
  return pos && homeState && pos === homeState ? 'INTRA' : 'INTER';
};

/** One rate line of an advance group, as a keyed amount. */
interface KeyedLine { key: string; amount: TaxAmount }

const readAdvanceGroups = (groups: any[], homeState: string): KeyedLine[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: KeyedLine[] = [];
  (groups || []).forEach((group: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const splyTy = splyTyOf(group, homeState);
    const pos = String(group?.pos || '');
    // One group can carry several rate lines; a flat itms-less shape also
    // occurs in older stored rows.
    const itms = Array.isArray(group?.itms) && group.itms.length ? group.itms : [group];
    itms.forEach((it: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const ratePct = num(it?.rt);
      out.push({
        key: keyOf({ pos, ratePct, splyTy }),
        amount: {
          taxable: num(it?.ad_amt),
          igst: num(it?.iamt),
          cgst: num(it?.camt),
          sgst: num(it?.samt),
          cess: num(it?.csamt),
        },
      });
    });
  });
  return out;
};

const sumByKey = (lines: KeyedLine[]): Map<string, TaxAmount> => {
  const m = new Map<string, TaxAmount>();
  lines.forEach(({ key, amount }) => m.set(key, addTax(m.get(key) || zeroTax(), amount)));
  return m;
};

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export interface AdvanceLedgerMonth {
  /** MM/YYYY */
  period: string;
  /** As reported in that month's own return. */
  filed: { received: TaxAmount; adjusted: TaxAmount };
  /** After substituting any amendment that restates this month. */
  effective: { received: TaxAmount; adjusted: TaxAmount };
  /** effective − filed. What has to reach GSTR-3B Adjustments. */
  differential: { received: TaxAmount; adjusted: TaxAmount };
  /** True when an ata/txpda somewhere restates this month. */
  amended: boolean;
  /** Period(s) whose return carried the amendment, MM/YYYY. */
  amendedIn: string[];
  opening: TaxAmount;
  closing: TaxAmount;
}

export interface AdvanceLedger {
  clientId: string;
  /** Chronological, one row per month that has any advance activity. */
  months: AdvanceLedgerMonth[];
  /** Closing open advance per key, at the end of `upto`. */
  closingByKey: Map<string, TaxAmount>;
  /** Sum of closingByKey. */
  closingTotal: TaxAmount;
  /** Oldest month still contributing an unadjusted balance (MM/YYYY), if any. */
  oldestOpenPeriod: string | null;
  /**
   * Per key, the month its still-open balance first arose in. The ageing
   * report needs this per key, not just the single oldest — one advance open
   * since April and another since last month are different findings.
   */
  openSinceByKey: Map<string, string>;
  /** Months with a GSTR-1 row, so callers can say how much history backs this. */
  monthsCovered: number;
  /** True if any amendment was applied anywhere in the range. */
  hasAmendments: boolean;
}

interface RawReturn {
  period: string; // MM/YYYY
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface OpeningBalanceRow {
  pos: string;
  rate_pct: number;
  sply_ty: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  as_on_period: string; // MM/YYYY
}

/**
 * Build the ledger from already-fetched returns — pure, so it can be tested
 * and so the checker can run against a draft that is not saved yet.
 *
 * `upto` is inclusive. Returns later than `upto` are ignored for the balance,
 * but their amendments are NOT: an amendment filed in a later period still
 * restates the earlier month it names, and the as-amended view is the true
 * position as known today (§3).
 */
export function buildAdvanceLedger(params: {
  clientId: string;
  homeState: string;
  returns: RawReturn[];
  openingBalances?: OpeningBalanceRow[];
  upto: string; // MM/YYYY
}): AdvanceLedger {
  const { clientId, homeState, returns, upto } = params;
  const uptoOrd = periodOrdinal(upto);

  // --- collect per-period filed figures ------------------------------------
  const filedReceived = new Map<string, Map<string, TaxAmount>>(); // period -> key -> amt
  const filedAdjusted = new Map<string, Map<string, TaxAmount>>();
  // Amendments, indexed by the period they RESTATE (omon), holding the latest
  // one by filing period — a key amended twice keeps only the last correction.
  const amendReceived = new Map<string, Map<string, { amount: TaxAmount; filedIn: string }>>();
  const amendAdjusted = new Map<string, Map<string, { amount: TaxAmount; filedIn: string }>>();

  const putAmendment = (
    store: Map<string, Map<string, { amount: TaxAmount; filedIn: string }>>,
    omon: string,
    filedIn: string,
    lines: KeyedLine[],
  ) => {
    if (!omon) return;
    const perKey = store.get(omon) || new Map<string, { amount: TaxAmount; filedIn: string }>();
    // Sum the lines of THIS amendment first, then let it replace any earlier
    // one wholesale — a later correction supersedes, it does not accumulate.
    const summed = sumByKey(lines);
    summed.forEach((amount, key) => {
      const existing = perKey.get(key);
      if (!existing || periodOrdinal(filedIn) >= periodOrdinal(existing.filedIn)) {
        perKey.set(key, { amount, filedIn });
      }
    });
    store.set(omon, perKey);
  };

  returns.forEach(({ period, json }) => {
    const j = json || {};
    if (periodOrdinal(period) <= uptoOrd) {
      filedReceived.set(period, sumByKey(readAdvanceGroups(j.at, homeState)));
      filedAdjusted.set(period, sumByKey(readAdvanceGroups(j.txpd, homeState)));
    }
    // Amendments are grouped by their own `omon`, which may differ per group.
    const byOmon = (groups: any[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const m = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
      (groups || []).forEach((g: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const omon = fpToMmYyyy(g?.omon);
        if (!omon) return;
        if (!m.has(omon)) m.set(omon, []);
        m.get(omon)!.push(g);
      });
      return m;
    };
    byOmon(j.ata).forEach((groups, omon) => putAmendment(amendReceived, omon, period, readAdvanceGroups(groups, homeState)));
    byOmon(j.txpda).forEach((groups, omon) => putAmendment(amendAdjusted, omon, period, readAdvanceGroups(groups, homeState)));
  });

  // --- opening balances ----------------------------------------------------
  // `openingSince` matters as much as the amount: an opening balance stands
  // for an advance received BEFORE the app's first imported return, so ageing
  // it from the first month we happen to have data for would understate it —
  // often by years, which is exactly the case the stale-advance rule is for.
  const openingByKey = new Map<string, TaxAmount>();
  const openingSince = new Map<string, string>();
  (params.openingBalances || []).forEach((r) => {
    if (periodOrdinal(r.as_on_period) > uptoOrd) return;
    const key = keyOf({ pos: r.pos, ratePct: num(r.rate_pct), splyTy: r.sply_ty });
    openingByKey.set(key, addTax(openingByKey.get(key) || zeroTax(), {
      taxable: num(r.taxable), igst: num(r.igst), cgst: num(r.cgst), sgst: num(r.sgst), cess: num(r.cess),
    }));
    const prior = openingSince.get(key);
    if (!prior || periodOrdinal(r.as_on_period) < periodOrdinal(prior)) {
      openingSince.set(key, r.as_on_period);
    }
  });

  // --- walk the months in order -------------------------------------------
  const periods = Array.from(new Set([
    ...filedReceived.keys(),
    ...filedAdjusted.keys(),
    ...amendReceived.keys(),
    ...amendAdjusted.keys(),
  ]))
    .filter((p) => periodOrdinal(p) <= uptoOrd)
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b));

  const runningByKey = new Map<string, TaxAmount>(openingByKey);
  // The month each key's still-open balance first arose in, for ageing. Seeded
  // from the opening balances so a pre-app advance ages from its real date.
  const openSince = new Map<string, string>();
  openingByKey.forEach((amt, key) => {
    if (!isTaxZero(amt)) openSince.set(key, openingSince.get(key) || upto);
  });
  const months: AdvanceLedgerMonth[] = [];
  let hasAmendments = false;

  const sumMap = (m: Map<string, TaxAmount> | undefined): TaxAmount =>
    Array.from((m || new Map()).values()).reduce((t, v) => addTax(t, v), zeroTax());

  periods.forEach((period) => {
    const opening = Array.from(runningByKey.values()).reduce((t, v) => addTax(t, v), zeroTax());

    const filedR = filedReceived.get(period) || new Map<string, TaxAmount>();
    const filedA = filedAdjusted.get(period) || new Map<string, TaxAmount>();
    const amdR = amendReceived.get(period);
    const amdA = amendAdjusted.get(period);
    if (amdR?.size || amdA?.size) hasAmendments = true;

    // Effective = amendment where one exists for that key, else as filed.
    // Note the key set is the UNION: an amendment can introduce a key the
    // original return never had (a rate that was reported wrongly and is being
    // corrected to a different one).
    const effectiveOf = (
      filed: Map<string, TaxAmount>,
      amended: Map<string, { amount: TaxAmount; filedIn: string }> | undefined,
    ): Map<string, TaxAmount> => {
      const out = new Map<string, TaxAmount>(filed);
      (amended || new Map()).forEach((v, key) => out.set(key, v.amount));
      return out;
    };

    const effR = effectiveOf(filedR, amdR);
    const effA = effectiveOf(filedA, amdA);

    effR.forEach((amount, key) => {
      const next = addTax(runningByKey.get(key) || zeroTax(), amount);
      runningByKey.set(key, next);
      if (!openSince.has(key) && !isTaxZero(next)) openSince.set(key, period);
    });
    effA.forEach((amount, key) => {
      const next = subTax(runningByKey.get(key) || zeroTax(), amount);
      runningByKey.set(key, next);
      if (isTaxZero(next)) openSince.delete(key);
    });

    const closing = Array.from(runningByKey.values()).reduce((t, v) => addTax(t, v), zeroTax());
    const amendedIn = Array.from(new Set([
      ...Array.from((amdR || new Map()).values()).map((v) => v.filedIn),
      ...Array.from((amdA || new Map()).values()).map((v) => v.filedIn),
    ])).sort((a, b) => periodOrdinal(a) - periodOrdinal(b));

    const filedTotals = { received: sumMap(filedR), adjusted: sumMap(filedA) };
    const effTotals = { received: sumMap(effR), adjusted: sumMap(effA) };

    months.push({
      period,
      filed: filedTotals,
      effective: effTotals,
      differential: {
        received: subTax(effTotals.received, filedTotals.received),
        adjusted: subTax(effTotals.adjusted, filedTotals.adjusted),
      },
      amended: amendedIn.length > 0,
      amendedIn,
      opening,
      closing,
    });
  });

  // Drop keys that have netted to nothing so the closing map only carries real
  // open balances — a zero row is noise on every screen that reads this.
  const closingByKey = new Map<string, TaxAmount>();
  runningByKey.forEach((v, k) => { if (!isTaxZero(v)) closingByKey.set(k, v); });

  const closingTotal = Array.from(closingByKey.values()).reduce((t, v) => addTax(t, v), zeroTax());
  const oldestOpenPeriod = Array.from(openSince.entries())
    .filter(([key]) => closingByKey.has(key))
    .map(([, period]) => period)
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b))[0] || null;

  const openSinceByKey = new Map<string, string>();
  openSince.forEach((period, key) => { if (closingByKey.has(key)) openSinceByKey.set(key, period); });

  return {
    clientId,
    months,
    closingByKey,
    closingTotal,
    oldestOpenPeriod,
    openSinceByKey,
    monthsCovered: filedReceived.size,
    hasAmendments,
  };
}

/**
 * Fetch a client's returns and opening balances, then build the ledger.
 *
 * `draftOverride` lets a caller substitute the JSON for one period with a
 * draft that hasn't been saved yet — which is what the pre-filing check needs,
 * since it runs against what is about to be uploaded, not what is stored.
 */
export async function fetchAdvanceLedger(params: {
  clientId: string;
  gstin: string;
  upto: string; // MM/YYYY
  draftOverride?: { period: string; json: any } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
}): Promise<AdvanceLedger> {
  const { clientId, gstin, upto, draftOverride } = params;
  const homeState = (gstin || '').slice(0, 2);

  const [returnsRes, openingRes] = await Promise.all([
    supabase.from('gstr1_data').select('period_month, raw_json').eq('client_id', clientId),
    // Not in the generated Supabase types (added by the Phase 1 migration),
    // so the table name is cast the same way other post-generation tables are.
    supabase.from('advance_opening_balances' as never).select('*').eq('client_id', clientId),
  ]);
  if (returnsRes.error) throw returnsRes.error;
  // A missing opening-balance table (migration not yet applied) must not take
  // the whole check down — it degrades to "no opening balance", which is the
  // correct behaviour for every client that has none anyway.
  const openingBalances: OpeningBalanceRow[] = openingRes.error
    ? []
    : ((openingRes.data as any[]) || []).map((r) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        pos: String(r.pos || ''),
        rate_pct: num(r.rate_pct),
        sply_ty: String(r.sply_ty || ''),
        taxable: num(r.taxable),
        igst: num(r.igst),
        cgst: num(r.cgst),
        sgst: num(r.sgst),
        cess: num(r.cess),
        as_on_period: String(r.as_on_period || ''),
      }));

  const returns: RawReturn[] = ((returnsRes.data as { period_month: string; raw_json: unknown }[]) || [])
    .map((r) => ({ period: shortToMmYyyy(r.period_month), json: r.raw_json }))
    .filter((r) => r.period);

  if (draftOverride?.period) {
    const idx = returns.findIndex((r) => r.period === draftOverride.period);
    if (idx >= 0) returns[idx] = { period: draftOverride.period, json: draftOverride.json };
    else returns.push({ period: draftOverride.period, json: draftOverride.json });
  }

  return buildAdvanceLedger({ clientId, homeState, returns, openingBalances, upto });
}
