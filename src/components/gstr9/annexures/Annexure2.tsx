import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { useWorkspace } from '../WorkspaceContext';
import { MatrixTable, Note, SectionCard, SourceChip, type MatrixRow } from '../ui';
import { StepLink } from './StepLink';

const Muted: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="text-[11px] text-muted-foreground">{children}</span>;

const Annexure2: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const w = workings.ann2;
  const src = workings.g9.t6ASource;

  const sixA =
    src === 'gstr9' ? (
      <SourceChip meta={docs.portal.gstr9Meta} />
    ) : src === 'monthly_3b' ? (
      <Badge variant="info" className="text-[10px] font-normal">Σ 4A of as-filed 3B</Badge>
    ) : (
      <SourceChip meta={null} />
    );

  const rows: MatrixRow[] = [
    { key: 'A', code: 'A', label: 'Dr. balance of ITC ledger', value: w.A, note: <Muted>Duties &amp; Taxes · purchases</Muted> },
    { key: 'A1', code: 'A1', label: 'RCM — ITC', value: w.A1, note: <Muted>RCM · Part B</Muted> },
    { key: 'A2', code: 'A2', label: 'Debit notes', value: w.A2 },
    { key: 'B', code: 'B', label: 'Other adjustment in Dr./Cr. side (suspended ITC, net)', value: w.B },
    { key: 'C', code: 'C', label: 'Net ITC availed (A + A1 − A2 − B)', value: w.C, total: true },
    {
      key: 'D', code: 'D', label: 'ITC of this year claimed in next year (7J − books) — effect in Tables 12 & 13', value: w.D, signed: true,
      note: <StepLink step="itc" className="text-[11px]">ITC reco</StepLink>,
    },
    { key: 'E', code: 'E', label: 'Total (C + D)', value: w.E, total: true },
    { key: 'F', code: 'F', label: 'As per portal — Table 6A (includes previous-year ITC claimed this year)', value: w.F, note: sixA },
    { key: 'G1', code: 'G1', label: 'Reversal as per 7H1', value: w.G1 },
    { key: 'G2', code: 'G2', label: 'Other Table 7 reversals (7A–7G and further 7H lines)', value: w.G2, note: <Muted>firm position</Muted> },
    { key: 'H', code: 'H', label: 'ITC of previous year claimed this year (Last Year Effect)', value: w.H },
    { key: 'I', code: 'I', label: 'Net ITC (F − G1 − G2 − H)', value: w.I, total: true },
    { key: 'J', code: 'J', label: 'Excess ITC claimed / to be claimed (E − I)', value: w.J, total: true, signed: true, diffKey: 'ann2.J' },
  ];

  return (
    <SectionCard
      title="Annexure-2 — ITC reconciliation"
      description="ITC as per the books' ledgers against ITC availed on the portal (6A), net of reversals and previous-year ITC."
      excelRef="ANNEXURE B23:F37"
    >
      {workings.ctx.noItcBuilder && (
        <Note tone="info">Builder on the NO_ITC scheme — zero ITC is expected, so J is shown for information only.</Note>
      )}
      {src === 'none' && (
        <Note tone="warn">
          6A is not fetched (neither the GSTR-9 system-computed figures nor the as-filed GSTR-3B), so F is 0.{' '}
          <StepLink step="portal">Portal data</StepLink>
        </Note>
      )}
      <MatrixTable rows={rows} heads={['i', 'c', 's', 'x']} label="Annexure-2 ITC reconciliation" />
      <p className="text-[11px] text-muted-foreground">
        J above 0: ITC in the books not yet claimed on the portal. J below 0: claimed on the portal in excess of the books.
      </p>
      <Note tone="position">
        G deducts all of Table 7 — G1 is 7H1, G2 the rest. The sheet deducted 7H1 only, so its J always showed −(7A…7G) and was
        overridden by hand; now J is 0 when Last Year Effect = 6A1 (§6 item 5). D uses the books ITC net of Last Year Effect
        (D&amp;T-INPUT U26), not U24 (§6 item 3).
      </Note>
    </SectionCard>
  );
};

export default Annexure2;
