// Evidence without a click (docs/REPLY_FACTORY_POSITIONS.md §6): when staff open the
// notices module, a short batch of the target notices nobody has built evidence for
// (open ASMT-10, DRC-01A, DRC-01B, DRC-01C, soonest due first; reply_evidence_pending)
// is built in the background and saved as Auto. While the autopilot is on, the portal
// pulls a working is missing are queued for it at the same time (origin 'evidence'), so
// the next build has the data. At most once every three hours per browser, one notice
// at a time, after the page has loaded its own data.
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { mergePlans, queueMissing, saveCards } from './build';
import { loadEvidence } from './load';

const LAST_RUN_KEY = 'gstk.autoEvidence.lastRun';
const EVERY_MS = 3 * 60 * 60 * 1000;
const BATCH = 15;
const START_AFTER_MS = 5000;

function lastRun(): number {
  try { return Number(window.localStorage.getItem(LAST_RUN_KEY) || 0) || 0; } catch { return 0; }
}

function markRun(at: number) {
  try { window.localStorage.setItem(LAST_RUN_KEY, String(at)); } catch { /* storage blocked: runs again next time */ }
}

async function autopilotOn(): Promise<boolean> {
  const { data } = await supabase.from('autopilot_settings').select('enabled, paused_until').maybeSingle();
  return !!data?.enabled && !(data.paused_until && new Date(data.paused_until) > new Date());
}

/** Builds the pending notices' evidence (Auto) and, with the autopilot on, queues what they miss. Returns how many were built. */
export async function buildPendingEvidence(limit = BATCH): Promise<number> {
  const { data, error } = await supabase.rpc('reply_evidence_pending', { p_limit: limit });
  if (error || !data?.length) return 0;
  const fetchMissing = await autopilotOn().catch(() => false);
  let built = 0;
  for (const row of data) {
    try {
      const b = await loadEvidence(row.notice_id);
      await saveCards(b.cards, b.saved, { auto: true });
      built += 1;
      if (fetchMissing) {
        const plan = mergePlans(b.cards.map((c) => c.result.readiness.plan));
        if (plan.length) await queueMissing(row.client_id, plan, null);
      }
    } catch { /* one notice failing never stops the batch; the Reply Factory lists what is still missing */ }
  }
  return built;
}

/** Starts the background batch once per window; a page change before it starts cancels it. */
export function useAutoEvidence(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Date.now() - lastRun() < EVERY_MS) return;
    const timer = window.setTimeout(() => {
      markRun(Date.now());
      buildPendingEvidence().catch(() => { /* see above */ });
    }, START_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [enabled]);
}
