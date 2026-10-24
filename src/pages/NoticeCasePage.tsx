// One case (the central issue) at /notices-case/:clientId/:caseKey (the firm's
// request of 9 October 2026): what it is about, filled from every notice and
// every document of the case (the AI reads them all), and all its
// correspondence in one place, newest first, with what is new since someone
// last opened it. Opening the page marks the case as seen. The work itself
// (issues, evidence, the draft) stays on the notice's own page.
import React, { useEffect, useMemo, useRef } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FolderOpen, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_PAGE } from '@/components/workspace/theme';
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
  caseLabel, loadCase, loadCaseItems, markCaseSeen, trackDef, useCaseChain, useCaseOverview, type CaseOverview, type OverviewKey, type Track,
} from '@/lib/noticeCases';
import { fmtDate, fmtFy, fmtInr, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

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
export const CaseFactsGrid: React.FC<{ ov: CaseOverview | undefined }> = ({ ov }) => (
  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
    {LIT_FIELDS.map((f) => {
      const v = ov?.fields[f.key];
      const shown = v ? (f.fmt ? f.fmt(v.value) : v.value) : '';
      return (
        <div key={f.key} className="min-w-0 space-y-0.5">
          <dt className="text-[11px] font-medium text-muted-foreground">{f.label}</dt>
          <dd className={cn('break-words text-sm font-semibold', f.mono && 'break-all font-mono text-[13px]', !shown && 'font-normal text-muted-foreground')}
            title={v ? `${v.source === 'ai' ? 'Read by the AI from ' : 'From '}${v.label || 'the case'}` : undefined}>
            {shown || '—'}
            {v?.source === 'ai' && <Sparkles className="ml-1 inline h-3 w-3 align-baseline text-primary/60" aria-label="read by the AI" />}
          </dd>
          {f.key === 'hearing_date' && ov?.fields.hearing_note && <dd className="text-[11px] text-muted-foreground">{ov.fields.hearing_note.value}</dd>}
          {f.key === 'officer' && v && <dd><OfficerContact name={v.value} /></dd>}
        </div>
      );
    })}
  </dl>
);

const NoticeCasePage: React.FC = () => {
  const { clientId = '', caseKey: rawKey = '' } = useParams();
  const caseKey = decodeURIComponent(rawKey);
  const { isStaffRole, user } = useAuth();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['notice-case', clientId, caseKey], queryFn: () => loadCase(clientId, caseKey), enabled: !!clientId && !!caseKey });
  const items = useQuery({ queryKey: ['notice-case-items', clientId, caseKey], queryFn: () => loadCaseItems(clientId, caseKey), enabled: !!clientId && !!caseKey });
  const ov = useCaseOverview(clientId, caseKey);
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
  if (c.isLoading) return <div className={WS_PAGE}><Skeleton className="h-8 w-96" /><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (c.error || !r) {
    return (
      <div className={WS_PAGE}>
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground"><Link to="/notices-cases" className="hover:underline">Cases</Link> › Case</nav>
        <Note tone="warn">{c.error ? `Couldn't load the case: ${c.error instanceof Error ? c.error.message : String(c.error)}` : 'This case is not on record, or all its notices are hidden or closed out of the module.'}</Note>
      </div>
    );
  }
  const track = (r.track ?? 'litigation') as Track;
  const def = trackDef(track);
  const forms = r.forms ?? [];
  const newCount = (items.data ?? []).filter((i) => i.is_new).length;
  const shownItems = part ? (items.data ?? []).filter((i) => i.own_key === part) : items.data ?? [];
  const partMember = part ? members.find((m) => m.case_key === part) : undefined;

  return (
    <div className={WS_PAGE}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground md:pr-12">
        <Link to="/notices-dashboard" className="hover:underline">Notices & Litigation</Link> ›
        <Link to={`/notices-cases${track === 'litigation' ? '' : `?kind=${track}`}`} className="hover:underline">{def.label}</Link> ›
        <Link to={`/notices-company/${clientId}`} className="hover:underline">{r.client_name}</Link>
        <span className="font-mono">{r.client_gstin}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3 md:pr-12">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-heading text-lg font-bold leading-tight sm:text-xl">{r.form_code ? `${r.form_code} · ` : ''}{r.title}</h1>
          <p className="text-xs text-muted-foreground">
            {r.case_id ? <>Case <span className="font-mono">{r.case_id}</span> · </> : r.case_key === 'REG' ? 'All registration correspondence · ' : null}
            {plural(r.notices ?? 0, 'notice')}{r.documents ? `, ${plural(r.documents, 'document')}` : ''}
            {r.first_issue_date ? ` · since ${fmtDate(r.first_issue_date)}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Badge variant="secondary" className="text-[11px]">{def.label}</Badge>
            <WaitingChip r={r} long />
            {r.is_open && <StageBadge stage={r.stage} />}
            {r.is_open && r.next_due && (
              <Badge variant={r.is_overdue ? 'destructive' : r.is_due_in_7 ? 'warning' : 'secondary'} className="text-[11px]">
                {r.is_overdue ? 'Overdue' : 'Due'} {fmtDate(r.next_due)}
              </Badge>
            )}
            {r.next_hearing && <Badge variant="warning" className="text-[11px]">Hearing {fmtDate(r.next_hearing)}</Badge>}
            {track === 'litigation' && Number(r.exposure) > 0 && <Badge variant="info" className="text-[11px]">Exposure {fmtInr(r.exposure)}</Badge>}
            {newCount > 0 && <Badge variant="info" className="text-[11px]">{newCount} new since last opened</Badge>}
            {r.is_open && <OwnerChip name={r.assign_to} showName />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CaseAdminActions clientId={clientId} caseKey={r.case_key as string} open={!!r.is_open} />
          {r.case_id && (
            <Button size="sm" variant="outline" className={WS_BTN} asChild>
              <Link to={`/notices-case-folder/${clientId}/${encodeURIComponent(r.case_id)}`}><FolderOpen className="h-3.5 w-3.5" aria-hidden /> Portal case folder</Link>
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

      {track === 'litigation' ? (
        <SectionCard title="What the case is about"
          description={(ov.data?.reading?.queued ?? 0) > 0
            ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> The AI is reading {ov.data?.reading?.queued} of the case's documents</span>
            : ov.data?.reading?.documents ? `AI read ${ov.data.reading.done} of ${ov.data.reading.documents} documents` : undefined}>
          {ov.isLoading ? <Skeleton className="h-20 w-full" /> : <CaseFactsGrid ov={ov.data} />}
        </SectionCard>
      ) : (
        <KindFacts track={track} overview={ov.data} loading={ov.isLoading} forms={forms}
          notice={{ form_label: r.form_label, issue_date: r.last_issue_date, reference_number: r.reference_number, financial_year: r.financial_year }} />
      )}

      <CaseChainPanel clientId={clientId} caseKey={r.case_key as string} part={part} onPart={setPart} />

      <SectionCard title="Correspondence"
        description={items.data ? `${shownItems.length} items, newest first${part ? ` · ${partMember ? caseLabel(partMember) : 'one case'} only` : members.length > 1 ? ` · all ${members.length} linked cases` : ''}${newCount ? ` · ${newCount} new` : ''}` : undefined}
        actions={members.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Whose correspondence">
            <button type="button" onClick={() => setPart(null)} aria-pressed={!part}
              className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', !part ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}>
              Linked: all cases
            </button>
            {members.map((m) => (
              <button key={m.case_key} type="button" onClick={() => setPart(m.case_key)} aria-pressed={part === m.case_key} title={m.case_id ?? m.case_key}
                className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', part === m.case_key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}>
                {caseLabel(m).split(' · ')[0]}{m.case_id ? ` ${m.case_id.slice(-6)}` : ''}
              </button>
            ))}
          </div>
        )}>
        {items.error ? <Note tone="warn">Couldn't load the correspondence: {items.error instanceof Error ? items.error.message : String(items.error)}</Note>
          : items.isLoading ? <Skeleton className="h-64 w-full" />
          : <CaseTimeline items={shownItems} partOf={part ? undefined : partOf} />}
      </SectionCard>
    </div>
  );
};

export default NoticeCasePage;
