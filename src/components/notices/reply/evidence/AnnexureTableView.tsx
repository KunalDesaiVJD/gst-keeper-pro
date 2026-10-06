// One annexure table as staff see it: grouped headers (GSTR-1 | GSTR-3B |
// Difference), a source column with a chip per source, a month that could not
// be compared as one muted line, totals in the house total style. Wide tables
// scroll inside their frame, never the page.
import React from 'react';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TH_GROUP, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { fmtAmount } from './look';
import type { AnnexureColumn, AnnexureTable, CellValue } from '@/lib/reply';
import { cn } from '@/lib/utils';
import { SourceChips } from './SourceChips';

const cell = (c: AnnexureColumn, v: CellValue) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.kind === 'money' && typeof v === 'number') return fmtAmount(v);
  if (c.kind === 'int' && typeof v === 'number') return v.toLocaleString('en-IN');
  return String(v);
};

function groups(cols: AnnexureColumn[]): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = [];
  for (const c of cols) {
    const last = out[out.length - 1];
    const label = c.group ?? '';
    if (last && label && last.label === label) last.span += 1;
    else out.push({ label, span: 1 });
  }
  return out;
}

export const AnnexureTableView: React.FC<{ table: AnnexureTable; caption?: boolean }> = ({ table, caption = true }) => {
  const grouped = table.columns.some((c) => c.group);
  const tall = table.rows.length > 14;
  return (
    <div className="space-y-1">
      {caption && (
        <div>
          <h4 className="text-sm font-semibold">{table.title}</h4>
          {table.note && <p className="text-xs text-muted-foreground">{table.note}</p>}
        </div>
      )}
      <div className={cn(WS_TABLE_WRAP, tall && 'max-h-[30rem]')} tabIndex={0} role="region" aria-label={table.title}>
        <table className={WS_TABLE}>
          <thead>
            {grouped && (
              <tr>
                {groups(table.columns).map((g, i) => (
                  g.label
                    ? <th key={i} scope="colgroup" colSpan={g.span} className={cn(WS_TH_GROUP, 'sticky top-0 z-10 text-xs')}>{g.label}</th>
                    : <td key={i} colSpan={g.span} className="sticky top-0 z-10 border-b border-r bg-muted" />
                ))}
                <td className="sticky top-0 z-10 border-b bg-muted" />
              </tr>
            )}
            <tr>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={cn(WS_TH, grouped && 'top-[1.6rem]', (c.kind === 'money' || c.kind === 'int') && 'text-right')}>{c.label}</th>
              ))}
              <th scope="col" className={cn(WS_TH, grouped && 'top-[1.6rem]')}>Source</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className={cn(r.kind === 'total' ? WS_TR_TOTAL : WS_TR, r.kind === 'missing' && 'italic text-foreground/70')}>
                {table.columns.map((c) => (
                  <td key={c.key} className={cn(c.kind === 'money' || c.kind === 'int' ? WS_TD_NUM : WS_TD, c.key === 'treatment' || c.key === 'item' ? 'min-w-[16rem] text-xs' : c.kind === 'text' ? 'whitespace-nowrap text-xs' : '')}>
                    {cell(c, r.cells[c.key] ?? null)}
                  </td>
                ))}
                <td className={cn(WS_TD, 'min-w-[9rem]')}><SourceChips sources={r._source} total={r.kind === 'total'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AnnexureTableView;
