// One refund, everything about it, in a side panel of the Refunds page (the
// firm's request of 25 October 2026: one place for a refund instead of four).
// What it is, the steps it has passed with their dates, what to do next, where
// its claim stands and where each figure was read, the cases linked to it, and
// its history on the portal with each item's documents as small chips; the
// application's own documents fold away under it. Opened by ?refund=<ARN>, so
// a refund can be linked to.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, ExternalLink, FileText, FolderDown, FolderOpen, GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN } from '@/components/workspace/theme';
import { StageBadge } from '@/components/notices/StageBadge';
import { sectionLabel, toEvent, type CaseEvent, type FolderItem } from '@/components/notices/clients/caseFolder';
import { caseHref } from '@/lib/noticeCases';
import { dueWords, fmtDate, fmtInr, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { ReadAmount, RefundRow } from './ledgerData';
import { daysTo } from './ledgerStatus';
import { MoneyBar, StepRoad } from './RefundBits';
import { linkWord, moneyOf, refundPeriod, refundSteps, typeCode, typeLong } from './refundModel';
import { downloadZip } from './zip';

const TAB_LABEL: Record<string, string> = {
  APPLICATIONS: 'Application', ORDERS: 'Orders', 'NOTICE/ ACKNOWLEDGEMENT': 'Notices and acknowledgements', REPLIES: 'Replies',
};

const DocChip: React.FC<{ label: string; url: string }> = ({ label, url }) => (
  <a href={url} target="_blank" rel="noreferrer" title={label}
    className="inline-flex max-w-[15rem] items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] text-foreground/90 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
    <span className="truncate">{label}</span>
    <span className="sr-only"> (PDF, opens in a new tab)</span>
  </a>
);

const Section: React.FC<{ title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }> = ({ title, aside, children }) => (
  <section className="space-y-2 border-t px-5 py-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
    </div>
    {children}
  </section>
);

const Figure: React.FC<{ label: string; value: number | null | undefined; read?: ReadAmount | null; portal?: boolean; tone?: 'good' | 'bad' }> = ({ label, value, read, portal, tone }) => (
  <div className="min-w-0 rounded-md border px-2.5 py-2">
    <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    <div className={cn('text-base font-semibold tabular-nums', !value && 'font-normal text-muted-foreground', tone === 'good' && value && 'text-success-strong', tone === 'bad' && value && 'text-destructive-strong')}>
      {value ? fmtInr(value) : '—'}
    </div>
    <div className="truncate text-[10px] text-muted-foreground" title={read?.from}>
      {portal ? 'from the portal' : read ? `AI, from ${read.from}` : value ? 'claimed less sanctioned' : ' '}
    </div>
  </div>
);

const HistoryItem: React.FC<{ e: CaseEvent }> = ({ e }) => (
  <li className="relative border-l-2 border-border pb-3 pl-4 last:pb-0">
    <span aria-hidden className={cn('absolute -left-[5px] top-1.5 h-2 w-2 rounded-full', e.code === 'REPLY' || e.code === 'APLCN' ? 'bg-success' : e.code === 'ORDRS' ? 'bg-primary' : 'bg-warning')} />
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-xs font-semibold tabular-nums">{e.date ? fmtDate(e.date) : 'date not shown'}</span>
      <span className="min-w-0 break-words text-sm font-medium">{e.title}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{sectionLabel(e.code)}</span>
    </div>
    {(e.by || e.ref || e.due) && (
      <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
        {[e.by && (e.code === 'REPLY' || e.code === 'APLCN' ? `filed by ${e.by}` : `by ${e.by}`), e.ref && `ref ${e.ref}`, e.due && `reply due ${fmtDate(e.due)}`].filter(Boolean).join(' · ')}
      </p>
    )}
    {e.attachments.length > 0 && (
      <div className="mt-1 flex flex-wrap gap-1">{e.attachments.map((a, i) => <DocChip key={`${a.url}-${i}`} label={a.label} url={a.url} />)}</div>
    )}
  </li>
);

export const RefundPanel: React.FC<{
  row: RefundRow | null;
  today: string;
  showClient: boolean;
  onClose: () => void;
  onOpenArn: (arn: string) => void;
  canExport: boolean;
}> = ({ row: r, today, showClient, onClose, onOpenArn, canExport }) => {
  const [allDocs, setAllDocs] = useState(false);
  const [zipping, setZipping] = useState(false);
  const arn = r?.fact.arn ?? null;
  const clientId = r?.fact.client_id ?? null;
  const history = useQuery({
    queryKey: ['refund-folder', clientId, arn],
    enabled: !!r && !!arn && !!clientId && r.hasFolder,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('gst_case_folder_items').select('*')
        .eq('client_id', clientId as string).eq('case_id', arn as string).is('deleted_at', null);
      if (error) throw error;
      return ((data ?? []) as FolderItem[]).map(toEvent).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    },
  });
  const docGroups = useMemo(() => {
    const g = new Map<string, { label: string; url: string }[]>();
    (r?.docs ?? []).forEach((d) => { const k = d.tab ?? 'Other'; g.set(k, [...(g.get(k) ?? []), d]); });
    return [...g.entries()];
  }, [r]);

  if (!r) return <Sheet open={false} onOpenChange={(o) => !o && onClose()}><SheetContent /></Sheet>;
  const s = r.state;
  const steps = refundSteps(r);
  const m = moneyOf(r);
  const code = typeCode(r);
  const period = refundPeriod(r);
  const d = daysTo(s.due, today);
  const portalSanctioned = r.fact.sanctioned_amount !== null;
  const events = history.data ?? [];
  const historyDocs = events.reduce((n, e) => n + e.attachments.length, 0);

  const zip = async () => {
    setZipping(true);
    const t = toast.loading(`Fetching ${plural(r.docs.length, 'PDF')}…`);
    try {
      const res = await downloadZip(r.docs.map((x) => ({ url: x.url, name: x.label })), `${r.fact.client_name ?? 'Client'} refund ${arn ?? ''}.zip`);
      if (res.ok === 0) toast.error('None of the PDFs could be fetched.');
      else toast.success(`Saved ${plural(res.ok, 'PDF')} in one .zip${res.failed ? `; ${res.failed} could not be fetched` : ''}.`);
    } finally { setZipping(false); toast.dismiss(t); }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 px-5 pb-3 pt-5 text-left">
          {showClient && <div className="text-xs font-medium text-muted-foreground">{r.fact.client_name} · <span className="font-mono">{r.fact.client_gstin}</span></div>}
          <SheetTitle className="pr-6 text-lg leading-snug">{typeLong(code)}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-mono font-semibold text-foreground">{arn ?? 'ARN not captured'}</span>
              {period && <span>· {period}</span>}
              <span>· filed {fmtDate(r.fact.filed_date)}</span>
              <Badge variant={s.tone} className="rounded-md text-[11px] font-medium">{s.label}</Badge>
              {r.caseLink && <StageBadge stage={r.caseLink.stage} since={r.caseLink.stage_changed_at} by={r.caseLink.stage_changed_by} />}
            </div>
          </SheetDescription>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {r.hasCasePage && clientId && arn && (
              <Button asChild size="sm" className={WS_BTN}><Link to={caseHref(clientId, arn)}>Open the case <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
            )}
            {r.caseLink && (
              <Button asChild size="sm" variant="outline" className={WS_BTN}><Link to={`/notices/${r.caseLink.id}`}>Work on the notice</Link></Button>
            )}
            {r.hasFolder && clientId && arn && (
              <Button asChild size="sm" variant="outline" className={WS_BTN}>
                <Link to={`/notices-case-folder/${clientId}/${encodeURIComponent(arn)}`}><FolderOpen className="h-3.5 w-3.5" aria-hidden /> Portal case folder</Link>
              </Button>
            )}
            {canExport && r.docs.length > 0 && (
              <Button size="sm" variant="outline" className={WS_BTN} onClick={zip} disabled={zipping}>
                {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FolderDown className="h-3.5 w-3.5" aria-hidden />} {plural(r.docs.length, 'PDF')} (.zip)
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className={cn('mx-5 mb-4 rounded-lg border px-3 py-2.5', s.group === 'action' ? 'border-destructive/50 bg-destructive/[0.04]' : s.open ? 'border-info/40 bg-info/[0.05]' : 'bg-muted/40')}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.open ? 'Next step' : 'Where it ended'}</div>
          <div className={cn('text-sm font-semibold', s.group === 'action' && 'text-destructive-strong')}>{s.next ?? (s.open ? 'Waiting on the officer' : 'Nothing to do: the refund is closed')}</div>
          {(s.due || s.basis) && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {s.due && <span className={cn('font-medium tabular-nums', d !== null && d < 0 ? 'text-destructive-strong' : 'text-foreground')}>by {fmtDate(s.due)} · {dueWords(d).replace('due ', '')}</span>}
              {s.due && s.basis ? ' · ' : ''}{s.basis}
            </div>
          )}
        </div>

        <Section title="Steps">
          <StepRoad steps={steps} />
        </Section>

        <Section title="Amounts" aside={r.read ? `read from ${plural(r.read.documents, 'document')} of the refund` : undefined}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Figure label="Claimed" value={r.claimed} read={r.fact.claimed_amount === null ? r.read?.claimed : null} portal={r.fact.claimed_amount !== null} />
            <Figure label="Sanctioned" value={r.sanctioned} read={portalSanctioned ? null : r.read?.sanctioned} portal={portalSanctioned} tone="good" />
            <Figure label="Rejected" value={r.rejected} read={r.read?.rejected} tone="bad" />
            {r.read?.provisional && <Figure label="Provisional (RFD-04)" value={r.read.provisional.value} read={r.read.provisional} />}
            <Figure label="Paid" value={r.read?.paid?.value} read={r.read?.paid} />
          </div>
          <MoneyBar m={m} className="h-2" />
        </Section>

        <Section title={<span className="inline-flex items-center gap-1.5"><GitBranch className="h-4 w-4" aria-hidden /> Linked cases</span>}
          aside={r.links.length ? plural(r.links.length, 'case') : undefined}>
          {r.links.length === 0 ? (
            <p className="text-xs text-muted-foreground">No appeal, fresh application or other case is linked to this refund.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {r.links.map((l) => (
                <li key={l.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', l.kind === 'appeal' ? 'bg-warning/20' : 'bg-muted')}>{linkWord(l.kind, l.dir)}</span>
                  <span className="font-mono text-xs">{l.key}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {l.refund ? `refund ${l.refund.status ? `· ${l.refund.status}` : ''}${l.refund.filed ? ` · filed ${fmtDate(l.refund.filed)}` : ''}` : l.title ?? ''}
                    {l.isOpen !== null && <> · {l.isOpen ? 'open' : 'closed'}</>}
                    {l.source === 'manual' ? ' · linked by staff' : ''}
                  </span>
                  {l.refund ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpenArn(l.key)}>Show <ArrowRight className="h-3 w-3" aria-hidden /></Button>
                  ) : l.hasPage && clientId ? (
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs"><Link to={caseHref(clientId, l.key)}>Open <ArrowRight className="h-3 w-3" aria-hidden /></Link></Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {r.hasCasePage && clientId && arn && (
            <p className="text-[11px] text-muted-foreground">Link or unlink cases on <Link to={caseHref(clientId, arn)} className="text-primary hover:underline">the refund's case page</Link>.</p>
          )}
        </Section>

        <Section title="History on the portal" aside={events.length ? `${plural(events.length, 'item')} · ${plural(historyDocs, 'document')}` : undefined}>
          {!r.hasFolder ? (
            <p className="text-xs text-muted-foreground">The portal case folder has not been fetched for this refund yet; it fills in at the client's next refund fetch.</p>
          ) : history.isLoading ? <Skeleton className="h-32 w-full" />
            : history.error ? <p className="text-xs text-destructive-strong">Couldn't load the history: {history.error instanceof Error ? history.error.message : String(history.error)}</p>
            : <ol>{events.map((e) => <HistoryItem key={e.id} e={e} />)}</ol>}
        </Section>

        {r.docs.length > 0 && (
          <Section title={
            <button type="button" onClick={() => setAllDocs((v) => !v)} aria-expanded={allDocs} className="inline-flex items-center gap-1 hover:underline">
              Application documents <span className="font-normal text-muted-foreground">· {r.docs.length}</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', allDocs && 'rotate-180')} aria-hidden />
            </button>
          }>
            {allDocs && (
              <div className="space-y-2">
                {docGroups.map(([tab, list]) => (
                  <div key={tab}>
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">{TAB_LABEL[tab] ?? tab} · {list.length}</div>
                    <div className="flex flex-wrap gap-1">{list.map((x, i) => <DocChip key={`${x.url}-${i}`} label={x.label} url={x.url} />)}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {r.fact.arn && (
          <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
            <ExternalLink className="mr-1 inline h-3 w-3" aria-hidden />
            Statuses come from the portal; amounts not on the portal are read by the AI from this refund's orders and say which one.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default RefundPanel;
