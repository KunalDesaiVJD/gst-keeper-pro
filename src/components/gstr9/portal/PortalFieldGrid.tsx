import React, { useCallback, useMemo } from 'react';
import { getPath, pnum } from '@/lib/gstr9/portalParser';
import { applyHandEdits, FieldEdit, portalFormulas } from '@/lib/gstr9/portalImport';
import { SheetGrid, GridColumn, GridFooterRow } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { useWorkspace } from '../WorkspaceContext';

/**
 * An entry grid over fixed portal figures (Table 4 rows, months, Table 9
 * heads …). Each row maps its money columns to field paths under
 * docs.portal; a cell without a path is shaded and not editable.
 *
 * Every hand edit goes through applyHandEdits(): the value is set, the path
 * is marked as typed (docs.portal.manual) and the section's source becomes
 * "Typed" if nothing had been fetched yet — so a later pull/upload never
 * overwrites it silently. Keyboard, paste from Excel and =a+b behave exactly
 * as in every other grid (SheetGrid).
 */

export interface PortalFieldCol {
  key: string;
  header: string;
  group?: string;
  width?: number;
}

export interface PortalFieldRow {
  id: string;
  code?: string;
  label: string;
  /** Column key → path under docs.portal. Missing = no such figure for this row. */
  paths: Partial<Record<string, string>>;
}

type GridRow = PortalFieldRow & { v: Record<string, number | null>; f?: Record<string, string> };

export const PortalFieldGrid: React.FC<{
  label: string;
  rows: PortalFieldRow[];
  cols: PortalFieldCol[];
  codeHeader?: string;
  labelHeader: string;
  labelWidth?: number;
  /** SGST follows CGST while the two were equal (the sheet's `=K` cells) — GSTR-9 annual figures only. */
  mirror?: { c: string; s: string };
  /** Trailing read-only column (e.g. the month's source chip). */
  extra?: { header: string; width?: number; render: (row: PortalFieldRow) => React.ReactNode };
  footer?: GridFooterRow[];
  /** Scroll inside the grid beyond this height (px or any CSS length). */
  maxHeight?: number | string;
}> = ({ label, rows, cols, codeHeader, labelHeader, labelWidth = 240, mirror, extra, footer, maxHeight }) => {
  const { docs, update, readOnly } = useWorkspace();
  const portal = docs.portal;

  const gridRows = useMemo<GridRow[]>(() => {
    const F = portalFormulas(portal);
    return rows.map((r) => ({
      ...r,
      v: Object.fromEntries(cols.map((c) => {
        const path = r.paths[c.key];
        return [c.key, path ? pnum(getPath(portal, path)) : null];
      })),
      // moneyCol keeps expressions per column key; the doc keeps them per field path.
      f: Object.fromEntries(cols.flatMap((c) => {
        const path = r.paths[c.key];
        return path && F[path] ? [[c.key, F[path]]] : [];
      })),
    }));
  }, [rows, cols, portal]);

  const columns = useMemo<GridColumn<GridRow>[]>(() => {
    const out: GridColumn<GridRow>[] = [];
    if (codeHeader) {
      out.push({ key: '_code', header: codeHeader, type: 'display', value: (r) => r.code ?? '', align: 'left', width: 52 });
    }
    out.push({
      key: '_label',
      header: labelHeader,
      type: 'display',
      value: (r) => r.label,
      align: 'left',
      width: labelWidth,
      sticky: true,
      render: (r) => <span className="block truncate" style={{ maxWidth: labelWidth }} title={r.label}>{r.label}</span>,
    });
    cols.forEach((c) => {
      out.push(
        moneyCol<GridRow>(
          c.key,
          c.header,
          (r) => r.v[c.key],
          (r, v) => ({ ...r, v: { ...r.v, [c.key]: v ?? 0 } }),
          {
            group: c.group,
            width: c.width,
            editable: (r) => !!r.paths[c.key],
            title: (r) => {
              const path = r.paths[c.key];
              if (!path) return undefined;
              return portal.manual[path] ? 'Typed by hand — a later pull or upload asks before replacing it' : undefined;
            },
          },
        ),
      );
    });
    if (extra) {
      out.push({ key: '_extra', header: extra.header, type: 'display', value: () => '', align: 'center', width: extra.width ?? 110, render: (r) => extra.render(r) });
    }
    return out;
  }, [cols, codeHeader, labelHeader, labelWidth, extra, portal.manual]);

  const onRowsChange = useCallback(
    (next: GridRow[]) => {
      const edits: FieldEdit[] = [];
      next.forEach((nr, idx) => {
        const pr = gridRows.find((r) => r.id === nr.id) ?? gridRows[idx];
        if (!pr) return;
        const changed = new Set<string>();
        cols.forEach((c) => {
          const path = nr.paths[c.key];
          if (!path) return;
          const a = nr.v[c.key] ?? 0;
          const formula = nr.f?.[c.key];
          if (Math.abs(a - (pr.v[c.key] ?? 0)) > 1e-9 || (formula ?? '') !== (pr.f?.[c.key] ?? '')) {
            edits.push({ path, value: a, formula: formula ?? null });
            changed.add(c.key);
          }
        });
        if (mirror && changed.has(mirror.c) && !changed.has(mirror.s)) {
          const sPath = nr.paths[mirror.s];
          if (sPath && Math.abs((pr.v[mirror.s] ?? 0) - (pr.v[mirror.c] ?? 0)) < 1e-9) edits.push({ path: sPath, value: nr.v[mirror.c] ?? 0, formula: null });
        }
      });
      if (edits.length) update('portal', (d) => applyHandEdits(d, edits));
    },
    [gridRows, cols, mirror, update],
  );

  return (
    <SheetGrid<GridRow>
      label={label}
      rows={gridRows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowsChange={readOnly ? undefined : onRowsChange}
      readOnly={readOnly}
      footer={footer}
      maxHeight={maxHeight}
    />
  );
};

export default PortalFieldGrid;
