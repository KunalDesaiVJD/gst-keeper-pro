// The document list: one row per pair, the two statements side by side under
// a two-level heading (Document | GSTR-2A | GSTR-2B | Difference |
// Reconciliation), the TOTAL of the filtered rows pinned at the bottom. A row
// opens (click, Enter or Space) into both documents in full.
//
// A year holds 3,000+ rows, so the list is built to stay quick: a fixed table
// layout with set column widths (the browser need not measure every cell, and
// Reason takes whatever width is left, so the default columns fit the dialog),
// rows memoised with one click / key handler on the body, class strings worked
// out once per column. A page of more than WINDOW_FROM rows (500, All) draws
// only the rows in view plus a margin, with spacers for the rest: a browser
// lays out a whole table again whenever a row is added, so drawing 3,000 rows,
// even a few hundred at a time, would hold the dialog for seconds.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { monthLabel } from '@/lib/itcReco/dates';
import { facetLabel, rateKey, sortRows, type SortKey, type SortState } from '@/lib/itcReco/filters';
import { sideTotals } from '@/lib/itcReco/viewModel';
import type { RecoSideView, RecoViewData, RecoViewRow, SideTotals } from '@/lib/itcReco/viewTypes';
import { DocumentDetail } from './DocumentDetail';
import { SortHead } from './shared';
import { ROW_EDGE, ROW_TINT, STATUS_PILL, fmtAmt, fmtCountPlain, fmtIso } from './format';

type Band = 'doc' | 'left' | 'right' | 'diff' | 'reco';
type Head = 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'tax';
type Optional = 'heads' | 'section' | 'rate' | 'filedOn' | 'evidence' | 'action' | 'notes';

const OPTIONAL: { key: Optional; label: string }[] = [
  { key: 'heads', label: 'IGST, CGST, SGST and Cess on each side' },
  { key: 'section', label: 'Section' },
  { key: 'rate', label: 'Rate' },
  { key: 'filedOn', label: 'Filed on (supplier)' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'action', label: 'What to do' },
  { key: 'notes', label: 'Also note (flags)' },
];

interface Totals { left: SideTotals; right: SideTotals; diff: Record<Head, number> }

interface Col {
  id: string;
  band: Band;
  head: string;
  /** px; none = takes the width left over (Reason). */
  width?: number;
  title?: string;
  sortKey?: SortKey;
  numeric?: boolean;
  cell: (r: RecoViewRow) => React.ReactNode;
  total?: (t: Totals) => React.ReactNode;
  /** The <td> class, worked out once. */
  className: string;
}

const PAGE_SIZES = [100, 250, 500, 0];
/** A page longer than this is windowed. */
const WINDOW_FROM = 300;
/** Rows drawn beyond the visible ones, above and below. */
const OVERSCAN = 15;
/** Every collapsed row is this tall (two lines of text); measured once drawn. */
const ROW_H = 40;
/** An open row's detail, until measured. */
const DETAIL_GUESS = 520;
const HEAD_LABEL: Record<Head, string> = { taxable: 'Taxable', igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess', tax: 'Tax' };
const SORT_OF: Record<'left' | 'right', Record<Head, SortKey>> = {
  left: { taxable: 'leftTaxable', igst: 'leftIgst', cgst: 'leftCgst', sgst: 'leftSgst', cess: 'leftCess', tax: 'leftTax' },
  right: { taxable: 'rightTaxable', igst: 'rightIgst', cgst: 'rightCgst', sgst: 'rightSgst', cess: 'rightCess', tax: 'rightTax' },
};
const AMOUNT_W: Record<Head, number> = { taxable: 108, igst: 98, cgst: 92, sgst: 92, cess: 80, tax: 102 };

const ITC_SHORT: Record<string, string> = { available: 'Yes', not_available: 'No', rejected: 'Rejected', reversal: 'Reversal', unknown: '' };
const ITC_WHY: Record<string, [string, string]> = { P: ['POS', 'place of supply'], C: ['time', 'time limit'] };
const itcCell = (s: RecoSideView | null): React.ReactNode => {
  if (!s || !s.itc) return '';
  const word = ITC_SHORT[s.itc] ?? s.itc;
  const why = s.itcReason ? ITC_WHY[s.itcReason.toUpperCase()] ?? [s.itcReason, s.itcReason] : null;
  if (s.itc === 'available') return word;
  return <span className="font-semibold text-destructive-strong" title={why ? `ITC not available: ${why[1]}` : undefined}>{word}{why ? ` (${why[0]})` : ''}</span>;
};

const TD = 'border-b border-r px-1.5 py-1 align-top';
const NUM = `${TD} text-right tabular-nums whitespace-nowrap`;
const FOOT = 'sticky bottom-0 z-10 border-r border-t-2 border-t-foreground/40 bg-muted px-1.5 py-1.5 font-semibold';

const diffClass = (v: number, tol: number) => (Math.abs(v) > tol ? 'font-semibold text-destructive-strong' : 'text-muted-foreground');
/** A difference figure; blank when the row is not compared. A plain span: one per row and column. */
const diffCell = (v: number | null | undefined, tol: number): React.ReactNode =>
  (v === null || v === undefined ? '' : <span className={diffClass(v, tol)}>{fmtAmt(v)}</span>);

const ROW_BASE = 'cursor-pointer hover:bg-primary/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary';
const ROW_CLASS = Object.fromEntries(Object.entries(ROW_TINT).map(([k, v]) => [k, `${ROW_BASE} ${v}`])) as Record<keyof typeof ROW_TINT, string>;
const ROW_OPEN = `${ROW_BASE} bg-primary/[0.07] hover:bg-primary/[0.07]`;
const EDGE_CLASS = Object.fromEntries(Object.entries(ROW_EDGE).map(([k, v]) => [k, `border-b border-r px-0 py-1 text-center align-top text-[13px] leading-4 text-muted-foreground ${v}`])) as Record<keyof typeof ROW_EDGE, string>;

const ROW_STYLE: React.CSSProperties = { height: ROW_H };

const Row = React.memo(function Row({ r, cols, isOpen, span, data }: { r: RecoViewRow; cols: Col[]; isOpen: boolean; span: number; data: RecoViewData }) {
  return (
    <>
      <tr data-row={r.id} tabIndex={0} aria-expanded={isOpen} className={isOpen ? ROW_OPEN : ROW_CLASS[r.status]} style={ROW_STYLE}>
        <td className={EDGE_CLASS[r.status]}>
          <span className={isOpen ? 'inline-block rotate-90 font-semibold text-primary' : 'inline-block'} aria-hidden="true">›</span>
        </td>
        {cols.map((c) => <td key={c.id} className={c.className}>{c.cell(r)}</td>)}
      </tr>
      {isOpen && (
        <tr data-detail={r.id}>
          <td colSpan={span} className="border-b-2 border-b-primary/30 bg-muted/30 p-0">
            <DocumentDetail row={r} data={data} />
          </td>
        </tr>
      )}
    </>
  );
});

export const DocumentsTab: React.FC<{ data: RecoViewData; rows: RecoViewRow[] }> = ({ data, rows }) => {
  const L = data.left.label;
  const R = data.right.label;
  const many = data.periods.length > 1;
  const tol = data.tolerance;
  const [sort, setSort] = useState<SortState | null>(null);
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [opt, setOpt] = useState<Set<Optional>>(() => new Set());

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  useEffect(() => { setPage(0); }, [rows, sort, pageSize]);
  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const from = pageSize ? Math.min(page, pages - 1) * pageSize : 0;
  const shown = useMemo(() => (pageSize ? sorted.slice(from, from + pageSize) : sorted), [sorted, pageSize, from]);

  // Windowing: which rows of the page are in view. Heights are measured (one
  // collapsed row, the heading, each open detail) so the spacers stay exact.
  const windowed = shown.length > WINDOW_FROM;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [port, setPort] = useState({ top: 0, height: 700 });
  const [rowH, setRowH] = useState(ROW_H);
  const [headH, setHeadH] = useState(60);
  const [detailH, setDetailH] = useState<Record<string, number>>({});
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !windowed) return;
    let frame = 0;
    const read = () => { frame = 0; setPort({ top: el.scrollTop, height: el.clientHeight }); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [windowed]);
  const offsets = useMemo(() => {
    if (!windowed) return null;
    const o = new Float64Array(shown.length + 1);
    for (let i = 0; i < shown.length; i++) o[i + 1] = o[i] + rowH + (open.has(shown[i].id) ? detailH[shown[i].id] ?? DETAIL_GUESS : 0);
    return o;
  }, [windowed, shown, open, detailH, rowH]);
  const range = useMemo(() => {
    if (!offsets) return { start: 0, end: shown.length, before: 0, after: 0 };
    // The last row starting at or above y.
    const at = (y: number) => { let lo = 0; let hi = shown.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= y) lo = mid; else hi = mid - 1; } return lo; };
    const top = Math.max(0, port.top - headH);
    const start = Math.max(0, at(top) - OVERSCAN);
    const end = Math.min(shown.length, at(top + port.height) + OVERSCAN + 1);
    return { start, end, before: offsets[start], after: offsets[shown.length] - offsets[end] };
  }, [offsets, port, headH, shown.length]);
  const visible = windowed ? shown.slice(range.start, range.end) : shown;
  useLayoutEffect(() => {
    if (!windowed) return;
    const body = bodyRef.current;
    const row = body?.querySelector<HTMLElement>('tr[data-row]');
    if (row && Math.abs(row.getBoundingClientRect().height - rowH) > 0.5) setRowH(row.getBoundingClientRect().height);
    const hh = headRef.current?.getBoundingClientRect().height;
    if (hh && Math.abs(hh - headH) > 0.5) setHeadH(hh);
    const seen: Record<string, number> = {};
    body?.querySelectorAll<HTMLElement>('tr[data-detail]').forEach((tr) => { seen[tr.dataset.detail as string] = tr.getBoundingClientRect().height; });
    if (Object.entries(seen).some(([id, h]) => Math.abs((detailH[id] ?? -1) - h) > 0.5)) setDetailH((d) => ({ ...d, ...seen }));
    // Measured again whenever other rows or details come into view; each set only fires on a real change.
  }, [windowed, visible, open, rowH, headH, detailH]);
  // A new page or filter starts at the top of the list.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [shown]);

  const totals = useMemo<Totals>(() => {
    const diff: Record<Head, number> = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0 };
    for (const r of rows) if (r.diff) for (const k of Object.keys(diff) as Head[]) diff[k] += r.diff[k];
    for (const k of Object.keys(diff) as Head[]) diff[k] = Math.round(diff[k] * 100) / 100;
    return { left: sideTotals(rows, 'left'), right: sideTotals(rows, 'right'), diff };
  }, [rows]);

  const cols = useMemo<Col[]>(() => {
    const heads: Head[] = opt.has('heads') ? ['taxable', 'igst', 'cgst', 'sgst', 'cess', 'tax'] : ['taxable', 'tax'];
    const out: Col[] = [];
    const add = (c: Omit<Col, 'className'> & { td?: string }) => {
      const { td, ...rest } = c;
      out.push({ ...rest, className: cn(c.numeric ? NUM : TD, td) });
    };
    const side = (s: 'left' | 'right') => heads.forEach((h) => add({
      id: `${s}-${h}`, band: s, head: HEAD_LABEL[h], numeric: true, sortKey: SORT_OF[s][h], width: AMOUNT_W[h],
      title: `${s === 'left' ? L : R} ${h === 'tax' ? 'total tax (IGST + CGST + SGST + Cess)' : HEAD_LABEL[h]}`,
      cell: (r) => { const d = r[s]; return d ? fmtAmt(d[h]) : ''; },
      total: (t) => fmtAmt(t[s][h]),
      td: h === 'tax' ? 'font-medium' : undefined,
    }));
    if (many) add({ id: 'month', band: 'doc', head: 'Month', sortKey: 'period', width: 70, cell: (r) => monthLabel(r.period), td: 'whitespace-nowrap' });
    add({
      id: 'supplier', band: 'doc', head: 'Supplier', sortKey: 'supplier', width: 180,
      cell: (r) => (
        <>
          <div className="truncate font-medium" title={r.supplierName || undefined}>{r.supplierName || <span className="text-muted-foreground">Imports (no GSTIN)</span>}</div>
          {r.ctin && <div className="font-mono text-[10.5px] leading-tight text-muted-foreground">{r.ctin}</div>}
        </>
      ),
    });
    add({
      id: 'number', band: 'doc', head: 'Doc no. / type', sortKey: 'number', width: 128, title: 'Document number, and its type under it',
      cell: (r) => (
        <>
          <div className="truncate font-mono text-[11px]" title={r.number}>{r.number}</div>
          <div className={cn('truncate text-[10.5px] leading-tight', r.family === 'CN' || r.family === 'DN' || r.isAmendment ? 'font-medium text-primary' : 'text-muted-foreground')} title={r.docType}>{r.docType}</div>
        </>
      ),
    });
    add({
      id: 'date', band: 'doc', head: 'Doc date', sortKey: 'date', width: 88, td: 'whitespace-nowrap tabular-nums',
      cell: (r) => (r.dateDiffers
        ? <span title={`The dates differ: ${L} ${fmtIso(r.left?.date)}, ${R} ${fmtIso(r.right?.date)}`}>{fmtIso(r.date)}<span className="ml-0.5 font-semibold text-destructive-strong">≠</span></span>
        : fmtIso(r.date)),
    });
    if (opt.has('section')) add({ id: 'section', band: 'doc', head: 'Section', sortKey: 'section', width: 66, cell: (r) => r.section });
    if (opt.has('rate')) add({ id: 'rate', band: 'doc', head: 'Rate', width: 62, numeric: true, cell: (r) => { const k = rateKey(r); return k === 'none' ? '' : k === 'mixed' ? 'Mixed' : facetLabel('rate', k, data); } });
    side('left');
    if (opt.has('filedOn')) add({ id: 'filed', band: 'left', head: 'Filed on', sortKey: 'filedOn', width: 88, cell: (r) => fmtIso(r.left?.supplierFiledOn), td: 'whitespace-nowrap tabular-nums' });
    side('right');
    add({ id: 'itc', band: 'right', head: 'ITC', sortKey: 'itc', width: 78, title: `Whether the ${R} gives the ITC`, cell: (r) => itcCell(r.right), td: 'whitespace-nowrap' });
    for (const h of heads) {
      add({
        id: `diff-${h}`, band: 'diff', head: HEAD_LABEL[h], numeric: true, width: AMOUNT_W[h] - 6,
        sortKey: h === 'taxable' ? 'diffTaxable' : h === 'tax' ? 'diffTax' : undefined,
        title: `${HEAD_LABEL[h]}: ${R} minus ${L}`,
        cell: (r) => diffCell(r.diff ? r.diff[h] : null, tol),
        total: (t) => diffCell(t.diff[h], tol),
      });
    }
    add({ id: 'status', band: 'reco', head: 'Status', sortKey: 'status', width: 100, cell: (r) => <span className={STATUS_PILL[r.status]}>{r.statusLabel}</span> });
    add({
      id: 'reason', band: 'reco', head: 'Reason', sortKey: 'reason',
      // The label on the first line, the row's own sentence under it (rows are two lines tall anyway).
      cell: (r) => (
        <div title={r.reasonText}>
          <div className="truncate font-medium">
            {r.confirmed === false && <span className="mr-1 rounded border border-warning/60 bg-warning/15 px-1 text-[10px] font-medium">not confirmed</span>}
            {r.reasonLabel}
          </div>
          {r.detail && <div className="truncate text-[11px] leading-tight text-muted-foreground">{r.detail}</div>}
        </div>
      ),
    });
    if (opt.has('evidence')) add({ id: 'evidence', band: 'reco', head: 'Evidence', width: 220, cell: (r) => <div className="truncate" title={r.evidence}>{r.evidence}</div> });
    if (opt.has('action')) add({ id: 'action', band: 'reco', head: 'What to do', width: 260, cell: (r) => <div className="truncate" title={r.action}>{r.action}</div> });
    if (opt.has('notes')) add({ id: 'notes', band: 'reco', head: 'Also note', width: 180, cell: (r) => <div className="truncate" title={r.notes.map((x) => x.text).join('\n')}>{r.notes.map((x) => x.label).join('; ')}</div> });
    return out;
  }, [opt, many, L, R, tol, data]);

  // The band heading row: one cell per run of columns in the same band.
  const bands = useMemo(() => {
    const label: Record<Band, string> = { doc: 'Document', left: `GSTR-${L}`, right: `GSTR-${R}`, diff: `Difference (${R} minus ${L})`, reco: 'Reconciliation' };
    const out: { band: Band; label: string; span: number }[] = [];
    for (const c of cols) {
      const last = out[out.length - 1];
      if (last && last.band === c.band) last.span += 1;
      else out.push({ band: c.band, label: label[c.band], span: 1 });
    }
    return out;
  }, [cols, L, R]);
  const docSpan = cols.findIndex((c) => c.band !== 'doc');
  // Every column but Reason has its width; the table never gets narrower than they need.
  const minWidth = 26 + cols.reduce((s, c) => s + (c.width ?? 200), 0);

  const toggle = useCallback((id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; }), []);
  const rowOf = (e: React.SyntheticEvent) => (e.target as HTMLElement).closest<HTMLElement>('tr[data-row]');
  const onClick = (e: React.MouseEvent) => { const tr = rowOf(e); if (tr?.dataset.row) toggle(tr.dataset.row); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = rowOf(e);
    if (!tr?.dataset.row || e.target !== tr) return;
    e.preventDefault();
    toggle(tr.dataset.row);
  };
  const toggleOpt = (k: Optional) => setOpt((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const sortLabel = sort ? `${cols.find((c) => c.sortKey === sort.key)?.head ?? sort.key}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : 'month, status, supplier, date';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {pageSize && sorted.length > pageSize
            ? <>Rows <b className="font-semibold tabular-nums text-foreground">{fmtCountPlain(from + 1)}–{fmtCountPlain(Math.min(from + pageSize, sorted.length))}</b> of {fmtCountPlain(sorted.length)}</>
            : <>{fmtCountPlain(sorted.length)} document{sorted.length === 1 ? '' : 's'}</>}
          <span className="ml-2">· sorted by {sortLabel}</span>
          <span className="ml-2">· click a row for both documents in full</span>
          {open.size > 0 && (
            <button type="button" className="ml-2 font-medium text-primary hover:underline" onClick={() => setOpen(new Set())}>Close {open.size} open row{open.size === 1 ? '' : 's'}</button>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className={cn(WS_BTN, 'h-7')} aria-label="Choose columns">
                <Columns3 className="h-3.5 w-3.5" /> Columns{opt.size > 0 && <span className="tabular-nums text-muted-foreground">+{opt.size}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <div className="px-1 pb-1.5 text-xs font-semibold">More columns</div>
              {OPTIONAL.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs hover:bg-muted">
                  <Checkbox checked={opt.has(o.key)} onCheckedChange={() => toggleOpt(o.key)} className="h-3.5 w-3.5" />
                  {o.label}
                </label>
              ))}
            </PopoverContent>
          </Popover>
          <div role="group" aria-label="Rows per page" className="inline-flex h-7 items-center rounded-md border bg-card p-0.5">
            {PAGE_SIZES.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={pageSize === x}
                onClick={() => setPageSize(x)}
                className={cn('h-6 rounded-sm px-2 text-[11px] font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', pageSize === x ? 'bg-primary text-primary-foreground' : 'text-foreground/75 hover:bg-muted')}
              >
                {x || 'All'}
              </button>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[78px] text-center tabular-nums text-muted-foreground">Page {Math.min(page, pages - 1) + 1} of {pages}</span>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} aria-label="Next page">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="relative max-h-[70vh] overflow-auto rounded-md border bg-card">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]" style={{ minWidth }} aria-label="Documents" aria-rowcount={sorted.length}>
          <colgroup>
            <col style={{ width: 26 }} />
            {cols.map((c) => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}
          </colgroup>
          <thead ref={headRef}>
            <tr>
              <th rowSpan={2} className="sticky top-0 z-20 border-b border-r bg-muted" aria-label="Open" />
              {bands.map((b, i) => (
                <th
                  key={`${b.band}${i}`}
                  colSpan={b.span}
                  scope="colgroup"
                  className={cn(
                    'sticky top-0 z-20 h-7 overflow-hidden text-ellipsis whitespace-nowrap border-b border-r px-1.5 text-center text-[11.5px] font-semibold',
                    // Opaque (rows scroll under a sticky heading), the band's tint laid over the card colour.
                    b.band === 'left' || b.band === 'right' ? 'bg-card text-primary shadow-[inset_0_0_0_999px_hsl(var(--primary)/0.12)]'
                      : b.band === 'diff' ? 'bg-card text-destructive-strong shadow-[inset_0_0_0_999px_hsl(var(--destructive)/0.08)]' : 'bg-muted text-foreground/70',
                  )}
                >
                  {b.label}
                </th>
              ))}
            </tr>
            <tr>
              {cols.map((c) => (c.sortKey ? (
                <SortHead key={c.id} label={c.head} sortKey={c.sortKey} sort={sort} onSort={setSort} numeric={c.numeric} title={c.title} className="sticky top-7 z-20" />
              ) : (
                <th key={c.id} scope="col" title={c.title} className={cn('sticky top-7 z-20 border-b border-r bg-muted px-1.5 py-1.5 text-[12px] font-semibold text-foreground/75 whitespace-nowrap', c.numeric ? 'text-right' : 'text-left')}>{c.head}</th>
              )))}
            </tr>
          </thead>
          <tbody ref={bodyRef} onClick={onClick} onKeyDown={onKeyDown}>
            {range.before > 0 && <tr aria-hidden="true"><td colSpan={cols.length + 1} className="p-0" style={{ height: range.before }} /></tr>}
            {visible.map((r) => <Row key={r.id} r={r} cols={cols} isOpen={open.has(r.id)} span={cols.length + 1} data={data} />)}
            {range.after > 0 && <tr aria-hidden="true"><td colSpan={cols.length + 1} className="p-0" style={{ height: range.after }} /></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={docSpan + 1} className={FOOT}>
                TOTAL <span className="font-normal text-muted-foreground">({fmtCountPlain(rows.length)} document{rows.length === 1 ? '' : 's'}{pageSize && rows.length > pageSize ? ', all pages' : ''})</span>
              </td>
              {cols.slice(docSpan).map((c) => (
                <td key={c.id} className={cn(FOOT, c.numeric && 'text-right tabular-nums whitespace-nowrap')}>
                  {c.total ? c.total(totals) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
