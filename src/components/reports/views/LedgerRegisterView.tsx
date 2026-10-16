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
//   - the Opening and Closing Balance rows pinned first and last, out of reach
//     of the search, the filters and the sort: they bound the ledger, they are
//     not entries. The cash and liability builders leave them undated, so the
//     report's own order puts them at the end; pinned, they are where a
//     reader looks for them;
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
  StandardCell, TableKitHeader, TableKitPager, TableKitToolbar, kitCellClass, periodLabel, useTableKit,
  type DisplayItem, type ModelRow, type TableKit,
} from './tableKit';

interface LedgerRegisterViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

type Cell = string | number;
type Direction = 'debit' | 'credit';
type Role = 'band' | 'section' | 'blank' | 'opening' | 'closing' | 'summary' | 'entry';

/** An Opening / Closing Balance row held out of the kit and drawn first or last. */
interface Pinned {
  /** Index in table.rows (for a closing taken from the last entry: that entry's). */
  i: number;
  /** The merge's period the row sits under ('' for one period). */
  band: string;
  kind: 'opening' | 'closing' | 'last';
}

const TYPE_HEADER_RE = /^type$/i;
const DESC_HEADER_RE = /^(description|particulars|narration)$/i;
// The running balances: the ledger's own figure per row, never added up.
const BALANCE_HEADER_RE = /^(balance|closing\b.*|opening\b.*)$/i;
const SERIAL_HEADER_RE = /^(#|sr\.?\s*no\.?|s\.?\s?no\.?|sl\.?\s?no\.?)$/i;
// "ITC Claimed IGST": the group ("ITC Claimed") and the head ("IGST").
const HEAD_RE = /^(.+?)\s+(IGST|CGST|SGST|UTGST|Cess)$/i;
const OPENING_RE = /^opening balance$/i;
const CLOSING_RE = /^closing balance$/i;
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

export const LedgerRegisterView: React.FC<LedgerRegisterViewProps> = ({ table, report }) => {
  const { headers, rows } = table;
  const typeCol = useMemo(() => headers.findIndex((h) => TYPE_HEADER_RE.test(h.trim())), [headers]);
  const descCol = useMemo(() => headers.findIndex((h) => DESC_HEADER_RE.test(h.trim())), [headers]);
  const statusCol = useMemo(() => headers.findIndex((h) => /^status$/i.test(h.trim())), [headers]);
  const balanceCols = useMemo(() => headers.map((h, i) => (BALANCE_HEADER_RE.test(h.trim()) ? i : -1)).filter((i) => i >= 0), [headers]);
  const balanceCol = useMemo(() => headers.findIndex((h) => /^balance$/i.test(h.trim())), [headers]);
  const hasType = typeCol !== -1;

  // The ledger split into what the kit lists (entries, and a merge's period
  // bands) and the balances it pins.
  const split = useMemo(() => {
    const listed: number[] = [];
    const kinds: RowKind[] = [];
    const openings: Pinned[] = [];
    const closings: Pinned[] = [];
    const summaries: number[] = [];
    const lastEntry = new Map<string, number>();
    let band = '';
    rows.forEach((row, i) => {
      const role = roleOf(row, table.rowKinds?.[i]);
      if (role === 'blank') return;
      if (role === 'opening') { openings.push({ i, band, kind: 'opening' }); return; }
      if (role === 'closing') { closings.push({ i, band, kind: 'closing' }); return; }
      if (role === 'summary') { summaries.push(i); return; }
      if (role === 'band') band = BAND_RE.exec(str(row[0]))?.[1] ?? str(row[0]);
      if (role === 'entry' && balanceCols.some((c) => typeof row[c] === 'number')) lastEntry.set(band, i);
      listed.push(i);
      kinds.push(role === 'band' ? 'period' : role === 'section' ? 'section' : 'data');
    });
    // A statement without Closing Balance rows closes on its last entry's balance.
    if (!closings.length) for (const [b, i] of lastEntry) closings.push({ i, band: b, kind: 'last' });
    return { listed, kinds, openings, closings, summaries };
  }, [rows, table.rowKinds, balanceCols]);

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
  // Away from its period's band (sorted, grouped), a merge's balance names its period.
  const pinnedLabel = (p: Pinned, ascii: boolean, inBand: boolean): string => {
    const base = p.kind === 'opening' ? 'Opening balance' : p.kind === 'closing' ? 'Closing balance' : 'Closing balance (last entry)';
    return model.merged && p.band && !inBand ? `${base}${ascii ? ', ' : ' · '}${periodLabel(p.band)}` : base;
  };
  const pinnedCells = (p: Pinned, ascii = false, inBand = false): Cell[] => {
    const src = rows[p.i] ?? [];
    return cols.map((c, k) => {
      if (c === model.periodCol) return p.band ? periodLabel(p.band) : '';
      if (k === labelPos) return pinnedLabel(p, ascii, inBand);
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

  // ── The "filtered" Excel / PDF: the screen, balances and totals included ──
  function exportLedger(t: ReportTable, k: TableKit): ReportTable {
    const out: Cell[][] = [];
    const kinds: RowKind[] = [];
    const tones: (RowTone | null)[] = [];
    const push = (cells: Cell[], kind: RowKind, tone: RowTone | null = null) => { out.push(cells); kinds.push(kind); tones.push(tone); };
    // A merge in its own order keeps each period's balances under its band, as on screen.
    const inBands = k.model.merged && k.view.showBands;
    const pinOf = (list: Pinned[], band: string) => list.filter((p) => p.band === band);
    if (!inBands) for (const p of split.openings) push(pinnedCells(p, true), 'subtotal');
    // The kit's rows, less its own filtered TOTAL (the totals below replace it);
    // a ledger with a Type column adds its debits and credits under each group.
    const groups = k.view.groups;
    const n = t.rows.length - (k.view.footer ? 1 : 0);
    let band: string | null = null;
    let g = -1;
    const closeGroup = () => {
      if (!hasType || !groups || g < 0 || !groups[g]) return;
      const label = groups[g].label;
      push(sumCells(`Debits: ${label}`, byDir(groups[g].rows, 'debit')), 'subtotal');
      push(sumCells(`Credits: ${label}`, byDir(groups[g].rows, 'credit')), 'subtotal');
    };
    for (let r = 0; r < n; r++) {
      const kind = t.rowKinds?.[r] ?? 'data';
      if (groups && kind === 'section') { closeGroup(); g += 1; }
      if (inBands && kind === 'period') {
        if (band !== null) for (const p of pinOf(split.closings, band)) push(pinnedCells(p, true, true), 'subtotal');
        band = BAND_RE.exec(str(t.rows[r][0]))?.[1] ?? '';
        push(t.rows[r], kind);
        for (const p of pinOf(split.openings, band)) push(pinnedCells(p, true, true), 'subtotal');
        continue;
      }
      push(t.rows[r], kind, t.rowTones?.[r] ?? null);
    }
    closeGroup();
    if (inBands && band !== null) for (const p of pinOf(split.closings, band)) push(pinnedCells(p, true, true), 'subtotal');
    if (!inBands) for (const p of split.closings) push(pinnedCells(p, true), 'subtotal');
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
          openings={split.openings}
          closings={split.closings}
          pinnedCells={(p, inBand) => pinnedCells(p, false, inBand)}
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
  openings: Pinned[];
  closings: Pinned[];
  pinnedCells: (p: Pinned, inBand: boolean) => Cell[];
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
  kit, typeCol, statusCol, balanceCols, flowCols, hasType, dirOf, byDir, openings, closings, pinnedCells, totals, labelPos,
}) => {
  const { model, view, state, cols, pageView } = kit;
  const span = cols.length;
  const firstBalance = cols.find((c) => balanceCols.includes(c));
  const under = kit.columnGroups ? 'sticky top-[3.75rem] z-[5]' : 'sticky top-8 z-[5]';
  const figureClass = (c: number) => cn(WS_TD, 'whitespace-nowrap', kit.isFigure(c) && 'text-right tabular-nums', c === firstBalance && 'border-l border-l-foreground/20');
  const show = (c: number, v: Cell) => (typeof v === 'number' ? kit.figure(c, v) : v);

  // A balance line (opening / closing): pinned, never an entry.
  const pinnedRow = (p: Pinned, where: 'top' | 'bottom', inBand = false) => (
    <TableRow key={`${where}${p.i}`} className={cn(WS_TR_HEADING, 'hover:bg-muted/50')}>
      {pinnedCells(p, inBand).map((v, k) => (
        <TableCell key={cols[k]} className={cn(figureClass(cols[k]), k === labelPos && 'font-semibold', typeof v === 'number' && 'font-semibold')}>
          {show(cols[k], v)}
        </TableCell>
      ))}
    </TableRow>
  );

  // A merge in its own order (its period bands shown, one page) keeps each
  // period's balances under its band; sorted or grouped, they are pinned first
  // and last, each naming its period.
  const inBands = model.merged && view.showBands && !kit.paged;
  const bandedItems = (): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let band: string | null = null;
    const closeBand = () => {
      if (band !== null) for (const p of closings) if (p.band === band) out.push(pinnedRow(p, 'bottom', true));
    };
    for (const it of pageView.items) {
      if (it.type === 'band') {
        closeBand();
        band = it.key;
        out.push(renderItem(it));
        for (const p of openings) if (p.band === band) out.push(pinnedRow(p, 'top', true));
        continue;
      }
      out.push(renderItem(it));
    }
    closeBand();
    return out;
  };

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
        {!inBands && openings.map((p) => pinnedRow(p, 'top'))}
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
        {inBands ? bandedItems() : pageView.items.map(renderItem)}
        {!inBands && closings.map((p) => pinnedRow(p, 'bottom'))}
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
