// The Autopilot page's status line: only what needs someone (autopilot paused,
// the runner offline, CAPTCHAs waiting, clients failed today); nothing on a
// normal day (the firm's request of 9 October 2026).
import React from 'react';
import {
  autopilotState, chromeRunners, latestAgent, pausedUntilWords, autopilotQueueHref, runnerMode, type AutopilotStatus,
} from '@/lib/autopilot';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { ProblemLine } from '@/components/notices/ui/ProblemLine';

/** "Scheduled Chrome online · Reception PC, seen 20 s ago" and the dot's colour. */
function chromeWords(s: AutopilotStatus): { text: string; detail: string | null; ok: boolean } {
  const runners = chromeRunners(s);
  const online = runners.filter((r) => r.online);
  if (online.length > 1) return { text: `${online.length} scheduled Chromes online`, detail: online.map((r) => r.label || 'Chrome').join(', '), ok: true };
  if (online.length === 1) return { text: 'Scheduled Chrome online', detail: `${online[0].label || 'Chrome'}, seen ${fmtAgo(online[0].last_seen)}`, ok: true };
  if (runners.length) return { text: 'Scheduled Chrome offline', detail: `${runners[0].label || 'Chrome'}, last seen ${fmtAgo(runners[0].last_seen)}`, ok: false };
  return { text: 'No scheduled Chrome has reported yet', detail: null, ok: false };
}

export const AutopilotStatusLine: React.FC<{ s: AutopilotStatus | undefined }> = ({ s }) => {
  if (!s) return null;
  const state = autopilotState(s.settings);
  const chrome = runnerMode(s) === 'chrome';
  const c = chrome ? chromeWords(s) : null;
  const waiting = s.queue.waiting_captcha + s.queue.needs_human;
  return (
    <ProblemLine problems={[
      state === 'paused' && { key: 'paused', text: `Autopilot is paused ${pausedUntilWords(s.settings?.paused_until)}` },
      state === 'on' && chrome && c && !c.ok && { key: 'runner', text: c.detail ? `${c.text} (${c.detail})` : c.text, to: '/notices-autopilot?tab=settings' },
      state === 'on' && !chrome && !s.agent_online && { key: 'agent', text: latestAgent(s) ? 'The office agent is offline' : 'No office agent has reported yet', to: '/notices-autopilot?tab=settings' },
      !chrome && waiting > 0 && { key: 'captcha', text: `${plural(waiting, 'client')} waiting for a CAPTCHA`, to: autopilotQueueHref('captcha') },
      s.today.failed > 0 && { key: 'failed', text: `${plural(s.today.failed, 'client')} failed today`, to: autopilotQueueHref('failed') },
    ]} />
  );
};

export default AutopilotStatusLine;
