// One row per case (the central issue), with the columns its kind needs: a
// notice or demand shows its stage, due date, hearing and exposure; a refund
// its status and latest order; registration the latest step; the rest just
// what came in. New correspondence is flagged on the row.
import React from 'react';
import { Link } from 'react-router-dom';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { Badge } from '@/components/gstr9/badge';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { NextStepLine } from '@/components/notices/cases/NextStepLine';
import { WaitingChip } from '@/components/notices/cases/WaitingChip';
import { DisputeYearCell } from '@/components/notices/DisputeYearCell';
import { adviceOf, useAdviceMap } from '@/lib/noticeAdvice';
import { caseYearKey, useCaseDisputeYears } from '@/lib/noticeDisputeYears';
import { GitBranch } from 'lucide-react';
import { caseHref, linkKindDef, type CaseRow, type CaseView, type ChainLink, type FlatCaseRow, type Track } from '@/lib/noticeCases';
import { fmtDate, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { refundIndexKey, useRefundIndex } from '@/components/notices/reports/ledgerData';
import { RefundWhenChip } from '@/components/notices/reports/RefundBits';

function DueCell({ r }: { r: CaseRow }) {
  if (!r.is_open) return <span className="text-xs text-muted-foreground">closed</span>;
  if (!r.next_due) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn('whitespace-nowrap text-xs', r.is_overdue ? 'font-semibold text-destructive-strong' : r.is_due_in_7 ? 'font-semibold text-warning' : '')}>
      {fmtDate(r.next_due)}{r.is_overdue ? ' · overdue' : ''}
    </span>
  );
}

function Latest({ r }: { r: CaseRow }) {
  if (!r.latest_label) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {r.new_items ? <Badge variant="info" className="shrink-0 text-[10px]">{r.new_items} new</Badge> : null}
        <span className="truncate text-xs">{r.latest_label}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {r.latest_from === 'taxpayer' ? 'from us' : 'from the department'}{r.latest_date ? ` · ${fmtDate(r.latest_date)}` : ''}
      </div>
    </div>
  );
}

type Row = CaseRow & Partial<Pick<FlatCaseRow, 'root_key' | 'parent_key' | 'link_kind' | 'link_source'>>;

/** "1 appeal, 1 related" for the links under a chain. */
function kindsText(links: ChainLink[]): string {
  const n = new Map<string, number>();
  for (const l of links) n.set(l.kind, (n.get(l.kind) ?? 0) + 1);
  return [...n.entries()].map(([k, c]) => `${c} ${linkKindDef(k).label.toLowerCase()}`).join(', ');
}

/** How the row's case is linked: under a chain (linked), or to the chain it belongs to (apart). */
function ChainChip({ r, view, chains }: { r: Row; view: CaseView; chains?: Map<string, ChainLink[]> }) {
  const clientId = r.client_id as string;
  if (view === 'apart' && r.parent_key && r.root_key) {
    return (
      <Link to={caseHref(clientId, r.root_key)} title={`Part of the chain of case ${r.root_key}: open it linked`}
        className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded border border-info/40 bg-info/5 px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-info/10">
        <GitBranch className="h-3 w-3 shrink-0 text-info" aria-hidden />
        <span className="truncate">{linkKindDef(r.link_kind).label} · linked to <span className="font-mono">{r.parent_key}</span></span>
      </Link>
    );
  }
  const below = chains?.get(`${clientId}:${r.case_key}`) ?? [];
  if (!below.length) return null;
  return (
    <span title={below.map((l) => `${l.child_key} (${linkKindDef(l.kind).label.toLowerCase()}, linked ${l.source === 'auto' ? 'by itself' : 'by a person'})`).join('\n')}
      className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded border border-info/40 bg-info/5 px-1.5 py-0.5 text-[11px] text-foreground/80">
      <GitBranch className="h-3 w-3 shrink-0 text-info" aria-hidden />
      <span className="truncate">{view === 'linked' ? `${below.length + 1} linked cases: ${kindsText(below)}` : `Has ${kindsText(below)} linked`}</span>
    </span>
  );
}

export const CasesTable: React.FC<{ rows: Row[]; track: Track | 'all'; compact?: boolean; view?: CaseView; chains?: Map<string, ChainLink[]> }> = ({ rows, track, compact, view = 'linked', chains }) => {
  const lit = track === 'litigation' || track === 'all';
  const advice = useAdviceMap(rows);
  // A refund's year and period come from the refund itself (its RFD-01), not the case.
  const refunds = useRefundIndex(undefined, rows.some((r) => r.track === 'refund'));
  const years = useCaseDisputeYears(rows, view);
  return (
    <div className={WS_TABLE_WRAP}>
      <table className={WS_TABLE}>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>Client</th>
            <th scope="col" className={WS_TH}>Case</th>
            <th scope="col" className={WS_TH}>Dispute year</th>
            <th scope="col" className={WS_TH}>Status</th>
            {lit && <th scope="col" className={WS_TH}>Stage</th>}
            {track !== 'other' && <th scope="col" className={WS_TH}>Next due</th>}
            {lit && <th scope="col" className={cn(WS_TH, 'text-right')}>Exposure</th>}
            <th scope="col" className={WS_TH}>Latest correspondence</th>
            {!compact && track !== 'other' && <th scope="col" className={WS_TH}>Owner</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Apart, a case in a chain opens the chain showing that case alone.
            const inChain = !!r.parent_key || !!chains?.get(`${r.client_id}:${r.case_key}`)?.length;
            const href = caseHref(r.client_id as string, r.case_key as string)
              + (view === 'apart' && inChain ? `?part=${encodeURIComponent(r.case_key as string)}` : '');
            return (
              <tr key={`${r.client_id}:${r.case_key}`} className={cn(WS_TR, r.new_items ? 'bg-info/5' : '')}>
                <td className={cn(WS_TD, 'max-w-[14rem] border-l-[3px]', r.is_overdue ? 'border-l-destructive' : r.is_due_in_7 ? 'border-l-warning' : r.new_items ? 'border-l-info' : 'border-l-transparent')}>
                  <div className="truncate text-sm font-medium">{r.client_name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.client_gstin}</div>
                </td>
                <td className={cn(WS_TD, 'max-w-[22rem]')}>
                  <Link to={href} className="block truncate text-sm font-medium text-primary hover:underline">
                    {r.form_code ? `${r.form_code} · ` : ''}{r.title}
                  </Link>
                  {r.track === 'refund' && <RefundWhenChip r={refunds.get(refundIndexKey(r.client_id, r.case_id))} className="mt-0.5" />}
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.case_id ? <span className="font-mono">{r.case_id}</span> : r.case_key === 'REG' ? 'All registration correspondence' : <span className="font-mono">{r.reference_number}</span>}
                    {' · '}{plural(r.notices ?? 0, 'notice')}{r.documents ? `, ${plural(r.documents, 'document')}` : ''}
                  </div>
                  <ChainChip r={r} view={view} chains={chains} />
                  {track !== 'other' && <NextStepLine r={r} advice={adviceOf(advice.data, r.client_id as string, r.case_key as string)} className="mt-0.5 max-w-[22rem]" />}
                </td>
                <td className={WS_TD}><DisputeYearCell d={years.data?.get(caseYearKey(r.client_id as string, r.case_key as string))} loading={years.isLoading} /></td>
                <td className={WS_TD}><WaitingChip r={r} /></td>
                {lit && <td className={WS_TD}>{r.is_open ? <StageBadge stage={r.stage} /> : <span className="text-xs text-muted-foreground">—</span>}</td>}
                {track !== 'other' && (
                  <td className={WS_TD}>
                    <DueCell r={r} />
                    {lit && r.next_hearing && <div className="whitespace-nowrap text-[11px] text-muted-foreground">hearing {fmtDate(r.next_hearing)}</div>}
                  </td>
                )}
                {lit && <td className={WS_TD_NUM}>{Number(r.exposure) > 0 ? fmtInrShort(r.exposure) : '—'}</td>}
                <td className={cn(WS_TD, 'max-w-[16rem]')}><Latest r={r} /></td>
                {!compact && track !== 'other' && <td className={WS_TD}>{r.is_open ? <OwnerChip name={r.assign_to} showName /> : null}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default CasesTable;
