import React from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { totalTax } from '@/lib/gstr9/engine';
import type { Tax, TaxIn } from '@/lib/gstr9/types';
import { SheetGrid, type CellTone, type GridColumn, type GridFooterRow } from '../grid/SheetGrid';
import { fmtMoney } from '../grid/money';
import { HEAD_NAME, setHead, setHeadFormula, toTaxIn, type Head } from './taxRows';

/**
 * One line of a fixed-row tax table (Annexure-3, Annexure-4, the notice
 * format …). The figures always come from the engine (`value`); only the
 * cells staff type are stored.
 *
 *  - `computed`: read-only (shaded), shows `value`.
 *  - `typed`:    always typed; `stored` is the doc's TaxIn.
 *  - `override`: `stored === null` means "use the computed/suggested figure",
 *                shown muted in italics; typing over any head stores a copy of
 *                that figure with the head replaced, and "Use …" goes back to null.
 *
 * "=a+b" expressions are kept on the stored TaxIn (`f`, keyed by head) and
 * shown again on edit, like Excel.
 */
export interface FixedTaxRow {
  id: string;
  no?: React.ReactNode;
  label: React.ReactNode;
  /** Small muted line under the label. */
  hint?: React.ReactNode;
  /** "Table No." column (notice format). */
  table?: React.ReactNode;
  /** The figure the engine uses for this line (for an override row: the override, else the default). */
  value: Tax;
  kind: 'computed' | 'typed' | 'override';
  stored?: TaxIn | null;
  /** Chip text while an override row follows its default, e.g. "From Table 16B". */
  defaultChip?: string;
  /** Reset button text for an overridden row, e.g. "Use Table 16B". */
  resetLabel?: string;
  /** Override rows: the engine's default for the line (typed or not) — shown while untyped, in the chip's tooltip once typed over, and the starting point when typing. */
  defaultValue?: Tax;
  onChange?: (next: TaxIn | null) => void;
  /** Bold (sub)total line. */
  emphasis?: boolean;
  tone?: (head: Head | 'total', v: number) => CellTone;
}

/** Plain text of a label cell, for Ctrl+C. */
const textOf = (n: React.ReactNode): string | null => (typeof n === 'string' || typeof n === 'number' ? String(n) : null);

const brief = (t: Tax) => (['i', 'c', 's', 'x'] as const).map((h) => `${HEAD_NAME[h]} ${fmtMoney(t[h])}`).join(' · ');

const storedOf = (r: FixedTaxRow): TaxIn | null => (r.kind === 'computed' ? null : r.stored ?? null);

const cellValue = (r: FixedTaxRow, h: Head): number | null => {
  if (r.kind === 'computed') return r.value[h];
  const st = storedOf(r);
  if (!st) return null;
  return h === 's' ? st.s : st[h];
};

const cellPlaceholder = (r: FixedTaxRow, h: Head): number | null => {
  if (r.kind === 'computed') return null;
  const st = storedOf(r);
  if (!st) return (r.defaultValue ?? r.value)[h];
  if (h === 's' && st.s === null) return st.c;
  return null;
};

const cellFormula = (r: FixedTaxRow, h: Head): string | undefined => storedOf(r)?.f?.[h];

const editRow = (r: FixedTaxRow, h: Head, v: number | null, formula: string | undefined): FixedTaxRow => {
  const st = storedOf(r);
  if (!st) {
    // Clearing a cell that only shows the computed figure changes nothing.
    if (v === null) return r;
    // Start from the default the cell was showing (SGST keeps mirroring CGST if they were equal).
    return { ...r, stored: setHeadFormula(setHead(toTaxIn(r.defaultValue ?? r.value), h, v), h, formula) };
  }
  return { ...r, stored: setHeadFormula(setHead(st, h, v), h, v === null ? undefined : formula) };
};

const renderMoney = (r: FixedTaxRow, h: Head) => {
  const v = cellValue(r, h);
  if (v === null) {
    const ph = cellPlaceholder(r, h);
    return ph === null ? null : <span className="italic text-muted-foreground">{fmtMoney(ph)}</span>;
  }
  const fx = cellFormula(r, h);
  return (
    <span className={cn('inline-flex items-center gap-1', r.emphasis && 'font-semibold')}>
      {fx && <span className="text-[9px] font-semibold text-info" aria-label="entered as a formula">fx</span>}
      {fmtMoney(v)}
    </span>
  );
};

/**
 * Where an override line's figure comes from: the default ("From Table 16B",
 * "Suggested"), or "Typed" with a reset back to the default. The reset keeps
 * the grid from taking its click / keys so it works as a plain button.
 */
const SourceTag: React.FC<{ row: FixedTaxRow; readOnly?: boolean }> = ({ row: r, readOnly }) => {
  const chip = r.defaultChip ?? 'Computed';
  if (!storedOf(r)) {
    return <Badge variant="secondary" className="ml-1.5 whitespace-nowrap align-middle text-[10px] font-normal">{chip}</Badge>;
  }
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
      <Badge
        variant="outline"
        className="whitespace-nowrap text-[10px] font-normal"
        title={r.defaultValue ? `${chip}: ${brief(r.defaultValue)}` : undefined}
      >
        Typed
      </Badge>
      {!readOnly && r.onChange && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={() => r.onChange?.(null)}
          aria-label={`${r.resetLabel ?? 'Use computed'} for ${typeof r.label === 'string' ? r.label : `row ${r.no ?? r.id}`}`}
          title={r.defaultValue ? `${chip}: ${brief(r.defaultValue)}` : undefined}
          className="inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="h-3 w-3" /> {r.resetLabel ?? 'Use computed'}
        </button>
      )}
    </span>
  );
};

export interface FixedTaxGridProps {
  rows: FixedTaxRow[];
  /** Accessible name of the grid. */
  label: string;
  readOnly?: boolean;
  /** Column order of the tax heads (the notice format uses CGST, SGST, IGST, Cess). */
  heads?: Head[];
  headLabels?: Partial<Record<Head, string>>;
  showNo?: boolean;
  noHeader?: string;
  labelHeader?: string;
  labelWidth?: number;
  showTable?: boolean;
  tableHeader?: React.ReactNode;
  showTotal?: boolean;
  footer?: GridFooterRow[];
  className?: string;
}

/**
 * A fixed set of tax lines in a SheetGrid: typed lines are white cells with
 * the grid's keyboard, paste and `=a+b` entry, computed lines are shaded.
 */
export const FixedTaxGrid: React.FC<FixedTaxGridProps> = ({
  rows,
  label,
  readOnly,
  heads = ['i', 'c', 's', 'x'],
  headLabels,
  showNo = true,
  noHeader = 'No.',
  labelHeader = 'Particulars',
  labelWidth = 300,
  showTable,
  tableHeader = 'Table',
  showTotal = true,
  footer,
  className,
}) => {
  const columns: GridColumn<FixedTaxRow>[] = [];
  if (showNo) {
    columns.push({ key: 'no', header: noHeader, type: 'display', align: 'center', width: 52, value: (r) => textOf(r.no), render: (r) => <span className="text-muted-foreground">{r.no}</span> });
  }
  columns.push({
    key: 'label',
    header: labelHeader,
    type: 'display',
    align: 'left',
    width: labelWidth,
    value: (r) => textOf(r.label),
    render: (r) => (
      <div className="whitespace-normal py-1 leading-snug">
        <div className={cn(r.emphasis && 'font-semibold')}>
          {r.label}
          {r.kind === 'override' && <SourceTag row={r} readOnly={readOnly} />}
        </div>
        {r.hint && <div className="text-[11px] text-muted-foreground">{r.hint}</div>}
      </div>
    ),
  });
  if (showTable) {
    columns.push({
      key: 'table',
      header: tableHeader,
      type: 'display',
      align: 'center',
      width: 92,
      value: () => null,
      render: (r) => <div className="whitespace-normal py-1 leading-snug text-muted-foreground">{r.table}</div>,
    });
  }
  heads.forEach((h) => {
    columns.push({
      key: h,
      header: headLabels?.[h] ?? HEAD_NAME[h],
      type: 'money',
      width: 112,
      value: (r) => cellValue(r, h),
      placeholder: (r) => cellPlaceholder(r, h),
      editable: (r) => r.kind !== 'computed' && !!r.onChange,
      formula: (r) => cellFormula(r, h),
      onEdit: (r, e) => editRow(r, h, e.num, e.formula),
      tone: (r) => r.tone?.(h, r.value[h]),
      title: (r) => {
        if (r.kind === 'computed' || !r.onChange) return undefined;
        const st = storedOf(r);
        if (!st) return `${r.defaultChip ?? 'Computed'} — type to override`;
        if (h === 's' && st.s === null) return 'Mirrors CGST — type to override, clear to mirror again';
        return undefined;
      },
      render: (r) => renderMoney(r, h),
    });
  });
  if (showTotal) {
    columns.push({
      key: 'total',
      header: 'Total',
      type: 'display',
      width: 120,
      value: (r) => totalTax(r.value),
      tone: (r) => r.tone?.('total', totalTax(r.value)),
      render: (r) => <span className="font-semibold">{fmtMoney(totalTax(r.value))}</span>,
    });
  }
  const onRowsChange = (next: FixedTaxRow[]) => {
    next.forEach((row, i) => {
      const before = rows[i];
      if (!before || row === before || row.stored === before.stored) return;
      row.onChange?.(row.stored ?? null);
    });
  };

  return (
    <SheetGrid<FixedTaxRow>
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowsChange={onRowsChange}
      readOnly={readOnly}
      footer={footer}
      label={label}
      className={className}
    />
  );
};

export default FixedTaxGrid;
