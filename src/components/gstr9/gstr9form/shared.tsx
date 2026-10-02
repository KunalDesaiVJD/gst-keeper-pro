import React from 'react';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import type { StepKey } from '@/lib/gstr9/engine';
import type { PortalMeta, TaxIn } from '@/lib/gstr9/types';
import { SheetGrid } from '../grid/SheetGrid';
import { JustifyControl, SourceChip } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { particularsCol, PIN_LAST_ROW, STEP_LABEL, taxInF, withTaxInF } from './helpers';
import { FixedRowDef, TaxInRow, taxInFormCols, useFixedRows, useGoStep } from './hooks';

// ---------------------------------------------------------------------------
// Source chips and step links
// ---------------------------------------------------------------------------

export type SrcKind = 'portal' | 'as_filed_3b' | 'books' | 'typed' | 'computed' | 'none' | 'unused';

const SRC_LABEL: Record<Exclude<SrcKind, 'portal' | 'as_filed_3b'>, string> = {
  books: 'Books',
  typed: 'Typed',
  computed: 'Computed',
  none: 'Not fetched',
  unused: 'Not used',
};

/**
 * Where a figure on the form comes from: Portal (GSTR-9 system-computed),
 * As-filed 3B, Books (a data step), Typed, or Computed.
 */
export const Src: React.FC<{ kind: SrcKind; meta?: PortalMeta | null; manual?: boolean; title?: string; children?: React.ReactNode }> = ({
  kind,
  meta,
  manual,
  title,
  children,
}) => {
  if (kind === 'portal') {
    if (manual || meta?.source === 'manual') {
      return (
        <span title={title ?? 'Portal figure typed by hand on the Portal data step'}>
          <SourceChip manual />
        </span>
      );
    }
    return <SourceChip meta={meta} />;
  }
  if (kind === 'as_filed_3b') {
    if (manual) return <SourceChip manual />;
    return (
      <span title={title}>
        <SourceChip meta={{ source: 'as_filed_3b' }} />
      </span>
    );
  }
  return (
    <Badge
      variant={kind === 'typed' ? 'secondary' : 'outline'}
      title={title}
      className={cn(
        'whitespace-nowrap text-[10px] font-normal',
        kind === 'books' && 'border-primary/40 text-foreground',
        (kind === 'computed' || kind === 'none' || kind === 'unused') && 'text-muted-foreground',
      )}
    >
      {children ?? SRC_LABEL[kind]}
    </Badge>
  );
};

/** A small link that opens another step (keeps the client in the URL). */
export const StepLink: React.FC<{ step: StepKey; children?: React.ReactNode; className?: string }> = ({ step, children, className }) => {
  const go = useGoStep();
  return (
    <button
      type="button"
      onClick={() => go(step)}
      className={cn(
        'inline-flex items-center gap-0.5 whitespace-nowrap rounded text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {children ?? STEP_LABEL[step] ?? step}
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </button>
  );
};

/** Source chip + optional link to the step the figure is edited in. */
export const RowSrc: React.FC<{ src: React.ReactNode; step?: StepKey; link?: React.ReactNode }> = ({ src, step, link }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {src}
    {step && <StepLink step={step}>{link}</StepLink>}
  </span>
);

/**
 * "Use computed" reset for a nullable override (hidden when nothing is typed,
 * and for anyone but the superadmin — every such figure comes from a source, sourceLock.ts).
 */
export const ResetButton: React.FC<{ show: boolean; onClick: () => void; children: React.ReactNode }> = ({ show, onClick, children }) => {
  const { canEditSource } = useWorkspace();
  if (!show || !canEditSource) return null;
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      <RotateCcw className="mr-1 h-3.5 w-3.5" /> {children}
    </Button>
  );
};

// ---------------------------------------------------------------------------
// Typed rows (TaxIn) of the form, in the form's column order
// ---------------------------------------------------------------------------

export const TaxEntryGrid: React.FC<{ defs: FixedRowDef<TaxIn | null>[]; label: string; className?: string }> = ({ defs, label, className }) => {
  const { rows, onRowsChange, readOnly } = useFixedRows<TaxIn | null>(defs, { fromValue: taxInF, toValue: withTaxInF });
  const columns = [particularsCol<TaxInRow>('Typed here', 260), ...taxInFormCols()];
  return (
    <SheetGrid<TaxInRow>
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowsChange={onRowsChange}
      readOnly={readOnly}
      label={label}
      className={className}
    />
  );
};

/** Sub-heading above an entry grid inside a SectionCard. */
export const EntryHeading: React.FC<{ children: React.ReactNode; actions?: React.ReactNode }> = ({ children, actions }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>
    {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// A MatrixTable-like table with free columns (Table 5 with its portal side column)
// ---------------------------------------------------------------------------

export interface FormTableCol<R> {
  key: string;
  header: React.ReactNode;
  group?: string;
  cell: (row: R) => React.ReactNode;
  /** Shade the cell as not applicable. */
  na?: (row: R) => boolean;
  className?: string;
}

export interface FormTableRow {
  key: string;
  code?: React.ReactNode;
  label: React.ReactNode;
  note?: React.ReactNode;
  total?: boolean;
  indent?: boolean;
  /** Difference line key — shows its JustifyControl in a trailing Status column. */
  diffKey?: string;
}

export function FormTable<R extends FormTableRow>({
  rows,
  cols,
  label,
  className,
  maxHeight,
}: {
  rows: R[];
  cols: FormTableCol<R>[];
  label: string;
  className?: string;
  /** Scroll inside the table beyond this height (any CSS length); the header stays pinned. */
  maxHeight?: string;
}) {
  const groups: Array<{ label: string; span: number }> = [];
  cols.forEach((c) => {
    const g = c.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.label === g) last.span += 1;
    else groups.push({ label: g, span: 1 });
  });
  const hasGroups = cols.some((c) => c.group);
  const hasStatus = rows.some((r) => r.diffKey);
  return (
    <div className={cn('overflow-x-auto rounded-md border', maxHeight && cn('overflow-y-auto', PIN_LAST_ROW), className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-xs" aria-label={label}>
        <thead className="sticky top-0 z-10 bg-muted">
          {hasGroups && (
            <tr>
              <th colSpan={2} className="border-b border-r" />
              {groups.map((g, i) => (
                <th key={i} colSpan={g.span} className="border-b border-r px-2 py-1 text-center font-semibold text-muted-foreground">
                  {g.label}
                </th>
              ))}
              {hasStatus && <th className="border-b" />}
            </tr>
          )}
          <tr>
            <th className="w-14 border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">No.</th>
            <th className="min-w-[15rem] border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">Particulars</th>
            {cols.map((c) => (
              <th key={c.key} className="border-b border-r px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap">
                {c.header}
              </th>
            ))}
            {hasStatus && <th className="w-32 border-b px-2 py-1.5 text-right font-semibold text-muted-foreground">Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn(r.total && 'bg-muted/40 font-semibold')}>
              <td className="border-b border-r px-2 py-1.5 align-top text-muted-foreground">{r.code}</td>
              <td className={cn('border-b border-r px-2 py-1.5 align-top', r.indent && 'pl-6')}>
                <span>{r.label}</span>
                {r.note && <span className="ml-2 inline-flex align-middle">{r.note}</span>}
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={cn('border-b border-r px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap', c.na?.(r) && 'bg-muted/30', c.className)}
                >
                  {c.na?.(r) ? null : c.cell(r)}
                </td>
              ))}
              {hasStatus && <td className="border-b px-2 py-1 text-right align-top">{r.diffKey ? <JustifyControl lineKey={r.diffKey} /> : null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
