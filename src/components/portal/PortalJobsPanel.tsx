import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CircleDot, RefreshCw } from 'lucide-react';
import {
  recentPortalJobs, getAgentStatus, JOB_LABELS, PortalJob, AgentStatus, PortalJobStatus,
} from '@/lib/portalJobs';

const STATUS_STYLE: Record<PortalJobStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  claimed: 'bg-info/15 text-info',
  running: 'bg-info/15 text-info',
  needs_human: 'bg-warning/15 text-warning',
  succeeded: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

// Read-only activity panel for a client + period: agent liveness + recent jobs
// with their verification result. Polls while mounted.
export const PortalJobsPanel: React.FC<{ clientId: string; periodMonth?: string | null }> = ({ clientId, periodMonth }) => {
  const [jobs, setJobs] = useState<PortalJob[]>([]);
  const [agent, setAgent] = useState<AgentStatus>({ online: false, lastSeen: null, agentId: null });

  const refresh = useCallback(async () => {
    if (!clientId) { setJobs([]); return; }
    try {
      const [j, a] = await Promise.all([recentPortalJobs(clientId, periodMonth ?? null, 8), getAgentStatus()]);
      setJobs(j); setAgent(a);
    } catch { /* portal_jobs table may not exist until the migration is applied — stay quiet */ }
  }, [clientId, periodMonth]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!clientId) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-foreground">Portal activity</p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs">
              <CircleDot className={`h-3.5 w-3.5 ${agent.online ? 'text-success' : 'text-muted-foreground'}`} />
              {agent.online ? 'Agent online' : agent.lastSeen ? `Agent last seen ${timeAgo(agent.lastSeen)}` : 'Agent offline'}
            </span>
            <button onClick={refresh} className="text-muted-foreground hover:text-foreground" aria-label="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No portal jobs yet for this client/period.</p>
        ) : (
          <div className="space-y-1.5">
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 text-xs border-b border-border/50 pb-1.5 last:border-0">
                <span className="font-medium">{JOB_LABELS[j.job_type] ?? j.job_type}{j.mode === 'shadow' ? ' (shadow)' : ''}</span>
                <div className="flex items-center gap-2">
                  {j.status === 'succeeded' && j.verified === false && (
                    <span className="text-warning">verify mismatch</span>
                  )}
                  {j.status === 'succeeded' && j.verified === true && (
                    <span className="text-success">verified</span>
                  )}
                  {j.status === 'failed' && j.error && (
                    <span className="text-destructive max-w-[220px] truncate" title={j.error}>{j.error}</span>
                  )}
                  <span className={`px-2 py-0.5 rounded ${STATUS_STYLE[j.status]}`}>{j.status.replace('_', ' ')}</span>
                  <span className="text-muted-foreground">{timeAgo(j.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
