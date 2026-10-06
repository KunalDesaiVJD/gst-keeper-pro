// The Notice summary's refund and DRC-03 lines (the old summary's "Refund" and
// "DRC 03" rows; audit U-70-2, U-76-1): counted with the ledgers' own status
// map, each number opening /refunds-all or /drc03-all with the same filter, so
// the ledger shows the same count.
import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { AmountLink, CountLink } from './ReportBits';
import { DRC03_GROUPS, REFUND_GROUPS } from './ledgerStatus';
import { useDrc03Ledger, useRefundLedger } from './ledgerData';

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0 rounded-md border px-2.5 py-1.5">
    <dt className="truncate text-xs text-muted-foreground">{label}</dt>
    <dd className="text-base font-semibold leading-tight">{children}</dd>
  </div>
);

export const LedgerSummary: React.FC<{ filtered: boolean }> = ({ filtered }) => {
  const refunds = useRefundLedger();
  const drc03 = useDrc03Ledger();
  const rf = refunds.data ?? [];
  const dr = drc03.data ?? [];
  const openClaims = rf.filter((r) => r.state.open).reduce((s, r) => s + (Number(r.fact.claimed_amount) || 0), 0);
  const paid = dr.reduce((s, r) => s + (r.total ?? 0), 0);
  const unlinked = dr.filter((r) => r.fact.origin === 'filing' && !r.against.notices.length && !r.against.matters.length).length;
  const err = refunds.error ?? drc03.error;

  return (
    <SectionCard title="Refunds and DRC-03 payments"
      description={filtered ? 'Every client · the filters above apply to notices only' : 'Every client · each number opens the ledger it counts'}>
      {err ? (
        <Note tone="warn">Couldn't load the refund or DRC-03 ledger: {err instanceof Error ? err.message : String(err)}</Note>
      ) : !refunds.data || !drc03.data ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section aria-labelledby="ledger-refunds" className="min-w-0">
            <h3 id="ledger-refunds" className="mb-1.5 text-sm font-semibold">
              <Link to="/refunds-all" className="underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Refund applications</Link>
              <span className="font-normal text-muted-foreground"> · {rf.length.toLocaleString('en-IN')}</span>
            </h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {REFUND_GROUPS.filter((g) => g.key !== 'unknown' || rf.some((r) => r.state.group === 'unknown')).map((g) => (
                <Stat key={g.key} label={g.label}>
                  <CountLink n={rf.filter((r) => r.state.group === g.key).length} to={`/refunds-all?status=${g.key}`} label={`Refunds, ${g.label.toLowerCase()}`} alarm={g.key === 'action'} />
                </Stat>
              ))}
              <Stat label="Claimed, still open">
                <AmountLink amount={openClaims} to="/refunds-all?status=open" label="Refunds still open, amount claimed" />
              </Stat>
            </dl>
          </section>
          <section aria-labelledby="ledger-drc03" className="min-w-0">
            <h3 id="ledger-drc03" className="mb-1.5 text-sm font-semibold">
              <Link to="/drc03-all" className="underline decoration-primary/30 underline-offset-2 hover:decoration-primary">DRC-03 payments</Link>
              <span className="font-normal text-muted-foreground"> · {dr.length.toLocaleString('en-IN')}</span>
            </h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DRC03_GROUPS.filter((g) => g.key !== 'nodetails' || dr.some((r) => r.state.group === 'nodetails')).map((g) => (
                <Stat key={g.key} label={g.label}>
                  <CountLink n={dr.filter((r) => r.state.group === g.key).length} to={`/drc03-all?status=${g.key}`} label={`DRC-03, ${g.label.toLowerCase()}`} />
                </Stat>
              ))}
              <Stat label="Not linked to a notice">
                <CountLink n={unlinked} to="/drc03-all?against=none" label="DRC-03 not linked to a notice or matter" />
              </Stat>
              <Stat label="Paid in all">
                <AmountLink amount={paid} to="/drc03-all" label="DRC-03 paid in all" />
              </Stat>
            </dl>
          </section>
        </div>
      )}
    </SectionCard>
  );
};

export default LedgerSummary;
