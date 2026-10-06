// The GST Keeper browser extension, as seen from a page: is it installed, which
// version, and the two things a Notices page asks of it — start a section pull
// for some clients, and open one notice on the portal. Replaces the copies of
// this listener that each Notices page carried. A request the extension never
// answers gives up after 15 s instead of leaving a spinner (audit U-07-3).
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  isExtensionOutdated, isExtensionUpdateRecommended, outdatedExtensionMessage, updateRecommendedMessage,
} from '@/lib/extensionVersion';

export interface PullResult { ok: boolean; count?: number; error?: string }

interface Pending<T> { resolve: (v: T) => void; timer: ReturnType<typeof setTimeout> }

const NO_REPLY_MS = 15_000;

export function useExtensionBridge(opts: { announceVersion?: boolean } = {}) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pull = useRef<Pending<PullResult> | null>(null);
  const open = useRef<Pending<PullResult> | null>(null);
  const announced = useRef(false);
  const announce = opts.announceVersion ?? false;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) {
        const v = typeof d.version === 'string' ? d.version : null;
        setReady(true);
        setVersion(v);
        if (announce && !announced.current) {
          announced.current = true;
          if (isExtensionOutdated(v)) toast.error(outdatedExtensionMessage(v), { id: 'ext-outdated' });
          else if (isExtensionUpdateRecommended(v)) toast.warning(updateRecommendedMessage(v), { id: 'ext-update' });
        }
      }
      const settle = (ref: typeof pull, value: unknown) => {
        if (!ref.current) return;
        clearTimeout(ref.current.timer);
        ref.current.resolve((value ?? { ok: false }) as PullResult);
        ref.current = null;
        setBusy(false);
      };
      if (d.__gstkPullSectionAllClientsResult) settle(pull, d.__gstkPullSectionAllClientsResult);
      if (d.__gstkOpenNoticeResult) settle(open, d.__gstkOpenNoticeResult);
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
  }, [announce]);

  const recheck = useCallback(() => window.postMessage({ __gstkAppReady: true }, '*'), []);

  const request = useCallback((ref: typeof pull, message: Record<string, unknown>): Promise<PullResult> => {
    if (ref.current) return Promise.resolve({ ok: false, error: 'Already waiting for the extension.' });
    setBusy(true);
    return new Promise<PullResult>((resolve) => {
      const timer = setTimeout(() => {
        ref.current = null;
        setBusy(false);
        resolve({ ok: false, error: "The extension didn't respond. Reload it (chrome://extensions → Reload) and try again." });
      }, NO_REPLY_MS);
      ref.current = { resolve, timer };
      window.postMessage(message, '*');
    });
  }, []);

  /** Starts a section pull ('notices_bundle', 'taxpayerprofile', …) for the given clients (all when omitted). */
  const startPull = useCallback((mode: string, clientIds?: string[]) =>
    request(pull, { __gstkPullSectionAllClients: clientIds ? { mode, clientIds } : { mode } }), [request]);

  /** Opens the notice's page on the GST portal (logs in first). */
  const openOnPortal = useCallback((clientId: string, referenceNumber: string | null) =>
    request(open, { __gstkOpenNotice: { clientId, referenceNumber } }), [request]);

  return {
    ready,
    version,
    outdated: ready && isExtensionOutdated(version),
    busy,
    recheck,
    startPull,
    openOnPortal,
  };
}
