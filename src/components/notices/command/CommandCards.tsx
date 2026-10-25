// Home's one line on portal sync: only a problem (clients not synced, the last
// run failed), nothing on a normal day. The command centre's other cards gave
// way to Home's attention tiles and My work (the UX audit of 25 October 2026).
import React from 'react';
import { ProblemLine } from '@/components/notices/ui/ProblemLine';
import { reasonLabel } from '@/lib/autopilot';
import type { CommandCentre } from '@/lib/noticeCommandCentre';
import { fmtAgo, plural } from '@/lib/noticeFormat';

const SHORT_REASON: Record<string, string> = {
  agent_offline: 'Chrome offline', login_failed: 'login failed', captcha_failed: 'CAPTCHA', captcha_timeout: 'CAPTCHA not typed',
  not_reached: 'not reached', portal_error: 'portal error', stalled: 'stalled', session_mismatch: 'wrong GSTIN',
};

/** Under the home page's title: one short line, only when clients are not synced or the last run failed. */
export const AutopilotLine: React.FC<{ cc: CommandCentre; onOpenTypes?: () => void }> = ({ cc }) => {
  const run = cc.health.last_run;
  const reasons = Object.entries(cc.health.failing).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = reasons.reduce((s, [, n]) => s + n, 0);
  return (
    <ProblemLine problems={[
      total > 0 && {
        key: 'failing',
        text: `${plural(total, 'client')} not synced (${reasons.map(([r, n]) => `${n} ${SHORT_REASON[r] ?? reasonLabel(r).toLowerCase()}`).join(' · ')})`,
        to: '/notices-portal-sync?status=failed',
      },
      run && run.status === 'failed' && { key: 'run', text: `Last sync run failed ${fmtAgo(run.started_at)}`, to: '/notices-portal-sync?tab=log' },
    ]} />
  );
};
