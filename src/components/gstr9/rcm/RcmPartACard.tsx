import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FY_MONTHS, type Formulas, type MonthKey, type ValTax } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { Note, SectionCard, SourceChip } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { monthLabel, RCM_GRID_MAX_HEIGHT, useGoToStep } from './rcmShared';
import { FigLink } from '../figure/FigLink';
import { linkedMoney, portal3b, portalG9T4 } from '../figure/targetsData';

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
 * (RCM rows 5–22). Read-only here: Portal data › As-filed GSTR-3B is the one
 * place the as-filed figures are typed or corrected (a superadmin only,
 * sourceLock.ts); every figure opens its month there.
 */
const RcmPartACard: React.FC = () => {
  const { docs, workings, canEditSource, financialYear } = useWorkspace();
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

  const columns: GridColumn<PartARow>[] = [
    { key: 'month', header: 'Month', type: 'display', align: 'left', sticky: true, width: 92, value: (r) => monthLabel(r.id, financialYear) },
    {
      key: 'source',
      header: 'Source',
      type: 'display',
      align: 'left',
      width: 96,
      value: () => null,
      // The month's row on Portal data › As-filed GSTR-3B (the link a superadmin, who types the cells, still has).
      render: (r) => (
        <FigLink to={portal3b('rcm', r.id)} className="text-left no-underline">
          <SourceChip meta={P.monthMeta[r.id]} manual={monthTyped(r.id)} />
        </FigLink>
      ),
    },
    ...HEADS.map((h) => ({
      ...moneyCol<PartARow>(h, HEAD_LABEL[h], (r) => r.rcm[h], (r, v) => ({ ...r, rcm: { ...r.rcm, [h]: v ?? 0 } }), {
        group: GROUP,
        width: h === 't' ? 130 : h === 'x' ? 96 : 118,
        editable: () => false,
        title: (r) => {
          const typed = P.manual?.[fieldPath(r.id, h)] ? 'Typed by hand by a superadmin — a re-import from the portal will ask before replacing it.' : '';
          return [typed, 'Read-only here — edit on Portal data › As-filed GSTR-3B.'].filter(Boolean).join(' ');
        },
      }),
      // Read-only on every login: the figure opens its month on Portal data, the one editor.
      render: (r: PartARow) => linkedMoney(r.rcm[h], portal3b('rcm', r.id, h), r.f[h]),
    })),
  ];
  const totalTo = (h: Head) => (W.partASource === 'gstr9' ? portalG9T4('rchrg', h) : portal3b('rcm', 'total', h));

  const annual = W.partASource === 'gstr9';

  return (
    <SectionCard
      title="Part A — as per GST portal"
      description={canEditSource
        ? '3.1(d) of the as-filed GSTR-3B for each month, fetched from the portal in Portal data. Read-only here: correct a month on Portal data › As-filed 3B.'
        : '3.1(d) of the as-filed GSTR-3B for each month, fetched from the portal in Portal data. Read-only — only a superadmin can correct a month, on Portal data › As-filed 3B.'}
      excelRef="RCM rows 5–22 (D9:G22)"
      actions={
        <Button type="button" size="sm" variant="outline" onClick={() => goTo('portal', { portaltab: 'gstr3b', g3btab: 'reco' })}>
          Edit on Portal › As-filed 3B <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
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
          to compare month by month (typing any month there does the same).
        </Note>
      )}
      {W.partASource === 'none' && (
        <Note tone="warn">
          No RCM figure from the portal yet. Fetch the as-filed GSTR-3B (or the GSTR-9 system-computed figures) in{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => goTo('portal', { portaltab: 'gstr3b' })}>
            Portal data
          </Button>
          {canEditSource ? ', or type 3.1(d) month by month on its As-filed GSTR-3B tab.' : '.'}
        </Note>
      )}
      <SheetGrid<PartARow>
        label="RCM Part A — as per GST portal"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        readOnly
        maxHeight={RCM_GRID_MAX_HEIGHT}
        footer={[
          {
            key: 'total',
            label: annual ? 'GSTR-9 4G (year)' : 'Total',
            tone: 'total',
            cells: Object.fromEntries(HEADS.map((h) => [h, <FigLink key={h} to={totalTo(h)}>{fmtMoney(W.partA[h])}</FigLink>])),
          },
        ]}
      />
    </SectionCard>
  );
};

export default RcmPartACard;
