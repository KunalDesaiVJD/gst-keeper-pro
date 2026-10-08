// Ported from agent/src/read/checks.ts for the notice-ai Edge Function (Deno);
// keep the two in step. The Edge copy also asks for each issue's paragraph
// text (issues[].text), which the assistant learns from.
// Checking a reading against the notice's own text. Pure functions, no I/O:
// every field the Claude API returns comes with a page and a short verbatim
// quote, and a field counts only when that quote is found in the PDF's text
// layer (on its page, else anywhere) and the value is consistent with it. A
// scan has no text layer, so nothing in it can be checked. Amounts are also
// checked against each other (the issues against the notice's demand, by tax).

import { COMPONENTS, HEADS, type HeadsOut } from './schema.ts';

// ── Normalising text ───────────────────────────────────────────────────────
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const SINGLE_QUOTES = /[\u2018-\u201B\u2032\u00B4]/g;
const DOUBLE_QUOTES = /[\u201C-\u201F\u2033\u00AB\u00BB]/g;
const SPACES = /[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g;

// Case, Unicode forms (ligatures, full-width), dashes, quotes, runs of white
// space, and the commas inside figures (1,23,456 and 123,456 both read 123456).
export function normText(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(SPACES, ' ')
    .replace(/(\d),(?=\d)/g, '$1')
    .trim();
}

// Letters, marks and digits only: what is compared when looking for a quote,
// so spacing, line breaks, hyphenation and punctuation never decide a match.
export function squash(s: string): string {
  return normText(s).replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

export function words(s: string): string[] {
  return normText(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

// ── Figures ────────────────────────────────────────────────────────────────
// Every figure in a text, in rupees: "1,23,456.00", "123456", "Rs.1,23,456/-",
// "1.5 lakh", "2 crore".
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of normText(text).matchAll(/(\d+(?:\.\d+)?)(\s*(?:lakhs?|lacs?|crores?|cr)(?![a-z]))?/g)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    out.push(n);
    if (m[2]) out.push(n * (/^\s*(?:lakh|lac)/.test(m[2]) ? 1e5 : 1e7));
  }
  return out;
}

// The amount is printed in the text (to the rupee: paise may be rounded).
export function amountInText(value: number, text: string): boolean {
  if (!Number.isFinite(value)) return false;
  return amountsIn(text).some((n) => Math.abs(n - value) < 1);
}

// ── Dates ──────────────────────────────────────────────────────────────────
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthWord = (m: number) => {
  const full = MONTHS[m - 1];
  return m === 9 ? '(?:september|sept|sep)' : `(?:${full}|${full.slice(0, 3)})`;
};
const pad2 = (n: number) => String(n).padStart(2, '0');

export interface Ymd { y: number; m: number; d: number }

// A real calendar date in YYYY-MM-DD, else null.
export function parseIso(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return { y, m: mo, d };
}
export const isoOf = (x: Ymd) => `${x.y}-${pad2(x.m)}-${pad2(x.d)}`;

// The date is written in the text as dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (also
// with a two-digit year), yyyy-mm-dd, "5 October 2026", "05-Oct-2026",
// "5th of October, 2026" or "October 5, 2026".
export function dateInText(iso: string, text: string): boolean {
  const x = parseIso(iso);
  if (!x) return false;
  const t = normText(text);
  const D = `0?${x.d}`, M = `0?${x.m}`, Y = `(?:${x.y}|${String(x.y).slice(2)})`;
  const sep = `\\s*[/\\-.]\\s*`;
  const ord = '(?:st|nd|rd|th)?';
  const gap = "[\\s\\-/.,']*";
  const mon = monthWord(x.m);
  return [
    `(?<!\\d)${D}${sep}${M}${sep}${Y}(?!\\d)`,
    `(?<!\\d)${x.y}${sep}${pad2(x.m)}${sep}${pad2(x.d)}(?!\\d)`,
    `(?<!\\d)${D}${ord}${gap}(?:of\\s+)?${mon}\\.?${gap}${x.y}(?!\\d)`,
    `(?<![a-z])${mon}\\.?${gap}${D}${ord}${gap}${x.y}(?!\\d)`,
  ].some((p) => new RegExp(p).test(t));
}

// The month is written in the text: "April 2019", "Apr-19", "04/2019",
// "042019" (the portal's MMYYYY), "2019-04".
export function monthInText(y: number, m: number, text: string): boolean {
  const t = normText(text);
  const Y = `(?:${y}|${String(y).slice(2)})`;
  return [
    `(?<![a-z])${monthWord(m)}\\.?[\\s\\-/.,']*${Y}(?!\\d)`,
    `(?<!\\d)0?${m}\\s*[/\\-.]\\s*${y}(?!\\d)`,
    `(?<!\\d)${pad2(m)}${y}(?!\\d)`,
    `(?<!\\d)${y}\\s*[/\\-.]\\s*${pad2(m)}(?!\\d)`,
  ].some((p) => new RegExp(p).test(t));
}

// The financial year starting in April of `y`: "2019-20", "2019-2020",
// "2019/20", "FY 19-20".
export function fyInText(y: number, text: string): boolean {
  const t = normText(text);
  const b = y + 1;
  return [
    `(?<!\\d)${y}\\s*[-/]\\s*(?:${b}|${String(b).slice(2)})(?!\\d)`,
    `(?:f\\.?\\s?y\\.?|financial year)\\s*:?\\s*${String(y).slice(2)}\\s*[-/]\\s*${String(b).slice(2)}(?!\\d)`,
  ].some((p) => new RegExp(p).test(t));
}

// A period's first or last day is consistent with the text when the date, its
// month, or (for 1 April / 31 March) its financial year is written there.
export function periodInText(iso: string, text: string, edge: 'from' | 'to'): boolean {
  const x = parseIso(iso);
  if (!x) return false;
  if (dateInText(iso, text) || monthInText(x.y, x.m, text)) return true;
  if (edge === 'from' && x.m === 4) return fyInText(x.y, text);
  if (edge === 'to' && x.m === 3) return fyInText(x.y - 1, text);
  return false;
}

// ── The document's text, prepared once ────────────────────────────────────
export interface QuoteHit {
  found: boolean;
  page: number | null;
  how: 'exact' | 'words' | null;
}

export class DocText {
  private squashed: string[];
  private wordList: string[][];
  private figures: number[][];

  constructor(readonly pages: string[], readonly textLayer: boolean) {
    this.squashed = pages.map(squash);
    this.wordList = pages.map(words);
    this.figures = pages.map(amountsIn);
  }

  // Pages to look at: the stated page first, then the rest in order.
  private order(page: number): number[] {
    const all = this.pages.map((_, i) => i + 1);
    return page >= 1 && page <= all.length ? [page, ...all.filter((p) => p !== page)] : all;
  }

  // The quote, compared on letters and digits only; failing that (text the PDF
  // lays out in another order, e.g. table cells), its words in order with a
  // few of the page's words in between (at most one in five).
  findQuote(quote: string, page: number): QuoteHit {
    const q = squash(quote);
    if (!q) return { found: false, page: null, how: null };
    const order = this.order(page);
    for (const p of order) if (this.squashed[p - 1].includes(q)) return { found: true, page: p, how: 'exact' };
    const qw = words(quote);
    if (qw.length >= 3) {
      for (const p of order) if (wordsInOrder(qw, this.wordList[p - 1])) return { found: true, page: p, how: 'words' };
    }
    return { found: false, page: null, how: null };
  }

  pageText(page: number): string {
    return this.pages[page - 1] ?? '';
  }

  hasAmount(value: number, page?: number | null): boolean {
    const lists = page ? [this.figures[page - 1] ?? []] : this.figures;
    return lists.some((l) => l.some((n) => Math.abs(n - value) < 1));
  }
}

export function wordsInOrder(q: string[], p: string[]): boolean {
  if (!q.length) return false;
  const maxSkip = Math.max(1, Math.floor(q.length / 5));
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== q[0]) continue;
    let j = 1, k = i + 1, skips = 0;
    while (j < q.length && k < p.length && skips <= maxSkip) {
      if (p[k] === q[j]) j++;
      else skips++;
      k++;
    }
    if (j === q.length && skips <= maxSkip) return true;
  }
  return false;
}

// ── One field ──────────────────────────────────────────────────────────────
export type ValueKind = 'text' | 'date' | 'period_from' | 'period_to' | 'amount';

export function valueInText(kind: ValueKind, value: string | number, text: string): boolean {
  switch (kind) {
    case 'amount': return amountInText(Number(value), text);
    case 'date': return dateInText(String(value), text);
    case 'period_from': return periodInText(String(value), text, 'from');
    case 'period_to': return periodInText(String(value), text, 'to');
    default: {
      const v = squash(String(value));
      return v !== '' && squash(text).includes(v);
    }
  }
}

export interface FieldCheck {
  quote_ok: boolean;
  page: number | null;
  why?: string;
}

// quote_ok: the quote is on its page (else anywhere in the PDF) and the value
// is consistent with it. When the quote matched only word by word, the value
// must also be on that page.
export function checkQuote(doc: DocText, kind: ValueKind, value: string | number, page: number, quote: string): FieldCheck {
  const stated = page >= 1 ? page : null;
  if (!doc.textLayer) return { quote_ok: false, page: stated, why: 'no_text_layer' };
  if (!quote.trim()) return { quote_ok: false, page: stated, why: 'no_quote' };
  const hit = doc.findQuote(quote, page);
  if (!hit.found || !hit.page) return { quote_ok: false, page: stated, why: 'quote_not_found' };
  if (!valueInText(kind, value, quote)) return { quote_ok: false, page: hit.page, why: 'value_not_in_quote' };
  if (hit.how === 'words' && !valueInText(kind, value, doc.pageText(hit.page))) {
    return { quote_ok: false, page: hit.page, why: 'value_not_on_page' };
  }
  return { quote_ok: true, page: hit.page };
}

// ── Amounts by tax ─────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;

export function headTotal(h: HeadsOut[keyof HeadsOut]): number {
  return COMPONENTS.reduce((s, c) => s + (Number.isFinite(h[c]) ? h[c] : 0), 0);
}
export function headsTotal(d: HeadsOut): number {
  return round2(HEADS.reduce((s, h) => s + headTotal(d[h]), 0));
}
export function nonZeroAmounts(d: HeadsOut): number[] {
  const out: number[] = [];
  for (const h of HEADS) for (const c of COMPONENTS) if (Math.abs(d[h][c]) >= 0.005) out.push(d[h][c]);
  return out;
}

// Only the taxes that carry an amount, rounded to paise: the shape stored in
// gst_notices.demand and notice_issues.demand ({"cgst": {"tax", ...}}).
export function demandForDb(d: HeadsOut): Record<string, Record<string, number>> | null {
  const out: Record<string, Record<string, number>> = {};
  for (const h of HEADS) {
    if (COMPONENTS.every((c) => Math.abs(d[h][c]) < 0.005)) continue;
    out[h] = Object.fromEntries(COMPONENTS.map((c) => [c, round2(d[h][c])]));
  }
  return Object.keys(out).length ? out : null;
}

// The amount is backed by the PDF: printed in the quote, on its page or
// elsewhere in the notice, or the sum of components that are each printed.
export function amountBacked(doc: DocText, amount: number, parts: HeadsOut | null, quote: string, page: number | null): boolean {
  if (!(amount > 0)) return true;
  if (amountInText(amount, quote) || doc.hasAmount(amount, page) || doc.hasAmount(amount)) return true;
  if (!parts) return false;
  const comps = nonZeroAmounts(parts);
  return comps.length > 0 && Math.abs(headsTotal(parts) - amount) < 1 && comps.every((n) => doc.hasAmount(n));
}

export interface SumsCheck {
  ok: boolean | null;
  detail: string;
  heads?: Record<string, { notice: number; issues: number }>;
}

const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// The issues' amounts add up to the notice's demand, tax by tax, within ₹1.
// Issues often state only the tax, the notice adding interest and penalty:
// then the issues' tax adds up to the notice's tax. Unchecked (ok null)
// unless both the demand and the issues' amounts are there.
export function sumsCheck(demand: HeadsOut | null, issues: { demand: HeadsOut; amount: number }[]): SumsCheck {
  if (!demand || headsTotal(demand) <= 0) return { ok: null, detail: 'The notice states no demand.' };
  if (!issues.length) return { ok: null, detail: 'No issues were read.' };
  const withHeads = issues.filter((i) => headsTotal(i.demand) > 0);
  if (withHeads.length === issues.length) {
    const heads: Record<string, { notice: number; issues: number }> = {};
    let ok = true;
    for (const h of HEADS) {
      const notice = round2(headTotal(demand[h]));
      const iss = round2(issues.reduce((s, i) => s + headTotal(i.demand[h]), 0));
      if (notice || iss) heads[h] = { notice, issues: iss };
      if (Math.abs(notice - iss) > 1) ok = false;
    }
    if (ok) return { ok: true, detail: 'The issues add up to the demand, tax by tax.', heads };
    const taxOnly = issues.every((i) => HEADS.every((h) => COMPONENTS.every((c) => c === 'tax' || i.demand[h][c] === 0)));
    if (taxOnly) {
      const taxHeads: Record<string, { notice: number; issues: number }> = {};
      let taxOk = true;
      for (const h of HEADS) {
        const notice = round2(demand[h].tax);
        const iss = round2(issues.reduce((s, i) => s + i.demand[h].tax, 0));
        if (notice || iss) taxHeads[h] = { notice, issues: iss };
        if (Math.abs(notice - iss) > 1) taxOk = false;
      }
      if (taxOk) return { ok: true, detail: 'The issues add up to the tax demanded, tax by tax (interest and penalty are in the notice\'s total only).', heads: taxHeads };
    }
    const off = Object.entries(heads).filter(([, v]) => Math.abs(v.notice - v.issues) > 1)
      .map(([h, v]) => `${h.toUpperCase()} ${inr(v.issues)} in the issues v ${inr(v.notice)} in the notice`);
    return { ok: false, detail: `The issues do not add up to the demand: ${off.join('; ')}.`, heads };
  }
  if (issues.every((i) => i.amount > 0 || headsTotal(i.demand) > 0)) {
    const sum = round2(issues.reduce((s, i) => s + (headsTotal(i.demand) > 0 ? headsTotal(i.demand) : i.amount), 0));
    const total = headsTotal(demand);
    const tax = round2(HEADS.reduce((s, h) => s + demand[h].tax, 0));
    if (Math.abs(sum - total) <= 1) return { ok: true, detail: 'The issues add up to the demand.' };
    if (Math.abs(sum - tax) <= 1) return { ok: true, detail: 'The issues add up to the tax demanded.' };
    return { ok: false, detail: `The issues add up to ${inr(sum)}; the notice demands ${inr(total)}.` };
  }
  return { ok: null, detail: 'Not every issue states an amount.' };
}

// ── GSTIN ──────────────────────────────────────────────────────────────────
export interface GstinCheck {
  expected: string | null;
  found: string | null;
  ok: boolean | null;
}

// The GSTIN the notice is addressed to must be the client's. ok is null when
// the notice shows none (or the client has none on file); any other GSTIN is
// a mismatch, and the database then applies nothing from the reading.
export function gstinCheck(found: string, expected: string | null | undefined): GstinCheck {
  const clean = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  const f = clean(found), e = clean(expected);
  if (!f) return { expected: e, found: null, ok: null };
  if (!e) return { expected: null, found: f, ok: null };
  return { expected: e, found: f, ok: f === e };
}

// ── Dates that cannot be right ─────────────────────────────────────────────
export interface DateChecks {
  ok: boolean;
  failed: string[];
}

// A due date or hearing before the notice was issued, or a period that ends
// before it starts, is misread: those fields fail.
export function dateOrderCheck(d: { issue: string | null; due: string | null; hearing: string | null; from: string | null; to: string | null }): DateChecks {
  const failed: string[] = [];
  if (d.issue && d.due && d.due < d.issue) failed.push('due_date');
  if (d.issue && d.hearing && d.hearing < d.issue) failed.push('hearing_date');
  if (d.from && d.to && d.from > d.to) failed.push('period_from', 'period_to');
  return { ok: failed.length === 0, failed };
}
