// (b) Automatic annexures (roadmap Phase 4 acceptance, target ≥ 70%; audit
// R-10, R-23): open ASMT-10, DRC-01A, DRC-01B and DRC-01C notices whose
// evidence the app built by itself, by form, with the ones waiting for portal
// data, and "Build evidence for all" over the notices without a usable
// annexure — one notice at a time, with progress and a way to stop.
import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Hammer, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { buildEvidenceForNotice, type BuildOutcome } from '@/lib/reply';
import { autopilotOn } from '@/lib/reply/autoBuild';
import { noticesListHref } from '@/lib/noticeQueries';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { fmtWhen } from '@/lib/autopilot';
import {
  ANNEXURE_FORMS, ANNEXURE_STATUS, AUTO_ANNEXURE_TARGET, factoryHref, fmtShare, shareOf, targetTone, useAnnexureTargets, useListPage,
  type AnnexureTarget, type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { CountLink, DrillFrame, NoticeCell, TargetMark } from './parts';
import { cn } from '@/lib/utils';

type AnnKind = 'all' | 'with' | 'auto' | 'needs' | 'without';
const KINDS: Record<AnnKind, { title: string; match: (t: AnnexureTarget) => boolean }> = {
  all: { title: 'Open notices of these forms', match: () => true },
  with: { title: 'With a ready or partly built annexure', match: (t) => t.hasAnnexure },
  auto: { title: 'Evidence built automatically', match: (t) => t.automatic },
  needs: { title: 'Waiting for portal data', match: (t) => t.needsData },
  without: { title: 'Without a usable annexure', match: (t) => !t.hasAnnexure },
};

/** What one notice's build came to (a card that failed to save does not count as built). */
function buildOutcome(r: BuildOutcome): 'built' | 'needs_data' | 'nothing' | 'failed' {
  if (r.error) return 'failed';
  const ok = r.cards.filter((c) => !c.error);
  if (r.cards.length > 0 && ok.length === 0) return 'failed';
  if (ok.some((c) => c.status === 'ready' || c.status === 'partial')) return 'built';
  if (ok.some((c) => c.status === 'needs_data')) return 'needs_data';
  return 'nothing';
}
const buildError = (r: BuildOutcome) => r.error ?? r.cards.find((c) => c.error)?.error ?? null;

interface Run {
  total: number; done: number; built: number; needs: number; nothing: number; failed: number;
  current: AnnexureTarget | null; stopping: boolean; firstError: string | null;
}

export const AnnexuresSection: React.FC<{ s: ReplyFactoryStatus; show: string; canBuild: boolean }> = ({ s, show, canBuild }) => {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const targets = useAnnexureTargets(true);
  const [run, setRun] = useState<Run | null>(null);
  const pager = useListPage();
  const stop = useRef(false);
  const a = s.annexures;
  const rows = targets.data ?? [];
  const pending = rows.filter((t) => !t.hasAnnexure);
  const kind = show.startsWith('ann:') ? (show.slice(4) as AnnKind) : null;
  const aform = sp.get('aform');
  const href = (k: AnnKind, form?: string) => factoryHref('overview', { show: `ann:${k}`, aform: form });
  const tone = targetTone(a.share_automatic, AUTO_ANNEXURE_TARGET);
  const perForm = (form: string | null) => {
    const list = form ? rows.filter((t) => t.notice.form_code === form) : rows;
    return { open: list.length, with: list.filter((t) => t.hasAnnexure).length, auto: list.filter((t) => t.automatic).length,
      needs: list.filter((t) => t.needsData).length, without: list.filter((t) => !t.hasAnnexure).length };
  };

  const buildAll = async () => {
    const list = [...pending];
    if (!list.length) return;
    const queueMissing = await autopilotOn().catch(() => false);
    const ok = await confirm({
      title: `Build evidence for ${plural(list.length, 'notice')}?`,
      description: 'For each open ASMT-10, DRC-01A, DRC-01B and DRC-01C notice without a ready annexure, the app runs the evidence recipes on the portal figures it already holds and saves the annexures as built automatically. '
        + (queueMissing
          ? 'Where portal figures are missing, the pulls are queued for the autopilot and the annexure is built again when the data arrives.'
          : 'Where portal figures are missing the annexure waits for data; the autopilot is off, so each notice\'s Evidence tab says what to fetch.')
        + ' Nothing is filed or sent to anyone.',
      confirmText: 'Build evidence',
    });
    if (!ok) return;
    stop.current = false;
    const tally: Run = { total: list.length, done: 0, built: 0, needs: 0, nothing: 0, failed: 0, current: null, stopping: false, firstError: null };
    setRun({ ...tally });
    for (const t of list) {
      if (stop.current) break;
      tally.current = t;
      setRun({ ...tally });
      try {
        const r = await buildEvidenceForNotice(t.notice.id, { auto: true, queueMissing });
        const out = buildOutcome(r);
        if (out === 'built') tally.built += 1;
        else if (out === 'needs_data') tally.needs += 1;
        else if (out === 'failed') { tally.failed += 1; tally.firstError = tally.firstError ?? buildError(r); }
        else tally.nothing += 1;
      } catch (e) {
        tally.failed += 1;
        tally.firstError = tally.firstError ?? (e instanceof Error ? e.message : String(e));
      }
      tally.done += 1;
      setRun({ ...tally, stopping: stop.current });
    }
    const words = [
      `${plural(tally.built, 'notice')} with evidence built`,
      tally.needs && `${tally.needs} waiting for portal data`,
      tally.nothing && `${tally.nothing} with nothing to build`,
      tally.failed && `${tally.failed} failed${tally.firstError ? ` (${tally.firstError})` : ''}`,
    ].filter(Boolean).join(' · ');
    const stopped = tally.done < tally.total;
    (tally.failed ? toast.warning : toast.success)(`${stopped ? `Cancelled after ${tally.done} of ${tally.total}. ` : ''}${words}.`,
      tally.needs ? { description: 'They are listed under "waiting for portal data" in this section; each notice\'s Evidence tab says what is missing.' } : undefined);
    setRun(null);
    qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    qc.invalidateQueries({ queryKey: ['reply-factory'] });
  };

  const byForm = [...ANNEXURE_FORMS.map((f) => ({ form: f as string | null, n: perForm(f) })), { form: null as string | null, n: perForm(null) }];
  const listRows = kind && KINDS[kind] ? rows.filter((t) => KINDS[kind].match(t) && (!aform || t.notice.form_code === aform)) : [];
  const pageRows = pager.slice(listRows);

  return (
    <SectionCard
      title="Evidence built automatically"
      description={`Open ASMT-10, DRC-01A, DRC-01B and DRC-01C notices whose annexures the app built by itself from the portal figures. Target: at least ${AUTO_ANNEXURE_TARGET}%.`}
      actions={(
        <Badge variant={tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : tone === 'error' ? 'destructive' : 'secondary'} className="text-xs tabular-nums">
          {fmtShare(a.share_automatic)}<TargetMark ok={a.share_automatic === null ? null : a.share_automatic >= AUTO_ANNEXURE_TARGET} what={`the ${AUTO_ANNEXURE_TARGET}% target`} />
        </Badge>
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <CountLink to={href('auto')} n={a.automatic} /> of <CountLink to={href('all')} n={a.target_open} /> built
          automatically ({fmtShare(a.share_automatic)}) · <CountLink to={href('with')} n={a.with_annexure} /> with a ready
          annexure · <CountLink to={href('needs')} n={a.needs_data} /> waiting for portal data.
        </p>
        {canBuild && (
          <Button size="sm" className={WS_BTN} disabled={!!run || targets.isLoading || pending.length === 0} onClick={buildAll}>
            {run ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Hammer className="h-3.5 w-3.5" aria-hidden />}
            Build evidence for all ({pending.length.toLocaleString('en-IN')})
          </Button>
        )}
      </div>

      {run && (
        <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2.5" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="min-w-0 break-words">
              Building {Math.min(run.done + 1, run.total)} of {run.total}
              {run.current && <> · {run.current.notice.client_name} · {run.current.notice.form_code} {run.current.notice.reference_number}</>}
              {run.done > 0 && <span className="text-foreground/70"> · {run.built} built, {run.needs} waiting for data{run.failed ? `, ${run.failed} failed` : ''}</span>}
            </span>
            <Button size="sm" variant="outline" className={WS_BTN} disabled={run.stopping}
              onClick={() => { stop.current = true; setRun((r) => (r ? { ...r, stopping: true } : r)); }}>
              <Square className="h-3.5 w-3.5" aria-hidden /> {run.stopping ? 'Cancelling after this notice…' : 'Cancel'}
            </Button>
          </div>
          <Progress value={run.total ? (100 * run.done) / run.total : 0} className="h-2" aria-label="Evidence built so far" />
        </div>
      )}

      {/* Phones: one line per form. */}
      <ul className="space-y-1.5 md:hidden" aria-label="Annexures by form">
        {byForm.map(({ form, n }) => (
          <li key={form ?? 'total'} className={cn('rounded-md border bg-card p-2.5 text-xs', !form && 'bg-muted')}>
            <div className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span>{form ?? 'All four forms'}</span>
              <span className="tabular-nums">
                {fmtShare(shareOf(n.auto, n.open))}
                {n.open > 0 && <TargetMark ok={(shareOf(n.auto, n.open) ?? 0) >= AUTO_ANNEXURE_TARGET} what={`the ${AUTO_ANNEXURE_TARGET}% target`} />}
              </span>
            </div>
            <p className="mt-1">
              <CountLink to={form ? noticesListHref({ filter: 'open', form }) : href('all')} n={n.open} /> open ·{' '}
              <CountLink to={href('with', form ?? undefined)} n={n.with} /> ready · <CountLink to={href('auto', form ?? undefined)} n={n.auto} /> automatic ·{' '}
              <CountLink to={href('needs', form ?? undefined)} n={n.needs} /> waiting for data · <CountLink to={href('without', form ?? undefined)} n={n.without} /> without
            </p>
          </li>
        ))}
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')} tabIndex={0} role="region" aria-label="Annexures by form, table">
        <table className={WS_TABLE}>
          <caption className="sr-only">Open notices of the four forms and their annexures, by form</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Form</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Open</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Ready annexure</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Built automatically</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Waiting for portal data</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Without one</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Share automatic</th>
            </tr>
          </thead>
          <tbody>
            {byForm.map(({ form, n }) => (
              <tr key={form ?? 'total'} className={form ? WS_TR : WS_TR_TOTAL}>
                <th scope="row" className={cn(WS_TD, 'whitespace-nowrap text-left', form && 'font-medium')}>{form ?? 'All four forms'}</th>
                <td className={WS_TD_NUM}>
                  <CountLink to={form ? noticesListHref({ filter: 'open', form }) : href('all')} n={n.open}
                    label={form ? `open ${form} notices` : 'open notices of these forms'} />
                </td>
                <td className={WS_TD_NUM}><CountLink to={href('with', form ?? undefined)} n={n.with} label={`${form ?? ''} with a ready annexure`} /></td>
                <td className={WS_TD_NUM}><CountLink to={href('auto', form ?? undefined)} n={n.auto} label={`${form ?? ''} built automatically`} /></td>
                <td className={WS_TD_NUM}><CountLink to={href('needs', form ?? undefined)} n={n.needs} label={`${form ?? ''} waiting for portal data`} /></td>
                <td className={WS_TD_NUM}><CountLink to={href('without', form ?? undefined)} n={n.without} label={`${form ?? ''} without an annexure`} /></td>
                <td className={WS_TD_NUM}>
                  {fmtShare(shareOf(n.auto, n.open))}
                  {n.open > 0 && <TargetMark ok={(shareOf(n.auto, n.open) ?? 0) >= AUTO_ANNEXURE_TARGET} what={`the ${AUTO_ANNEXURE_TARGET}% target`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canBuild && <p className="text-[11px] text-muted-foreground">Building evidence needs the permission to work on notices.</p>}

      {kind && KINDS[kind] && (
        <DrillFrame title={`${KINDS[kind].title}${aform ? ` · ${aform}` : ''}`} count={targets.data ? listRows.length : null}
          closeTo={factoryHref('overview', { show: 'none' })} loading={targets.isLoading} error={targets.error} onRetry={() => targets.refetch()}
          empty="No notice matches.">
          <ul className="space-y-1.5 md:hidden">
            {pageRows.map((t) => (
              <li key={t.notice.id} className="space-y-1 rounded-md border bg-card p-2.5">
                <NoticeCell n={t.notice} id={t.notice.id} tab="evidence" />
                <AnnexureState t={t} />
              </li>
            ))}
          </ul>
          <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
            <table className={WS_TABLE}>
              <caption className="sr-only">{KINDS[kind].title}</caption>
              <thead>
                <tr>
                  <th scope="col" className={WS_TH}>Notice</th>
                  <th scope="col" className={WS_TH}>Due</th>
                  <th scope="col" className={WS_TH}>Latest annexure</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr key={t.notice.id} className={WS_TR}>
                    <td className={cn(WS_TD, 'max-w-[20rem]')}><NoticeCell n={t.notice} id={t.notice.id} tab="evidence" /></td>
                    <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtDate(t.notice.effective_due)}</td>
                    <td className={WS_TD}><AnnexureState t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pager.page} pageSize={pager.pageSize} total={listRows.length} onPage={pager.setPage} />
        </DrillFrame>
      )}
    </SectionCard>
  );
};

const AnnexureState: React.FC<{ t: AnnexureTarget }> = ({ t }) => {
  const a = t.latest;
  if (!a) return <span className="text-xs text-muted-foreground">None built yet</span>;
  const st = ANNEXURE_STATUS[a.status] ?? { label: a.status, tone: 'secondary' as const };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
      <span className="min-w-0 break-words">{a.title ?? a.recipe_key}{a.version > 1 ? ` · v${a.version}` : ''}</span>
      <span className="text-muted-foreground">
        {a.generated_by_name === 'Auto' ? 'built automatically' : `by ${a.generated_by_name ?? 'staff'}`} · {fmtWhen(a.generated_at)}
      </span>
    </div>
  );
};

export default AnnexuresSection;
