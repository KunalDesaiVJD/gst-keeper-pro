import React, { useCallback, useMemo } from 'react';
import { applyHandEdits, type FieldEdit } from '@/lib/gstr9/portalImport';
import { FY_MONTHS, type Formulas, type MonthKey, type Tax, type TaxIn } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, MatrixTable, Money, Note, SectionCard, type MatrixHead } from '../ui';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { taxDisplayCols, taxFooter } from '../grid/columns';
import AdjustmentsGrid from './AdjustmentsGrid';
import PortalNote from './PortalNote';
import { FooterLabel } from './parts';
import {
  computedCols,
  diffCells,
  diffCols,
  footerStatusLabel,
  headsFor,
  mirroredTaxCols,
  monthCol,
  monthRowF,
  portal3bCols,
  portalEdits,
  prefixF,
  sameF,
  soft,
  unprefixF,
  useGoStep,
  withoutPrefix,
  type DutiesView,
} from './helpers';

type DtiField = 'purchase' | 'debitNote' | 'suspRev' | 'suspRev180' | 'suspReclaim' | 'suspReclaim180';

/** The typed column groups of DUTIES & TAXES-INPUT, in the sheet's order (C:T). */
const GROUPS: Array<{ field: DtiField; label: string; suspended: boolean }> = [
  { field: 'purchase', label: 'Purchase', suspended: false },
  { field: 'debitNote', label: 'Debit note', suspended: false },
  { field: 'suspRev', label: 'Suspended ITC (reversed)', suspended: true },
  { field: 'suspRev180', label: 'Suspended ITC (reversed) – 180 days', suspended: true },
  { field: 'suspReclaim', label: 'Suspended ITC (reclaim)', suspended: true },
  { field: 'suspReclaim180', label: 'Suspended ITC (reclaim) – 180 days', suspended: true },
];

/** One month of DUTIES & TAXES-INPUT: books (typed) + the as-filed 3B (portal doc). */
type DtiRow = Record<DtiField, TaxIn> & {
  id: MonthKey;
  /** PortalDoc.months[m].itcExclRcm — 4A(1)+4A(4)+4A(5) − 4B(1) − 4B(2) of the as-filed GSTR-3B. */
  itcExclRcm: Tax;
  /** DtiMonth.f (books) plus PortalDoc.f for this month's "As per 3B" heads, under the grid's column keys. */
  f?: Formulas;
};

/**
 * Row 9 "LAST YEAR EFFECT" as a one-row grid. The stored TaxIn keeps its
 * expressions keyed by head ({ c: "=…" }); in the grid they sit under "lye.c".
 */
type LyeRow = TaxIn & { id: 'lye' };

const WHAT_3B = '4A(1) + 4A(4) + 4A(5) − 4B(1) − 4B(2)';

/** DUTIES & TAXES-INPUT (excluding RCM) — the Dr side of the ITC ledgers, month by month. */
const InputTab: React.FC<{ cess: boolean; view: DutiesView; gridMaxHeight: string }> = ({ cess, view, gridMaxHeight }) => {
  // Compact: the four suspended-ITC groups fold into their net. Books vs 3B: every typed books group is hidden.
  const compact = view === 'compact';
  const recon = view === 'recon';
  const { docs, workings, update, readOnly, canEditSource } = useWorkspace();
  const goStep = useGoStep();
  const dti = workings.dti;
  const tol = workings.tolerance;

  // ------------------------------------------------------------------ Last year effect
  const lyeRows = useMemo<LyeRow[]>(() => {
    const l = docs.duties_input.lastYearEffect;
    return [{ id: 'lye', i: l.i, c: l.c, s: l.s, x: l.x, f: prefixF(l.f, 'lye') }];
  }, [docs.duties_input.lastYearEffect]);
  const onLyeChange = useCallback(
    (next: LyeRow[]) => {
      const r = next[0];
      if (!r) return;
      const stored: TaxIn = { i: r.i, c: r.c, s: r.s, x: r.x };
      const f = unprefixF(r.f, 'lye');
      if (f) stored.f = f;
      update('duties_input', (d) => ({ ...d, lastYearEffect: stored }));
    },
    [update],
  );
  const lyeColumns = useMemo<GridColumn<LyeRow>[]>(
    () => [
      { key: 'label', header: 'Row', type: 'display', value: () => 'Last year effect', sticky: true, align: 'left', width: 140 },
      ...mirroredTaxCols<LyeRow>((r) => r, (r, t) => ({ ...r, i: t.i, c: t.c, s: t.s, x: t.x }), { prefix: 'lye', cess }),
      {
        key: 'status',
        header: 'Status',
        type: 'display',
        value: () => null,
        width: 64,
        align: 'center',
        render: () => <JustifyControl lineKey="dti.lye" compact />,
      },
    ],
    [cess],
  );
  const t6A1Typed = docs.gstr9.t6A1 !== null && docs.gstr9.t6A1 !== undefined;

  // ------------------------------------------------------------------ Monthly grid
  const rows = useMemo<DtiRow[]>(
    () =>
      FY_MONTHS.map((m) => {
        const mm = docs.duties_input.months[m];
        return {
          id: m,
          purchase: mm.purchase,
          debitNote: mm.debitNote,
          suspRev: mm.suspRev,
          suspRev180: mm.suspRev180,
          suspReclaim: mm.suspReclaim,
          suspReclaim180: mm.suspReclaim180,
          itcExclRcm: docs.portal.months[m].itcExclRcm,
          f: monthRowF(mm.f, docs.portal, m, 'itcExclRcm'),
        };
      }),
    [docs.duties_input.months, docs.portal],
  );

  // Books edits go to duties_input; "As per 3B" edits are portal hand edits (typed + remembered expression).
  const onRowsChange = useCallback(
    (next: DtiRow[]) => {
      const prev = new Map(rows.map((r) => [r.id, r]));
      const books: DtiRow[] = [];
      const edits: FieldEdit[] = [];
      next.forEach((r) => {
        const p = prev.get(r.id);
        if (!p || r === p) return;
        if (GROUPS.some((g) => r[g.field] !== p[g.field]) || !sameF(withoutPrefix(r.f, 'itcExclRcm'), withoutPrefix(p.f, 'itcExclRcm'))) books.push(r);
        edits.push(...portalEdits(r.id, 'itcExclRcm', { tax: p.itcExclRcm, f: p.f }, { tax: r.itcExclRcm, f: r.f }));
      });
      if (books.length) {
        update('duties_input', (d) => {
          const months = { ...d.months };
          books.forEach((r) => {
            months[r.id] = {
              ...months[r.id],
              purchase: r.purchase,
              debitNote: r.debitNote,
              suspRev: r.suspRev,
              suspRev180: r.suspRev180,
              suspReclaim: r.suspReclaim,
              suspReclaim180: r.suspReclaim180,
              f: withoutPrefix(r.f, 'itcExclRcm'),
            };
          });
          return { ...d, months };
        });
      }
      if (edits.length) update('portal', (p) => applyHandEdits(p, edits));
    },
    [rows, update],
  );

  const lineKeys = useMemo(() => new Set(workings.diffs.map((d) => d.key)), [workings.diffs]);

  const columns = useMemo<GridColumn<DtiRow>[]>(() => {
    const cols: GridColumn<DtiRow>[] = [monthCol<DtiRow>('dti', 168)];
    GROUPS.forEach((g) => {
      if (recon || (compact && g.suspended)) return;
      cols.push(...mirroredTaxCols<DtiRow>((r) => r[g.field], (r, t) => ({ ...r, [g.field]: t }), { group: g.label, prefix: g.field, cess }));
      // Compact view: the four suspended groups collapse into their net effect (I + L − O − R).
      if (compact && g.field === 'debitNote') {
        cols.push(...taxDisplayCols<DtiRow>((r) => dti.months[r.id].suspNet, { group: 'Suspended ITC net (I + L − O − R)', prefix: 'susp', cess }));
      }
    });
    cols.push(
      ...computedCols<DtiRow>((r) => dti.months[r.id].net, { group: 'Net purchase', prefix: 'net', cess }),
      ...portal3bCols<DtiRow>({
        field: 'itcExclRcm',
        get: (r) => r.itcExclRcm,
        set: (r, t) => ({ ...r, itcExclRcm: t }),
        portal: docs.portal,
        cess,
        group: 'As per 3B',
        what: WHAT_3B,
        canEdit: canEditSource,
      }),
      ...diffCols<DtiRow>((r) => dti.months[r.id].diff, { cess, tolerance: tol, group: 'Diff (Books − 3B)', hasLine: (m) => lineKeys.has(`dti.${m}`) }),
    );
    return cols;
  }, [compact, recon, cess, dti, docs.portal, tol, lineKeys, canEditSource]);

  const footer = useMemo<GridFooterRow[]>(() => {
    const t = dti.totals;
    const booksCells = compact
      ? { ...taxFooter('purchase', t.purchase, cess), ...taxFooter('debitNote', t.dn, cess), ...taxFooter('susp', t.suspNet, cess) }
      : {
          ...taxFooter('purchase', t.purchase, cess),
          ...taxFooter('debitNote', t.dn, cess),
          ...taxFooter('suspRev', t.sr, cess),
          ...taxFooter('suspRev180', t.sr180, cess),
          ...taxFooter('suspReclaim', t.rc, cess),
          ...taxFooter('suspReclaim180', t.rc180, cess),
        };
    return [
      {
        key: 'total',
        label: <FooterLabel title="Months + last year effect (the sheet's U22 = SUM(U9:U21)). The last year effect has no 3B month, so it also shows in the difference (AA22).">Total (incl. LYE)</FooterLabel>,
        tone: 'total',
        cells: {
          ...booksCells,
          ...taxFooter('net', t.net, cess),
          ...taxFooter('itcExclRcm', t.asPer3B, cess),
          ...diffCells('diff', t.diff, cess, tol),
        },
      },
      {
        key: 'rcm',
        label: footerStatusLabel(
          <FooterLabel soft title="RCM tax only: RCM Part B (books, RCM step) vs 3.1(d) of the as-filed 3B (RCM Part A) — the sheet's row 23">
            RCM tax figures only
          </FooterLabel>,
          'dti.rcm',
        ),
        tone: 'total',
        cells: soft({
          ...taxFooter('net', dti.rcmBooks, cess),
          ...taxFooter('itcExclRcm', dti.rcmPortal, cess),
          ...diffCells('diff', dti.rcmDiff, cess, tol),
        }),
      },
      {
        key: 'itc',
        label: <FooterLabel title="To be matched with the annual GSTR-3B (the sheet's row 24 = Total + RCM)">Total ITC for the year</FooterLabel>,
        tone: 'total',
        cells: {
          ...taxFooter('net', dti.totalItcBooks, cess),
          ...taxFooter('itcExclRcm', dti.totalItcPortal, cess),
          ...diffCells('diff', dti.totalItcDiff, cess, tol),
        },
      },
      {
        key: 'lye',
        label: (
          <FooterLabel soft title="Row 25 = row 9 — ITC of the previous year booked this year">
            Less: last year effect
          </FooterLabel>
        ),
        tone: 'total',
        cells: soft(taxFooter('net', dti.lye, cess)),
      },
      {
        key: 'netItc',
        label: <FooterLabel title="Row 26 = row 24 − row 25 → PL-INPUT row 80 and GSTR 9-INPUT 'as per book'">Net ITC (books)</FooterLabel>,
        tone: 'total',
        cells: taxFooter('net', dti.net, cess),
      },
      {
        key: 'pl',
        label: (
          <FooterLabel soft title="Net ITC of PL-INPUT row 79 (Purchases step) — the sheet's row 28">
            As per P&amp;L
          </FooterLabel>
        ),
        tone: 'total',
        cells: soft(taxFooter('net', dti.asPerPl, cess)),
      },
      {
        key: 'plDiff',
        label: footerStatusLabel(
          <FooterLabel soft title="As per P&L − Net ITC (the sheet's row 29 = U28 − U26) — P&L (PL-INPUT row 79) vs Duties & Taxes net">
            P&amp;L − D&amp;T
          </FooterLabel>,
          'dti.pl',
        ),
        tone: 'total',
        cells: diffCells('net', dti.plDiff, cess, tol),
      },
    ];
  }, [dti, compact, cess, tol]);

  // ------------------------------------------------------------------ Suspended ITC strip
  const heads: MatrixHead[] = headsFor(cess).map(([h]) => h);

  const lyeCard = (
    <SectionCard
      title="Last year effect"
      description="ITC of the previous financial year booked or claimed in this year (net)."
      excelRef="DUTIES & TAXES-INPUT row 9 · U25"
    >
      <div className="max-w-2xl">
        <SheetGrid<LyeRow>
          label="Last year effect"
          rows={lyeRows}
          columns={lyeColumns}
          getRowId={(r) => r.id}
          onRowsChange={onLyeChange}
          readOnly={readOnly}
        />
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>
          Counted in the year’s total above (it has no 3B month), then deducted to reach <span className="text-foreground">Net ITC (books)</span> —
          PL-INPUT row 80, Annexure-2 H, GSTR-9C 12B.
        </li>
        <li>
          GSTR-9 6A1:{' '}
          {t6A1Typed ? (
            <>
              typed on the ITC reco step (IGST <Money value={workings.g9.t6.A1.i} />, CGST <Money value={workings.g9.t6.A1.c} />), so it does not
              follow this figure.{' '}
            </>
          ) : (
            <>follows this figure unless typed on the ITC reco step. </>
          )}
          <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => goStep('itc', { itctab: 'next' })}>
            Open ITC reco
          </button>
        </li>
      </ul>
      <Note tone="position">
        The book ITC for the year is the Duties &amp; Taxes net <em>after</em> Last Year Effect (row 26, not row 24), and GSTR-9 6A1 defaults to
        it. The workbook compares 7J with row 24, which still holds prior-year ITC — the two agree only while this is 0.
      </Note>
    </SectionCard>
  );

  const suspendedCard = (
    <SectionCard
      title="Suspended ITC — where it goes"
      description="Year totals of the suspended-ITC columns, as the other sheets read them."
      excelRef="PL-INPUT row 73 · GSTR 9-INPUT rows 14, 20"
    >
      <MatrixTable
        label="Suspended ITC totals"
        heads={heads}
        rows={[
          { key: 'net', code: 'I+L−O−R', label: 'Suspended ITC net (reversed − reclaimed)', note: <span className="text-[11px] text-muted-foreground">→ PL-INPUT row 73 · Annexure-2 B · 9C A1</span>, value: dti.suspendedNet, total: true },
          { key: 'rev', code: 'I+L', label: 'Reversed (incl. 180 days)', note: <span className="text-[11px] text-muted-foreground">→ GSTR-9 7H1</span>, value: dti.reversals, indent: true },
          { key: 'rec', code: 'O+R', label: 'Reclaimed (incl. 180 days)', note: <span className="text-[11px] text-muted-foreground">→ GSTR-9 6H</span>, value: dti.reclaims, indent: true },
        ]}
      />
      <Note tone="position">
        Suspended-ITC reversals (including 180-day reversals) are reported in GSTR-9 7H “other reversal” rather than 7A (Rule 37), and reclaims
        in 6H — as the workbook does.
      </Note>
    </SectionCard>
  );

  return (
    <>
      <SectionCard
        title="Input tax credit by month (excluding RCM)"
        description="Purchases, debit notes and suspended ITC from the ITC ledgers, against the as-filed GSTR-3B."
        excelRef="DUTIES & TAXES-INPUT B7:AC29"
        actions={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">RCM books vs 3B:</span>
              <JustifyControl lineKey="dti.rcm" />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">P&amp;L vs D&amp;T net:</span>
              <JustifyControl lineKey="dti.pl" />
            </span>
          </span>
        }
      >
        <PortalNote what={WHAT_3B} missingKey="dti.no3b" />
        <SheetGrid<DtiRow>
          label="Input tax credit by month"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowsChange={onRowsChange}
          readOnly={readOnly}
          footer={footer}
          maxHeight={gridMaxHeight}
        />
        {!readOnly && (compact || recon || cess) && (
          <p className="text-[11px] text-muted-foreground">
            {recon
              ? 'Books vs 3B view: the purchase, debit note and suspended-ITC columns are hidden — switch to All columns to enter them or to paste whole sheet rows (C:Z).'
              : compact
                ? 'Compact view: the suspended-ITC groups are hidden — switch to All columns to enter them or to paste whole sheet rows (C:Z).'
                : 'Cess columns are shown — the firm’s sheet has none, so hide cess before pasting whole sheet rows (C:Z).'}
          </p>
        )}
        <Note tone="position">
          Difference = Books − 3B, per head. A month needs a reason when any head is off by more than ₹{tol} (per-client tolerance; the workbook
          has none). RCM and P&amp;L lines are for information.
        </Note>
      </SectionCard>

      <div className="grid items-start gap-3 2xl:grid-cols-2">
        {lyeCard}
        {suspendedCard}
      </div>

      <SectionCard
        title="Other adjustments in Dr side"
        description="Debits to the ITC ledgers that are not a month's purchase or debit note."
        excelRef="DUTIES & TAXES-INPUT B26:F36"
      >
        <AdjustmentsGrid
          docKey="duties_input"
          label="Other adjustments in Dr side"
          cess={cess}
          emptyText="No other Dr-side adjustments."
          totals={[
            { key: 'total', label: 'Total', value: dti.adjustments },
            {
              key: 'dr',
              label: <FooterLabel title="Purchase total + other adjustments (the sheet's C36 = C22 + C34)">Total Dr</FooterLabel>,
              value: dti.totalDr,
              note: 'Purchase total + adjustments',
            },
          ]}
        />
      </SectionCard>
    </>
  );
};

export default InputTab;
