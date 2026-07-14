import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  enqueuePortalJob, getPortalJob, submitCaptcha, cancelPortalJob,
  PortalJob, PortalJobType, JOB_LABELS, TERMINAL_STATUSES,
} from '@/lib/portalJobs';

// If a job is never picked up in this long, assume the Agent isn't running.
const NO_AGENT_TIMEOUT_MS = 90_000;

export interface RunInput {
  clientId: string;
  jobType: PortalJobType;
  periodMonth?: string | null;
  mode?: 'live' | 'shadow';
  payload?: any;
}

// Enqueues one portal job and tracks it by polling. When the job needs a human
// (CAPTCHA), the caller renders PortalCaptchaDialog and calls submitCaptchaText.
export function usePortalJob(onDone?: (job: PortalJob) => void) {
  const { user } = useAuth();
  const [job, setJob] = useState<PortalJob | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef<number>(0);

  const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stop(), []);

  const run = useCallback(async (input: RunInput) => {
    if (!input.clientId) { toast.error('Select a client first.'); return; }
    setBusy(true);
    setJob(null);
    try {
      const j = await enqueuePortalJob({
        clientId: input.clientId, jobType: input.jobType, periodMonth: input.periodMonth ?? null,
        mode: input.mode ?? 'live', payload: input.payload ?? {}, requestedBy: user?.id,
      });
      setJob(j);
      startedRef.current = Date.now();
      stop();
      pollRef.current = setInterval(async () => {
        const cur = await getPortalJob(j.id);
        if (!cur) return;
        setJob(cur);

        if (TERMINAL_STATUSES.includes(cur.status)) {
          stop(); setBusy(false);
          const label = JOB_LABELS[cur.job_type] ?? cur.job_type;
          if (cur.status === 'succeeded') {
            const v = cur.verified;
            toast.success(`${label}: done${v === false ? ' — verify mismatch, please review' : v ? ' & verified' : ''}.`);
            onDone?.(cur);
          } else if (cur.status === 'failed') {
            toast.error(`${label} failed: ${cur.error || 'unknown error'}`);
          }
          return;
        }
        // Still queued long after enqueue → the Agent probably isn't running.
        if (cur.status === 'queued' && Date.now() - startedRef.current > NO_AGENT_TIMEOUT_MS) {
          stop(); setBusy(false);
          toast.error('No Portal Agent picked this up — is the agent running on your office machine?');
        }
      }, 2500);
    } catch (e: any) {
      setBusy(false);
      toast.error('Could not queue the job: ' + (e?.message || 'unknown'));
    }
  }, [user, onDone]);

  const submitCaptchaText = useCallback(async (text: string) => {
    if (!job) return;
    try { await submitCaptcha(job.id, text); }
    catch (e: any) { toast.error('Failed to submit CAPTCHA: ' + (e?.message || 'unknown')); }
  }, [job]);

  const cancel = useCallback(async () => {
    if (job) await cancelPortalJob(job.id).catch(() => {});
    stop(); setBusy(false); setJob(null);
  }, [job]);

  const needsCaptcha = job?.status === 'needs_human' && job?.human_prompt?.kind === 'captcha';

  return { job, busy, needsCaptcha, run, submitCaptchaText, cancel };
}
