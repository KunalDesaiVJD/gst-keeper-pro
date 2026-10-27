// Part B of DRC-01B and DRC-01C from the annexure (the law audit of 26 Oct
// 2026, section C). The reply templates for these intimations leave the reasons
// for the difference as "(a) [reason …]: Rs. [amount]" lines; the annexure the
// Evidence tab built (GSTR-1 v GSTR-3B, or GSTR-3B v GSTR-2B) already holds each
// reconciling item head by head. This puts those items in place of the
// placeholder lines, in the templates' words, with no hyphen or dash (the
// firm's rule for what is filed). Pure. §36 of docs/NOTICES_LITIGATION_POSITIONS.md.
import type { AnnexureSummary, SummaryLine } from './types';

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;
const HEAD_WORD: Record<(typeof HEADS)[number], string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess' };
const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-IN')}`;

/** A reconciling line of the annexure in the words a Part B reply uses. */
function reasonWords(label: string, form: string): string {
  const l = label.toLowerCase();
  if (l.includes('timing') && form === 'DRC-01B') return 'Tax on supplies reported in FORM GSTR 1 for the period and paid with the return in FORM GSTR 3B for another tax period of the same financial year, as shown month by month in the annexure';
  if (l.includes('timing')) return 'Credit on invoices reflected in FORM GSTR 2B of another tax period of the same financial year, as shown month by month in the annexure';
  if (l.includes('drc-03') || l.includes('drc 03')) return 'Tax already paid through FORM GST DRC 03 for this difference';
  if (l.includes('re-claimed') || l.includes('reclaimed') || l.includes('4d(1)')) return 'Credit reversed earlier and reclaimed in Table 4D(1) of FORM GSTR 3B, which FORM GSTR 2B of the period does not show';
  if (l.includes('36(4)')) return 'Provisional credit allowed under rule 36(4) of the Rules for the period';
  return label.replace(/[-–—]/g, ' ');
}

const total = (v: SummaryLine['values']) => HEADS.reduce((s, h) => s + Math.abs(Number(v[h] ?? 0)), 0);

/** The "(a) …: Rs. …" lines for the annexure's reconciling items (none: an empty list). */
export function partBLines(summary: AnnexureSummary, form: string): string[] {
  return summary.lines.filter((x) => x.kind === 'reconciling' && total(x.values) >= 1).map((x, i) => {
    const parts = HEADS.filter((h) => Math.abs(Number(x.values[h] ?? 0)) >= 1).map((h) => `${HEAD_WORD[h]} ${rs(Math.abs(Number(x.values[h])))}`);
    return `(${String.fromCharCode(97 + i)}) ${reasonWords(x.label, form)}: ${rs(total(x.values))}${parts.length > 1 ? ` (${parts.join(', ')})` : ''}`;
  });
}

const PLACEHOLDER = /^\([a-z]\) \[(?:reason for the difference|further reason, if any)[^\n]*$/gm;

/** Does the draft still hold the template's reason lines? */
export const hasPartBPlaceholders = (body: string) => new RegExp(PLACEHOLDER.source, 'm').test(body);

/**
 * The draft with its placeholder reason lines replaced by the annexure's items,
 * or null when it has no such lines or the annexure has no reconciling item.
 */
export function fillPartB(body: string, summary: AnnexureSummary, form: string): string | null {
  const lines = partBLines(summary, form);
  if (!lines.length || !hasPartBPlaceholders(body)) return null;
  const one = new RegExp(PLACEHOLDER.source);
  const out: string[] = [];
  let filled = false;
  for (const l of body.split('\n')) {
    if (!one.test(l)) { out.push(l); continue; }
    if (!filled) { out.push(...lines); filled = true; }
  }
  return out.join('\n');
}
