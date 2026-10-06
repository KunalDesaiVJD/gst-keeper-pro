// Starting a portal pull for chosen clients from the Clients pages, through the
// extension (the same bridge as SyncNowButton): says what to do when the
// extension is missing or too old instead of failing silently (U-06-1), and
// remembers what was started so the rows can show "queued" until the run
// ledger reports them (U-50-4).
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { MIN_EXTENSION_VERSION, outdatedExtensionMessage } from '@/lib/extensionVersion';
import { plural } from '@/lib/noticeFormat';

export type PullMode = 'notices_bundle' | 'taxpayerprofile';

export interface Started { ids: Set<string>; at: number; mode: PullMode }

const NO_EXTENSION = `The GST Keeper extension isn't on this PC. Load the extension folder in Chrome (chrome://extensions → Developer mode → Load unpacked, v${MIN_EXTENSION_VERSION} or later), then try again.`;

export function useClientSync() {
  const bridge = useExtensionBridge();
  const [started, setStarted] = useState<Started | null>(null);

  const start = useCallback(async (ids: string[], mode: PullMode = 'notices_bundle'): Promise<boolean> => {
    if (!ids.length) { toast.info('No client to sync here.'); return false; }
    if (!bridge.ready) { toast.error(NO_EXTENSION); return false; }
    if (bridge.outdated) { toast.error(outdatedExtensionMessage(bridge.version)); return false; }
    const res = await bridge.startPull(mode, ids);
    if (!res.ok) { toast.error(res.error || 'The extension did not start the pull.'); return false; }
    const n = res.count ?? ids.length;
    toast.success(mode === 'taxpayerprofile'
      ? `Fetching the portal profile of ${plural(n, 'client')}. Type each CAPTCHA as it comes up.`
      : `Sync started for ${plural(n, 'client')}. Type each CAPTCHA as it comes up; the run moves on from one nobody types after 10 minutes.`);
    setStarted({ ids: new Set(ids), at: Date.now(), mode });
    return true;
  }, [bridge]);

  return { ready: bridge.ready, outdated: bridge.outdated, busy: bridge.busy, start, started, markStarted: setStarted };
}
