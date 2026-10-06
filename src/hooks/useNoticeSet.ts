import { useCallback, useEffect, useState } from 'react';
import {
  loadNoticeFacts, loadRefundFacts, loadDrc03Facts, loadMatterExposure,
  type NoticeFact, type RefundFact, type Drc03Fact, type MatterExposure, type FactsSource,
} from '@/lib/noticeFacts';

// The canonical notice set (public.notice_facts) plus the de-duplicated refund
// and DRC-03 sets and the open matters' exposure — what the dashboard, the
// Notice Summary, the GSTIN-wise count and the alert e-mails all count.
export type NoticeSetRow = NoticeFact;

export function useNoticeSet() {
  const [rows, setRows] = useState<NoticeFact[]>([]);
  const [refundRows, setRefundRows] = useState<RefundFact[]>([]);
  const [drc03Rows, setDrc03Rows] = useState<Drc03Fact[]>([]);
  const [matterExposure, setMatterExposure] = useState<Map<string, MatterExposure>>(new Map());
  const [source, setSource] = useState<FactsSource>('facts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [notices, refunds, drc03, matters] = await Promise.all([
          loadNoticeFacts(), loadRefundFacts(), loadDrc03Facts(), loadMatterExposure(),
        ]);
        if (!cancelled) {
          setRows(notices.rows);
          setSource(notices.source);
          setRefundRows(refunds);
          setDrc03Rows(drc03);
          setMatterExposure(matters);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load notices');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return { rows, refundRows, drc03Rows, matterExposure, source, loading, error, refetch };
}
