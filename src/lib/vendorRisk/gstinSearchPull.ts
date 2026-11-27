// The Vendor GSTIN Risk report's Pull (extension 0.19.2, mode gstin_search):
// which supplier GSTINs of the client to look up on the portal's logged-in
// Search Taxpayer. docs/VENDOR_GSTIN_RISK.md, "Search Taxpayer lookup".
//
// The client's suppliers over the FY of the months picked come from every
// place the app holds them: the portal-pulled GSTR-2A / GSTR-2B
// (gst_filed_returns, every `ctin` in the summary), Import 2B's documents
// (twob_import_docs.supplier_gstin), the books register
// (books_register.supplier_gstin) and the vendor master uploaded on the report
// (vendor_master_entries.gstin). Only well-formed GSTINs with a good check
// character are asked (a mistyped one would only waste a portal request).
// Those with no usable lookup in the last 30 days (vendor_gstin_latest) go
// first; with none missing, all of them are looked up again (a refresh),
// the oldest first. At most MAX_PER_PULL per click; the next click takes the
// rest. Each lookup is one row of vendor_gstin_lookups, written by the
// extension. The plan says "needs extension 0.19.2" (and starts nothing) only
// when it is given an older extension's version.
import { supabase } from '@/integrations/supabase/client';
import type { PullJob, PullPlan } from '@/lib/reportRegistry';
import { fyMonthsForKey } from '@/utils/allClientsReports';
import { compareVersions } from '@/lib/extensionVersion';
import { checkGstin, normGstin } from '@/lib/vendorRisk/gstin';

/** The extension that runs Search Taxpayer lookups (mode gstin_search). */
export const GSTIN_SEARCH_VERSION = '0.19.2';
export const GSTIN_SEARCH_MODE = 'gstin_search';
/** A lookup newer than this counts as fresh. */
export const LOOKUP_FRESH_DAYS = 30;
/** GSTINs per Pull (0.19.2: each looked up on the portal's own Search Taxpayer page, about 10 to 15 seconds each). */
export const MAX_PER_PULL = 150;

const PAGE = 1000;

/** Every `ctin` (supplier GSTIN) anywhere in a pulled 2A / 2B summary. */
export const ctinsIn = (node: unknown, out: Set<string> = new Set(), depth = 0): Set<string> => {
  if (!node || typeof node !== 'object' || depth > 8) return out;
  if (Array.isArray(node)) { for (const x of node) ctinsIn(x, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'ctin' && typeof v === 'string') out.add(normGstin(v));
    else if (v && typeof v === 'object') ctinsIn(v, out, depth + 1);
  }
  return out;
};

/** All rows of a query, a page at a time (PostgREST caps one answer). */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error instanceof Error ? error : new Error((error as { message?: string })?.message || 'read failed');
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/** The client's supplier GSTINs over the months, valid ones only, and the client's own GSTIN left out. */
export async function supplierGstins(clientId: string, months: string[]): Promise<string[]> {
  const found = new Set<string>();
  const [own, filed, docs, books, master] = await Promise.all([
    supabase.from('clients').select('gstin').eq('id', clientId).maybeSingle(),
    allRows<{ summary: unknown }>((a, b) => supabase.from('gst_filed_returns').select('summary')
      .eq('client_id', clientId).in('return_type', ['GSTR2A', 'GSTR2B']).in('period_month', months).range(a, b)),
    allRows<{ supplier_gstin: string | null }>((a, b) => supabase.from('twob_import_docs').select('supplier_gstin')
      .eq('client_id', clientId).in('period_month', months).not('supplier_gstin', 'is', null).range(a, b)),
    allRows<{ supplier_gstin: string | null }>((a, b) => supabase.from('books_register').select('supplier_gstin')
      .eq('client_id', clientId).in('period_month', months).not('supplier_gstin', 'is', null).range(a, b)),
    allRows<{ gstin: string | null }>((a, b) => supabase.from('vendor_master_entries').select('gstin')
      .eq('client_id', clientId).range(a, b)),
  ]);
  for (const r of filed) ctinsIn(r.summary, found);
  for (const r of docs) if (r.supplier_gstin) found.add(normGstin(r.supplier_gstin));
  for (const r of books) if (r.supplier_gstin) found.add(normGstin(r.supplier_gstin));
  for (const r of master) if (r.gstin) found.add(normGstin(r.gstin));
  const self = normGstin(own.data?.gstin ?? '');
  return [...found].filter((g) => g && g !== self && checkGstin(g).valid).sort();
}

/** When each GSTIN was last looked up with an answer (ok / not_found). */
async function lastLookups(gstins: string[]): Promise<Map<string, string>> {
  const at = new Map<string, string>();
  for (let i = 0; i < gstins.length; i += 200) {
    const { data, error } = await supabase.from('vendor_gstin_latest').select('gstin, looked_up_at').in('gstin', gstins.slice(i, i + 200));
    if (error) throw error;
    for (const r of data || []) if (r.gstin && r.looked_up_at) at.set(r.gstin, r.looked_up_at);
  }
  return at;
}

const fyMonthsOf = (periods: string[]): string[] =>
  [...new Set(periods.filter((p) => /^\d{2}\/\d{4}$/.test(p)).flatMap((p) => fyMonthsForKey(p).months))];

/**
 * The Pull plan. `extVersion` is what ReportsPage passes every plan (the
 * installed extension's version, null when it did not say); a caller that
 * leaves it out is not gated.
 */
export const planVendorGstinSearch = async (args: { clientId: string; periods: string[]; extVersion?: string | null }): Promise<PullPlan> => {
  // Only a 0.19.0+ extension knows the mode (an older one would run its ledger chain instead);
  // 0.19.2 is asked for: 0.19.0 / 0.19.1 asked guessed addresses the portal refuses.
  if (args.extVersion !== undefined && (!args.extVersion || compareVersions(args.extVersion, GSTIN_SEARCH_VERSION) < 0)) {
    return {
      jobs: [],
      note: `Looking up vendor GSTINs on the portal needs browser extension v${GSTIN_SEARCH_VERSION} or later`
        + `${args.extVersion ? ` (this one is v${args.extVersion})` : ''}. Reload it from the updated extension folder (chrome://extensions → Reload).`,
    };
  }
  const months = fyMonthsOf(args.periods);
  if (!months.length) return { jobs: [], note: 'Pick a month first: the suppliers are those of its financial year.' };
  const gstins = await supplierGstins(args.clientId, months);
  if (!gstins.length) {
    return { jobs: [], note: 'No supplier GSTIN found for this client in the year (GSTR-2A / 2B, Import 2B, the books register or a vendor master). Pull the 2A / 2B or upload a vendor master first.' };
  }
  const last = await lastLookups(gstins);
  const cutoff = Date.now() - LOOKUP_FRESH_DAYS * 24 * 60 * 60 * 1000;
  const stale = gstins.filter((g) => { const t = last.get(g); return !t || Date.parse(t) < cutoff; });
  // Never looked up first, then the oldest lookup first.
  const age = (g: string) => (last.has(g) ? Date.parse(last.get(g)!) : 0);
  const refresh = !stale.length;
  const queue = (refresh ? gstins : stale).slice().sort((a, b) => age(a) - age(b) || a.localeCompare(b));
  const batch = queue.slice(0, MAX_PER_PULL);
  const more = queue.length - batch.length;
  const job: PullJob = {
    mode: GSTIN_SEARCH_MODE,
    // The FY's first month: the extension reads the FY from it (the filing table's ask by FY).
    periods: months.slice(0, 1),
    gstins: batch,
    label: `the GST registration of ${batch.length} supplier GSTIN${batch.length === 1 ? '' : 's'} (Search Taxpayer)`,
  };
  const notes: string[] = [];
  if (refresh) notes.push(`Every supplier GSTIN was looked up in the last ${LOOKUP_FRESH_DAYS} days; looking them up again.`);
  if (more > 0) notes.push(`${more} more GSTIN${more === 1 ? '' : 's'} left for the next Pull (at most ${MAX_PER_PULL} a Pull).`);
  return { jobs: [job], ...(notes.length ? { note: notes.join(' ') } : {}) };
};
