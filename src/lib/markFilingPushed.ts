import { supabase } from '@/integrations/supabase/client';

// Records that this app successfully pushed a return's data to the GST portal,
// by moving its filing_status row to 'Pushed'.
//
// Goes through the mark_filing_pushed RPC rather than a direct update because a
// database trigger rejects every other route into that status — the whole point
// of 'Pushed' is that it can only be evidence of a system event, never
// something a person typed. See supabase/migrations/*_filing_status_pushed*.sql.
//
// The server resolves the row (20261009200000_push_recording_all_returns): it
// stamps every row of the return's family (GSTR-1 + GSTR-1 (IFF), GSTR-3B +
// GSTR-3B (Q)) and makes sure the row Filing Status shows for that client and
// period exists, so an IFF / quarterly client's push lands on its 'GSTR-1
// (IFF)' / 'GSTR-3B (Q)' row. Callers pass the plain type. Most pushes are
// recorded without this call now: a GSTR-1 JSON upload by the gstr1_data
// trigger, a GSTR-3B push by the trigger on gstr3b_push_versions; what is left
// is a NIL push from an extension that does not record it itself (0.8.4).
//
// 'Pushed' is NOT a filing. The portal still needs Confirm / Offset Liability /
// File and the authorised signatory's EVC or DSC. Nothing that gates on 'Filed'
// treats 'Pushed' as filed.

/** The GSTR-1 and GSTR-3B family: the plain rows and the IFF / quarterly ones. */
export type FilingPushReturnType = 'GSTR-1' | 'GSTR-1 (IFF)' | 'GSTR-3B' | 'GSTR-3B (Q)';

export type MarkFilingPushedOutcome =
  | { ok: true; status: 'Pushed' }
  | { ok: true; status: 'Filed' } // already filed — deliberately left alone
  | { ok: false; error: string };

export async function markFilingPushed(args: {
  clientId: string;
  /** Any member of the family; the server picks the row Filing Status shows. */
  returnType: FilingPushReturnType;
  /** MM/YYYY, as filing_status.period_month stores it everywhere. */
  periodMonth: string;
  actorId?: string | null;
}): Promise<MarkFilingPushedOutcome> {
  const { clientId, returnType, periodMonth, actorId } = args;
  if (!clientId || !periodMonth) {
    return { ok: false, error: 'Missing client or period.' };
  }

  const { data, error } = await supabase.rpc('mark_filing_pushed', {
    p_client_id: clientId,
    p_return_type: returnType,
    p_period_month: periodMonth,
    p_actor: actorId ?? null,
  });

  if (error) return { ok: false, error: error.message };

  // The RPC returns the status the row ended up at, so a return already marked
  // Filed is reported back rather than silently swallowed.
  return data === 'Filed'
    ? { ok: true, status: 'Filed' }
    : { ok: true, status: 'Pushed' };
}

const FAMILY: readonly string[] = ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)'];

/**
 * The filing_status row Filing Status shows for this client and period:
 * 'GSTR-1 (IFF)' / 'GSTR-3B (Q)' for an IFF (QRMP) client, else the plain
 * type (filing_effective_return_type, which mirrors generateFilingRecords).
 * The GSTR-1 and GSTR-3B pages read and write that row, so their status and
 * NIL tick are the ones Filing Status shows. Falls back to `base` when the
 * function is missing or errs; never throws.
 */
export async function effectiveFilingReturnType(
  clientId: string,
  base: 'GSTR-1' | 'GSTR-3B',
  periodMonth: string,
): Promise<FilingPushReturnType> {
  if (!clientId || !periodMonth) return base;
  try {
    const { data, error } = await supabase.rpc('filing_effective_return_type', {
      p_client_id: clientId,
      p_base: base,
      p_period_month: periodMonth,
    });
    if (error || typeof data !== 'string' || !FAMILY.includes(data)) return base;
    // Never across families: a GSTR-1 question gets a GSTR-1 row.
    return data.startsWith(base) ? (data as FilingPushReturnType) : base;
  } catch {
    return base;
  }
}
