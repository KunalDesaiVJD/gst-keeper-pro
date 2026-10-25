// A case's timeline: every notice and every document of its portal case folder
// (an appeal's APL-01 included), and the dates the law attaches to them (time to
// appeal, pre-deposit, hearings, adjournments, replies due, the windows to pay
// and close), on one dated rail, oldest first by default (the firm, 25 October
// 2026: "chronological events are extremely important to understand"). Each
// paper is marked by who sent it (the department or us) and what it is, with
// what the AI read in it in two lines (more on a click), what the portal's own
// record says (an appeal's order, amounts, pre-deposit and documents; a hearing's
// date and place), its files as chips, and whether it is new since the case was
// last opened. Only "Work on it" leaves for the notice's workspace.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, FileText, Loader2, Paperclip, Scale, Sparkles } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { EmptyBox } from '@/components/notices/autopilot/parts';
import { StageBadge } from '@/components/notices/StageBadge';
import type { CaseItem, CaseItemFacts, KeyDate } from '@/lib/noticeCases';
import { fmtAiTokens, fmtDate, fmtDateTime, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SECTION_KIND: Record<string, string> = { NOTICES: 'Notice', ORDRS: 'Order', REPLY: 'Reply', APLCN: 'Application', OTHERS: 'Document' };

function kindOf(it: CaseItem): string {
  if (it.kind === 'notice') return 'Notice';
  if (it.facts?.form === 'APL-01') return 'Appeal';
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-xs font-medium">{children}</dd>
    </div>
  );
}

/** What the portal's record says: an appeal's order and money, a hearing, documents not downloaded yet. */
function PortalFacts({ f, files }: { f: CaseItemFacts; files: { url?: string }[] }) {
  const appeal = f.form === 'APL-01' || (f.order_ref && f.predeposit !== undefined);
  const missing = (f.portal_docs ?? []).filter((d) => !files.some((a) => a.url?.includes(`/${d.id}.pdf`)));
  return (
    <>
      {appeal && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-dashed px-2.5 py-2 sm:grid-cols-4">
          {f.order_ref && <Fact label="Against order"><span className="font-mono text-[11px]">{f.order_ref}</span>{f.order_date ? ` of ${fmtDate(f.order_date)}` : ''}</Fact>}
          {f.order_comm_date && f.order_comm_date !== f.order_date && <Fact label="Order communicated">{fmtDate(f.order_comm_date)}</Fact>}
          {f.disputed_tax !== undefined && <Fact label="Tax in dispute">{fmtInr(f.disputed_tax)}</Fact>}
          {f.disputed_total !== undefined && <Fact label="Total in dispute">{fmtInr(f.disputed_total)}</Fact>}
          {f.predeposit !== undefined && <Fact label={`Pre-deposit paid${f.predeposit_pct ? ` (${f.predeposit_pct}%)` : ''}`}>{fmtInr(f.predeposit)}{f.predeposit_prn && <span className="block font-mono text-[11px] text-muted-foreground">PRN {f.predeposit_prn}</span>}</Fact>}
          {f.filed_on && <Fact label="Filed on">{fmtDate(f.filed_on)}</Fact>}
          {f.portal_status && <Fact label="Status on the portal">{f.portal_status}</Fact>}
          {f.issues && f.issues.length > 0 && <div className="col-span-2 sm:col-span-4"><Fact label="Issues appealed">{f.issues.join('; ')}</Fact></div>}
        </dl>
      )}
      {f.hearing && (
        <p className="text-xs"><CalendarClock className="mr-1 inline h-3.5 w-3.5 text-warning" aria-hidden />
          Personal hearing on <span className="font-medium">{fmtDate(f.hearing.date)}</span>{f.hearing.time ? ` at ${f.hearing.time}` : ''}{f.hearing.venue ? `, ${f.hearing.venue}` : ''}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-[11px] text-muted-foreground" title="The portal lists these with the item; the extension has not downloaded them yet">
          On the portal, not downloaded yet: {missing.map((d) => d.name && d.file && d.name !== d.file ? `${d.name} (${d.file})` : d.name || d.file || d.id).join(', ')}
        </p>
      )}
    </>
  );
}

const TONE: Record<KeyDate['tone'], { dot: string; text: string; border: string }> = {
  ok: { dot: 'bg-success/20 text-success', text: 'text-success', border: 'border-success/30' },
  warn: { dot: 'bg-warning/20 text-warning', text: 'text-warning', border: 'border-warning/40' },
  danger: { dot: 'bg-destructive/15 text-destructive', text: 'text-destructive', border: 'border-destructive/40' },
  info: { dot: 'bg-info/15 text-info', text: 'text-info', border: 'border-info/30' },
  muted: { dot: 'bg-muted text-muted-foreground', text: 'text-foreground/80', border: 'border-border' },
};

function KeyDateRow({ k, partName }: { k: KeyDate; partName: string | null }) {
  const t = TONE[k.tone] ?? TONE.muted;
  const Icon = ['appeal_filed', 'predeposit', 'appeal_window', 'adjournment'].includes(k.kind) ? Scale : CalendarClock;
  return (
    <div className={cn('mb-3 min-w-0 flex-1 rounded-lg border border-dashed px-3 py-2', t.border, k.tone === 'muted' && 'opacity-80')}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn('inline-flex items-center gap-1 font-semibold', t.text)}><Icon className="h-3.5 w-3.5" aria-hidden /> Key date</span>
        {k.upcoming && <Badge variant="warning" className="text-[10px]">Upcoming</Badge>}
        {partName && <Badge variant="secondary" className="text-[10px]">{partName}</Badge>}
        {k.law && <span className="ml-auto font-mono text-[10px] text-muted-foreground" title="The provision of the CGST Act">{k.law}</span>}
      </div>
      <div className={cn('text-sm font-semibold leading-snug', t.text)}>{k.title}</div>
      {k.detail && <p className="text-xs text-muted-foreground">{k.detail}</p>}
    </div>
  );
}

type Entry = { type: 'item'; date: string | null; it: CaseItem } | { type: 'key'; date: string; k: KeyDate };

export const CaseTimeline: React.FC<{
  items: CaseItem[];
  /** The dates the law attaches to the papers (notice_case_key_dates). */
  keyDates?: KeyDate[];
  /** For a chain of linked cases: the short name of the case an item is in (null: say nothing). */
  partOf?: (ownKey: string | null | undefined) => string | null;
  /** Oldest first (the story of the case) or newest first. */
  order?: 'oldest' | 'newest';
  /** A notice to mark and scroll to (the one the case was opened from). */
  focusId?: string | null;
}> = ({ items, keyDates, partOf, order = 'oldest', focusId }) => {
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, items.length]);
  if (!items.length && !keyDates?.length) return <EmptyBox className="p-4">Nothing in this case yet.</EmptyBox>;
  const entries: Entry[] = [
    ...items.map((it) => ({ type: 'item' as const, date: it.date, it })),
    ...(keyDates ?? []).map((k) => ({ type: 'key' as const, date: k.date, k })),
  ];
  const dir = order === 'oldest' ? 1 : -1;
  entries.sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
    const c = a.date.slice(0, 10).localeCompare(b.date.slice(0, 10));
    if (c) return c * dir;
    // On one day the paper comes before what the law makes of it.
    return (a.type === b.type ? 0 : a.type === 'item' ? -1 : 1) * dir;
  });
  return (
    <ol className="relative">
      {entries.map((e, idx) => {
        const last = idx === entries.length - 1;
        if (e.type === 'key') {
          const t = TONE[e.k.tone] ?? TONE.muted;
          return (
            <li key={`key:${e.k.kind}:${e.k.date}:${idx}`} className="flex gap-3">
              <DateTile date={e.k.date} />
              <div className="relative flex w-5 shrink-0 justify-center">
                {!last && <span className="absolute bottom-0 top-6 w-px bg-border" aria-hidden />}
                <span className={cn('relative mt-1.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-card', t.dot)} title="A date the law attaches">
                  <CalendarClock className="h-3 w-3" aria-hidden />
                </span>
              </div>
              <KeyDateRow k={e.k} partName={partOf?.(e.k.own_key) ?? null} />
            </li>
          );
        }
        const it = e.it;
        const dept = it.from === 'department';
        const files = (it.attachments ?? []).filter((a) => a?.url);
        const title = it.kind === 'notice' ? it.label : it.facts?.form === 'APL-01' ? it.label : it.ai?.title || it.label;
        const focused = !!focusId && it.id === focusId;
        return (
          <li key={`${it.kind}:${it.id}`} ref={focused ? focusRef : undefined} className="flex gap-3">
            <DateTile date={it.date} />
            <div className="relative flex w-5 shrink-0 justify-center">
              {!last && <span className="absolute bottom-0 top-6 w-px bg-border" aria-hidden />}
              <span className={cn('relative mt-1.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-card',
                dept ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success')} title={dept ? 'From the department' : 'From us'}>
                {dept ? <ArrowDownLeft className="h-3 w-3" aria-hidden /> : <ArrowUpRight className="h-3 w-3" aria-hidden />}
              </span>
            </div>
            <div className={cn('mb-3 min-w-0 flex-1 space-y-1.5 rounded-lg border p-3',
              focused ? 'border-primary ring-2 ring-primary/30' : it.is_new ? 'border-info/50 bg-info/5' : 'bg-card')}>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={cn('rounded px-1.5 py-0.5 font-semibold', dept ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}>
                  {dept ? 'Department' : 'Us'} · {kindOf(it)}
                </span>
                {partOf?.(it.own_key) && <Badge variant="secondary" className="text-[10px]" title={it.own_key ?? undefined}>{partOf(it.own_key)}</Badge>}
                {it.is_new && <Badge variant="info" className="text-[10px]">New</Badge>}
                {focused && <Badge variant="info" className="text-[10px]">Opened from here</Badge>}
                {it.kind === 'notice' && it.is_open && <StageBadge stage={it.stage} />}
                {it.ai?.outcome && !/^(other|none|unknown|n\/?a|pending)$/i.test(it.ai.outcome.trim()) && <Badge variant="secondary" className="text-[10px]">Outcome: {it.ai.outcome}</Badge>}
                {it.reference && <span className="ml-auto font-mono text-[10px] text-muted-foreground" title={it.arrived_at ? `Seen on the portal ${fmtDateTime(it.arrived_at)}` : undefined}>{it.reference}</span>}
              </div>
              <div className="text-sm font-semibold leading-snug">{title}</div>
              <Reading it={it} />
              {it.facts && <PortalFacts f={it.facts} files={files} />}
              {(it.pdf_url || files.length > 0 || it.kind === 'notice') && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {it.pdf_url && <FileChip href={it.pdf_url} label="Notice PDF" primary />}
                  {files.slice(0, 8).map((a, i) => <FileChip key={i} href={a.url as string} label={a.label || `File ${i + 1}`} />)}
                  {files.length > 8 && <span className="self-center text-[11px] text-muted-foreground">+{files.length - 8} more</span>}
                  {it.kind === 'notice' && (
                    <Link to={`/notices/${it.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      Work on it <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  )}
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
