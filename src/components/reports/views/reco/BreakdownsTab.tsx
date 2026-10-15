// The filtered documents cut four more ways: by document type, by section, by
// where the right-hand statement puts the ITC, and by rate (the right-hand
// document's, else the left's). Each line is a facet value of the filter bar,
// so clicking it applies that filter and opens the documents.
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { docTypeKey, facetLabel, facetName, facetOptions, itcKey, rateKey, type Facet } from '@/lib/itcReco/filters';
import { groupBy } from '@/lib/itcReco/viewModel';
import type { GroupLine, RecoViewData, RecoViewRow } from '@/lib/itcReco/viewTypes';
import { CountCell, DiffText, EmptyLine } from './shared';
import { T, fmtAmt, fmtCount } from './format';

const CUTS: { facet: Facet; key: (r: RecoViewRow) => string }[] = [
  { facet: 'docType', key: docTypeKey },
  { facet: 'section', key: (r) => r.section || '' },
  { facet: 'itc', key: itcKey },
  { facet: 'rate', key: rateKey },
];

/** "document type", but "ITC in 2B" keeps its capitals. */
const lowerFirst = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

const Cut: React.FC<{
  data: RecoViewData; facet: Facet; lines: GroupLine[]; selected: string[]; onPick: (facet: Facet, key: string) => void;
}> = ({ data, facet, lines, selected, onPick }) => {
  const L = data.left.label;
  const R = data.right.label;
  const total = lines.reduce((t, l) => ({
    rows: t.rows + l.rows, matched: t.matched + l.counts.matched, only_left: t.only_left + l.counts.only_left, only_right: t.only_right + l.counts.only_right,
    differs: t.differs + l.counts.differs + l.counts.itc_differs, not_compared: t.not_compared + l.counts.not_compared,
    leftTax: t.leftTax + l.leftTax, rightTax: t.rightTax + l.rightTax, diff: t.diff + l.diff,
  }), { rows: 0, matched: 0, only_left: 0, only_right: 0, differs: 0, not_compared: 0, leftTax: 0, rightTax: 0, diff: 0 });
  const heads = [facetName(facet, data), 'Docs', 'Matched', `Only ${L}`, `Only ${R}`, 'Differ', 'Not comp.', `${L} tax`, `${R} tax`, 'Difference'];
  return (
    <section className="min-w-0 space-y-1.5" aria-label={`By ${lowerFirst(facetName(facet, data))}`}>
      <h3 className="text-[13px] font-semibold">By {lowerFirst(facetName(facet, data))}</h3>
      <div className="overflow-auto rounded-md border bg-card">
        <table className={T.table}>
          <thead>
            <tr>{heads.map((h, i) => <th key={h} scope="col" className={cn(T.th, 'static', i > 0 && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const picked = selected.includes(l.key);
              return (
                <tr
                  key={l.key}
                  tabIndex={0}
                  onClick={() => onPick(facet, l.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(facet, l.key); } }}
                  title="Show only these documents"
                  className={cn('cursor-pointer hover:bg-primary/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary', picked && 'bg-primary/[0.07]')}
                >
                  <td className={cn(T.td, 'whitespace-nowrap font-medium')}>{l.label}</td>
                  <td className={cn(T.num, 'font-medium')}>{fmtCount(l.rows)}</td>
                  <CountCell n={l.counts.matched} status="matched" />
                  <CountCell n={l.counts.only_left} status="only_left" />
                  <CountCell n={l.counts.only_right} status="only_right" />
                  <CountCell n={l.counts.differs + l.counts.itc_differs} status="differs" />
                  <CountCell n={l.counts.not_compared} status="not_compared" />
                  <td className={T.num}>{fmtAmt(l.leftTax)}</td>
                  <td className={T.num}>{fmtAmt(l.rightTax)}</td>
                  <td className={T.num}><DiffText v={l.diff} tolerance={data.tolerance} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="border-r border-t-2 border-t-foreground/30 bg-muted px-2 py-1.5 font-semibold">TOTAL</td>
              {[total.rows, total.matched, total.only_left, total.only_right, total.differs, total.not_compared].map((v, i) => (
                <td key={i} className="border-r border-t-2 border-t-foreground/30 bg-muted px-2 py-1.5 text-right font-semibold tabular-nums">{fmtCount(v)}</td>
              ))}
              <td className="border-r border-t-2 border-t-foreground/30 bg-muted px-2 py-1.5 text-right font-semibold tabular-nums">{fmtAmt(total.leftTax)}</td>
              <td className="border-r border-t-2 border-t-foreground/30 bg-muted px-2 py-1.5 text-right font-semibold tabular-nums">{fmtAmt(total.rightTax)}</td>
              <td className="border-r border-t-2 border-t-foreground/30 bg-muted px-2 py-1.5 text-right font-semibold"><DiffText v={Math.round(total.diff * 100) / 100} tolerance={data.tolerance} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
};

export const BreakdownsTab: React.FC<{
  data: RecoViewData;
  rows: RecoViewRow[];
  selected: (facet: Facet) => string[];
  onPick: (facet: Facet, key: string) => void;
}> = ({ data, rows, selected, onPick }) => {
  const cuts = useMemo(() => CUTS.map(({ facet, key }) => {
    // In the filter bar's order (invoices before notes, 5% before 18% …), not by size.
    const order = facetOptions(data, facet).map((o) => o.value);
    const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
    const lines = groupBy(rows, key, (r) => facetLabel(facet, key(r), data)).sort((a, b) => rank(a.key) - rank(b.key));
    return { facet, lines };
  }), [rows, data]);
  if (!rows.length) return <EmptyLine>No documents are shown.</EmptyLine>;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Click a line to apply it as a filter and see its documents.</p>
      <div className="grid gap-4 min-[1800px]:grid-cols-2">
        {cuts.map((c) => <Cut key={c.facet} data={data} facet={c.facet} lines={c.lines} selected={selected(c.facet)} onPick={onPick} />)}
      </div>
    </div>
  );
};
