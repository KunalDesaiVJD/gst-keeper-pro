// One refund at /refunds/:clientId/:arn (the firm's choice of 25 October 2026:
// one page per refund, in the style of the case page, for every refund and not
// only the quarter that carry a notice). What it is, where it stands and what to
// do next, the steps with their dates, the amounts and where each was read, the
// cases linked to it, and its history on the portal with each paper's
// documents; the application's own documents fold away under it. The Refunds
// page's grid and register open it; the case page and the case folder of a
// refund point to it. A refund is not a case (the firm, 27 October 2026): a
// refund's case page lands here, and its links are made here. Laid out on 27
// October 2026 (the firm: "not structured, not in order, fonts too small"):
// every fact kept, in numbered parts with a jump bar, the next step and its
// date in a banner, the amounts and the clocks as large tiles. An order of the
// refund that rejects any part is appealed from here (28 October 2026: "there is
// no work on it in appeal in refunds"): a Refund | Appeal switch (?side=appeal)
// opens the case's Appeal view, the same one the case page has, with the
// refund's rejection on it, the drafts, the road and the appeal's papers.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, FileText, FolderDown, GitBranch, Info, Loader2, Scale, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_PAGE } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { InfoTip } from '@/components/notices/ui/Panel';
import { StageBadge } from '@/components/notices/StageBadge';
import { sectionLabel, toEvent, type CaseEvent, type FolderItem } from '@/components/notices/clients/caseFolder';
import { useRefundLedger, type ReadAmount, type RefundRow } from '@/components/notices/reports/ledgerData';
import { daysTo } from '@/components/notices/reports/ledgerStatus';
import { MoneyBar, MoneyLegend, RefundWhenChip, StepRoad, TonePill } from '@/components/notices/reports/RefundBits';
import {
  fyLabel, linkWord, moneyOf, placeOf, refundClocks, refundHref, refundPeriod, refundSteps, outcomeOf, toneOf, typeCode, typeLong,
} from '@/components/notices/reports/refundModel';
import { downloadZip } from '@/components/notices/reports/zip';
import { AppealFacts } from '@/components/notices/autopilot/PortalAppeal';
import { CaseChainPanel } from '@/components/notices/cases/CaseChainPanel';
import { AppealWorkspace } from '@/components/notices/cases/AppealWorkspace';
import { usePortalApps } from '@/lib/portalAppeal';
import { caseHref, loadCaseItems, loadKeyDates } from '@/lib/noticeCases';
import { loadCaseReadings, readingNote, scanReading, type DocReading } from '@/lib/noticeAi';
import { appealsShown, useCaseAppeals } from '@/lib/noticeAppeals';
import { istToday } from '@/lib/noticeFacts';
import { dueWords, fmtAiTokens, fmtDate, fmtInr, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const TAB_LABEL: Record<string, string> = {
  APPLICATIONS: 'Application', ORDERS: 'Orders', 'NOTICE/ ACKNOWLEDGEMENT': 'Notices and acknowledgements', REPLIES: 'Replies',
};

const DocChip: React.FC<{ label: string; url: string }> = ({ label, url }) => (
  <a href={url} target="_blank" rel="noreferrer" title={label}
    className="inline-flex max-w-[20rem] items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[13px] text-foreground/90 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    <span className="truncate">{label}</span><span className="sr-only"> (PDF, opens in a new tab)</span>
  </a>
);

/**
 * One numbered part of the page (the firm's request of 27 October 2026: every
 * fact kept, but in a clear order, with headings and figures large enough to
 * read). The jump bar under the header lists the same parts.
 */
const Part: React.FC<{
  id: string; no?: number; title: React.ReactNode; aside?: React.ReactNode; info?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}> = ({ id, no, title, aside, info, actions, children, className }) => (
  <section id={id} aria-labelledby={`${id}-h`} className={cn('scroll-mt-4 rounded-xl border bg-card shadow-sm', className)}>
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5">
        {no !== undefined && <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{no}</span>}
        <h2 id={`${id}-h`} className="flex items-center gap-1.5 text-base font-semibold leading-tight sm:text-[17px]">{title}{info && <InfoTip>{info}</InfoTip>}</h2>
        {aside && <span className="min-w-0 text-sm text-muted-foreground">{aside}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    <div className="space-y-3 px-4 py-4 sm:px-5">{children}</div>
  </section>
);

const FIGURE_TONE = {
  plain: 'border-l-border',
  good: 'border-l-success',
  bad: 'border-l-destructive',
  info: 'border-l-info',
} as const;

const Figure: React.FC<{ label: string; value: number | null | undefined; read?: ReadAmount | null; portal?: boolean; derived?: boolean; tone?: keyof typeof FIGURE_TONE }> = ({ label, value, read, portal, derived, tone = 'plain' }) => (
  <div className={cn('min-w-0 rounded-lg border border-l-4 bg-background px-3.5 py-3', value ? FIGURE_TONE[tone] : 'border-l-border')}>
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={cn('mt-1 text-2xl font-bold tabular-nums leading-tight', !value && 'font-normal text-muted-foreground', tone === 'good' && value && 'text-success-strong', tone === 'bad' && value && 'text-destructive-strong')}>
      {value ? fmtInr(value) : '—'}
    </div>
    <div className="mt-1 break-words text-xs leading-snug text-muted-foreground">
      {!value ? 'not on record' : portal ? 'from the portal' : read ? `AI, from ${read.from}` : derived ? 'claimed less sanctioned' : ''}
    </div>
  </div>
);

type Readings = Map<string, DocReading> | undefined;

/**
 * What the AI read in a paper's documents (28 October 2026: "system is not
 * showing properly anything related to refunds"): each one's summary, or why
 * it has none (being read, a scan).
 */
const PaperReadings: React.FC<{ files: { label: string; url: string }[]; readings: Readings }> = ({ files, readings }) => {
  const [more, setMore] = useState(false);
  if (!readings) return null;
  const rows = files.map((f) => ({ f, r: readings.get(f.url) })).filter((x) => x.r);
  const read = rows.filter((x) => x.r!.status === 'done' && x.r!.summary);
  const notes = rows.filter((x) => !(x.r!.status === 'done' && x.r!.summary)).map((x) => ({ f: x.f, note: readingNote(x.r) })).filter((x) => x.note);
  if (!read.length && !notes.length) return null;
  const long = read.length > 1 || read.some((x) => (x.r!.summary ?? '').length > 220);
  return (
    <div className="mt-2 rounded-md border-l-2 border-primary/30 bg-muted/40 px-3 py-2">
      {read.length > 0 && (
        <>
          <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden /> What it says
          </div>
          <ul className={cn('space-y-1 text-sm leading-relaxed text-foreground/90', !more && 'line-clamp-3')}>
            {read.map(({ f, r }) => {
              const tokens = fmtAiTokens(r!.usage, r!.model);
              const scan = scanReading(r!.usage);
              return (
                <li key={f.url}>
                  {files.length > 1 && <span className="font-medium">{f.label}: </span>}{r!.summary}
                  {scan && <span className="ml-1.5 whitespace-nowrap text-xs text-muted-foreground" title="Read as the pages look: check figures and numbers against the paper">read from a scan</span>}
                  {tokens && <span className="ml-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground" title="Tokens the AI used to read it">{tokens}</span>}
                  {scan?.doubts.map((d) => <span key={d} className="block text-xs text-warning">{d}</span>)}
                </li>
              );
            })}
          </ul>
          {long && (
            <button type="button" onClick={() => setMore((v) => !v)} className="mt-0.5 text-xs font-medium text-primary hover:underline">
              {more ? 'Show less' : 'Read all'}
            </button>
          )}
        </>
      )}
      {notes.length > 0 && (
        <ul className={cn('text-xs text-muted-foreground', read.length > 0 && 'mt-1')}>
          {notes.map(({ f, note }) => <li key={f.url}>{files.length > 1 ? `${f.label}: ` : ''}{note}</li>)}
        </ul>
      )}
    </div>
  );
};

const HistoryItem: React.FC<{ e: CaseEvent; last: boolean; readings: Readings }> = ({ e, last, readings }) => (
  <li className="relative grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
    <div className="pt-0.5 text-right">
      <div className="text-sm font-semibold tabular-nums">{e.date ? fmtDate(e.date) : 'date not shown'}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{sectionLabel(e.code)}</div>
    </div>
    <div className={cn('relative border-l-2 pl-5', last ? 'border-transparent pb-0' : 'border-border pb-5')}>
      <span aria-hidden className={cn('absolute -left-[7px] top-1.5 h-3 w-3 rounded-full ring-4 ring-card', e.code === 'REPLY' || e.code === 'APLCN' ? 'bg-success' : e.code === 'ORDRS' ? 'bg-primary' : 'bg-warning')} />
      <div className="break-words text-[15px] font-medium leading-snug">{e.title}</div>
      {(e.by || e.ref || e.due) && (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted-foreground">
          {e.by && <div><dt className="inline">{e.code === 'REPLY' || e.code === 'APLCN' ? 'Filed by ' : 'By '}</dt><dd className="inline text-foreground/80">{e.by}</dd></div>}
          {e.ref && <div><dt className="inline">Ref </dt><dd className="inline font-mono text-foreground/80">{e.ref}</dd></div>}
          {e.due && <div><dt className="inline">Reply due </dt><dd className="inline font-medium text-foreground/80">{fmtDate(e.due)}</dd></div>}
        </dl>
      )}
      {e.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{e.attachments.map((a, i) => <DocChip key={`${a.url}-${i}`} label={a.label} url={a.url} />)}</div>}
      <PaperReadings files={e.attachments} readings={readings} />
    </div>
  </li>
);

/** The time limits of a refund (s.54(1), rule 90(3), s.54(7), s.56), estimated from its type and period, one tile per clock. */
const RefundTimeLimits: React.FC<{ r: RefundRow; today: string; no: number }> = ({ r, today, no }) => {
  const c = refundClocks(r, today);
  if (!c.lines.length && !c.relevantBasis) return null;
  const TONE = { ok: 'text-success-strong', warn: 'text-warning', danger: 'text-destructive-strong', muted: 'text-muted-foreground' } as const;
  const EDGE = { ok: 'border-l-success', warn: 'border-l-warning', danger: 'border-l-destructive', muted: 'border-l-border' } as const;
  return (
    <Part id="limits" no={no} title="Time limits" aside={c.relevantDate ? <>Relevant date about <span className="font-medium text-foreground">{fmtDate(c.relevantDate)}</span></> : undefined}
      info="Estimated from the refund's type and period. Confirm the relevant date on the papers before relying on it.">
      {c.lines.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {c.lines.map((l) => (
            <li key={l.label} className={cn('rounded-lg border border-l-4 bg-background px-3.5 py-3', EDGE[l.tone])}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l.label}</div>
              <div className={cn('mt-1 text-xl font-bold tabular-nums', l.date ? TONE[l.tone] : 'font-normal text-muted-foreground')}>{l.date ? fmtDate(l.date) : '—'}</div>
              <div className="mt-1 text-[13px] text-muted-foreground">{l.note}</div>
            </li>
          ))}
        </ul>
      )}
      {c.interest > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-warning/40 bg-warning/[0.06] px-3.5 py-2.5 text-sm">
          Interest due to the client so far, at 6%: <span className="text-lg font-bold tabular-nums">{fmtInr(c.interest)}</span>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{c.relevantBasis}</p>
    </Part>
  );
};

/** A two-way switch in the header (as the case page's). */
function Toggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={cn('rounded px-2.5 py-1 text-xs font-medium', value === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {text}
        </button>
      ))}
    </div>
  );
}

const RefundBody: React.FC<{ r: RefundRow; today: string; canExport: boolean }> = ({ r, today, canExport }) => {
  const [allDocs, setAllDocs] = useState(false);
  const [zipping, setZipping] = useState(false);
  const clientId = r.fact.client_id as string;
  const arn = r.fact.arn as string;
  const navigate = useNavigate();
  // The appeal against the refund's order (notice_case_appeals reads the refund's case; 20261028100000 keeps a full sanction out).
  const [sp, setSp] = useSearchParams();
  const caseAppeals = useCaseAppeals(clientId, arn);
  const appealList = useMemo(() => appealsShown(caseAppeals.data), [caseAppeals.data]);
  const side: 'refund' | 'appeal' = sp.get('side') === 'appeal' && appealList.length > 0 ? 'appeal' : 'refund';
  const setSide = (v: 'refund' | 'appeal') => {
    const n = new URLSearchParams(sp);
    if (v === 'appeal') n.set('side', v); else { n.delete('side'); n.delete('appeal'); }
    setSp(n, { replace: true });
  };
  const setAppeal = (k: string) => { const n = new URLSearchParams(sp); n.set('appeal', k); setSp(n, { replace: true }); };
  const appealFiled = appealList.some((a) => a.status === 'filed');
  const appealItems = useQuery({ queryKey: ['notice-case-items', clientId, arn], queryFn: () => loadCaseItems(clientId, arn), enabled: side === 'appeal' });
  const appealDates = useQuery({ queryKey: ['notice-case-key-dates', clientId, arn], queryFn: () => loadKeyDates(clientId, arn), enabled: side === 'appeal' });
  const history = useQuery({
    queryKey: ['refund-folder', clientId, arn],
    enabled: r.hasFolder,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('gst_case_folder_items').select('*').eq('client_id', clientId).eq('case_id', arn).is('deleted_at', null);
      if (error) throw error;
      return ((data ?? []) as FolderItem[]).map(toEvent).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    },
  });
  const readings = useQuery({
    queryKey: ['refund-readings', clientId, arn],
    staleTime: 60_000,
    refetchInterval: (q) => ([...(q.state.data?.values() ?? [])].some((d) => d.status === 'queued' || d.status === 'running') ? 30_000 : false),
    queryFn: () => loadCaseReadings(clientId, arn),
  });
  // An appeal against this refund's order, from the portal's own record of it (no notice or case folder needed).
  const apps = usePortalApps(clientId);
  const appeals = (apps.data ?? []).filter((x) => x.appeal && x.target?.kind === 'refund' && x.target.key === arn);
  const docGroups = useMemo(() => {
    const g = new Map<string, { label: string; url: string }[]>();
    r.docs.forEach((d) => { const k = d.tab ?? 'Other'; g.set(k, [...(g.get(k) ?? []), d]); });
    return [...g.entries()];
  }, [r]);

  const s = r.state;
  const tone = toneOf(r);
  const outcome = outcomeOf(r);
  const code = typeCode(r);
  const period = refundPeriod(r);
  const place = placeOf(r);
  const d = daysTo(s.due, today);
  const portalSanctioned = r.fact.sanctioned_amount !== null;
  const events = history.data ?? [];
  const money = moneyOf(r);
  const clocks = refundClocks(r, today);
  const hasLimits = clocks.lines.length > 0 || !!clocks.relevantBasis;

  // The parts in the order they are read: where it stands, the money, the road, the clocks, the links, the papers.
  const parts = [
    { id: 'amounts', label: 'Amounts' },
    { id: 'steps', label: 'Steps' },
    ...(hasLimits ? [{ id: 'limits', label: 'Time limits' }] : []),
    { id: 'linked', label: 'Linked cases' },
    { id: 'history', label: 'History on the portal' },
    ...(r.docs.length ? [{ id: 'documents', label: 'All documents' }] : []),
  ];
  const noOf = (id: string) => parts.findIndex((p) => p.id === id) + 1;

  const zip = async () => {
    setZipping(true);
    const t = toast.loading(`Fetching ${plural(r.docs.length, 'PDF')}…`);
    try {
      const res = await downloadZip(r.docs.map((x) => ({ url: x.url, name: x.label })), `${r.fact.client_name ?? 'Client'} refund ${arn}.zip`);
      if (res.ok === 0) toast.error('None of the PDFs could be fetched.');
      else toast.success(`Saved ${plural(res.ok, 'PDF')} in one .zip${res.failed ? `; ${res.failed} could not be fetched` : ''}.`);
    } finally { setZipping(false); toast.dismiss(t); }
  };

  const nextText = s.next ?? (tone === 'withdrawn' ? 'Withdrawn: nothing to do'
    : tone === 'part' ? `${fmtInr(r.rejected)} rejected, the rest sanctioned`
    : tone === 'full' ? 'Sanctioned in full: nothing to do' : s.open ? 'With the officer' : 'Closed: nothing to do');

  return (
    <NoticesShell section="Refund" record crumbs={[
      { label: 'Refunds', to: '/refunds-all' },
      { label: r.fact.client_name ?? 'Client', to: `/refunds-all?client=${clientId}` },
      { label: arn, mono: true },
    ]}>

      {/* 1. What the refund is */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-medium text-muted-foreground">{r.fact.client_name ?? 'Client'}</div>
          <h1 className="font-heading text-xl font-bold leading-tight sm:text-2xl">{typeLong(code)}{period ? <span className="text-muted-foreground"> · {period}</span> : ''}</h1>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div><dt className="inline text-muted-foreground">Refund </dt><dd className="inline font-mono font-medium">{arn}</dd></div>
            <div><dt className="inline text-muted-foreground">Filed </dt><dd className="inline font-medium">{fmtDate(r.fact.filed_date)}</dd></div>
            {place && !place.byFiling && <div><dt className="inline text-muted-foreground">Quarter </dt><dd className="inline font-medium">{fyLabel(place.fy)} Q{place.q}</dd></div>}
            {r.period?.source === 'ai' && <div className="text-muted-foreground">period read by the AI</div>}
          </dl>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <RefundWhenChip r={r} className="px-2 py-1 text-xs" />
            <TonePill tone={outcome} className="px-2.5 py-1 text-xs" />
            <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
              <span className="text-muted-foreground">Portal status:</span> <span className="font-semibold">{r.fact.status ?? 'not captured'}</span>
            </span>
            {r.caseLink && <StageBadge stage={r.caseLink.stage} since={r.caseLink.stage_changed_at} by={r.caseLink.stage_changed_by} />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && r.docs.length > 0 && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={zip} disabled={zipping}>
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FolderDown className="h-3.5 w-3.5" aria-hidden />} All {plural(r.docs.length, 'PDF')} (.zip)
            </Button>
          )}
          {appealList.length > 0 && (
            <Toggle label="The refund or the appeal against its order" value={side} onChange={setSide}
              options={[['refund', 'Refund'], ['appeal', appealFiled ? 'Appeal' : 'Prepare appeal']]} />
          )}
          {r.caseLink && (side === 'refund' || appealList.length === 0) && (
            <Button size="sm" variant={appealList.length > 0 ? 'outline' : 'default'} className={WS_BTN} asChild>
              <Link to={`/notices/${r.caseLink.id}`}>{appealList.length > 0 || !r.caseLink.is_open ? 'Open the notice' : 'Work on it'}{appealList.length > 0 ? null : <ArrowRight className="h-3.5 w-3.5" aria-hidden />}</Link>
            </Button>
          )}
          {appealList.length > 0 && side === 'refund' && (
            <Button size="sm" className={WS_BTN} onClick={() => setSide('appeal')}>
              <Scale className="h-3.5 w-3.5" aria-hidden /> {appealFiled ? 'Work on the appeal' : 'Prepare the appeal'}
            </Button>
          )}
        </div>
      </header>

      {side === 'appeal' && (
        <AppealWorkspace clientId={clientId} caseKey={arn} appeals={appealList} all={caseAppeals.data} clientName={r.fact.client_name}
          items={appealItems.data} keyDates={appealDates.data} selected={sp.get('appeal')} onSelect={setAppeal} />
      )}

      {side === 'refund' && <>

      {/* 2. Where it stands and what to do, with the money at a glance */}
      <section aria-label={s.open ? 'Next step' : 'Where it stands'}
        className={cn('grid gap-4 rounded-xl border-2 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center',
          tone === 'action' ? 'border-destructive/50 bg-destructive/[0.04]' : s.open ? 'border-info/40 bg-info/[0.05]' : 'border-border bg-muted/30')}>
        <div className="min-w-0 space-y-1.5">
          <div className={cn('text-xs font-bold uppercase tracking-wider', tone === 'action' ? 'text-destructive-strong' : 'text-muted-foreground')}>{s.open ? 'Next step' : 'Where it stands'}</div>
          <div className={cn('text-xl font-bold leading-snug sm:text-2xl', tone === 'action' && 'text-destructive-strong')}>{nextText}</div>
          {s.basis && <div className="text-sm text-muted-foreground">{s.basis}</div>}
          {appeals.length > 0
            ? <div className="text-sm">Appeal {appeals.map((x) => x.row.arn).join(', ')} filed on {fmtDate(appeals[0].row.filed_date)}: {appeals[0].row.status ?? 'status not read'}. Its details are below.</div>
            : tone === 'part' && r.links.some((l) => l.kind === 'appeal') && <div className="text-sm">An appeal against it is linked below.</div>}
          {appealList.length > 0 && (
            <div className="pt-1">
              <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setSide('appeal')}>
                <Scale className="h-3.5 w-3.5" aria-hidden /> {appealFiled ? 'Work on the appeal' : 'Prepare the appeal: statement of facts, grounds, written submission'}
              </Button>
            </div>
          )}
        </div>
        {s.due && (
          <div className={cn('flex shrink-0 flex-col items-start rounded-lg border bg-card px-4 py-3 lg:items-end lg:text-right', d !== null && d < 0 ? 'border-destructive/60' : 'border-border')}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Do it by</div>
            <div className={cn('text-2xl font-bold tabular-nums leading-tight', d !== null && d < 0 ? 'text-destructive-strong' : 'text-foreground')}>{fmtDate(s.due)}</div>
            <div className={cn('text-sm font-medium', d !== null && d < 0 ? 'text-destructive-strong' : d !== null && d <= 7 ? 'text-warning' : 'text-muted-foreground')}>{dueWords(d).replace('due ', '')}</div>
          </div>
        )}
      </section>

      <nav aria-label="On this page" className="-mt-1 flex flex-wrap gap-1.5">
        {parts.map((p, i) => (
          <a key={p.id} href={`#${p.id}`} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-[13px] font-medium text-foreground/80 hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-xs font-bold text-primary">{i + 1}</span>{p.label}
          </a>
        ))}
      </nav>

      {appeals.map(({ row, appeal, files }) => appeal && (
        <Part key={row.id} id={`appeal-${row.arn}`} className="border-warning/50"
          title={<span className="inline-flex items-center gap-1.5"><GitBranch className="h-4 w-4" aria-hidden /> Appeal {row.arn}</span>}
          aside="From the portal's record of the appeal and its case folder">
          <AppealFacts a={appeal} files={files} />
        </Part>
      ))}

      <Part id="amounts" no={noOf('amounts')} title="Amounts" aside={r.read ? `read from ${plural(r.read.documents, 'document')} of the refund where the portal has none` : undefined}>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-5">
          <Figure label="Claimed" value={r.claimed} read={r.fact.claimed_amount === null ? r.read?.claimed : null} portal={r.fact.claimed_amount !== null} tone="info" />
          <Figure label="Provisional (RFD-04)" value={r.read?.provisional?.value} read={r.read?.provisional} />
          <Figure label="Sanctioned" value={r.sanctioned} read={portalSanctioned ? null : r.read?.sanctioned} portal={portalSanctioned} tone="good" />
          <Figure label="Rejected" value={r.rejected} read={r.read?.rejected} derived={!r.read?.rejected} tone="bad" />
          <Figure label="Paid" value={r.read?.paid?.value} read={r.read?.paid} tone="good" />
        </div>
        <div className="space-y-2 pt-1">
          <MoneyBar m={money} className="h-3" />
          <MoneyLegend m={money} />
        </div>
      </Part>

      <Part id="steps" no={noOf('steps')} title="Steps"><StepRoad steps={refundSteps(r)} large /></Part>

      <RefundTimeLimits r={r} today={today} no={noOf('limits')} />

      {/* A refund is not a case (27 October 2026), so its links are kept here: with
          a notice on record the refund has a portal case, and the chain panel links,
          unlinks and suggests as the case page did. */}
      <div id="linked" className="scroll-mt-4">
        {r.hasCasePage ? (
          <CaseChainPanel clientId={clientId} caseKey={arn} part={null} track="refund"
            onPart={(k) => { if (k && k !== arn) navigate(caseHref(clientId, k)); }} />
        ) : (
          <Part id="linked-list" no={noOf('linked')} title={<span className="inline-flex items-center gap-1.5"><GitBranch className="h-4 w-4" aria-hidden /> Linked cases</span>}
            aside={r.links.length ? plural(r.links.length, 'case') : 'none'}>
            {r.links.length === 0 ? (
              <p className="text-sm text-muted-foreground">No appeal, fresh application or other case is linked to this refund.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {r.links.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', l.kind === 'appeal' ? 'bg-warning/20' : 'bg-muted')}>{linkWord(l.kind, l.dir)}</span>
                    <span className="font-mono text-sm">{l.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {l.refund ? `refund${l.refund.status ? ` · ${l.refund.status}` : ''}${l.refund.filed ? ` · filed ${fmtDate(l.refund.filed)}` : ''}` : l.title ?? ''}
                      {l.isOpen !== null && <> · {l.isOpen ? 'open' : 'closed'}</>}
                      {l.source === 'manual' ? ' · linked by staff' : ''}
                    </span>
                    {l.refund ? (
                      <Button asChild size="sm" variant="ghost" className="h-8 px-2.5 text-sm"><Link to={refundHref(clientId, l.key)}>Open <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
                    ) : l.hasPage ? (
                      <Button asChild size="sm" variant="ghost" className="h-8 px-2.5 text-sm"><Link to={caseHref(clientId, l.key)}>Open <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
                    ) : appeals.some((x) => x.row.arn === l.key) ? (
                      <Button asChild size="sm" variant="ghost" className="h-8 px-2.5 text-sm"><a href={`#appeal-${l.key}`}>Details above</a></Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Part>
        )}
      </div>

      <Part id="history" no={noOf('history')} title="History on the portal" aside={events.length ? `${plural(events.length, 'paper')}, oldest first, each with its documents` : undefined}>
        {!r.hasFolder ? (
          <p className="text-sm text-muted-foreground">The portal case folder has not been fetched for this refund yet; it fills in at the client's next refund fetch.</p>
        ) : history.isLoading ? <Skeleton className="h-32 w-full" />
          : history.error ? <Note tone="warn">Couldn't load the history: {history.error instanceof Error ? history.error.message : String(history.error)}</Note>
          : <ol className="pt-1">{events.map((e, i) => <HistoryItem key={e.id} e={e} last={i === events.length - 1} readings={readings.data} />)}</ol>}
      </Part>

      {r.docs.length > 0 && (
        <Part id="documents" no={noOf('documents')} title="All documents" aside={`${r.docs.length} · the application's documents by portal tab`}
          actions={
            <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setAllDocs((v) => !v)} aria-expanded={allDocs} aria-controls="documents-list">
              {allDocs ? 'Hide' : 'Show all'} <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', allDocs && 'rotate-180')} aria-hidden />
            </Button>
          }>
          {allDocs ? (
            <div id="documents-list" className="grid gap-4 md:grid-cols-2">
              {docGroups.map(([tab, list]) => (
                <div key={tab} className="rounded-lg border bg-background p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{TAB_LABEL[tab] ?? tab} · {list.length}</div>
                  <div className="flex flex-wrap gap-1.5">{list.map((x, i) => <DocChip key={`${x.url}-${i}`} label={x.label} url={x.url} />)}</div>
                  <PaperReadings files={list} readings={readings.data} />
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">The application's documents by portal tab. The papers in the history above carry their own.</p>}
        </Part>
      )}
      </>}
    </NoticesShell>
  );
};

const RefundPage: React.FC = () => {
  const { clientId = '', arn = '' } = useParams<{ clientId: string; arn: string }>();
  const { isStaffRole, canExportData } = useAuth();
  const ledger = useRefundLedger(clientId);
  const row = useMemo(() => (ledger.data ?? []).find((r) => r.fact.arn === arn) ?? null, [ledger.data, arn]);
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  if (ledger.error) return <div className={WS_PAGE}><Note tone="warn">Couldn't load the refund: {ledger.error instanceof Error ? ledger.error.message : String(ledger.error)}</Note></div>;
  if (!ledger.data) return <div className={WS_PAGE}><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64 w-full" /></div>;
  if (!row) {
    return (
      <div className={WS_PAGE}>
        <Note tone="info">No refund {arn} on record for this client. <Link to={`/refunds-all?client=${clientId}`} className="text-primary underline">The client's refunds</Link></Note>
      </div>
    );
  }
  return <RefundBody r={row} today={istToday()} canExport={canExportData()} />;
};

export default RefundPage;
