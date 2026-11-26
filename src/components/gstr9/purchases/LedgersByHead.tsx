import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { DEFAULT_HEAD, EXPENSE_HEAD_LABEL, EXPENSE_HEAD_ROW, resolveHead, rowTax, totalTax } from '@/lib/gstr9/engine';
import type { ExpenseHead, InputSection, PurchaseRow } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { SectionCard } from '../ui';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { displayCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { FigLink } from '../figure/FigLink';
import { purchasesLedger } from '../figure/targetsReco';

// Purchases › 9C heads, part two: every P&L ledger with its GSTR-9C Table 14
// head, editable. This is the one place a ledger's head is changed besides its
// own section grid; ITC reco › 9C Table 14 shows the result and links here.

/** URL param holding the head filter, so a Table 14 row can open its own ledgers (?purchasestab=heads&head=freight). */
export const HEAD_FILTER_PARAM = 'head';

const SECTION_LABEL: Record<InputSection, string> = {
  purchase: 'Purchase',
  expense: 'Expense',
  capital_goods: 'Capital goods',
};

const HEAD_ORDER = Object.keys(EXPENSE_HEAD_LABEL) as ExpenseHead[];
const HEAD_OPTIONS = HEAD_ORDER.map((h) => ({ value: h, label: EXPENSE_HEAD_LABEL[h] }));
const MAX_HEIGHT = 'max(360px, calc(100vh - 300px))';

type Filter = ExpenseHead | 'all';

export const LedgersByHead: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const raw = params.get(HEAD_FILTER_PARAM);
  const filter: Filter = raw && (HEAD_ORDER as string[]).includes(raw) ? (raw as ExpenseHead) : 'all';
  const setFilter = (f: Filter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (f === 'all') next.delete(HEAD_FILTER_PARAM);
        else next.set(HEAD_FILTER_PARAM, f);
        return next;
      },
      { replace: true },
    );

  const ledgers = docs.purchases.rows;
  const counts = useMemo(() => {
    const c: Partial<Record<ExpenseHead, number>> = {};
    ledgers.forEach((r) => {
      const h = resolveHead(r);
      c[h] = (c[h] ?? 0) + 1;
    });
    return c;
  }, [ledgers]);

  // ------------------------------------------------------------ ledgers by head
  const visible = filter === 'all' ? ledgers : ledgers.filter((r) => resolveHead(r) === filter);
  const calc = workings.purchases.rows;
  const itcOf = (r: PurchaseRow) => totalTax(calc[r.id]?.tax ?? rowTax(r));
  const columns: GridColumn<PurchaseRow>[] = [
    { key: 'ledger', header: 'Ledger', type: 'display', align: 'left', width: 260, sticky: true, value: (r) => r.ledger || '(unnamed ledger)' },
    { key: 'section', header: 'Section', type: 'display', align: 'left', width: 110, value: (r) => SECTION_LABEL[r.section] ?? r.section },
    // Figures from the ledger's Purchases section grid (figure/targetsReco.ts); only the head is set here.
    {
      ...displayCol<PurchaseRow>('taxable', 'Taxable value', (r) => r.taxable, { width: 132 }),
      render: (r) => <FigLink to={purchasesLedger(r.section, r.id, 'taxable')}>{fmtMoney(r.taxable)}</FigLink>,
    },
    {
      ...displayCol<PurchaseRow>('itc', 'ITC (total)', (r) => itcOf(r), { width: 120 }),
      render: (r) => <FigLink to={purchasesLedger(r.section, r.id)}>{fmtMoney(itcOf(r))}</FigLink>,
    },
    {
      key: 'head',
      header: '9C head',
      type: 'select',
      width: 260,
      options: HEAD_OPTIONS,
      blankLabel: '— Section default',
      value: (r) => r.head,
      placeholder: (r) => `${EXPENSE_HEAD_LABEL[DEFAULT_HEAD[r.section]]} (section default)`,
      title: () => 'Pick the GSTR-9C Table 14 head. Clear it (—) to follow the section default.',
      onEdit: (r, e) => ({ ...r, head: HEAD_OPTIONS.find((o) => o.value === e.text)?.value ?? null }),
    },
  ];
  const onRowsChange = (next: PurchaseRow[]) => {
    const byId = new Map(next.map((r) => [r.id, r]));
    update('purchases', (d) => ({ ...d, rows: d.rows.map((r) => byId.get(r.id) ?? r) }));
  };
  const visTaxable = visible.reduce((s, r) => s + (Number.isFinite(r.taxable) ? r.taxable : 0), 0);
  const visItc = visible.reduce((s, r) => s + itcOf(r), 0);

  return (
    <SectionCard
      title="Ledgers by head"
      description="Every purchase, expense and capital-goods ledger. Change a ledger's 9C head here; untagged ledgers follow their section's default."
      excelRef="PL-INPUT → GSTR 9C"
    >
      {ledgers.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter ledgers by 9C head">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All · {ledgers.length}
          </FilterChip>
          {HEAD_ORDER.filter((h) => counts[h] || filter === h).map((h) => (
            <FilterChip key={h} active={filter === h} onClick={() => setFilter(h)}>
              {EXPENSE_HEAD_ROW[h]} · {EXPENSE_HEAD_LABEL[h].replace(/^[A-Z] · /, '')} · {counts[h] ?? 0}
            </FilterChip>
          ))}
        </div>
      )}
      <SheetGrid<PurchaseRow>
        label="P&L ledgers by GSTR-9C expense head"
        rows={visible}
        columns={columns}
        getRowId={(r) => r.id}
        readOnly={readOnly}
        onRowsChange={onRowsChange}
        maxHeight={MAX_HEIGHT}
        emptyText={
          ledgers.length === 0 ? (
            'No P&L ledgers yet. Enter them in sections (A)–(C) of this step.'
          ) : (
            'No ledgers under this head.'
          )
        }
        footer={visible.length ? [{ key: 'total', label: filter === 'all' ? 'Total' : `Total · ${EXPENSE_HEAD_LABEL[filter]}`, tone: 'total', cells: { taxable: visTaxable, itc: visItc } }] : undefined}
      />
    </SectionCard>
  );
};

const FilterChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted',
    )}
  >
    {children}
  </button>
);

