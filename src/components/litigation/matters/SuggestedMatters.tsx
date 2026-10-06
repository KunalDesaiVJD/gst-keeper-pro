// Portal cases that have notices but no matter (audit U-80-3): each one can be
// opened as a matter with its notices ticked and the facts filled in.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { fmtDate } from '@/lib/noticeFormat';
import { suggestMatters, type SuggestedMatter } from '@/lib/litigationData';

export const SuggestedMatters: React.FC<{
  clientId?: string | null;
  clientName: (id: string) => string;
  onCreate: (s: SuggestedMatter) => void;
}> = ({ clientId, clientName, onCreate }) => {
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['matter-suggestions'], queryFn: suggestMatters, staleTime: 60_000 });
  const rows = (q.data ?? []).filter((s) => !clientId || s.client_id === clientId);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 3);
  return (
    <section aria-labelledby="suggested-heading" className="rounded-lg border border-info/30 bg-info/5 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="suggested-heading" className="text-sm font-semibold">
          Suggested from portal cases <span className="font-normal text-muted-foreground">· {rows.length} case{rows.length === 1 ? '' : 's'} with notices but no matter</span>
        </h2>
        {rows.length > 3 && (
          <button type="button" className="text-xs font-medium text-primary underline underline-offset-2" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <ul className="mt-1 divide-y divide-info/20">
        {shown.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{clientName(s.client_id)} · {s.title}</span>
              <span className="block text-xs text-muted-foreground">
                {s.notices.length} notices · first issued {fmtDate(s.notices[0]?.issue_date)}
              </span>
            </span>
            <Button size="sm" variant="outline" className={WS_BTN} onClick={() => onCreate(s)}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Create matter<span className="sr-only"> for case {s.case_id}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default SuggestedMatters;
