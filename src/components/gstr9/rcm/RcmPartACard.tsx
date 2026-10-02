import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { num } from '@/lib/gstr9/engine';
import { applyHandEdits, type FieldEdit } from '@/lib/gstr9/portalImport';
import { FY_MONTHS, type Formulas, type MonthKey, type ValTax } from '@/lib/gstr9/types';
import { LOCKED_TITLE } from '@/lib/gstr9/sourceLock';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { Note, SectionCard, SourceChip } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { monthLabel, RCM_GRID_MAX_HEIGHT, useGoToStep } from './rcmShared';

/** One month of 3.1(d) of the as-filed GSTR-3B. */
interface PartARow {
  id: MonthKey;
  rcm: ValTax;
  /** "=a+b" expressions, keyed by head (the moneyCol key) — stored in PortalDoc.f by field path. */
  f: Formulas;
}

const HEADS = ['t', 'i', 'c', 's', 'x'] as const;
type Head = (typeof HEADS)[number];
const HEAD_LABEL: Record<Head, string> = { t: 'Value', i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };
const GROUP = 'GSTR-3B 3.1(d) — inward supplies liable to reverse charge';

const fieldPath = (m: MonthKey, h: Head) => `months.${m}.rcm.${h}`;

/**
 * PART A — AS PER GST PORTAL: 3.1(d) of the as-filed GSTR-3B, month by month
 * (RCM rows 5–22). Filled by the Portal data step and locked: only a
 * superadmin can type or correct a month here (sourceLock.ts), which marks it
 * Typed so a later re-import asks first.
 */
const RcmPartACard: React.FC = () => {
  const { docs, workings, update, canEditSource, financialYear } = useWorkspace();
  const goTo = useGoToStep();
  const P = docs.portal;
  const W = workings.rcm;

  const monthTyped = (m: MonthKey) => HEADS.some((h) => !!P.manual?.[fieldPath(m, h)]);

  const rows: PartARow[] = FY_MONTHS.map((m) => {
    const f: Formulas = {};
    HEADS.forEach((h) => {
      const fx = P.f?.[fieldPath(m, h)];
      if (fx) f[h] = fx;
    });
    return { id: m, rcm: { t: 0, i: 0, c: 0, s: 0, x: 0, ...(P.months[m]?.rcm ?? {}) }, f };
  });

  // Hand edits go through applyHandEdits (shared with the Portal step): it sets the value, marks the
  // path typed, remembers the expression and sets the month's source to "manual" if nothing was fetched.
  const onRowsChange = (next: PartARow[]) =>
    update('portal', (d) => {
      const edits: FieldEdit[] = [];
      for (const r of next) {
        const cur = d.months[r.id]?.rcm;
        HEADS.forEach((h) => {
          const path = fieldPath(r.id, h);
          const value = num(r.rcm[h]);
          const formula = r.f?.[h] || null;
          if (Math.abs(num(cur?.[h]) - value) > 0.0001 || (d.f?.[path] || null) !== formula) edits.push({ path, value, formula });
        });
      }
      return edits.length ? applyHandEdits(d, edits) : d;
    });

  const columns: GridColumn<PartARow>[] = [
    { key: 'month', header: 'Month', type: 'display', align: 'left', sticky: true, width: 92, value: (r) => monthLabel(r.id, financialYear) },
    {
      key: 'source',
      header: 'Source',
      type: 'display',
      align: 'left',
      width: 96,
      value: () => null,
      render: (r) => <SourceChip meta={P.monthMeta[r.id]} manual={monthTyped(r.id)} />,
    },
    ...HEADS.map((h) =>
      moneyCol<PartARow>(h, HEAD_LABEL[h], (r) => r.rcm[h], (r, v) => ({ ...r, rcm: { ...r.rcm, [h]: v ?? 0 } }), {
        group: GROUP,
        width: h === 't' ? 130 : h === 'x' ? 96 : 118,
        editable: () => canEditSource,
        title: (r) => {
          const typed = P.manual?.[fieldPath(r.id, h)] ? 'Typed by hand by a superadmin — a re-import from the portal will ask before replacing it.' : '';
          return canEditSource ? typed || undefined : [typed, LOCKED_TITLE.portal].filter(Boolean).join(' ');
        },
      }),
    ),
  ];

  const annual = W.partASource === 'gstr9';

  return (
    <SectionCard
      title="Part A — as per GST portal"
      description={canEditSource
        ? '3.1(d) of the as-filed GSTR-3B for each month, fetched from the portal in Portal data. Locked for staff; as superadmin, correct a month here only if the fetch is wrong or missing.'
        : '3.1(d) of the as-filed GSTR-3B for each month, fetched from the portal in Portal data. Locked — only a superadmin can correct a month.'}
      excelRef="RCM rows 5–22 (D9:G22)"
      actions={
        <Button type="button" size="sm" variant="outline" onClick={() => goTo('portal', { portaltab: 'gstr3b' })}>
          Go to Portal data <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      }
    >
      {annual && (
        <Note>
          Only the annual GSTR-9 Table 4G figure is available — no month-wise GSTR-3B has been pulled yet, so RCM is compared for the year as a
          whole: value {fmtMoney(W.partA.t)} · IGST {fmtMoney(W.partA.i)} · CGST {fmtMoney(W.partA.c)} · SGST {fmtMoney(W.partA.s)}.{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => goTo('portal', { portaltab: 'gstr3b' })}>
            Fetch the GSTR-3B in Portal data
          </Button>{' '}
          to compare month by month (typing any month below does the same).
        </Note>
      )}
      {W.partASource === 'none' && (
        <Note tone="warn">
          No RCM figure from the portal yet. Fetch the as-filed GSTR-3B (or the GSTR-9 system-computed figures) in{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => goTo('portal', { portaltab: 'gstr3b' })}>
            Portal data
          </Button>
          {canEditSource ? ', or type 3.1(d) month by month below.' : '.'}
        </Note>
      )}
      <SheetGrid<PartARow>
        label="RCM Part A — as per GST portal"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={canEditSource ? onRowsChange : undefined}
        readOnly={!canEditSource}
        maxHeight={RCM_GRID_MAX_HEIGHT}
        footer={[
          {
            key: 'total',
            label: annual ? 'GSTR-9 4G (year)' : 'Total',
            tone: 'total',
            cells: { t: W.partA.t, i: W.partA.i, c: W.partA.c, s: W.partA.s, x: W.partA.x },
          },
        ]}
      />
    </SectionCard>
  );
};

export default RcmPartACard;
