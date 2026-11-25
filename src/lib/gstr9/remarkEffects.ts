// What a remark on a difference line means for GSTR-9 (25 Nov 2026; §10 of
// docs/GSTR9_9C_WORKINGS.md).
//
// A reason written on a difference line is read, by the GST Assistant (the
// Edge Function gst-assistant, mode remark_effect) or, when AI is not
// available, by the rules below, into one effect: a Part V table of this FY
// (10, 11, 12, 13: given effect in next FY's returns), ITC of the previous FY
// availed this FY (6A1), a DRC-03, a timing difference or nothing. Nothing
// changes until a person presses Apply: then the amount is added to the
// table (or recorded as already in it), and Undo takes the same amount off.
// The next FY's working reads the applied next-FY effects of the previous FY
// (carriedEffects) for its Annexure-4, its 6A1 / Table 7 / Table 4 guidance
// and a ready reason for its own difference lines.

import type { DiffLine } from './engine';
import type { Gstr9ManualDoc, JustificationsDoc, RemarkEffect, RemarkEffectKind, TaxIn, ValTax } from './types';

export type { RemarkEffect, RemarkEffectKind } from './types';

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const zero = (): ValTax => ({ t: 0, i: 0, c: 0, s: 0, x: 0 });

/** Positive amounts, SGST = CGST (as everywhere in the workings), taxable value only where the table has one. */
export function cleanAmount(a: Partial<ValTax> | null | undefined, withTaxable: boolean): ValTax {
  const v = (k: keyof ValTax) => Math.max(0, r2(Math.abs(Number(a?.[k] ?? 0))));
  const c = v('c');
  return { t: withTaxable ? v('t') : 0, i: v('i'), c, s: c, x: v('x') };
}

export const isNilAmount = (a: ValTax) => Math.abs(a.t) < 0.005 && Math.abs(a.i) < 0.005 && Math.abs(a.c) < 0.005 && Math.abs(a.s) < 0.005 && Math.abs(a.x) < 0.005;

/** The GSTR-9 field an effect is added to, when it is applied. */
export type EffectTarget = 't10' | 't11' | 't12' | 't13';

export interface KindMeta {
  label: string;
  short: string;
  target: EffectTarget | null;
  /** Value + tax (Tables 10 / 11) or tax only. */
  withTaxable: boolean;
  /** This FY, in the form's words. */
  thisFy: string;
  /** Next FY's GSTR-9 (null: nothing carries). */
  nextFy: string | null;
  /** ITC or outward family: which next-FY lines it explains. */
  family: 'itc' | 'outward' | null;
}

export const KIND_META: Record<RemarkEffectKind, KindMeta> = {
  next_fy_t10: {
    label: 'Declared in next FY (Table 10)',
    short: 'Table 10',
    target: 't10',
    withTaxable: true,
    thisFy: 'Table 10: supplies / tax declared through invoices, debit notes and amendments in next FY (adds to total turnover)',
    nextFy: "Sits in next FY's GSTR-3B but is not a supply of next FY: keep it out of next FY's Table 4; Annexure-4 clause 10",
    family: 'outward',
  },
  next_fy_t11: {
    label: 'Reduced in next FY (Table 11)',
    short: 'Table 11',
    target: 't11',
    withTaxable: true,
    thisFy: 'Table 11: supplies / tax reduced through credit notes and amendments in next FY (reduces total turnover)',
    nextFy: "Reduced in next FY's returns for this FY: keep it out of next FY's Table 4 credit notes; Annexure-4 clause 11",
    family: 'outward',
  },
  next_fy_t12: {
    label: 'ITC reversed in next FY (Table 12)',
    short: 'Table 12',
    target: 't12',
    withTaxable: false,
    thisFy: 'Table 12: ITC of this FY reversed in next FY',
    nextFy: "Reversed in next FY's GSTR-3B for this FY: keep it out of next FY's Table 7; Annexure-4 clause 12",
    family: 'itc',
  },
  next_fy_t13: {
    label: 'ITC availed in next FY (Table 13)',
    short: 'Table 13',
    target: 't13',
    withTaxable: false,
    thisFy: 'Table 13 (and 8C, which follows it): ITC of this FY availed in next FY, up to the s.16(4) cut-off',
    nextFy: "Availed in next FY's GSTR-3B for this FY: next FY reports it in 6A1, not 6B; Annexure-4 clauses 8 and 13",
    family: 'itc',
  },
  prev_fy_itc: {
    label: 'ITC of the previous FY (6A1)',
    short: '6A1',
    target: null,
    withTaxable: false,
    thisFy: '6A1: ITC of a preceding FY availed this FY (it was in the previous FY’s Table 13); not 6B',
    nextFy: null,
    family: null,
  },
  pay_drc03: {
    label: 'Paid / to pay by DRC-03',
    short: 'DRC-03',
    target: null,
    withTaxable: false,
    thisFy: 'Payables & set-off: record the DRC-03 (or the GSTR-3B effect) against the payable',
    nextFy: null,
    family: null,
  },
  timing: {
    label: 'Timing difference in the year',
    short: 'Timing',
    target: null,
    withTaxable: false,
    thisFy: 'No table changes: the difference evens out within the year',
    nextFy: null,
    family: null,
  },
  no_effect: {
    label: 'No GSTR-9 effect',
    short: 'None',
    target: null,
    withTaxable: false,
    thisFy: 'No table changes: the remark explains the difference',
    nextFy: null,
    family: null,
  },
};

export const EFFECT_KINDS = Object.keys(KIND_META) as RemarkEffectKind[];
export const isNextFyKind = (k: RemarkEffectKind) => k.startsWith('next_fy_');

// ---------------------------------------------------------------------------
// Which lines are about ITC, which about outward supplies
// ---------------------------------------------------------------------------

const ITC_KEYS = /^(purchases\.|itc\.|dti\.|ann2\.|ann4\.c13|g9\.8[CD]|gstr9c\.(12F|14T))/;
const OUT_KEYS = /^(sales\.|dto\.|out\.|rcm\.|ann1\.|gstr9c\.(5R|7G|9R))/;
export const lineFamily = (key: string): 'itc' | 'outward' | null => (ITC_KEYS.test(key) ? 'itc' : OUT_KEYS.test(key) ? 'outward' : null);

// ---------------------------------------------------------------------------
// The rules: a reading of the remark without AI
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Where a date the remark names falls against the FY: 'next', 'prev', 'this' or null. */
function periodsNamed(text: string, fy: string): Set<'next' | 'prev' | 'this'> {
  const out = new Set<'next' | 'prev' | 'this'>();
  const start = Number(fy.slice(0, 4));
  if (!Number.isFinite(start)) return out;
  // A month as an index from April of the FY's start year (0 … 11 inside the FY).
  const place = (month: number, year: number) => {
    const y = year < 100 ? 2000 + year : year;
    const idx = (y - start) * 12 + (month - 4);
    out.add(idx < 0 ? 'prev' : idx > 11 ? 'next' : 'this');
  };
  const t = text.toLowerCase();
  if (/\b(next|following|subsequent|succeeding)\s+(f\.?\s?y\.?|financial\s+year|year)\b/.test(t)) out.add('next');
  if (/\b(previous|last|preceding|earlier|prior)\s+(f\.?\s?y\.?|financial\s+year|year)\b/.test(t)) out.add('prev');
  for (const m of t.matchAll(/\bf\.?\s?y\.?\s*'?(\d{2,4})\s*[-–/]\s*(\d{2,4})\b/g)) {
    const y = Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1]);
    out.add(y > start ? 'next' : y < start ? 'prev' : 'this');
  }
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\s'’,-]*(\d{4}|\d{2})\b/g)) {
    place(MONTHS.indexOf(m[1].slice(0, 3)) + 1, Number(m[2]));
  }
  for (const m of t.matchAll(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(20\d{2})\b/g)) place(Number(m[1]), Number(m[2]));
  return out;
}

/** Amounts the remark names (₹ / Rs / INR, Indian or plain grouping). */
function amountsNamed(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)?/gi)) {
    let n = Number(m[1].replace(/,/g, ''));
    const unit = (m[2] ?? '').toLowerCase();
    if (unit.startsWith('la')) n *= 1e5;
    else if (unit.startsWith('cr')) n *= 1e7;
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** The part of the line's difference an effect carries: the difference itself, or one amount the remark names spread over its heads. */
function amountFor(line: DiffLine, remark: string, withTaxable: boolean): { amount: ValTax; scaled: boolean } {
  const base = cleanAmount(
    { t: line.hasTaxable ? line.diff.t : 0, i: line.hasTax ? line.diff.i : 0, c: line.hasTax ? line.diff.c : 0, s: line.hasTax ? line.diff.s : 0, x: line.hasTax ? line.diff.x : 0 },
    withTaxable,
  );
  const named = amountsNamed(remark);
  if (named.length !== 1) return { amount: base, scaled: false };
  const n = named[0];
  const taxSum = base.i + base.c + base.s + base.x;
  // A named amount close to the taxable value is the taxable value; else it is the tax, spread in the line's proportion.
  if (withTaxable && base.t > 0 && Math.abs(n - base.t) <= Math.max(1, base.t * 0.02)) return { amount: base, scaled: false };
  if (taxSum <= 0 || Math.abs(n - taxSum) < 1) return { amount: base, scaled: false };
  const k = n / taxSum;
  return { amount: cleanAmount({ t: base.t, i: base.i * k, c: base.c * k, s: base.s * k, x: base.x * k }, withTaxable), scaled: true };
}

export interface EffectDraft {
  kind: RemarkEffectKind;
  amount: ValTax;
  summary: string;
  thisFy: string;
  nextFy: string | null;
  confidence: RemarkEffect['confidence'];
  question?: string;
}

/** The rules' reading of a remark: what a person would most likely mean. */
export function suggestFromRules(line: DiffLine, remark: string, fy: string): EffectDraft {
  const t = remark.toLowerCase();
  const when = periodsNamed(remark, fy);
  const fam = lineFamily(line.key);
  const draft = (kind: RemarkEffectKind, summary: string, confidence: EffectDraft['confidence'], question?: string): EffectDraft => {
    const meta = KIND_META[kind];
    const { amount, scaled } = meta.target ? amountFor(line, remark, meta.withTaxable) : { amount: zero(), scaled: false };
    return {
      kind, amount, summary: scaled ? `${summary} The amount named in the remark is spread over the heads as the difference is.` : summary,
      thisFy: meta.thisFy, nextFy: meta.nextFy, confidence: scaled ? 'low' : confidence, question,
    };
  };

  if (/\bdrc[\s-]*0?3\b/.test(t)) return draft('pay_drc03', 'The remark says the difference is paid (or to be paid) through DRC-03.', 'medium');

  const reversed = /\brevers(ed|al|e)\b/.test(t);
  const reduced = /\bcredit\s+notes?\b|\bc\/?n\b|\breduc(ed|tion|e)\b|\bamend\w*\s+(down|to\s+reduce)/.test(t);
  const itcWords = /\b(itc|credit|input\s+tax)\b/.test(t);
  const family = fam ?? (itcWords ? 'itc' : null);

  if (when.has('next')) {
    if (family === 'itc') {
      return reversed
        ? draft('next_fy_t12', "The remark says this FY's ITC was reversed in next FY's return.", 'medium')
        : draft('next_fy_t13', "The remark says this FY's ITC was availed in next FY's return.", 'medium');
    }
    if (family === 'outward') {
      return reduced
        ? draft('next_fy_t11', "The remark says this FY's supplies were reduced in next FY's returns (credit note or amendment).", 'medium')
        : draft('next_fy_t10', "The remark says this FY's supplies were declared in next FY's returns.", 'medium');
    }
    return draft('no_effect', 'The remark names next FY, but the line is neither ITC nor outward supplies.', 'low', 'Which table of this FY should carry it: 10, 11, 12 or 13?');
  }
  if (when.has('prev') && (family === 'itc' || itcWords)) {
    return draft('prev_fy_itc', "The remark says this is ITC of the previous FY availed in this FY's return.", 'medium');
  }
  if (/\btiming\b/.test(t) || (when.has('this') && !when.has('next') && !when.has('prev'))) {
    return draft('timing', 'The remark points to a month inside this FY: a timing difference that evens out in the year.', 'low');
  }
  return draft('no_effect', 'The remark explains the difference without naming a return of another FY.', 'low');
}

// ---------------------------------------------------------------------------
// Applying an effect to the GSTR-9 doc, and undoing it
// ---------------------------------------------------------------------------

const addTaxIn = (cur: TaxIn | null | undefined, base: { i: number; c: number; s: number; x: number }, d: ValTax, sign: 1 | -1): TaxIn => {
  const c0 = cur ?? { ...base, s: null };
  const i = r2(c0.i + sign * d.i);
  const c = r2(c0.c + sign * d.c);
  const s0 = c0.s === null ? c0.c : c0.s;
  const s = r2(s0 + sign * d.s);
  const x = r2(c0.x + sign * d.x);
  const { f: _f, ...rest } = c0 as TaxIn;
  void _f;
  return { ...rest, i, c, s: Math.abs(s - c) < 0.005 ? null : s, x };
};

/** Drops the typed expressions of the heads an effect writes (the stored figure is the source). */
function dropFormulas(doc: Gstr9ManualDoc, target: EffectTarget): Gstr9ManualDoc {
  if (!doc.f) return doc;
  const f = { ...doc.f };
  for (const k of Object.keys(f)) if (k === target || k.startsWith(`${target}.`)) delete f[k];
  return { ...doc, f };
}

/**
 * The GSTR-9 doc with the effect's amount added (sign 1) or taken off (−1).
 * `computedT12` is Table 12 as the engine computes it, for a Table 12 still on
 * its computed figure: applying fixes it as typed at computed + amount.
 */
export function writeEffect(doc: Gstr9ManualDoc, target: EffectTarget, amount: ValTax, sign: 1 | -1, computedT12: { i: number; c: number; s: number; x: number }): Gstr9ManualDoc {
  const d = dropFormulas(doc, target);
  if (target === 't10' || target === 't11') {
    const cur = d[target];
    const c = r2(cur.c + sign * amount.c);
    return { ...d, [target]: { t: r2(cur.t + sign * amount.t), i: r2(cur.i + sign * amount.i), c, s: c, x: r2(cur.x + sign * amount.x) } };
  }
  if (target === 't12') return { ...d, t12: addTaxIn(d.t12, computedT12, amount, sign) };
  return { ...d, t13: addTaxIn(d.t13, { i: 0, c: 0, s: 0, x: 0 }, amount, sign) };
}

/** A new suggestion from a draft. */
export function toEffect(draft: EffectDraft, source: RemarkEffect['source'], remark: string): RemarkEffect {
  const meta = KIND_META[draft.kind];
  return {
    kind: draft.kind,
    amount: meta.target ? cleanAmount(draft.amount, meta.withTaxable) : zero(),
    summary: draft.summary.trim().slice(0, 600),
    thisFy: (draft.thisFy || meta.thisFy).slice(0, 300),
    nextFy: meta.nextFy === null ? null : (draft.nextFy || meta.nextFy).slice(0, 300),
    source,
    confidence: draft.confidence,
    ...(draft.question ? { question: draft.question.slice(0, 300) } : {}),
    remark,
    suggestedAt: new Date().toISOString(),
    status: 'suggested',
  };
}

/** The remark has changed since the effect was read. */
export const effectOutOfDate = (text: string | undefined, e: RemarkEffect | undefined) => !!e && (text ?? '').trim() !== e.remark.trim();

// ---------------------------------------------------------------------------
// Next FY: the effects the previous FY gave effect to in this FY's returns
// ---------------------------------------------------------------------------

export interface CarriedEffect {
  lineKey: string;
  lineLabel: string;
  remark: string;
  kind: RemarkEffectKind;
  amount: ValTax;
  /** What this FY does with it (KIND_META.nextFy). */
  effect: string;
  family: 'itc' | 'outward' | null;
}

/** The previous FY's applied next-FY effects, for the FY after it. */
export function carriedEffects(prevJustifications: JustificationsDoc | null | undefined, prevLines: Array<Pick<DiffLine, 'key' | 'label'>>): CarriedEffect[] {
  const out: CarriedEffect[] = [];
  const labels = new Map(prevLines.map((l) => [l.key, l.label]));
  for (const [key, j] of Object.entries(prevJustifications?.lines ?? {})) {
    const e = j?.effect;
    if (!e || e.status !== 'applied' || !isNextFyKind(e.kind)) continue;
    const meta = KIND_META[e.kind];
    out.push({
      lineKey: key, lineLabel: labels.get(key) ?? key, remark: (j.text ?? '').trim(), kind: e.kind,
      amount: cleanAmount(e.amount, meta.withTaxable), effect: e.nextFy || meta.nextFy || '', family: meta.family,
    });
  }
  return out.sort((a, b) => EFFECT_KINDS.indexOf(a.kind) - EFFECT_KINDS.indexOf(b.kind) || a.lineLabel.localeCompare(b.lineLabel));
}

/** Σ amount per kind. */
export function totalsByKind(xs: Array<{ kind: RemarkEffectKind; amount: ValTax }>): Partial<Record<RemarkEffectKind, ValTax>> {
  const out: Partial<Record<RemarkEffectKind, ValTax>> = {};
  for (const x of xs) {
    const t = out[x.kind] ?? zero();
    out[x.kind] = { t: r2(t.t + x.amount.t), i: r2(t.i + x.amount.i), c: r2(t.c + x.amount.c), s: r2(t.s + x.amount.s), x: r2(t.x + x.amount.x) };
  }
  return out;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const amountText = (a: ValTax, withTaxable: boolean) => {
  const parts: string[] = [];
  if (withTaxable && a.t) parts.push(`value ${inr(a.t)}`);
  if (a.i) parts.push(`IGST ${inr(a.i)}`);
  if (a.c) parts.push(`CGST ${inr(a.c)}`);
  if (a.s) parts.push(`SGST ${inr(a.s)}`);
  if (a.x) parts.push(`cess ${inr(a.x)}`);
  return parts.length ? parts.join(', ') : 'nil';
};

/** The carried effects a next-FY line can rest on (same family: ITC or outward). */
export const carriedFor = (lineKey: string, carried: CarriedEffect[]) => {
  const fam = lineFamily(lineKey);
  return fam ? carried.filter((c) => c.family === fam) : [];
};

/** A ready reason for a next-FY line, from the previous FY's carried effects. */
export function carriedReason(items: CarriedEffect[], prevFy: string): string {
  const lines = items.map((c) => {
    const m = KIND_META[c.kind];
    const amt = amountText(c.amount, m.withTaxable);
    const what =
      c.kind === 'next_fy_t13' ? `ITC of FY ${prevFy} availed in this year's GSTR-3B (${amt}), reported in FY ${prevFy} GSTR-9 Table 13; shown in 6A1 of this year, not 6B`
        : c.kind === 'next_fy_t12' ? `ITC of FY ${prevFy} reversed in this year's GSTR-3B (${amt}), reported in FY ${prevFy} GSTR-9 Table 12; kept out of Table 7 of this year`
          : c.kind === 'next_fy_t10' ? `supplies of FY ${prevFy} declared in this year's returns (${amt}), reported in FY ${prevFy} GSTR-9 Table 10; kept out of Table 4 of this year`
            : `supplies of FY ${prevFy} reduced in this year's returns (${amt}), reported in FY ${prevFy} GSTR-9 Table 11; kept out of Table 4 of this year`;
    return `Includes ${what}${c.remark ? ` (FY ${prevFy} remark on "${c.lineLabel}": ${c.remark.length > 160 ? `${c.remark.slice(0, 160)}…` : c.remark})` : ''}.`;
  });
  return lines.join('\n');
}
