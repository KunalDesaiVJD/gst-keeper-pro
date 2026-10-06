// Client portal · Documents requested (/client-documents; roadmap Phase 4
// "Client document requests"; audit R-11, R-25): what the firm has asked this
// client for to reply to the GST department's notices — what, for which
// notice, by when — with an upload for each, and what the firm has received
// in the last 30 days. For clients only: staff see requests on each notice.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { ClientDocReceived, ClientDocRequestCard } from '@/components/client/ClientDocRequestCard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { plural } from '@/lib/noticeFormat';
import { useClientDocRequests } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const ClientDocumentsPage: React.FC = () => {
  const { user, isStaffRole } = useAuth();
  const staff = isStaffRole();
  // For a client login, the user's id is the client's own id (as the 2B pages use it).
  const clientId = !staff ? user?.id ?? null : null;
  const client = useQuery({
    queryKey: ['client-self', clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, gstin').eq('id', clientId as string).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const q = useClientDocRequests(clientId);

  if (staff) return <Navigate to="/dashboard" replace />;

  const rows = q.data ?? [];
  const open = rows.filter((r) => r.status === 'requested');
  const received = rows.filter((r) => r.status === 'received');
  const me = { id: clientId ?? '', name: client.data?.name ?? user?.firstName ?? 'Client' };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Documents requested"
        subtitle="What your CA team needs from you to reply to GST notices"
        icon={<FileUp className="h-5 w-5" />}
        actions={(
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} aria-hidden /> Refresh
          </Button>
        )}
      />

      <div className="space-y-1 rounded-lg border border-info/30 bg-info/5 p-3 text-sm leading-relaxed">
        {client.data && <p className="font-medium">{client.data.name} · GSTIN {client.data.gstin}</p>}
        <p>
          Upload each document below and your CA team gets it straight away — there is no need to e-mail it as well. If something asked
          for does not apply to you, please tell your CA team.
        </p>
      </div>

      {q.error ? (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p>We could not load your requests just now. Please check your connection and try again.</p>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Try again</Button>
        </div>
      ) : q.isLoading || !clientId ? (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
      ) : (
        <>
          <section aria-labelledby="still-needed" className="space-y-2">
            <h2 id="still-needed" className="text-lg font-semibold">
              Still needed{open.length > 0 && <span className="font-normal text-foreground/70"> · {plural(open.length, 'document')}</span>}
            </h2>
            {open.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-foreground/80">
                Nothing is needed from you right now. Thank you.
              </p>
            ) : (
              <ul className="space-y-3">
                {open.map((r) => <ClientDocRequestCard key={r.request_id} r={r} client={me} onUploaded={() => q.refetch()} />)}
              </ul>
            )}
          </section>

          {received.length > 0 && (
            <section aria-labelledby="received" className="space-y-2">
              <h2 id="received" className="text-lg font-semibold">Received <span className="font-normal text-foreground/70">· last 30 days</span></h2>
              <ul className="space-y-2">{received.map((r) => <ClientDocReceived key={r.request_id} r={r} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ClientDocumentsPage;
