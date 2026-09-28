// Data access for the Annual Return workspace. Every read/write of the
// workings goes through here; the components never call supabase directly.
//
// Portal reads are limited to rows the browser extension pulled from the GST
// portal itself — the as-filed GSTR-3B ('GSTR3B', 'MM/YYYY') and the GSTR-9
// system-computed JSON ('GSTR9_CALC', '03/YYYY'). The app's own GSTR-1 /
// GSTR-3B data is never read (docs/GSTR9_9C_WORKINGS.md §5).

import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { normalizeDocs } from './defaults';
import { gstr9Fp, periodsForFY } from './portalParser';
import { AnnualReturnDocs, DocKey, DOC_KEYS } from './types';

export type PeriodStatus = 'not_started' | 'in_progress' | 'locked';

export interface AnnualReturnPeriod {
  id: string;
  status: PeriodStatus;
  locked_at: string | null;
  locked_by: string | null;
  updated_at: string;
}

export interface LoadedWorkspace {
  docs: AnnualReturnDocs;
  versions: Record<DocKey, number>;
  updatedAt: Partial<Record<DocKey, string>>;
  updatedBy: Partial<Record<DocKey, string | null>>;
}

export class DocConflictError extends Error {
  constructor(public docKey: DocKey) {
    super(`"${docKey}" was changed by someone else.`);
    this.name = 'DocConflictError';
  }
}

export class YearLockedError extends Error {
  constructor() {
    super('This year is locked. Unlock it before editing.');
    this.name = 'YearLockedError';
  }
}

export async function loadWorkspace(clientId: string, financialYear: string): Promise<LoadedWorkspace> {
  const { data, error } = await supabase
    .from('annual_return_docs')
    .select('doc_key, data, version, updated_at, updated_by')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear);
  if (error) throw error;
  const stored: Partial<Record<DocKey, unknown>> = {};
  const versions = Object.fromEntries(DOC_KEYS.map((k) => [k, 0])) as Record<DocKey, number>;
  const updatedAt: Partial<Record<DocKey, string>> = {};
  const updatedBy: Partial<Record<DocKey, string | null>> = {};
  (data || []).forEach((r) => {
    const k = r.doc_key as DocKey;
    if (!DOC_KEYS.includes(k)) return;
    stored[k] = r.data;
    versions[k] = r.version;
    updatedAt[k] = r.updated_at;
    updatedBy[k] = r.updated_by;
  });
  return { docs: normalizeDocs(stored), versions, updatedAt, updatedBy };
}

/** Version-checked save. Returns the new version. */
export async function saveDoc<K extends DocKey>(
  clientId: string,
  financialYear: string,
  key: K,
  data: AnnualReturnDocs[K],
  expectedVersion: number,
  updatedBy: string,
): Promise<number> {
  const { data: version, error } = await supabase.rpc('save_annual_return_doc', {
    p_client_id: clientId,
    p_financial_year: financialYear,
    p_doc_key: key,
    p_data: data as unknown as Json,
    p_expected_version: expectedVersion,
    p_updated_by: updatedBy,
  });
  if (error) {
    if (error.message?.includes('ANNUAL_RETURN_VERSION_CONFLICT')) throw new DocConflictError(key);
    if (error.message?.includes('ANNUAL_RETURN_LOCKED')) throw new YearLockedError();
    throw error;
  }
  return Number(version);
}

export async function loadPeriod(clientId: string, financialYear: string): Promise<AnnualReturnPeriod | null> {
  const { data, error } = await supabase
    .from('annual_return_periods')
    .select('id, status, locked_at, locked_by, updated_at')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .maybeSingle();
  if (error) throw error;
  return (data as AnnualReturnPeriod) || null;
}

export async function setPeriodStatus(clientId: string, financialYear: string, status: PeriodStatus, by: string): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    client_id: clientId,
    financial_year: financialYear,
    status,
    updated_at: now,
    locked_at: status === 'locked' ? now : null,
    locked_by: status === 'locked' ? by : null,
  };
  const { error } = await supabase.from('annual_return_periods').upsert(payload, { onConflict: 'client_id,financial_year' });
  if (error) throw error;
}

export interface AsFiledReturn {
  period: string; // "MM/YYYY"
  status: string | null;
  arn: string | null;
  filedDate: string | null;
  summary: unknown;
  updatedAt: string | null;
}

/** As-filed GSTR-3B the extension pulled from the portal, for the FY's 12 months. */
export async function loadAsFiledGstr3b(clientId: string, financialYear: string): Promise<AsFiledReturn[]> {
  const periods = periodsForFY(financialYear);
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, status, arn, filed_date, summary, updated_at')
    .eq('client_id', clientId)
    .eq('return_type', 'GSTR3B')
    .in('period_month', periods);
  if (error) throw error;
  return (data || []).map((r) => ({
    period: r.period_month,
    status: r.status,
    arn: r.arn,
    filedDate: r.filed_date,
    summary: r.summary,
    updatedAt: r.updated_at,
  }));
}

/** GSTR-9 system-computed JSON the extension's gstr9_pull saved (return_type GSTR9_CALC). */
export async function loadGstr9Calc(clientId: string, financialYear: string): Promise<AsFiledReturn | null> {
  const fp = gstr9Fp(financialYear);
  const period = `${fp.slice(0, 2)}/${fp.slice(2)}`;
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, status, arn, filed_date, summary, updated_at')
    .eq('client_id', clientId)
    .eq('return_type', 'GSTR9_CALC')
    .eq('period_month', period)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { period: data.period_month, status: data.status, arn: data.arn, filedDate: data.filed_date, summary: data.summary, updatedAt: data.updated_at };
}

/** Keep an uploaded GSTR-9 JSON as the raw portal copy, same place the extension writes it. */
export async function saveUploadedGstr9Calc(clientId: string, financialYear: string, raw: unknown): Promise<void> {
  const fp = gstr9Fp(financialYear);
  const { error } = await supabase.from('gst_filed_returns').upsert(
    {
      client_id: clientId,
      period_month: `${fp.slice(0, 2)}/${fp.slice(2)}`,
      return_type: 'GSTR9_CALC',
      status: 'Uploaded',
      summary: raw as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,period_month,return_type' },
  );
  if (error) throw error;
}

export interface DocHistoryEntry {
  id: string;
  docKey: DocKey;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  data: unknown;
}

export async function loadDocHistory(clientId: string, financialYear: string, key: DocKey): Promise<DocHistoryEntry[]> {
  const { data, error } = await supabase
    .from('annual_return_doc_history')
    .select('id, doc_key, version, updated_by, updated_at, data')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .eq('doc_key', key)
    .order('archived_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, docKey: r.doc_key as DocKey, version: r.version, updatedBy: r.updated_by, updatedAt: r.updated_at, data: r.data }));
}

/** Previous FY's saved docs (for carry-forward prefill: Annexure-4, prior-year 8C / Table 14). */
export async function loadPreviousYear(clientId: string, financialYear: string): Promise<LoadedWorkspace | null> {
  const start = Number(financialYear.slice(0, 4)) - 1;
  const prev = `${start}-${String(start + 1).slice(-2)}`;
  const ws = await loadWorkspace(clientId, prev);
  return Object.values(ws.versions).some((v) => v > 0) ? ws : null;
}
