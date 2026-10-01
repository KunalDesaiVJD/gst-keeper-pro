import React from 'react';
import { RotateCcw, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { maxAbs, subT, totalTax } from '@/lib/gstr9/engine';
import { newId, zIn } from '@/lib/gstr9/defaults';
import type { Gstr9ManualDoc, OtherReversalRow, Tax, TaxIn, ValTax } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { HEAD_LABEL, JustifyControl, Note, OpenDifferences, SectionCard, SourceChip, type MatrixHead } from '../ui';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { taxFooter, taxInCols } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { FigureTable, type FigColumn, type FigRow } from '../reco/FigureTable';
import { OpenBadge, StepTab, StepTabsList } from '../reco/StepTabs';
import {
  anyTax,
  DESC_MAX,
  FORM_HEAD_NAME,
  FORM_ORDER,
  nz,
  orderTaxCols,
  overrideTaxCols,
  taxToIn,
  useGoToStep,
  useTabParam,
  withFormulas,
  type OverrideRow,
} from '../reco/helpers';

// Step 7 — GSTR 9-INPUT (the ITC working for GSTR-9 Tables 6 and 7), the
// Table 7 / 6A1 / 12 / 13 entries, and 8C. Every figure is engine-computed
// (workings.itc / workings.g9); this step only edits docs.gstr9.

/** Column group over the tax heads of the GSTR-9 editors (form order, so a block copied from the form pastes straight in). */
const FORM_GROUP = 'Tax — in GSTR-9 form order';

const fmtHeads = (t: Tax) => `IGST ${fmtMoney(t.i)} · CGST ${fmtMoney(t.c)} · SGST ${fmtMoney(t.s)}${nz(t.x) ? ` · Cess ${fmtMoney(t.x)}` : ''}`;

const SmallBadge: React.FC<{ variant?: 'secondary' | 'info' | 'warning' | 'outline'; children: React.ReactNode; title?: string }> = ({ variant = 'secondary', children, title }) => (
  <Badge variant={variant} className="whitespace-nowrap text-[10px] font-normal" title={title}>
    {children}
  </Badge>
);

// ---------------------------------------------------------------------------
// Main working (GSTR 9-INPUT)
// ---------------------------------------------------------------------------

const WORKING_HEADS: MatrixHead[] = ['t', 'i', 'c', 's', 'x'];
const WORKING_COLUMNS: FigColumn[] = WORKING_HEADS.map((h) => ({ key: h, header: HEAD_LABEL[h], width: h === 't' ? 128 : h === 'x' ? 96 : 118 }));

/** One line of the working, in the shape MatrixTable used to take (heading / total / indent / signed / diffKey). */
interface WorkingLine {
  key: string;
  code?: React.ReactNode;
  label: React.ReactNode;
  value?: Partial<ValTax> | Tax | null;
  heading?: boolean;
  total?: boolean;
  indent?: boolean;
  note?: React.ReactNode;
  diffKey?: string;
  /** Negative figures shown red (differences). */
  signed?: boolean;
}

const toFigRow = (r: WorkingLine): FigRow => {
  if (r.heading) return { key: r.key, code: r.code, label: r.label, kind: 'heading' };
  const v = (r.value ?? {}) as Partial<Record<MatrixHead, number>>;
  const values = Object.fromEntries(WORKING_HEADS.map((h) => [h, v[h]]));
  const tones = r.signed ? Object.fromEntries(WORKING_HEADS.map((h) => [h, (v[h] ?? 0) < -0.004 ? ('error' as const) : undefined])) : undefined;
  return {
    key: r.key,
    code: r.code,
    label: r.label,
    note: r.note,
    values,
    tones,
    kind: r.total ? 'total' : r.indent ? 'sub' : 'row',
    status: r.diffKey ? <JustifyControl lineKey={r.diffKey} /> : undefined,
  };
};

/** The ITC working (about 25 lines) fills the screen below the tabs and scrolls inside itself, header pinned. */
const WORKING_MAX_HEIGHT = 'max(360px, calc(100vh - 300px))';

const WorkingCard: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const goTo = useGoToStep();
  const I = workings.itc;
  const g9 = workings.g9;
  const tol = workings.tolerance;

  const plugGap = subT(I.inputServices, I.inputServicesBooks);
  const plugFlag = maxAbs(plugGap) > tol;

  const src6A =
    g9.t6ASource === 'gstr9' ? (
      <span className="inline-flex items-center gap-1">
        <SourceChip meta={docs.portal.gstr9Meta} />
        <span className="text-[10px] text-muted-foreground">GSTR-9 system-computed</span>
      </span>
    ) : g9.t6ASource === 'monthly_3b' ? (
      <SmallBadge title="GSTR-9 JSON not fetched — 6A is the sum of Table 4A of the as-filed GSTR-3B">Σ 4A of as-filed GSTR-3B</SmallBadge>
    ) : (
      <button type="button" onClick={() => goTo('portal')} aria-label="6A not fetched — open the Portal data step">
        <SmallBadge variant="warning">Not fetched — Portal data</SmallBadge>
      </button>
    );

  const s175Src =
    docs.gstr9.t7.s17_5 == null ? (
      <SmallBadge title="Sum of 4B(1) of the as-filed GSTR-3B">As-filed 3B 4B(1)</SmallBadge>
    ) : (
      <SmallBadge variant="outline" title={`Typed. As-filed GSTR-3B 4B(1): ${fmtHeads(g9.t7EPortal)}`}>
        Typed
      </SmallBadge>
    );

  // Only lines the engine actually pushed get a justification control.
  const hasLine = (key: string) => workings.diffs.some((d) => d.key === key);
  const optional: WorkingLine[] = [];
  if (anyTax(I.isd)) optional.push({ key: 'isd', code: '6G', label: 'ITC received from ISD', value: I.isd });
  if (anyTax(I.t6N)) optional.push({ key: 't6N', code: '6N', label: 'TRAN-1 / TRAN-2 / ITC-01, 02, 02A (6K–6M)', value: I.t6N });

  const rows: WorkingLine[] = [
    { key: 'h6', heading: true, code: '6', label: 'ITC availed — GSTR-9 Table 6' },
    { key: 'inputs', code: '6B', label: 'Inputs', value: I.inputs, note: <SmallBadge variant="outline">9C row A</SmallBadge> },
    {
      key: 'is',
      code: '6B',
      label: 'Input services — balancing figure',
      value: I.inputServices,
      note: <SmallBadge title="6A2 less every other line, so 6(O) ties to 6A2 — as the sheet's row 10 does">Balancing figure</SmallBadge>,
    },
    { key: 'isBooks', indent: true, label: <span className="text-muted-foreground">Books ITC on these ledgers</span>, value: I.inputServicesBooks },
    {
      key: 'isGap',
      indent: true,
      label: <span className="text-muted-foreground">Difference hidden by the balancing figure</span>,
      value: plugGap,
      note: plugFlag ? <SmallBadge variant="warning">Above ₹{tol}</SmallBadge> : undefined,
    },
    { key: 'imp', code: '6E', label: 'Import of goods (incl. supplies from SEZ)', value: I.importGoods, note: <SmallBadge variant="outline">9C row D</SmallBadge> },
    { key: 'cg', code: '6B', label: 'Capital goods', value: I.capitalGoods, note: <SmallBadge variant="outline">9C row O</SmallBadge> },
    { key: 'rcm', code: '6C–6F', label: 'RCM — as per books (RCM Part B)', value: I.rcm },
    { key: 'reclaim', code: '6H', label: 'ITC reclaim (suspended ITC reclaimed, Duties & Taxes)', value: I.reclaim },
    ...optional,
    { key: 'total6O', code: '6O', label: 'TOTAL (should match 6(O) of GSTR-9)', value: I.total, total: true },
    { key: 'asPer3B', code: '6A2', label: 'AS PER 3B — net ITC of the year (6A − 6A1)', value: I.asPer3B, note: src6A },
    { key: '6A', code: '6A', indent: true, label: <span className="text-muted-foreground">ITC availed through GSTR-3B</span>, value: g9.t6.A },
    { key: '6A1', code: '6A1', indent: true, label: <span className="text-muted-foreground">Less: preceding-FY ITC availed this year</span>, value: g9.t6.A1 },
    { key: '6J', code: '6J', label: 'Difference (6I − 6A2) — should be nil', value: g9.t6.J, diffKey: hasLine('itc.6J') ? 'itc.6J' : undefined, signed: true },

    { key: 'h7', heading: true, code: '7', label: 'ITC reversed — GSTR-9 Table 7' },
    { key: 'rev', code: '7H1', label: 'ITC reversal — suspended ITC as per Duties & Taxes', value: I.reversal7H1 },
    { key: 's175', code: '7E', label: 'As per section 17(5)', value: I.s17_5, note: s175Src },
    { key: 'otherRev', code: '7A–7H', label: 'Other Table 7 reversals (entered below)', value: I.otherReversals },
    { key: 't7J', code: '7J', label: 'TOTAL (should match 7(J) of GSTR-9)', value: I.total7J, total: true },

    { key: 'hb', heading: true, label: 'Against the books, and next year' },
    { key: 'book', label: 'AS PER BOOK — Duties & Taxes net ITC, after last-year effect', value: I.asPerBook },
    { key: 'res', label: 'Difference: 7J − books', value: I.residual, diffKey: hasLine('itc.books') ? 'itc.books' : undefined, signed: true },
    { key: 't12s', code: '12', label: 'ITC to be reversed in the next year → Table 12', value: I.t12Suggested },
    { key: 't13s', code: '13', label: 'ITC to be claimed in the next year → Table 13 (suggestion)', value: I.t13Suggested },
  ];

  return (
    <SectionCard
      title="ITC working for GSTR-9"
      description="Table 6 built from the books, tied to 6A2; Table 7 reversals; and the gap to the books that goes to Tables 12 and 13."
      excelRef="GSTR 9-INPUT B7:H28"
    >
      {workings.ctx.noItcBuilder && (
        <Note>This client is a builder on the no-ITC scheme — nil ITC is expected, and ITC differences are for information only.</Note>
      )}
      <FigureTable
        label="GSTR 9-INPUT: ITC working for GSTR-9"
        firstHeader="Particulars"
        columns={WORKING_COLUMNS}
        rows={rows.map(toFigRow)}
        maxHeight={WORKING_MAX_HEIGHT}
        labelWidth={300}
      />
      <div className="grid gap-2 lg:grid-cols-2">
        <Note tone="position">
          “As per book” is the Duties &amp; Taxes net <strong>after</strong> the last-year effect (D&amp;T-INPUT U26), not U24 as the sheet reads, and 6A1 defaults to the last-year effect. 7J is current-year ITC, so the book figure must be too; the sheet’s two agree only while the last-year effect is nil.
        </Note>
        <Note tone="position">
          The input-services taxable value includes every ledger that is not inputs, imports or capital goods (the sheet’s C10 skips 9C rows B, C and N). RCM is the books’ Part B, all expense blocks added (the sheet’s RCM D28:D39 adds only two).
        </Note>
      </div>
      {plugFlag && (
        <Note tone="warn">
          Input services is a balancing figure, so it absorbs {fmtHeads(plugGap)} that is not in the input-service ledgers’ own ITC. Usually a P&amp;L vs Duties &amp; Taxes gap or a mis-tagged ledger — check the Purchases and Duties &amp; Taxes steps before relying on 6B.
        </Note>
      )}
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// 6A1 — preceding-FY ITC availed this year
// ---------------------------------------------------------------------------

interface LabelledRow extends OverrideRow {
  code: string;
  label: string;
}

const codeCol = <R extends { code: string }>(): GridColumn<R> => ({
  key: 'code',
  header: 'No.',
  type: 'display',
  align: 'left',
  width: 56,
  value: (r) => r.code,
});

const T6A1Card: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const lye = workings.dti.lye;
  const typed = docs.gstr9.t6A1 != null;
  const rows: LabelledRow[] = [
    { id: 't6A1', code: '6A1', label: 'ITC of a preceding FY availed in this FY (other than reclaim)', v: docs.gstr9.t6A1, f: docs.gstr9.t6A1?.f, computed: lye },
  ];
  const columns: GridColumn<LabelledRow>[] = [
    codeCol<LabelledRow>(),
    {
      key: 'label',
      header: 'Particulars',
      type: 'display',
      align: 'left',
      width: 340,
      value: (r) => r.label,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.label}
          {typed ? <SmallBadge variant="outline">Typed</SmallBadge> : <SmallBadge>Last-year effect</SmallBadge>}
        </span>
      ),
    },
    ...overrideTaxCols<LabelledRow>({ computedHint: 'Last-year effect (Duties & Taxes row 9) — type to override', order: FORM_ORDER, names: FORM_HEAD_NAME, group: FORM_GROUP }),
  ];

  const reset = () => {
    const prev = docs.gstr9.t6A1;
    update('gstr9', (d) => ({ ...d, t6A1: null }));
    toast('6A1 follows the last-year effect again', { action: { label: 'Undo', onClick: () => update('gstr9', (d) => ({ ...d, t6A1: prev })) } });
  };

  return (
    <SectionCard
      title="ITC of a preceding FY availed in this FY (6A1)"
      description="Defaults to the last-year effect entered on the Duties & Taxes step. Type over it only if the GSTR-9 figure differs."
      excelRef="GSTR-9 6A1 · DUTIES & TAXES-INPUT row 9"
      actions={
        typed && !readOnly ? (
          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Use last-year effect
          </Button>
        ) : undefined
      }
    >
      <SheetGrid<LabelledRow>
        label="GSTR-9 6A1"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        readOnly={readOnly}
        onRowsChange={(next) => update('gstr9', (d) => ({ ...d, t6A1: withFormulas(next[0].v, next[0].f) }))}
      />
      {typed && (
        <p className="text-[11px] text-muted-foreground">Last-year effect as per books: {fmtHeads(lye)}</p>
      )}
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 7 (7A–7H)
// ---------------------------------------------------------------------------

type T7Fixed = 'r37' | 'r37A' | 'r38' | 'r39' | 'r42' | 'r43' | 's17_5' | 'tran1' | 'tran2';

interface T7Row extends LabelledRow {
  kind: 'fixed' | 'h1';
  /** The docs.gstr9.t7 field the row edits. */
  field: T7Fixed | 'otherDesc';
}

const T7_ROWS: Array<{ id: T7Fixed; code: string; label: string }> = [
  { id: 'r37', code: '7A', label: 'As per Rule 37 (180 days payment)' },
  { id: 'r37A', code: '7A1', label: 'As per Rule 37A' },
  { id: 'r38', code: '7A2', label: 'As per Rule 38' },
  { id: 'r39', code: '7B', label: 'As per Rule 39' },
  { id: 'r42', code: '7C', label: 'As per Rule 42' },
  { id: 'r43', code: '7D', label: 'As per Rule 43' },
  { id: 's17_5', code: '7E', label: 'As per section 17(5)' },
  { id: 'tran1', code: '7F', label: 'Reversal of TRAN-I credit' },
  { id: 'tran2', code: '7G', label: 'Reversal of TRAN-II credit' },
];

const limitDesc = (text: string): string => {
  if (text.length <= DESC_MAX) return text;
  toast.warning(`Description shortened to ${DESC_MAX} characters — the GSTR-9 offline tool's limit.`);
  return text.slice(0, DESC_MAX);
};

const Table7Card: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const G = docs.gstr9;
  const g9 = workings.g9;
  const h1 = g9.t7H[0];

  const rows: T7Row[] = [
    ...T7_ROWS.map((r): T7Row => {
      const v = G.t7[r.id];
      return { ...r, field: r.id, kind: 'fixed', v, f: v?.f, computed: r.id === 's17_5' && v == null ? g9.t7EPortal : null };
    }),
    { id: 'h1', field: 'otherDesc', code: '7H1', label: G.t7.otherDesc, kind: 'h1', v: null, computed: h1 ? h1.tax : null },
  ];

  const columns: GridColumn<T7Row>[] = [
    codeCol<T7Row>(),
    {
      key: 'label',
      header: 'Particulars',
      type: 'text',
      align: 'left',
      width: 340,
      value: (r) => r.label,
      editable: (r) => r.kind === 'h1',
      title: (r) => (r.kind === 'h1' ? `Description as it goes into the offline tool (max ${DESC_MAX} characters). Figures come from Duties & Taxes.` : undefined),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.label || <span className="italic text-muted-foreground">Other reversal</span>}
          {r.kind === 'h1' && <SmallBadge>From Duties &amp; Taxes</SmallBadge>}
          {r.id === 's17_5' &&
            (r.v == null ? <SmallBadge title="Sum of 4B(1) of the as-filed GSTR-3B">As-filed 3B 4B(1)</SmallBadge> : <SmallBadge variant="outline">Typed</SmallBadge>)}
        </span>
      ),
      onEdit: (r, e) => ({ ...r, label: limitDesc(e.text) }),
    },
    ...overrideTaxCols<T7Row>({ editable: (r) => r.kind !== 'h1', computedHint: (r) =>
        r.kind === 'h1' ? 'Suspended ITC reversed, from Duties & Taxes (I + L) — change it there' : 'As-filed GSTR-3B 4B(1) — type to override', order: FORM_ORDER, names: FORM_HEAD_NAME, group: FORM_GROUP }),
  ];

  const onRowsChange = (next: T7Row[]) =>
    update('gstr9', (d) => {
      const t7 = { ...d.t7 };
      next.forEach((r) => {
        const field = r.field;
        if (field === 'otherDesc') t7.otherDesc = r.label;
        else if (field === 's17_5') t7.s17_5 = withFormulas(r.v, r.f);
        else t7[field] = withFormulas(r.v ?? zIn(), r.f);
      });
      return { ...d, t7 };
    });

  const reset7E = () => {
    const prev = G.t7.s17_5;
    update('gstr9', (d) => ({ ...d, t7: { ...d.t7, s17_5: null } }));
    toast('7E follows the as-filed GSTR-3B 4B(1) again', {
      action: { label: 'Undo', onClick: () => update('gstr9', (d) => ({ ...d, t7: { ...d.t7, s17_5: prev } })) },
    });
  };

  // Further 7H lines typed by hand.
  const extras = G.t7.otherExtra;
  const extraCols: GridColumn<OtherReversalRow>[] = [
    {
      key: 'code',
      header: 'No.',
      type: 'display',
      align: 'left',
      width: 56,
      value: (_r, i) => `7H${i + 2}`,
    },
    {
      key: 'desc',
      header: 'Description',
      type: 'text',
      align: 'left',
      width: 340,
      value: (r) => r.description,
      placeholder: () => 'Nature of the reversal',
      title: () => `Max ${DESC_MAX} characters (offline tool limit)`,
      onEdit: (r, e) => ({ ...r, description: limitDesc(e.text) }),
    },
    ...taxInCols<OtherReversalRow>((r) => ({ i: r.i, c: r.c, s: r.s, x: r.x }), (r, t: TaxIn) => ({ ...r, ...t }), { prefix: 'x7h', cess: true, group: FORM_GROUP }),
  ];
  const extraColsOrdered = orderTaxCols(extraCols, FORM_ORDER, FORM_HEAD_NAME);

  return (
    <SectionCard
      title="Table 7 — ITC reversed and ineligible"
      description="Type the reversals rule by rule. 7E follows the as-filed GSTR-3B 4B(1) until you type over it; 7H1 comes from the suspended-ITC columns of Duties & Taxes."
      excelRef="GSTR-9 rows 66–78 · GSTR 9-INPUT rows 20–23"
      actions={
        G.t7.s17_5 != null && !readOnly ? (
          <Button size="sm" variant="outline" onClick={reset7E} title={`As-filed GSTR-3B 4B(1): ${fmtHeads(g9.t7EPortal)}`}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> 7E: use as-filed 3B 4B(1) ({fmtMoney(totalTax(g9.t7EPortal))})
          </Button>
        ) : undefined
      }
    >
      <Note tone="position">
        Suspended-ITC reversals (including the 180-day reversals) are reported as 7H1 “other reversal” rather than 7A (Rule 37), as the sheet does. Put a reversal in 7A only if it is not already in the Duties &amp; Taxes suspended columns, or it will be counted twice.
      </Note>
      <SheetGrid<T7Row> label="GSTR-9 Table 7A to 7H1" rows={rows} columns={columns} getRowId={(r) => r.id} readOnly={readOnly} onRowsChange={onRowsChange} />
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">Further 7H lines</div>
        <SheetGrid<OtherReversalRow>
          label="GSTR-9 Table 7H — further other reversals"
          rows={extras}
          columns={extraColsOrdered}
          getRowId={(r) => r.id}
          readOnly={readOnly}
          canDelete
          addLabel="Add 7H line"
          newRow={() => ({ id: newId(), description: '', i: 0, c: 0, s: null, x: 0 })}
          onRowsChange={(next) => update('gstr9', (d) => ({ ...d, t7: { ...d.t7, otherExtra: next } }))}
          emptyText="No further 7H lines — add one only for a reversal that is not in the lines above."
          footer={[
            { key: '7I', label: '7I', tone: 'total', cells: { desc: 'Total ITC reversed (7A to 7H)', ...taxFooter('x7h', g9.t7I, true) } },
            { key: '7J', label: '7J', tone: 'total', cells: { desc: 'Net ITC available for utilisation (6O − 7I)', ...taxFooter('x7h', g9.t7J, true) } },
          ]}
        />
      </div>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Tables 12 and 13, and 8C
// ---------------------------------------------------------------------------

interface NextYearRow extends LabelledRow {
  kind: 't12' | 't13' | 'ref';
}

const NextYearCard: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const G = docs.gstr9;
  const I = workings.itc;
  const t12Typed = G.t12 != null;
  const sugg = I.t13Suggested;

  const rows: NextYearRow[] = [
    { id: 't12', kind: 't12', code: '12', label: 'ITC of the FY reversed in the next FY', v: G.t12, f: G.t12?.f, computed: t12Typed ? null : I.t12Suggested },
    { id: 't13', kind: 't13', code: '13', label: 'ITC of the FY availed in the next FY', v: G.t13, f: G.t13?.f, computed: null },
    { id: 'ref13', kind: 'ref', code: '', label: 'Suggestion for 13 — books − 7J, where positive', v: null, computed: sugg },
  ];

  const columns: GridColumn<NextYearRow>[] = [
    codeCol<NextYearRow>(),
    {
      key: 'label',
      header: 'Particulars',
      type: 'display',
      align: 'left',
      width: 340,
      value: (r) => r.label,
      render: (r) => (
        <span className={r.kind === 'ref' ? 'inline-flex items-center gap-1.5 italic text-muted-foreground' : 'inline-flex items-center gap-1.5'}>
          {r.label}
          {r.kind === 't12' && (t12Typed ? <SmallBadge variant="outline">Typed</SmallBadge> : <SmallBadge>Computed</SmallBadge>)}
          {r.kind === 't13' && <SmallBadge variant="outline">Typed</SmallBadge>}
        </span>
      ),
    },
    ...overrideTaxCols<NextYearRow>({ editable: (r) => r.kind !== 'ref', computedHint: (r) =>
        r.kind === 'ref' ? 'Suggestion — “Table 13: use suggested” copies it into Table 13' : 'Computed MAX(7J − books, 0) — type to override', order: FORM_ORDER, names: FORM_HEAD_NAME, group: FORM_GROUP }),
  ];

  const onRowsChange = (next: NextYearRow[]) =>
    update('gstr9', (d) => {
      const out: Gstr9ManualDoc = { ...d };
      next.forEach((r) => {
        if (r.kind === 't12') out.t12 = withFormulas(r.v, r.f);
        if (r.kind === 't13') out.t13 = withFormulas(r.v ?? zIn(), r.f);
      });
      return out;
    });

  const reset12 = () => {
    const prev = G.t12;
    update('gstr9', (d) => ({ ...d, t12: null }));
    toast('Table 12 is computed again', { action: { label: 'Undo', onClick: () => update('gstr9', (d) => ({ ...d, t12: prev })) } });
  };
  const useSuggested13 = () => {
    const prev = G.t13;
    update('gstr9', (d) => ({ ...d, t13: taxToIn(sugg) }));
    toast('Table 13 set to the suggestion', { action: { label: 'Undo', onClick: () => update('gstr9', (d) => ({ ...d, t13: prev })) } });
  };

  return (
    <SectionCard
      title="Tables 12 & 13 — ITC of this year reversed / availed next year"
      description="Table 12 is computed from the gap between 7J and the books unless you type over it. Table 13 is typed."
      excelRef="GSTR 9-INPUT rows 27–28 · GSTR-9 rows 110–111, 83"
      actions={
        !readOnly ? (
          <>
            {t12Typed && (
              <Button size="sm" variant="outline" onClick={reset12}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Table 12: use computed
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={useSuggested13} title={fmtHeads(sugg)}>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Table 13: use suggested ({fmtMoney(totalTax(sugg))})
            </Button>
          </>
        ) : undefined
      }
    >
      <Note tone="position">
        Table 13 is typed, with the ITC reco’s suggestion (books − 7J, where positive) shown beside it, because that residual is often an unexplained monthly difference rather than ITC actually availed next year. Table 12 follows the sheet — computed MAX(7J − books, 0) — and can be overridden. 8C = Table 13 − Table 12, as in the sheet.
      </Note>
      <SheetGrid<NextYearRow>
        label="GSTR-9 Tables 12 and 13"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        readOnly={readOnly}
        onRowsChange={onRowsChange}
        rowTone={(r) => (r.kind === 'ref' ? 'muted' : undefined)}
        footer={[
          {
            key: '8C',
            label: '8C',
            tone: 'total',
            cells: { label: 'ITC availed next year, net (13 − 12)', i: workings.g9.t8.C.i, c: workings.g9.t8.C.c, s: workings.g9.t8.C.s, x: workings.g9.t8.C.x },
          },
        ]}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------

const TABS = ['working', 'table7', 'next'] as const;

/**
 * Step 7 — the working (Tables 6 and 7 against 6A2 and the books) first; the
 * Table 7 entries and the 6A1 / 12 / 13 entries one click away (?itctab=).
 * Every difference line of the step sits in the working, so its open count
 * is on that tab.
 */
const ItcRecoStep: React.FC = () => {
  const { workings } = useWorkspace();
  const [tab, setTab] = useTabParam('itctab', TABS, 'working');
  return (
    <div className="space-y-3">
      <OpenDifferences step="itc" />
      <Tabs value={tab} onValueChange={setTab} className="space-y-2">
        <StepTabsList label="ITC reco" value={tab}>
          <StepTab value="working">
            ITC working — Tables 6 &amp; 7 <OpenBadge n={workings.stepOpen.itc} />
          </StepTab>
          <StepTab value="table7" title="7A to 7H, typed rule by rule">
            Table 7 entries
          </StepTab>
          <StepTab value="next" title="6A1, Tables 12 and 13, and 8C">
            6A1 · Tables 12 &amp; 13
          </StepTab>
        </StepTabsList>
        <TabsContent value="working" className="mt-0">
          <WorkingCard />
        </TabsContent>
        <TabsContent value="table7" className="mt-0">
          <Table7Card />
        </TabsContent>
        <TabsContent value="next" className="mt-0 space-y-3">
          <T6A1Card />
          <NextYearCard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ItcRecoStep;
