import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import type { RcmItcTable } from '@/lib/gstr9/types';
import { MatrixTable, SectionCard, type MatrixRow } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { categoryName, ITC_TABLE_LABEL } from './rcmShared';

const Src: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">{children}</Badge>
);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="whitespace-nowrap">{children}</span>;

/** Where the RCM figures of this step land in the returns and annexures (read-only). */
const RcmFlowsCard: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const W = workings.rcm;
  const cats = docs.rcm.categories;
  const namesIn = (t: RcmItcTable) => cats.filter((c) => (c.itcTable || '6C') === t).map(categoryName).join(', ');

  const tables: RcmItcTable[] = ['6C', '6D', '6F'];
  const itcRows: MatrixRow[] = tables
    // 6C always shows (the default); 6D / 6F only when an expense is set to them.
    .filter((t) => t === '6C' || cats.some((c) => c.itcTable === t))
    .map((t) => ({
      key: t,
      code: t,
      label: `GSTR-9 — ${ITC_TABLE_LABEL[t]}`,
      value: W.byItcTable[t],
      note: namesIn(t) ? <Src>{namesIn(t)}</Src> : <Src>Part B · books</Src>,
    }));

  const rows: MatrixRow[] = [
    {
      key: '4G',
      code: '4G',
      label: 'GSTR-9 — inward supplies on which tax is paid on reverse charge',
      value: workings.g9.t4.G,
      note: <Src>{W.partASource === 'gstr9' ? 'Part A · GSTR-9 4G' : 'Part A · portal'}</Src>,
    },
    ...itcRows,
    { key: 'ann1D', code: <Code>Ann-1 D</Code>, label: 'Annexure-1 — tax paid on RCM as per books', value: workings.ann1.D, note: <Src>Part B · books</Src> },
    { key: 'c14P', code: <Code>9C P</Code>, label: 'GSTR-9C expense heads — any other expense 1 (RCM)', value: workings.c14.rows.P, note: <Src>Part B · books</Src> },
    {
      key: 'ann3',
      code: <Code>Ann-3 2</Code>,
      label: 'Annexure-3 — RCM to be paid (DRC-03)',
      value: workings.ann3.rcmToPay,
      note: <Src>{docs.annexures.a3RcmToPay === null || docs.annexures.a3RcmToPay === undefined ? 'Suggested: books above portal' : 'Typed in Annexures'}</Src>,
    },
  ];

  return (
    <SectionCard
      title="Where RCM flows"
      description="Read-only — these follow from Part A and Part B above. Change the figures here, not in the forms."
      excelRef="GSTR-9 F13 · GSTR-9 row 49 · ANNEXURE D12 / D43 · GSTR 9C D25"
    >
      <MatrixTable label="Where the RCM figures are reported" rows={rows} heads={['t', 'i', 'c', 's', 'x']} headLabels={{ t: 'Value' }} />
    </SectionCard>
  );
};

export default RcmFlowsCard;
