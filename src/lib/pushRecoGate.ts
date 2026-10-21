import { computeSuspendedRecoDiff, type RecoDiffResult } from './suspendedRecoCalc';
import { computeGstReceivableRecoDiff } from './gstReceivableRecoCalc';

// The app's own reading of the GSTR-3B push check: the Suspended Reco and GST
// Receivable Reco differences must both be 0 before Push. Both read a filed
// month's recorded figures (twob_filed_figures, docs/2B_RECONCILIATION_FLOW.md
// §13), and a check that cannot be read blocks Push with its reason: the check
// fails closed (a missing table before the migration is applied, a network
// error), never open. Since the merge with 20261021120000 (§14) the GSTR-3B
// page, its JSON and the extension ask the database's gstr3b_push_gate, whose
// difference functions read the same recorded figures (parity:
// supabase/tests/reco_gate/parity.mjs); this stays the TypeScript mirror the
// prior-month tests (supabase/tests/twob_simple) run.
export interface PushRecoCheck {
  suspended: RecoDiffResult | null;
  receivable: RecoDiffResult | null;
  /** Why the checks could not run; Push stays blocked while it is set. */
  error: string | null;
}

export async function runPushRecoCheck(clientId: string, periodMonth: string): Promise<PushRecoCheck> {
  try {
    const [suspended, receivable] = await Promise.all([
      computeSuspendedRecoDiff(clientId, periodMonth),
      computeGstReceivableRecoDiff(clientId, periodMonth),
    ]);
    return { suspended, receivable, error: null };
  } catch (err) {
    return { suspended: null, receivable: null, error: (err as Error)?.message || 'unknown error' };
  }
}

/**
 * Which part of the check blocks Push. A NO-ITC promoter's Suspended Reco is
 * waived (docs §8); a check that could not run always blocks.
 */
export function pushRecoBlocks(check: PushRecoCheck, isNoItcBuilder: boolean): {
  suspendedBlocks: boolean; receivableBlocks: boolean; errorBlocks: boolean; blocks: boolean;
} {
  const suspendedBlocks = !isNoItcBuilder && !!check.suspended && check.suspended.total !== 0;
  const receivableBlocks = !!check.receivable && check.receivable.total !== 0;
  const errorBlocks = !!check.error;
  return { suspendedBlocks, receivableBlocks, errorBlocks, blocks: suspendedBlocks || receivableBlocks || errorBlocks };
}
