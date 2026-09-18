import { supabase } from '@/integrations/supabase/client';

// Records that this app successfully pushed a return's data to the GST portal,
// by moving its filing_status row to 'Pushed'.
//
// Goes through the mark_filing_pushed RPC rather than a direct update because a
// database trigger rejects every other route into that status — the whole point
// of 'Pushed' is that it can only be evidence of a system event, never
// something a person typed. See supabase/migrations/*_filing_status_pushed*.sql.
//
// 'Pushed' is NOT a filing. The portal still needs Confirm / Offset Liability /
// File and the authorised signatory's EVC or DSC. Nothing that gates on 'Filed'
// treats 'Pushed' as filed.

export type MarkFilingPushedOutcome =
  | { ok: true; status: 'Pushed' }
  | { ok: true; status: 'Filed' } // already filed — deliberately left alone
  | { ok: false; error: string };

export async function markFilingPushed(args: {
  clientId: string;
  /** The same return_type the calling page uses for its own filing_status row. */
  returnType: 'GSTR-1' | 'GSTR-3B';
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
