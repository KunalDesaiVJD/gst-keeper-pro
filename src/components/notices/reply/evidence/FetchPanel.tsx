// Fetching what a working is missing (audit R-10): when the autopilot is on, one
// click queues the pulls on it (origin "evidence"); its runner (the scheduled
// Chrome, or the office agent) fetches them now or when it is next online.
// When it is off, the tab says which returns to pull with the GST Keeper
// extension and where.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { agentUsable, autopilotState, useAutopilotStatus } from '@/lib/autopilot';
import { queueMissing, periodsLabel, periodLabel, type FetchPlanItem } from '@/lib/reply';

const planWords = (plan: FetchPlanItem[]) =>
  plan.map((p) => `${p.label}: ${['revrclm_pull', 'gstr9_pull', 'rcmliab_pull'].includes(p.mode) ? p.periods.map((x) => `FY ending ${periodLabel(x)}`).join(', ') : periodsLabel(p.periods)}`);

export const FetchPanel: React.FC<{ clientId: string; plan: FetchPlanItem[]; canEdit: boolean; onQueued?: () => void }> = ({ clientId, plan, canEdit, onQueued }) => {
  const { user } = useAuth();
  const status = useAutopilotStatus({ refetchMs: 60_000 });
  const [busy, setBusy] = useState(false);
  if (!plan.length) return null;
  const on = autopilotState(status.data?.settings) === 'on';
  const online = agentUsable(status.data);
  const words = planWords(plan);

  const queue = async () => {
    setBusy(true);
    try {
      const r = await queueMissing(clientId, plan, user ? { id: user.id, firstName: user.firstName } : null);
      toast[r.tone](r.text);
      if (r.ok) onQueued?.();
    } finally { setBusy(false); }
  };

  if (on) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/5 px-2.5 py-2 text-xs">
        <span className="min-w-0 flex-1">
          Missing: {words.join('; ')}.
          {!online && ' The autopilot is not online right now; queued pulls wait until it is.'}
        </span>
        {canEdit
          ? <Button size="sm" className={WS_BTN} onClick={queue} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />} Fetch missing data
            </Button>
          : <span className="text-muted-foreground">Ask someone who can edit notices to fetch it.</span>}
      </div>
    );
  }
  const why = status.isLoading ? 'Checking the autopilot…' : 'The autopilot is off, so nothing fetches it by itself.';
  return (
    <Note tone="info" open>
      Missing: {words.join('; ')}. {why} Pull these months with the GST Keeper extension — on{' '}
      <Link to="/reports" className="font-medium text-primary underline underline-offset-2">Reports</Link>, open the return’s
      “(Filed on Portal)” report (GSTR-2B / 2A: the portal reports), pick the client and month and press Pull — or from the{' '}
      <Link to={`/notices-company/${clientId}`} className="font-medium text-primary underline underline-offset-2">client’s page</Link>.
      The working rebuilds itself the next time this tab opens.
    </Note>
  );
};

export default FetchPanel;
