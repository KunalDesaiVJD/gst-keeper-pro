import { supabase } from '@/integrations/supabase/client';
import { compareVersions } from '@/lib/extensionVersion';

// Where a Suspended Reco / GST Receivable Reco opening comes from (the firm's
// decisions of 21 Oct 2026, migration 20261021120000):
//  - from the Jun-2026 period it comes only from the browser extension's
//    pull (reco_record_pull), for every client, Nil returns included;
//  - the CSV upload and Not Applicable need a manual entry the superadmin
//    allowed for that client and month (manual_source_allowances, scope
//    'reco:suspended' / 'reco:receivable'); reco_manual_opening uses it once;
//  - an override of the opening is the superadmin's or a GST Manager's;
//  - Save writes only what staff type (books closing, the portal_* snapshot).
// The database refuses anything else (reco_source_guard). Before 06/2026
// nothing changes. docs/2B_RECONCILIATION_FLOW.md §13.

export type OpeningSource = 'manual' | 'csv' | 'not_applicable' | 'portal';
export type RecoKind = 'suspended' | 'receivable';

/** YYYYMM of the first period whose opening comes only from the pull. */
export const RECO_PULL_FROM = 202606;
/** The first extension that pulls through reco_record_pull and asks the GSTR-3B gate. */
export const RECO_PULL_EXTENSION = '0.16.0';

export const recoScope = (kind: RecoKind) => `reco:${kind}` as const;

export function periodKey(periodMonth: string | null | undefined): number {
  const [mm, yyyy] = String(periodMonth || '').split('/').map(Number);
  return mm && yyyy ? yyyy * 100 + mm : 0;
}

/** From 06/2026 the opening comes only from the pull (or an allowed manual entry). */
export const isPullOnlyPeriod = (periodMonth: string | null | undefined) => periodKey(periodMonth) >= RECO_PULL_FROM;

/** Whether this extension version pulls the way the database accepts. */
export const extensionCanPull = (version: string | null | undefined) =>
  !!version && compareVersions(version, RECO_PULL_EXTENSION) >= 0;

export const needsExtensionMessage = (version: string | null | undefined) =>
  `The browser extension${version ? ` (v${version})` : ''} must be v${RECO_PULL_EXTENSION} or later. Reload it from the updated extension folder (chrome://extensions → Reload).`;

interface SuspendedSaveState {
  clientId: string;
  periodMonth: string;
  userId: string | null | undefined;
  opening: { cgst: number; sgst: number; igst: number };
  portal: { cgst: number; sgst: number; igst: number };
}

/**
 * The Suspended Reco Save. From 06/2026 it carries only the portal_* snapshot
 * (the page's own "current total"): the opening, its source and the override
 * are the pull's, the allowed manual entry's or the override's to write.
 * Before 06/2026 the opening is typed, as before.
 */
export function suspendedSavePayload(s: SuspendedSaveState): Record<string, unknown> {
  const base = {
    client_id: s.clientId,
    period_month: s.periodMonth,
    portal_cgst: s.portal.cgst,
    portal_sgst: s.portal.sgst,
    portal_igst: s.portal.igst,
    updated_by: s.userId ?? null,
    updated_at: new Date().toISOString(),
  };
  if (isPullOnlyPeriod(s.periodMonth)) return base;
  return { ...base, opening_cgst: s.opening.cgst, opening_sgst: s.opening.sgst, opening_igst: s.opening.igst };
}

interface ReceivableSaveState {
  clientId: string;
  periodMonth: string;
  userId: string | null | undefined;
  booksClosing: { cgst: number; sgst: number; igst: number };
}

/** The GST Receivable Reco Save: the typed books closing only (the page exists from 06/2026). */
export function receivableSavePayload(s: ReceivableSaveState): Record<string, unknown> {
  return {
    client_id: s.clientId,
    period_month: s.periodMonth,
    books_closing_cgst: s.booksClosing.cgst,
    books_closing_sgst: s.booksClosing.sgst,
    books_closing_igst: s.booksClosing.igst,
    updated_by: s.userId ?? null,
    updated_at: new Date().toISOString(),
  };
}

type Heads = { igst: number; cgst: number; sgst: number };

/** An allowed manual entry: the CSV upload or Not Applicable. Uses the allowance once. */
export async function recordManualOpening(args: {
  actorId: string;
  kind: RecoKind;
  clientId: string;
  periodMonth: string;
  source: 'csv' | 'not_applicable';
  opening: Heads;
  utilised?: Heads | null;
  drc?: Heads | null;
  csvPeriod?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('reco_manual_opening', {
    p_actor_id: args.actorId,
    p_reco: args.kind,
    p_client_id: args.clientId,
    p_period: args.periodMonth,
    p_source: args.source,
    p_opening: args.opening,
    p_utilised: args.utilised ?? null,
    p_drc: args.drc ?? null,
    p_csv_period: args.csvPeriod ?? null,
  });
  if (error) throw error;
}

export interface RecoLogEntry {
  id: string;
  action: string;
  source: string | null;
  actor_id: string | null;
  reason: string | null;
  logged_at: string;
}

/** The latest changes to a reco's portal side (pull, manual entry, override, delete). */
export async function fetchRecoLog(kind: RecoKind, clientId: string, periodMonth: string, limit = 8): Promise<RecoLogEntry[]> {
  const { data, error } = await supabase.from('reco_opening_log')
    .select('id, action, source, actor_id, reason, logged_at')
    .eq('reco', kind).eq('client_id', clientId).eq('period_month', periodMonth)
    .order('logged_at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as RecoLogEntry[];
}

const ACTION_WORDS: Record<string, string> = {
  pull: 'Pulled from portal',
  manual: 'Manual entry (allowed)',
  override: 'Opening overridden',
  insert: 'Row created',
  save: 'Saved',
  delete: 'Cleared',
};
export const recoLogActionLabel = (a: string) => ACTION_WORDS[a] || a;

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

/** "Pulled from portal 21 Oct 2026 by Asha" */
export const pulledLabel = (at: string | null | undefined, byName: string | null | undefined) =>
  `Pulled from portal ${fmtDate(at)}${byName ? ` by ${byName}` : ''}`;
