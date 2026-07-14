import React, { useCallback, useEffect, useState } from 'react';
import { PortalCaptchaDialog } from './PortalCaptchaDialog';
import { getPendingCaptchaJob, submitCaptcha, cancelPortalJob, PortalJob } from '@/lib/portalJobs';

// Global CAPTCHA surface. Mounted once (in MainLayout), it polls for ANY portal
// job parked as needs_human/captcha — single-button or bulk — and shows the
// dialog so office staff can type it once. Session reuse keeps this rare.
export const PortalCaptchaWatcher: React.FC = () => {
  const [job, setJob] = useState<PortalJob | null>(null);

  const poll = useCallback(async () => {
    try { setJob(await getPendingCaptchaJob()); } catch { /* portal_jobs may not exist until migration applied */ }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 3500);
    return () => clearInterval(t);
  }, [poll]);

  return (
    <PortalCaptchaDialog
      open={!!job}
      image={job?.human_prompt?.image}
      onSubmit={async (text) => { if (job) { await submitCaptcha(job.id, text); setJob(null); } }}
      onCancel={async () => { if (job) { await cancelPortalJob(job.id); setJob(null); } }}
    />
  );
};
