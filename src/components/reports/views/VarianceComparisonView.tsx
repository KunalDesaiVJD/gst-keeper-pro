// Renders the "does A match B" report family — GSTR-3B vs GSTR-1, vs 2A/2B,
// PAN-based liability/ITC roll-ups, and similar. The one thing every report
// in this family has in common is a delta column staff actually care about
// (litigation and reconciliation runs on "is the variance zero or not"), so
// this view's whole point is surfacing that column instead of making the
// reader scan every row by eye: it's colored per-cell, summarized above the
// table before anyone scrolls, and filterable down to mismatches only — with
// the grand-total row always pinned and always visible regardless of filters,
// per the same "TOTAL row never disappears" rule the rest of the Reports Hub
// follows (see ReportPreviewDialog.tsx).
//
// The rows are drawn by the table kit (./tableKit), so every column also
// filters, sorts and groups from its header, and "Excel (filtered)" / "PDF
// (filtered)" print exactly what is shown, the mismatched variances tinted.
// "Mismatches only" is a filter on the delta column itself (a variance beyond
// plus or minus 0.50), so it shows as a chip, narrows the counts and the TOTAL,
// and is named on the export. What the delta column is, and whether the rows
// add up to the report's TOTAL or are unlike measures, is read in
// ./varianceRules.ts (checked by scripts/verify-variance-annual-views.mjs).
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { AlertTriangle, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReportTable, RowTone } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORT_STATUS_META } from '@/lib/reportRegistry';
import {
  TableKitEmpty, TableKitPager, TableKitTable, TableKitToolbar, buildModel, isSentinelCell, useTableKit,
  type ModelRow,
} from './tableKit';
import {
  MISMATCH_FILTER, MISMATCH_TOLERANCE, deltaColumn, isMismatch, isMismatchFilter, isTotalLabelRow, parsePanBanner,
  readShape, shortKpiLabels, splitSubtitle,
} from './varianceRules';

interface VarianceComparisonViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

const NOT_PULLED_ID = 'not-pulled';
const hasSentinel = (cells: (string | number)[]) => cells.some((c) => isSentinelCell(c));

// ────────────────────────────────── view ──────────────────────────────────

export const VarianceComparisonView: React.FC<VarianceComparisonViewProps> = ({ table, report }) => {
  const panInfo = useMemo(() => parsePanBanner(table.subtitle), [table.subtitle]);

  // The table as the kit reads it: its row kinds (a statement's "Total Tax" is
  // a row like the others), and the mismatched variances tinted for the export.
  const shape = useMemo(() => readShape(table), [table]);
  const { kitTable, delta } = useMemo(() => {
    const shaped: ReportTable = { ...table, rowKinds: shape.rowKinds };
    const found = deltaColumn(buildModel(shaped));
    if (!found || table.rowTones) return { kitTable: shaped, delta: found };
    const tones = shaped.rows.map((r, i): RowTone | null => (shape.rowKinds[i] === 'data' && isMismatch(r[found.col]) ? 'bad' : null));
    return { kitTable: { ...shaped, rowTones: tones, toneColumn: found.col }, delta: found };
  }, [table, shape]);

  const dataCount = shape.rowKinds.filter((k) => k === 'data').length;
  // Over several months a row is an entity's month, no longer an entity.
  const perEntity = !!panInfo && !shape.rowKinds.includes('period');
  const kit = useTableKit(kitTable, {
    resetKey: report.key,
    summable: shape.summable,
    // Grouping only where it groups something: a column whose values repeat
    // (the GSTR-3B table each GSTR-1 section feeds, a tax head across merged
    // months) and the Period of a merge. One row per group says nothing.
    groupable: (c) => c.virtual || (c.groupable && c.distinct < dataCount),
    // The delta is coloured by the view; no column is a status badge.
    statusColumn: null,
    rowNoun: perEntity ? ['entity', 'entities'] : ['row', 'rows'],
    transformExport: shortKpiLabels,
  });
  const { model, view, state } = kit;
  const dc = delta?.col ?? -1;
  const deltaName = dc >= 0 ? model.columns[dc].name : '';
  const deltaFilter = dc >= 0 ? state.filters[dc] : undefined;
  const mismatchesOnly = isMismatchFilter(deltaFilter);
  const notPulledOnly = !!state.custom?.some((c) => c.id === NOT_PULLED_ID);

  const mismatchCount = useMemo(() => (dc < 0 ? 0 : model.data.filter((r) => isMismatch(r.cells[dc])).length), [model, dc]);
  const notPulledCount = useMemo(() => model.data.filter((r) => hasSentinel(r.cells)).length, [model]);

  // The toggle and the tile set the delta column's own filter, keeping any
  // range typed beside it in the column's menu.
  const setMismatchesOnly = (on: boolean) => {
    if (dc < 0) return;
    const cur = deltaFilter?.type === 'number' ? deltaFilter : null;
    if (on) kit.setFilter(dc, { ...MISMATCH_FILTER, ...(cur ? { min: cur.min, max: cur.max } : {}) });
    else kit.setFilter(dc, cur ? { type: 'number', min: cur.min, max: cur.max } : undefined);
  };
  const setNotPulledOnly = (on: boolean) => kit.setCustomFilter(NOT_PULLED_ID, on
    ? { label: 'Not pulled from the portal yet', test: (row) => hasSentinel(row.cells) }
    : null);

  const words = delta?.wording === 'difference'
    ? { tile: 'With a difference', only: 'Differences only', what: 'a difference' }
    : { tile: 'Mismatched', only: 'Mismatches only', what: 'a mismatch' };
  const { parts, notes } = splitSubtitle(table.subtitle, model.merged, panInfo ? /^PAN:/i : null);
  const entityCount = model.data.length;

  const renderDelta = (row: ModelRow, c: number): React.ReactNode | undefined => {
    if (c !== dc) return undefined;
    const v = row.cells[c];
    if (typeof v !== 'number') return undefined;
    // Red beyond the tolerance, green for rounding within it, and a plain dash for nil.
    const tone = isMismatch(v) ? 'font-semibold text-destructive-strong' : Math.abs(v) >= 0.005 ? 'text-success-strong' : 'text-muted-foreground';
    return <span className={tone}>{kit.figure(c, v)}</span>;
  };

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <TableKitEmpty>No data in this report yet. {table.subtitle}</TableKitEmpty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <report.icon className="h-4 w-4 shrink-0 text-primary" />
          <CardTitle className="text-[15px] leading-snug">{table.title || report.title}</CardTitle>
          <Badge variant={REPORT_STATUS_META[report.status].badgeVariant} className="text-[10px] font-medium">
            {REPORT_STATUS_META[report.status].shortLabel}
          </Badge>
        </div>
        {(parts.length > 0 || panInfo) && (
          // A div, not CardDescription's <p>: the PAN badges are block elements.
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {panInfo && (
              <>
                <Badge variant="outline" className="gap-1 text-[10px] font-medium">
                  <Building2 className="h-3 w-3" />
                  PAN: {panInfo.pan}
                </Badge>
                {/* The subtitle states the GSTIN count when it has one; the badge stands in when it does not. */}
                {panInfo.declaredEntityCount === null && (
                  <Badge variant="secondary" className="text-[10px] font-medium">
                    {entityCount} {entityCount === 1 ? 'entity' : 'entities'}
                  </Badge>
                )}
              </>
            )}
            {parts.map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {(i > 0 || panInfo) && <span className="text-muted-foreground/40">•</span>}
                {part}
              </span>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          <p className="mt-1 max-w-[1100px] text-[11px] leading-snug text-muted-foreground">{notes.join(' ')}</p>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3">
        {/* Before anyone scrolls: how many rows, how many differ, and each side's TOTAL (of what is shown, once filtered). */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          <TileButton active={!view.filtered} onClick={kit.clearAll} title={`Show every ${kit.rowNoun[0]}`}>
            <KpiTile
              label={perEntity ? 'Entities' : 'Rows'}
              value={model.data.length.toLocaleString('en-IN')}
              hint={view.filtered ? `${view.rows.length.toLocaleString('en-IN')} shown` : model.merged ? `${model.periods.length} periods` : model.grandTotal ? 'plus the total row' : undefined}
            />
          </TileButton>
          {delta && (
            <TileButton active={mismatchesOnly} onClick={() => setMismatchesOnly(!mismatchesOnly)} title={mismatchesOnly ? `Show every ${kit.rowNoun[0]}` : `Show the ${kit.rowNoun[1]} with ${words.what} only`}>
              <KpiTile
                label={words.tile}
                value={mismatchCount.toLocaleString('en-IN')}
                hint={`${deltaName} beyond ±${MISMATCH_TOLERANCE.toFixed(2)}`}
                tone={mismatchCount > 0 ? 'error' : 'ok'}
              />
            </TileButton>
          )}
          {notPulledCount > 0 && (
            <TileButton active={notPulledOnly} onClick={() => setNotPulledOnly(!notPulledOnly)} title={notPulledOnly ? `Show every ${kit.rowNoun[0]}` : 'Show what is not pulled yet'}>
              <KpiTile label="Not pulled" value={notPulledCount.toLocaleString('en-IN')} hint="cannot be compared yet" tone="warn" />
            </TileButton>
          )}
          {kit.totals.map((s) => {
            const v = s.shown ?? s.total;
            return (
              <KpiTile
                key={s.col}
                label={model.columns[s.col].name}
                value={kit.figure(s.col, v)}
                hint={s.shown !== null ? `of ${kit.figure(s.col, s.total)}` : undefined}
                tone={s.col === dc ? (isMismatch(v) ? 'error' : 'ok') : 'neutral'}
              />
            );
          })}
        </div>

        <TableKitToolbar
          kit={kit}
          searchPlaceholder={panInfo ? 'Search entity, GSTIN, figure…' : 'Search component, tax head, figure…'}
          left={delta && (
            <Button
              type="button"
              variant={mismatchesOnly ? 'default' : 'outline'}
              size="sm"
              aria-pressed={mismatchesOnly}
              onClick={() => setMismatchesOnly(!mismatchesOnly)}
              className={WS_BTN}
              title={`${deltaName} beyond ±${MISMATCH_TOLERANCE.toFixed(2)}: a smaller variance is rounding`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {words.only}
            </Button>
          )}
        />
        <TableKitTable
          kit={kit}
          label={table.title}
          renderCell={renderDelta}
          cellClassName={(row, c) => (c === dc && isMismatch(row.cells[c]) ? 'bg-destructive/[0.06]' : undefined)}
          // The delta stands apart from the sources it compares, heading to TOTAL.
          columnClassName={(c) => (c === dc ? 'border-l-2 border-l-foreground/20' : undefined)}
          rowClassName={(row) => cn(
            shape.statement && isTotalLabelRow(row.cells) && 'font-semibold [&>td]:bg-muted/60',
            hasSentinel(row.cells) && 'text-muted-foreground',
          ) || undefined}
          // A handful of rows: the box ends at the TOTAL rather than under an empty band.
          containerClassName="max-h-[65vh] flex-[0_1_auto] rounded-md border bg-card"
          noMatchText={mismatchesOnly ? `No ${kit.rowNoun[0]} shows ${words.what} under these filters.` : undefined}
        />
        <TableKitPager kit={kit} />
      </CardContent>
    </Card>
  );
};

const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);
