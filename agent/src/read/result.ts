// From the Claude API's reading to what notice_read_finish takes (p_result):
// every field normalised for its column, with its page, quote and quote_ok;
// the issues; and the checks (quotes, sums, GSTIN, dates). The database then
// applies only checked fields, only into empty columns. Pure, no I/O.

import {
  amountBacked, amountInText, checkQuote, DocText, dateOrderCheck, demandForDb, gstinCheck, headsTotal,
  isoOf, nonZeroAmounts, parseIso, squash, sumsCheck, type FieldCheck, type GstinCheck, type SumsCheck, type ValueKind,
} from './checks.js';
import type { IssueCode } from './prompt.js';
import { FIELD_KEYS, type FieldKey, type FieldOut, type HeadsOut, type ReadingOut } from './schema.js';

export interface ReaderClaim {
  extraction_id: string;
  notice_id: string;
  client_id: string;
  document_url: string | null;
  document_label: string | null;
  form_code: string | null;
  reference_number: string | null;
  issue_date: string | null;
  client_gstin: string | null;
  attempt: number | null;
  model: string;
  effort: string;
  max_pages: number;
  price_in_per_mtok: number;
  price_out_per_mtok: number;
  issue_codes: IssueCode[] | null;
}

export interface ResultField {
  value: unknown;
  page: number | null;
  quote: string;
  quote_ok: boolean;
  printed?: string;
  why?: string;
}

export interface ResultIssue {
  issue_code: string;
  title: string;
  detail: string;
  period_from: string | null;
  period_to: string | null;
  demand: Record<string, Record<string, number>> | null;
  amount: number | null;
  page: number | null;
  para: string | null;
  quote: string;
  quote_ok: boolean;
  why?: string;
}

export interface ReadChecks {
  text_layer: boolean;
  quotes: { checked: number; ok: number; failed: string[] };
  sums: SumsCheck;
  gstin: GstinCheck;
  dates: { ok: boolean; failed: string[] };
  form: { expected: string | null; found: string | null; ok: boolean | null };
  reference: { expected: string | null; found: string | null; ok: boolean | null };
}

export interface ReadResult {
  fields: Record<string, ResultField>;
  issues: ResultIssue[];
  checks: ReadChecks;
  detail: {
    summary: string;
    documents_asked: string[];
    issues_withheld?: ResultIssue[];
    withheld?: string;
  };
  pages: number;
  text_layer: boolean;
  document_sha256: string;
  model: string;
}

export interface DocInfo {
  pages: string[];
  pageCount: number;
  textLayer: boolean;
  sha256: string;
}

// ── Normalising values for the columns ────────────────────────────────────
export const collapse = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// "Section 73(1) of the CGST Act, 2017" → "73(1)"; "u/s 61" → "61"; "74 A" → "74A".
export function normSection(printed: string): string | null {
  const t = (printed || '').normalize('NFKC');
  const NUM = '(\\d{1,3}\\s*[A-Za-z]?(?![A-Za-z])(?:\\s*\\(\\s*\\d{1,3}\\s*[A-Za-z]?\\s*\\))?)';
  const m = new RegExp(`(?:section|sec\\.?|u/s\\.?|under\\s+s\\.?)\\s*${NUM}(?!\\d)`, 'i').exec(t)
    ?? new RegExp(`(?<![\\d.,/])${NUM}(?![\\d.,/])`).exec(t);
  if (!m) return null;
  return m[1].replace(/\s+/g, '').replace(/^(\d+)([a-z])/, (_, n: string, l: string) => n + l.toUpperCase());
}

// "2019-2020", "F.Y. 2019-20", "2019/20", "FY 19-20" → "2019-20". A notice
// spanning several financial years has no single one: null.
export function normFy(printed: string): string | null {
  const t = (printed || '').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-');
  const starts = new Set<number>();
  for (const m of t.matchAll(/(?<!\d)(20\d{2})\s*[-/]\s*(\d{4}|\d{2})(?!\d)/g)) {
    const a = Number(m[1]);
    const b = m[2].length === 4 ? Number(m[2]) : Math.floor(a / 100) * 100 + Number(m[2]);
    if (b === a + 1) starts.add(a);
  }
  if (!starts.size) {
    for (const m of t.matchAll(/(?:f\.?\s?y\.?|financial year)\s*:?\s*(\d{2})\s*[-/]\s*(\d{2})(?!\d)/gi)) {
      const a = 2000 + Number(m[1]);
      if (Number(m[2]) === (a + 1) % 100) starts.add(a);
    }
  }
  if (starts.size !== 1) return null;
  const [y] = [...starts];
  return `${y}-${String(y + 1).slice(2)}`;
}

export function monthStart(iso: string): string | null {
  const x = parseIso(iso);
  return x ? isoOf({ y: x.y, m: x.m, d: 1 }) : null;
}
export function monthEnd(iso: string): string | null {
  const x = parseIso(iso);
  return x ? isoOf({ y: x.y, m: x.m, d: new Date(Date.UTC(x.y, x.m, 0)).getUTCDate() }) : null;
}
export const normGstin = (printed: string) => (printed || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// "FORM GST DRC-01" → "DRC-01"; "Form GST ASMT – 10" → "ASMT-10".
export function normFormCode(printed: string): string {
  const t = (printed || '').normalize('NFKC').toUpperCase().replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\bFORM\b|\bGST\b/g, ' ');
  const m = /\b([A-Z]{2,5})\s*-?\s*(\d{1,3}[A-Z]?)\b/.exec(t);
  return m ? `${m[1]}-${m[2]}` : collapse(t);
}

// ── Building the result ────────────────────────────────────────────────────
interface Spec {
  kind: ValueKind;
  // The value the quote must contain (as printed, or the date the model gave).
  check: (f: FieldOut) => string;
  // The value for the column; null when it cannot be read.
  db: (f: FieldOut) => unknown;
}
const text = (db: (p: string) => unknown = collapse): Spec => ({ kind: 'text', check: (f) => f.value, db: (f) => db(f.value) });
const date = (kind: ValueKind = 'date', db: (iso: string) => string | null = (iso) => (parseIso(iso) ? iso : null)): Spec =>
  ({ kind, check: (f) => f.value, db: (f) => db(f.value) });

const SPECS: Record<FieldKey, Spec> = {
  gstin: text(normGstin),
  form_code: text(normFormCode),
  reference_number: text(),
  din: text(),
  issue_date: date(),
  section_of_law: text(normSection),
  financial_year: text(normFy),
  period_from: date('period_from', monthStart),
  period_to: date('period_to', monthEnd),
  due_date: date(),
  hearing_date: date(),
  hearing_time: text(),
  hearing_venue: text(),
  officer: text(),
};

function mark(field: ResultField, c: FieldCheck) {
  field.quote_ok = c.quote_ok;
  field.page = c.page;
  if (c.why) field.why = c.why;
  else delete field.why;
}

export function buildResult(reading: ReadingOut, doc: DocInfo, claim: Pick<ReaderClaim, 'client_gstin' | 'issue_date' | 'form_code' | 'reference_number' | 'issue_codes'>, model: string): ReadResult {
  const dt = new DocText(doc.pages, doc.textLayer);
  const fields: Record<string, ResultField> = {};

  for (const k of FIELD_KEYS) {
    const f = reading[k];
    if (!f.value) continue;
    const spec = SPECS[k];
    const value = spec.db(f);
    const field: ResultField = { value, page: f.page || null, quote: clip(f.quote, 500), quote_ok: false };
    if (typeof value !== 'string' || value !== f.value) field.printed = f.value;
    if (value === null || value === '') {
      field.value = null;
      field.why = 'unreadable';
    } else {
      mark(field, checkQuote(dt, spec.kind, spec.check(f), f.page, f.quote));
    }
    fields[k] = field;
  }

  // Dates that cannot be right fail, whatever their quotes say.
  const okDate = (k: FieldKey) => (fields[k]?.quote_ok ? (fields[k].value as string) : null);
  const claimIssue = claim.issue_date && parseIso(String(claim.issue_date).slice(0, 10)) ? String(claim.issue_date).slice(0, 10) : null;
  const dates = dateOrderCheck({
    issue: okDate('issue_date') ?? claimIssue,
    due: okDate('due_date'),
    hearing: okDate('hearing_date'),
    from: okDate('period_from'),
    to: okDate('period_to'),
  });
  for (const k of dates.failed) {
    if (fields[k]) { fields[k].quote_ok = false; fields[k].why = 'date_order'; }
  }

  // The hearing's time and place, as one note ("11:00 AM · Room 5, …"):
  // checked only when every part of it is, and not when the hearing's date
  // cannot be right (an earlier hearing the notice mentions, most likely).
  const parts = (['hearing_time', 'hearing_venue'] as const).map((k) => fields[k]).filter((f): f is ResultField => !!f && f.value !== null);
  if (parts.length) {
    const bad = parts.find((p) => !p.quote_ok);
    const why = bad ? bad.why ?? 'part_failed' : dates.failed.includes('hearing_date') ? 'date_order' : null;
    fields.hearing_note = {
      value: parts.map((p) => p.value as string).join(' · '),
      page: parts[0].page,
      quote: [...new Set(parts.map((p) => p.quote))].join(' … '),
      quote_ok: !why,
      ...(why ? { why } : {}),
    };
  }

  // The demand: its quote on the page, a figure of it in the quote, and every
  // amount in it printed in the notice.
  const d = reading.demand;
  const demandHeads: HeadsOut | null = d.stated && headsTotal(d) > 0 ? d : null;
  if (demandHeads) {
    const total = headsTotal(demandHeads);
    const comps = nonZeroAmounts(demandHeads);
    const field: ResultField = { value: demandForDb(demandHeads), page: d.page || null, quote: clip(d.quote, 500), quote_ok: false };
    if (!doc.textLayer) field.why = 'no_text_layer';
    else if (!d.quote.trim()) field.why = 'no_quote';
    else {
      const hit = dt.findQuote(d.quote, d.page);
      if (!hit.found) field.why = 'quote_not_found';
      else {
        field.page = hit.page;
        if (!(amountInText(total, d.quote) || comps.some((n) => amountInText(n, d.quote)))) field.why = 'value_not_in_quote';
        else if (!comps.every((n) => dt.hasAmount(n))) field.why = 'amounts_not_in_text';
        else field.quote_ok = true;
      }
    }
    fields.demand = field;
  }

  // Issues.
  const known = new Map((claim.issue_codes ?? []).map((c) => [c.code.toUpperCase(), c.code]));
  const issues: ResultIssue[] = reading.issues.map((i, n) => {
    const total = headsTotal(i.demand);
    const amount = i.amount > 0 ? Math.round(i.amount * 100) / 100 : total > 0 ? total : null;
    const out: ResultIssue = {
      issue_code: known.get(i.issue_code.toUpperCase()) ?? 'OTHER',
      title: clip(collapse(i.title), 200) || `Issue ${n + 1}`,
      detail: clip(i.detail, 2000),
      period_from: monthStart(i.period_from),
      period_to: monthEnd(i.period_to),
      demand: demandForDb(i.demand),
      amount,
      page: i.page || null,
      para: collapse(i.para) || null,
      quote: clip(i.quote, 500),
      quote_ok: false,
    };
    if (!doc.textLayer) out.why = 'no_text_layer';
    else if (!i.quote.trim()) out.why = 'no_quote';
    else {
      const hit = dt.findQuote(i.quote, i.page);
      if (!hit.found) out.why = 'quote_not_found';
      else {
        out.page = hit.page;
        if (!amountBacked(dt, amount ?? 0, total > 0 ? i.demand : null, i.quote, hit.page)) out.why = 'amount_not_in_text';
        else out.quote_ok = true;
      }
    }
    if (out.period_from && out.period_to && out.period_from > out.period_to) {
      out.quote_ok = false;
      out.why = 'date_order';
    }
    return out;
  });

  // Issues go in together or not at all: a partial list would read as the
  // whole notice. Those not sent stay in the reading for a person to see.
  const allOk = issues.length > 0 && issues.every((i) => i.quote_ok);
  const detail: ReadResult['detail'] = { summary: reading.summary, documents_asked: reading.documents_asked };
  if (issues.length && !allOk) {
    detail.issues_withheld = issues;
    detail.withheld = doc.textLayer
      ? 'Not every issue could be found in the notice\'s text, so none was added.'
      : 'The notice is a scan without a text layer, so nothing in it could be checked.';
  }

  const checked = Object.entries(fields).filter(([k]) => k !== 'hearing_note');
  const failed = [
    ...checked.filter(([, f]) => !f.quote_ok).map(([k]) => k),
    ...issues.map((i, n) => (i.quote_ok ? null : `issues[${n}]`)).filter((x): x is string => !!x),
  ];
  const formFound = (fields.form_code?.value as string | undefined) ?? null;
  const formExpected = claim.form_code ? normFormCode(claim.form_code) : null;
  const refFound = (fields.reference_number?.value as string | undefined) ?? null;

  return {
    fields,
    issues: allOk ? issues : [],
    checks: {
      text_layer: doc.textLayer,
      quotes: { checked: checked.length + issues.length, ok: checked.length + issues.length - failed.length, failed },
      sums: sumsCheck(demandHeads, reading.issues),
      gstin: gstinCheck(reading.gstin.value, claim.client_gstin),
      dates,
      form: { expected: formExpected, found: formFound, ok: formExpected && formFound ? formExpected === formFound : null },
      reference: {
        expected: claim.reference_number ?? null,
        found: refFound,
        ok: claim.reference_number && refFound ? squash(claim.reference_number) === squash(refFound) : null,
      },
    },
    detail,
    pages: doc.pageCount,
    text_layer: doc.textLayer,
    document_sha256: doc.sha256,
    model,
  };
}
