// Notices & Litigation · Case folder (/notices-case-folder/:clientId/:caseId;
// roadmap Phase 2). Fixes audit U-60-1..5, U-61-1..3, U-62-1..3, U-63-1..3 and
// the cross-cutting house-style, date, status, empty-box and linking findings
// for this screen: named for the client and the kind of case (read from the
// items' forms, not the folder code), the portal's status apart from our stage,
// what needs a person as chips, the money, every item once in date order with
// its documents, the notice workspace / matter / portal one click away, and the
// portal's own grouping folded underneath.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, RefreshCw, Reply, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note, KpiTile } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { LogReplyDialog } from '@/components/notices/actions/LogReplyDialog';
import type { NoticeRef } from '@/components/notices/actions/NoticeContext';
import { DEADLINE_LABELS } from '@/components/notices/workspace/DeadlinesTab';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import {
  SECTION_ORDER, expectedSections, rawFields, replyTiming, sectionLabel, summarizeCase,
  type CaseEvent, type CaseSummary, type FolderItem,
} from '@/components/notices/clients/caseFolder';
import { daysBetween, istToday, type NoticeFact } from '@/lib/noticeFacts';
import { dueWords, fmtDate, fmtFy, fmtInr, fmtInrShort, noticeTitle, plural } from '@/lib/noticeFormat';
import type { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

type Deadline = Database['public']['Tables']['matter_deadlines']['Row'];
type Refund = Pick<Database['public']['Tables']['gst_refund_applications']['Row'], 'arn' | 'refund_type' | 'filed_date' | 'claimed_amount' | 'sanctioned_amount' | 'status'>;

interface CaseData {
  client: { id: string; name: string; gstin: string } | null;
  items: FolderItem[];
  notices: NoticeFact[];
  refund: Refund | null;
  deadlines: Deadline[];
  matter: { id: string; matter_no: string; stage: string } | null;
}

async function loadCase(clientId: string, caseId: string): Promise<CaseData> {
  const [client, items, notices, refund] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gst_case_folder_items').select('*').eq('client_id', clientId).eq('case_id', caseId).is('deleted_at', null),
    supabase.from('notice_facts').select('*').eq('client_id', clientId).eq('case_id', caseId).order('issue_date', { ascending: false }),
    supabase.from('gst_refund_applications').select('arn, refund_type, filed_date, claimed_amount, sanctioned_amount, status')
      .eq('client_id', clientId).eq('arn', caseId).is('deleted_at', null).limit(1),
  ]);
  const err = client.error ?? items.error ?? notices.error;
  if (err) throw err;
  const facts = (notices.data ?? []) as NoticeFact[];
  const ids = facts.map((n) => n.id).filter((id): id is string => !!id);
  const matterId = facts.find((n) => n.matter_id)?.matter_id ?? null;
  const [deadlines, matter] = await Promise.all([
    ids.length ? supabase.from('matter_deadlines').select('*').in('notice_id', ids).eq('is_met', false).order('deadline_date') : Promise.resolve({ data: [] as Deadline[], error: null }),
    matterId ? supabase.from('litigation_matters').select('id, matter_no, stage').eq('id', matterId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    client: client.data ?? null,
    items: (items.data ?? []) as FolderItem[],
    notices: facts,
    refund: (refund.data ?? [])[0] ?? null,
    deadlines: (deadlines.data ?? []) as Deadline[],
    matter: (matter.data ?? null) as CaseData['matter'],
  };
}

/** The notice the case is worked on: an open one first, the portal's case row before a plain notice, the latest. */
function caseNotice(notices: NoticeFact[]): NoticeFact | null {
  const generic = (n: NoticeFact) => /^(notice|order)s?$/i.test((n.notice_type ?? '').trim());
  return [...notices].sort((a, b) => Number(!!b.is_open) - Number(!!a.is_open) || Number(generic(a)) - Number(generic(b))
    || (b.issue_date ?? '').localeCompare(a.issue_date ?? ''))[0] ?? null;
}

function toRef(f: NoticeFact): NoticeRef {
  return {
    id: f.id as string, client_id: f.client_id as string, client_name: f.client_name, reference_number: f.reference_number, case_id: f.case_id,
    form_code: f.form_code, form_label: f.form_label, notice_type: f.notice_type, description: f.description, financial_year: f.financial_year,
    effective_due: f.effective_due, amount_of_demand: f.amount_of_demand, matter_id: f.matter_id, hearing_date: f.hearing_date,
    hearing_note: f.hearing_note, extended_due_date: f.extended_due_date, due_date: f.due_date,
  };
}

const PORTAL_TONE = (s: string): 'destructive' | 'warning' | 'info' | 'secondary' | 'success' =>
  /overdue|outstanding/i.test(s) ? 'destructive' : /awaited|hearing/i.test(s) ? 'warning' : /closed|paid/i.test(s) ? 'secondary' : 'info';

function DueChip({ f }: { f: NoticeFact }) {
  if (!f.is_open) return <Badge variant="secondary" className="text-[11px]">Notice closed</Badge>;
  if (f.reply_date) return <Badge variant="success" className="text-[11px]">Reply logged {fmtDate(f.reply_date)}</Badge>;
  if (!f.effective_due) return <Badge variant="secondary" className="text-[11px]">No due date</Badge>;
  const d = f.days_to_due ?? 0;
  return (
    <Badge variant={d < 0 ? 'destructive' : d <= 7 ? 'warning' : 'secondary'} className="text-[11px]">
      {d < 0 ? `Reply overdue ${-d} d` : d === 0 ? 'Reply due today' : `Reply due in ${d} d`} · {fmtDate(f.effective_due)}
    </Badge>
  );
}

const factText = (label: string, value: string) => (label === 'FY' ? `FY ${fmtFy(value) || value}` : `${label.toLowerCase()} ${value}`);

const EventItem: React.FC<{ e: CaseEvent; events: CaseEvent[]; noticeId?: string | null; compact?: boolean }> = ({ e, events, noticeId, compact }) => {
  const timing = e.code === 'REPLY' ? replyTiming(e, events) : null;
  if (compact) {
    return (
      <li className="relative border-l-2 border-border pb-3 pl-4 last:pb-0">
        <span aria-hidden className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-destructive" />
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold tabular-nums">{e.date ? fmtDate(e.date) : 'date not shown'}</span>
          <span className="min-w-0 break-words text-sm font-medium">{e.title}</span>
          <span className="text-xs text-muted-foreground">{e.amount ? `${fmtInr(e.amount)} · ` : ''}details under Outstanding demand above</span>
        </div>
      </li>
    );
  }
  return (
    <li className="relative border-l-2 border-border pb-3 pl-4 last:pb-0">
      <span aria-hidden className={cn('absolute -left-[5px] top-1.5 h-2 w-2 rounded-full', e.outstanding ? 'bg-destructive' : e.code === 'REPLY' ? 'bg-success' : 'bg-primary')} />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold tabular-nums">{e.date ? fmtDate(e.date) : 'date not shown'}</span>
        <span className="min-w-0 break-words text-sm font-medium">{e.title}</span>
        <Badge variant="secondary" className="text-[10px]">{sectionLabel(e.code)}</Badge>
        {e.outstanding && <Badge variant="destructive" className="text-[10px]">Outstanding</Badge>}
      </div>
      {e.subject && <p className="mt-0.5 break-words text-sm">{e.subject}</p>}
      <p className="mt-0.5 break-words text-xs text-muted-foreground">
        {[
          e.by && (e.code === 'REPLY' || e.code === 'APLCN' ? `filed by ${e.by}` : `by ${e.by}`),
          e.ref && `ref ${e.ref}`,
          e.answers?.ref && `against ${e.answers.ref}${e.answers.date ? ` dated ${fmtDate(e.answers.date)}` : ''}`,
          e.due && e.due !== e.hearing?.date && `reply due ${fmtDate(e.due)}`,
          e.hearing && `hearing ${fmtDate(e.hearing.date)}${e.hearing.time ? `, ${e.hearing.time}` : ''}`,
          ...e.facts.map((f) => factText(f.label, f.value)),
        ].filter(Boolean).join(' · ')}
        {timing && <> · <span className={cn('font-medium', /late/.test(timing) ? 'text-destructive-strong' : 'text-success-strong')}>{timing}</span></>}
        {noticeId && <> · <Link to={`/notices/${noticeId}`} className="font-medium text-primary underline underline-offset-2">open the notice<span className="sr-only"> {e.ref}</span></Link></>}
      </p>
      {e.attachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {e.attachments.map((a) => (
            <a key={a.url + a.label} href={a.url} target="_blank" rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileText className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{a.label}</span>
            </a>
          ))}
        </div>
      )}
    </li>
  );
};

/** The portal's grouping, folded: each item's own fields, dates in the house format (U-61-3, U-63-3). */
const PortalSections: React.FC<{ summary: CaseSummary }> = ({ summary }) => {
  const groups = new Map<string, CaseEvent[]>();
  summary.events.forEach((e) => groups.set(e.code, [...(groups.get(e.code) ?? []), e]));
  const codes = [...groups.keys()].sort((a, b) => (SECTION_ORDER.indexOf(a) + 1 || 99) - (SECTION_ORDER.indexOf(b) + 1 || 99));
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Portal sections <span className="font-normal text-muted-foreground">· the folder as the portal groups it, with every field it returned</span>
      </summary>
      <div className="space-y-3 border-t px-4 py-3">
        {codes.map((code) => (
          <section key={code} aria-label={sectionLabel(code)}>
            <h3 className="text-xs font-semibold text-foreground/70">{sectionLabel(code)} · {groups.get(code)?.length}</h3>
            <ul className="mt-1 space-y-1.5">
              {(groups.get(code) ?? []).map((e) => (
                <li key={e.id} className="rounded-md border p-2 text-xs">
                  <div className="font-medium">{e.title} <span className="font-normal text-muted-foreground">· {e.date ? fmtDate(e.date) : 'no date'}{e.ref ? ` · ${e.ref}` : ''}</span></div>
                  <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(8rem,14rem)_1fr]">
                    {rawFields(e.raw).map((f) => (
                      <React.Fragment key={f.label}>
                        <dt className="text-muted-foreground">{f.label}</dt>
                        <dd className="break-words">{f.value}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
};

const AdditionalNoticeFolderPage: React.FC = () => {
  const { isStaffRole, canEditNoticeStatus } = useAuth();
  const { clientId = '', caseId = '' } = useParams<{ clientId: string; caseId: string }>();
  const qc = useQueryClient();
  const bridge = useExtensionBridge();
  const [replyOpen, setReplyOpen] = useState(false);
  const q = useQuery({ queryKey: ['case-folder', clientId, caseId], enabled: !!clientId && !!caseId, queryFn: () => loadCase(clientId, caseId) });
  const today = istToday();
  const data = q.data;
  const notice = useMemo(() => (data ? caseNotice(data.notices) : null), [data]);
  const noticeByRef = useMemo(() => new Map((data?.notices ?? []).filter((n) => n.reference_number).map((n) => [n.reference_number as string, n])), [data]);
  const summary = useMemo(() => (data ? summarizeCase(data.items, {
    noticeType: notice?.notice_type, descriptions: data.notices.map((n) => n.description ?? ''), today,
    fallbackLabel: notice ? noticeTitle(notice, { fy: false }) : null,
    noticeTitles: new Map([...noticeByRef].map(([ref, n]) => [ref, noticeTitle(n, { fy: false })])),
  }) : null), [data, notice, noticeByRef, today]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  if (!clientId || !caseId) return <Navigate to="/notices-company-list" replace />;

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['case-folder', clientId, caseId] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
  };
  const canEdit = canEditNoticeStatus();
  const clientName = data?.client?.name ?? 'Client';

  const breadcrumb = (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <Link to="/notices-company-list" className="hover:underline">Clients</Link> ›
      <Link to={`/notices-company/${clientId}`} className="hover:underline">{clientName}</Link> ›
      <span className="text-foreground">Case <span className="font-mono">{caseId}</span></span>
    </nav>
  );

  if (q.isLoading) {
    return (
      <NoticesShell section="Case folder">
        <div className="space-y-2" aria-busy="true"><Skeleton className="h-4 w-72" /><Skeleton className="h-7 w-[30rem] max-w-full" /><Skeleton className="h-5 w-96 max-w-full" /><Skeleton className="h-64 w-full" /></div>
      </NoticesShell>
    );
  }
  if (q.error || !data || !summary) {
    return (
      <NoticesShell section="Case folder">
        {breadcrumb}
        <Note tone="warn">Couldn't load the case folder: {q.error instanceof Error ? q.error.message : String(q.error)}</Note>
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => q.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry</Button>
      </NoticesShell>
    );
  }
  if (!data.items.length && !data.notices.length) {
    return (
      <NoticesShell section="Case folder">
        {breadcrumb}
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing is on record for case <span className="font-mono">{caseId}</span>{data.client ? ` of ${data.client.name}` : ''}. The next portal sync of this client
          fetches its folder. <Link to={`/notices-company/${clientId}`} className="text-primary underline underline-offset-2">Open the client</Link>
        </div>
      </NoticesShell>
    );
  }

  const s = summary;
  const fy = fmtFy(notice?.financial_year ?? s.fy);
  const demand = Number(notice?.amount_of_demand) || 0;
  const latestReply = [...s.events].reverse().find((e) => e.code === 'REPLY') ?? null;
  const portalReply = latestReply ? { date: latestReply.date, ref: (typeof latestReply.raw.arn === 'string' && latestReply.raw.arn) || latestReply.ref } : null;
  // Only a reply filed on or after this notice answers it (a Part B reply to the earlier DRC-01A does not).
  const answersNotice = !!latestReply && !!notice && (latestReply.answers?.ref === notice.reference_number
    || (!!latestReply.date && !!notice.issue_date && latestReply.date >= notice.issue_date));
  const canLogReply = canEdit && !!notice && !!notice.is_open && !notice.reply_date && answersNotice;
  // The due date is said once: as the hearing, or as the portal's unanswered notice, else as our due chip.
  const showDue = !!notice && (!notice.is_open || !!notice.reply_date || (!!notice.effective_due
    && notice.effective_due !== s.pendingDue && notice.effective_due !== s.nextHearing?.date));
  const openPortal = async () => {
    if (!bridge.ready) { toast.error('Install or enable the GST Keeper extension to open the portal from here.'); return; }
    const r = await bridge.openOnPortal(clientId, notice?.reference_number ?? null);
    if (!r.ok) toast.error(r.error || 'Could not open the portal.');
  };
  const refund = data.refund;
  const notSanctioned = refund?.claimed_amount != null && refund.sanctioned_amount != null ? Number(refund.claimed_amount) - Number(refund.sanctioned_amount) : null;
  const appeal = s.kind === 'appeal' ? s.events.find((e) => e.code === 'APLCN') : null;
  const disputed = appeal?.facts.find((f) => f.label === 'Disputed tax')?.value;
  const preDeposit = appeal?.facts.find((f) => f.label === 'Pre-deposit paid')?.value;
  const empty = expectedSections(s.kind).filter((code) => !s.events.some((e) => e.code === code));
  const pinned = s.events.filter((e) => e.outstanding);
  const otherNotices = data.notices.filter((n) => n.id !== notice?.id);

  return (
    <NoticesShell section="Case folder">
      {breadcrumb}
      <header className="space-y-1.5">
        <h2 className="break-words font-heading text-lg font-bold leading-tight sm:text-xl">
          {clientName} · {s.label}{fy ? ` · FY ${fy}` : ''}
        </h2>
        <p className="break-words text-xs text-muted-foreground">
          Case <span className="font-mono">{caseId}</span>{data.client ? <> · <span className="font-mono">{data.client.gstin}</span></> : null}
          {s.opened ? ` · opened ${fmtDate(s.opened)}` : ''}
          {s.last?.date ? ` · last activity ${fmtDate(s.last.date)} (${s.last.form ?? s.last.title})` : ''}
          {demand > 0 ? ` · demand ${fmtInr(demand)}` : ''}
          {' · '}{plural(s.events.length, 'item')} on the portal
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {notice && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">Our stage <StageBadge stage={notice.stage} since={notice.stage_changed_at} by={notice.stage_changed_by} /></span>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">Portal <Badge variant={PORTAL_TONE(s.portalStatus)} className="text-[11px]">{s.portalStatus}</Badge></span>
          {notice && showDue && <DueChip f={notice} />}
          {notice && <OwnerChip name={notice.assign_to} showName />}
          {s.alerts.map((a) => <Badge key={a.text} variant={a.tone} className="text-[11px]">{a.text}</Badge>)}
          {data.deadlines.filter((d) => d.deadline_type !== 'reply_due').map((d) => (
            <Badge key={d.id} variant={daysBetween(today, d.deadline_date) <= 7 ? 'warning' : 'secondary'} className="text-[11px]">
              {DEADLINE_LABELS[d.deadline_type] ?? d.deadline_type}: {fmtDate(d.deadline_date)} ({dueWords(daysBetween(today, d.deadline_date)).replace('due ', '')})
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {notice ? (
            <Button size="sm" className={WS_BTN} asChild><Link to={`/notices/${notice.id}`}><FileText className="h-3.5 w-3.5" aria-hidden /> Open the notice</Link></Button>
          ) : (
            <span className="text-xs text-muted-foreground">No notice of this case is on record yet; the next sync adds it.</span>
          )}
          {data.matter && (
            <Button size="sm" variant="outline" className={WS_BTN} asChild><Link to={`/litigation/${data.matter.id}`}><Scale className="h-3.5 w-3.5" aria-hidden /> Matter {data.matter.matter_no}</Link></Button>
          )}
          {canLogReply && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setReplyOpen(true)}><Reply className="h-3.5 w-3.5" aria-hidden /> Log the portal reply</Button>
          )}
          {notice && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={openPortal}><ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open on the portal</Button>
          )}
        </div>
      </header>

      {(refund || appeal || pinned.length > 0 || demand > 0) && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {refund && <KpiTile label="Claimed" value={fmtInrShort(refund.claimed_amount)} hint={refund.filed_date ? `filed ${fmtDate(refund.filed_date)}` : refund.refund_type ?? undefined} />}
          {refund && <KpiTile label="Sanctioned" value={refund.sanctioned_amount != null ? fmtInrShort(refund.sanctioned_amount) : '—'} hint={refund.status ?? undefined} tone={refund.sanctioned_amount != null ? 'ok' : 'neutral'} />}
          {refund && notSanctioned !== null && (
            <KpiTile label="Not sanctioned" value={fmtInrShort(notSanctioned)} tone={notSanctioned > 0 ? 'error' : 'ok'}
              hint={notSanctioned > 0 ? 'appealable (APL-01, s.107)' : 'claimed in full'} />
          )}
          {disputed && <KpiTile label="Disputed tax" value={disputed} hint="in the APL-01" />}
          {preDeposit && <KpiTile label="Pre-deposit paid" value={preDeposit} hint="credited against the demand" />}
          {pinned.length > 0 && <KpiTile label="Outstanding demand" value={fmtInrShort(s.outstanding)} tone="error" hint={plural(pinned.length, 'recovery item')} />}
          {demand > 0 && <KpiTile label="Demand in the notice" value={fmtInrShort(demand)} hint={notice?.matter_id ? 'followed in the matter' : 'tax, interest and penalty'} />}
        </div>
      )}
      {refund && notSanctioned !== null && notSanctioned > 0 && (
        <Note tone="warn">
          {fmtInr(notSanctioned)} of the claim was not sanctioned. A partial rejection can be appealed (APL-01) within the limit under s.107;
          {notice ? <> log the order on the <Link to={`/notices/${notice.id}?tab=deadlines`} className="underline underline-offset-2">notice</Link> to start its appeal clock.</> : ' log the order on the notice to start its appeal clock.'}
        </Note>
      )}

      {pinned.length > 0 && (
        <SectionCard title="Outstanding demand" description="Recovery the portal shows against this case · pinned first" className="border-destructive/50">
          <ul>{pinned.map((e) => <EventItem key={e.id} e={e} events={s.events} noticeId={e.ref ? noticeByRef.get(e.ref)?.id : null} />)}</ul>
        </SectionCard>
      )}

      <SectionCard title="Case history" description="Every item on the portal, oldest first, with its documents">
        <ol aria-label="Case history" className="pt-1">
          {s.events.map((e) => <EventItem key={e.id} e={e} events={s.events} compact={e.outstanding}
            noticeId={e.ref && noticeByRef.get(e.ref)?.id !== notice?.id ? noticeByRef.get(e.ref)?.id : null} />)}
        </ol>
        {empty.length > 0 && (
          <p className="text-xs text-muted-foreground">Nothing on the portal yet under {empty.map(sectionLabel).join(', ').toLowerCase()}.</p>
        )}
      </SectionCard>

      {otherNotices.length > 0 && (
        <SectionCard title="Other notices in this case" description="Each opens its workspace">
          <ul className="divide-y">
            {otherNotices.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <Link to={`/notices/${n.id}`} className="min-w-0 flex-1 break-words font-medium hover:underline">{noticeTitle(n)}</Link>
                <span className="text-xs text-muted-foreground">{n.reference_number ?? ''}{n.issue_date ? ` · ${fmtDate(n.issue_date)}` : ''}</span>
                <StageBadge stage={n.stage} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {s.events.length > 0 && <PortalSections summary={s} />}

      {notice && canLogReply && (
        <LogReplyDialog notice={toRef(notice)} open={replyOpen} onOpenChange={setReplyOpen} onDone={reload} portalReply={portalReply} />
      )}
    </NoticesShell>
  );
};

export default AdditionalNoticeFolderPage;
