// The case's papers the assistant could not read (P4 of the law audit, 26 Oct
// 2026; notice_case_unread_papers, 20261027100000): scans, files that are not
// PDFs and documents too long to read whole. The overview, the advice and the
// appeal drafts are built without them, so they are named wherever those show.
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Note } from '@/components/gstr9/ui';
import { supabase } from '@/integrations/supabase/client';
import { docHref } from '@/lib/docLinks';
import { fmtDate } from '@/lib/noticeFormat';

interface UnreadPaper { id: string; label?: string; date?: string; url?: string; why: string }

export function useUnreadPapers(clientId: string, caseKey: string | null | undefined) {
  return useQuery({
    queryKey: ['notice-case-unread-papers', clientId, caseKey ?? ''],
    enabled: !!clientId && !!caseKey,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UnreadPaper[]> => {
      const { data, error } = await supabase.rpc('notice_case_unread_papers', { p_client_id: clientId, p_case_key: caseKey as string });
      // Before 20261027100000 there is no such function: say nothing.
      if (error) return [];
      return (Array.isArray(data) ? data : []) as unknown as UnreadPaper[];
    },
  });
}

export const UnreadPapersNote: React.FC<{ clientId: string; caseKey: string; what?: string }> = ({ clientId, caseKey, what = 'The overview, the advice and the drafts' }) => {
  const q = useUnreadPapers(clientId, caseKey);
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <Note tone="warn">
      {list.length === 1 ? '1 paper of this case was' : `${list.length} papers of this case were`} not read by the assistant. {what} leave them out, so read them yourself:
      <ul className="mt-1 list-disc pl-5">
        {list.slice(0, 8).map((p) => (
          <li key={p.id} className="text-xs">
            {p.url ? <a className="underline underline-offset-2" href={docHref(p.url)} target="_blank" rel="noreferrer">{p.label ?? 'Document'}</a> : (p.label ?? 'Document')}
            {p.date ? ` (${fmtDate(p.date)})` : ''}: {p.why}
          </li>
        ))}
        {list.length > 8 && <li className="text-xs">and {list.length - 8} more</li>}
      </ul>
    </Note>
  );
};
