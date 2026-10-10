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
import { caseHref, type CaseRow, type Track } from '@/lib/noticeCases';
import { fmtDate, fmtFy, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

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

export const CasesTable: React.FC<{ rows: CaseRow[]; track: Track | 'all'; compact?: boolean }> = ({ rows, track, compact }) => {
  const lit = track === 'litigation' || track === 'all';
  return (
    <div className={WS_TABLE_WRAP}>
      <table className={WS_TABLE}>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>Client</th>
            <th scope="col" className={WS_TH}>Case</th>
            {lit && <th scope="col" className={WS_TH}>Stage</th>}
            {track !== 'other' && <th scope="col" className={WS_TH}>Next due</th>}
            {lit && <th scope="col" className={cn(WS_TH, 'text-right')}>Exposure</th>}
            <th scope="col" className={WS_TH}>Latest correspondence</th>
            {!compact && track !== 'other' && <th scope="col" className={WS_TH}>Owner</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = caseHref(r.client_id as string, r.case_key as string);
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
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.case_id ? <span className="font-mono">{r.case_id}</span> : r.case_key === 'REG' ? 'All registration correspondence' : <span className="font-mono">{r.reference_number}</span>}
                    {lit && r.financial_years ? ` · FY ${r.financial_years.split(', ').map(fmtFy).join(', ')}` : ''}
                    {' · '}{plural(r.notices ?? 0, 'notice')}{r.documents ? `, ${plural(r.documents, 'document')}` : ''}
                  </div>
                </td>
                {lit && <td className={WS_TD}>{r.is_open ? <StageBadge stage={r.stage} /> : <span className="text-xs text-muted-foreground">closed</span>}</td>}
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
