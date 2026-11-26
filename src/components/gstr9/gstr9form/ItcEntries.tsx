import React from 'react';
import type { TaxIn } from '@/lib/gstr9/types';
import { zIn } from '@/lib/gstr9/defaults';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import type { FixedRowDef } from './hooks';
import { EntryHeading, ResetButton, TaxEntryGrid } from './shared';

// The GSTR-9 cells of Tables 6 and 8 that are typed, not computed: since
// 26 Nov 2026 they are typed on ITC reco (Table 6 entries under the working,
// Table 8 entries beside Tables 12 and 13), and GSTR-9 Tables 6 and 8 only
// show them (position B: every ITC input on one step). The grids' labels are
// the figure-link anchors (gstr9form/sourceTargets.ts itcEntry6 / itcEntry8).

export const T6_ENTRIES_LABEL = 'GSTR-9 Table 6 typed rows';
export const T8_ENTRIES_LABEL = 'GSTR-9 Table 8 typed rows';

/** 6G (override of the portal's ISD credit), 6K, 6L, 6M. */
export const Table6Entries: React.FC = () => {
  const { docs, update, canEditSource } = useWorkspace();
  const defs: FixedRowDef<TaxIn | null>[] = [
    {
      id: '6G',
      code: '6G',
      label: 'ITC received from ISD',
      title: canEditSource ? 'Leave blank to use the portal 6G; type to override it' : 'The portal 6G — locked; only a superadmin can type over it',
      read: (d) => d.t6G,
      write: (d, v) => ({ ...d, t6G: v }),
      computed: docs.portal.gstr9.t6G,
      locked: !canEditSource,
    },
    { id: '6K', code: '6K', label: 'TRAN-1 credit', title: 'Transition Credit through TRAN-1 (including revisions if any)', read: (d) => d.t6K, write: (d, v) => ({ ...d, t6K: v ?? zIn() }) },
    { id: '6L', code: '6L', label: 'TRAN-2 credit', title: 'Transition Credit through TRAN-2', read: (d) => d.t6L, write: (d, v) => ({ ...d, t6L: v ?? zIn() }) },
    { id: '6M', code: '6M', label: 'ITC-01 / ITC-02 / ITC-02A', title: 'ITC availed through ITC-01, ITC-02 and ITC-02A', read: (d) => d.t6M, write: (d, v) => ({ ...d, t6M: v ?? zIn() }) },
  ];

  return (
    <SectionCard
      title="Table 6 entries — 6G, 6K, 6L, 6M"
      description="The only typed rows of GSTR-9 Table 6: 6G overrides the portal's ISD credit (superadmin), 6K to 6M are the TRAN and ITC-01/02/02A credits."
      excelRef="GSTR-9 rows 52, 60–62"
    >
      <EntryHeading
        actions={
          <ResetButton show={docs.gstr9.t6G != null} onClick={() => update('gstr9', (d) => ({ ...d, t6G: null }))}>
            Use portal 6G
          </ResetButton>
        }
      >
        Typed rows
      </EntryHeading>
      <TaxEntryGrid defs={defs} label={T6_ENTRIES_LABEL} />
    </SectionCard>
  );
};

/** 8C (when not Table 13), 8E, 8F, 8G, 8H1. */
export const Table8Entries: React.FC = () => {
  const { workings } = useWorkspace();
  const g = workings.g9;
  const defs: FixedRowDef<TaxIn | null>[] = [
    {
      id: '8C',
      code: '8C',
      label: 'Availed next FY (excl. imports, RCM)',
      title: 'ITC of this year availed in the next year, other than imports and reverse charge (SEZ services included). Leave blank to take Table 13.',
      read: (d) => d.t8C ?? null,
      write: (d, v) => ({ ...d, t8C: v }),
      computed: g.t8CDefault,
    },
    { id: '8E', code: '8E', label: 'Available, not availed', title: 'ITC available but not availed', read: (d) => d.t8E, write: (d, v) => ({ ...d, t8E: v ?? zIn() }) },
    { id: '8F', code: '8F', label: 'Available but ineligible', title: 'ITC available but ineligible', read: (d) => d.t8F, write: (d, v) => ({ ...d, t8F: v ?? zIn() }) },
    {
      id: '8G',
      code: '8G',
      label: 'IGST paid on imports (bills of entry)',
      title: 'IGST and cess paid on import of goods (incl. from SEZ) as per the bills of entry / ICEGATE. Leave blank to take 8H + 8H1.',
      read: (d) => d.t8G,
      write: (d, v) => ({ ...d, t8G: v }),
      computed: g.t8GDefault,
      heads: ['i', 'x'],
    },
    {
      id: '8H1',
      code: '8H1',
      label: 'Import IGST availed next FY',
      title: 'IGST credit availed on import of goods in next financial year (Integrated tax and Cess only)',
      read: (d) => d.t8H1,
      write: (d, v) => ({ ...d, t8H1: v ?? zIn() }),
      heads: ['i', 'x'],
    },
  ];

  return (
    <SectionCard
      title="Table 8 entries — 8C, 8E, 8F, 8G, 8H1"
      description="8C follows Table 13 unless typed (type it to leave out imports and RCM); 8E + 8F explain the 8D difference; 8G is the IGST on imports per the bills of entry."
      excelRef="GSTR-9 rows 82–90"
    >
      <TaxEntryGrid defs={defs} label={T8_ENTRIES_LABEL} />
    </SectionCard>
  );
};
