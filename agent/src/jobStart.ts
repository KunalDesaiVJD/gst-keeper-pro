// What the extension is asked to start for one portal job (startAgentJob).
// actorId is the person who queued it (portal_jobs.requested_by), so the
// extension names them on every row it writes for the change log
// (gst_change_log, migration 20261021150000); a scheduled job names no one.
import type { Job } from './worker.js';

export function agentJobStart(job: Pick<Job, 'id' | 'client_id' | 'payload' | 'run_id' | 'requested_by'>, mode: string, startUrl?: string) {
  return {
    clientId: job.client_id, mode, periods: job.payload?.periods || [], runId: job.run_id, jobId: job.id,
    startUrl, actorId: job.requested_by ?? null,
  };
}
