import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { maxAbs, OUTWARD_CATEGORY_LABEL, totalTax } from '@/lib/gstr9/engine';
import type { Formulas, Gstr9ManualDoc, OutwardCategory, SalesRow, ValTax } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, KpiTile, Note, OpenDifferences, SectionCard, SourceChip } from '../ui';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { diffTone, displayCol, moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import ExportMenu from '../ExportMenu';
import { FigureTable, type FigColumn, type FigRow } from '../reco/FigureTable';
import { anyValTax, mergePathFormulas, nz, pathFormulas, useGoToStep } from '../reco/helpers';

// Step 6 — GSTR 9-OUTPUT: (A) data as per books vs (B) data auto-populated in
// GSTR-9 (portal system-computed Table 4), and the difference A − B with a
// justification per line. Every figure comes from workings.outward.

type Side = 'books' | 'portal' | 'diff';
type Head = keyof ValTax;

const SIDE_LABEL: Record<Side, string> = {
  books: '(A) As per books',
  portal: '(B) Auto-populated in GSTR-9',
  diff: 'Difference (A − B)',
};

// ---------------------------------------------------------------------------
// Books vs GSTR-9 table
// ---------------------------------------------------------------------------

const ComparisonCard: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const goTo = useGoToStep();
  const out = workings.outward;
  const tol = workings.tolerance;
  const hasPortal = workings.g9.t4Source !== 'none';
  const diffKeys = useMemo(() => new Set(workings.diffs.map((d) => d.key)), [workings.diffs]);
  /** A justification control only for lines the engine actually pushed. */
  const status = (key: string) => (diffKeys.has(key) ? <JustifyControl lineKey={key} /> : <span className="text-muted-foreground">—</span>);
  const typedT4 = Object.keys(docs.portal.manual ?? {}).filter((k) => k.startsWith('gstr9.table4.')).length;

  const showCess = out.rows.some((r) => nz(r.books.x) || nz(r.portal.x));
  const heads: Array<[Head, string]> = [
    ['t', 'Value'],
    ['i', 'IGST'],
    ['c', 'CGST'],
    ['s', 'SGST'],
  ];
  if (showCess) heads.push(['x', 'Cess']);
  const sides: Side[] = hasPortal ? ['books', 'portal', 'diff'] : ['books'];
  const columns: FigColumn[] = sides.flatMap((side) =>
    heads.map(([h, hl]) => ({ key: `${side}.${h}`, header: hl, group: SIDE_LABEL[side], width: h === 't' ? 128 : 108 })),
  );

  const figures = (books: ValTax, portal: ValTax, diff: ValTax) => {
    const values: Record<string, number> = {};
    const tones: FigRow['tones'] = {};
    const bySide: Record<Side, ValTax> = { books, portal, diff };
    sides.forEach((side) =>
      heads.forEach(([h]) => {
        values[`${side}.${h}`] = bySide[side][h];
        if (side === 'diff') tones[`${side}.${h}`] = diffTone(diff[h], tol);
      }),
    );
    return { values, tones };
  };

  const rows: FigRow[] = out.rows.map((r) => {
    const { values, tones } = figures(r.books, r.portal, r.diff);
    const key = `out.${r.key}`;
    return {
      key: r.key,
      code: r.table,
      label: r.subtract ? (
        <>
          {r.label} <span className="font-mono text-destructive" title="Deducted in the total">(−)</span>
        </>
      ) : (
        r.label
      ),
      values,
      tones,
      muted: !anyValTax(r.books) && !anyValTax(r.portal),
      status: hasPortal ? status(key) : undefined,
    };
  });
  const totals = figures(out.booksTotal, out.portalTotal, out.diffTotal);
  const footer: FigRow[] = [
    {
      key: 'total',
      label: 'TOTAL (credit notes deducted)',
      values: totals.values,
      tones: totals.tones,
      status: hasPortal ? status('out.total') : undefined,
    },
  ];

  return (
    <SectionCard
      title="Books vs GSTR-9 auto-populated (Table 4)"
      description="Each line: books on the left, the portal's system-computed GSTR-9 in the middle, the difference and its reason on the right."
      excelRef="GSTR 9-OUTPUT B5:L32"
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            GSTR-9 Table 4 <SourceChip meta={docs.portal.gstr9Meta} manual={!docs.portal.gstr9Meta?.source && typedT4 > 0} />
            {!!docs.portal.gstr9Meta?.source && typedT4 > 0 && <span title="Cells of Table 4 typed over the portal figures on the Portal data step">· {typedT4} typed</span>}
          </span>
          <ExportMenu only={['excel']} />
        </>
      }
    >
      {!hasPortal && (
        <div className="flex flex-col items-start gap-3 rounded-md border border-dashed bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Column (B) is empty — the GSTR-9 auto-populated figures are not in yet.</p>
            <p className="text-xs text-muted-foreground">
              They come only from the GST portal: fetch the GSTR-9 system-computed JSON, upload it, or type Table 4 on the Portal data step. The app’s own GSTR-1 is never used here. Until then only the books side is shown.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {diffKeys.has('out.portal') && <JustifyControl lineKey="out.portal" />}
            <Button size="sm" onClick={() => goTo('portal')}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Open Portal data
            </Button>
          </div>
        </div>
      )}
      <FigureTable
        label="GSTR 9-OUTPUT: books vs GSTR-9 auto-populated"
        columns={columns}
        rows={rows}
        footer={footer}
        withStatus={hasPortal}
        maxHeight="70vh"
      />
      <p className="text-[11px] text-muted-foreground">
        {hasPortal && `Difference is always Books − GSTR-9. Red: beyond the ₹${tol} tolerance on some head — give a reason in Status. `}
        Credit notes (4I) are shown as positive figures and deducted in the total.
        {!showCess && ' Cess columns are hidden (nil throughout).'}
      </p>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Categorise sales ledgers (PL-OUTPUT Part A → Table 4 bucket)
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS = (Object.keys(OUTWARD_CATEGORY_LABEL) as OutwardCategory[]).map((k) => ({ value: k, label: OUTWARD_CATEGORY_LABEL[k] }));

const CategoriseCard: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const goTo = useGoToStep();
  const rows = docs.sales.partA;
  const calc = workings.sales.rows;
  const isReturn = (r: SalesRow) => !!calc[r.id]?.isReturn;

  const counts = useMemo(() => {
    const c: Partial<Record<OutwardCategory | 'cr_nt', number>> = {};
    rows.forEach((r) => {
      const k = calc[r.id]?.isReturn ? 'cr_nt' : r.category;
      c[k] = (c[k] ?? 0) + 1;
    });
    return c;
  }, [rows, calc]);

  const columns: GridColumn<SalesRow>[] = [
    { key: 'ledger', header: 'Ledger', type: 'display', align: 'left', width: 260, sticky: true, value: (r) => r.ledger || '(unnamed ledger)' },
    { key: 'supply', header: 'Supply', type: 'display', align: 'left', width: 96, value: (r) => (r.supplyType === 'inter' ? 'Inter-state' : 'Intra-state') },
    displayCol<SalesRow>('taxable', 'Taxable value', (r) => r.taxable, { width: 132 }),
    displayCol<SalesRow>('tax', 'Total tax', (r) => (calc[r.id] ? totalTax(calc[r.id].tax) : null), { width: 120 }),
    {
      key: 'category',
      header: 'GSTR-9 bucket',
      type: 'select',
      width: 200,
      options: CATEGORY_OPTIONS,
      value: (r) => r.category,
      editable: (r) => !isReturn(r),
      title: (r) => (isReturn(r) ? 'Negative ledger — reported as a credit note (4I) automatically' : 'Type or pick the Table 4 bucket'),
      render: (r) =>
        isReturn(r) ? (
          <span className="italic text-muted-foreground">Credit note (4I) · automatic</span>
        ) : (
          <span>{OUTWARD_CATEGORY_LABEL[r.category] ?? r.category}</span>
        ),
      onEdit: (r, e) => ({ ...r, category: CATEGORY_OPTIONS.find((o) => o.value === e.text)?.value ?? 'b2b' }),
    },
  ];

  const taxableTotal = workings.sales.partATaxable;

  return (
    <SectionCard
      title="Categorise sales ledgers"
      description="Put each taxable income ledger in its GSTR-9 Table 4 bucket so the books side splits the way the portal does."
      excelRef="PL-OUTPUT Part A → GSTR 9-OUTPUT column C"
    >
      <Note tone="position">
        The sheet puts all of PL-OUTPUT Part A into B2B, so the B2C and SEZ rows above show differences that mean nothing. Here each ledger carries a bucket (B2B by default, as the sheet does) and negative ledgers are credit notes (4I). Tagging moves figures between rows — it never changes the total.
      </Note>
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {(Object.keys(OUTWARD_CATEGORY_LABEL) as OutwardCategory[]).map((k) =>
            counts[k] ? (
              <Badge key={k} variant="outline" className="font-normal">
                {OUTWARD_CATEGORY_LABEL[k]} · {counts[k]}
              </Badge>
            ) : null,
          )}
          {counts.cr_nt ? (
            <Badge variant="outline" className="font-normal">
              Credit notes (4I) · {counts.cr_nt}
            </Badge>
          ) : null}
        </div>
      )}
      <SheetGrid<SalesRow>
        label="Sales ledgers by GSTR-9 bucket"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        readOnly={readOnly}
        onRowsChange={(next) => update('sales', (d) => ({ ...d, partA: next }))}
        rowTone={(r) => (isReturn(r) ? 'muted' : undefined)}
        maxHeight={420}
        emptyText={
          <span>
            No taxable income ledgers yet.{' '}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => goTo('sales')}>
              Enter them on the Sales step
            </Button>
          </span>
        }
        footer={rows.length ? [{ key: 'total', label: 'Total Part A', tone: 'total', cells: { taxable: taxableTotal, tax: totalTax(workings.sales.partA) } }] : undefined}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Books-side extras (4F, 4J, 4K, 4L) — rarely used
// ---------------------------------------------------------------------------

type ExtraKey = keyof Gstr9ManualDoc['t4BooksExtra'];
interface ExtraRow {
  id: ExtraKey;
  table: string;
  label: string;
  v: ValTax;
  f?: Formulas;
}

/** Doc-level formula paths for these rows: docs.gstr9.f["t4BooksExtra.<row>.<col>"]. */
const EXTRA_F_ROOT = 't4BooksExtra.';

const EXTRA_ROWS: Array<Omit<ExtraRow, 'v' | 'f'>> = [
  { id: 'at', table: '4F', label: 'Advances on which tax is paid, invoice not issued' },
  { id: 'dr_nt', table: '4J', label: 'Debit notes' },
  { id: 'amd_pos', table: '4K', label: 'Supplies / tax declared through amendments (+)' },
  { id: 'amd_neg', table: '4L', label: 'Supplies / tax reduced through amendments (−)' },
];

const ExtrasCard: React.FC = () => {
  const { docs, update, readOnly } = useWorkspace();
  const X = docs.gstr9.t4BooksExtra;
  const inUse = EXTRA_ROWS.filter((r) => anyValTax(X[r.id])).length;
  const [open, setOpen] = useState(inUse > 0);

  const rows: ExtraRow[] = EXTRA_ROWS.map((r) => ({ ...r, v: X[r.id], f: pathFormulas(docs.gstr9.f, `${EXTRA_F_ROOT}${r.id}.`) }));
  const heads: Array<[Head, string]> = [
    ['t', 'Value'],
    ['i', 'IGST'],
    ['c', 'CGST'],
    ['s', 'SGST'],
    ['x', 'Cess'],
  ];
  const columns: GridColumn<ExtraRow>[] = [
    { key: 'table', header: 'Table', type: 'display', align: 'left', width: 60, value: (r) => r.table },
    { key: 'label', header: 'Particulars', type: 'display', align: 'left', width: 320, value: (r) => r.label },
    ...heads.map(([h, hl]) =>
      moneyCol<ExtraRow>(h, hl, (r) => r.v[h], (r, n) => ({ ...r, v: { ...r.v, [h]: n ?? 0 } }), { width: h === 'x' ? 100 : 124 }),
    ),
  ];

  return (
    <SectionCard
      title={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Books-side extras — advances, debit notes, amendments
          {inUse > 0 && (
            <Badge variant="info" className="ml-1 text-[10px] font-normal">
              {inUse} in use
            </Badge>
          )}
        </button>
      }
      description="Rarely needed. Only when the books carry advances (4F), debit notes (4J) or amendments (4K/4L) that are not already in the sales ledgers."
      excelRef="GSTR-9 4F, 4J–4L (books column)"
    >
      {open && (
        <SheetGrid<ExtraRow>
          label="Books-side advances, debit notes and amendments"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          readOnly={readOnly}
          onRowsChange={(next) =>
            update('gstr9', (d) => {
              const t4BooksExtra = { ...d.t4BooksExtra };
              next.forEach((r) => {
                t4BooksExtra[r.id] = { t: r.v.t, i: r.v.i, c: r.v.c, s: r.v.s, x: r.v.x };
              });
              return { ...d, t4BooksExtra, f: mergePathFormulas(d.f, EXTRA_F_ROOT, next) };
            })
          }
        />
      )}
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------

const OutwardRecoStep: React.FC = () => {
  const { workings } = useWorkspace();
  const out = workings.outward;
  const hasPortal = workings.g9.t4Source !== 'none';
  const tol = workings.tolerance;
  const open = workings.stepOpen.outward;
  const diffBeyond = maxAbs(out.diffTotal, true) > tol;

  return (
    <div className="space-y-4">
      <OpenDifferences step="outward" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="(A) Books — total value" value={fmtMoney(out.booksTotal.t)} hint={`Tax ${fmtMoney(totalTax(out.booksTotal))}`} />
        <KpiTile
          label="(B) GSTR-9 auto-populated — total value"
          value={hasPortal ? fmtMoney(out.portalTotal.t) : 'Not fetched'}
          hint={hasPortal ? `Tax ${fmtMoney(totalTax(out.portalTotal))}` : 'Portal data step'}
          tone={hasPortal ? 'neutral' : 'warn'}
        />
        <KpiTile
          label="Difference (A − B) — value"
          value={hasPortal ? fmtMoney(out.diffTotal.t) : '—'}
          hint={
            hasPortal
              ? `IGST ${fmtMoney(out.diffTotal.i)} · CGST ${fmtMoney(out.diffTotal.c)} · SGST ${fmtMoney(out.diffTotal.s)}`
              : undefined
          }
          tone={!hasPortal ? 'neutral' : diffBeyond ? 'error' : 'ok'}
        />
        <KpiTile
          label="Lines needing a reason"
          value={open}
          hint={open ? 'Open Status on each red line' : 'Nothing open'}
          tone={open ? 'error' : 'ok'}
        />
      </div>
      <ComparisonCard />
      <CategoriseCard />
      <ExtrasCard />
    </div>
  );
};

export default OutwardRecoStep;
