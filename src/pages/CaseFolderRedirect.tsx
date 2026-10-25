// /notices-case-folder/:clientId/:caseId: the separate case folder page was
// folded into the case page as its "Portal view" (the UX audit of 25 October
// 2026). Old links (e-mails, bookmarks) land there; a refund's folder lands on
// the refund page, the home of refunds.
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { WS_PAGE } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { caseHref } from '@/lib/noticeCases';

const CaseFolderRedirect: React.FC = () => {
  const { clientId = '', caseId = '' } = useParams<{ clientId: string; caseId: string }>();
  const q = useQuery({
    queryKey: ['case-folder-target', clientId, caseId],
    enabled: !!clientId && !!caseId,
    queryFn: async () => {
      const [cases, refund] = await Promise.all([
        supabase.from('notice_cases_flat' as 'notice_cases').select('case_key').eq('client_id', clientId).eq('case_key', caseId).limit(1),
        supabase.from('gst_refund_applications').select('arn').eq('client_id', clientId).eq('arn', caseId).is('deleted_at', null).limit(1),
      ]);
      return { hasCase: !!cases.data?.length, isRefund: !!refund.data?.length };
    },
  });
  if (!clientId || !caseId) return <Navigate to="/notices-cases" replace />;
  if (q.isLoading) return <div className={WS_PAGE}><Skeleton className="h-8 w-80" /><Skeleton className="h-64 w-full" /></div>;
  if (q.data?.isRefund && !q.data.hasCase) return <Navigate to={`/refunds/${clientId}/${encodeURIComponent(caseId)}`} replace />;
  return <Navigate to={`${caseHref(clientId, caseId)}?view=portal`} replace />;
};

export default CaseFolderRedirect;
