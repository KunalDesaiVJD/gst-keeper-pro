// The filtered documents by supplier: how many each has on each side, how
// they reconcile, and the tax on both sides with the difference. Clicking a
// supplier narrows every tab to it and opens its documents; the arrow opens
// its documents here, compactly, without leaving the list.
import React, { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { monthLabel } from '@/lib/itcReco/dates';
import { defaultOrder, supplierKey } from '@/lib/itcReco/filters';
import { bySupplier } from '@/lib/itcReco/viewModel';
import type { RecoViewData, RecoViewRow, SupplierLine } from '@/lib/itcReco/viewTypes';
import { CountCell, DiffText, EmptyLine, SortHead, StatusBadge } from './shared';
import { T, fmtAmt, fmtCount, fmtCountPlain, fmtIso, type SortDir } from './format';

type Key = 'name' | 'ctin' | 'rows' | 'leftDocs' | 'rightDocs' | 'matched' | 'only_left' | 'only_right' | 'differs' | 'not_compared' | 'leftTax' | 'rightTax' | 'diff' | 'absDiff';

const TEXT = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const valueOf = (s: SupplierLine, k: Key): number | string => {
  switch (k) {
    case 'name': return s.name || '￿';
    case 'ctin': return s.ctin || '￿';
    case 'matched': case 'only_left': case 'only_right': case 'not_compared': return s.counts[k];
    case 'differs': return s.counts.differs + s.counts.itc_differs;
    case 'absDiff': return Math.abs(s.diff);
    default: return s[k];
  }
};

export const SuppliersTab: React.FC<{
  data: RecoViewData;
  rows: RecoViewRow[];
  selected: string[];
  onPick: (key: string) => void;
}> = ({ data, rows, selected, onPick }) => {
  const L = data.left.label;
  const R = data.right.label;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: Key; dir: SortDir } | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const lines = useMemo(() => bySupplier(rows), [rows]);
  const docsOf = useMemo(() => {
    const m = new Map<string, RecoViewRow[]>();
    for (const r of rows) { const k = supplierKey(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
    for (const a of m.values()) a.sort(defaultOrder);
    return m;
  }, [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = needle ? lines.filter((s) => s.name.toLowerCase().includes(needle) || s.ctin.toLowerCase().includes(needle)) : lines;
    if (!sort) return hit;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...hit].sort((a, b) => {
      const x = valueOf(a, sort.key); const y = valueOf(b, sort.key);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : TEXT.compare(String(x), String(y));
      return c * dir || a.name.localeCompare(b.name);
    });
  }, [lines, q, sort]);
  const total = useMemo(() => {
    const t = { rows: 0, leftDocs: 0, rightDocs: 0, matched: 0, only_left: 0, only_right: 0, differs: 0, not_compared: 0, leftTax: 0, rightTax: 0, diff: 0 };
    for (const s of shown) {
      t.rows += s.rows; t.leftDocs += s.leftDocs; t.rightDocs += s.rightDocs;
      t.matched += s.counts.matched; t.only_left += s.counts.only_left; t.only_right += s.counts.only_right;
      t.differs += s.counts.differs + s.counts.itc_differs; t.not_compared += s.counts.not_compared;
      t.leftTax += s.leftTax; t.rightTax += s.rightTax; t.diff += s.diff;
    }
    return t;
  }, [shown]);

  if (!lines.length) return <EmptyLine>No supplier: no documents are shown.</EmptyLine>;
  const keyOf = (s: SupplierLine) => s.ctin || `~${s.name}`;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const head = (label: string, key: Key, numeric = true, title?: string) => <SortHead label={label} sortKey={key} sort={sort} onSort={setSort} numeric={numeric} title={title} className="sticky top-0 z-20" />;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a supplier by name or GSTIN…" aria-label="Find a supplier" className="h-7 pl-8 text-xs md:text-xs" />
        </div>
        <span className="text-muted-foreground">
          {q.trim() ? `${fmtCountPlain(shown.length)} of ${fmtCountPlain(lines.length)} suppliers` : `${fmtCountPlain(lines.length)} supplier${lines.length === 1 ? '' : 's'}`}
          {!sort && ' · largest difference first'} · click a supplier to see only its documents
        </span>
      </div>
      <div className={T.wrap}>
        <table className={T.table} aria-label="By supplier">
          <thead>
            <tr>
              <th className="sticky top-0 z-20 w-6 border-b border-r bg-muted" aria-label="Open" />
              {head('Supplier', 'name', false)}
              {head('GSTIN', 'ctin', false)}
              {head('Docs', 'rows')}
              {head(`In ${L}`, 'leftDocs', true, `Documents in the ${L}`)}
              {head(`In ${R}`, 'rightDocs', true, `Documents in the ${R}`)}
              {head('Matched', 'matched')}
              {head(`Only ${L}`, 'only_left', true, `Only in ${L}`)}
              {head(`Only ${R}`, 'only_right', true, `Only in ${R}`)}
              {head('Differ', 'differs', true, 'Figures or ITC differ')}
              {head('Not comp.', 'not_compared', true, 'Not compared')}
              {head(`${L} tax`, 'leftTax')}
              {head(`${R} tax`, 'rightTax')}
              {head(`Difference`, 'absDiff', true, `${R} minus ${L}, over the compared documents (sorts by size)`)}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const k = keyOf(s);
              const isOpen = open.has(k);
              const picked = selected.includes(k);
              const docs = isOpen ? docsOf.get(k) ?? [] : [];
              return (
                <React.Fragment key={k}>
                  <tr
                    tabIndex={0}
                    onClick={() => onPick(k)}
                    onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter') { e.preventDefault(); onPick(k); } }}
                    title="Show only this supplier's documents"
                    className={cn('cursor-pointer hover:bg-primary/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary', picked && 'bg-primary/[0.07]')}
                  >
                    <td className="border-b border-r p-0 text-center">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} the documents of ${s.name || s.ctin}`}
                        onClick={(e) => { e.stopPropagation(); toggle(k); }}
                        className="flex h-full w-full items-center justify-center px-1 py-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90 text-primary')} />
                      </button>
                    </td>
                    <td className={cn(T.td, 'max-w-[300px] truncate font-medium')} title={s.name}>{s.name || <span className="text-muted-foreground">Imports (no GSTIN)</span>}</td>
                    <td className={cn(T.td, 'whitespace-nowrap font-mono text-[11px] text-muted-foreground')}>{s.ctin}</td>
                    <td className={cn(T.num, 'font-medium')}>{fmtCount(s.rows)}</td>
                    <td className={T.num}>{fmtCount(s.leftDocs)}</td>
                    <td className={T.num}>{fmtCount(s.rightDocs)}</td>
                    <CountCell n={s.counts.matched} status="matched" />
                    <CountCell n={s.counts.only_left} status="only_left" />
                    <CountCell n={s.counts.only_right} status="only_right" />
                    <CountCell n={s.counts.differs + s.counts.itc_differs} status="differs" />
                    <CountCell n={s.counts.not_compared} status="not_compared" />
                    <td className={T.num}>{fmtAmt(s.leftTax)}</td>
                    <td className={T.num}>{fmtAmt(s.rightTax)}</td>
                    <td className={T.num}><DiffText v={s.diff} tolerance={data.tolerance} /></td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={14} className="border-b bg-muted/30 px-3 py-2">
                        <table className="w-full border-separate border-spacing-0 rounded border bg-card text-[11.5px]" aria-label={`Documents of ${s.name || s.ctin}`}>
                          <thead>
                            <tr className="text-left text-[11px] text-muted-foreground">
                              {(data.periods.length > 1 ? ['Month'] : []).concat(['Doc no.', 'Date', 'Type', `${L} tax`, `${R} tax`, 'Difference', 'Status', 'Reason']).map((h) => (
                                <th key={h} className={cn('border-b bg-muted/60 px-2 py-1 font-semibold', /tax|Difference/.test(h) && 'text-right')}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {docs.map((d) => (
                              <tr key={d.id}>
                                {data.periods.length > 1 && <td className="border-b px-2 py-0.5 whitespace-nowrap">{monthLabel(d.period)}</td>}
                                <td className="border-b px-2 py-0.5 font-mono">{d.number}</td>
                                <td className="border-b px-2 py-0.5 whitespace-nowrap tabular-nums">{fmtIso(d.date)}</td>
                                <td className="border-b px-2 py-0.5 whitespace-nowrap">{d.docType}</td>
                                <td className="border-b px-2 py-0.5 text-right tabular-nums">{fmtAmt(d.left ? d.left.tax : null)}</td>
                                <td className="border-b px-2 py-0.5 text-right tabular-nums">{fmtAmt(d.right ? d.right.tax : null)}</td>
                                <td className="border-b px-2 py-0.5 text-right"><DiffText v={d.diff ? d.diff.tax : null} tolerance={data.tolerance} /></td>
                                <td className="border-b px-2 py-0.5"><StatusBadge status={d.status} label={d.statusLabel} /></td>
                                <td className="max-w-[360px] truncate border-b px-2 py-0.5" title={d.reasonText}>{d.reasonLabel}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3} className={cn(T.total, 'border-r px-2 py-1.5')}>TOTAL <span className="font-normal text-muted-foreground">({fmtCountPlain(shown.length)} suppliers)</span></td>
              {[total.rows, total.leftDocs, total.rightDocs, total.matched, total.only_left, total.only_right, total.differs, total.not_compared].map((v, i) => (
                <td key={i} className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtCount(v)}</td>
              ))}
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtAmt(total.leftTax)}</td>
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right tabular-nums')}>{fmtAmt(total.rightTax)}</td>
              <td className={cn(T.total, 'border-r px-2 py-1.5 text-right')}><DiffText v={Math.round(total.diff * 100) / 100} tolerance={data.tolerance} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
