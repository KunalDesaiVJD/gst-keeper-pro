// A case's correspondence, newest first: every notice and every document of its
// portal case folder, who sent it, when it arrived, what the AI read in it, and
// whether it is new since the case was last opened.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { EmptyBox } from '@/components/notices/autopilot/parts';
import { StageBadge } from '@/components/notices/StageBadge';
import type { CaseItem } from '@/lib/noticeCases';
import { fmtDate, fmtDateTime } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

function AiLine({ it }: { it: CaseItem }) {
  const ai = it.ai;
  // A notice's own PDF is read by the notice reader: its summary first.
  if (it.notice_read?.summary) return <p className="text-xs text-foreground/80"><span className="font-medium">AI: </span>{it.notice_read.summary}</p>;
  if (it.notice_read && (it.notice_read.status === 'queued' || it.notice_read.status === 'running')) {
    return <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> The AI is reading it</p>;
  }
  if (ai?.status === 'done' && ai.summary) {
    return <p className="text-xs text-foreground/80"><span className="font-medium">AI: </span>{ai.summary}</p>;
  }
  if (ai && (ai.status === 'queued' || ai.status === 'running')) {
    return <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> The AI is reading it</p>;
  }
  if (ai?.status === 'failed' && ai.reason_class === 'needs_vision') return <p className="text-[11px] text-muted-foreground">A scan: the AI could not read its text.</p>;
  return null;
}

export const CaseTimeline: React.FC<{ items: CaseItem[] }> = ({ items }) => {
  if (!items.length) return <EmptyBox className="p-4">Nothing in this case yet.</EmptyBox>;
  return (
    <ol className="space-y-2">
      {items.map((it) => {
        const dept = it.from === 'department';
        const files = (it.attachments ?? []).filter((a) => a?.url);
        return (
          <li key={`${it.kind}:${it.id}`} className={cn('flex gap-2.5 rounded-md border p-2.5', it.is_new && 'border-info/60 bg-info/5')}>
            <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', dept ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')}
              title={dept ? 'From the department' : 'From us'}>
              {dept ? <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden /> : <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {it.is_new && <Badge variant="info" className="text-[10px]">New</Badge>}
                {it.kind === 'notice'
                  ? <Link to={`/notices/${it.id}`} className="text-sm font-medium text-primary hover:underline">{it.label}</Link>
                  : <span className="text-sm font-medium">{it.ai?.title || it.label}</span>}
                {it.kind === 'notice' && it.is_open && <StageBadge stage={it.stage} />}
                {it.ai?.outcome && <Badge variant="secondary" className="text-[10px]">Order: {it.ai.outcome}</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {dept ? 'From the department' : 'From us'}
                {it.date ? ` · dated ${fmtDate(it.date)}` : ''}
                {it.arrived_at ? ` · seen on the portal ${fmtDateTime(it.arrived_at)}` : ''}
                {it.reference ? <> · <span className="font-mono">{it.reference}</span></> : null}
              </div>
              <AiLine it={it} />
              {(it.pdf_url || files.length > 0) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {it.pdf_url && <a href={it.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">Notice PDF <ExternalLink className="h-3 w-3" aria-hidden /></a>}
                  {files.slice(0, 6).map((a, i) => (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[16rem] items-center gap-0.5 truncate text-primary hover:underline">
                      {a.label || `File ${i + 1}`} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default CaseTimeline;
