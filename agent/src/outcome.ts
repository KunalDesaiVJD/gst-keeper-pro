// How a job went, from what the extension wrote to the run ledger
// (sync_run_items) for this run and client since the job started.
import type { Db } from './db.js';

interface Item { step: string; status: string; reason_class: string | null; message: string | null }

export interface Outcome {
  outcome: 'succeeded' | 'failed' | 'retry';
  reason: string | null;
  error: string | null;
  result: Record<string, unknown>;
  loggedIn: boolean;
}

// Failures worth another try later; a rejected password or a portal session
// for another GSTIN is not one of them.
const TRANSIENT = new Set(['portal_error', 'timeout', 'stalled', 'save_failed', 'other']);

export async function readOutcome(db: Db, job: { run_id: string | null; client_id: string; job_type: string }, sinceIso: string): Promise<Outcome> {
  const items: Item[] = job.run_id
    ? await db.get(`sync_run_items?run_id=eq.${job.run_id}&client_id=eq.${job.client_id}`
      + `&created_at=gte.${encodeURIComponent(sinceIso)}&select=step,status,reason_class,message&order=created_at`)
    : [];
  const steps: Record<string, string> = {};
  for (const i of items) steps[i.step] = i.status === 'failed' ? `failed: ${i.reason_class || 'other'}` : i.status;
  const result = { steps };

  const login = items.find((i) => i.step === 'login' && i.status === 'failed');
  if (login) {
    return { outcome: 'failed', reason: login.reason_class || 'login_failed', error: login.message, result, loggedIn: false };
  }
  if (job.job_type !== 'PULL_NOTICES_BUNDLE') {
    const failed = items.find((i) => i.status === 'failed');
    return failed
      ? { outcome: TRANSIENT.has(failed.reason_class || 'other') ? 'retry' : 'failed', reason: failed.reason_class, error: failed.message, result, loggedIn: true }
      : { outcome: 'succeeded', reason: null, error: null, result, loggedIn: true };
  }
  const notices = items.filter((i) => i.step === 'notices');
  if (notices.some((i) => i.status === 'ok' || i.status === 'held')) {
    return { outcome: 'succeeded', reason: null, error: null, result, loggedIn: true };
  }
  const failed = notices.find((i) => i.status === 'failed');
  if (failed) {
    const reason = failed.reason_class || 'other';
    return { outcome: TRANSIENT.has(reason) || reason === 'session_mismatch' ? 'retry' : 'failed', reason, error: failed.message, result, loggedIn: true };
  }
  return { outcome: 'retry', reason: 'agent_error', error: 'The sync ended without reading the notices.', result, loggedIn: true };
}
