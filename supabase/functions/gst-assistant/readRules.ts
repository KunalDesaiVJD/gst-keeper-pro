// What the GST Assistant may read (23 Nov 2026). The model asks for rows of a
// table by name; only the GST working tables and views below are open, no
// column that holds a password, a portal user id, a token or a hash is ever
// returned, and a client that opted out of AI (clients.ai_opt_out) is never
// sent to the model. The knowledge file's table list is only a description:
// these rules are the gate.

export const TABLE_ALLOW = /^(clients|twob_|bills_not_in_|books_register|itc_|rcm_|gstr|filing_status|filing_record|gst_filed_returns|advance|builder_|annual_return_|reco_|suspended_|gst_receivable|client_annual_turnover|gst_running|manual_source_allowances|gst_refund_applications|gst_drc03_filings|notice_facts|refund_facts|drc03_facts|return_reminder|reminder_period)/;
export const TABLE_DENY = /(password|token|secret|session|confirm_code|_stage$|ai_api_key|doc_link|_log$|_history$|audit)/;
export const COLUMN_DENY = /(password|passwd|token|secret|hash|otp|api_key|captcha|gst_user_id)/i;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'in', 'is'] as const;
export type Op = typeof OPS[number];
export interface Filter { column: string; op: Op; value: unknown }

export function tableAllowed(name: string): boolean {
  return IDENT.test(name) && TABLE_ALLOW.test(name) && !TABLE_DENY.test(name);
}

export function columnAllowed(name: string): boolean {
  return IDENT.test(name) && !COLUMN_DENY.test(name);
}

/** The columns asked for, as a PostgREST select; '*' when none or all. */
export function selectList(columns: unknown): string | { error: string } {
  if (!Array.isArray(columns) || columns.length === 0 || columns.includes('*')) return '*';
  const cols = columns.map(String);
  const bad = cols.filter((c) => !columnAllowed(c));
  if (bad.length) return { error: `These columns cannot be read: ${bad.join(', ')}` };
  return cols.join(',');
}

export function checkFilters(filters: unknown): Filter[] | { error: string } {
  if (filters == null) return [];
  if (!Array.isArray(filters)) return { error: 'filters must be a list' };
  const out: Filter[] = [];
  for (const f of filters.slice(0, 12)) {
    const column = String((f as Filter)?.column ?? '');
    const op = String((f as Filter)?.op ?? 'eq') as Op;
    if (!IDENT.test(column) || COLUMN_DENY.test(column)) return { error: `Cannot filter on ${column}` };
    if (!OPS.includes(op)) return { error: `Unknown filter op ${op}` };
    out.push({ column, op, value: (f as Filter).value });
  }
  return out;
}

/** Takes every denied column off the rows, and the rows of clients that opted out of AI. */
export function cleanRows(table: string, rows: Record<string, unknown>[], optedOut: Set<string>): { rows: Record<string, unknown>[]; withheld: number } {
  let withheld = 0;
  const kept: Record<string, unknown>[] = [];
  for (const r of rows) {
    const cid = table === 'clients' ? r.id : r.client_id;
    if (typeof cid === 'string' && optedOut.has(cid)) { withheld += 1; continue; }
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (!COLUMN_DENY.test(k)) o[k] = v;
    kept.push(o);
  }
  return { rows: kept, withheld };
}

export interface DocSection { doc: string; title: string; heading: string; text: string }

const STOP = new Set(['the', 'and', 'for', 'how', 'what', 'why', 'can', 'does', 'with', 'this', 'that', 'from', 'into', 'are', 'was', 'not', 'you', 'have', 'which', 'when', 'where', 'who', 'its', 'will', 'should', 'there', 'their', 'about', 'any', 'all', 'one', 'our']);

export function words(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^a-z0-9.\-/ ]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w)))];
}

/** The doc sections that best match the question: heading words count most. */
export function searchDocs(docs: DocSection[], q: string, k = 5): DocSection[] {
  const ws = words(q);
  if (!ws.length) return [];
  const scored = docs.map((d) => {
    const head = `${d.title} ${d.heading}`.toLowerCase();
    const text = d.text.toLowerCase();
    let s = 0;
    let hits = 0;
    for (const w of ws) {
      const inHead = head.includes(w);
      const count = Math.min(text.split(w).length - 1, 8);
      if (inHead || count) hits += 1;
      s += (inHead ? 6 : 0) + count;
    }
    return { d, s: s * (hits / ws.length) };
  }).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.d);
}
