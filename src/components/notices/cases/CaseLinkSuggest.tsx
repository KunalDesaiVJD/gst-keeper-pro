// An appeal (or similar) in a case of its own whose order the portal does not name:
// the orders it may be against, best first, linked in one click (the firm's rule of
// 9 October 2026: link by itself when certain, otherwise suggest).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { setCaseLink, useLinkSuggestions } from '@/lib/noticeCases';
import { fmtDate, fmtInrShort } from '@/lib/noticeFormat';

export const CaseLinkSuggest: React.FC<{ noticeId: string; clientId: string; caseId: string | null; canEdit: boolean; onLinked: () => void }> = ({ noticeId, clientId, caseId, canEdit, onLinked }) => {
  const { user } = useAuth();
  const sug = useLinkSuggestions(noticeId);
  const [busy, setBusy] = useState(false);
  const list = (sug.data?.cases ?? []).slice(0, 3);
  if (!canEdit || !caseId || !list.length) return null;
  const link = async (parentCase: string) => {
    setBusy(true);
    try {
      await setCaseLink(clientId, caseId, parentCase, 'appeal', user?.firstName ?? null);
      toast.success('Linked: the appeal is now part of the order\'s case.');
      await sug.refetch();
      onLinked();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-info/40 bg-info/5 px-3 py-2">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Link2 className="h-4 w-4 text-info" aria-hidden /> Which order is this appeal against?</p>
      <ul className="mt-1 divide-y">
        {list.map((o) => (
          <li key={o.notice_id} className="flex items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1 text-xs">
              <Link to={`/notices/${o.notice_id}`} className="font-medium text-primary hover:underline">{o.form_code} · {o.reference}</Link>
              <span className="text-muted-foreground">{o.issue_date ? ` · ${fmtDate(o.issue_date)}` : ''}{o.financial_year ? ` · FY ${o.financial_year}` : ''}{o.amount ? ` · ${fmtInrShort(o.amount)}` : ''}</span>
              <div className="truncate text-[11px] text-muted-foreground">{o.reasons.join(' · ')}</div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => link(o.case_id)}>Link</Button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CaseLinkSuggest;
