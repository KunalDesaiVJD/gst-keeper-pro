import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Loader2, PlugZap, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { MIN_EXTENSION_VERSION, RECOMMENDED_EXTENSION_VERSION, outdatedExtensionMessage } from '@/lib/extensionVersion';
import { agentUsable, autopilotState, enqueueJobs, runnerMode, useAutopilotStatus } from '@/lib/autopilot';
import { plural } from '@/lib/noticeFormat';

interface QueueRow { client_id: string; last_success_at: string | null }

/**
 * "Sync now" with its scope stated before anything starts (audit U-07-2): the
 * stale or never-synced clients by default, or every active client, in risk
 * order, with the CAPTCHAs it will take. When the portal autopilot is on and
 * the office agent is online, the same scope can be sent to the agent — its
 * CAPTCHAs come to the CAPTCHA wall, and it needs no extension on this PC
 * (roadmap Phase 3, audit S-23). Since 6 October 2026 the queue is run by the
 * firm's own Chrome (runner 'chrome'): the scope is queued for it whenever the
 * autopilot is on, and its CAPTCHA extension fills the CAPTCHAs (no wall).
 * Without either, it says how to connect the extension (U-06-1) instead of
 * failing with a toast.
 */
export const SyncNowButton: React.FC<{ onStarted?: () => void }> = ({ onStarted }) => {
  const bridge = useExtensionBridge({ announceVersion: true });
  const { user } = useAuth();
  const navigate = useNavigate();
  const autopilot = useAutopilotStatus({ refetchMs: 60_000 });
  const chrome = runnerMode(autopilot.data) === 'chrome';
  const runnerOnline = agentUsable(autopilot.data);
  // The scheduled Chrome takes queued clients whenever it is next on; the office agent only while online.
  const agentOn = chrome ? autopilotState(autopilot.data?.settings) === 'on' : runnerOnline;
  const target = chrome ? 'the scheduled Chrome' : 'the office agent';
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [scope, setScope] = useState<'stale' | 'all'>('stale');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || queue) return;
    supabase.rpc('sync_queue', {}).then(({ data, error }) => {
      if (error) { toast.error(`Couldn't read the sync queue: ${error.message}`); setQueue([]); return; }
      setQueue((data ?? []) as QueueRow[]);
    });
  }, [open, queue]);

  const dayAgo = Date.now() - 24 * 3600_000;
  const stale = (queue ?? []).filter((r) => !r.last_success_at || new Date(r.last_success_at).getTime() < dayAgo);
  const ids = scope === 'stale' ? stale.map((r) => r.client_id) : undefined;
  const count = scope === 'stale' ? stale.length : (queue ?? []).length;
  const extensionOk = bridge.ready && !bridge.outdated;

  const start = async () => {
    const res = await bridge.startPull('notices_bundle', ids);
    if (res.ok) {
      toast.success(`Sync started for ${plural(res.count ?? count, 'client')}. Type each CAPTCHA as it comes up; the run moves on from one nobody types after 10 minutes.`);
      setOpen(false);
      onStarted?.();
    } else toast.error(res.error || 'The sync did not start.');
  };

  const sendToAgent = async () => {
    setSending(true);
    const res = await enqueueJobs({
      clientIds: ids ?? null, jobType: 'PULL_NOTICES_BUNDLE', origin: 'manual',
      actor: user ? { id: user.id, firstName: user.firstName } : null,
    });
    setSending(false);
    if (!res.ok) { toast.error(`Couldn't send it to ${target}: ${res.error}`); return; }
    toast[res.tone === 'warning' ? 'warning' : 'success'](res.text, chrome ? {
      description: res.result.queued ? 'The scheduled Chrome logs each client in, one at a time; its CAPTCHA extension fills the CAPTCHA.' : undefined,
      action: { label: 'Open the Autopilot', onClick: () => navigate('/notices-autopilot') },
    } : {
      description: res.result.queued ? 'The office agent logs each client in; type their CAPTCHAs on the CAPTCHA wall.' : undefined,
      action: { label: 'Open the wall', onClick: () => navigate('/notices-autopilot?tab=wall') },
    });
    setOpen(false);
    onStarted?.();
  };

  if (!agentOn && !bridge.ready) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={WS_BTN}><PlugZap className="h-3.5 w-3.5" aria-hidden /> Connect extension</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 text-xs">
          <div className="text-sm font-semibold">The GST Keeper extension isn't on this PC</div>
          <p>Syncing runs in your own browser through the extension. Load the <span className="font-mono">extension</span> folder in
            Chrome (chrome://extensions → Developer mode → Load unpacked). It needs v{MIN_EXTENSION_VERSION} or later
            (v{RECOMMENDED_EXTENSION_VERSION} recommended).</p>
          <p>Once the portal autopilot is on and the office PC's agent is running, a sync can be sent to it from here instead.</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={bridge.recheck}>Check again</Button>
        </PopoverContent>
      </Popover>
    );
  }
  if (!agentOn && bridge.outdated) {
    return (
      <Button size="sm" variant="outline" className={WS_BTN} onClick={() => toast.error(outdatedExtensionMessage(bridge.version))}>
        <PlugZap className="h-3.5 w-3.5" aria-hidden /> Update extension
      </Button>
    );
  }
  const busy = bridge.busy || sending;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className={WS_BTN} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Sync now
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="text-sm font-semibold">Sync notices from the portal</div>
        {queue === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading which clients are due…</div>
        ) : (
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as 'stale' | 'all')} className="space-y-1">
            <Label className="flex items-start gap-2 text-xs font-normal">
              <RadioGroupItem value="stale" className="mt-0.5" />
              <span><span className="font-medium">Not synced in 24 h ({stale.length})</span><br />
                <span className="text-muted-foreground">Includes the ones that failed or never synced.</span></span>
            </Label>
            <Label className="flex items-start gap-2 text-xs font-normal">
              <RadioGroupItem value="all" className="mt-0.5" />
              <span><span className="font-medium">Every active client ({queue.length})</span><br />
                <span className="text-muted-foreground">Inactive and excluded clients are skipped.</span></span>
            </Label>
          </RadioGroup>
        )}
        <p className="text-[11px] text-muted-foreground">
          Urgent clients go first. About {plural(count, 'CAPTCHA')} to type.
          To pick clients by hand use <Link to="/notices-company-list" className="text-primary underline underline-offset-2">Clients</Link>.
        </p>
        {agentOn && (
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
            <Button size="sm" className="h-8 w-full gap-1 text-xs" disabled={queue === null || count === 0 || busy} onClick={sendToAgent}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Bot className="h-3.5 w-3.5" aria-hidden />}
              {chrome ? 'Queue for the scheduled Chrome' : 'Send to the office agent'} ({count})
            </Button>
            {chrome ? (
              <p className="text-[11px] text-foreground/80">
                The Chrome that runs the scheduled syncs logs each client in; its CAPTCHA extension fills the CAPTCHA.
                {!runnerOnline && ' It is not online now; the clients wait in the queue until it is.'} Nothing runs in this browser.
              </p>
            ) : (
              <p className="text-[11px] text-foreground/80">
                The office PC logs each client in; their CAPTCHAs come to the{' '}
                <Link to="/notices-autopilot?tab=wall" className="text-primary underline underline-offset-2">CAPTCHA wall</Link>. Nothing runs in this browser.
              </p>
            )}
          </div>
        )}
        {extensionOk ? (
          <div className="flex items-center justify-end gap-2">
            {agentOn && <span className="mr-auto text-[11px] text-muted-foreground">or type them in a tab here:</span>}
            <Button size="sm" variant={agentOn ? 'outline' : 'default'} className="h-8 text-xs" disabled={queue === null || count === 0 || busy} onClick={start}>
              {bridge.busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} {agentOn ? 'Run in this browser' : 'Start sync'} ({count})
            </Button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {bridge.outdated ? outdatedExtensionMessage(bridge.version) : `The GST Keeper extension isn't on this PC, so the sync can only go to ${target}.`}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default SyncNowButton;
