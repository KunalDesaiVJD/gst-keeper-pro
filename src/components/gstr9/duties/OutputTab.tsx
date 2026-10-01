import React, { useCallback, useMemo } from 'react';
import { applyHandEdits, type FieldEdit } from '@/lib/gstr9/portalImport';
import { FY_MONTHS, type Formulas, type MonthKey, type Tax, type TaxIn } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, Note, SectionCard } from '../ui';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { taxFooter } from '../grid/columns';
import AdjustmentsGrid from './AdjustmentsGrid';
import PortalNote from './PortalNote';
import { FooterLabel } from './parts';
import {
  computedCols,
  diffCells,
  diffCols,
  footerStatusLabel,
  mirroredTaxCols,
  monthCol,
  monthRowF,
  portal3bCols,
  portalEdits,
  sameF,
  soft,
  withoutPrefix,
  type DutiesView,
} from './helpers';

/** One month of DUTIES & TAXES-OUTPUT: books (typed) + the as-filed 3B (portal doc). */
interface DtoRow {
  id: MonthKey;
  sales: TaxIn;
  creditNote: TaxIn;
  /** PortalDoc.months[m].outTax — 3.1(a) + 3.1(b) tax of the as-filed GSTR-3B. */
  outTax: Tax;
  /** DtoMonth.f (books) plus PortalDoc.f for this month's "As per 3B" heads, under the grid's column keys. */
  f?: Formulas;
}

const WHAT_3B = '3.1(a) + 3.1(b) tax';

/** DUTIES & TAXES-OUTPUT — the Cr side of the output tax ledger, month by month. */
const OutputTab: React.FC<{ cess: boolean; view: DutiesView; gridMaxHeight: string }> = ({ cess, view, gridMaxHeight }) => {
  // "Books vs 3B" hides the typed Sales / Credit note groups; Input's "compact" has no Output counterpart.
  const recon = view === 'recon';
  const { docs, workings, update, readOnly } = useWorkspace();
  const dto = workings.dto;
  const tol = workings.tolerance;

  const lineKeys = useMemo(() => new Set(workings.diffs.map((d) => d.key)), [workings.diffs]);

  const rows = useMemo<DtoRow[]>(
    () =>
      FY_MONTHS.map((m) => {
        const mm = docs.duties_output.months[m];
        return {
          id: m,
          sales: mm.sales,
          creditNote: mm.creditNote,
          outTax: docs.portal.months[m].outTax,
          f: monthRowF(mm.f, docs.portal, m, 'outTax'),
        };
      }),
    [docs.duties_output, docs.portal],
  );

  // Books edits go to duties_output; "As per 3B" edits are portal hand edits (typed + remembered expression).
  const onRowsChange = useCallback(
    (next: DtoRow[]) => {
      const prev = new Map(rows.map((r) => [r.id, r]));
      const books: DtoRow[] = [];
      const edits: FieldEdit[] = [];
      next.forEach((r) => {
        const p = prev.get(r.id);
        if (!p || r === p) return;
        if (r.sales !== p.sales || r.creditNote !== p.creditNote || !sameF(withoutPrefix(r.f, 'outTax'), withoutPrefix(p.f, 'outTax'))) books.push(r);
        edits.push(...portalEdits(r.id, 'outTax', { tax: p.outTax, f: p.f }, { tax: r.outTax, f: r.f }));
      });
      if (books.length) {
        update('duties_output', (d) => {
          const months = { ...d.months };
          books.forEach((r) => {
            months[r.id] = { ...months[r.id], sales: r.sales, creditNote: r.creditNote, f: withoutPrefix(r.f, 'outTax') };
          });
          return { ...d, months };
        });
      }
      if (edits.length) update('portal', (p) => applyHandEdits(p, edits));
    },
    [rows, update],
  );

  const columns = useMemo<GridColumn<DtoRow>[]>(
    () => [
      monthCol<DtoRow>('dto', 104),
      ...(recon
        ? []
        : [
            ...mirroredTaxCols<DtoRow>((r) => r.sales, (r, t) => ({ ...r, sales: t }), { group: 'Sales', prefix: 'sales', cess }),
            ...mirroredTaxCols<DtoRow>((r) => r.creditNote, (r, t) => ({ ...r, creditNote: t }), { group: 'Credit note', prefix: 'creditNote', cess }),
          ]),
      ...computedCols<DtoRow>((r) => dto.months[r.id].net, { group: 'Net sales', prefix: 'net', cess }),
      ...portal3bCols<DtoRow>({
        field: 'outTax',
        get: (r) => r.outTax,
        set: (r, t) => ({ ...r, outTax: t }),
        portal: docs.portal,
        cess,
        group: 'As per 3B',
        what: WHAT_3B,
      }),
      ...diffCols<DtoRow>((r) => dto.months[r.id].diff, { cess, tolerance: tol, group: 'Diff (Books − 3B)', hasLine: (m) => lineKeys.has(`dto.${m}`) }),
    ],
    [recon, cess, dto, docs.portal, tol, lineKeys],
  );

  const footer = useMemo<GridFooterRow[]>(
    () => [
      {
        key: 'total',
        label: 'Total',
        tone: 'total',
        cells: {
          ...taxFooter('sales', dto.totals.sales, cess),
          ...taxFooter('creditNote', dto.totals.cn, cess),
          ...taxFooter('net', dto.totals.net, cess),
          ...taxFooter('outTax', dto.totals.asPer3B, cess),
          ...diffCells('diff', dto.totals.diff, cess, tol),
        },
      },
      {
        key: 'pl',
        label: (
          <FooterLabel soft title="Tax of PL-OUTPUT Part A (Sales step), head by head — the sheet's I22:K22 = 'PL-OUTPUT'!E33:G33">
            As per P&amp;L
          </FooterLabel>
        ),
        tone: 'total',
        cells: soft(taxFooter('net', dto.asPerPl, cess)),
      },
      {
        key: 'plDiff',
        label: footerStatusLabel(
          <FooterLabel soft title="As per P&L − Net sales total (the sheet's I24:K24 'DIFF WITH REASON?') — the annual check, P&L (PL-OUTPUT Part A) vs Duties & Taxes net">
            P&amp;L − D&amp;T
          </FooterLabel>,
          'dto.pl',
        ),
        tone: 'total',
        cells: diffCells('net', dto.plDiff, cess, tol),
      },
    ],
    [dto, cess, tol],
  );

  return (
    <>
      <SectionCard
        title="Output tax by month"
        description="Sales and credit notes from the output tax ledgers, against the as-filed GSTR-3B."
        excelRef="DUTIES & TAXES-OUTPUT B6:Q24"
        actions={
          <span className="inline-flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Annual check — P&amp;L vs Duties &amp; Taxes net:</span>
            <JustifyControl lineKey="dto.pl" />
          </span>
        }
      >
        <PortalNote what={WHAT_3B} missingKey="dto.no3b" />
        <SheetGrid<DtoRow>
          label="Output tax by month"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowsChange={onRowsChange}
          readOnly={readOnly}
          footer={footer}
          maxHeight={gridMaxHeight}
        />
        {!readOnly && (recon || cess) && (
          <p className="text-[11px] text-muted-foreground">
            {recon
              ? 'Books vs 3B view: the Sales and Credit note columns are hidden — switch to All columns to enter them or to paste whole sheet rows (C:Q).'
              : 'Cess columns are shown — the firm’s sheet has none, so hide cess before pasting whole sheet rows (C:Q).'}
          </p>
        )}
        <Note tone="position">
          Difference = Books − 3B, per head. A month needs a reason when any head is off by more than ₹{tol} (per-client tolerance; the
          workbook has none — its note reads “if there is any diff, write proper justification”). Click a month’s status (beside the month) to
          write it.
        </Note>
      </SectionCard>

      <SectionCard
        title="Other adjustments in Cr side"
        description="Credits to the output tax ledgers that are not a month's sales or credit note."
        excelRef="DUTIES & TAXES-OUTPUT B22:E30"
      >
        <AdjustmentsGrid
          docKey="duties_output"
          label="Other adjustments in Cr side"
          cess={cess}
          emptyText="No other Cr-side adjustments."
          totals={[
            { key: 'total', label: 'Total', value: dto.adjustments },
            {
              key: 'crSide',
              label: <FooterLabel title="Sales total + other adjustments (the sheet's C30 = C20 + C28)">Total Cr side</FooterLabel>,
              value: dto.totalCrSide,
              note: 'Sales total + adjustments',
            },
          ]}
        />
      </SectionCard>
    </>
  );
};

export default OutputTab;
