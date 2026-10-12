// A case's correspondence as a timeline, newest first: every notice and every
// document of its portal case folder, on a dated rail, marked by who sent it
// (the department or us) and what it is (notice, order, reply, application),
// with what the AI read in it in two lines (more on a click), its files as
// chips, and whether it is new since the case was last opened.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, FileText, Loader2, Paperclip, Sparkles } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { EmptyBox } from '@/components/notices/autopilot/parts';
import { StageBadge } from '@/components/notices/StageBadge';
import type { CaseItem } from '@/lib/noticeCases';
import { fmtAiTokens, fmtDateTime } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SECTION_KIND: Record<string, string> = { NOTICES: 'Notice', ORDRS: 'Order', REPLY: 'Reply', APLCN: 'Application', OTHERS: 'Document' };

function kindOf(it: CaseItem): string {
  if (it.kind === 'notice') return 'Notice';
  const k = it.ai?.doc_kind?.trim();
  if (k) return k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
  return (it.section && SECTION_KIND[it.section.toUpperCase()]) || 'Document';
}

function DateTile({ date }: { date: string | null }) {
  if (!date) return <div className="w-14 shrink-0 pt-1 text-center text-[11px] text-muted-foreground">undated</div>;
  const [y, m, d] = date.slice(0, 10).split('-');
  return (
    <div className="w-14 shrink-0 pt-0.5 text-center leading-tight">
      <div className="text-lg font-bold tabular-nums">{Number(d)}</div>
      <div className="text-[11px] text-muted-foreground">{MONTHS[Number(m) - 1]} {y}</div>
    </div>
  );
}

function Reading({ it }: { it: CaseItem }) {
  const [more, setMore] = useState(false);
  const text = it.notice_read?.summary || (it.ai?.status === 'done' ? it.ai.summary : null);
  const reading = (it.notice_read && ['queued', 'running'].includes(it.notice_read.status)) || (it.ai && ['queued', 'running'].includes(it.ai.status));
  if (text) {
    const long = text.length > 220;
    const tokens = it.notice_read?.summary ? fmtAiTokens(it.notice_read.usage, it.notice_read.model) : fmtAiTokens(it.ai?.usage, it.ai?.model);
    return (
      <div className="flex gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-label="Read by the AI" />
        <p className={cn('text-[13px] leading-relaxed text-foreground/85', !more && 'line-clamp-2')}>
          {text}
          {long && more && <button type="button" onClick={() => setMore(false)} className="ml-1 text-xs font-medium text-primary hover:underline">Less</button>}
        </p>
        {long && !more && <button type="button" onClick={() => setMore(true)} className="shrink-0 self-end text-xs font-medium text-primary hover:underline">More</button>}
        {tokens && <span className="shrink-0 self-end whitespace-nowrap text-[10px] tabular-nums text-muted-foreground" title="Tokens the AI used to read it">{tokens}</span>}
      </div>
    );
  }
  if (reading) return <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> The AI is reading it</p>;
  if (it.ai?.status === 'failed' && it.ai.reason_class === 'needs_vision') return <p className="text-[11px] text-muted-foreground">A scan: the AI could not read its text.</p>;
  return null;
}

function FileChip({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={label}
      className={cn('inline-flex max-w-[15rem] items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5',
        primary ? 'border-primary/30 font-medium text-primary' : 'text-foreground/80')}>
      {primary ? <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="truncate">{label}</span>
    </a>
  );
}

export const CaseTimeline: React.FC<{ items: CaseItem[] }> = ({ items }) => {
  if (!items.length) return <EmptyBox className="p-4">Nothing in this case yet.</EmptyBox>;
  return (
    <ol className="relative">
      {items.map((it, idx) => {
        const dept = it.from === 'department';
        const files = (it.attachments ?? []).filter((a) => a?.url);
        const title = it.kind === 'notice' ? it.label : it.ai?.title || it.label;
        const last = idx === items.length - 1;
        return (
          <li key={`${it.kind}:${it.id}`} className="flex gap-3">
            <DateTile date={it.date} />
            <div className="relative flex w-5 shrink-0 justify-center">
              {!last && <span className="absolute bottom-0 top-6 w-px bg-border" aria-hidden />}
              <span className={cn('relative mt-1.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-card',
                dept ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success')} title={dept ? 'From the department' : 'From us'}>
                {dept ? <ArrowDownLeft className="h-3 w-3" aria-hidden /> : <ArrowUpRight className="h-3 w-3" aria-hidden />}
              </span>
            </div>
            <div className={cn('mb-3 min-w-0 flex-1 space-y-1.5 rounded-lg border p-3', it.is_new ? 'border-info/50 bg-info/5' : 'bg-card')}>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={cn('rounded px-1.5 py-0.5 font-semibold', dept ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}>
                  {dept ? 'Department' : 'Us'} · {kindOf(it)}
                </span>
                {it.is_new && <Badge variant="info" className="text-[10px]">New</Badge>}
                {it.kind === 'notice' && it.is_open && <StageBadge stage={it.stage} />}
                {it.ai?.outcome && !/^(other|none|unknown|n\/?a|pending)$/i.test(it.ai.outcome.trim()) && <Badge variant="secondary" className="text-[10px]">Outcome: {it.ai.outcome}</Badge>}
                {it.reference && <span className="ml-auto font-mono text-[10px] text-muted-foreground" title={it.arrived_at ? `Seen on the portal ${fmtDateTime(it.arrived_at)}` : undefined}>{it.reference}</span>}
              </div>
              {it.kind === 'notice'
                ? <Link to={`/notices/${it.id}`} className="block text-sm font-semibold leading-snug text-primary hover:underline">{title}</Link>
                : <div className="text-sm font-semibold leading-snug">{title}</div>}
              <Reading it={it} />
              {(it.pdf_url || files.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {it.pdf_url && <FileChip href={it.pdf_url} label="Notice PDF" primary />}
                  {files.slice(0, 6).map((a, i) => <FileChip key={i} href={a.url as string} label={a.label || `File ${i + 1}`} />)}
                  {files.length > 6 && <span className="self-center text-[11px] text-muted-foreground">+{files.length - 6} more</span>}
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
