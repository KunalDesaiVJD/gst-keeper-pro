import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, PlugZap, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { MIN_EXTENSION_VERSION, RECOMMENDED_EXTENSION_VERSION, outdatedExtensionMessage } from '@/lib/extensionVersion';
import { plural } from '@/lib/noticeFormat';

interface QueueRow { client_id: string; last_success_at: string | null }

/**
 * "Sync now" with its scope stated before anything starts (audit U-07-2): the
 * stale or never-synced clients by default, or every active client, in risk
 * order, with the CAPTCHAs it will take. Without the extension it says how to
 * connect it (U-06-1) instead of failing with a toast.
 */
export const SyncNowButton: React.FC<{ onStarted?: () => void }> = ({ onStarted }) => {
  const bridge = useExtensionBridge({ announceVersion: true });
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [scope, setScope] = useState<'stale' | 'all'>('stale');

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

  const start = async () => {
    const res = await bridge.startPull('notices_bundle', ids);
    if (res.ok) {
      toast.success(`Sync started for ${plural(res.count ?? count, 'client')}. Type each CAPTCHA as it comes up; the run moves on from one nobody types after 10 minutes.`);
      setOpen(false);
      onStarted?.();
    } else toast.error(res.error || 'The sync did not start.');
  };

  if (!bridge.ready) {
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
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={bridge.recheck}>Check again</Button>
        </PopoverContent>
      </Popover>
    );
  }
  if (bridge.outdated) {
    return (
      <Button size="sm" variant="outline" className={WS_BTN} onClick={() => toast.error(outdatedExtensionMessage(bridge.version))}>
        <PlugZap className="h-3.5 w-3.5" aria-hidden /> Update extension
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className={WS_BTN} disabled={bridge.busy}>
          {bridge.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Sync now
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
          Urgent clients go first. About {plural(count, 'CAPTCHA')} to type; this tab can stay open.
          To pick clients by hand use <Link to="/notices-company-list" className="text-primary underline-offset-2 hover:underline">Clients</Link>.
        </p>
        <div className="flex justify-end">
          <Button size="sm" className="h-8 text-xs" disabled={queue === null || count === 0 || bridge.busy} onClick={start}>
            {bridge.busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Start sync ({count})
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SyncNowButton;
