import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullBridge } from './Gstr9Section';

/**
 * The browser-extension bridge, as the other portal pages use it: ping the
 * extension (it and this page can load in either order), listen for its
 * announcement, and start a section pull with __gstkPullSection. The result
 * message only means "the portal tab opened"; each section polls
 * gst_filed_returns for the data itself.
 */
export function useExtensionBridge(clientId: string): PullBridge {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const pending = useRef<((ok: boolean, error?: string) => void) | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as Record<string, unknown> | null;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) {
        setReady(true);
        if (typeof d.version === 'string') setVersion(d.version);
      }
      const res = d.__gstkPullSectionResult as { ok?: boolean; error?: string } | undefined;
      if (res) {
        const cb = pending.current;
        pending.current = null;
        cb?.(!!res.ok, res.error);
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const start = useCallback<PullBridge['start']>(
    (payload, onStarted) => {
      pending.current = onStarted;
      window.postMessage({ __gstkPullSection: { clientId, ...payload } }, '*');
    },
    [clientId],
  );

  return useMemo(() => ({ ready, version, start }), [ready, version, start]);
}
