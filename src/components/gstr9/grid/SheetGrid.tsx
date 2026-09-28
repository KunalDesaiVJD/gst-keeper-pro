import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { fmtMoney, fmtRate, parseClipboard, parseEntry } from './money';

/**
 * The spreadsheet grid every Annual Return entry surface uses.
 *
 * Behaves like the firm's Excel working:
 *  - click a cell (or arrow to it) and just type — typing replaces, F2/Enter edits;
 *  - Enter commits and moves down, Tab / Shift+Tab move across, Esc cancels;
 *  - "=140758-41040" style expressions are evaluated and remembered;
 *  - paste a block copied from Excel: it fills from the active cell across the
 *    editable columns (calculated columns are skipped) and adds rows as needed;
 *  - Delete clears a cell; calculated cells are shaded and can't be edited;
 *  - a cell can show a muted "placeholder" value (SGST mirroring CGST, tax
 *    computed from the rate) until something is typed over it.
 */

export type CellTone = 'error' | 'warn' | 'ok' | 'muted' | undefined;

export interface CellEdit {
  /** Parsed number (money/percent), or null when cleared. */
  num: number | null;
  /** The "=…" expression, when one was typed. */
  formula?: string;
  /** Raw text (text / select columns). */
  text: string;
}

export interface GridColumn<R> {
  key: string;
  header: React.ReactNode;
  /** Optional group label; adjacent columns with the same group share a top header cell. */
  group?: string;
  type: 'text' | 'money' | 'percent' | 'select' | 'display';
  /** The stored value (null = empty; for money, a placeholder may show instead). */
  value: (row: R, index: number) => string | number | null | undefined;
  /** Returns the updated row. Omit for read-only columns. */
  onEdit?: (row: R, edit: CellEdit) => R;
  editable?: (row: R) => boolean;
  options?: Array<{ value: string; label: string }>;
  /** Label of the empty choice in a select column (default "—"). */
  blankLabel?: string;
  /** Muted value shown when `value` is null (mirrors / computed defaults). */
  placeholder?: (row: R) => number | string | null | undefined;
  /** Expression to show while editing. */
  formula?: (row: R) => string | undefined;
  /** Custom renderer for display columns. */
  render?: (row: R, index: number) => React.ReactNode;
  tone?: (row: R) => CellTone;
  title?: (row: R) => string | undefined;
  width?: number;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

export interface GridFooterRow {
  key: string;
  label: React.ReactNode;
  /** Values keyed by column key (numbers are formatted as money). */
  cells: Record<string, React.ReactNode | number | null | undefined>;
  tone?: 'total' | 'diff' | 'muted';
}

export interface SheetGridProps<R> {
  rows: R[];
  columns: GridColumn<R>[];
  getRowId: (row: R) => string;
  onRowsChange?: (rows: R[]) => void;
  readOnly?: boolean;
  /** Enables "Add row" and lets paste extend the grid. */
  newRow?: () => R;
  canDelete?: boolean;
  addLabel?: string;
  footer?: GridFooterRow[];
  emptyText?: React.ReactNode;
  rowTone?: (row: R) => 'muted' | 'warn' | 'error' | undefined;
  /** Accessible name for the grid. */
  label: string;
  className?: string;
  maxHeight?: number;
}

type Pos = { r: number; c: number };

const isEditableCol = <R,>(col: GridColumn<R>, row: R | undefined, readOnly?: boolean) =>
  !readOnly && col.type !== 'display' && !!col.onEdit && (!row || !col.editable || col.editable(row));

export function SheetGrid<R>({
  rows,
  columns,
  getRowId,
  onRowsChange,
  readOnly,
  newRow,
  canDelete,
  addLabel = 'Add row',
  footer,
  emptyText,
  rowTone,
  label,
  className,
  maxHeight,
}: SheetGridProps<R>) {
  const [active, setActive] = useState<Pos | null>(null);
  const [editing, setEditingState] = useState<{ pos: Pos; draft: string } | null>(null);
  // Mirror of `editing` read synchronously by commit(), so an input that blurs
  // while unmounting after Enter/Tab can't commit the same edit twice.
  const editingRef = useRef<{ pos: Pos; draft: string } | null>(null);
  const setEditing = useCallback((v: { pos: Pos; draft: string } | null) => {
    editingRef.current = v;
    setEditingState(v);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  const hasGroups = columns.some((c) => c.group);
  const editableColIdx = useMemo(() => columns.map((c, i) => (c.type !== 'display' && c.onEdit ? i : -1)).filter((i) => i >= 0), [columns]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }
  }, [editing]);

  const cellText = useCallback((row: R, col: GridColumn<R>, i: number): string => {
    const v = col.value(row, i);
    if (v === null || v === undefined || v === '') return '';
    if (col.type === 'money') return typeof v === 'number' ? fmtMoney(v) : String(v);
    if (col.type === 'percent') return typeof v === 'number' ? fmtRate(v) : String(v);
    if (col.type === 'select') return col.options?.find((o) => o.value === v)?.label ?? String(v);
    return String(v);
  }, []);

  const editText = useCallback((row: R, col: GridColumn<R>, i: number): string => {
    const f = col.formula?.(row);
    if (f) return f;
    const v = col.value(row, i);
    if (v === null || v === undefined) return '';
    return String(v);
  }, []);

  const applyEdit = useCallback((pos: Pos, raw: string): boolean => {
    const row = rows[pos.r];
    const col = columns[pos.c];
    if (!row || !col?.onEdit || !onRowsChange) return true;
    let edit: CellEdit;
    if (col.type === 'money' || col.type === 'percent') {
      const p = parseEntry(raw);
      if (p.error) { setError(p.error); return false; }
      let num = p.value;
      if (col.type === 'percent' && num !== null && !raw.trim().startsWith('=') && raw.includes('%')) num = num * 100;
      edit = { num, formula: p.formula, text: raw };
    } else if (col.type === 'select') {
      const hit = col.options?.find((o) => o.value === raw || o.label.toLowerCase() === raw.trim().toLowerCase());
      if (!hit && raw.trim()) { setError(`"${raw}" is not one of the choices`); return false; }
      edit = { num: null, text: hit ? hit.value : '' };
    } else {
      edit = { num: null, text: raw };
    }
    setError(null);
    const next = rows.slice();
    next[pos.r] = col.onEdit(row, edit);
    onRowsChange(next);
    return true;
  }, [rows, columns, onRowsChange]);

  const move = useCallback((pos: Pos, dr: number, dc: number): Pos => {
    const r = Math.max(0, Math.min(rows.length - 1, pos.r + dr));
    const c = Math.max(0, Math.min(columns.length - 1, pos.c + dc));
    return { r, c };
  }, [rows.length, columns.length]);

  const nextEditable = useCallback((pos: Pos, dir: 1 | -1): Pos => {
    let { r, c } = pos;
    for (let guard = 0; guard < rows.length * columns.length + 1; guard++) {
      c += dir;
      if (c >= columns.length) { c = 0; r += 1; }
      if (c < 0) { c = columns.length - 1; r -= 1; }
      if (r < 0 || r >= rows.length) return pos;
      if (isEditableCol(columns[c], rows[r], readOnly)) return { r, c };
    }
    return pos;
  }, [rows, columns, readOnly]);

  const startEdit = useCallback((pos: Pos, initial?: string) => {
    const row = rows[pos.r];
    const col = columns[pos.c];
    if (!row || !isEditableCol(col, row, readOnly)) return;
    setEditing({ pos, draft: initial ?? editText(row, col, pos.r) });
  }, [rows, columns, readOnly, editText, setEditing]);

  const commit = useCallback((advance: 'down' | 'right' | 'left' | 'none') => {
    const cur = editingRef.current;
    if (!cur) return;
    const ok = applyEdit(cur.pos, cur.draft);
    if (!ok) return;
    const pos = cur.pos;
    setEditing(null);
    const nextPos = advance === 'down' ? move(pos, 1, 0) : advance === 'right' ? nextEditable(pos, 1) : advance === 'left' ? nextEditable(pos, -1) : pos;
    setActive(nextPos);
    requestAnimationFrame(() => wrapRef.current?.focus());
  }, [applyEdit, move, nextEditable, setEditing]);

  const clearCell = useCallback((pos: Pos) => {
    const col = columns[pos.c];
    if (!isEditableCol(col, rows[pos.r], readOnly)) return;
    applyEdit(pos, '');
  }, [columns, rows, readOnly, applyEdit]);

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !active) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); setActive(move(active, 1, 0)); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(move(active, -1, 0)); }
    else if (k === 'ArrowRight') { e.preventDefault(); setActive(move(active, 0, 1)); }
    else if (k === 'ArrowLeft') { e.preventDefault(); setActive(move(active, 0, -1)); }
    else if (k === 'Tab') { e.preventDefault(); setActive(nextEditable(active, e.shiftKey ? -1 : 1)); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(active); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearCell(active); }
    else if (k === 'Escape') { setActive(null); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'c') {
      const row = rows[active.r];
      const col = columns[active.c];
      if (row && col) {
        const v = col.value(row, active.r);
        void navigator.clipboard?.writeText(v === null || v === undefined ? '' : String(v));
      }
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const col = columns[active.c];
      if (col.type === 'select') { e.preventDefault(); startEdit(active); return; }
      e.preventDefault();
      startEdit(active, k);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (readOnly || !onRowsChange || editing) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const block = parseClipboard(text);
    if (!block.length) return;
    const start = active ?? { r: 0, c: editableColIdx[0] ?? 0 };
    const startEditable = editableColIdx.findIndex((i) => i >= start.c);
    if (startEditable < 0) return;
    const next = rows.slice();
    const errors: string[] = [];
    block.forEach((cells, dr) => {
      const r = start.r + dr;
      if (r >= next.length) {
        if (!newRow) return;
        next.push(newRow());
      }
      cells.forEach((raw, dc) => {
        const ci = editableColIdx[startEditable + dc];
        if (ci === undefined) return;
        const col = columns[ci];
        const row = next[r];
        if (!col.onEdit || (col.editable && !col.editable(row))) return;
        const v = raw.trim();
        if (col.type === 'money' || col.type === 'percent') {
          const p = parseEntry(v);
          if (p.error) { errors.push(`row ${r + 1}, ${typeof col.header === 'string' ? col.header : col.key}: ${p.error}`); return; }
          let num = p.value;
          if (col.type === 'percent' && num !== null && v.includes('%') && !v.startsWith('=')) num = num * 100;
          next[r] = col.onEdit(row, { num, formula: p.formula, text: v });
        } else if (col.type === 'select') {
          const hit = col.options?.find((o) => o.value === v || o.label.toLowerCase() === v.toLowerCase());
          if (hit) next[r] = col.onEdit(row, { num: null, text: hit.value });
          else if (v) errors.push(`row ${r + 1}: "${v}" is not a valid choice`);
        } else {
          next[r] = col.onEdit(row, { num: null, text: v });
        }
      });
    });
    onRowsChange(next);
    toast.success(`Pasted ${block.length} row${block.length === 1 ? '' : 's'}.`);
    if (errors.length) toast.warning(`${errors.length} cell${errors.length === 1 ? '' : 's'} skipped: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`);
  };

  const deleteRow = (index: number) => {
    if (!onRowsChange) return;
    const before = rows;
    const next = rows.filter((_, i) => i !== index);
    onRowsChange(next);
    setActive(null);
    toast('Row deleted', { action: { label: 'Undo', onClick: () => onRowsChange(before) } });
  };

  const addRow = () => {
    if (!newRow || !onRowsChange) return;
    onRowsChange([...rows, newRow()]);
    const c = editableColIdx[0] ?? 0;
    setActive({ r: rows.length, c });
    requestAnimationFrame(() => wrapRef.current?.focus());
  };

  const groupSpans = useMemo(() => {
    if (!hasGroups) return [];
    const spans: Array<{ label: string; span: number }> = [];
    columns.forEach((c) => {
      const g = c.group ?? '';
      const last = spans[spans.length - 1];
      if (last && last.label === g && g) last.span += 1;
      else spans.push({ label: g, span: 1 });
    });
    return spans;
  }, [columns, hasGroups]);

  const showActions = !readOnly && canDelete;
  const alignCls = (col: GridColumn<R>) =>
    col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : col.type === 'text' || col.type === 'select' ? 'text-left' : 'text-right';

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={wrapRef}
        role="grid"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onPaste={onPaste}
        className="relative overflow-auto rounded-md border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-muted">
            {hasGroups && (
              <tr>
                {groupSpans.map((g, i) => (
                  <th key={i} colSpan={g.span} className={cn('border-b border-r px-2 py-1 text-center font-semibold text-muted-foreground', !g.label && 'border-b-0')}>
                    {g.label}
                  </th>
                ))}
                {showActions && <th className="border-b" />}
              </tr>
            )}
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn('border-b border-r px-2 py-1.5 font-semibold text-muted-foreground whitespace-nowrap', alignCls(col), col.sticky && 'sticky left-0 z-10 bg-muted')}
                  style={col.width ? { minWidth: col.width, width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
              {showActions && <th className="border-b w-8" aria-label="Row actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (showActions ? 1 : 0)} className="px-3 py-6 text-center text-muted-foreground">
                  {emptyText ?? 'Nothing entered yet.'}
                </td>
              </tr>
            )}
            {rows.map((row, r) => {
              const tone = rowTone?.(row);
              return (
                <tr key={getRowId(row)} className={cn('group', tone === 'muted' && 'text-muted-foreground', tone === 'warn' && 'bg-warning/5', tone === 'error' && 'bg-destructive/5')}>
                  {columns.map((col, c) => {
                    const isActive = active?.r === r && active?.c === c;
                    const isEditing = editing?.pos.r === r && editing?.pos.c === c;
                    const editable = isEditableCol(col, row, readOnly);
                    const cTone = col.tone?.(row);
                    const v = col.value(row, r);
                    const empty = v === null || v === undefined || v === '';
                    const ph = empty && col.placeholder ? col.placeholder(row) : null;
                    return (
                      <td
                        key={col.key}
                        role="gridcell"
                        aria-selected={isActive}
                        title={col.title?.(row)}
                        onMouseDown={(e) => {
                          if (isEditing) return;
                          e.preventDefault();
                          if (editing) commit('none');
                          setActive({ r, c });
                          wrapRef.current?.focus();
                        }}
                        onDoubleClick={() => startEdit({ r, c })}
                        className={cn(
                          'relative h-8 border-b border-r px-2 py-0 tabular-nums whitespace-nowrap',
                          alignCls(col),
                          editable ? 'bg-card cursor-cell' : 'bg-muted/40',
                          col.sticky && 'sticky left-0 z-10',
                          col.sticky && (editable ? 'bg-card' : 'bg-muted'),
                          cTone === 'error' && 'text-destructive font-medium',
                          cTone === 'warn' && 'bg-warning/15 font-medium text-foreground',
                          cTone === 'ok' && 'text-success',
                          cTone === 'muted' && 'text-muted-foreground',
                          isActive && !isEditing && 'outline outline-2 -outline-offset-2 outline-primary',
                        )}
                        style={col.width ? { minWidth: col.width, width: col.width } : undefined}
                      >
                        {isEditing ? (
                          col.type === 'select' ? (
                            <select
                              ref={(el) => { inputRef.current = el; }}
                              className="absolute inset-0 h-full w-full border-0 bg-card px-1 text-xs outline outline-2 outline-primary"
                              value={editing.draft}
                              aria-label={typeof col.header === 'string' ? col.header : col.key}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditing({ pos: { r, c }, draft: val });
                                if (applyEdit({ r, c }, val)) {
                                  setEditing(null);
                                  requestAnimationFrame(() => wrapRef.current?.focus());
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { e.preventDefault(); setEditing(null); wrapRef.current?.focus(); }
                                if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'left' : 'right'); }
                              }}
                              onBlur={() => setEditing(null)}
                            >
                              <option value="">{col.blankLabel ?? '—'}</option>
                              {col.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : (
                            <input
                              ref={(el) => { inputRef.current = el; }}
                              className={cn('absolute inset-0 h-full w-full border-0 bg-card px-2 text-xs tabular-nums outline outline-2', error ? 'outline-destructive' : 'outline-primary', alignCls(col))}
                              value={editing.draft}
                              aria-label={typeof col.header === 'string' ? col.header : col.key}
                              aria-invalid={!!error}
                              onChange={(e) => { setError(null); setEditing({ pos: { r, c }, draft: e.target.value }); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
                                else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'left' : 'right'); }
                                else if (e.key === 'Escape') { e.preventDefault(); setError(null); setEditing(null); wrapRef.current?.focus(); }
                              }}
                              onBlur={() => commit('none')}
                            />
                          )
                        ) : col.render ? (
                          col.render(row, r)
                        ) : empty && ph !== null && ph !== undefined ? (
                          <span className="italic text-muted-foreground">{typeof ph === 'number' ? (col.type === 'percent' ? fmtRate(ph) : fmtMoney(ph)) : ph}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {col.formula?.(row) && <span className="text-[9px] font-semibold text-info" aria-label="entered as a formula">fx</span>}
                            {cellText(row, col, r)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {showActions && (
                    <td className="border-b px-1 text-center">
                      <button
                        type="button"
                        aria-label="Delete row"
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        onClick={() => deleteRow(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {footer && footer.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              {footer.map((f) => (
                <tr
                  key={f.key}
                  className={cn(
                    'font-semibold',
                    f.tone === 'total' && 'bg-muted',
                    f.tone === 'diff' && 'bg-warning/10',
                    (!f.tone || f.tone === 'muted') && 'bg-muted/70 text-muted-foreground',
                  )}
                >
                  {columns.map((col, c) => {
                    const cell = c === 0 ? f.label : f.cells[col.key];
                    return (
                      <td key={col.key} className={cn('h-8 border-t border-r px-2 tabular-nums whitespace-nowrap', c === 0 ? 'text-left' : alignCls(col), col.sticky && 'sticky left-0 bg-inherit')}>
                        {typeof cell === 'number' ? fmtMoney(cell) : cell}
                      </td>
                    );
                  })}
                  {showActions && <td className="border-t" />}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('text-[11px]', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? (readOnly
            ? 'Read-only.'
            : 'Type to enter · Enter/Tab to move · =a+b works · paste a block straight from Excel (calculated columns are skipped).')}
        </p>
        {!readOnly && newRow && (
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
