// Bank-statement-style register for the ledger reports: the Credit Ledger
// (transaction detail), the Liability and Cash Ledgers, and the portal's two
// financial-year statements (Credit Reversal and Re-claimed, RCM Liability /
// ITC). A ledger has direction (Debit / Credit) and a running balance that the
// reader cross-checks against the portal, so on top of the table kit's filter,
// sort, group and "filtered" exports (./tableKit) this view keeps:
//   - the Debit / Credit toggle and tiles. They set a Type column filter, so
//     the choice shows as a chip and narrows the totals and the exports too;
//   - the direction tint on each entry's figures;
//   - the balance as the ledger's own figure on each row: never recomputed and
//     never added up (a sum of balances means nothing), whatever the order;
//   - the Opening and Closing Balance rows held out of reach of the search,
//     the filters and the sort: they bound the ledger, they are not entries.
//     A ledger of several months (the cash and liability ledgers: a Month
//     column, a pair of balances per month) shows each month's balances in
//     place in its own order: its opening before its first entry, its closing
//     after its last, a month with no entry shown as its two balances alone.
//     So does a merge, each period's under its band. Sorted, grouped, paged
//     or with no entry shown, they are pinned first and last instead, each
//     naming its month (or period). A filter that picks months (the Month
//     column, a merge's Period) picks their balances too;
//   - totals by direction. A TOTAL adding debits to credits would mean nothing,
//     so a ledger with a Type column totals its debits and its credits apart
//     and nets them (credit less debit, as the Credit Ledger's own NET row
//     does), over the entries shown; a statement without one totals its
//     claimed / reversed / reclaimed columns, which each run one way.
// The ledger's own order is chronological; a sort is the reader's choice and
// clearing it returns to the ledger's order.
import React, { useMemo, useRef } from 'react';
import type { ColumnGroup, ReportTable, RowKind, RowTone } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TD, WS_TR_HEADING, WS_TR_TOTAL } from '@/components/workspace/theme';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmtNumber, guessRowKind } from '@/lib/reportExport/layout';
import { cn } from '@/lib/utils';
import {
  ArrowUpCircle, ArrowDownCircle, BookText, CalendarRange, ChevronDown, ChevronRight, Inbox,
} from 'lucide-react';
import {
  BLANK, StandardCell, TableKitHeader, TableKitPager, TableKitToolbar, kitCellClass, periodLabel, useTableKit,
  type ColumnFilter, type DisplayItem, type ModelRow, type TableKit, type ViewState,
} from './tableKit';

interface LedgerRegisterViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Cell = string | number;
type Direction = 'debit' | 'credit';
type Role = 'band' | 'section' | 'blank' | 'opening' | 'closing' | 'summary' | 'entry';

/** An Opening / Closing Balance row held out of the kit and drawn in its month, or first or last. */
interface Pinned {
  /** Index in table.rows (for a closing taken from the last entry: that entry's). */
  i: number;
  /** The merge's period the row sits under ('' for one period). */
  band: string;
  /** The row's Month cell ("Apr 2026"), '' for a ledger without a Month column. */
  month: string;
  /** Its segment (index into split.segments). */
  seg: number;
  kind: 'opening' | 'closing' | 'last';
}

/**
 * A stretch of the ledger one pair of balances bounds: a month under a merge's
 * period band (or the whole ledger, for one period without a Month column).
 */
interface Segment { band: string; month: string; openings: Pinned[]; closings: Pinned[] }

/** A line of the register in its own order: one of the kit's items (by index), or a balance in its place. */
type Step = { item: number } | { pin: Pinned };

const TYPE_HEADER_RE = /^type$/i;
const DESC_HEADER_RE = /^(description|particulars|narration)$/i;
// The cash and liability ledgers' (and the credit ledger's) month of each row.
const MONTH_HEADER_RE = /^month$/i;
// The running balances: the ledger's own figure per row, never added up.
const BALANCE_HEADER_RE = /^(balance|closing\b.*|opening\b.*)$/i;
const SERIAL_HEADER_RE = /^(#|sr\.?\s*no\.?|s\.?\s?no\.?|sl\.?\s?no\.?)$/i;
// "ITC Claimed IGST": the group ("ITC Claimed") and the head ("IGST").
const HEAD_RE = /^(.+?)\s+(IGST|CGST|SGST|UTGST|Cess)$/i;
// "Opening Balance", or one naming its month: "Opening Balance (Apr 2026)".
const OPENING_RE = /^opening balance(\s*\(.*\))?$/i;
const CLOSING_RE = /^closing balance(\s*\(.*\))?$/i;
// The Credit Ledger's own closing line, "NET (Credit − Debit)".
const NET_RE = /^net(\s*\(|$)/i;
const BAND_RE = /^— (.+) —$/;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const hasText = (row: Cell[], re: RegExp): boolean => row.some((c) => typeof c === 'string' && re.test(c.trim()));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const money = (n: number): string => fmtNumber(n, 'amount');
// A nil figure (printed "–") carries no direction, so it is never tinted.
const isNil = (v: unknown): boolean => typeof v === 'number' && Math.abs(v) < 0.005;

function roleOf(row: Cell[], given: RowKind | null | undefined): Role {
  const kind = given ?? guessRowKind(row);
  if (kind === 'period') return 'band';
  if (kind === 'blank') return 'blank';
  if (kind === 'total' || kind === 'subtotal' || hasText(row, NET_RE)) return 'summary';
  if (hasText(row, OPENING_RE)) return 'opening';
  if (hasText(row, CLOSING_RE)) return 'closing';
  return kind === 'section' ? 'section' : 'entry';
}

// The figures of the entries (by direction), added up per column.
function sumFlows(rows: ModelRow[], cols: number[], pick?: (r: ModelRow) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of cols) {
    let t = 0;
    for (const r of rows) {
      if (pick && !pick(r)) continue;
      const v = r.cells[c];
      if (typeof v === 'number' && Number.isFinite(v)) t += v;
    }
    out.set(c, round2(t));
  }
  return out;
}
const sumAll = (m: Map<number, number>): number => round2([...m.values()].reduce((a, b) => a + b, 0));

// Whether a filter on the Month (or a merge's Period) column lets a month's balances show.
const picks = (f: ColumnFilter | undefined, key: string): boolean => {
  if (!f) return true;
  if (f.type === 'values') return f.values.includes(key === '' ? BLANK : key);
  if (f.type === 'contains') return key.toLowerCase().includes(f.text.trim().toLowerCase());
  return true;
};

/**
 * The kit's items in the ledger's own order, each segment's balances in
 * place: its openings before its first entry shown, its closings after its
 * last, and a segment with no entry shown its balances alone, where it falls
 * (a band's before the next band). Needs the items in the ledger's own order,
 * segments ascending (split.monotonic); `segOf` gives a data item's segment,
 * `bandStart` the first segment under a band, `visible` whether a segment's
 * balances show. Every item is kept, in its order.
 */
function placeBalances(
  items: DisplayItem[], segments: Segment[], segOf: (row: ModelRow) => number,
  bandStart: (key: string) => number, visible: (s: number) => boolean,
): Step[] {
  const out: Step[] = [];
  let at = -1;
  let open = false;
  const opening = (s: number) => { if (visible(s)) for (const p of segments[s].openings) out.push({ pin: p }); };
  const closing = (s: number) => { if (visible(s)) for (const p of segments[s].closings) out.push({ pin: p }); };
  // Closes the open segment and every one before `t` not yet drawn.
  const closeTo = (t: number) => {
    if (open) { closing(at); open = false; }
    for (let s = at + 1; s < t; s++) { opening(s); closing(s); }
    at = Math.max(at, t - 1);
  };
  items.forEach((it, k) => {
    if (it.type === 'band') {
      closeTo(bandStart(it.key));
      out.push({ item: k });
      return;
    }
    if (it.type === 'data') {
      const s = segOf(it.row);
      if (s >= 0 && !(open && s === at)) {
        closeTo(s);
        opening(s);
        at = s;
        open = true;
      }
    }
    out.push({ item: k });
  });
  closeTo(segments.length);
  return out;
}

export const LedgerRegisterView: React.FC<LedgerRegisterViewProps> = ({ table, report }) => {
  const { headers, rows } = table;
  const typeCol = useMemo(() => headers.findIndex((h) => TYPE_HEADER_RE.test(h.trim())), [headers]);
  const descCol = useMemo(() => headers.findIndex((h) => DESC_HEADER_RE.test(h.trim())), [headers]);
  const statusCol = useMemo(() => headers.findIndex((h) => /^status$/i.test(h.trim())), [headers]);
  const balanceCols = useMemo(() => headers.map((h, i) => (BALANCE_HEADER_RE.test(h.trim()) ? i : -1)).filter((i) => i >= 0), [headers]);
  const balanceCol = useMemo(() => headers.findIndex((h) => /^balance$/i.test(h.trim())), [headers]);
  const monthCol = useMemo(() => headers.findIndex((h) => MONTH_HEADER_RE.test(h.trim())), [headers]);
  const hasType = typeCol !== -1;

  // The ledger split into what the kit lists (entries, and a merge's period
  // bands) and the balances it holds out, each in its segment: its month
  // (from the Month column) under its merge band.
  const split = useMemo(() => {
    const listed: number[] = [];
    const kinds: RowKind[] = [];
    /** Per kit row (index into listed): its segment, -1 for a band or a heading. */
    const segOfListed: number[] = [];
    const segments: Segment[] = [];
    const segIndex = new Map<string, number>();
    /** Per merge band: the first segment under it. */
    const bandStart = new Map<string, number>();
    const summaries: number[] = [];
    const lastEntry = new Map<number, number>();
    // Each segment's rows together and in order, so its balances can be drawn in place.
    let monotonic = true;
    let current = -1;
    let band = '';
    const segOf = (row: Cell[]): number => {
      const month = monthCol >= 0 ? str(row[monthCol]).replace(/\s+/g, ' ') : '';
      const key = `${band}\u0001${month}`;
      let s = segIndex.get(key);
      if (s === undefined) {
        s = segments.length;
        segments.push({ band, month, openings: [], closings: [] });
        segIndex.set(key, s);
      } else if (s !== current) monotonic = false;
      current = s;
      return s;
    };
    rows.forEach((row, i) => {
      const role = roleOf(row, table.rowKinds?.[i]);
      if (role === 'blank') return;
      if (role === 'summary') { summaries.push(i); return; }
      if (role === 'opening' || role === 'closing') {
        const seg = segOf(row);
        const p: Pinned = { i, band, month: segments[seg].month, seg, kind: role };
        (role === 'opening' ? segments[seg].openings : segments[seg].closings).push(p);
        return;
      }
      if (role === 'band') {
        band = BAND_RE.exec(str(row[0]))?.[1] ?? str(row[0]);
        bandStart.set(band, segments.length);
      }
      const seg = role === 'entry' ? segOf(row) : -1;
      if (role === 'entry' && balanceCols.some((c) => typeof row[c] === 'number')) lastEntry.set(seg, i);
      listed.push(i);
      kinds.push(role === 'band' ? 'period' : role === 'section' ? 'section' : 'data');
      segOfListed.push(seg);
    });
    // A statement without Closing Balance rows closes on its last entry's balance.
    if (!segments.some((s) => s.closings.length)) {
      for (const [seg, i] of lastEntry) segments[seg].closings.push({ i, band: segments[seg].band, month: segments[seg].month, seg, kind: 'last' });
    }
    const openings = segments.flatMap((s) => s.openings);
    const closings = segments.flatMap((s) => s.closings);
    return { listed, kinds, segOfListed, segments, bandStart, monotonic, openings, closings, summaries };
  }, [rows, table.rowKinds, balanceCols, monthCol]);

  // A statement's long headers ("ITC Claimed IGST" … "Closing Cess") read as a
  // band over the heads ("ITC Claimed" over IGST, CGST, SGST, Cess), on screen
  // and in the exports.
  const heads = useMemo(() => {
    if (table.columnGroups?.length) return null;
    const parts = headers.map((h) => HEAD_RE.exec(h.trim()));
    const groups: ColumnGroup[] = [];
    for (const m of parts) {
      const label = m ? (/^closing$/i.test(m[1]) ? 'Closing balance' : m[1]) : '';
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.span += 1;
      else groups.push({ label, span: 1 });
    }
    if (!groups.some((g) => g.label && g.span > 1)) return null;
    return { columnGroups: groups, headerLabels: headers.map((h, i) => parts[i]?.[2] ?? h) };
  }, [headers, table.columnGroups]);

  // What the kit filters: the entries (their text with the portal page's line
  // breaks folded into spaces), under their period bands.
  const kitTable = useMemo<ReportTable>(() => ({
    ...table,
    rows: split.listed.map((i) => rows[i].map((c) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : c))),
    rowKinds: split.kinds,
    rowTones: table.rowTones ? split.listed.map((i) => table.rowTones?.[i] ?? null) : undefined,
    rowIds: undefined,
    clientIds: undefined,
    rowFlags: undefined,
    summary: undefined,
    extraSheets: undefined,
    ...(heads ?? {}),
  }), [table, rows, split, heads]);

  // Read by the export, which runs after this render: the kit of the moment.
  const kitRef = useRef<TableKit | null>(null);
  const kit = useTableKit(kitTable, {
    resetKey: report.key,
    rowNoun: ['entry', 'entries'],
    // A ledger with a Type column is totalled by direction here, never by the
    // kit (which would add debits to credits); a statement adds up its flows.
    summable: hasType ? [] : (c) => c.summable && !BALANCE_HEADER_RE.test(c.header.trim()),
    groupable: (c) => c.groupable && !/^reference\b/i.test(c.header.trim()),
    transformExport: (t) => (kitRef.current ? exportLedger(t, kitRef.current) : t),
  });
  kitRef.current = kit;
  const { model, view, cols } = kit;

  // The entries' own figures (never a balance or a serial number).
  const flowCols = useMemo(
    () => model.columns
      .filter((c) => !c.virtual && (c.kind === 'amount' || c.kind === 'int') && !balanceCols.includes(c.index) && !SERIAL_HEADER_RE.test(c.header.trim()))
      .map((c) => c.index),
    [model, balanceCols],
  );
  const dirOf = (r: ModelRow): Direction | null => {
    const t = str(r.cells[typeCol]).toLowerCase();
    return t === 'debit' || t === 'credit' ? t : null;
  };
  const byDir = (rs: ModelRow[], d: Direction) => sumFlows(rs, flowCols, (r) => dirOf(r) === d);
  const netOf = (dr: Map<number, number>, cr: Map<number, number>) => new Map(flowCols.map((c) => [c, round2((cr.get(c) ?? 0) - (dr.get(c) ?? 0))]));

  const shownDr = byDir(view.rows, 'debit');
  const shownCr = byDir(view.rows, 'credit');
  const allDr = byDir(model.data, 'debit');
  const allCr = byDir(model.data, 'credit');
  const shownFlows = sumFlows(view.rows, flowCols);
  const allFlows = sumFlows(model.data, flowCols);
  // Unfiltered, the Credit Ledger's own NET row is printed as the report gives it.
  const ownNet = !view.filtered && split.summaries.length === 1 ? rows[split.summaries[0]] : null;
  const netLabel = ownNet ? str(ownNet.find((c) => typeof c === 'string' && NET_RE.test(c.trim()))) : 'Net (credit − debit)';

  // The ledger's closing balance: its last Closing Balance row, else its last entry's.
  const closingBalance = useMemo(() => {
    if (balanceCol === -1) return null;
    for (let k = split.closings.length - 1; k >= 0; k--) {
      const v = rows[split.closings[k].i]?.[balanceCol];
      if (typeof v === 'number') return v;
    }
    return null;
  }, [rows, split, balanceCol]);

  // A statement's tiles: one per group of heads ("ITC Claimed"), summed across them.
  const flowGroups = useMemo(() => {
    const out: { label: string; cols: number[] }[] = [];
    for (const c of flowCols) {
      const label = HEAD_RE.exec(headers[c]?.trim() ?? '')?.[1] ?? headers[c];
      const last = out[out.length - 1];
      if (last && last.label === label) last.cols.push(c);
      else out.push({ label, cols: [c] });
    }
    return out;
  }, [flowCols, headers]);

  // ── Pinned rows and totals, as cells over the columns shown ──────────────
  const firstText = cols.findIndex((c) => c !== model.periodCol && model.columns[c]?.kind === 'text');
  const labelPos = cols.indexOf(descCol) >= 0 ? cols.indexOf(descCol) : firstText >= 0 ? firstText : 0;
  // The Month column shown beside the label names a balance's month on its own row.
  const monthOnRow = monthCol >= 0 && cols.includes(monthCol) && cols.indexOf(monthCol) !== labelPos;
  // A balance names its month (a merge's: its period) unless it stands in
  // place with its month beside it, or under its period's band.
  const pinnedLabel = (p: Pinned, ascii: boolean, inPlace: boolean): string => {
    const base = p.kind === 'opening' ? 'Opening balance' : p.kind === 'closing' ? 'Closing balance' : 'Closing balance (last entry)';
    const sep = ascii ? ', ' : ' · ';
    if (p.month) return inPlace && monthOnRow ? base : `${base}${sep}${p.month}`;
    return model.merged && p.band && !inPlace ? `${base}${sep}${periodLabel(p.band)}` : base;
  };
  const pinnedCells = (p: Pinned, ascii = false, inPlace = false): Cell[] => {
    const src = rows[p.i] ?? [];
    return cols.map((c, k) => {
      if (c === model.periodCol) return p.band ? periodLabel(p.band) : '';
      if (k === labelPos) return pinnedLabel(p, ascii, inPlace);
      if (c === monthCol) return p.month;
      const v = src[c];
      if (typeof v !== 'number' || SERIAL_HEADER_RE.test(headers[c]?.trim() ?? '')) return '';
      // An entry standing in for the closing line gives its balances only.
      return p.kind === 'last' && !balanceCols.includes(c) ? '' : v;
    });
  };
  const sumCells = (label: string, sums: Map<number, number>, own?: Cell[] | null): Cell[] => cols.map((c, k) => {
    const mine = own?.[c];
    if (typeof mine === 'number') return mine;
    if (sums.has(c)) return sums.get(c) as number;
    return k === labelPos ? label : '';
  });
  // The rows under the list, top to bottom (the screen's footer and the export's last lines).
  const totalLines = (ascii: boolean): { label: string; cells: Cell[] }[] => {
    const filtered = view.filtered ? ' (filtered)' : '';
    if (!hasType) return [{ label: `TOTAL${filtered}`, cells: sumCells(`TOTAL${filtered}`, shownFlows) }];
    const net = ascii ? `${netLabel.replace(/−/g, 'less').replace(/\s+/g, ' ')}${filtered}` : `${netLabel}${filtered}`;
    return [
      { label: `Total debits${filtered}`, cells: sumCells(`Total debits${filtered}`, shownDr) },
      { label: `Total credits${filtered}`, cells: sumCells(`Total credits${filtered}`, shownCr) },
      { label: net, cells: sumCells(net, netOf(shownDr, shownCr), ownNet) },
    ];
  };

  // ── Where the balances go ────────────────────────────────────────────────
  // Whether a segment's balances show: a filter on the Month column (or a
  // merge's Period) picks months; in place, a merge band the filter left
  // empty (and so not drawn) takes its balances with it.
  const segmentVisible = (state: ViewState, items: DisplayItem[] | null) => {
    const byMonth = monthCol >= 0 ? state.filters[monthCol] : undefined;
    const byPeriod = model.merged ? state.filters[model.periodCol] : undefined;
    const bands = items && model.merged ? new Set(items.flatMap((it) => (it.type === 'band' ? [it.key] : []))) : null;
    return (s: number) => {
      const seg = split.segments[s];
      return picks(byMonth, seg.month) && picks(byPeriod, seg.band) && (!bands || bands.has(seg.band));
    };
  };
  // The ledger's own order (no sort, no grouping): its balances in place.
  const ownOrder = (k: TableKit) => !k.state.sort && !k.view.groups && split.monotonic;
  const stepsOf = (k: TableKit, items: DisplayItem[]): Step[] => placeBalances(
    items, split.segments, (row) => split.segOfListed[row.i] ?? -1,
    (key) => split.bandStart.get(key) ?? split.segments.length, segmentVisible(k.state, items),
  );
  // Out of place: the balances shown, first and last.
  const endsOf = (k: TableKit) => {
    const visible = segmentVisible(k.state, null);
    return { top: split.openings.filter((p) => visible(p.seg)), bottom: split.closings.filter((p) => visible(p.seg)) };
  };

  // ── The "filtered" Excel / PDF: the screen, balances and totals included ──
  function exportLedger(t: ReportTable, k: TableKit): ReportTable {
    const out: Cell[][] = [];
    const kinds: RowKind[] = [];
    const tones: (RowTone | null)[] = [];
    const push = (cells: Cell[], kind: RowKind, tone: RowTone | null = null) => { out.push(cells); kinds.push(kind); tones.push(tone); };
    // The kit's rows, less its own filtered TOTAL (the totals below replace it).
    const n = t.rows.length - (k.view.footer ? 1 : 0);
    const own = (r: number) => push(t.rows[r], t.rowKinds?.[r] ?? 'data', t.rowTones?.[r] ?? null);
    // In the ledger's own order the exported rows are the kit's items one for
    // one, so the balances go in place, as on screen (the whole list, never a page).
    if (ownOrder(k) && k.view.items.length === n) {
      for (const step of stepsOf(k, k.view.items)) {
        if ('pin' in step) push(pinnedCells(step.pin, true, true), 'subtotal');
        else own(step.item);
      }
    } else {
      const { top, bottom } = endsOf(k);
      for (const p of top) push(pinnedCells(p, true), 'subtotal');
      // A ledger with a Type column adds its debits and credits under each group.
      const groups = k.view.groups;
      let g = -1;
      const closeGroup = () => {
        if (!hasType || !groups || g < 0 || !groups[g]) return;
        const label = groups[g].label;
        push(sumCells(`Debits: ${label}`, byDir(groups[g].rows, 'debit')), 'subtotal');
        push(sumCells(`Credits: ${label}`, byDir(groups[g].rows, 'credit')), 'subtotal');
      };
      for (let r = 0; r < n; r++) {
        if (groups && t.rowKinds?.[r] === 'section') { closeGroup(); g += 1; }
        own(r);
      }
      closeGroup();
      for (const p of bottom) push(pinnedCells(p, true), 'subtotal');
    }
    for (const line of totalLines(true)) push(line.cells, 'total');

    const rowsShown = t.kpis?.find((x) => /rows shown/i.test(x.label));
    const kpis = [
      { label: 'Entries shown', value: rowsShown?.value ?? String(k.view.rows.length) },
      ...(hasType
        ? [
          { label: 'Total debit', value: money(sumAll(shownDr)) },
          { label: 'Total credit', value: money(sumAll(shownCr)) },
          { label: 'Net (credit less debit)', value: money(round2(sumAll(shownCr) - sumAll(shownDr))) },
        ]
        : flowGroups.map((fg) => ({ label: fg.label, value: money(round2(fg.cols.reduce((a, c) => a + (shownFlows.get(c) ?? 0), 0))) }))),
      ...(closingBalance !== null ? [{ label: 'Closing balance', value: money(closingBalance) }] : []),
    ].slice(0, 8);
    return { ...t, rows: out, rowKinds: kinds, ...(tones.some((x) => x) ? { rowTones: tones } : { rowTones: undefined }), kpis };
  }

  // ── The Debit / Credit toggle: a filter on the Type column ───────────────
  const typeFilter = hasType ? kit.state.filters[typeCol] : undefined;
  const direction: 'all' | Direction = typeFilter?.type === 'values' && typeFilter.values.length === 1
    && /^(debit|credit)$/i.test(typeFilter.values[0]) ? (typeFilter.values[0].toLowerCase() as Direction) : 'all';
  const setDirection = (d: 'all' | Direction) => {
    if (!hasType) return;
    if (d === 'all') { kit.setFilter(typeCol, undefined); return; }
    // The value as the report spells it ("Debit").
    const key = model.data.map((r) => str(r.cells[typeCol])).find((s) => s.toLowerCase() === d) ?? (d === 'debit' ? 'Debit' : 'Credit');
    kit.setFilter(typeCol, { type: 'values', values: [key] });
  };

  const subtitleParts = (table.subtitle || '').split('|').map((s) => s.trim()).filter(Boolean);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
            <BookText className="h-4 w-4 text-muted-foreground" />
            {table.title || report.title}
          </CardTitle>
          {table.subtitle && <CardDescription className="text-xs">{table.subtitle}</CardDescription>}
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
            <Inbox className="h-5 w-5 opacity-60" />
            <p className="text-sm">No ledger entries on record for this period.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const filtered = view.filtered;
  const ofAll = (all: number) => (filtered ? `of ${money(all)}` : undefined);
  const drShown = sumAll(shownDr);
  const crShown = sumAll(shownCr);

  return (
    // The card fills the preview so the register takes the room left and its totals stay in sight.
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-3">
        <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
          <BookText className="h-4 w-4 shrink-0 text-muted-foreground" />
          {table.title || report.title}
        </CardTitle>
        {subtitleParts.length > 0 && (
          <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {subtitleParts.map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground/40">•</span>}
                {part}
              </span>
            ))}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3">
        {/* Totals strip: the entries shown; once filtered, against the whole ledger. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {hasType ? (
            <>
              <TileButton active={direction === 'debit'} onClick={() => setDirection(direction === 'debit' ? 'all' : 'debit')} title="Show debit entries only">
                <KpiTile label="Total Debit" value={money(drShown)} hint={ofAll(sumAll(allDr))} tone="error" />
              </TileButton>
              <TileButton active={direction === 'credit'} onClick={() => setDirection(direction === 'credit' ? 'all' : 'credit')} title="Show credit entries only">
                <KpiTile label="Total Credit" value={money(crShown)} hint={ofAll(sumAll(allCr))} tone="ok" />
              </TileButton>
              <KpiTile
                label="Net (Credit − Debit)"
                value={money(round2(crShown - drShown))}
                hint={ofAll(round2(sumAll(allCr) - sumAll(allDr)))}
                tone={crShown - drShown >= 0 ? 'ok' : 'error'}
              />
            </>
          ) : (
            flowGroups.slice(0, 4).map((fg) => {
              const shown = round2(fg.cols.reduce((a, c) => a + (shownFlows.get(c) ?? 0), 0));
              const all = round2(fg.cols.reduce((a, c) => a + (allFlows.get(c) ?? 0), 0));
              return <KpiTile key={fg.label} label={fg.label} value={money(shown)} hint={ofAll(all)} />;
            })
          )}
          {closingBalance !== null && (
            <KpiTile label="Closing Balance" value={money(closingBalance)} hint="Whole ledger, as on the portal" />
          )}
        </div>

        <TableKitToolbar
          kit={kit}
          searchPlaceholder="Search description, date, reference, amount…"
          left={hasType ? (
            <ToggleGroup
              type="single"
              value={direction}
              onValueChange={(v) => { if (v) setDirection(v as 'all' | Direction); }}
              className="justify-start rounded-md border p-0.5"
              aria-label="Debit or credit entries"
            >
              <ToggleGroupItem value="all" className="h-7 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm">All</ToggleGroupItem>
              <ToggleGroupItem value="debit" className="h-7 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-rose-600 data-[state=on]:shadow-sm dark:data-[state=on]:text-rose-400">
                Debit
              </ToggleGroupItem>
              <ToggleGroupItem value="credit" className="h-7 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-emerald-600 data-[state=on]:shadow-sm dark:data-[state=on]:text-emerald-400">
                Credit
              </ToggleGroupItem>
            </ToggleGroup>
          ) : undefined}
        />

        <LedgerTable
          kit={kit}
          typeCol={typeCol}
          statusCol={statusCol}
          balanceCols={balanceCols}
          flowCols={flowCols}
          hasType={hasType}
          dirOf={dirOf}
          byDir={byDir}
          // In the ledger's own order on one page, the balances in place; else
          // first and last (with no entry shown too: the "no entries" line then
          // sits between them, not above them).
          layout={ownOrder(kit) && !kit.paged && view.rows.length > 0 ? { steps: stepsOf(kit, kit.pageView.items) } : endsOf(kit)}
          pinnedCells={(p, inPlace) => pinnedCells(p, false, inPlace)}
          totals={totalLines(false)}
          labelPos={labelPos}
        />
        <TableKitPager kit={kit} />
      </CardContent>
    </Card>
  );
};

// ── The register itself ──────────────────────────────────────────────────

interface LedgerTableProps {
  kit: TableKit;
  typeCol: number;
  statusCol: number;
  balanceCols: number[];
  flowCols: number[];
  hasType: boolean;
  dirOf: (r: ModelRow) => Direction | null;
  byDir: (rows: ModelRow[], d: Direction) => Map<number, number>;
  /** The page's items with the balances in place, or the balances to pin first and last. */
  layout: { steps: Step[] } | { top: Pinned[]; bottom: Pinned[] };
  pinnedCells: (p: Pinned, inPlace: boolean) => Cell[];
  totals: { label: string; cells: Cell[] }[];
  labelPos: number;
}

const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|SANCTION|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

// A sticky period band needs a solid fill, or the rows scrolling under it show through.
const BAND_FILL = '[background:linear-gradient(hsl(var(--primary)/0.08),hsl(var(--primary)/0.08)),hsl(var(--card))]';
const DEBIT_TEXT = 'text-rose-600 dark:text-rose-400';
const CREDIT_TEXT = 'text-emerald-600 dark:text-emerald-400';

const LedgerTable: React.FC<LedgerTableProps> = ({
  kit, typeCol, statusCol, balanceCols, flowCols, hasType, dirOf, byDir, layout, pinnedCells, totals, labelPos,
}) => {
  const { model, view, state, cols, pageView } = kit;
  const span = cols.length;
  const firstBalance = cols.find((c) => balanceCols.includes(c));
  const under = kit.columnGroups ? 'sticky top-[3.75rem] z-[5]' : 'sticky top-8 z-[5]';
  const figureClass = (c: number) => cn(WS_TD, 'whitespace-nowrap', kit.isFigure(c) && 'text-right tabular-nums', c === firstBalance && 'border-l border-l-foreground/20');
  const show = (c: number, v: Cell) => (typeof v === 'number' ? kit.figure(c, v) : v);

  // A balance line (opening / closing): held out of the kit, never an entry.
  const pinnedRow = (p: Pinned, inPlace: boolean) => (
    <TableRow key={`p${p.kind}${p.i}`} className={cn(WS_TR_HEADING, 'hover:bg-muted/50')}>
      {pinnedCells(p, inPlace).map((v, k) => (
        <TableCell key={cols[k]} className={cn(figureClass(cols[k]), k === labelPos && 'font-semibold', typeof v === 'number' && 'font-semibold')}>
          {show(cols[k], v)}
        </TableCell>
      ))}
    </TableRow>
  );
  const inPlace = 'steps' in layout;

  const firstFigure = cols.findIndex((c) => model.summable.includes(c));
  const headSpan = firstFigure > 0 ? firstFigure : cols.length;
  let zebra = 0;
  const renderItem = (it: DisplayItem): React.ReactNode => {
    switch (it.type) {
      case 'band':
        zebra = 0;
        return (
          <TableRow key={`b${it.key}${it.continued ? 'c' : ''}`} className={cn(under, 'hover:bg-transparent')}>
            <TableCell colSpan={span} className={cn(WS_TD, BAND_FILL, 'py-1 font-semibold text-primary')}>
              <span className="inline-flex items-center gap-2">
                <CalendarRange className="h-3.5 w-3.5" />
                {it.label}
                <span className="font-normal text-muted-foreground">{it.continued ? '(continued)' : view.filtered ? `${it.count} matching` : ''}</span>
              </span>
            </TableCell>
          </TableRow>
        );
      case 'section':
        return (
          <TableRow key={`s${it.row.i}${it.continued ? 'c' : ''}`} className={WS_TR_HEADING}>
            <TableCell colSpan={span} className={cn(WS_TD, 'py-1 text-[13px]')}>{it.label}</TableCell>
          </TableRow>
        );
      case 'group': {
        zebra = 0;
        const gcol = state.groupBy !== null ? model.columns[state.groupBy] : null;
        const group = view.groups?.find((g) => g.key === it.key);
        // By direction: a group's debits and credits are never added together.
        const dr = hasType && group ? [...byDir(group.rows, 'debit').values()].reduce((a, b) => a + b, 0) : 0;
        const cr = hasType && group ? [...byDir(group.rows, 'credit').values()].reduce((a, b) => a + b, 0) : 0;
        return (
          <TableRow
            key={`g${it.key}${it.continued ? 'c' : ''}`}
            className={cn(under, 'cursor-pointer bg-muted hover:bg-muted', WS_TR_HEADING)}
            onClick={() => kit.toggleCollapsed(it.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kit.toggleCollapsed(it.key); } }}
            tabIndex={0}
            aria-expanded={!it.collapsed}
          >
            <TableCell colSpan={hasType ? span : headSpan} className={cn(WS_TD, 'bg-muted font-semibold')}>
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {it.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span className="font-normal text-muted-foreground">{gcol?.name}:</span>
                <span className="max-w-[420px] truncate" title={it.label}>{it.label}</span>
                <span className="font-normal text-muted-foreground">
                  ({it.count.toLocaleString('en-IN')} {it.count === 1 ? 'entry' : 'entries'}{it.continued ? ', continued' : ''})
                </span>
                {hasType && (
                  <span className="ml-2 font-normal tabular-nums">
                    {dr !== 0 && <span className={DEBIT_TEXT}>Debits {money(dr)}</span>}
                    {dr !== 0 && cr !== 0 && <span className="text-muted-foreground"> · </span>}
                    {cr !== 0 && <span className={CREDIT_TEXT}>Credits {money(cr)}</span>}
                  </span>
                )}
              </span>
            </TableCell>
            {!hasType && headSpan < cols.length && cols.slice(headSpan).map((c) => (
              <TableCell key={c} className={cn(figureClass(c), 'bg-muted font-semibold')}>
                {it.sums.has(c) ? kit.figure(c, it.sums.get(c) as number) : ''}
              </TableCell>
            ))}
          </TableRow>
        );
      }
      case 'data': {
        const row = it.row;
        const odd = zebra++ % 2 === 1;
        const dir = hasType ? dirOf(row) : null;
        const tint = dir === 'debit' ? DEBIT_TEXT : dir === 'credit' ? CREDIT_TEXT : '';
        return (
          <TableRow key={`d${row.i}`} className={cn('hover:bg-primary/[0.04]', odd && 'bg-muted/25')}>
            {cols.map((c) => {
              const cell = row.cells[c];
              const isBalance = balanceCols.includes(c);
              const base = cn(kitCellClass(kit, c), c === firstBalance && 'border-l border-l-foreground/20');
              if (c === typeCol && str(cell)) {
                return (
                  <TableCell key={c} className={cn(base, 'whitespace-nowrap')}>
                    <Badge
                      variant="outline"
                      className={cn(
                        'gap-1 py-0 text-[10px] font-medium',
                        dir === 'debit' && 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400',
                        dir === 'credit' && 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400',
                      )}
                    >
                      {dir === 'debit' && <ArrowUpCircle className="h-3 w-3" />}
                      {dir === 'credit' && <ArrowDownCircle className="h-3 w-3" />}
                      {str(cell)}
                    </Badge>
                  </TableCell>
                );
              }
              if (c === statusCol && str(cell)) {
                return (
                  <TableCell key={c} className={cn(base, 'whitespace-nowrap')}>
                    <Badge variant={STATUS_VARIANT(str(cell))} className="py-0 text-[10px] font-medium">{str(cell)}</Badge>
                  </TableCell>
                );
              }
              return (
                <TableCell
                  key={c}
                  className={cn(base, isBalance && 'font-semibold text-foreground', !isBalance && flowCols.includes(c) && (isNil(cell) ? 'text-muted-foreground' : tint))}
                  title={typeof cell === 'string' && !/^https?:\/\//.test(cell) ? cell : undefined}
                >
                  <StandardCell kit={kit} row={row} col={c} />
                </TableCell>
              );
            })}
          </TableRow>
        );
      }
      default:
        return null;
    }
  };

  return (
    // Its own wrapper scrolls, so the header and the totals stay pinned.
    <Table className={WS_TABLE} containerClassName="min-h-[160px] max-h-[65vh] flex-[0_1_auto] rounded-md border bg-card" aria-label="Ledger entries">
      <TableKitHeader kit={kit} />
      <TableBody>
        {!inPlace && layout.top.map((p) => pinnedRow(p, false))}
        {model.data.length === 0 && (
          <TableRow>
            <TableCell colSpan={span} className="border-b py-6 text-center text-sm text-muted-foreground">
              No entries in this ledger, only its balances.
            </TableCell>
          </TableRow>
        )}
        {view.rows.length === 0 && view.filtered && (
          <TableRow>
            <TableCell colSpan={span} className="border-b py-6 text-center text-sm text-muted-foreground">
              No entries match these filters.{' '}
              <button type="button" className="text-primary hover:underline" onClick={kit.clearAll}>Clear all</button>
            </TableCell>
          </TableRow>
        )}
        {inPlace
          ? layout.steps.map((step) => ('pin' in step ? pinnedRow(step.pin, true) : renderItem(pageView.items[step.item])))
          : pageView.items.map(renderItem)}
        {!inPlace && layout.bottom.map((p) => pinnedRow(p, false))}
      </TableBody>
      {flowCols.length > 0 && model.data.length > 0 && (
        <TableFooter className="sticky bottom-0 z-10 border-t-0 bg-muted">
          {totals.map((line, k) => (
            <TableRow
              key={line.label}
              className={cn(
                WS_TR_TOTAL, 'hover:bg-muted',
                k === 0 && '[&>td]:border-t-2 [&>td]:border-t-foreground/40',
                k === totals.length - 1 && '[&>td]:font-bold',
              )}
            >
              {line.cells.map((v, j) => {
                const c = cols[j];
                const tint = hasType && typeof v === 'number' && !isNil(v) ? (line.label.startsWith('Total debits') ? DEBIT_TEXT : line.label.startsWith('Total credits') ? CREDIT_TEXT : '') : '';
                return (
                  <TableCell key={c} className={cn(figureClass(c), tint, j === labelPos && 'italic')}>
                    {show(c, v)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableFooter>
      )}
    </Table>
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
