import React from 'react';
import type { Workings } from '@/lib/gstr9/engine';
import type { T4Key, T5Key } from '@/lib/gstr9/types';
import { SheetGrid } from '../grid/SheetGrid';
import { diffTone, displayCol, moneyCol } from '../grid/columns';
import { MatrixRow, MatrixTable, Money, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { FORM_HEAD_LABELS, FORM_HEADS, isManualPath, particularsCol, toneClass } from './helpers';
import { FixedRow, FixedRowDef, useFixedRows } from './hooks';
import { EntryHeading, FormTable, FormTableCol, FormTableRow, RowSrc, Src, StepLink } from './shared';

// ---------------------------------------------------------------------------
// Table 4 — outward supplies on which tax is payable (portal system-computed)
// ---------------------------------------------------------------------------

type T4Row = { code: string; label: string; k: keyof Workings['g9']['t4']; portal?: T4Key; diffKey?: string; total?: boolean };

const T4_ROWS: T4Row[] = [
  { code: '4A', k: 'A', portal: 'b2c', diffKey: 'out.b2c', label: 'Supplies made to un-registered persons (B2C)' },
  { code: '4B', k: 'B', portal: 'b2b', diffKey: 'out.b2b', label: 'Supplies made to registered persons (B2B)' },
  { code: '4C', k: 'C', portal: 'exp', diffKey: 'out.exp', label: 'Zero rated supply (Export) on payment of tax (except supplies to SEZs)' },
  { code: '4D', k: 'D', portal: 'sez', diffKey: 'out.sez', label: 'Supply to SEZs on payment of tax' },
  { code: '4E', k: 'E', portal: 'deemed', diffKey: 'out.deemed', label: 'Deemed Exports' },
  { code: '4F', k: 'F', portal: 'at', diffKey: 'out.at', label: 'Advances on which tax has been paid but invoice has not been issued (not covered under (A) to (E) above)' },
  { code: '4G', k: 'G', label: 'Inward supplies on which tax is to be paid on reverse charge basis' },
  { code: '4G1', k: 'G1', portal: 'ecom', diffKey: 'out.ecom', label: 'Supplies on which e-commerce operator is required to pay tax as per section 9(5) (including amendments, if any) [E-commerce operator to report]' },
  { code: '4H', k: 'H', total: true, label: 'Sub-total (A to G1 above)' },
  { code: '4I', k: 'I', portal: 'cr_nt', diffKey: 'out.cr_nt', label: 'Credit Notes issued in respect of transactions specified in (B) to (E) above (−)' },
  { code: '4J', k: 'J', portal: 'dr_nt', diffKey: 'out.dr_nt', label: 'Debit Notes issued in respect of transactions specified in (B) to (E) above (+)' },
  { code: '4K', k: 'K', portal: 'amd_pos', diffKey: 'out.amd', label: 'Supplies / tax declared through Amendments (+)' },
  { code: '4L', k: 'L', portal: 'amd_neg', label: 'Supplies / tax reduced through Amendments (−)' },
  { code: '4M', k: 'M', total: true, label: 'Sub-total (I to L above)' },
  { code: '4N', k: 'N', total: true, label: 'Supplies and advances on which tax is to be paid (H + M) above' },
];

const Table4: React.FC = () => {
  const { workings, docs } = useWorkspace();
  const g = workings.g9;
  const meta = docs.portal.gstr9Meta;
  const manual = docs.portal.manual;
  const rcmSource = workings.rcm.partASource;

  const rows: MatrixRow[] = T4_ROWS.map((r) => {
    let note: React.ReactNode;
    if (r.total) note = <Src kind="computed" />;
    else if (r.k === 'G') {
      note = (
        <RowSrc
          step="rcm"
          src={
            rcmSource === 'monthly' ? (
              <Src kind="as_filed_3b" title="Σ 3.1(d) of the as-filed GSTR-3B (RCM Part A)" />
            ) : rcmSource === 'gstr9' ? (
              <Src kind="portal" meta={meta} manual={isManualPath(manual, 'gstr9.table4.rchrg')} />
            ) : (
              <Src kind="none" />
            )
          }
        />
      );
    } else note = <Src kind="portal" meta={meta} manual={isManualPath(manual, `gstr9.table4.${r.portal}`)} />;
    return {
      key: r.code,
      code: r.code,
      label: r.label,
      value: g.t4[r.k],
      total: r.total,
      note,
      diffKey: r.diffKey ?? (r.k === 'G' && rcmSource === 'gstr9' ? 'rcm.annual' : undefined),
    };
  });

  return (
    <SectionCard
      title="4 · Details of advances, inward and outward supplies made during the financial year on which tax is payable"
      description="As computed by the portal (GSTR-9 system-computed); 4G is the RCM paid as per the as-filed GSTR-3B. Status is the books-vs-portal check from Outward reco."
      excelRef="GSTR-9 rows 6–21"
      actions={
        <>
          <StepLink step="portal">Portal data</StepLink>
          <StepLink step="outward">Outward reco</StepLink>
        </>
      }
    >
      <MatrixTable rows={rows} heads={FORM_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 4" />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 5 — outward supplies on which tax is not payable (books, Sales step)
// ---------------------------------------------------------------------------

type T5Code = keyof Workings['g9']['t5'];
type T5View = FormTableRow & {
  k: T5Code;
  /** Leaf row: its portal Table 5 key. */
  portal?: T5Key;
  /** Sub-total row: its portal total (workings.g9.t5PortalTotals). */
  portalTotal?: 'G' | 'L' | 'M';
  kind: 'books' | 'typed' | 'computed';
  withTax?: boolean;
};

const T5_ROWS: T5View[] = [
  { key: '5A', code: '5A', k: 'A', portal: 'zero_rtd', diffKey: 'g9.t5.5A', kind: 'books', label: 'Zero rated supply (Export) without payment of tax' },
  { key: '5B', code: '5B', k: 'B', portal: 'sez', diffKey: 'g9.t5.5B', kind: 'books', label: 'Supply to SEZs without payment of tax' },
  { key: '5C', code: '5C', k: 'C', portal: 'rchrg', diffKey: 'g9.t5.5C', kind: 'books', label: 'Supplies on which tax is to be paid by recipient on reverse charge basis' },
  { key: '5C1', code: '5C1', k: 'C1', portal: 'ecom_14', kind: 'books', label: 'Supplies on which tax is to be paid by e-commerce operators as per section 9(5) [Supplier to report]' },
  { key: '5D', code: '5D', k: 'D', portal: 'exmt', diffKey: 'g9.t5.5D', kind: 'books', label: 'Exempted' },
  { key: '5E', code: '5E', k: 'E', portal: 'nil', diffKey: 'g9.t5.5E', kind: 'books', label: 'Nil Rated' },
  { key: '5F', code: '5F', k: 'F', portal: 'non_gst', diffKey: 'g9.t5.5F', kind: 'books', label: "Non-GST supply (includes 'no supply')" },
  { key: '5G', code: '5G', k: 'G', portalTotal: 'G', kind: 'computed', total: true, label: 'Sub-total (A to F above)' },
  { key: '5H', code: '5H', k: 'H', portal: 'cr_nt', diffKey: 'g9.t5.5H', kind: 'books', label: 'Credit Notes issued in respect of transactions specified in A to F above (−)' },
  { key: '5I', code: '5I', k: 'I', portal: 'dr_nt', kind: 'typed', label: 'Debit Notes issued in respect of transactions specified in A to F above (+)' },
  { key: '5J', code: '5J', k: 'J', portal: 'amd_pos', kind: 'typed', label: 'Supplies declared through Amendments (+)' },
  { key: '5K', code: '5K', k: 'K', portal: 'amd_neg', kind: 'typed', label: 'Supplies reduced through Amendments (−)' },
  { key: '5L', code: '5L', k: 'L', portalTotal: 'L', kind: 'computed', total: true, label: 'Sub-Total (H to K above)' },
  { key: '5M', code: '5M', k: 'M', portalTotal: 'M', kind: 'computed', total: true, withTax: true, label: 'Turnover on which tax is not to be paid (G + L) above' },
  { key: '5N', code: '5N', k: 'N', kind: 'computed', total: true, withTax: true, label: 'Total Turnover (including advances) (4N + 5M − 4G − 4G1) above' },
];

type T5ExtraKey = 'dr_nt' | 'amd_pos' | 'amd_neg';
const T5_EXTRA: Array<{ key: T5ExtraKey; code: string; label: string }> = [
  { key: 'dr_nt', code: '5I', label: 'Debit notes (+)' },
  { key: 'amd_pos', code: '5J', label: 'Amendments (+)' },
  { key: 'amd_neg', code: '5K', label: 'Amendments (−)' },
];
const T5_EXTRA_DEFS: FixedRowDef<number>[] = T5_EXTRA.map((e) => ({
  id: e.key,
  code: e.code,
  label: e.label,
  read: (g) => g.t5Extra[e.key],
  write: (g, v) => ({ ...g, t5Extra: { ...g.t5Extra, [e.key]: v ?? 0 } }),
  fKey: () => `t5Extra.${e.key}`,
}));

const Table5: React.FC = () => {
  const { workings } = useWorkspace();
  const g = workings.g9;
  const tol = workings.tolerance;
  const portalFetched = g.t4Source === 'portal';
  const extra = useFixedRows<number>(T5_EXTRA_DEFS, { cols: ['t'] });

  const rows: T5View[] = T5_ROWS.map((r) => ({
    ...r,
    note:
      r.kind === 'books' ? (
        <RowSrc step="sales" src={<Src kind="books" title="Sales step — PL-OUTPUT Part B, by nature (negative rows are credit notes → 5H)" />} />
      ) : r.kind === 'typed' ? (
        <Src kind="typed" title="Typed below (books side, rare)" />
      ) : (
        <Src kind="computed" />
      ),
  }));

  const portalOf = (r: T5View): number | null => {
    if (!portalFetched) return null;
    if (r.portal) return g.t5Portal[r.portal] ?? 0;
    if (r.portalTotal) return g.t5PortalTotals[r.portalTotal];
    return null;
  };
  const diffOf = (r: T5View): number | null => {
    const p = portalOf(r);
    return p === null ? null : g.t5[r.k].t - p;
  };

  const cols: FormTableCol<T5View>[] = [
    { key: 't', header: FORM_HEAD_LABELS.t, group: 'Form GSTR-9', cell: (r) => <Money value={g.t5[r.k].t} /> },
    ...(['c', 's', 'i', 'x'] as const).map<FormTableCol<T5View>>((h) => ({
      key: h,
      header: FORM_HEAD_LABELS[h],
      group: 'Form GSTR-9',
      na: (r) => !r.withTax,
      cell: (r) => <Money value={g.t5[r.k][h]} />,
    })),
    {
      key: 'portal',
      header: 'Portal Table 5',
      group: 'Comparison',
      na: (r) => !r.portal && !r.portalTotal,
      cell: (r) => {
        const p = portalOf(r);
        return p === null ? <span className="text-muted-foreground">—</span> : <Money value={p} />;
      },
    },
    {
      key: 'diff',
      header: 'Books − Portal',
      group: 'Comparison',
      na: (r) => !r.portal && !r.portalTotal,
      cell: (r) => {
        const d = diffOf(r);
        if (d === null) return <span className="text-muted-foreground">—</span>;
        return <Money value={d} className={toneClass(diffTone(d, tol))} />;
      },
    },
  ];

  const extraCols = [
    particularsCol<FixedRow<number>>('Typed here', 220),
    moneyCol<FixedRow<number>>('t', FORM_HEAD_LABELS.t, (r) => r.v, (r, v) => ({ ...r, v: v ?? 0 })),
    displayCol<FixedRow<number>>('portal', 'Portal Table 5', (r) => (portalFetched ? g.t5Portal[r.id] ?? 0 : null)),
  ];

  return (
    <SectionCard
      title="5 · Details of outward supplies made during the financial year on which tax is not payable"
      description="Books figures from the Sales step (PL-OUTPUT Part B), with the portal's Table 5 alongside for comparison."
      excelRef="GSTR-9 rows 23–38"
      actions={
        <>
          <StepLink step="sales">Sales</StepLink>
          <StepLink step="portal">Portal data</StepLink>
        </>
      }
    >
      <FormTable rows={rows} cols={cols} label="GSTR-9 Table 5" />
      {!portalFetched && (
        <p className="text-xs text-muted-foreground">
          Portal Table 5 isn&apos;t fetched yet — the comparison fills in once the GSTR-9 system-computed figures are pulled on <StepLink step="portal">Portal data</StepLink>.
        </p>
      )}
      <Note tone="position">
        5N is computed as 4N + 5M − 4G − 4G1 (the firm&apos;s sheet types it), so it always ties to Tables 4 and 5.
      </Note>
      <EntryHeading>5I–5K · books-side debit notes and amendments (rare)</EntryHeading>
      <SheetGrid<FixedRow<number>>
        rows={extra.rows}
        columns={extraCols}
        getRowId={(r) => r.id}
        onRowsChange={extra.onRowsChange}
        readOnly={extra.readOnly}
        label="GSTR-9 Table 5I to 5K"
      />
    </SectionCard>
  );
};

const PartII: React.FC = () => (
  <div className="space-y-4">
    <Table4 />
    <Table5 />
  </div>
);

export default PartII;
