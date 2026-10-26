// One refund at /refunds/:clientId/:arn (the firm's choice of 25 October 2026:
// one page per refund, in the style of the case page, for every refund and not
// only the quarter that carry a notice). What it is, where it stands and what to
// do next, the steps with their dates, the amounts and where each was read, the
// cases linked to it, and its history on the portal with each paper's
// documents; the application's own documents fold away under it. The Refunds
// page's grid and register open it; the case page and the case folder of a
// refund point to it.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, FileText, FolderDown, GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_PAGE } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { SectionCard } from '@/components/notices/ui/Panel';
import { StageBadge } from '@/components/notices/StageBadge';
import { sectionLabel, toEvent, type CaseEvent, type FolderItem } from '@/components/notices/clients/caseFolder';
import { useRefundLedger, type ReadAmount, type RefundRow } from '@/components/notices/reports/ledgerData';
import { daysTo } from '@/components/notices/reports/ledgerStatus';
import { MoneyBar, RefundWhenChip, StepRoad, TonePill } from '@/components/notices/reports/RefundBits';
import {
  fyLabel, linkWord, moneyOf, placeOf, refundClocks, refundHref, refundPeriod, refundSteps, toneOf, typeCode, typeLong,
} from '@/components/notices/reports/refundModel';
import { downloadZip } from '@/components/notices/reports/zip';
import { AppealFacts } from '@/components/notices/autopilot/PortalAppeal';
import { usePortalApps } from '@/lib/portalAppeal';
import { caseHref } from '@/lib/noticeCases';
import { istToday } from '@/lib/noticeFacts';
import { dueWords, fmtDate, fmtInr, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const TAB_LABEL: Record<string, string> = {
  APPLICATIONS: 'Application', ORDERS: 'Orders', 'NOTICE/ ACKNOWLEDGEMENT': 'Notices and acknowledgements', REPLIES: 'Replies',
};

const DocChip: React.FC<{ label: string; url: string }> = ({ label, url }) => (
  <a href={url} target="_blank" rel="noreferrer" title={label}
    className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs text-foreground/90 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
    <span className="truncate">{label}</span><span className="sr-only"> (PDF, opens in a new tab)</span>
  </a>
);

const Figure: React.FC<{ label: string; value: number | null | undefined; read?: ReadAmount | null; portal?: boolean; derived?: boolean; tone?: 'good' | 'bad' }> = ({ label, value, read, portal, derived, tone }) => (
  <div className="min-w-0 space-y-0.5">
    <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    <div className={cn('text-lg font-semibold tabular-nums', !value && 'font-normal text-muted-foreground', tone === 'good' && value && 'text-success-strong', tone === 'bad' && value && 'text-destructive-strong')}>
      {value ? fmtInr(value) : '—'}
    </div>
    <div className="break-words text-[11px] text-muted-foreground">
      {!value ? '' : portal ? 'from the portal' : read ? `AI, from ${read.from}` : derived ? 'claimed less sanctioned' : ''}
    </div>
  </div>
);

const HistoryItem: React.FC<{ e: CaseEvent }> = ({ e }) => (
  <li className="relative border-l-2 border-border pb-4 pl-4 last:pb-0">
    <span aria-hidden className={cn('absolute -left-[5px] top-1.5 h-2 w-2 rounded-full', e.code === 'REPLY' || e.code === 'APLCN' ? 'bg-success' : e.code === 'ORDRS' ? 'bg-primary' : 'bg-warning')} />
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-xs font-semibold tabular-nums">{e.date ? fmtDate(e.date) : 'date not shown'}</span>
      <span className="min-w-0 break-words text-sm font-medium">{e.title}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{sectionLabel(e.code)}</span>
    </div>
    {(e.by || e.ref || e.due) && (
      <p className="mt-0.5 break-words text-xs text-muted-foreground">
        {[e.by && (e.code === 'REPLY' || e.code === 'APLCN' ? `filed by ${e.by}` : `by ${e.by}`), e.ref && `ref ${e.ref}`, e.due && `reply due ${fmtDate(e.due)}`].filter(Boolean).join(' · ')}
      </p>
    )}
    {e.attachments.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{e.attachments.map((a, i) => <DocChip key={`${a.url}-${i}`} label={a.label} url={a.url} />)}</div>}
  </li>
);

/** The time limits of a refund (s.54(1), rule 90(3), s.54(7), s.56), estimated from its type and period. */
const RefundTimeLimits: React.FC<{ r: RefundRow; today: string }> = ({ r, today }) => {
  const c = refundClocks(r, today);
  if (!c.lines.length && !c.relevantBasis) return null;
  const TONE = { ok: 'text-success', warn: 'text-warning', danger: 'text-destructive', muted: 'text-muted-foreground' } as const;
  return (
    <SectionCard title="Time limits" description={c.relevantDate ? `Relevant date about ${fmtDate(c.relevantDate)}` : undefined}
      info="Estimated from the refund's type and period. Confirm the relevant date on the papers before relying on it.">
      <ul className="space-y-1.5">
        {c.lines.map((l) => (
          <li key={l.label} className="text-sm">
            <span className="font-semibold">{l.label}</span>
            {l.date && <span className={cn('ml-1.5 font-semibold', TONE[l.tone])}>{fmtDate(l.date)}</span>}
            <span className="block text-xs text-muted-foreground">{l.note}</span>
          </li>
        ))}
      </ul>
      {c.interest > 0 && <p className="text-xs">Interest due to the client so far, at 6%: <span className="font-semibold">{fmtInr(c.interest)}</span></p>}
      <p className="text-[11px] text-muted-foreground">{c.relevantBasis}</p>
    </SectionCard>
  );
};

const RefundBody: React.FC<{ r: RefundRow; today: string; canExport: boolean }> = ({ r, today, canExport }) => {
  const [allDocs, setAllDocs] = useState(false);
  const [zipping, setZipping] = useState(false);
  const clientId = r.fact.client_id as string;
  const arn = r.fact.arn as string;
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
  const code = typeCode(r);
  const period = refundPeriod(r);
  const place = placeOf(r);
  const d = daysTo(s.due, today);
  const portalSanctioned = r.fact.sanctioned_amount !== null;
  const events = history.data ?? [];

  const zip = async () => {
    setZipping(true);
    const t = toast.loading(`Fetching ${plural(r.docs.length, 'PDF')}…`);
    try {
      const res = await downloadZip(r.docs.map((x) => ({ url: x.url, name: x.label })), `${r.fact.client_name ?? 'Client'} refund ${arn}.zip`);
      if (res.ok === 0) toast.error('None of the PDFs could be fetched.');
      else toast.success(`Saved ${plural(res.ok, 'PDF')} in one .zip${res.failed ? `; ${res.failed} could not be fetched` : ''}.`);
    } finally { setZipping(false); toast.dismiss(t); }
  };

  return (
    <NoticesShell section="Refund" record crumbs={[
      { label: 'Refunds', to: '/refunds-all' },
      { label: r.fact.client_name ?? 'Client', to: `/refunds-all?client=${clientId}` },
      { label: arn, mono: true },
    ]}>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-heading text-lg font-bold leading-tight sm:text-xl">{typeLong(code)}{period ? ` · ${period}` : ''}</h1>
          <p className="text-xs text-muted-foreground">
            Refund <span className="font-mono">{arn}</span> · filed {fmtDate(r.fact.filed_date)}
            {place && !place.byFiling ? ` · ${fyLabel(place.fy)} Q${place.q}` : ''}
            {r.period?.source === 'ai' ? ' · period read by the AI' : ''}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <RefundWhenChip r={r} />
            <TonePill tone={tone} />
            <span className="text-xs text-muted-foreground">Portal: {r.fact.status ?? 'status not captured'}</span>
            {r.caseLink && <StageBadge stage={r.caseLink.stage} since={r.caseLink.stage_changed_at} by={r.caseLink.stage_changed_by} />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && r.docs.length > 0 && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={zip} disabled={zipping}>
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FolderDown className="h-3.5 w-3.5" aria-hidden />} All {plural(r.docs.length, 'PDF')} (.zip)
            </Button>
          )}
          {r.hasCasePage && (
            <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to={caseHref(clientId, arn)}>Case page</Link></Button>
          )}
          {r.caseLink && (
            <Button size="sm" className={WS_BTN} asChild><Link to={`/notices/${r.caseLink.id}`}>{r.caseLink.is_open ? 'Work on it' : 'Open the notice'} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
          )}
        </div>
      </header>

      <section className={cn('rounded-lg border px-4 py-3', tone === 'action' ? 'border-destructive/50 bg-destructive/[0.04]' : s.open ? 'border-info/40 bg-info/[0.05]' : 'bg-muted/40')}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.open ? 'Next step' : 'Where it stands'}</div>
        <div className={cn('text-base font-semibold', tone === 'action' && 'text-destructive-strong')}>
          {s.next ?? (tone === 'withdrawn' ? 'Withdrawn: nothing to do'
            : tone === 'part' ? `${fmtInr(r.rejected)} rejected, the rest sanctioned`
            : tone === 'full' ? 'Sanctioned in full: nothing to do' : s.open ? 'With the officer' : 'Closed: nothing to do')}
        </div>
        {(s.due || s.basis) && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {s.due && <span className={cn('font-medium tabular-nums', d !== null && d < 0 ? 'text-destructive-strong' : 'text-foreground')}>by {fmtDate(s.due)} · {dueWords(d).replace('due ', '')}</span>}
            {s.due && s.basis ? ' · ' : ''}{s.basis}
          </div>
        )}
        {appeals.length > 0
          ? <div className="mt-0.5 text-xs">Appeal {appeals.map((x) => x.row.arn).join(', ')} filed on {fmtDate(appeals[0].row.filed_date)}: {appeals[0].row.status ?? 'status not read'}. Its details are below.</div>
          : tone === 'part' && r.links.some((l) => l.kind === 'appeal') && <div className="mt-0.5 text-xs">An appeal against it is linked below.</div>}
      </section>

      {appeals.map(({ row, appeal, files }) => appeal && (
        <div key={row.id} id={`appeal-${row.arn}`} className="scroll-mt-4"><SectionCard title={<span className="inline-flex items-center gap-1.5"><GitBranch className="h-4 w-4" aria-hidden /> Appeal {row.arn}</span>}
          description="From the portal's record of the appeal and its case folder">
          <AppealFacts a={appeal} files={files} />
        </SectionCard></div>
      ))}

      <SectionCard title="Steps"><StepRoad steps={refundSteps(r)} /></SectionCard>

      <RefundTimeLimits r={r} today={today} />

      <SectionCard title="Amounts" description={r.read ? `read from ${plural(r.read.documents, 'document')} of the refund where the portal has none` : undefined}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Figure label="Claimed" value={r.claimed} read={r.fact.claimed_amount === null ? r.read?.claimed : null} portal={r.fact.claimed_amount !== null} />
          <Figure label="Provisional (RFD-04)" value={r.read?.provisional?.value} read={r.read?.provisional} />
          <Figure label="Sanctioned" value={r.sanctioned} read={portalSanctioned ? null : r.read?.sanctioned} portal={portalSanctioned} tone="good" />
          <Figure label="Rejected" value={r.rejected} read={r.read?.rejected} derived={!r.read?.rejected} tone="bad" />
          <Figure label="Paid" value={r.read?.paid?.value} read={r.read?.paid} />
        </div>
        <MoneyBar m={moneyOf(r)} className="h-2" />
      </SectionCard>

      <SectionCard title={<span className="inline-flex items-center gap-1.5"><GitBranch className="h-4 w-4" aria-hidden /> Linked cases</span>}
        description={r.links.length ? plural(r.links.length, 'case') : 'none'}>
        {r.links.length === 0 ? (
          <p className="text-xs text-muted-foreground">No appeal, fresh application or other case is linked to this refund.{r.hasCasePage ? ' Cases are linked on the case page.' : ''}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {r.links.map((l) => (
              <li key={l.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', l.kind === 'appeal' ? 'bg-warning/20' : 'bg-muted')}>{linkWord(l.kind, l.dir)}</span>
                <span className="font-mono text-xs">{l.key}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {l.refund ? `refund${l.refund.status ? ` · ${l.refund.status}` : ''}${l.refund.filed ? ` · filed ${fmtDate(l.refund.filed)}` : ''}` : l.title ?? ''}
                  {l.isOpen !== null && <> · {l.isOpen ? 'open' : 'closed'}</>}
                  {l.source === 'manual' ? ' · linked by staff' : ''}
                </span>
                {l.refund ? (
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs"><Link to={refundHref(clientId, l.key)}>Open <ArrowRight className="h-3 w-3" aria-hidden /></Link></Button>
                ) : l.hasPage ? (
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs"><Link to={caseHref(clientId, l.key)}>Open <ArrowRight className="h-3 w-3" aria-hidden /></Link></Button>
                ) : appeals.some((x) => x.row.arn === l.key) ? (
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs"><a href={`#appeal-${l.key}`}>Details above</a></Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="History on the portal" description={events.length ? `${plural(events.length, 'paper')}, oldest first, each with its documents` : undefined}>
        {!r.hasFolder ? (
          <p className="text-xs text-muted-foreground">The portal case folder has not been fetched for this refund yet; it fills in at the client's next refund fetch.</p>
        ) : history.isLoading ? <Skeleton className="h-32 w-full" />
          : history.error ? <Note tone="warn">Couldn't load the history: {history.error instanceof Error ? history.error.message : String(history.error)}</Note>
          : <ol>{events.map((e) => <HistoryItem key={e.id} e={e} />)}</ol>}
      </SectionCard>

      {r.docs.length > 0 && (
        <SectionCard title={
          <button type="button" onClick={() => setAllDocs((v) => !v)} aria-expanded={allDocs} className="inline-flex items-center gap-1 hover:underline">
            All documents <span className="font-normal text-muted-foreground">· {r.docs.length}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', allDocs && 'rotate-180')} aria-hidden />
          </button>
        }>
          {allDocs ? (
            <div className="space-y-2">
              {docGroups.map(([tab, list]) => (
                <div key={tab}>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">{TAB_LABEL[tab] ?? tab} · {list.length}</div>
                  <div className="flex flex-wrap gap-1">{list.map((x, i) => <DocChip key={`${x.url}-${i}`} label={x.label} url={x.url} />)}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">The application's documents by portal tab. The papers above carry their own.</p>}
        </SectionCard>
      )}
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
