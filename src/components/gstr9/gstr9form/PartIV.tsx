import React from 'react';
import { taxOf } from '@/lib/gstr9/engine';
import { Formulas, TABLE9_HEADS, Table9Head, Tax } from '@/lib/gstr9/types';
import { GridColumn, SheetGrid } from '../grid/SheetGrid';
import { diffTone, displayCol, moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { JustifyControl, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { docFormulas, isManualPath, setDocFormulas } from './helpers';
import { ResetButton, Src, StepLink } from './shared';

type OtherKey = 'interest' | 'lateFee' | 'penalty' | 'other';

interface T9Row {
  id: string;
  code: string;
  label: string;
  head?: Table9Head;
  other?: OtherKey;
  /** docs.gstr9.t9Payable[head] — null = portal / 4N. */
  override: number | null;
  /** "=a+b" memory of the payable cell (kept in docs.gstr9.f). */
  f?: Formulas;
}

const PAYABLE_COLS = ['payable'];
const payableFKey = (head: Table9Head) => () => `t9Payable.${head}`;

const HEAD_ROWS: Array<{ head: Table9Head; code: string; label: string; tax: keyof Tax }> = [
  { head: 'igst', code: '9A', label: 'Integrated Tax', tax: 'i' },
  { head: 'cgst', code: '9B', label: 'Central Tax', tax: 'c' },
  { head: 'sgst', code: '9C', label: 'State/UT Tax', tax: 's' },
  { head: 'cess', code: '9D', label: 'Cess', tax: 'x' },
];
const OTHER_ROWS: Array<{ other: OtherKey; code: string; label: string }> = [
  { other: 'interest', code: '9E', label: 'Interest' },
  { other: 'lateFee', code: '9F', label: 'Late fee' },
  { other: 'penalty', code: '9G', label: 'Penalty' },
  { other: 'other', code: '9H', label: 'Other' },
];
const HEAD_LABEL: Record<Table9Head, string> = { igst: 'Integrated', cgst: 'Central', sgst: 'State/UT', cess: 'Cess' };

const Table9: React.FC = () => {
  const { workings, docs, update, readOnly } = useWorkspace();
  const g = workings.g9;
  const tol = workings.tolerance;
  const meta = docs.portal.gstr9Meta;
  const manual = docs.portal.manual;
  const n4 = taxOf(g.t4.N);
  const taxKey = Object.fromEntries(HEAD_ROWS.map((r) => [r.head, r.tax])) as Record<Table9Head, keyof Tax>;

  const rows: T9Row[] = [
    ...HEAD_ROWS.map((r) => ({
      id: r.head,
      code: r.code,
      label: r.label,
      head: r.head,
      override: docs.gstr9.t9Payable[r.head] ?? null,
      f: docFormulas(docs.gstr9.f, PAYABLE_COLS, payableFKey(r.head)),
    })),
    ...OTHER_ROWS.map((r) => ({ id: r.other, code: r.code, label: r.label, other: r.other, override: null })),
  ];

  const calc = (r: T9Row) => (r.head ? g.t9[r.head] : null);
  const other = (r: T9Row) => (r.other ? g.t9Other[r.other] : null);
  const payableNow = (r: T9Row) => (r.head ? g.t9[r.head].payable : g.t9Other[r.other!].payable);
  const sourceLabel = (r: T9Row) => {
    const c = calc(r);
    if (!c) return 'the portal';
    return c.payableSource === 'portal' ? 'the portal' : c.payableSource === '4N' ? 'Table 4N' : 'your override';
  };

  const itcCol = (key: 'itcC' | 'itcS' | 'itcI' | 'itcX', header: string): GridColumn<T9Row> =>
    displayCol<T9Row>(key, header, (r) => (calc(r) ? calc(r)![key] : null), { group: 'Paid through ITC', width: 100 });

  const sourceChip = (r: T9Row) => {
    const c = calc(r);
    if (c?.payableSource === 'override') return <Src kind="typed" title="Tax payable typed here — overrides the portal / 4N figure">Override</Src>;
    if (c?.payableSource === '4N') return <Src kind="computed" title="No portal figure — tax as per Table 4N">4N</Src>;
    const path = r.head ? `gstr9.table9.${r.head}` : `gstr9.table9.${r.other}`;
    return <Src kind="portal" meta={meta} manual={isManualPath(manual, path)} />;
  };

  const columns: GridColumn<T9Row>[] = [
    {
      key: 'particulars',
      header: 'Description',
      type: 'display',
      align: 'left',
      width: 210,
      sticky: true,
      value: (r) => `${r.code} ${r.label}`,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-[10px] font-semibold text-muted-foreground">{r.code}</span>
          {r.label}
          {sourceChip(r)}
        </span>
      ),
    },
    moneyCol<T9Row>('payable', 'Tax payable', (r) => (r.head ? r.override : payableNow(r)), (r, v) => ({ ...r, override: v }), {
      nullable: true,
      width: 120,
      editable: (r) => !!r.head,
      placeholder: (r) => (r.head ? g.t9[r.head].payable : null),
      title: (r) =>
        r.head
          ? r.override === null
            ? `From ${sourceLabel(r)} — type to override`
            : 'Typed override — press Delete to go back to the portal / 4N figure'
          : 'From the portal — edit on Portal data',
      tone: (r) => (r.head && r.override !== null ? 'warn' : undefined),
    }),
    displayCol<T9Row>('n4', 'Tax as per 4N', (r) => (r.head ? n4[taxKey[r.head]] : null), { width: 108, tone: () => 'muted' }),
    displayCol<T9Row>('cash', 'Paid through cash', (r) => (calc(r) ? calc(r)!.cash : other(r)!.cash), { width: 108 }),
    itcCol('itcC', 'Central tax'),
    itcCol('itcS', 'State/UT tax'),
    itcCol('itcI', 'Integrated tax'),
    itcCol('itcX', 'Cess'),
    displayCol<T9Row>('paid', 'Total tax paid', (r) => (calc(r) ? calc(r)!.paid : other(r)!.cash), { width: 108 }),
    displayCol<T9Row>('diff', 'Payable − Paid', (r) => (calc(r) ? calc(r)!.diff : other(r)!.diff), {
      width: 108,
      tone: (r) => diffTone(calc(r) ? calc(r)!.diff : other(r)!.diff, tol),
    }),
  ];

  const onRowsChange = (next: T9Row[]) => {
    const changed = next.filter((r, i) => r !== rows[i] && r.head);
    if (!changed.length) return;
    update('gstr9', (d) => {
      const t9Payable = { ...d.t9Payable };
      let f = d.f;
      changed.forEach((r) => {
        t9Payable[r.head!] = r.override;
        f = setDocFormulas(f, PAYABLE_COLS, payableFKey(r.head!), r.f);
      });
      return { ...d, t9Payable, f };
    });
  };

  const anyOverride = TABLE9_HEADS.some((h) => docs.gstr9.t9Payable[h] !== null && docs.gstr9.t9Payable[h] !== undefined);

  return (
    <SectionCard
      title="9 · Details of tax paid as declared in returns filed during the financial year"
      description="Paid columns, interest, late fee, penalty and other come from the portal (edit them on Portal data). Tax payable can be overridden per head."
      excelRef="GSTR-9 rows 94–104"
      actions={
        <>
          <ResetButton
            show={anyOverride}
            onClick={() =>
              update('gstr9', (d) => {
                let f = d.f;
                TABLE9_HEADS.forEach((h) => { f = setDocFormulas(f, PAYABLE_COLS, payableFKey(h), undefined); });
                return { ...d, t9Payable: { igst: null, cgst: null, sgst: null, cess: null }, f };
              })
            }
          >
            Use portal / 4N payable
          </ResetButton>
          <StepLink step="portal">Portal data</StepLink>
        </>
      }
    >
      <SheetGrid<T9Row>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={onRowsChange}
        readOnly={readOnly}
        label="GSTR-9 Table 9"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Payable vs paid:</span>
        {TABLE9_HEADS.map((h) => (
          <span key={h} className="inline-flex items-center gap-1.5 text-xs">
            <span>{HEAD_LABEL[h]}</span>
            <span className="tabular-nums text-muted-foreground">{fmtMoney(g.t9[h].diff)}</span>
            <JustifyControl lineKey={`g9.t9.${h}`} />
          </span>
        ))}
      </div>
      <Note tone="position">
        Tax payable is the portal&apos;s figure (what the portal pre-fills), else the tax in 4N, and can be overridden. The firm&apos;s sheet mixes the two (Integrated from the
        portal, Central/State from 4N).
      </Note>
    </SectionCard>
  );
};

const PartIV: React.FC = () => (
  <div className="space-y-4">
    <Table9 />
  </div>
);

export default PartIV;
