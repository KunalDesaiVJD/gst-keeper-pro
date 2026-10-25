// One case (the central issue) at /notices-case/:clientId/:caseKey (the firm's
// request of 9 October 2026): what it is about, filled from every notice and
// every document of the case (the AI reads them all), and all its
// correspondence in one place, newest first, with what is new since someone
// last opened it. Opening the page marks the case as seen. The work itself
// (issues, evidence, the draft) stays on the notice's own page.
// Laid out by the UX audit of 25 October 2026: the module's tabs stay; the
// header says the status and the date once; the next step; then the linked
// chain (when there is one, since it changes how the timeline reads), the
// timeline or the portal's own folder (the old case folder page), and beside
// them the facts the header does not already carry.
import React, { useEffect, useMemo, useRef } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { CasePortalView } from '@/components/notices/cases/CasePortalView';
import { SectionCard } from '@/components/notices/ui/Panel';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { CaseTimeline } from '@/components/notices/cases/CaseTimeline';
import { KindFacts } from '@/components/notices/cases/KindFacts';
import { NextStepCard } from '@/components/notices/cases/NextStepCard';
import { CaseAdminActions } from '@/components/notices/cases/CaseAdminActions';
import { CaseChainPanel } from '@/components/notices/cases/CaseChainPanel';
import { WaitingChip } from '@/components/notices/cases/WaitingChip';
import { OfficerContact } from '@/components/notices/OfficerContact';
import { useAuth } from '@/contexts/AuthContext';
import {
  caseLabel, loadCase, loadCaseItems, loadKeyDates, markCaseSeen, trackDef, useCaseChain, useCaseOverview, type CaseOverview, type OverviewKey, type Track,
} from '@/lib/noticeCases';
import { fmtDate, fmtFy, fmtInr, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { refundIndexKey, useRefundIndex } from '@/components/notices/reports/ledgerData';
import { RefundWhenChip } from '@/components/notices/reports/RefundBits';

const LIT_FIELDS: { key: OverviewKey; label: string; fmt?: (v: string) => string; mono?: boolean }[] = [
  { key: 'section_of_law', label: 'Section' },
  { key: 'financial_year', label: 'Financial year', fmt: fmtFy },
  { key: 'period_from', label: 'Tax period from', fmt: fmtDate },
  { key: 'period_to', label: 'Tax period to', fmt: fmtDate },
  { key: 'din', label: 'DIN', mono: true },
  { key: 'reply_due', label: 'Reply due', fmt: fmtDate },
  { key: 'hearing_date', label: 'Hearing', fmt: fmtDate },
  { key: 'officer', label: 'Officer' },
  { key: 'amount_of_demand', label: 'Amount of demand', fmt: (v) => fmtInr(Number(v)) },
];

/** A notice or demand's facts, each from the case's notices or what the AI read in its documents. */
/**
 * A notice or demand's facts, each from the case's notices or what the AI read
 * in its documents, one column in the page's side rail. The reply due date and
 * the hearing are said once, in the header, so they are not repeated here, and
 * a fact we do not hold is left out rather than shown as a dash.
 */
export const CaseFactsGrid: React.FC<{ ov: CaseOverview | undefined }> = ({ ov }) => {
  const shown = LIT_FIELDS.filter((f) => f.key !== 'reply_due' && f.key !== 'hearing_date' && ov?.fields[f.key]);
  if (!shown.length) return <p className="text-xs text-muted-foreground">Nothing read yet: the facts fill in as the AI reads the case's documents.</p>;
  return (
    <dl className="grid grid-cols-1 gap-y-2.5">
      {shown.map((f) => {
        const v = ov?.fields[f.key];
        const value = v ? (f.fmt ? f.fmt(v.value) : v.value) : '';
        return (
          <div key={f.key} className="min-w-0 space-y-0.5">
            <dt className="text-[11px] font-medium text-muted-foreground">{f.label}</dt>
            <dd className={cn('break-words text-sm font-semibold', f.mono && 'break-all font-mono text-[13px]')}
              title={v ? `${v.source === 'ai' ? 'Read by the AI from ' : 'From '}${v.label || 'the case'}` : undefined}>
              {value}
              {v?.source === 'ai' && <Sparkles className="ml-1 inline h-3 w-3 align-baseline text-primary/60" aria-label="read by the AI" />}
            </dd>
            {f.key === 'officer' && v && <dd><OfficerContact name={v.value} /></dd>}
          </div>
        );
      })}
    </dl>
  );
};

const NoticeCasePage: React.FC = () => {
  const { clientId = '', caseKey: rawKey = '' } = useParams();
  const caseKey = decodeURIComponent(rawKey);
  const { isStaffRole, user } = useAuth();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['notice-case', clientId, caseKey], queryFn: () => loadCase(clientId, caseKey), enabled: !!clientId && !!caseKey });
  const items = useQuery({ queryKey: ['notice-case-items', clientId, caseKey], queryFn: () => loadCaseItems(clientId, caseKey), enabled: !!clientId && !!caseKey });
  const keyDates = useQuery({ queryKey: ['notice-case-key-dates', clientId, caseKey], queryFn: () => loadKeyDates(clientId, caseKey), enabled: !!clientId && !!caseKey });
  const ov = useCaseOverview(clientId, caseKey);
  const refunds = useRefundIndex(clientId, c.data?.track === 'refund');
  const chain = useCaseChain(clientId, c.data?.case_key ?? null);
  const marked = useRef(false);
  // A chain of linked cases is seen whole, or one case alone (?part=<its case>).
  const [sp, setSp] = useSearchParams();
  const members = useMemo(() => chain.data?.members ?? [], [chain.data]);
  const part = members.length > 1 && members.some((m) => m.case_key === sp.get('part')) ? sp.get('part') : null;
  const setPart = (k: string | null) => {
    const n = new URLSearchParams(sp);
    if (k) n.set('part', k); else n.delete('part');
    setSp(n, { replace: true });
  };
  // The timeline reads oldest first, the story of the case (?order=newest turns it).
  const order: 'oldest' | 'newest' = sp.get('order') === 'newest' ? 'newest' : 'oldest';
  const setOrder = (o: 'oldest' | 'newest') => {
    const n = new URLSearchParams(sp);
    if (o === 'newest') n.set('order', o); else n.delete('order');
    setSp(n, { replace: true });
  };
  // Papers (the timeline) or the portal's own case folder (?view=portal; the old case folder page lands here).
  const view: 'papers' | 'portal' = sp.get('view') === 'portal' ? 'portal' : 'papers';
  const setView = (v: 'papers' | 'portal') => {
    const n = new URLSearchParams(sp);
    if (v === 'portal') n.set('view', v); else n.delete('view');
    setSp(n, { replace: true });
  };
  // The notice the case was opened from (a list's row), marked on the timeline.
  const focusId = sp.get('notice');
  const partOf = useMemo(() => {
    if (members.length < 2) return undefined;
    const names = new Map(members.map((m) => [m.case_key, caseLabel(m).split(' · ')[0] + (m.case_id ? ` ${m.case_id}` : '')]));
    return (k: string | null | undefined) => (k ? names.get(k) ?? null : null);
  }, [members]);

  // Opening the case is seeing what came in: mark it once the items are on screen.
  useEffect(() => {
    if (marked.current || !items.data || !c.data) return;
    marked.current = true;
    markCaseSeen(clientId, caseKey, user?.firstName ?? null)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['notice-cases'] });
        qc.invalidateQueries({ queryKey: ['notice-case-counts'] });
      })
      .catch(() => { /* the badge stays until the next visit */ });
  }, [items.data, c.data, clientId, caseKey, user, qc]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const r = c.data;
  const crumbsFor = (track: Track, title?: React.ReactNode) => [
    { label: trackDef(track).label === 'Notices & demands' ? 'Cases' : `Cases · ${trackDef(track).label}`, to: `/notices-cases${track === 'litigation' ? '' : `?kind=${track}`}` },
    ...(r ? [{ label: r.client_name ?? 'Client', to: `/notices-company/${clientId}` }] : []),
    { label: title ?? 'Case' },
  ];
  if (c.isLoading) {
    return (
      <NoticesShell section="Case" record crumbs={crumbsFor('litigation')}>
        <Skeleton className="h-8 w-96 max-w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-96 w-full" />
      </NoticesShell>
    );
  }
  if (c.error || !r) {
    // A portal case folder with no notice on record still has its portal view.
    return (
      <NoticesShell section="Case" record crumbs={crumbsFor('litigation', <span className="font-mono">{caseKey}</span>)}>
        <Note tone={c.error ? 'warn' : 'info'}>{c.error ? `Couldn't load the case: ${c.error instanceof Error ? c.error.message : String(c.error)}` : 'No notice of this case is on record (or all its notices are hidden or closed out of the module). What the portal holds for it is below.'}</Note>
        {!c.error && <SectionCard title="Portal case folder"><CasePortalView clientId={clientId} caseId={caseKey} /></SectionCard>}
      </NoticesShell>
    );
  }
  const track = (r.track ?? 'litigation') as Track;
  const forms = r.forms ?? [];
  const newCount = (items.data ?? []).filter((i) => i.is_new).length;
  const shownItems = part ? (items.data ?? []).filter((i) => i.own_key === part) : items.data ?? [];
  const shownDates = part ? (keyDates.data ?? []).filter((k) => k.own_key === part) : keyDates.data ?? [];
  const upcoming = shownDates.filter((k) => k.upcoming).length;
  const partMember = part ? members.find((m) => m.case_key === part) : undefined;
  const linked = members.length > 1;
  // The portal view reads one portal case folder: the case shown alone, else the case itself.
  const portalCaseId = (partMember ? partMember.case_id : r.case_id) ?? null;
  const fys = r.financial_years ? r.financial_years.split(', ').map(fmtFy).filter(Boolean).join(', ') : '';
  const chainPanel = <CaseChainPanel clientId={clientId} caseKey={r.case_key as string} part={part} onPart={setPart} track={track} />;

  return (
    <NoticesShell section="Case" record crumbs={crumbsFor(track, r.form_code ?? (r.case_key === 'REG' ? 'Registration' : 'Case'))}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-heading text-lg font-bold leading-tight sm:text-xl">{r.form_code ? `${r.form_code} · ` : ''}{r.title}</h1>
          <p className="text-xs text-muted-foreground">
            {r.case_id ? <>Case <span className="font-mono">{r.case_id}</span> · </> : r.case_key === 'REG' ? 'All registration correspondence · ' : null}
            {track === 'litigation' && fys ? `FY ${fys} · ` : ''}
            {plural(r.notices ?? 0, 'notice')}{r.documents ? `, ${plural(r.documents, 'document')}` : ''}
            {r.first_issue_date ? ` · since ${fmtDate(r.first_issue_date)}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {track === 'refund' && <RefundWhenChip r={refunds.get(refundIndexKey(clientId, r.case_id))} />}
            <WaitingChip r={r} long />
            {r.is_open && <StageBadge stage={r.stage} />}
            {r.is_open && r.next_due && (
              <Badge variant={r.is_overdue ? 'destructive' : r.is_due_in_7 ? 'warning' : 'secondary'} className="text-[11px]">
                {r.is_overdue ? 'Overdue' : 'Due'} {fmtDate(r.next_due)}
              </Badge>
            )}
            {r.next_hearing && <Badge variant="warning" className="text-[11px]">Hearing {fmtDate(r.next_hearing)}</Badge>}
            {newCount > 0 && <Badge variant="info" className="text-[11px]">{newCount} new since last opened</Badge>}
            {r.is_open && <OwnerChip name={r.assign_to} showName />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CaseAdminActions clientId={clientId} caseKey={r.case_key as string} open={!!r.is_open} />
          {track === 'refund' && r.case_id && (
            <Button size="sm" variant="outline" className={WS_BTN} asChild>
              <Link to={`/refunds/${clientId}/${encodeURIComponent(r.case_id)}`}>Refund page</Link>
            </Button>
          )}
          {r.lead_notice_id && (
            <Button size="sm" className={WS_BTN} asChild>
              <Link to={`/notices/${r.lead_notice_id}`}>{r.is_open ? 'Work on it' : 'Open the latest notice'} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
            </Button>
          )}
        </div>
      </header>

      <NextStepCard clientId={clientId} caseKey={r.case_key as string} track={track} form={r.form_code ?? null}
        overdue={!!r.is_overdue} open={!!r.is_open} />

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          {/* A chain changes how the timeline reads (the order, then its appeal), so it comes first. */}
          {linked && chainPanel}

          <SectionCard title={view === 'portal' ? 'Portal case folder' : 'Timeline'}
            info={view === 'portal'
              ? 'The case folder as the portal holds it: its status, outstanding recovery, every item with each field the portal returned, and the portal\'s own grouping.'
              : 'Every notice, reply, application and order of the case, and the dates the law attaches to them: the time to appeal, the pre-deposit, hearings and adjournments, replies due, and the windows to pay and close with a reduced penalty. Work on a notice with its Work on it link.'}
            description={view === 'portal' ? (portalCaseId ? <span className="font-mono">{portalCaseId}</span> : undefined)
              : items.data ? `${shownItems.length} papers, ${plural(shownDates.length, 'key date')}${upcoming ? ` (${upcoming} upcoming)` : ''}${newCount ? ` · ${newCount} new` : ''}` : undefined}
            actions={<div className="flex flex-wrap items-center gap-2">
              {part && (
                <button type="button" onClick={() => setPart(null)} className="rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20">
                  {partMember ? caseLabel(partMember).split(' · ')[0] : 'One case'} only · show all {members.length}
                </button>
              )}
              {view === 'papers' && (
                <Toggle label="Order of the timeline" value={order} onChange={setOrder}
                  options={[['oldest', 'Oldest first'], ['newest', 'Newest first']]} />
              )}
              {portalCaseId && (
                <Toggle label="Papers or the portal's folder" value={view} onChange={setView}
                  options={[['papers', 'Papers'], ['portal', 'Portal view']]} />
              )}
            </div>}>
            {view === 'portal' && portalCaseId ? <CasePortalView clientId={clientId} caseId={portalCaseId} />
              : items.error ? <Note tone="warn">Couldn't load the correspondence: {items.error instanceof Error ? items.error.message : String(items.error)}</Note>
              : items.isLoading ? <Skeleton className="h-64 w-full" />
              : <CaseTimeline items={shownItems} keyDates={shownDates} partOf={part ? undefined : partOf} order={order} focusId={focusId} />}
          </SectionCard>

          {!linked && chainPanel}
        </div>

        <aside className="min-w-0 space-y-3 lg:sticky lg:top-3" aria-label="Facts of the case">
          {track === 'litigation' ? (
            <SectionCard title="Facts"
              description={(ov.data?.reading?.queued ?? 0) > 0
                ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> AI reading {ov.data?.reading?.queued} documents</span>
                : ov.data?.reading?.documents ? `AI read ${ov.data.reading.done} of ${ov.data.reading.documents} documents` : undefined}>
              {ov.isLoading ? <Skeleton className="h-40 w-full" /> : <CaseFactsGrid ov={ov.data} />}
              {Number(r.exposure) > 0 && (
                <div className="mt-3 border-t pt-2.5">
                  <div className="text-[11px] font-medium text-muted-foreground">Open exposure</div>
                  <div className="text-lg font-semibold tabular-nums">{fmtInr(r.exposure)}</div>
                </div>
              )}
            </SectionCard>
          ) : (
            <KindFacts track={track} overview={ov.data} loading={ov.isLoading} forms={forms} rail
              notice={{ form_label: r.form_label, issue_date: r.last_issue_date, reference_number: r.reference_number, financial_year: r.financial_year }} />
          )}
        </aside>
      </div>
    </NoticesShell>
  );
};

/** A two-way switch in a card's header. */
function Toggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={cn('rounded px-2 py-0.5 text-[11px] font-medium', value === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {text}
        </button>
      ))}
    </div>
  );
}

export default NoticeCasePage;
