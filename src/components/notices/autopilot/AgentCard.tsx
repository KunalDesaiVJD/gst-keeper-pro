// The office agent as its heartbeat reports it (roadmap Phase 3; audit S-23:
// the agent is visible in the app, not orphaned): which PC, which versions,
// since when, and what each of its browsers is doing. Every field is optional.
import React from 'react';
import { SectionCard } from '@/components/gstr9/ui';
import { fmtWhen, workerWords, type AutopilotStatus } from '@/lib/autopilot';
import { fmtAgo } from '@/lib/noticeFormat';
import { ToneBadge } from './parts';

export const AgentCard: React.FC<{ status: AutopilotStatus | undefined }> = ({ status }) => {
  const agents = status?.agents ?? [];
  return (
    <SectionCard title="Office agent" description="The PC that logs in to the portal for the autopilot, as it last reported">
      {agents.length === 0 ? (
        <p className="text-xs text-muted-foreground">No office agent has reported yet. It is installed on the office PC from the agent folder (agent/README.md).</p>
      ) : (
        <ul className="divide-y">
          {agents.map((a) => {
            const i = a.info ?? {};
            return (
              <li key={a.agent_id} className="space-y-1 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.agent_id}</span>
                  {i.host && <span className="text-muted-foreground">on {i.host}</span>}
                  <ToneBadge tone={a.online ? 'success' : 'warning'}>{a.online ? 'Online' : 'Offline'}</ToneBadge>
                </div>
                <p className="text-muted-foreground">
                  {[
                    `${a.online ? 'seen' : 'last seen'} ${fmtAgo(a.last_seen)}`,
                    i.version && `agent v${i.version}`,
                    i.ext_version && `extension v${i.ext_version}`,
                    i.started_at && `running since ${fmtWhen(i.started_at)}`,
                    i.headful !== undefined && (i.headful ? 'browsers shown on screen' : 'browsers in the background'),
                  ].filter(Boolean).join(' · ')}
                </p>
                {a.online && (i.workers ?? []).length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {(i.workers ?? []).map((w, n) => <li key={w.n ?? n}>Browser {w.n ?? n + 1}: {workerWords(w)}{w.since ? ` (since ${fmtWhen(w.since)})` : ''}</li>)}
                  </ul>
                )}
                {i.inbox?.address && (
                  <p className="text-muted-foreground">
                    Portal e-mails: reads {i.inbox.address}{i.inbox.last_poll_at ? `, last ${fmtAgo(i.inbox.last_poll_at)}` : ''}
                    {i.inbox.error && <span className="font-medium text-destructive-strong"> · {i.inbox.error}</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
};

export default AgentCard;
