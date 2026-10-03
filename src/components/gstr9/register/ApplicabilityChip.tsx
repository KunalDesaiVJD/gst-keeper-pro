import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/gstr9/badge';
import { croreText } from '@/lib/gstr9/applicability';
import { useWorkspace } from '../WorkspaceContext';
import { useApplicability } from './useApplicability';

const crore = (n: number) => `₹${(n / 1_00_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} crore`;

/**
 * Whether this client files GSTR-9 / 9C for the year, from the register on
 * the Annual Return home (aggregate turnover and the client's wish). Opens the
 * register.
 */
export const ApplicabilityChip: React.FC = () => {
  const { client, financialYear, isStaff } = useWorkspace();
  const { entry, result } = useApplicability(client, financialYear);
  const [, setParams] = useSearchParams();
  if (!result) return null;

  const t = entry?.aggregate_turnover ?? null;
  const th = result.thresholds;
  let text: string;
  let tone: 'secondary' | 'warning' | 'info' | 'default';
  if (result.gstr9 === 'not_applicable') { text = '9/9C not applicable'; tone = 'secondary'; }
  else if (result.gstr9 === 'unknown') { text = 'Turnover not entered'; tone = 'warning'; }
  else if (!result.file9) { text = 'Exempt — not filing'; tone = 'warning'; }
  else {
    const g9 = result.gstr9 === 'required' ? 'GSTR-9' : 'GSTR-9 (client’s wish)';
    const g9c = result.gstr9c === 'required' ? ' + 9C' : result.file9c ? ' + 9C (client’s wish)' : ' · no 9C';
    text = g9 + g9c;
    tone = result.gstr9 === 'required' ? 'default' : 'info';
  }
  const title = [
    result.notApplicable,
    t !== null ? `Aggregate turnover FY ${financialYear}: ${crore(t)}.` : `No aggregate turnover typed for FY ${financialYear}.`,
    `GSTR-9 above ${croreText(th.gstr9)}, GSTR-9C above ${croreText(th.gstr9c)}; below, only if the client wishes.`,
    isStaff ? 'Change it on All clients.' : '',
  ].filter(Boolean).join(' ');

  const badge = <Badge variant={tone} className="whitespace-nowrap text-[10px] font-medium">{text}</Badge>;
  if (!isStaff) return <span title={title}>{badge}</span>;
  return (
    <button
      type="button"
      title={title}
      onClick={() => setParams(new URLSearchParams({ fy: financialYear }))}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${text} — open All clients`}
    >
      {badge}
    </button>
  );
};

export default ApplicabilityChip;
