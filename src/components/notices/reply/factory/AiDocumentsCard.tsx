// The documents the AI reads besides each notice's own PDF (Phase 7): case-folder
// attachments, the firm's filed replies, orders and approved drafts, with what
// became of each (waiting, read, skipped as a copy, failed and why) and a retry
// for the failed ones. The filter lives in the URL (?docs=…).
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { fmtAgo } from '@/lib/noticeFormat';
import { DOC_ROLE, DOC_STATUS, retryDocuments, type AiDocument } from '@/lib/noticeAi';
import { cn } from '@/lib/utils';

const PAGE = 25;
const FILTERS = [
  { value: 'queued', label: 'Waiting' },
  { value: 'done', label: 'Read' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped (copies, too long)' },
  { value: 'reply', label: 'Replies only' },
];
const TONE: Record<string, 'success' | 'warning' | 'info' | 'destructive' | 'secondary'> = {
  queued: 'secondary', running: 'info', done: 'success', failed: 'destructive', skipped: 'secondary', cancelled: 'secondary',
};
const REASON: Record<string, string> = {
  duplicate: 'a copy of a file already read', same_as_notice: 'the notice PDF, read with the notice', too_long: 'too many pages',
  no_consent: 'no consent', opted_out: 'opted out', off: 'AI was off', deleted: 'removed on the portal', worker_limit: 'stopped three times',
  rate_limited: 'rate limited', refused: 'the model declined', bad_output: 'unreadable answer', no_document: 'no file', not_pdf: 'not a PDF',
};

type Row = AiDocument & { clients: { name: string | null } | null };

export const AiDocumentsCard: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const filter = sp.get('docs') ?? 'all';
  const page = Math.max(1, Number(sp.get('p')) || 1);
  const q = useQuery({
    queryKey: ['ai-documents', filter, page],
    queryFn: async () => {
      let x = supabase.from('ai_documents')
        .select('id, client_id, notice_id, source, role, label, title, summary, status, reason_class, error, doc_kind, outcome, pages, finished_at, created_at, updated_at, clients(name)', { count: 'exact' })
        .neq('source', 'workspace');
      if (filter === 'reply') x = x.eq('role', 'reply');
      else if (filter !== 'all') x = x.eq('status', filter === 'queued' ? 'queued' : filter);
      const { data, error, count } = await x.order('updated_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
    refetchInterval: 30_000,
  });
  const set = (v: string) => { const n = new URLSearchParams(sp); if (v === 'all') n.delete('docs'); else n.set('docs', v); n.delete('p'); setSp(n, { replace: true }); };
  const failed = (q.data?.rows ?? []).filter((r) => r.status === 'failed');
  const retry = async () => {
    setBusy(true);
    try {
      const n = await retryDocuments(failed.map((r) => r.id));
      toast.success(`${n} document${n === 1 ? '' : 's'} back in the queue.`);
      qc.invalidateQueries({ queryKey: ['ai-documents'] });
      qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill label="Show" allLabel="All" value={filter} onChange={set} options={[]} extraOptions={FILTERS} />
        {canEdit && failed.length > 0 && (
          <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={retry}><RotateCcw className="h-3.5 w-3.5" /> Try the failed again ({failed.length})</Button>
        )}
        {q.data && <span className="ml-auto text-xs text-muted-foreground">{q.data.total.toLocaleString('en-IN')} document{q.data.total === 1 ? '' : 's'}</span>}
      </div>
      {q.error ? <LoadError what="the documents" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-40 w-full" />
        : !q.data?.rows.length ? <EmptyBox className="p-4">Nothing here yet. Documents are registered as the portal sync brings case folders.</EmptyBox>
        : (
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead><tr><th className={WS_TH}>Client</th><th className={WS_TH}>Document</th><th className={WS_TH}>What it is</th><th className={WS_TH}>State</th><th className={WS_TH}>When</th></tr></thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={r.id} className={WS_TR}>
                    <td className={cn(WS_TD, 'max-w-[12rem] truncate')}>{r.clients?.name ?? '—'}</td>
                    <td className={cn(WS_TD, 'max-w-[18rem]')}>
                      {r.notice_id ? <Link to={`/notices/${r.notice_id}?tab=assistant`} className={cn(INLINE_LINK, 'block truncate')}>{r.title || r.label}</Link>
                        : <span className="block truncate">{r.title || r.label}</span>}
                      <span className="text-[11px] text-muted-foreground">{DOC_ROLE[r.role] ?? r.role}{r.source === 'draft' ? ' · draft' : ''}{r.pages ? ` · ${r.pages} p` : ''}</span>
                    </td>
                    <td className={cn(WS_TD, 'max-w-[22rem]')}><span className="line-clamp-2 text-xs">{r.summary || (r.doc_kind ? r.doc_kind : '—')}</span></td>
                    <td className={WS_TD}>
                      <ToneBadge tone={TONE[r.status] ?? 'secondary'}>{DOC_STATUS[r.status] ?? r.status}</ToneBadge>
                      {r.reason_class && <div className="text-[11px] text-muted-foreground" title={r.error ?? undefined}>{REASON[r.reason_class] ?? r.reason_class}</div>}
                    </td>
                    <td className={cn(WS_TD, 'whitespace-nowrap text-xs text-muted-foreground')}>{fmtAgo(r.finished_at ?? r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {q.data && <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={(p) => { const n = new URLSearchParams(sp); n.set('p', String(p)); setSp(n); }} />}
    </div>
  );
};

export default AiDocumentsCard;
