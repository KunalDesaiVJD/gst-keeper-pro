import React from 'react';
import { Button } from '@/components/ui/button';
import { num, totalTax } from '@/lib/gstr9/engine';
import { FY_MONTHS, type Formulas, type MonthKey, type RcmCell } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { displayCol, moneyCol, taxFooter } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { categoryHeader, cellOf, monthLabel, RCM_GRID_MAX_HEIGHT, TAX_HEAD_LABEL, TAX_HEADS, useRcmTab } from './rcmShared';

/** One month of the Part B matrix: the taxable value typed for each category (by category id). */
interface PartBRow {
  id: MonthKey;
  taxable: Record<string, number>;
  /** "=a+b" expressions, keyed by the category column key ("cat:<id>"). */
  f: Formulas;
}

const colKey = (catId: string) => `cat:${catId}`;
const COMPUTED = 'Part B · computed';
const TYPED = 'Taxable value as per books — type here';

/**
 * PART B — AS PER BOOKS. A month × expense matrix: staff type (or paste) the
 * taxable value of each RCM expense per month; the tax and the Part B totals
 * are the engine's (RCM rows 28–41).
 */
const RcmPartBCard: React.FC = () => {
  const { docs, workings, update, readOnly, financialYear } = useWorkspace();
  const cats = docs.rcm.categories;
  const W = workings.rcm;
  const [, setTab] = useRcmTab(cats.length > 0);

  // Cess is rare on RCM (the sheet has no column for it): show it only once a figure exists.
  const withCess = FY_MONTHS.some((m) => Math.abs(W.partBMonths[m].x) > 0.004);

  const rows: PartBRow[] = FY_MONTHS.map((m) => {
    const taxable: Record<string, number> = {};
    const f: Formulas = {};
    cats.forEach((c) => {
      const cell = cellOf(c, m);
      taxable[c.id] = num(cell.taxable);
      if (cell.f?.taxable) f[colKey(c.id)] = cell.f.taxable;
    });
    return { id: m, taxable, f };
  });

  const onRowsChange = (next: PartBRow[]) =>
    update('rcm', (d) => ({
      ...d,
      categories: d.categories.map((cat) => {
        let months: Record<MonthKey, RcmCell> | null = null;
        for (const r of next) {
          const t = r.taxable[cat.id];
          if (t === undefined) continue; // expense added after this row was built
          const cell = cellOf(cat, r.id);
          const fx = r.f?.[colKey(cat.id)];
          if (num(cell.taxable) === t && (cell.f?.taxable || undefined) === (fx || undefined)) continue;
          const f: Formulas = { ...(cell.f || {}) };
          if (fx) f.taxable = fx;
          else delete f.taxable;
          // Keep any tax typed over the computed figure — only the taxable value changes here.
          const nextCell: RcmCell = { ...cell, taxable: t };
          if (Object.keys(f).length) nextCell.f = f;
          else delete nextCell.f;
          months = { ...(months ?? cat.months ?? {}), [r.id]: nextCell } as Record<MonthKey, RcmCell>;
        }
        return months ? { ...cat, months } : cat;
      }),
    }));

  const columns: GridColumn<PartBRow>[] = [
    { key: 'month', header: 'Month', type: 'display', align: 'left', sticky: true, width: 92, value: (r) => monthLabel(r.id, financialYear) },
    ...cats.map((c) =>
      moneyCol<PartBRow>(
        colKey(c.id),
        categoryHeader(c),
        // Blank, like an empty Excel cell, until something is typed.
        (r) => r.taxable[c.id] || null,
        (r, v) => ({ ...r, taxable: { ...r.taxable, [c.id]: v ?? 0 } }),
        {
          group: TYPED,
          width: 130,
          title: (r) => {
            const tx = W.categories[c.id]?.months[r.id];
            return tx ? `Tax ${fmtMoney(totalTax(tx))} (IGST ${fmtMoney(tx.i)} · CGST ${fmtMoney(tx.c)} · SGST ${fmtMoney(tx.s)})` : undefined;
          },
        },
      ),
    ),
    displayCol<PartBRow>('b.t', 'Value', (r) => W.partBMonths[r.id].t, { group: COMPUTED, width: 120 }),
    ...TAX_HEADS.filter((h) => h !== 'x' || withCess).map((h) =>
      displayCol<PartBRow>(`b.${h}`, TAX_HEAD_LABEL[h], (r) => W.partBMonths[r.id][h], { group: COMPUTED, width: 104 }),
    ),
  ];

  const footerCells: Record<string, number> = { 'b.t': W.partB.t, ...taxFooter('b', W.partB, withCess) };
  cats.forEach((c) => { footerCells[colKey(c.id)] = W.categories[c.id]?.total.t ?? 0; });

  return (
    <SectionCard
      title="Part B — as per books"
      description="Type or paste each expense’s taxable value month by month (a column copied from the sheet’s D52:D63 pastes straight in). Tax is computed from the rate; override it per month in Tax by expense, below."
      excelRef="RCM rows 26–41 (D28:G41)"
    >
      {cats.length === 0 ? (
        <Note>
          Add an RCM expense on the{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setTab('expenses')}>
            Expenses &amp; flows
          </Button>{' '}
          tab to start entering Part B.
        </Note>
      ) : (
        <SheetGrid<PartBRow>
          label="RCM Part B — taxable value by expense and month"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowsChange={onRowsChange}
          readOnly={readOnly}
          maxHeight={RCM_GRID_MAX_HEIGHT}
          footer={[{ key: 'total', label: 'Total', tone: 'total', cells: footerCells }]}
        />
      )}
      <Note tone="position">
        Part B adds <strong>every</strong> expense block. The sheet’s taxable total (D28:D39 = D52+D71) adds only the first two blocks while
        its tax columns add all four, which understated Part B’s value; the full total flows to PL-INPUT row 77, GSTR-9C row P, GSTR 9-INPUT
        row 13 and Annexure-1 row D.
      </Note>
    </SectionCard>
  );
};

export default RcmPartBCard;
