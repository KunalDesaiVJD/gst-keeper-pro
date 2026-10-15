// The table kit: filter, sort, group, page and export any Reports Hub view's
// rows "from every angle", the way the document list (DocumentLineItemsView)
// does, without copying it. Import from '@/components/reports/views/tableKit'
// (or './tableKit' inside views/).
//
// HOW TO ADOPT IT IN A VIEW
//
// 1. Minimal wiring (the view draws its rows through the kit's table):
//
//      const kit = useTableKit(table, { resetKey: report.key });
//      return (
//        <Card className="flex h-full min-h-0 flex-col">
//          ...the view's own header card, KPI tiles, charts...
//          <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5">
//            <TableKitToolbar kit={kit} searchPlaceholder="Search client, GSTIN…" />
//            <TableKitTable kit={kit} />
//            <TableKitPager kit={kit} />
//          </CardContent>
//        </Card>
//      );
//
//    That alone gives a filter menu on every header (ticked values with
//    counts, "contains", figure and date ranges), sort, Group by with
//    subtotals, hidden columns, chips, a TOTAL recomputed over the rows shown,
//    pages over 500 lines, and "Excel (filtered)" / "PDF (filtered)" in the
//    house style. Check kit.table.rows.length (or render <TableKitEmpty/>) if
//    the view should hide its toolbar when the report is empty.
//
// 2. Keeping the view's own look on the kit's table:
//      <TableKitTable
//        kit={kit}
//        renderCell={(row, col) => (col === deltaCol ? <Delta v={row.cells[col]} /> : undefined)}
//        rowClassName={(row) => (selected.has(row.i) ? 'bg-primary/10' : undefined)}
//        onRowClick={(row) => openDetail(row.i)}
//        leading={[{ key: 'pick', className: 'w-8', header: <SelectAll />, cell: (row) => <Checkbox ... /> }]}
//        trailing={[{ key: 'act', header: 'Actions', cell: (row) => <EditButton id={table.rowIds?.[row.i]} /> }]}
//      />
//    renderCell returns undefined for the standard cell (links as "View",
//    "NOT PULLED" as a dashed badge, the Status column as a tone badge,
//    figures in the house style); <StandardCell kit row col /> draws it on
//    demand. row.i is the row's index in table.rows, so it indexes rowIds,
//    clientIds, rowFlags and rowTones: write-backs keep working under any
//    filter or sort.
//
// 3. A bespoke table (cards, a two-pane layout, a virtualised list): use only
//    the state and the controls, and draw the rows yourself.
//      const kit = useTableKit(table, { resetKey: report.key });
//      <TableKitToolbar kit={kit} />
//      <table><thead><tr>{kit.cols.map((c) => <TableKitHead key={c} kit={kit} col={c} />)}</tr></thead>
//        <tbody>{kit.view.rows.map((row) => <tr key={row.i}>...row.cells[c] / kit.text(row, c)...</tr>)}</tbody>
//      </table>
//    kit.view.rows are the document rows shown, in the order shown (filtered,
//    sorted, grouped); kit.view.items adds the bands, headings, groups and the
//    report's own TOTAL rows in place; kit.view.footer is the TOTAL to pin.
//
// 4. The view's own quick filters (status tiles, "Overdue", "Differences only"):
//    a tile on a column's value is a column filter, so it shows as a chip and
//    feeds the counts, the TOTAL and the export:
//      kit.setFilter(statusCol, { type: 'values', values: ['Open'] });   // or undefined to clear
//      const active = kit.state.filters[statusCol];                         // light the tile from it
//    one that is not a column's value is a custom filter:
//      kit.setCustomFilter('overdue', { label: 'Overdue', test: (row, t) => !!t.rowFlags?.[row.i]?.overdue });
//      kit.setCustomFilter('overdue', null);                                // off
//      kit.state.custom?.some((c) => c.id === 'overdue')                     // is it on?
//    KPI tiles can show "x of y" from kit.totals (shown is null until something is filtered).
//
// Options (TableKitOptions): resetKey (report.key; a different report or column
// set starts afresh, a Pull refresh keeps the choices), initialSort,
// initialGroupBy, initialHidden, groupable (indices or a test; [] for none),
// summable (a list: exactly those figure columns, [] for a statement of unlike
// measures; a test: narrows what the report sums, as a version number or a
// ledger's running balance is a figure but not a sum), pageable, pageThreshold
// (page sooner than 500 lines), pageSizes, initialPageSize, statusColumn,
// rowNoun, transformExport. TableKitTable's headClassName colours or centres
// one column's heading; columnClassName marks a whole column (a delta, a
// headline figure) from its heading to its TOTAL.
// For a report read top to bottom (a return, a working paper):
// sortWithinSections (a sort keeps rows under their section heading) and
// sums: false (the report's own TOTAL rows stand under a filter, nothing is
// added up, since its rows include their own totals or are steps of one sum).
// The rules (what a filter matches, which rows are structure, when a TOTAL is
// recomputed) are in ./tableModel.ts, tested by scripts/verify-doc-table-model.mjs.
export * from './tableModel';
export { useTableKit } from './useTableKit';
export type { ExportFormat, KitCustomFilter, KitTotal, TableKit, TableKitOptions } from './useTableKit';
export { ColumnFilter as ColumnFilterMenu, ValuesPanel } from './ColumnFilter';
export { TableKitHead, TableKitHeader, TableKitGroupRow } from './TableKitHead';
export type { KitExtraColumn, TableKitHeadProps } from './TableKitHead';
export { TableKitTable, TableKitEmpty, StandardCell } from './TableKitTable';
export type { TableKitTableProps } from './TableKitTable';
export { TableKitToolbar } from './TableKitToolbar';
export type { TableKitToolbarProps } from './TableKitToolbar';
export { TableKitPager } from './TableKitPager';
export { TONE_VARIANT, isSentinelCell, isUrlCell, kitCellClass, statusVariant } from './cellRules';
export type { BadgeVariant } from './cellRules';
