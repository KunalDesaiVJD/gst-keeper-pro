/**
 * Data access for the builder → GSTR-1 bridge.
 *
 * The generated return is written to the same `gstr1_data` row a JSON import
 * would have produced, so GSTR-1 stays the single place a return is viewed,
 * checked and pushed to the portal. For a builder client this is the only way
 * that row gets written — the import path is closed off.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  buildBuilderGstr1, isBuilderGenerated, type BuilderGstr1Result, type Gstr1PostingRow,
} from '@/utils/builderGstr1';

/** `gstr1_data.period_month` is the short label ("Jun-26"); MonthContext is "MM/YYYY". */
const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const mmYyyyToShort = (mmYyyy: string): string => {
  if (!mmYyyy) return '';
  const [mm, yyyy] = mmYyyy.split('/').map(Number);
  if (!mm || !yyyy) return '';
  return `${MONTH_SHORT_NAMES[mm - 1]}-${String(yyyy).slice(-2)}`;
};

export interface Gstr1Status {
  id: string;
  fileName: string | null;
  importedAt: string | null;
  /** True when the stored row came from Builder Returns rather than an upload. */
  fromBuilder: boolean;
  lastPushedAt?: string | null;
  lastPushStatus?: string | null;
}

/** Postings for one client-period, optionally narrowed to a single project. */
export async function fetchBuilderPostings(
  clientId: string,
  period: string,
  projectId?: string,
): Promise<Gstr1PostingRow[]> {
  let q = supabase
    .from('builder_period_postings')
    .select('source_type, gstr1_table, rate_code, rate_pct, taxable_value, cgst, sgst, original_period, doc_no, land_deduction')
    .eq('client_id', clientId)
    .eq('period_month', period);
  if (projectId && projectId !== 'ALL') q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as unknown as Gstr1PostingRow[];
}

/** What is already stored in GSTR-1 for this client-period, if anything. */
export async function fetchGstr1Status(
  clientId: string,
  period: string,
): Promise<Gstr1Status | null> {
  const { data, error } = await supabase
    .from('gstr1_data')
    .select('id, file_name, imported_at')
    .eq('client_id', clientId)
    .eq('period_month', mmYyyyToShort(period))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; file_name: string | null; imported_at: string | null };
  return {
    id: row.id,
    fileName: row.file_name,
    importedAt: row.imported_at,
    fromBuilder: isBuilderGenerated(row.file_name),
  };
}

/**
 * Build the return for a period without writing it. Used for the preview, so
 * what the employee approves is exactly what gets saved.
 */
export async function previewBuilderGstr1(params: {
  clientId: string;
  gstin: string | null;
  period: string;
  projectId?: string;
}): Promise<BuilderGstr1Result & { postings: Gstr1PostingRow[] }> {
  const postings = await fetchBuilderPostings(params.clientId, params.period, params.projectId);
  const built = buildBuilderGstr1({ gstin: params.gstin, period: params.period, postings });
  return { ...built, postings };
}

/**
 * Write the generated return into `gstr1_data`.
 *
 * Always generated from the full client — never a single project. A GSTR-1 is
 * filed per GSTIN, so a project filter is a way to read the workpaper, not a
 * way to file part of a return; scoping the saved return to one project would
 * silently understate it.
 */
export async function saveBuilderGstr1(params: {
  clientId: string;
  gstin: string | null;
  period: string;
  userId: string | null;
}): Promise<{ result: BuilderGstr1Result; blocked: Gstr1Warning[] }> {
  const postings = await fetchBuilderPostings(params.clientId, params.period);
  const result = buildBuilderGstr1({
    gstin: params.gstin, period: params.period, postings,
  });

  const blocked = result.warnings.filter((w) => w.severity === 'BLOCK');
  if (blocked.length) return { result, blocked };

  const { data, error } = await supabase
    .from('gstr1_data')
    .upsert({
      client_id: params.clientId,
      period_month: mmYyyyToShort(params.period),
      // The generated document is a plain JSON tree; the generated DB types
      // model the column as a `Json` union that a Record<string, unknown>
      // cannot be proved to satisfy structurally.
      raw_json: result.json as never,
      file_name: `Builder Returns — ${params.period}`,
      imported_by: params.userId,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,period_month' })
    .select('id');

  if (error) throw error;
  // A silent RLS or constraint drop returns no row. Surface that rather than
  // reporting a generated return that was never stored.
  if (!data || data.length === 0) {
    throw new Error('Write was rejected by the database (no row returned).');
  }
  return { result, blocked: [] };
}

type Gstr1Warning = BuilderGstr1Result['warnings'][number];
