// The reconciliation engine: identity keys, an N-way matcher, the figure
// comparison and the pair reconciler that gives every row its reason from an
// ordered rule list. Generic over sources: 2A vs 2B today; 2A vs 8A, 8A vs 2B
// and the three-way report reuse matchSources / reconcile with their own rules.
// Positions (identity, tolerance, date pass): docs/GSTR2A_2B_RECO_POSITIONS.md.
import { daysBetween, fyOfDate } from '@/lib/reply/periods';
import { docSign } from './sources';
import type {
  DocGroup, FigureDiff, PairConfig, ReasonCode, RecoDoc, RecoNote, RecoResult, RecoRow, RecoStatus, RowDraft,
  SourceKey, SourceSet, SummaryLine,
} from './types';
import { STATUS_ORDER } from './types';

const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Document number with formatting ignored: upper case, separators dropped, and
 * leading zeros dropped from every run of digits ("inv/0012" = "INV12",
 * "2026/0012" = "2026-12"). Two runs of digits keep a boundary between them
 * ("1/23" is not "12/3"). Stricter than a fuzzy match: no edit distance.
 */
export function normDocNo(n: string | null | undefined): string {
  const tokens = String(n ?? '').toUpperCase().match(/[A-Z]+|\d+/g) ?? [];
  const isNum = (t: string) => /^\d/.test(t);
  return tokens
    .map((t, i) => {
      const v = isNum(t) ? t.replace(/^0+(?=\d)/, '') : t;
      return i > 0 && isNum(t) && isNum(tokens[i - 1]) ? `-${v}` : v;
    })
    .join('');
}

const fyOf = (date: string | null): string => (date ? fyOfDate(date) : '');

/** Pass 1: supplier GSTIN + family + number as sent + financial year of the document date. */
export const exactKey = (d: RecoDoc): string => `${d.ctin}|${d.family}|${d.number.trim().toUpperCase()}|${fyOf(d.date)}`;
/** Pass 2: the same with the number normalised. */
export const normKey = (d: RecoDoc): string => `${d.ctin}|${d.family}|${normDocNo(d.number)}|${fyOf(d.date)}`;
/** Pass 3: the normalised number without the year (same number, different date). */
export const looseKey = (d: RecoDoc): string => `${d.ctin}|${d.family}|${normDocNo(d.number)}`;
/** An amendment's original document, keyed like pass 2 (pass 3 when its date is not given). */
const originalKey = (d: RecoDoc): string | null => {
  if (!d.original?.number) return null;
  const base = `${d.ctin}|${d.family}|${normDocNo(d.original.number)}`;
  return d.original.date ? `${base}|${fyOfDate(d.original.date)}` : base;
};

/** Pass 3 pairs only documents dated within this many days of each other (a typo, not a reused number). */
export const DATE_PASS_MAX_DAYS = 92;

// ── Matching ────────────────────────────────────────────────────────────────

const dateGap = (a: RecoDoc, b: RecoDoc): number => (a.date && b.date ? Math.abs(daysBetween(a.date, b.date)) : 0);

/**
 * Both documents reported for the same supplier period, when both say. A
 * document a supplier reported for June is never the one it reported for July,
 * whatever its number looks like once normalised.
 */
const samePeriod = (a: RecoDoc, b: RecoDoc): boolean => !a.supplierPeriod || !b.supplierPeriod || a.supplierPeriod === b.supplierPeriod;

/**
 * Pairs two lists under one key, greedily: documents of the same date first,
 * then the nearest taxable value. Whatever cannot be paired stays alone.
 */
function pairUp<T>(as: T[], bs: RecoDoc[], docOf: (a: T) => RecoDoc, ok: (a: RecoDoc, b: RecoDoc) => boolean = () => true): [T, RecoDoc][] {
  const cand: { i: number; j: number; same: boolean; gap: number }[] = [];
  as.forEach((a, i) => bs.forEach((b, j) => {
    const d = docOf(a);
    if (!ok(d, b)) return;
    cand.push({ i, j, same: !!d.date && d.date === b.date, gap: Math.abs(d.taxable - b.taxable) });
  }));
  cand.sort((x, y) => Number(y.same) - Number(x.same) || x.gap - y.gap || x.i - y.i || x.j - y.j);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: [T, RecoDoc][] = [];
  for (const c of cand) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    out.push([as[c.i], bs[c.j]]);
  }
  return out;
}

const groupKey = (d: RecoDoc) => looseKey(d);
const push = <T>(m: Map<string, T[]>, k: string | null, v: T) => { if (k) m.set(k, [...(m.get(k) ?? []), v]); };

/**
 * Groups the documents of any number of sources: each group holds at most one
 * document per source. Passes, each over what is still unpaired:
 *  1. exact identity; 2. normalised number; 3. same number, different date
 *     (only when each side has exactly one such document, dated within
 *     DATE_PASS_MAX_DAYS); 4. an amendment against its original document.
 * Passes 2 and 3 pair only documents reported for the same supplier period
 * (an amendment is reported in a later period than its original, so pass 4
 * does not ask). A source's solo documents get a group of their own.
 * Never on the supplier's name.
 */
export function matchSources(sets: SourceSet[]): DocGroup[] {
  if (!sets.length) return [];
  const groups: DocGroup[] = [];
  const order = sets.map((s) => s.key);
  const repOf = (g: DocGroup): RecoDoc => {
    for (const k of order) { const d = g.docs[k]; if (d) return d; }
    throw new Error('empty group');
  };
  const add = (g: DocGroup, key: SourceKey, d: RecoDoc, viaAmendment: boolean) => {
    const rep = repOf(g);
    g.docs[key] = d;
    if (rep.date && d.date && rep.date !== d.date) g.dateDiffers = true;
    if (viaAmendment) g.viaAmendment = true;
  };
  const soloGroup = (key: SourceKey, d: RecoDoc): DocGroup => ({ key: groupKey(d), docs: { [key]: d }, dateDiffers: false, viaAmendment: false, solo: true });
  for (const d of sets[0].docs) {
    groups.push(sets[0].solo?.(d) ? soloGroup(sets[0].key, d) : { key: groupKey(d), docs: { [sets[0].key]: d }, dateDiffers: false, viaAmendment: false });
  }

  for (const set of sets.slice(1)) {
    let pending = set.docs.filter((d) => !set.solo?.(d));
    for (const d of set.docs) if (set.solo?.(d)) groups.push(soloGroup(set.key, d));
    const open = () => groups.filter((g) => !g.solo && !g.docs[set.key]);
    const runPass = (keyOf: (d: RecoDoc) => string, oneToOne = false, ok?: (a: RecoDoc, b: RecoDoc) => boolean) => {
      const byKey = new Map<string, DocGroup[]>();
      for (const g of open()) push(byKey, keyOf(repOf(g)), g);
      const docsByKey = new Map<string, RecoDoc[]>();
      for (const d of pending) push(docsByKey, keyOf(d), d);
      const used = new Set<RecoDoc>();
      for (const [k, ds] of docsByKey) {
        const gs = byKey.get(k);
        if (!gs) continue;
        if (oneToOne && (gs.length !== 1 || ds.length !== 1 || dateGap(repOf(gs[0]), ds[0]) > DATE_PASS_MAX_DAYS)) continue;
        for (const [g, d] of pairUp(gs, ds, repOf, ok)) { add(g, set.key, d, false); used.add(d); }
      }
      pending = pending.filter((d) => !used.has(d));
    };
    runPass(exactKey);
    runPass(normKey, false, samePeriod);
    runPass(looseKey, true, samePeriod);
    // 4. An amendment against its original document, either way round.
    {
      const byNorm = new Map<string, DocGroup[]>();
      const byLoose = new Map<string, DocGroup[]>();
      const byOrig = new Map<string, DocGroup[]>();
      for (const g of open()) {
        const rep = repOf(g);
        push(byOrig, originalKey(rep), g);
        if (!rep.isAmendment) { push(byNorm, normKey(rep), g); push(byLoose, looseKey(rep), g); }
      }
      const used = new Set<RecoDoc>();
      const taken = new Set<DocGroup>();
      for (const d of pending) {
        let cands: DocGroup[] | undefined;
        const ok = originalKey(d);
        if (d.isAmendment && ok) cands = d.original?.date ? byNorm.get(ok) : byLoose.get(ok);
        else if (!d.isAmendment) cands = byOrig.get(normKey(d)) ?? byOrig.get(looseKey(d));
        const g = cands?.find((x) => !taken.has(x));
        if (g) { add(g, set.key, d, true); used.add(d); taken.add(g); }
      }
      pending = pending.filter((d) => !used.has(d));
    }
    for (const d of pending) groups.push({ key: groupKey(d), docs: { [set.key]: d }, dateDiffers: false, viaAmendment: false });
  }
  return groups;
}

// ── Lookups into neighbouring statements ────────────────────────────────────

export interface DocIndex {
  exact: Map<string, RecoDoc[]>;
  norm: Map<string, RecoDoc[]>;
  /** Amendments by the identity of the document they amend. */
  byOriginal: Map<string, RecoDoc[]>;
  ctins: Set<string>;
}

export function indexDocs(docs: RecoDoc[]): DocIndex {
  const ix: DocIndex = { exact: new Map(), norm: new Map(), byOriginal: new Map(), ctins: new Set() };
  for (const d of docs) {
    push(ix.exact, exactKey(d), d);
    push(ix.norm, normKey(d), d);
    if (d.isAmendment) push(ix.byOriginal, originalKey(d), d);
    if (d.ctin) ix.ctins.add(d.ctin);
  }
  return ix;
}

/** The same document in another statement (passes 1 and 2), or null; `where` narrows the hits (e.g. by bucket). */
export const lookupDoc = (ix: DocIndex, d: RecoDoc, where: (x: RecoDoc) => boolean = () => true): RecoDoc | null =>
  ix.exact.get(exactKey(d))?.find(where) ?? ix.norm.get(normKey(d))?.find(where) ?? null;

/** An amendment in another statement whose original is this document, or null. */
export const lookupAmendmentOf = (ix: DocIndex, d: RecoDoc): RecoDoc | null =>
  ix.byOriginal.get(normKey(d))?.[0] ?? ix.byOriginal.get(looseKey(d))?.[0] ?? null;

// ── Figures ─────────────────────────────────────────────────────────────────

const signed = (d: RecoDoc | undefined) => {
  if (!d) return { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const s = docSign(d);
  return { taxable: s * d.taxable, igst: s * d.igst, cgst: s * d.cgst, sgst: s * d.sgst, cess: s * d.cess };
};

export const ZERO_DIFF: FigureDiff = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0, same: true };

/** Right minus left, signed; `same` when the taxable value and every head are within the tolerance. */
export function compareFigures(left: RecoDoc | undefined, right: RecoDoc | undefined, tolerance: number): FigureDiff {
  const a = signed(left);
  const b = signed(right);
  const d = {
    taxable: r2(b.taxable - a.taxable), igst: r2(b.igst - a.igst), cgst: r2(b.cgst - a.cgst),
    sgst: r2(b.sgst - a.sgst), cess: r2(b.cess - a.cess),
  };
  const tax = r2(d.igst + d.cgst + d.sgst + d.cess);
  const within = (x: number) => Math.abs(x) <= tolerance + 1e-9;
  return { ...d, tax, same: !!left && !!right && within(d.taxable) && within(d.igst) && within(d.cgst) && within(d.sgst) && within(d.cess) };
}

export const signedTaxable = (d: RecoDoc | undefined): number => (d ? docSign(d) * d.taxable : 0);
export const signedTax = (d: RecoDoc | undefined): number => (d ? docSign(d) * (d.igst + d.cgst + d.sgst + d.cess) : 0);

// ── The pair reconciler ─────────────────────────────────────────────────────

const statusRank = (s: RecoStatus) => STATUS_ORDER.indexOf(s);

/**
 * Reconciles two sources: match, compare, then the first rule (in order) that
 * claims a row gives its reason; notes add flags without changing the status.
 * A document whose section the other source does not read is "not compared":
 * listed, kept out of the difference.
 */
export function reconcile<C>(left: SourceSet, right: SourceSet, cfg: PairConfig<C>, ctx: C): RecoResult {
  const groups = matchSources([left, right]);
  const rows: RecoRow[] = groups.map((g) => {
    const l = g.docs[left.key];
    const r = g.docs[right.key];
    let status: RecoStatus;
    const diff = compareFigures(l, r, cfg.tolerance);
    if (l && r) status = diff.same ? 'matched' : 'differs';
    else if (l) status = right.covers(l) ? 'only_left' : 'not_compared';
    else status = left.covers(r as RecoDoc) ? 'only_right' : 'not_compared';
    const draft: RowDraft = {
      status, left: l, right: r, diff: status === 'not_compared' ? ZERO_DIFF : diff,
      dateDiffers: g.dateDiffers, viaAmendment: g.viaAmendment,
    };
    let reason: ReasonCode = cfg.fallback[status];
    let hit: ReturnType<PairConfig<C>['rules'][number]['test']> = null;
    for (const rule of cfg.rules) {
      if (!rule.when.includes(status)) continue;
      const h = rule.test(draft, ctx);
      if (h) { hit = h; reason = rule.code; break; }
    }
    const finalStatus = hit?.status ?? status;
    const notes: RecoNote[] = [];
    for (const n of cfg.notes) {
      const text = n.test(draft, ctx);
      if (text) notes.push({ code: n.code, text });
    }
    return {
      status: finalStatus,
      reason,
      detail: hit?.detail ?? '',
      action: hit?.action ?? '',
      confirmed: hit ? hit.confirmed : null,
      evidence: hit?.evidence ?? '',
      refPeriod: hit?.refPeriod ?? null,
      notes,
      left: l,
      right: r,
      diff: draft.diff,
      dateDiffers: g.dateDiffers,
      viaAmendment: g.viaAmendment,
    };
  });

  rows.sort((a, b) =>
    statusRank(a.status) - statusRank(b.status)
    || Math.abs(b.diff.tax) - Math.abs(a.diff.tax)
    || ((a.left ?? a.right)?.ctin ?? '').localeCompare((b.left ?? b.right)?.ctin ?? '')
    || ((a.left ?? a.right)?.number ?? '').localeCompare((b.left ?? b.right)?.number ?? ''));

  return {
    left: { key: left.key, label: left.label },
    right: { key: right.key, label: right.label },
    rows,
    summary: summarise(rows),
    notes: cfg.explain ? cfg.explain(rows, ctx) : [],
  };
}

/** Lines by (status, reason): status order, then the largest difference. */
export function summarise(rows: RecoRow[]): SummaryLine[] {
  const by = new Map<string, SummaryLine>();
  for (const row of rows) {
    const k = `${row.status}|${row.reason}`;
    const line = by.get(k) ?? { status: row.status, reason: row.reason, count: 0, leftTaxable: 0, rightTaxable: 0, leftTax: 0, rightTax: 0, diff: 0 };
    line.count += 1;
    line.leftTaxable = r2(line.leftTaxable + signedTaxable(row.left));
    line.rightTaxable = r2(line.rightTaxable + signedTaxable(row.right));
    line.leftTax = r2(line.leftTax + signedTax(row.left));
    line.rightTax = r2(line.rightTax + signedTax(row.right));
    line.diff = r2(line.diff + row.diff.tax);
    by.set(k, line);
  }
  return [...by.values()].sort((a, b) => statusRank(a.status) - statusRank(b.status) || Math.abs(b.diff) - Math.abs(a.diff) || b.count - a.count);
}
