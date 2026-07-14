import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { usePortalJob } from '@/hooks/usePortalJob';
import { JOB_LABELS, PortalJob, PortalJobType } from '@/lib/portalJobs';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued…',
  claimed: 'Starting…',
  running: 'Working…',
  needs_human: 'Needs CAPTCHA…',
};

// One-click button that enqueues a portal job for the local Agent, shows live
// status, and pops the CAPTCHA dialog when the Agent needs it.
export const PortalActionButton: React.FC<{
  clientId: string;
  jobType: PortalJobType;
  periodMonth?: string | null;
  mode?: 'live' | 'shadow';
  payload?: any;
  label?: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  size?: 'default' | 'sm';
  className?: string;
  disabled?: boolean;
  onDone?: (job: PortalJob) => void;
}> = ({ clientId, jobType, periodMonth, mode, payload, label, icon, variant = 'outline', size = 'default', className, disabled, onDone }) => {
  const { job, busy, run } = usePortalJob(onDone);

  const text = busy && job ? (STATUS_LABEL[job.status] ?? 'Working…') : (label ?? JOB_LABELS[jobType]);

  // CAPTCHA (needs_human) is handled globally by PortalCaptchaWatcher in MainLayout.
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || busy || !clientId}
      onClick={() => run({ clientId, jobType, periodMonth, mode, payload })}
    >
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : icon}
      {text}
    </Button>
  );
};
