// /notices-open/:id: a notice opened from a list, a search, an alert or a
// calendar lands on its case, with the case's timeline and the notice marked
// on it (the firm, 25 October 2026). Only "Work on it" opens the notice's own
// workspace. A notice the module no longer shows opens its workspace as before.
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { WS_PAGE } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { noticeCaseHref } from '@/lib/noticeCases';

const NoticeOpenPage: React.FC = () => {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['notice-open', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('notice_facts').select('id, client_id, case_id, category').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  if (q.isLoading) return <div className={WS_PAGE}><Skeleton className="h-8 w-80" /><Skeleton className="h-64 w-full" /></div>;
  if (!q.data?.client_id) return <Navigate to={`/notices/${id}`} replace />;
  return <Navigate to={noticeCaseHref({ id, client_id: q.data.client_id, case_id: q.data.case_id, category: q.data.category })} replace />;
};

export default NoticeOpenPage;
