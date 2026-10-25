// The kinds of evidence a GST case carries, and how a file is recognised as one
// of them from what is known about it: the AI reader's title and summary, the
// portal's own filename, and a person's choice (case_document_labels). Pure, so
// the Documents and Evidence tabs and any check script read it the same way.

export interface EvidenceType {
  key: string;
  /** The name a file of this type is shown (and downloaded) under. */
  label: string;
  /** One line for the picker. */
  hint: string;
  /** Matched against the AI title + summary + original filename, lower-cased. */
  re: RegExp | null;
}

/** In the order a reply usually annexes them; the first match names the file. */
export const EVIDENCE_TYPES: EvidenceType[] = [
  { key: 'purchase_invoices', label: 'Purchase invoices', hint: 'Suppliers\' tax invoices and debit notes', re: /purchase invoice|inward invoice|supplier'?s? invoice|invoices? (from|issued by)|tax invoices? from/ },
  { key: 'sales_invoices', label: 'Sales invoices', hint: 'Outward invoices, export invoices', re: /sales? invoice|outward invoice|export invoice|invoices? (to|issued to) (the )?(customer|buyer)/ },
  { key: 'invoices', label: 'Invoices', hint: 'Tax invoices, bills, credit and debit notes', re: /\binvoice|\bbills? of supply|credit note|debit note/ },
  { key: 'eway_bills', label: 'E-way bills', hint: 'E-way bills and e-invoice IRN copies', re: /e-?\s?way\s?bill|\bewb\b|\birn\b/ },
  { key: 'transport_proof', label: 'Transport and delivery proof', hint: 'LR, GRN, delivery challans, weighbridge slips', re: /lorry receipt|\blr\b|consignment note|goods receipt|\bgrn\b|delivery challan|weigh ?bridge|transport/ },
  { key: 'bank_statement', label: 'Bank statement / payment proof', hint: 'Bank statements, payment advices, cheques', re: /bank statement|bank book|payment proof|proof of payment|paid through bank|\bneft\b|\brtgs\b|cheque|payment advice/ },
  { key: 'foreign_remittance', label: 'Foreign remittance certificates', hint: 'FIRC, BRC, e-BRC, FIRS', re: /\bfirc\b|\bbrc\b|\bfirs\b|foreign inward remittance|bank realisation/ },
  { key: 'shipping_bills', label: 'Shipping bills', hint: 'Shipping bills, bills of export, EGM', re: /shipping bill|bill of export|\begm\b|let export/ },
  { key: 'gstr_8a', label: 'GSTR-9 Table 8A statement', hint: 'Table 8A ITC as per GSTR-2A', re: /table 8a|\b8a\b|gstr-?9 8a/ },
  { key: 'gstr_2a_2b', label: 'GSTR-2A / 2B statement', hint: 'Auto-drafted ITC statements', re: /gstr-?\s?2a|gstr-?\s?2b|\b2a\b|\b2b\b/ },
  { key: 'returns', label: 'Return copies', hint: 'GSTR-1, GSTR-3B, GSTR-9 / 9C as filed', re: /gstr-?\s?1\b|gstr-?\s?3b|gstr-?\s?9c?\b|returns? (filed|copy)|\breturn\b/ },
  { key: 'ledgers', label: 'Ledger extracts', hint: 'Books of account, ledgers, registers', re: /ledger|books of account|purchase register|sales register|stock register|tally/ },
  { key: 'reconciliation', label: 'Reconciliation and working', hint: 'Reconciliations, computations, workings', re: /reconcil|working|computation|calculation|summary sheet|statement of difference/ },
  { key: 'tax_payment', label: 'Tax payment challans', hint: 'DRC-03, PMT-06 challans, cash ledger', re: /drc-?\s?0?3\b|pmt-?\s?0?6|challan|cash ledger|electronic credit ledger/ },
  { key: 'contracts', label: 'Contracts and work orders', hint: 'Agreements, tenders, work orders, POs', re: /agreement|contract|tender|work order|purchase order|\bpo\b|letter of award/ },
  { key: 'certificates', label: 'Certificates', hint: 'CA certificates, completion and other certificates', re: /certificate|chartered accountant|ca cert/ },
  { key: 'declarations', label: 'Declarations and undertakings', hint: 'Undertakings, affidavits, declarations', re: /undertaking|affidavit|declaration|indemnity/ },
  { key: 'registration', label: 'Registration documents', hint: 'GST registration, PAN, supplier status', re: /registration certificate|reg-?\s?0?6|\bpan\b|cancell?ation of registration|gstin status|supplier status/ },
  { key: 'case_law', label: 'Case laws and circulars', hint: 'Judgments, circulars, notifications relied on', re: /judg(e)?ment|case law|high court|supreme court|tribunal|\bcircular\b|notification no/ },
  { key: 'annexure', label: 'Annexure', hint: 'Statements annexed to the reply or application', re: /annexure|annex\b|statement/ },
  { key: 'other', label: 'Other evidence', hint: 'Anything else relied on', re: null },
];

const BY_KEY = new Map(EVIDENCE_TYPES.map((t) => [t.key, t]));
export const evidenceType = (key: string | null | undefined): EvidenceType => BY_KEY.get(key ?? '') ?? BY_KEY.get('other')!;

/** A filename made readable for matching: "Binder2_8A-statement.pdf" → "binder2 8a statement". */
export const filenameWords = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The evidence types a file shows, most specific first (at most three): from
 * the AI's title first (it names what the file is), then its summary, then the
 * filename, each only when the one before says nothing. A general "Invoices"
 * becomes purchase or sales invoices when the summary says which.
 */
export function detectEvidenceTypes(v: { aiTitle?: string | null; aiSummary?: string | null; filename?: string | null }): EvidenceType[] {
  const title = (v.aiTitle ?? '').toLowerCase();
  const summary = (v.aiSummary ?? '').toLowerCase();
  const pick = (text: string) => (text.trim() ? EVIDENCE_TYPES.filter((t) => t.re && t.re.test(text)) : []);
  let hits = pick(title);
  if (!hits.length) hits = pick(summary);
  if (!hits.length && v.filename) hits = pick(filenameWords(v.filename));
  if (hits.some((t) => t.key === 'invoices')) {
    const side = pick(summary).find((t) => t.key === 'purchase_invoices' || t.key === 'sales_invoices');
    if (side && !hits.includes(side)) hits = hits.map((t) => (t.key === 'invoices' ? side : t));
  }
  if (hits.some((t) => t.key === 'purchase_invoices' || t.key === 'sales_invoices')) hits = hits.filter((t) => t.key !== 'invoices');
  if (hits.some((t) => t.key === 'gstr_8a')) hits = hits.filter((t) => t.key !== 'gstr_2a_2b' || /2b/.test(title));
  if (hits.length > 1) hits = hits.filter((t) => t.key !== 'annexure' && t.key !== 'returns');
  return hits.length ? hits.slice(0, 3) : [evidenceType('other')];
}

/** "Purchase invoices, E-way bills & Bank statement and payment proof". */
export function joinTypeLabels(types: EvidenceType[]): string {
  const l = types.map((t) => t.label);
  if (l.length <= 1) return l[0] ?? 'Other evidence';
  return `${l.slice(0, -1).join(', ')} & ${l[l.length - 1]}`;
}

/** A name safe to download under: no slashes or reserved characters, at most 120 characters, the original extension kept. */
export function downloadName(name: string, original: string): string {
  const ext = (original.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'pdf').toLowerCase();
  const base = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document';
  return `${base}.${ext}`;
}
