// Renders the "working paper" family of reports (Interest and Late Fee
// Calculator, Short Reversal of ITC — Section 17(2) & Rule 42): a step-by-
// step legal computation meant to be read top to bottom like a memo, to
// explain a number to a client or an officer.
//
// The report's rows are mixed on purpose: plain facts (['Return Type',
// 'GSTR-3B']), "marker" lines that restate the value columns for the part that
// follows (['Interest (Rule 88B, net of ITC set-off)', 'IGST', 'CGST', 'SGST']),
// spacer rows between the parts, and a last line that is the answer (total
// interest and late fee, the floored short reversal). This view lays them out
// as a schedule:
//   - every step is numbered in the report's order (Step 1, 2, …), and the
//     number belongs to the step, so a filtered or sorted view still shows
//     "Step 7" for the seventh step and nobody renumbers the working;
//   - each part gets a heading (a marker line becomes its part's heading);
//   - where the report puts facts, single amounts and per-head amounts in the
//     same columns (Days Late and the total interest under "IGST"), the
//     schedule gives facts a Detail column, single amounts an Amount column and
//     per-head amounts their IGST / CGST / SGST columns, so no figure sits
//     under a head it is not;
//   - the answer is the Result, set apart and pinned: no filter, search or
//     sort moves or hides it, and a filtered view says it is filtered.
// The table kit (./tableKit) adds search, the Section filter, a filter and a
// sort on every column (rows stay under their part's heading), "Non-zero rows
// only" and the "filtered" Excel / PDF. Nothing is added up: the steps of one
// computation are not addends of each other.
import React, { useMemo } from 'react';
import type { ReportTable, RowKind } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { fmtNumber } from '@/lib/reportExport/layout';
import { cn } from '@/lib/utils';
import { Equal, Filter, Inbox } from 'lucide-react';
import { TableKitPager, TableKitTable, TableKitToolbar, periodLabel, useTableKit, type ModelRow, type TableKit } from './tableKit';
import { NonZeroToggle, SectionFilter, TopDownHint } from './TopDownControls';
import { cellText, splitPeriods, type Cell, type Row, type SourceRow } from './topDownRows';

interface WorkingPaperViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

const HEAD_RE = /^(igst|cgst|sgst|utgst|cess)$/i;
const PERIOD_BAND_RE = /^— (.+) —$/;

// A "section marker" row restates the value columns as its own values (e.g.
// ['Interest (…)', 'IGST', 'CGST', 'SGST'] under headers
// ['Item','IGST','CGST','SGST']): a part's heading, not a step. A tax head's
// name counts whatever the header above it says, so the marker is still a
// heading under headers that do not name the heads (a merge shaped by a
// narrower table, such as an empty month's ['Item', 'Value']).
const isSectionMarkerRow = (row: Row, headers: string[]): boolean => {
  const values = row.slice(1);
  if (values.length < 2) return false;
  return values.every((v, i) => {
    if (typeof v !== 'string') return false;
    const header = headers[i + 1];
    return HEAD_RE.test(v.trim()) || (!!header && v.trim().toLowerCase() === header.trim().toLowerCase());
  });
};

/**
 * The parts of a known working paper, in order, by spacer block (the answer's
 * own block, when it stands alone, has none). null: the block's marker line
 * names it. Any other working paper is named by its marker lines, else by
 * each block's first and last step.
 */
const PARTS: Record<string, (string | null)[]> = {
  'interest-late-fee-calculator': ['Due date and delay', null, 'Late fee (s.47)'],
  'rule42-short-reversal': ['ITC and common credit', 'Exempt turnover ratio', 'Reversal under Rule 42'],
};

interface Schedule {
  /** The working paper as the kit reads it: Step first, a heading per part, every row's kind given. */
  table: ReportTable;
  /** The answer of each month (one for a single month), as laid out in `table`. */
  results: { period: string | null; cells: Row }[];
  /** The Detail column (facts beside the amounts), else -1. */
  detailCol: number;
}

const blankRow = (n: number): Row => Array(n).fill('');

/**
 * The working paper's columns: as wide as its widest row, never only as wide
 * as its headers (a merge may take its headers from a narrower table), each
 * named by its header or, where that is not a tax head, by the head a marker
 * line names there. A row is never cut to the headers' width.
 */
const sourceColumns = (table: ReportTable): string[] => {
  const width = Math.max(table.headers.length, ...table.rows.map((r) => r.length));
  const marker = table.rows.find((r) => isSectionMarkerRow(r, table.headers));
  return Array.from({ length: width }, (_, i) => {
    const h = table.headers[i] ?? '';
    const named = marker && i > 0 ? cellText(marker[i]) : '';
    return !HEAD_RE.test(h.trim()) && HEAD_RE.test(named) ? named : h;
  });
};

const toSchedule = (table: ReportTable, key: string): Schedule => {
  const src = sourceColumns(table);
  const heads = src.map((h, i) => (i > 0 && HEAD_RE.test(h.trim()) ? i : -1)).filter((i) => i >= 0);
  const split = heads.length >= 2;
  const DETAIL = 2;
  const AMOUNT = 3;
  const HEAD0 = 4;
  const headers = split ? ['Step', src[0] || 'Item', 'Detail', 'Amount', ...heads.map((i) => src[i])] : ['Step', ...src];
  const width = headers.length;

  // One step's cells in the schedule's columns.
  const lay = (cells: Row, step: string, label: string): Row => {
    const fix = (v: Cell): Cell => (/^days\b/i.test(label) && typeof v === 'number' && Number.isInteger(v) ? `${v} ${v === 1 ? 'day' : 'days'}` : v);
    if (!split) {
      const out = [step, label, ...cells.slice(1).map(fix)];
      while (out.length < width) out.push('');
      return out;
    }
    const out: Row = [step, label, ...blankRow(width - 2)];
    const vals = cells.slice(1).map((v, k) => ({ v: fix(v), at: k + 1 })).filter((x) => cellText(x.v) !== '');
    // "CGST" under the late fee is a CGST figure, whichever column the report put it in.
    const own = heads.findIndex((i) => src[i].trim().toLowerCase() === label.trim().toLowerCase());
    const fact = (v: Cell) => { out[DETAIL] = cellText(out[DETAIL]) ? `${out[DETAIL]}; ${v}` : v; };
    if (vals.length === 1) {
      const { v } = vals[0];
      if (typeof v !== 'number') fact(v);
      else if (own >= 0) out[HEAD0 + own] = v;
      else out[AMOUNT] = v;
    } else {
      for (const x of vals) {
        const h = heads.indexOf(x.at);
        if (typeof x.v !== 'number') fact(x.v);
        else out[h >= 0 ? HEAD0 + h : AMOUNT] = x.v;
      }
    }
    return out;
  };

  const rows: Row[] = [];
  const kinds: RowKind[] = [];
  const results: Schedule['results'] = [];
  const push = (cells: Row, kind: RowKind) => { rows.push(cells); kinds.push(kind); };

  for (const block of splitPeriods(table)) {
    const period = block.band ? PERIOD_BAND_RE.exec(cellText(block.band.cells[0]))?.[1] ?? cellText(block.band.cells[0]) : null;
    if (block.band) push([block.band.cells[0], ...blankRow(width - 1)], 'period');
    // A month of a merge that could not be built says why, as its heading: it has no steps and no answer.
    const failed = block.rows.length === 1 && /^not built:/i.test(cellText(block.rows[0].cells[0]));
    if (failed) { push([cellText(block.rows[0].cells[0]), ...blankRow(width - 1)], 'section'); continue; }
    // The answer: the last line that is not a spacer.
    let last = -1;
    for (let k = block.rows.length - 1; k >= 0; k--) if (block.rows[k].kind !== 'blank') { last = k; break; }
    // The parts: the runs of lines between spacers, the answer left out.
    const parts: SourceRow[][] = [];
    let cur: SourceRow[] = [];
    block.rows.forEach((r, k) => {
      if (k === last) return;
      if (r.kind === 'blank') { if (cur.length) parts.push(cur); cur = []; return; }
      cur.push(r);
    });
    if (cur.length) parts.push(cur);

    const names = PARTS[key];
    let step = 0;
    parts.forEach((part, p) => {
      const marker = isSectionMarkerRow(part[0].cells, src) ? cellText(part[0].cells[0]) : null;
      const lines = marker !== null ? part.slice(1) : part;
      const given = names?.[p] ?? null;
      const firstLast = () => {
        const a = cellText(lines[0]?.cells[0]);
        const b = cellText(lines[lines.length - 1]?.cells[0]);
        return b && b !== a ? `${a} to ${b}` : a;
      };
      const title = given ?? marker ?? (parts.length > 1 ? firstLast() : null);
      if (p > 0) push(blankRow(width), 'blank');
      if (title) push([title, ...blankRow(width - 1)], 'section');
      for (const r of lines) {
        let label = cellText(r.cells[0]);
        // A line repeating its part's name with words beside it is the part's
        // basis ("Late Fee (s.47)": "NIL return"), not a figure of it.
        if (given && label.toLowerCase() === given.toLowerCase() && !r.cells.slice(1).some((v) => typeof v === 'number')) label = 'Basis';
        // The per-head line under a marker has no label of its own.
        if (!label && marker) label = `${marker.replace(/\s*\(.*\)\s*$/, '')} by head`;
        step += 1;
        push(lay(r.cells, String(step), label), r.kind === 'data' ? 'data' : r.kind);
      }
    });
    if (last >= 0) {
      const answer = block.rows[last];
      if (parts.length) push(blankRow(width), 'blank');
      const cells = lay(answer.cells, 'Result', cellText(answer.cells[0]));
      push(cells, 'total');
      results.push({ period, cells });
    }
  }

  return {
    table: {
      ...table,
      headers,
      headerLabels: undefined,
      rows,
      rowKinds: kinds,
      rowTones: undefined,
      columnWidths: split ? [8, 40, 34, 16, ...heads.map(() => 14)] : [8, ...src.map((_, i) => table.columnWidths?.[i] ?? 14)],
      columnGroups: undefined,
      pdfColumns: undefined,
      toneColumn: undefined,
    },
    results,
    detailCol: split ? DETAIL : -1,
  };
};

/** The kit's scrolling table box, at a page's width. */
const NARROW_CONTAINER = 'min-h-[160px] max-h-[65vh] max-w-4xl flex-[0_1_auto] rounded-md border bg-card';

const show = (v: Cell): string => (typeof v === 'number' ? (Math.abs(v) < 0.005 ? '0.00' : fmtNumber(v)) : cellText(v));

/** The answer, set apart under the steps: never filtered, sorted or hidden. */
const ResultBox: React.FC<{ kit: TableKit; schedule: Schedule; className?: string }> = ({ kit, schedule, className }) => {
  const { headers } = schedule.table;
  return (
    <div className={cn('shrink-0 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5', className)}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Equal className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">Result</span>
        {kit.view.filtered && (
          <span className="text-[11px] text-muted-foreground">
            of the whole working, every step counted: the filter above hides steps from view, it does not change this answer.
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {schedule.results.map((r, k) => (
          <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
            <span className="text-[15px] font-bold">
              {r.period && <span className="mr-2 text-[13px] font-semibold text-muted-foreground">{periodLabel(r.period)}</span>}
              {cellText(r.cells[1])}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-6">
              {r.cells.map((v, c) => (c < 2 || cellText(v) === '' ? null : (
                <span key={c} className="whitespace-nowrap text-right">
                  {headers.length > 3 && (
                    <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{headers[c]}</span>
                  )}
                  <span className="text-[15px] font-bold tabular-nums text-primary">{show(v)}</span>
                </span>
              )))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const WorkingPaperView: React.FC<WorkingPaperViewProps> = ({ table, report }) => {
  const ReportIcon = report.icon;
  const subtitleChips = table.subtitle
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const schedule = useMemo(() => toSchedule(table, report.key), [table, report.key]);
  // Group by is offered only where a step repeats (the same step in each month of a merge).
  const groupable = useMemo(() => {
    const t = schedule.table;
    const data = t.rows.filter((_, i) => t.rowKinds?.[i] === 'data');
    const label = data.map((r) => cellText(r[1]));
    return new Set(label).size < label.length ? [1] : [];
  }, [schedule]);
  const kit = useTableKit(schedule.table, {
    resetKey: report.key,
    sortWithinSections: true,
    sums: false,
    groupable,
    statusColumn: null,
    rowNoun: ['step', 'steps'],
    // A filtered working paper says so in its title, not only in its strip; the
    // band of figures would only repeat the strip's row count (nothing is added up).
    transformExport: (t) => ({ ...t, kpis: undefined, ...(kit.view.filtered ? { title: `${t.title} (filtered view)` } : {}) }),
  });

  if (table.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
          <Inbox className="h-5 w-5 opacity-60" />
          <p className="text-sm">No data available for this working paper yet.</p>
        </CardContent>
      </Card>
    );
  }

  // The Result box shows the answer of a single month; the table's pinned copy would repeat it.
  const tableKit: TableKit = kit.view.footer ? { ...kit, view: { ...kit.view, footer: null } } : kit;
  const narrow = kit.cols.length <= 3;

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 space-y-0 border-b bg-muted/40 px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <ReportIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <CardTitle className="text-[15px] leading-snug">{table.title}</CardTitle>
          {kit.view.filtered && (
            <Badge variant="warning" className="gap-1 text-[10px] font-medium">
              <Filter className="h-3 w-3" /> Filtered view: {kit.countText} shown
            </Badge>
          )}
        </div>
        {subtitleChips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {subtitleChips.map((chip, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-normal">
                {chip}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3 pt-3">
        <TableKitToolbar
          kit={kit}
          searchPlaceholder="Search the steps: item, value, amount…"
          left={<><SectionFilter kit={kit} /><NonZeroToggle kit={kit} /></>}
        />
        <TopDownHint
          kit={kit}
          totalName="Result"
          filteredNote="Step numbers are the working's own; the Result below is the answer of every step, not of the steps shown."
        />
        <TableKitTable
          kit={tableKit}
          label={table.title}
          // A long item or detail wraps at a readable width (a table cell's own max-width is not honoured).
          renderCell={(row, col) => {
            const v = row.cells[col];
            return typeof v === 'string' && v.length > 48 && !kit.isFigure(col)
              ? <span className="block max-w-[26rem] whitespace-normal">{v}</span>
              : undefined;
          }}
          cellClassName={(row: ModelRow, col: number) => cn(
            col === 0 && 'w-14 tabular-nums text-muted-foreground',
            col === 1 && 'max-w-none whitespace-normal',
            col === schedule.detailCol && 'max-w-none whitespace-normal',
            // A word among the figures ("Not entered") wraps rather than widen the column.
            typeof row.cells[col] === 'string' && kit.isFigure(col) && 'whitespace-normal',
          )}
          noMatchText="No step of this working matches these filters. The Result below is unchanged."
          // A two or three column working reads better at the width of a page than across the screen.
          containerClassName={narrow ? NARROW_CONTAINER : undefined}
        />
        <TableKitPager kit={kit} />
        <ResultBox kit={kit} schedule={schedule} className={narrow ? 'max-w-4xl' : undefined} />
      </CardContent>
    </Card>
  );
};
