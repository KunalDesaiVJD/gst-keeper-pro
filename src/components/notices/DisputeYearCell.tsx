// The dispute year in a list cell: the year(s) in bold, and under a derived
// year where it was read from; "Not stated" when nothing we hold names one.
import React from 'react';
import { DISPUTE_BASIS_NOTE, fmtDisputeYears, type DisputeYear } from '@/lib/noticeDisputeYears';

export const DisputeYearCell: React.FC<{ d: DisputeYear | undefined; loading?: boolean }> = ({ d, loading }) => {
  if (!d) return <span className="text-xs text-muted-foreground">{loading ? '…' : '—'}</span>;
  if (!d.applies) return <span className="text-xs text-muted-foreground" title="Registration is not about a year">—</span>;
  if (!d.years.length) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground" title="No FY or period on the notice, its papers, its case or a linked case">Not stated</span>;
  }
  const note = d.basis ? DISPUTE_BASIS_NOTE[d.basis] : '';
  return (
    <div className="min-w-0">
      <div className="whitespace-nowrap text-sm font-semibold tabular-nums">FY {fmtDisputeYears(d.years)}</div>
      {note && <div className="whitespace-nowrap text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
};

export default DisputeYearCell;
