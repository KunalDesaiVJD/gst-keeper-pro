// (c) Reading accuracy (roadmap Phase 4 acceptance; audit R-08, R-15): how the
// AI reader did on the fields people verified — the due date read exactly
// (target ≥ 98%) and the demand within ₹1 — said honestly as "not enough
// verified yet" below 20 verifications, and the fields still showing
// "auto — verify". Counts are reply_factory_status(); each opens its fields.
import React, { useMemo } from 'react';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { fmtWhen } from '@/lib/autopilot';
import {
  ACCURACY_MIN_SAMPLE, DUE_EXACT_TARGET, READ_FIELD_LABELS, factoryHref, fmtShare, isPendingVerify, readValueText, shareOf,
  useAiReadFields, useListPage, type ReadFieldRow, type ReplyFactoryStatus, type Tone,
} from '@/lib/replyFactory';
import { ChipLinks, CountLink, DrillFrame, NoticeCell, TargetMark } from './parts';
import { cn } from '@/lib/utils';

type AccKind = 'due' | 'due_exact' | 'demand' | 'demand_ok' | 'all' | 'confirmed' | 'rejected' | 'pending';
const KINDS: Record<AccKind, { title: string; match: (r: ReadFieldRow) => boolean }> = {
  due: { title: 'Due dates read by AI and verified', match: (r) => r.verified && r.field === 'due_date' },
  due_exact: { title: 'Due dates read exactly', match: (r) => r.verified && r.field === 'due_date' && r.exact },
  demand: { title: 'Demands read by AI and verified', match: (r) => r.verified && r.field === 'demand' },
  demand_ok: { title: 'Demands read within ₹1', match: (r) => r.verified && r.field === 'demand' && r.exact },
  all: { title: 'Every verified field the AI reader filled', match: (r) => r.verified },
  confirmed: { title: 'Fields confirmed as read', match: (r) => r.verified && r.result === 'confirmed' },
  rejected: { title: 'Fields people rejected', match: (r) => r.verified && r.result === 'rejected' },
  pending: { title: 'Fields still to verify ("auto — verify")', match: (r) => isPendingVerify(r) },
};

const RESULT: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmed', tone: 'success' },
  corrected: { label: 'Corrected', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'destructive' },
};

const Measure: React.FC<{
  label: string; good: number; of: number; target: string; targetOk: (share: number) => boolean; goodTo: string; ofTo: string; goodWords: string;
}> = ({ label, good, of, target, targetOk, goodTo, ofTo, goodWords }) => {
  const enough = of >= ACCURACY_MIN_SAMPLE;
  const share = shareOf(good, of);
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {enough ? (
        <div className="text-lg font-semibold tabular-nums">
          {fmtShare(share)}<TargetMark ok={share !== null && targetOk(share)} what={target} />
        </div>
      ) : (
        <div className="text-lg font-semibold text-muted-foreground">Too few yet</div>
      )}
      <p className="text-xs">
        <CountLink to={goodTo} n={good} /> {goodWords} of <CountLink to={ofTo} n={of} /> verified
        {!enough && <span className="text-foreground/70"> · a share from {ACCURACY_MIN_SAMPLE}</span>}
      </p>
    </div>
  );
};

export const AccuracySection: React.FC<{ s: ReplyFactoryStatus; show: string; part?: 'card' | 'list' }> = ({ s, show, part = 'card' }) => {
  const acc = s.accuracy;
  const fields = useAiReadFields(true);
  const pending = useMemo(() => (fields.data ?? []).filter(isPendingVerify).length, [fields.data]);
  const href = (k: AccKind) => factoryHref('overview', { show: `acc:${k}` });
  const kind = show.startsWith('acc:') ? (show.slice(4) as AccKind) : null;
  const rows = useMemo(() => (kind && KINDS[kind] ? (fields.data ?? []).filter(KINDS[kind].match) : []), [fields.data, kind]);
  const pager = useListPage();
  const pageRows = pager.slice(rows);

  const list = kind && KINDS[kind] ? (
    <DrillFrame title={KINDS[kind].title} count={fields.data ? rows.length : null} closeTo={factoryHref('overview', { show: 'none' })}
      loading={fields.isLoading} error={fields.error} onRetry={() => fields.refetch()} empty="No field matches.">
      <ul className="space-y-1.5 md:hidden">
        {pageRows.map((r) => (
          <li key={`${r.notice_id}-${r.field}`} className="space-y-1 rounded-md border bg-card p-2.5">
            <NoticeCell n={r.notice} id={r.notice_id} />
            <div className="text-xs"><span className="font-medium">{READ_FIELD_LABELS[r.field] ?? r.field}:</span> read {readValueText(r.field, r.value)}
              {' '}· now {readValueText(r.field, r.current)}</div>
            <ResultLine r={r} />
          </li>
        ))}
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <caption className="sr-only">{KINDS[kind].title}</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Notice</th>
              <th scope="col" className={WS_TH}>Field</th>
              <th scope="col" className={WS_TH}>Read by AI</th>
              <th scope="col" className={WS_TH}>On the notice now</th>
              <th scope="col" className={WS_TH}>Result</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={`${r.notice_id}-${r.field}`} className={WS_TR}>
                <td className={cn(WS_TD, 'max-w-[18rem]')}><NoticeCell n={r.notice} id={r.notice_id} /></td>
                <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{READ_FIELD_LABELS[r.field] ?? r.field}</td>
                <td className={cn(WS_TD, 'text-xs')}>{readValueText(r.field, r.value)}</td>
                <td className={cn(WS_TD, 'text-xs')}>{readValueText(r.field, r.current)}</td>
                <td className={WS_TD}><ResultLine r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
    </DrillFrame>
  ) : null;
  if (part === 'list') return list;

  return (
    <SectionCard title="Reading accuracy"
      description={`How the AI reader did on the fields people verified. Targets: due date read exactly on at least ${DUE_EXACT_TARGET}%; the demand within ₹1. A share is shown from ${ACCURACY_MIN_SAMPLE} verifications.`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Measure label="Due date read exactly" good={acc.due_date_exact} of={acc.due_date_verified} goodWords="exact"
          target={`at least ${DUE_EXACT_TARGET}%`} targetOk={(x) => x >= DUE_EXACT_TARGET} goodTo={href('due_exact')} ofTo={href('due')} />
        <Measure label="Demand within ₹1" good={acc.demand_within_1} of={acc.demand_verified} goodWords="within ₹1"
          target="every demand within ₹1" targetOk={(x) => x >= 100} goodTo={href('demand_ok')} ofTo={href('demand')} />
      </div>
      <ChipLinks label="Fields verified" items={[
        { key: 'all', label: 'All', n: acc.fields_verified, to: href('all') },
        { key: 'confirmed', label: 'Confirmed', n: acc.fields_confirmed, to: href('confirmed') },
        { key: 'rejected', label: 'Rejected', n: acc.fields_rejected, to: href('rejected'), bad: true },
        ...(fields.data ? [{ key: 'pending', label: 'To verify', n: pending, to: href('pending') }] : []),
      ]} />
    </SectionCard>
  );
};

const ResultLine: React.FC<{ r: ReadFieldRow }> = ({ r }) => {
  if (!r.verified) return <span className="text-xs font-medium">Auto — verify <span className="font-normal text-muted-foreground">· read {fmtWhen(r.at)}</span></span>;
  const res = RESULT[r.result ?? ''] ?? { label: r.result ?? 'Verified', tone: 'secondary' as Tone };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <ToneBadge tone={res.tone}>{res.label}</ToneBadge>
      {(r.field === 'demand' || r.field === 'due_date') && r.result !== 'confirmed' && (
        <span className={r.exact ? 'text-success-strong' : 'text-destructive-strong'}>{r.exact ? 'within ₹1' : r.field === 'demand' ? 'not within ₹1' : 'not exact'}</span>
      )}
      <span className="text-muted-foreground">{r.verified_by ? `by ${r.verified_by}` : ''}{r.verified_at ? ` · ${fmtWhen(r.verified_at)}` : ''}</span>
    </div>
  );
};

export default AccuracySection;
