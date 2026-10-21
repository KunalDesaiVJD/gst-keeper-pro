// Change history: what the Change history page and the History buttons read.
//
// The database keeps every change to the GST working tables in
// gst_change_log (migration 20261021130000_gst_change_log.sql) and shows it,
// with the Annual Return figure log and the Liberal switch log, in the view
// gst_change_history. This file holds the pure parts the page uses: the
// pages and tables, readable names for columns, the filters as a query, the
// lines "field: old -> new" for one change, and the rows of the Excel export.
// scripts/verify-change-history.mjs checks them on rows the real triggers wrote.

export type HistoryOp = 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE';

export interface HistoryRow {
  key: string;
  log: string;
  log_id: number | null;
  at: string;
  table_name: string;
  row_id: string | null;
  row_label: string | null;
  client_id: string | null;
  period_month: string | null;
  financial_year: string | null;
  op: HistoryOp | string;
  actor_id: string | null;
  actor_name: string | null;
  actor_source: string | null;
  actor_basis: string | null;
  changed: unknown;
  request_id: string | null;
}

export const HISTORY_COLUMNS =
  'key,log,log_id,at,table_name,row_id,row_label,client_id,period_month,financial_year,op,actor_id,actor_name,actor_source,actor_basis,changed,request_id';

// ---------------------------------------------------------------------------
// Pages and tables
// ---------------------------------------------------------------------------
export type HistoryPageKey =
  | 'import2b' | 'twob_reco' | 'itc' | 'suspended' | 'receivable' | 'filing' | 'gstr1' | 'gstr3b'
  | 'rcm' | 'update_sheet' | 'advances' | 'builder' | 'clients' | 'portal' | 'annual' | 'allowances';

export interface HistoryPage { key: HistoryPageKey; label: string; tables: string[] }

export const HISTORY_PAGES: HistoryPage[] = [
  { key: 'import2b', label: 'Import 2B', tables: ['twob_import_docs', 'books_register'] },
  { key: 'twob_reco', label: '2B Reconciliation', tables: ['bills_not_in_2b', 'bills_not_in_books', 'twob_versions'] },
  { key: 'itc', label: 'ITC Summary', tables: ['itc_summaries', 'itc_versions'] },
  { key: 'suspended', label: 'Suspended Reco', tables: ['suspended_reco'] },
  { key: 'receivable', label: 'GST Receivable Reco', tables: ['gst_receivable_reco'] },
  { key: 'filing', label: 'Filing Status', tables: ['filing_status'] },
  { key: 'gstr1', label: 'GSTR-1', tables: ['gstr1_data', 'gstr1_manual_entries', 'gstr1_upload_versions', 'gstr1_upload_versions_quarantine', 'gstr1_direct_filing_approvals', 'einvoice_docs', 'portal_gstr1_category_figures'] },
  { key: 'gstr3b', label: 'GSTR-3B', tables: ['gstr3b_adjustments', 'gstr3b_push_versions'] },
  { key: 'rcm', label: 'RCM', tables: ['rcm_data', 'rcm_masters', 'rcm_versions'] },
  { key: 'update_sheet', label: 'GST Update Sheet', tables: ['gst_running_updates', 'gst_update_versions', 'gst_update_row_versions'] },
  { key: 'advances', label: 'Advances', tables: ['advance_receipts', 'advance_adjustments', 'advance_opening_balances', 'advance_setoff_overrides', 'contract_projects', 'contract_ra_bills'] },
  { key: 'clients', label: 'Clients', tables: ['clients', 'client_annual_turnover', 'client_scheme_history', 'audit_log'] },
  { key: 'portal', label: 'Portal pulls', tables: ['gst_credit_ledger_transactions', 'gst_cash_ledger_entries', 'gst_liability_ledger_entries', 'gst_credit_reversal_reclaim_entries', 'gst_rcm_liability_itc_entries', 'gst_filed_returns', 'gstr2a_import_docs', 'gst_challans', 'gst_taxpayer_profile'] },
  { key: 'allowances', label: 'Manual entries allowed', tables: ['manual_source_allowances'] },
  { key: 'annual', label: 'Annual Return', tables: ['annual_return_docs', 'annual_return_bs_pl_uploads', 'annual_return_carry_forward', 'reconciliation_reasons', 'expense_head_mappings', 'itc_reversal_lines', 'duties_taxes_input_monthly', 'duties_taxes_output_monthly', 'books_purchase_lines', 'books_turnover_lines', 'pl_input_lines', 'pl_output_lines', 'annexure3_other_payments', 'rcm_annual_return_lines', 'portal_tax_payment_entries', 'gstr9_output_lines', 'gstr9_table14_differential_tax', 'gstr9_table15_demands_refunds', 'gstr9_table16_composition_deemed_approval', 'gstr9c_certification', 'gstr9c_part_v_additional_liability', 'gstr9c_table11_additional_liability', 'gstr9c_table12_net_itc', 'gstr9c_table16_tax_payable_unreconciled_itc', 'gstr9c_table5_turnover_reco', 'gstr9c_table7_taxable_turnover_reco', 'gstr9c_table9_rate_wise_liability_reco'] },
  // Every builder_* table; listed by prefix in pageOfTable.
  { key: 'builder', label: 'Builder', tables: [] },
];

const TABLE_LABELS: Record<string, string> = {
  twob_import_docs: '2B documents',
  books_register: 'Books register',
  bills_not_in_2b: 'Not in 2B',
  bills_not_in_books: 'Not in Books',
  twob_versions: '2B saved versions',
  itc_summaries: 'ITC Summary',
  itc_versions: 'ITC saved versions',
  suspended_reco: 'Suspended Reco',
  gst_receivable_reco: 'GST Receivable Reco',
  filing_status: 'Filing Status',
  gstr1_data: 'GSTR-1 data',
  gstr1_manual_entries: 'GSTR-1 manual entries',
  gstr1_upload_versions: 'GSTR-1 uploads',
  gstr1_upload_versions_quarantine: 'GSTR-1 uploads (set aside)',
  gstr1_direct_filing_approvals: 'GSTR-1 direct filing approvals',
  einvoice_docs: 'E-invoices',
  portal_gstr1_category_figures: 'GSTR-1 portal figures',
  gstr3b_adjustments: 'GSTR-3B adjustments',
  gstr3b_push_versions: 'GSTR-3B pushes',
  rcm_data: 'RCM sheet',
  rcm_masters: 'RCM masters',
  rcm_versions: 'RCM saved versions',
  gst_running_updates: 'GST Update Sheet',
  gst_update_versions: 'Update Sheet saved versions',
  gst_update_row_versions: 'Update Sheet row history',
  advance_receipts: 'Advance receipts',
  advance_adjustments: 'Advance set-offs',
  advance_opening_balances: 'Advance opening balances',
  advance_setoff_overrides: 'Advance set-off overrides',
  contract_projects: 'Works contract projects',
  contract_ra_bills: 'RA bills',
  clients: 'Client master',
  client_annual_turnover: 'Annual turnover',
  client_scheme_history: 'Scheme changes',
  audit_log: 'Clear Data log',
  gst_credit_ledger_transactions: 'Credit ledger (portal)',
  gst_cash_ledger_entries: 'Cash ledger (portal)',
  gst_liability_ledger_entries: 'Liability ledger (portal)',
  gst_credit_reversal_reclaim_entries: 'Reversal and reclaim ledger (portal)',
  gst_rcm_liability_itc_entries: 'RCM liability and ITC ledger (portal)',
  gst_filed_returns: 'Filed returns (portal)',
  gstr2a_import_docs: 'GSTR-2A documents',
  gst_challans: 'Challans (portal)',
  gst_taxpayer_profile: 'Taxpayer profile (portal)',
  manual_source_allowances: 'Manual entry allowed',
  annual_return_docs: 'Annual Return workings',
};

export function pageOfTable(table: string): HistoryPage | null {
  if (table.startsWith('builder_')) return HISTORY_PAGES.find((p) => p.key === 'builder') ?? null;
  return HISTORY_PAGES.find((p) => p.tables.includes(table)) ?? null;
}

export function tableLabel(table: string): string {
  if (TABLE_LABELS[table]) return TABLE_LABELS[table];
  if (table.startsWith('builder_')) return 'Builder ' + humanize(table.slice('builder_'.length)).toLowerCase();
  return humanize(table);
}

// ---------------------------------------------------------------------------
// Readable names
// ---------------------------------------------------------------------------
const ACRONYMS = new Set(['gst', 'gstin', 'itc', 'rcm', 'igst', 'cgst', 'sgst', 'arn', 'pdf', 'drc', 'bu', 'fsi', 'tds', 'irn',
  'hsn', 'id', 'pos', 'json', 'cpin', 'gstr1', 'gstr3b', 'gstr9', 'gstr9c', 'pan', 'tdr', 'ra', 'bg', 'ims', 'cdn', 'b2b', 'b2c', 'url', 'ai']);

/** snake_case or camelCase to "Words in sentence case", with GST acronyms in capitals. */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  if (!words.length) return name;
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

const COLUMN_LABELS: Record<string, string> = {
  supplier_name: 'Supplier',
  supplier_gstin: 'Supplier GSTIN',
  supplier_invoice_number: 'Invoice no.',
  taxable_value: 'Taxable value',
  invoice_value: 'Invoice value',
  input_igst: 'IGST',
  input_cgst: 'CGST',
  input_sgst: 'SGST',
  period_month: 'Month',
  financial_year: 'Financial year',
  return_type: 'Return',
  filed_date: 'Filed on',
  is_locked: 'Locked',
  is_nil: 'Nil return',
  return_pdf_url: 'Return PDF',
  pushed_at: 'Pushed on',
  book_entry_month: 'Book entry month',
  bill_in_2b_month: 'In 2B month',
  reversal_month: 'Reversal month',
  reclaim_month: 'Reclaim month',
  is_carried_forward: 'Carried forward',
  itc_action: 'ITC action',
  itc_reason: 'ITC reason',
  itc_available: 'ITC available',
  book_treatment: 'Books treatment',
  opening_source: 'Opening from',
  opening_override_justification: 'Override reason',
  opening_override_at: 'Override on',
  opening_override_by: 'Override by',
  opening_portal_pulled_at: 'Pulled from the portal on',
  opening_portal_pulled_by: 'Pulled by',
  opening_csv_uploaded_at: 'CSV uploaded on',
  opening_csv_uploaded_by: 'CSV uploaded by',
  data: 'Figures',
  raw_json: 'GSTR-1 data',
  version_data: 'Saved version',
  payload: 'Data sent',
  updated_by: 'Saved by',
  imported_by: 'Imported by',
  posted_by: 'Posted by',
  posted_at: 'Posted on',
  created_by: 'Created by',
  allowed_by: 'Allowed by',
  allowed_at: 'Allowed on',
  revoked_by: 'Revoked by',
  revoked_at: 'Revoked on',
  used_by: 'Used by',
  used_at: 'Used on',
  scope: 'For',
  gst_password_changed_at: 'GST portal password changed on',
  liberal_2b_reconciliation: 'Liberal 2B Reconciliation',
  name: 'Name',
  gstin: 'GSTIN',
};

/** A column's name for people. */
export function columnLabel(column: string): string {
  return COLUMN_LABELS[column] ?? humanize(column);
}

/** A path inside a JSON column ("section4A[5.1].igst") for people ("4A, 5.1, IGST"). */
export function pathLabel(path: string): string {
  const parts: string[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[([^\]]*)\]/g)) {
    if (m[1] !== undefined) parts.push(/^section(\w+)$/i.test(m[1]) ? m[1].replace(/^section/i, 'Table ') : columnLabel(m[1]));
    else parts.push(m[2]);
  }
  return parts.join(', ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "2026-10-21T04:30:00Z" as "21 Oct 2026, 10:00" in India time. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ist = new Date(d.getTime() + 330 * 60_000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hh}:${mm}`;
}

/** "09/2026" as "Sep 2026". */
export function monthLabel(month: string | null | undefined): string {
  const m = month?.match(/^(\d{2})\/(\d{4})$/);
  return m ? `${MONTHS[Number(m[1]) - 1]} ${m[2]}` : (month ?? '');
}

function bytesLabel(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;
}

function isSummary(v: unknown): v is { summary: true; md5?: string; bytes?: number; keys?: number; items?: number } {
  return !!v && typeof v === 'object' && (v as { summary?: unknown }).summary === true;
}

/** One value for people. Staff ids are named when the name is known. */
export function formatValue(v: unknown, names: Record<string, string> = {}): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (typeof v === 'string') {
    if (UUID_RE.test(v)) return names[v] ?? v.slice(0, 8);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatStamp(v);
    const d = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (d) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1]} ${d[1]}`;
    return v.length > 200 ? v.slice(0, 200) + '…' : v;
  }
  if (isSummary(v)) {
    const size = typeof v.bytes === 'number' ? bytesLabel(v.bytes) : '';
    const count = typeof v.items === 'number' ? `${v.items} items` : typeof v.keys === 'number' ? `${v.keys} parts` : '';
    return ['document', [size, count].filter(Boolean).join(', '), v.md5 ? `fingerprint ${v.md5.slice(0, 8)}` : '']
      .filter(Boolean).join(' · ');
  }
  const s = JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

// ---------------------------------------------------------------------------
// One change, as lines
// ---------------------------------------------------------------------------
export interface ChangeLine { field: string; label: string; old: string; new: string }

export interface ChangeView {
  /** Added / Changed / Removed / Cleared, or the allowance's own words. */
  action: string;
  lines: ChangeLine[];
  /** A note under the lines (a manual-entry badge, an error, a cut list). */
  note: string | null;
}

const ACTION: Record<string, string> = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed', TRUNCATE: 'Cleared' };

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The badge for a manual-entry allowance: "manual (allowed by X: reason)". */
export function allowanceBadge(row: Pick<HistoryRow, 'table_name' | 'op' | 'changed' | 'actor_name'>, names: Record<string, string> = {}): string | null {
  if (row.table_name !== 'manual_source_allowances') return null;
  const c = asObject(row.changed);
  const reason = typeof c.reason === 'string' ? c.reason : null;
  const by = typeof c.allowed_by === 'string' ? (names[c.allowed_by] ?? row.actor_name ?? c.allowed_by.slice(0, 8)) : row.actor_name;
  if (row.op === 'INSERT' && reason) return `manual (allowed by ${by ?? 'the superadmin'}: ${reason})`;
  return null;
}

export function describeChange(row: Pick<HistoryRow, 'op' | 'table_name' | 'changed' | 'actor_name'> & { period_month?: string | null },
  names: Record<string, string> = {}): ChangeView {
  const c = asObject(row.changed);
  const lines: ChangeLine[] = [];
  let note: string | null = null;
  let action = ACTION[row.op] ?? row.op;

  if (typeof c._error === 'string') {
    return { action, lines, note: `The details of this change could not be recorded (${c._error}).` };
  }
  if (row.op === 'TRUNCATE') {
    return { action, lines, note: `Every row was removed (${formatValue(c.rows)}).` };
  }
  if (row.op === 'UPDATE' && c._key_changed === true) {
    note = 'The row was moved to a new key.';
    const o = asObject(c.old); const n = asObject(c.new);
    for (const k of [...new Set([...Object.keys(o), ...Object.keys(n)])].sort()) {
      lines.push({ field: k, label: columnLabel(k), old: formatValue(o[k], names), new: formatValue(n[k], names) });
    }
    return { action, lines, note };
  }

  // Columns in name order (the database keeps JSON keys in its own order).
  const entries = Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (row.op === 'UPDATE') {
    for (const [k, v] of entries) {
      const ch = asObject(v);
      if (Array.isArray(ch.changes)) {
        for (const leaf of ch.changes as Array<{ path?: string; old?: unknown; new?: unknown }>) {
          const path = leaf.path ?? '';
          lines.push({ field: path ? `${k}.${path}` : k, label: path ? `${columnLabel(k)}: ${pathLabel(path)}` : columnLabel(k),
            old: formatValue(leaf.old, names), new: formatValue(leaf.new, names) });
        }
        if (ch.more === true) note = `${columnLabel(k)}: more than 100 parts changed; the first 100 are shown.`;
      } else if (ch.summary === true) {
        const keys = Array.isArray(ch.keys_changed) ? (ch.keys_changed as string[]) : [];
        lines.push({ field: k, label: columnLabel(k) + (keys.length ? ` (parts changed: ${keys.join(', ')})` : ''),
          old: formatValue(ch.old, names), new: formatValue(ch.new, names) });
      } else {
        // The Annual Return log names a place inside its sheet ("t4.a.taxable").
        lines.push({ field: k, label: k.includes('.') ? pathLabel(k) : columnLabel(k), old: formatValue(ch.old, names), new: formatValue(ch.new, names) });
      }
    }
  } else {
    for (const [k, v] of entries) {
      // The month is in its own column already.
      if (k === 'period_month' && v === row.period_month) continue;
      const shown = formatValue(v, names);
      lines.push(row.op === 'DELETE'
        ? { field: k, label: columnLabel(k), old: shown, new: '' }
        : { field: k, label: columnLabel(k), old: '', new: shown });
    }
    if (!lines.length) note = 'No other fields were filled.';
  }

  if (row.table_name === 'manual_source_allowances') {
    if (row.op === 'INSERT') action = 'Manual entry allowed';
    else if (row.op === 'UPDATE' && 'revoked_at' in c) action = 'Manual entry revoked';
    else if (row.op === 'UPDATE' && 'used_at' in c) action = 'Manual entry used';
    note = allowanceBadge(row, names) ?? note;
  }
  return { action, lines, note };
}

const SOURCE: Record<string, string> = { app: 'App', extension: 'Extension', agent: 'Office agent', system: 'System', unknown: 'Not recorded' };

/** "Gita" / "Extension, for Gita" / "System" / "Not recorded". */
export function whoLabel(row: Pick<HistoryRow, 'actor_name' | 'actor_id' | 'actor_source' | 'actor_basis'>): string {
  const name = row.actor_name ?? (row.actor_id ? row.actor_id.slice(0, 8) : null);
  const source = row.actor_source ?? 'unknown';
  if (source === 'extension') return name ? `Extension, for ${name}` : 'Extension';
  if (source === 'agent') return name ? `Office agent, for ${name}` : 'Office agent';
  if (source === 'system') return name ?? 'System';
  return name ?? 'Not recorded';
}

/** Where the name came from, when it is not the app's own word. */
export function whoNote(row: Pick<HistoryRow, 'actor_basis' | 'actor_source' | 'log'>): string | null {
  if (row.log === 'annual_return_change_log' || row.log === 'client_liberal_log') return null;
  if (row.actor_basis === 'row') return "from the row's own stamp";
  if (row.actor_basis === 'none' && row.actor_source !== 'system') return 'no person recorded';
  return null;
}

export function sourceLabel(source: string | null | undefined): string {
  return SOURCE[source ?? 'unknown'] ?? (source ?? '');
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export interface HistoryFilters {
  clientId?: string | null;
  /** MM/YYYY */
  month?: string | null;
  /** 2026-27 */
  financialYear?: string | null;
  page?: HistoryPageKey | null;
  table?: string | null;
  actorId?: string | null;
  /** The person's name, for logs that keep only a name (Annual Return). */
  actorName?: string | null;
  /** YYYY-MM-DD, India time, inclusive */
  from?: string | null;
  to?: string | null;
}

const PARAMS: Array<[keyof HistoryFilters, string]> = [
  ['clientId', 'client'], ['month', 'month'], ['financialYear', 'fy'], ['page', 'page'], ['table', 'table'],
  ['actorId', 'user'], ['from', 'from'], ['to', 'to'],
];

export function filtersFromSearch(params: URLSearchParams): HistoryFilters {
  const f: HistoryFilters = {};
  for (const [k, p] of PARAMS) {
    const v = params.get(p);
    if (v) (f as Record<string, string>)[k] = v;
  }
  if (f.page && !HISTORY_PAGES.some((p) => p.key === f.page)) delete f.page;
  if (f.month && !/^(0[1-9]|1[0-2])\/\d{4}$/.test(f.month)) delete f.month;
  return f;
}

export function filtersToSearch(f: HistoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, p] of PARAMS) {
    const v = f[k];
    if (v) params.set(p, String(v));
  }
  return params;
}

/** The Change history page, filtered to one page's client and month. */
export function historyLink(page: HistoryPageKey, clientId?: string | null, month?: string | null): string {
  return '/change-history?' + filtersToSearch({ page, clientId: clientId || null, month: month || null }).toString();
}

/** The twelve months of a financial year ("2026-27" -> 04/2026 ... 03/2027). */
export function monthsOfFinancialYear(fy: string): string[] {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  const start = Number(m[1]);
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((i + 3) % 12) + 1;
    const year = i < 9 ? start : start + 1;
    return `${String(month).padStart(2, '0')}/${year}`;
  });
}

/** The day after an ISO date (for an inclusive "to"). */
function nextDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** What a PostgREST filter value needs to be read as one value. */
function quoteValue(v: string): string {
  return /[,.():"\s]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

/** The query's builder as far as the history needs it (supabase-js's, or a stand-in in the check). */
export interface HistoryQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  eq(column: string, value: string): HistoryQuery;
  in(column: string, values: string[]): HistoryQuery;
  gte(column: string, value: string): HistoryQuery;
  lt(column: string, value: string): HistoryQuery;
  or(filters: string): HistoryQuery;
  order(column: string, options: { ascending: boolean }): HistoryQuery;
  range(from: number, to: number): HistoryQuery;
}
export interface HistorySource {
  from(view: 'gst_change_history'): { select(columns: string): HistoryQuery };
}

export function applyHistoryFilters(q: HistoryQuery, f: HistoryFilters): HistoryQuery {
  let out = q;
  if (f.clientId) out = out.eq('client_id', f.clientId);
  if (f.month) out = out.eq('period_month', f.month);
  if (f.financialYear) {
    const months = monthsOfFinancialYear(f.financialYear);
    out = out.or(`financial_year.eq.${quoteValue(f.financialYear)}` + (months.length ? `,period_month.in.(${months.map(quoteValue).join(',')})` : ''));
  }
  if (f.table) out = out.eq('table_name', f.table);
  else if (f.page === 'builder') out = out.or('table_name.like.builder_*');
  else if (f.page) {
    const page = HISTORY_PAGES.find((p) => p.key === f.page);
    if (page) out = out.in('table_name', page.tables);
  }
  if (f.actorId) {
    out = f.actorName
      ? out.or(`actor_id.eq.${f.actorId},and(actor_id.is.null,actor_name.eq.${quoteValue(f.actorName)})`)
      : out.eq('actor_id', f.actorId);
  }
  // India time: a day runs from 00:00 +05:30.
  if (f.from) out = out.gte('at', `${f.from}T00:00:00+05:30`);
  if (f.to) out = out.lt('at', `${nextDay(f.to)}T00:00:00+05:30`);
  return out;
}

export const HISTORY_PAGE_SIZE = 200;

/** One page of history, newest first. */
export async function loadChangeHistory(source: HistorySource, f: HistoryFilters, page = 0, pageSize = HISTORY_PAGE_SIZE):
  Promise<{ rows: HistoryRow[]; hasMore: boolean }> {
  const q = applyHistoryFilters(source.from('gst_change_history').select(HISTORY_COLUMNS), f)
    .order('at', { ascending: false })
    .order('key', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as HistoryRow[];
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
export interface ExportContext {
  clientName: (id: string | null) => string;
  names?: Record<string, string>;
}

/** One sheet row per changed field (a change with no fields: one row). */
export function exportRows(rows: HistoryRow[], ctx: ExportContext): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const r of rows) {
    const view = describeChange(r, ctx.names ?? {});
    const base = {
      When: formatStamp(r.at),
      Who: whoLabel(r),
      'How recorded': [sourceLabel(r.actor_source), whoNote(r)].filter(Boolean).join(', '),
      Client: ctx.clientName(r.client_id),
      Month: r.period_month ? monthLabel(r.period_month) : (r.financial_year ? `FY ${r.financial_year}` : ''),
      Page: pageOfTable(r.table_name)?.label ?? '',
      Sheet: tableLabel(r.table_name),
      Row: r.row_label ?? '',
      Action: view.action,
    };
    const tail = { Note: view.note ?? '', Request: r.request_id ?? '' };
    if (!view.lines.length) out.push({ ...base, Field: '', Old: '', New: '', ...tail });
    for (const l of view.lines) out.push({ ...base, Field: l.label, Old: l.old, New: l.new, ...tail });
  }
  return out;
}
