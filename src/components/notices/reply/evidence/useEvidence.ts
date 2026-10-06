// Loads a notice's evidence and builds it on open: a working with no saved
// version, or whose inputs changed since the current one, is saved as 'Auto'
// without a click (roadmap Phase 4 acceptance: an automatic annexure for the
// open ASMT-10 / DRC-01A / DRC-01B / DRC-01C once their data is pulled).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { loadEvidence, loadSavedAnnexures, needsSave, saveCards, type SavedAnnexure } from '@/lib/reply';

export const evidenceKey = (noticeId: string) => ['notice-evidence', noticeId] as const;
export const savedKey = (noticeId: string) => ['notice-annexures', noticeId] as const;

export function useEvidence(noticeId: string, signature: string, onIssuesChanged: () => void) {
  const qc = useQueryClient();
  // The heavy part (the portal returns) loads once per signature; a save only refreshes the light list of versions.
  const q = useQuery({
    queryKey: [...evidenceKey(noticeId), signature],
    queryFn: () => loadEvidence(noticeId),
    staleTime: 60_000,
    retry: 1,
  });
  const savedQ = useQuery({ queryKey: savedKey(noticeId), queryFn: () => loadSavedAnnexures(noticeId), enabled: !!q.data, retry: 1 });
  const saved: SavedAnnexure[] = useMemo(() => savedQ.data ?? q.data?.saved ?? [], [savedQ.data, q.data]);
  const tried = useRef(new Set<string>());
  const changed = useRef(onIssuesChanged);
  changed.current = onIssuesChanged;
  const [autoSaving, setAutoSaving] = useState(false);

  useEffect(() => {
    const b = q.data;
    if (!b) return;
    const todo = b.cards.filter((c) => needsSave(c, saved) && !tried.current.has(`${c.key}|${c.hash}|${c.result.status}`));
    if (!todo.length) return;
    todo.forEach((c) => tried.current.add(`${c.key}|${c.hash}|${c.result.status}`));
    setAutoSaving(true);
    saveCards(todo, saved, { auto: true })
      .then((r) => {
        const failed = r.cards.filter((c) => c.error);
        if (failed.length) toast.warning(`The evidence was worked out but not saved: ${failed[0].error}`, { id: `evidence-save-${noticeId}` });
        qc.invalidateQueries({ queryKey: savedKey(noticeId) });
        if (r.touchedIssues) changed.current();
      })
      .finally(() => setAutoSaving(false));
  }, [q.data, saved, qc, noticeId]);

  return {
    ...q,
    saved,
    autoSaving,
    refreshSaved: () => qc.invalidateQueries({ queryKey: savedKey(noticeId) }),
    refresh: () => Promise.all([qc.invalidateQueries({ queryKey: evidenceKey(noticeId) }), qc.invalidateQueries({ queryKey: savedKey(noticeId) })]),
  };
}
