import React, { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { DEFAULT_HEAD, EXPENSE_HEAD_LABEL, EXPENSE_HEAD_ROW, maxAbs, resolveHead, rowTax, totalTax } from '@/lib/gstr9/engine';
import type { ExpenseHead, InputSection, PurchaseRow, Tax, ValTax } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, KpiTile, Note, OpenDifferences, SectionCard } from '../ui';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { diffTone, displayCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import ExportMenu from '../ExportMenu';
import { FigureTable, type FigColumn, type FigRow } from '../reco/FigureTable';
import { anyValTax, useGoToStep } from '../reco/helpers';

// Step 8 — the firm's "GSTR 9C" sheet: ITC by expense head, feeding GSTR-9C
// Table 14. Every figure is workings.c14; the only input here is the 9C head
// of each P&L ledger (docs.purchases.rows[].head).

/** Rows in the sheet's order, with the sheet's own labels. `head` links a row to its ledgers. */
const C14_ROWS: Array<{ k: string; label: string; head?: ExpenseHead }> = [
  { k: 'A', label: 'PURCHASES', head: 'purchases' },
  { k: 'A1', label: 'SUSPENDED ITC' },
  { k: 'A2', label: 'NET PURCHASE (A − A1)' },
  { k: 'B', label: 'FREIGHT / CARRIAGE', head: 'freight' },
  { k: 'C', label: 'POWER AND FUEL', head: 'power_fuel' },
  { k: 'D', label: 'IMPORTED GOODS (INCLUDING RECEIVED FROM SEZS)', head: 'imported_goods' },
  { k: 'E', label: 'RENT AND INSURANCE', head: 'rent_insurance' },
  { k: 'F', label: 'GOODS LOST, STOLEN, DESTROYED, WRITTEN OFF OR DISPOSED OF BY WAY OF GIFT OR FREE SAMPLES', head: 'goods_lost' },
  { k: 'G', label: 'ROYALTY', head: 'royalty' },
  { k: 'H', label: "EMPLOYEES' COST (SALARIES, BONUS ETC.)", head: 'employees_cost' },
  { k: 'I', label: 'CONVEYANCE CHARGES', head: 'conveyance' },
  { k: 'J', label: 'BANK CHARGES', head: 'bank_charges' },
  { k: 'K', label: 'ENTERTAINMENT CHARGES', head: 'entertainment' },
  { k: 'L', label: 'STATIONERY EXPENSES (INCLUDING POSTAGE ETC.)', head: 'stationery' },
  { k: 'M', label: 'REPAIR AND MAINTENANCE', head: 'repair_maintenance' },
  { k: 'N', label: 'OTHER MISCELLANEOUS EXPENSES', head: 'other_misc' },
  { k: 'O', label: 'CAPITAL GOODS', head: 'capital_goods' },
  { k: 'P', label: 'ANY OTHER EXPENSE 1 (RCM)' },
  { k: 'Q', label: 'ANY OTHER EXPENSE 2', head: 'other2' },
  { k: 'R', label: 'TOTAL AMOUNT OF ELIGIBLE ITC AVAILED' },
];

const COLUMNS: FigColumn[] = [
  { key: 't', header: 'Value', width: 132 },
  { key: 'i', header: 'IGST' },
  { key: 'c', header: 'CGST' },
  { key: 's', header: 'SGST' },
  { key: 'x', header: 'Cess', width: 96 },
  { key: 'tot', header: 'Total tax', width: 124 },
];

const SECTION_LABEL: Record<InputSection, string> = {
  purchase: 'Purchase',
  expense: 'Expense',
  capital_goods: 'Capital goods',
};

const HEAD_ORDER = Object.keys(EXPENSE_HEAD_LABEL) as ExpenseHead[];
const HEAD_OPTIONS = HEAD_ORDER.map((h) => ({ value: h, label: EXPENSE_HEAD_LABEL[h] }));

const figs = (v: Partial<ValTax> | Tax, withValue = true): Record<string, number | null> => ({
  t: withValue && 't' in v ? v.t ?? null : null,
  i: v.i ?? 0,
  c: v.c ?? 0,
  s: v.s ?? 0,
  x: v.x ?? 0,
  tot: totalTax({ i: v.i ?? 0, c: v.c ?? 0, s: v.s ?? 0, x: v.x ?? 0 }),
});

type Filter = ExpenseHead | 'all';

const ExpenseHeadStep: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const goTo = useGoToStep();
  const C = workings.c14;
  const tol = workings.tolerance;
  const [filter, setFilter] = useState<Filter>('all');
  const gridRef = useRef<HTMLDivElement>(null);

  const ledgers = docs.purchases.rows;
  const counts = useMemo(() => {
    const c: Partial<Record<ExpenseHead, number>> = {};
    ledgers.forEach((r) => {
      const h = resolveHead(r);
      c[h] = (c[h] ?? 0) + 1;
    });
    return c;
  }, [ledgers]);

  const showLedgers = (h: ExpenseHead) => {
    setFilter(h);
    requestAnimationFrame(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const balancingFlag = maxAbs(C.qBalancing, true) > tol;
  const checkFlag = maxAbs(C.check, true) > 0.005;
  const tFlag = maxAbs(C.T) > tol;

  // ------------------------------------------------------------ the 9C table
  const rows: FigRow[] = [];
  C14_ROWS.forEach(({ k, label, head }) => {
    const v = C.rows[k];
    if (!v) return;
    const n = head ? counts[head] ?? 0 : 0;
    rows.push({
      key: k,
      code: k,
      label,
      values: figs(v),
      kind: k === 'R' ? 'total' : 'row',
      muted: k !== 'R' && !anyValTax(v),
      note:
        head && n > 0 ? (
          <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => showLedgers(head)}>
            {n} ledger{n === 1 ? '' : 's'}
          </button>
        ) : k === 'A1' ? (
          <span className="text-[10px] text-muted-foreground">Duties &amp; Taxes, net of reclaims</span>
        ) : k === 'P' ? (
          <span className="text-[10px] text-muted-foreground">RCM Part B (books)</span>
        ) : undefined,
    });
    if (k === 'Q') {
      rows.push({ key: 'Q.tagged', kind: 'sub', label: 'Tagged ledgers', values: figs(C.qTagged) });
      rows.push({
        key: 'Q.bal',
        kind: 'sub',
        label: 'Balancing figure',
        values: figs(C.qBalancing),
        tones: balancingFlag ? { t: 'warn', i: 'warn', c: 'warn', s: 'warn', x: 'warn', tot: 'warn' } : undefined,
        note: balancingFlag ? (
          <Badge variant="warning" className="text-[10px] font-normal">
            Above ₹{tol}
          </Badge>
        ) : undefined,
      });
    }
  });
  const checkTones = Object.fromEntries(['t', 'i', 'c', 's', 'x', 'tot'].map((h) => [h, diffTone(figs(C.check)[h] ?? 0, 0)]));
  rows.push(
    { key: 'hchk', kind: 'heading', label: 'Check' },
    { key: 'netItc', label: 'Net ITC as per P&L (PL-INPUT row 79)', values: figs(workings.purchases.netItc) },
    { key: 'check', label: 'Difference — should equal nil', values: figs(C.check), tones: checkTones },
    { key: 'hst', kind: 'heading', label: 'GSTR-9C Table 14 — against GSTR-9' },
    { key: 'S', code: 'S', label: 'ITC claimed in GSTR-9 (7J)', values: figs(C.S, false) },
    {
      key: 'T',
      code: 'T',
      kind: 'total',
      label: 'Un-reconciled ITC (R − S)',
      values: figs(C.T, false),
      tones: Object.fromEntries(['i', 'c', 's', 'x', 'tot'].map((h) => [h, diffTone(figs(C.T, false)[h] ?? 0, tol)])),
      status: workings.diffs.some((d) => d.key === 'gstr9c.14T') ? <JustifyControl lineKey="gstr9c.14T" /> : undefined,
    },
  );

  // ------------------------------------------------------------ ledgers by head
  const visible = filter === 'all' ? ledgers : ledgers.filter((r) => resolveHead(r) === filter);
  const calc = workings.purchases.rows;
  const itcOf = (r: PurchaseRow) => totalTax(calc[r.id]?.tax ?? rowTax(r));
  const columns: GridColumn<PurchaseRow>[] = [
    { key: 'ledger', header: 'Ledger', type: 'display', align: 'left', width: 260, sticky: true, value: (r) => r.ledger || '(unnamed ledger)' },
    { key: 'section', header: 'Section', type: 'display', align: 'left', width: 110, value: (r) => SECTION_LABEL[r.section] ?? r.section },
    displayCol<PurchaseRow>('taxable', 'Taxable value', (r) => r.taxable, { width: 132 }),
    displayCol<PurchaseRow>('itc', 'ITC (total)', (r) => itcOf(r), { width: 120 }),
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
    <div className="space-y-4">
      <OpenDifferences step="expense" />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="R · Eligible ITC by head (total tax)" value={fmtMoney(totalTax(C.rows.R ?? { i: 0, c: 0, s: 0, x: 0 }))} />
        <KpiTile label="S · ITC claimed in GSTR-9, 7J (total tax)" value={fmtMoney(totalTax(C.S))} />
        <KpiTile
          label="T · Un-reconciled (R − S)"
          value={fmtMoney(totalTax(C.T))}
          hint={`IGST ${fmtMoney(C.T.i)} · CGST ${fmtMoney(C.T.c)} · SGST ${fmtMoney(C.T.s)}`}
          tone={tFlag ? 'error' : 'ok'}
        />
      </div>

      <SectionCard
        title="ITC working for GSTR-9C (Table 14)"
        description="ITC of the P&L ledgers by expense head. Row Q takes the untagged expense ledgers plus the balancing figure, so R always ties to the P&L's net ITC."
        excelRef="GSTR 9C B6:H30"
        actions={<ExportMenu only={['excel']} />}
      >
        {workings.ctx.noItcBuilder && (
          <Note>This client is a builder on the no-ITC scheme — nil ITC is expected, and 14T is for information only.</Note>
        )}
        <FigureTable label="GSTR 9C sheet: ITC by expense head" firstHeader="Particulars" columns={COLUMNS} rows={rows} maxHeight="75vh" />
        <div className="grid gap-2 lg:grid-cols-2">
          <Note>
            The sheet picked ledgers by fixed cell references (e.g. E = PL-INPUT D34 + D42 + …), which broke whenever a ledger moved. Here each ledger carries its head — set on the Purchases step or in the grid below. Untagged expense ledgers go to Q.
          </Note>
          <Note tone="position">
            Row P is the books’ RCM Part B with all expense blocks added; the sheet’s RCM D28:D39 adds only two, which understated P’s value.
          </Note>
        </div>
        {balancingFlag && (
          <Note tone="warn">
            Row Q carries a balancing figure beyond ₹{tol} on some head. It usually comes from the “suspended ITC as per Duties &amp; Taxes (other adjustments)” line on the Purchases step (PL-INPUT row 75), which has no ledger of its own. Confirm it before filing.
          </Note>
        )}
        {checkFlag && <Note tone="warn">R should always equal the net ITC as per the P&amp;L, and here it does not — a figure is being lost. Report it before filing.</Note>}
      </SectionCard>

      <div ref={gridRef}>
        <SectionCard
          title="Ledgers by head"
          description="Every purchase, expense and capital-goods ledger from the Purchases step. Change a ledger's 9C head here; untagged ledgers follow their section's default."
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
            maxHeight={480}
            emptyText={
              ledgers.length === 0 ? (
                <span>
                  No P&amp;L ledgers yet.{' '}
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => goTo('purchases')}>
                    Enter them on the Purchases step
                  </Button>
                </span>
              ) : (
                'No ledgers under this head.'
              )
            }
            footer={visible.length ? [{ key: 'total', label: filter === 'all' ? 'Total' : `Total · ${EXPENSE_HEAD_LABEL[filter]}`, tone: 'total', cells: { taxable: visTaxable, itc: visItc } }] : undefined}
          />
        </SectionCard>
      </div>
    </div>
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

export default ExpenseHeadStep;
