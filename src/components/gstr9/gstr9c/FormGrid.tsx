import React, { useCallback, useMemo } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { diffTone } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { JustifyControl } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import type { Formulas, Gstr9cDoc } from '@/lib/gstr9/types';
import { LOCKED_TITLE } from '@/lib/gstr9/sourceLock';
import { editLine, Figures, FORM_HEAD_LABEL, FormHead, FormLine, fPath, fPaths, lineValue } from './formLines';
import { PIN_LAST_ROW } from '../gstr9form/helpers';

/**
 * Keeps clicks, keys and pastes inside a cell widget (the justification
 * popover, the reset button) away from the grid's own keyboard handling —
 * React events bubble through portals, so without this the grid would
 * swallow what is typed into the reason box.
 */
const CellIsland: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="inline-flex items-center gap-1" onMouseDown={stop} onKeyDown={stop} onPaste={stop} onDoubleClick={stop}>
      {children}
    </span>
  );
};

const StatusCell: React.FC<{ line: FormLine; readOnly: boolean; locked: boolean; onReset: () => void }> = ({ line, readOnly, locked, onReset }) => {
  if (line.diffKey) {
    return (
      <CellIsland>
        <JustifyControl lineKey={line.diffKey} />
      </CellIsland>
    );
  }
  if (line.mode === 'override') {
    if (!line.stored) {
      return (
        <Badge variant="outline" title={[line.sourceTitle, locked ? LOCKED_TITLE.filled : ''].filter(Boolean).join(' — ') || undefined} className="gap-1 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
          {locked && <Lock className="h-2.5 w-2.5" aria-label="Locked" />}
          {line.source ?? 'Computed'}
        </Badge>
      );
    }
    return (
      <CellIsland>
        <Badge variant="secondary" title={[line.sourceTitle ? `Typed over: ${line.sourceTitle}` : '', locked ? 'Typed by a superadmin — locked.' : ''].filter(Boolean).join(' ') || undefined} className="gap-1 text-[10px] font-normal">
          {locked && <Lock className="h-2.5 w-2.5" aria-label="Locked" />}
          Typed
        </Badge>
        {!readOnly && !locked && (
          <button
            type="button"
            onClick={onReset}
            aria-label={`Use computed value for ${line.code}`}
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Use computed
          </button>
        )}
      </CellIsland>
    );
  }
  if (line.source) {
    return (
      <span className="text-[10px] text-muted-foreground" title={line.sourceTitle}>
        {line.source}
      </span>
    );
  }
  return null;
};

/**
 * A fixed-row GSTR-9C table on the shared SheetGrid: row letter, particulars,
 * the figure columns in the offline utility's order, and a status column
 * (computed source / typed + reset / difference status). Italic figures are
 * computed; only a superadmin can type over one (sourceLock.ts), and Delete
 * restores it. Typed "=a+b" expressions are remembered in the 9C doc's `f`
 * and shown again on edit.
 */
export const FormGrid: React.FC<{
  label: string;
  lines: FormLine[];
  heads: FormHead[];
  headLabels?: Partial<Record<FormHead, string>>;
  footer?: GridFooterRow[];
  labelWidth?: number;
  /** Scroll inside the grid beyond this height (any CSS length). */
  maxHeight?: string;
  /** Keep the last line (the result, e.g. 5R) pinned at the bottom of the scroll box. */
  pinLast?: boolean;
}> = ({ label, lines, heads, headLabels, footer, labelWidth = 360, maxHeight, pinLast }) => {
  const { update, readOnly, canEditSource, workings, docs } = useWorkspace();
  const tol = workings.tolerance;
  const showStatus = lines.some((l) => l.mode === 'override' || !!l.diffKey || !!l.source);

  const formulas: Formulas = useMemo(() => docs.gstr9c.f || {}, [docs.gstr9c.f]);
  /** A cell's remembered expression — only while the row holds a typed figure. */
  const formulaOf = useCallback(
    (l: FormLine, h: FormHead): string | undefined => {
      const p = fPath(l, h);
      if (!p || l.mode === 'computed' || (l.mode === 'override' && !l.stored)) return undefined;
      return formulas[p] || undefined;
    },
    [formulas],
  );

  const write = useCallback(
    (changed: Array<{ line: FormLine; v: Figures | null }>) => {
      const ws = changed.filter((c) => c.line.write);
      if (!ws.length) return;
      update('gstr9c', (d) => {
        let acc: Gstr9cDoc = d;
        const f: Formulas = { ...(d.f || {}) };
        let fTouched = false;
        const drop = (p: string) => { if (p in f) { delete f[p]; fTouched = true; } };
        ws.forEach(({ line, v }) => {
          acc = line.write!(acc, v);
          if (line.mode === 'override' && v === null) {
            // Back to the computation: nothing typed remains, so neither do its expressions.
            fPaths(line).forEach(drop);
            return;
          }
          Object.entries(line.fEdits || {}).forEach(([p, expr]) => {
            if (expr) { f[p] = expr; fTouched = true; } else drop(p);
          });
        });
        return fTouched ? { ...acc, f } : acc;
      });
    },
    [update],
  );

  const columns = useMemo<GridColumn<FormLine>[]>(() => {
    const cols: GridColumn<FormLine>[] = [
      {
        key: 'label',
        header: 'Particulars',
        type: 'display',
        width: labelWidth,
        sticky: true,
        align: 'left',
        value: (l) => `${l.code} ${l.label}`,
        render: (l) => (
          <span className={cn('flex gap-2 whitespace-normal py-1 leading-snug', l.emphasis && 'font-semibold')}>
            <span className={cn('w-9 shrink-0 font-medium', l.emphasis ? 'text-foreground' : 'text-muted-foreground')}>{l.code}</span>
            <span className="min-w-0">
              {l.label}
              {l.hint && <span className="ml-1 font-normal text-muted-foreground">{l.hint}</span>}
            </span>
          </span>
        ),
      },
    ];
    heads.forEach((h) => {
      cols.push({
        key: h,
        header: headLabels?.[h] ?? FORM_HEAD_LABEL[h],
        type: 'money',
        width: 118,
        value: (l) => lineValue(l, h),
        // A typed-over (override) figure is filled in from GSTR-9, the audit report or the books: the superadmin's (sourceLock.ts).
        editable: (l) => l.mode !== 'computed' && !(l.mode === 'override' && !canEditSource) && l.heads.includes(h) && !!l.write,
        onEdit: (l, e) => {
          const p = fPath(l, h);
          return { ...l, stored: editLine(l, h, e.num), fEdits: p ? { ...(l.fEdits || {}), [p]: e.formula ?? null } : l.fEdits };
        },
        formula: (l) => formulaOf(l, h),
        tone: (l) => {
          const v = lineValue(l, h);
          if (v === null) return undefined;
          if (l.warn?.(h, v)) return 'warn';
          if (l.emphasis === 'diff') return diffTone(v, tol);
          return undefined;
        },
        title: (l) => {
          if (!l.heads.includes(h)) return undefined;
          const v = lineValue(l, h);
          const w = v === null ? null : l.warn?.(h, v);
          if (w) return w;
          if (l.mode === 'override' && !canEditSource) return `${l.stored ? 'Typed over by a superadmin' : `Computed${l.sourceTitle ? ` — ${l.sourceTitle}` : ''}`}. ${LOCKED_TITLE.filled}`;
          if (l.mode === 'override' && !l.stored) return `Computed${l.sourceTitle ? ` — ${l.sourceTitle}` : ''}. Type to override (superadmin); Delete restores it.`;
          if (l.mode === 'override') return 'Typed over the computed figure. Delete restores the computed figure for this cell.';
          return undefined;
        },
        render: (l) => {
          if (!l.heads.includes(h)) return <span className="text-muted-foreground/60">—</span>;
          const v = lineValue(l, h);
          if (l.mode === 'override' && !l.stored) return <span className="italic text-muted-foreground">{fmtMoney(v)}</span>;
          const expr = formulaOf(l, h);
          return (
            <span className={cn('inline-flex items-center gap-1', l.emphasis && 'font-semibold')} title={expr}>
              {expr && <span className="text-[9px] font-semibold text-info" aria-label="entered as a formula">fx</span>}
              {fmtMoney(v)}
            </span>
          );
        },
      });
    });
    if (showStatus) cols.push({
      key: 'status',
      header: 'Source / status',
      type: 'display',
      width: 168,
      align: 'left',
      value: () => null,
      render: (l) => <StatusCell line={l} readOnly={!!readOnly} locked={!canEditSource} onReset={() => write([{ line: l, v: null }])} />,
    });
    return cols;
  }, [heads, headLabels, labelWidth, tol, readOnly, canEditSource, write, showStatus, formulaOf]);

  const onRowsChange = useCallback(
    (next: FormLine[]) => {
      const changed: Array<{ line: FormLine; v: Figures | null }> = [];
      next.forEach((l, i) => {
        if (l === lines[i]) return;
        // Clearing a cell that already follows the computation changes nothing — don't save.
        if (l.mode === 'override' && !l.stored && !lines[i]?.stored) return;
        changed.push({ line: l, v: l.stored ?? null });
      });
      write(changed);
    },
    [lines, write],
  );

  return (
    <SheetGrid<FormLine>
      label={label}
      rows={lines}
      columns={columns}
      getRowId={(l) => l.id}
      onRowsChange={onRowsChange}
      readOnly={readOnly}
      footer={footer}
      maxHeight={maxHeight}
      className={pinLast && maxHeight ? PIN_LAST_ROW : undefined}
    />
  );
};

export default FormGrid;
