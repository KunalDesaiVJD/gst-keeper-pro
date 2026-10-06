// Where an annexure row came from (audit R-23: every figure carries its
// source): one chip per source — "GSTR-3B · Apr 2023" — that opens the table,
// period, ARN and when the extension pulled it.
import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SourceRef } from '@/lib/reply';
import { periodLabel } from '@/lib/reply';
import { fmtDateTime } from '@/lib/noticeFormat';

const TABLE_WORDS: Record<string, string> = {
  gst_filed_returns: 'Returns pulled from the portal',
  gst_credit_reversal_reclaim_entries: 'Credit reversal and re-claimed statement',
  gst_rcm_liability_itc_entries: 'RCM liability / ITC statement',
  gst_drc03_filings: 'DRC-03 payments (portal)',
  filing_status: 'Filing Status (the firm’s tracker)',
  client_annual_turnover: 'Annual turnover (typed in the app)',
  annual_return_docs: 'Annual Return working',
};

const periodWords = (p: string | null | undefined) => (p && /^\d{2}\/\d{4}$/.test(p) ? periodLabel(p) : p ?? '');

export const SourceChips: React.FC<{ sources: SourceRef[]; total?: boolean }> = ({ sources, total }) => {
  if (!sources.length) return <span className="text-xs text-foreground/70">{total ? 'Sum of the rows' : '—'}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {sources.map((s, i) => (
        <Popover key={`${s.row_id ?? s.label}-${i}`}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="whitespace-nowrap rounded border border-info/40 bg-info/10 px-1.5 py-0.5 text-[11px] leading-tight text-foreground hover:bg-info/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.label ?? s.table}{s.period ? ` · ${periodWords(s.period)}` : ''}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-1 p-3 text-xs" align="start">
            <p className="font-semibold">{s.label ?? s.table}</p>
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5">
              <dt className="text-muted-foreground">From</dt><dd className="break-words">{TABLE_WORDS[s.table] ?? s.table}</dd>
              {s.period && <><dt className="text-muted-foreground">Period</dt><dd>{periodWords(s.period)}</dd></>}
              {s.arn && <><dt className="text-muted-foreground">ARN</dt><dd className="break-all font-mono">{s.arn}</dd></>}
              <dt className="text-muted-foreground">Pulled</dt><dd>{s.pulled_at ? fmtDateTime(s.pulled_at) : 'not recorded'}</dd>
            </dl>
          </PopoverContent>
        </Popover>
      ))}
    </span>
  );
};

export default SourceChips;
