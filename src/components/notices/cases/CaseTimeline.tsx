// A case's timeline: every notice and every document of its portal case folder
// (an appeal's APL-01 included), and the dates the law attaches to them (time to
// appeal, pre-deposit, hearings, adjournments, replies due, the windows to pay
// and close), on one dated rail, oldest first by default (the firm, 25 October
// 2026: "chronological events are extremely important to understand"). Each
// paper is marked by who sent it (the department or us) and what it is, with
// what the AI read in it in two lines (more on a click), what the portal's own
// record says (an appeal's order, amounts, pre-deposit and documents; a hearing's
// date and place), its files as chips, and whether it is new since the case was
// last opened. Only "Work on it" leaves for the notice's workspace; an appeal's
// own papers open the case's Appeal view instead (28 October 2026).
// Laid out again on 27 October 2026 (the firm: design improvement "extremely
// needed", nothing taken away): the papers fall into the phases of the
// proceeding (scrutiny, intimation, show cause, order, appeal, recovery), each
// under its own heading, with a journey strip above that jumps to a phase; a
// paper's title leads and its sender, kind and reference follow on one line;
// no text is smaller than 12px.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, ChevronDown, ChevronUp, FileText, Loader2, Paperclip, Scale, Sparkles } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { EmptyBox } from '@/components/notices/autopilot/parts';
import { StageBadge } from '@/components/notices/StageBadge';
import type { CaseItem, CaseItemFacts, KeyDate } from '@/lib/noticeCases';
import { readingNote, scanReading } from '@/lib/noticeAi';
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

/** The form code a paper carries: the portal's record, else the "DRC-07 · ..." label's lead. */
function formOf(it: CaseItem): string | null {
  if (it.facts?.form) return it.facts.form.toUpperCase();
  const m = /^([A-Z]{2,6}(?:-[A-Z0-9]+)*)\s·/.exec(it.label ?? '');
  return m ? m[1].toUpperCase() : null;
}

/** The phases of a proceeding, in the order the law runs them. */
type Phase = 'scrutiny' | 'intimation' | 'show_cause' | 'order' | 'appeal' | 'appeal_order' | 'recovery' | 'registration' | 'correspondence';
const PHASE_LABEL: Record<Phase, string> = {
  scrutiny: 'Scrutiny or audit',
  intimation: 'Intimation',
  show_cause: 'Show cause notice',
  order: 'Order',
  appeal: 'Appeal',
  appeal_order: 'Appeal order',
  recovery: 'Recovery',
  registration: 'Registration',
  correspondence: 'Correspondence',
};

/**
 * The phase a department paper (or our appeal) opens, or null when the paper
 * belongs to the phase already running (a reply, a hearing notice, a letter).
 */
function phaseOpenedBy(it: CaseItem): Phase | null {
  const form = formOf(it);
  if (form) {
    if (form === 'APL-04' || form === 'APL-05') return 'appeal_order';
    if (form.startsWith('APL')) return form === 'APL-01' || form === 'APL-02' ? 'appeal' : null;
    if (/^(ASMT|ADT)/.test(form)) return form === 'ASMT-11' ? null : 'scrutiny';
    if (form === 'DRC-01A') return 'intimation';
    if (form === 'DRC-01' || form === 'DRC-01B' || form === 'DRC-01C') return it.from === 'department' ? 'show_cause' : null;
    if (/^DRC-0[78]/.test(form) || form === 'RECT-ORDER' || form === 'ASMT-13' || form === 'ASMT-15') return 'order';
    if (/^DRC-(09|1[0-6])/.test(form)) return 'recovery';
    if (form.startsWith('REG')) return 'registration';
  }
  if (it.from === 'department' && it.ai?.doc_kind === 'order') return 'order';
  return null;
}

type Entry = { type: 'item'; date: string | null; it: CaseItem } | { type: 'key'; date: string; k: KeyDate };
type Section = { key: string; phase: Phase; no: number; entries: Entry[]; from: string | null; to: string | null };

function byDate(dir: 1 | -1) {
  return (a: Entry, b: Entry) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
    const c = a.date.slice(0, 10).localeCompare(b.date.slice(0, 10));
    if (c) return c * dir;
    // On one day the paper comes before what the law makes of it.
    return (a.type === b.type ? 0 : a.type === 'item' ? -1 : 1) * dir;
  };
}

/**
 * The entries cut into phases. Phases are found reading oldest first (a reply
 * belongs to the notice before it, a key date to the paper it follows), then
 * the phases and their entries are laid out in the order asked for.
 */
function sectionsOf(entries: Entry[], order: 'oldest' | 'newest'): Section[] {
  const chrono = [...entries].sort(byDate(1));
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const e of chrono) {
    const opened = e.type === 'item' ? phaseOpenedBy(e.it) : null;
    if (!cur || (opened && opened !== cur.phase)) {
      cur = { key: `${out.length}`, phase: opened ?? 'correspondence', no: out.length + 1, entries: [], from: null, to: null };
      out.push(cur);
    } else if (cur.phase === 'correspondence' && opened) {
      cur.phase = opened;
    }
    cur.entries.push(e);
    if (e.date) { cur.from = cur.from ?? e.date; cur.to = e.date; }
  }
  if (order === 'newest') {
    out.reverse();
    for (const s of out) s.entries.sort(byDate(-1));
  }
  return out;
}

const monthYear = (d: string | null) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '');
const span = (s: Section) => {
  const a = monthYear(s.from), b = monthYear(s.to);
  return a && b && a !== b ? `${a} to ${b}` : a || b || 'undated';
};

function DateTile({ date }: { date: string | null }) {
  if (!date) return <div className="w-16 shrink-0 pt-1 text-center text-xs text-muted-foreground">undated</div>;
  const [y, m, d] = date.slice(0, 10).split('-');
  return (
    <div className="w-16 shrink-0 pt-0.5 text-center leading-tight">
      <div className="text-xl font-bold tabular-nums">{Number(d)}</div>
      <div className="text-xs text-muted-foreground">{MONTHS[Number(m) - 1]} {y}</div>
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
    const scan = scanReading(it.notice_read?.summary ? it.notice_read.usage : it.ai?.usage);
    return (
      <div className="rounded-md border-l-2 border-primary/30 bg-muted/40 px-3 py-2">
        <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden /> What it says
          {scan && <span className="font-normal" title="Read as the pages look: check figures and numbers against the paper">· read from a scan</span>}
          {tokens && <span className="ml-auto whitespace-nowrap font-normal tabular-nums" title="Tokens the AI used to read it">{tokens}</span>}
        </div>
        <p className={cn('text-sm leading-relaxed text-foreground/90', !more && 'line-clamp-2')}>{text}</p>
        {scan?.doubts.map((d) => <p key={d} className="mt-0.5 text-xs text-warning">{d}</p>)}
        {long && (
          <button type="button" onClick={() => setMore((v) => !v)} className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
            {more ? <>Show less <ChevronUp className="h-3.5 w-3.5" aria-hidden /></> : <>Read all <ChevronDown className="h-3.5 w-3.5" aria-hidden /></>}
          </button>
        )}
      </div>
    );
  }
  if (reading) return <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> The AI is reading it</p>;
  const note = it.ai && !it.notice_read?.summary ? readingNote({ status: it.ai.status, reason_class: it.ai.reason_class ?? null, pages: null }) : null;
  if (note) return <p className="text-xs text-muted-foreground">{note}</p>;
  return null;
}

function FileChip({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={label}
      className={cn('inline-flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5',
        primary ? 'border-primary/30 bg-primary/5 font-medium text-primary' : 'text-foreground/80')}>
      {primary ? <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="truncate">{label}</span>
    </a>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{children}</dd>
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
        <div className="rounded-md border bg-muted/20">
          <div className="border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground">The appeal as the portal records it</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3 py-2.5 sm:grid-cols-4">
            {f.order_ref && <Fact label="Against order"><span className="font-mono text-[13px]">{f.order_ref}</span>{f.order_date ? <span className="block text-xs font-normal text-muted-foreground">of {fmtDate(f.order_date)}</span> : null}</Fact>}
            {f.order_comm_date && f.order_comm_date !== f.order_date && <Fact label="Order communicated">{fmtDate(f.order_comm_date)}</Fact>}
            {f.disputed_tax !== undefined && <Fact label="Tax in dispute">{fmtInr(f.disputed_tax)}</Fact>}
            {f.disputed_total !== undefined && <Fact label="Total in dispute">{fmtInr(f.disputed_total)}</Fact>}
            {f.predeposit !== undefined && <Fact label={`Pre-deposit paid${f.predeposit_pct ? ` (${f.predeposit_pct}%)` : ''}`}>{fmtInr(f.predeposit)}{f.predeposit_prn && <span className="block font-mono text-xs font-normal text-muted-foreground">PRN {f.predeposit_prn}</span>}</Fact>}
            {f.filed_on && <Fact label="Filed on">{fmtDate(f.filed_on)}</Fact>}
            {f.portal_status && <Fact label="Status on the portal">{f.portal_status}</Fact>}
          </dl>
          {f.issues && f.issues.length > 0 && (
            <div className="border-t px-3 py-2">
              <div className="text-xs text-muted-foreground">Issues appealed</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{f.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {f.hearing && (
        <p className="flex items-center gap-1.5 rounded-md bg-warning/10 px-3 py-1.5 text-sm">
          <CalendarClock className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>Personal hearing on <span className="font-semibold">{fmtDate(f.hearing.date)}</span>{f.hearing.time ? ` at ${f.hearing.time}` : ''}{f.hearing.venue ? `, ${f.hearing.venue}` : ''}</span>
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground" title="The portal lists these with the item; the extension has not downloaded them yet">
          On the portal, not downloaded yet: {missing.map((d) => d.name && d.file && d.name !== d.file ? `${d.name} (${d.file})` : d.name || d.file || d.id).join(', ')}
        </p>
      )}
    </>
  );
}

const TONE: Record<KeyDate['tone'], { dot: string; text: string; border: string; bg: string }> = {
  ok: { dot: 'bg-success/20 text-success', text: 'text-success-strong', border: 'border-success/40', bg: 'bg-success/5' },
  warn: { dot: 'bg-warning/20 text-warning', text: 'text-warning', border: 'border-warning/50', bg: 'bg-warning/5' },
  danger: { dot: 'bg-destructive/15 text-destructive', text: 'text-destructive-strong', border: 'border-destructive/50', bg: 'bg-destructive/5' },
  info: { dot: 'bg-info/15 text-info', text: 'text-info', border: 'border-info/40', bg: 'bg-info/5' },
  muted: { dot: 'bg-muted text-muted-foreground', text: 'text-foreground/85', border: 'border-border', bg: 'bg-muted/20' },
};

function KeyDateRow({ k, partName }: { k: KeyDate; partName: string | null }) {
  const t = TONE[k.tone] ?? TONE.muted;
  const Icon = ['appeal_filed', 'predeposit', 'appeal_window', 'adjournment', 'limitation', 'order_check', 'rectification'].includes(k.kind) ? Scale : CalendarClock;
  return (
    <div className={cn('mb-3 min-w-0 flex-1 rounded-lg border border-l-4 px-3 py-2', t.border, t.bg)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className={cn('h-4 w-4 shrink-0', t.text)} aria-hidden />
        <span className={cn('text-sm font-semibold leading-snug', t.text)}>{k.title}</span>
        {k.upcoming && <Badge variant="warning" className="text-xs">Upcoming</Badge>}
        {k.ground && <Badge variant="destructive" className="text-xs" title="Raise it in the reply or the appeal">Ground</Badge>}
        {k.time_barred && <Badge variant="success" className="text-xs">Time-barred</Badge>}
        {partName && <Badge variant="secondary" className="text-xs">{partName}</Badge>}
        {k.law && <span className="ml-auto rounded bg-card px-1.5 py-0.5 font-mono text-xs text-muted-foreground" title="The provision of the CGST Act">{k.law}</span>}
      </div>
      {k.detail && <p className="mt-0.5 pl-6 text-[13px] leading-relaxed text-muted-foreground">{k.detail}</p>}
    </div>
  );
}

/** The phases of the case, in a row, each a jump to its part of the timeline. */
const Journey: React.FC<{ sections: Section[]; onJump: (key: string) => void }> = ({ sections, onJump }) => (
  <nav aria-label="Phases of the case" className="-mx-1 flex flex-wrap items-center gap-1 px-1 pb-1">
    {sections.map((s, i) => (
      <React.Fragment key={s.key}>
        {i > 0 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />}
        <button type="button" onClick={() => onJump(s.key)}
          className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{s.no}</span>
          <span className="text-sm font-medium">{PHASE_LABEL[s.phase]}</span>
          <span className="text-xs text-muted-foreground">{monthYear(s.from) || 'undated'}</span>
        </button>
      </React.Fragment>
    ))}
  </nav>
);

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
  /**
   * Where a notice's button goes (28 October 2026): an appeal's paper opens the
   * case's Appeal view, where its work is; null leaves the button out. Without
   * it every notice has Work on it, to its own page.
   */
  workLink?: (it: CaseItem) => { to: string; label: string } | null;
}> = ({ items, keyDates, partOf, order = 'oldest', focusId, workLink }) => {
  const focusRef = useRef<HTMLLIElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, items.length]);
  const sections = useMemo(() => sectionsOf([
    ...items.map((it) => ({ type: 'item' as const, date: it.date, it })),
    ...(keyDates ?? []).map((k) => ({ type: 'key' as const, date: k.date, k })),
  ], order), [items, keyDates, order]);
  if (!items.length && !keyDates?.length) return <EmptyBox className="p-4">Nothing in this case yet.</EmptyBox>;
  const jump = (key: string) => sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const renderEntry = (e: Entry, last: boolean) => {
    if (e.type === 'key') {
      const t = TONE[e.k.tone] ?? TONE.muted;
      return (
        <li key={`key:${e.k.kind}:${e.k.date}:${e.k.title}`} className="flex gap-3">
          <DateTile date={e.k.date} />
          <div className="relative flex w-6 shrink-0 justify-center">
            {!last && <span className="absolute bottom-0 top-7 w-px bg-border" aria-hidden />}
            <span className={cn('relative mt-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-card', t.dot)} title="A date the law attaches">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
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
    const part = partOf?.(it.own_key);
    const work = it.kind !== 'notice' ? null : workLink ? workLink(it) : { to: `/notices/${it.id}`, label: 'Work on it' };
    return (
      <li key={`${it.kind}:${it.id}`} ref={focused ? focusRef : undefined} className="flex gap-3">
        <DateTile date={it.date} />
        <div className="relative flex w-6 shrink-0 justify-center">
          {!last && <span className="absolute bottom-0 top-7 w-px bg-border" aria-hidden />}
          <span className={cn('relative mt-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-card',
            dept ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success')} title={dept ? 'From the department' : 'From us'}>
            {dept ? <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden /> : <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
          </span>
        </div>
        <div className={cn('mb-3 min-w-0 flex-1 space-y-2 rounded-lg border border-l-4 p-3.5 shadow-sm',
          dept ? 'border-l-warning/60' : 'border-l-success/60',
          focused ? 'border-primary ring-2 ring-primary/30' : it.is_new ? 'border-info/50 bg-info/5' : 'bg-card')}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h4 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">{title}</h4>
            <div className="flex flex-wrap items-center gap-1.5">
              {it.is_new && <Badge variant="info" className="text-xs">New</Badge>}
              {focused && <Badge variant="info" className="text-xs">Opened from here</Badge>}
              {it.kind === 'notice' && it.is_open && <StageBadge stage={it.stage} className="text-xs" />}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className={cn('font-semibold', dept ? 'text-warning' : 'text-success-strong')}>
              {dept ? 'From the department' : 'From us'} · {kindOf(it)}
            </span>
            {it.reference && <><span aria-hidden>·</span><span className="font-mono" title={it.arrived_at ? `Seen on the portal ${fmtDateTime(it.arrived_at)}` : undefined}>{it.reference}</span></>}
            {part && <Badge variant="secondary" className="text-xs" title={it.own_key ?? undefined}>{part}</Badge>}
            {it.ai?.outcome && !/^(other|none|unknown|n\/?a|pending)$/i.test(it.ai.outcome.trim()) && <Badge variant="secondary" className="text-xs">Outcome: {it.ai.outcome}</Badge>}
          </div>
          <Reading it={it} />
          {it.facts && <PortalFacts f={it.facts} files={files} />}
          {(it.pdf_url || files.length > 0 || work) && (
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
              {it.pdf_url && <FileChip href={it.pdf_url} label="Notice PDF" primary />}
              {files.slice(0, 8).map((a, i) => <FileChip key={i} href={a.url as string} label={a.label || `File ${i + 1}`} />)}
              {files.length > 8 && <span className="self-center text-xs text-muted-foreground">+{files.length - 8} more</span>}
              {work && (
                <Link to={work.to} className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 px-2.5 text-xs font-semibold text-primary hover:bg-primary/5">
                  {work.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {sections.length > 1 && <Journey sections={sections} onJump={jump} />}
      {sections.map((s) => {
        const papers = s.entries.filter((e) => e.type === 'item').length;
        const dates = s.entries.length - papers;
        return (
          <section key={s.key} ref={(el) => { sectionRefs.current[s.key] = el; }} className="scroll-mt-4" aria-label={PHASE_LABEL[s.phase]}>
            <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b pb-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{s.no}</span>
              <h3 className="text-base font-semibold">{PHASE_LABEL[s.phase]}</h3>
              <span className="text-sm text-muted-foreground">{span(s)}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {papers} paper{papers === 1 ? '' : 's'}{dates ? ` · ${dates} key date${dates === 1 ? '' : 's'}` : ''}
              </span>
            </header>
            <ol className="relative">
              {s.entries.map((e, idx) => renderEntry(e, idx === s.entries.length - 1))}
            </ol>
          </section>
        );
      })}
    </div>
  );
};

export default CaseTimeline;
