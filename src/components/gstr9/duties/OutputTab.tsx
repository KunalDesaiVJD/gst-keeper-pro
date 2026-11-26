import React, { useCallback, useMemo, useState } from 'react';
import { hasRateLines, meaningfulLines, rollUpRateLines } from '@/lib/gstr9/rateWise';
import { FY_MONTHS, type DtoMonth, type DtRateLine, type Formulas, type MonthKey, type Tax, type TaxIn } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, Note, SectionCard } from '../ui';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { taxFooter } from '../grid/columns';
import AdjustmentsGrid from './AdjustmentsGrid';
import PortalNote from './PortalNote';
import RateWiseDialog, { rateWiseCol } from './RateWiseDialog';
import { FooterLabel } from './parts';
import { portal3b, salesCgOutsidePl, salesPartATotal } from '../figure/targetsData';
import {
  computedCols,
  diffCells,
  diffCols,
  footerStatusLabel,
  linkCells,
  mirroredTaxCols,
  monthCol,
  monthRowF,
  portal3bCols,
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
  /** The month's optional rate-wise breakup (Sales / Credit note are then its totals, locked in the grid). */
  rateWise: DtoMonth['rateWise'];
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

  // As per P&L's two parts: the engine adds the output tax on capital goods sold outside the P&L to Part A's tax.
  const cgOut = workings.cg.outTaxOutsidePl;
  const cgSplit = (['i', 'c', 's', 'x'] as const).some((h) => Math.abs(Number(cgOut[h]) || 0) > 0.004);
  const partATax = useMemo<Tax>(
    () => ({ i: dto.asPerPl.i - cgOut.i, c: dto.asPerPl.c - cgOut.c, s: dto.asPerPl.s - cgOut.s, x: dto.asPerPl.x - cgOut.x }),
    [dto.asPerPl, cgOut],
  );

  const rows = useMemo<DtoRow[]>(
    () =>
      FY_MONTHS.map((m) => {
        const mm = docs.duties_output.months[m];
        return {
          id: m,
          sales: mm.sales,
          creditNote: mm.creditNote,
          rateWise: mm.rateWise,
          outTax: docs.portal.months[m].outTax,
          f: monthRowF(mm.f, docs.portal, m, 'outTax'),
        };
      }),
    [docs.duties_output, docs.portal],
  );

  // Books edits go to duties_output. "As per 3B" is read-only here (Portal › As-filed 3B is its one editor).
  const onRowsChange = useCallback(
    (next: DtoRow[]) => {
      const prev = new Map(rows.map((r) => [r.id, r]));
      const books: DtoRow[] = [];
      next.forEach((r) => {
        const p = prev.get(r.id);
        if (!p || r === p) return;
        if (r.sales !== p.sales || r.creditNote !== p.creditNote || !sameF(withoutPrefix(r.f, 'outTax'), withoutPrefix(p.f, 'outTax'))) books.push(r);
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
    },
    [rows, update],
  );

  // ------------------------------------------------------------------ Rate-wise breakup
  const [rateMonth, setRateMonth] = useState<MonthKey | null>(null);
  const rateMm = rateMonth ? docs.duties_output.months[rateMonth] : null;
  const onApplyRates = useCallback(
    (lines: Record<string, DtRateLine[]>) => {
      const m = rateMonth;
      if (!m) return;
      update('duties_output', (d) => {
        const cur = d.months[m];
        let next: DtoMonth = { ...cur };
        const rw: NonNullable<DtoMonth['rateWise']> = { ...(cur.rateWise ?? {}) };
        (['sales', 'creditNote'] as const).forEach((k) => {
          const ls = meaningfulLines(lines[k]);
          if (ls.length) {
            rw[k] = ls;
            // The group is the lines' total now; any expression typed into its cells no longer applies.
            next = { ...next, [k]: rollUpRateLines(ls), f: withoutPrefix(next.f, k) };
          } else {
            // No lines: the figure stays as it is and is typed directly again.
            delete rw[k];
          }
        });
        if (Object.keys(rw).length) next.rateWise = rw;
        else delete next.rateWise;
        return { ...d, months: { ...d.months, [m]: next } };
      });
    },
    [rateMonth, update],
  );

  const columns = useMemo<GridColumn<DtoRow>[]>(
    () => [
      monthCol<DtoRow>('dto', 104),
      rateWiseCol<DtoRow>((r) => meaningfulLines(r.rateWise?.sales).length + meaningfulLines(r.rateWise?.creditNote).length, setRateMonth),
      ...(recon
        ? []
        : [
            ...mirroredTaxCols<DtoRow>((r) => r.sales, (r, t) => ({ ...r, sales: t }), {
              group: 'Sales', prefix: 'sales', cess, editable: (r) => !hasRateLines(r.rateWise?.sales),
            }),
            ...mirroredTaxCols<DtoRow>((r) => r.creditNote, (r, t) => ({ ...r, creditNote: t }), {
              group: 'Credit note', prefix: 'creditNote', cess, editable: (r) => !hasRateLines(r.rateWise?.creditNote),
            }),
          ]),
      ...computedCols<DtoRow>((r) => dto.months[r.id].net, { group: 'Net sales', prefix: 'net', cess }),
      ...portal3bCols<DtoRow>({
        field: 'outTax',
        get: (r) => r.outTax,
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
          ...linkCells(taxFooter('outTax', dto.totals.asPer3B, cess), (h) => portal3b('outTax', 'total', h)),
          ...diffCells('diff', dto.totals.diff, cess, tol),
        },
      },
      // As per P&L = Part A tax + the output tax on capital goods sold outside the P&L revenue (engine: dtoAsPerPl).
      // With no such sale the figure is Part A's alone and opens it; otherwise its two parts are shown beneath.
      ...(cgSplit
        ? [
            {
              key: 'pl',
              label: (
                <FooterLabel
                  soft
                  title="Tax of PL-OUTPUT Part A (Sales step, the sheet's I22:K22 = 'PL-OUTPUT'!E33:G33) plus the output tax on capital goods sold outside the P&L (Sales › Capital goods sold) — its two parts are the next two lines"
                >
                  As per P&amp;L
                </FooterLabel>
              ),
              tone: 'total' as const,
              cells: soft(taxFooter('net', dto.asPerPl, cess)),
            },
            {
              key: 'plPartA',
              label: (
                <FooterLabel soft title="Tax of PL-OUTPUT Part A (Sales step), head by head — the sheet's I22:K22">
                  of which Part A tax
                </FooterLabel>
              ),
              tone: 'total' as const,
              cells: linkCells(taxFooter('net', partATax, cess), (h) => salesPartATotal(h), true),
            },
            {
              key: 'plCg',
              label: (
                <FooterLabel soft title="Output tax on capital goods sold outside the P&L revenue (Sales › Capital goods sold, Annexure-5): booked in the output tax ledger, not in a Sales ledger">
                  of which capital goods sold
                </FooterLabel>
              ),
              tone: 'total' as const,
              cells: linkCells(taxFooter('net', cgOut, cess), () => salesCgOutsidePl, true),
            },
          ]
        : [
            {
              key: 'pl',
              label: (
                <FooterLabel
                  soft
                  title="Tax of PL-OUTPUT Part A (Sales step), head by head — the sheet's I22:K22 = 'PL-OUTPUT'!E33:G33. Output tax on capital goods sold outside the P&L would be added here; there is none this year."
                >
                  As per P&amp;L
                </FooterLabel>
              ),
              tone: 'total' as const,
              cells: linkCells(taxFooter('net', dto.asPerPl, cess), (h) => salesPartATotal(h), true),
            },
          ]),
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
    [dto, cess, tol, cgSplit, partATax, cgOut],
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
        <RateWiseDialog
          month={rateMonth}
          ledger="Output tax"
          sides={[
            { key: 'sales', label: 'Sales', lines: rateMm?.rateWise?.sales, current: rateMm?.sales ?? { i: 0, c: 0, s: null, x: 0 } },
            { key: 'creditNote', label: 'Credit note', lines: rateMm?.rateWise?.creditNote, current: rateMm?.creditNote ?? { i: 0, c: 0, s: null, x: 0 } },
          ]}
          cess={cess}
          readOnly={readOnly}
          onClose={() => setRateMonth(null)}
          onApply={onApplyRates}
        />
        {!readOnly && (recon || cess) && (
          <p className="text-[11px] text-muted-foreground">
            {recon
              ? 'Books vs 3B view: the Sales and Credit note columns are hidden — switch to All columns to enter them or to paste whole sheet rows (C:Q).'
              : 'Cess columns are shown — the firm’s sheet has none, so hide cess before pasting whole sheet rows (C:Q).'}
          </p>
        )}
        <Note tone="position">
          A month’s books figures can be typed directly, or entered rate by rate with its Rate-wise button: Sales and Credit note are then
          the totals of its rate lines and are changed there.
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
