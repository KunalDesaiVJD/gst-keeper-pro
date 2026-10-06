// "Preview on a notice": a template's wording filled with one open notice's
// facts, exactly as the database prepares the options (notice_reply_context()
// for the facts, reply_render() for the words), so the firm can read a reply
// before it is saved or used. Nothing is written.
import React, { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyBox, INLINE_LINK, LoadError } from '@/components/notices/autopilot/parts';
import { fmtDate } from '@/lib/noticeFormat';
import { renderReply, searchPreviewNotices, useNoticeReplyContext, type PreviewNotice } from '@/lib/replyFactory';
import { MarkedText } from './TextChecks';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const noticeWords = (n: PreviewNotice) => [n.form_code ?? 'Form not known', n.reference_number ?? n.case_id].filter(Boolean).join(' · ');

export const TemplatePreview: React.FC<{
  /** The wording to fill (the saved body, or the one being edited). */
  body: string;
  /** The template's forms; empty for a general template. */
  forms: string[];
  /** Forms with an active template of their own (a general template is never prepared for them). */
  ownForms: string[];
  /** Says that the wording is the one being edited, not the saved one. */
  editing?: boolean;
}> = ({ body, forms, ownForms, editing }) => {
  const uid = useId();
  const [q, setQ] = useState('');
  const [anyOpen, setAnyOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const dq = useDebounced(q, 300);
  const dbody = useDebounced(body, 500);

  const list = useQuery({
    queryKey: ['reply-factory', 'preview-notices', forms.join(','), ownForms.join(','), anyOpen, dq],
    queryFn: () => searchPreviewNotices({ forms, ownForms, anyOpen, q: dq }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const notices = list.data ?? [];
  // The first notice is previewed at once; a pick stays while it is in the list.
  const current = notices.find((n) => n.id === picked) ?? notices[0] ?? null;
  const ctx = useNoticeReplyContext(current?.id ?? null);
  const rendered = useQuery({
    queryKey: ['reply-factory', 'render', current?.id ?? null, dbody],
    enabled: !!current && ctx.data !== undefined && ctx.data !== null && !!dbody.trim(),
    queryFn: () => renderReply(dbody, ctx.data ?? {}),
    placeholderData: keepPreviousData,
  });

  const scope = anyOpen ? 'every open notice'
    : forms.length ? `open notices of ${forms.join(', ')}` : 'open notices whose form has no template of its own';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, GSTIN or reference" aria-label="Find a notice to preview on"
            className="h-8 pl-7 text-xs" />
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox id={`${uid}-any`} checked={anyOpen} onCheckedChange={(v) => setAnyOpen(v === true)} />
          <Label htmlFor={`${uid}-any`} className="text-xs font-normal">Any open notice, not only those it is prepared for</Label>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Showing {scope}{dq ? ` matching "${dq}"` : ''}, newest first. {editing ? 'The preview uses the wording as it stands, before it is saved.' : ''}
      </p>

      {list.error ? <LoadError what="the notices" error={list.error} onRetry={() => list.refetch()} />
        : list.isLoading ? <Skeleton className="h-16 w-full" />
        : notices.length === 0 ? (
          <EmptyBox className="p-4">
            {dq ? 'No open notice matches.' : anyOpen ? 'There is no open notice.' : 'No open notice is waiting for this template. Tick "Any open notice" to preview it on another one.'}
          </EmptyBox>
        ) : (
          <div role="group" aria-label="The notice to preview on" className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border bg-muted/20 p-1">
            {notices.map((n) => {
              const on = current?.id === n.id;
              return (
                <button key={n.id} type="button" aria-pressed={on} onClick={() => setPicked(n.id)}
                  className={cn('flex flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-left text-xs hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    on && 'bg-card font-medium shadow-sm ring-1 ring-primary/40')}>
                  <span className="min-w-0 break-words">{n.client_name ?? 'Client not known'}</span>
                  <span className="break-all font-mono text-[11px] text-foreground/70">{noticeWords(n)}</span>
                  {n.issue_date && <span className="text-[11px] text-foreground/70">issued {fmtDate(n.issue_date)}</span>}
                </button>
              );
            })}
          </div>
        )}

      {current && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              Filled for <span className="font-medium">{current.client_name ?? 'the client'}</span>{' '}
              <span className="font-mono text-[11px]">{noticeWords(current)}</span>
              {(ctx.isFetching || rendered.isFetching) && <><Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden /><span className="sr-only"> Preparing the preview</span></>}
            </span>
            <Link to={`/notices/${current.id}?tab=draft`} className={cn(INLINE_LINK, 'text-xs')}>Open the notice</Link>
          </div>
          {ctx.error ? <LoadError what="the notice's facts" error={ctx.error} onRetry={() => ctx.refetch()} />
            : rendered.error ? <LoadError what="the preview" error={rendered.error} onRetry={() => rendered.refetch()} />
            : ctx.data === null ? <EmptyBox className="p-4">That notice is no longer in the app.</EmptyBox>
            : !dbody.trim() ? <EmptyBox className="p-4">The wording is empty.</EmptyBox>
            : rendered.data === undefined ? <Skeleton className="h-48 w-full" />
            : (
              <div className="max-h-[55vh] overflow-y-auto rounded-md border bg-card p-3 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                tabIndex={0} role="region" aria-label="The reply as it would be prepared">
                <MarkedText text={rendered.data} fillIns className="font-serif text-[13.5px]" />
              </div>
            )}
          <p className="text-[11px] text-muted-foreground">
            Words in square brackets are fill ins the person completes in the draft. Nothing here is saved or sent.
          </p>
        </div>
      )}
    </div>
  );
};

export default TemplatePreview;
