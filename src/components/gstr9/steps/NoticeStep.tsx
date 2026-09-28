import React, { useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { gstr9PortalPresent, tax, taxOf, tin, totalTax } from '@/lib/gstr9/engine';
import { loadPreviousYear } from '@/lib/gstr9/store';
import { FY_MONTHS, type NoticeDoc, type Tax, type TaxIn } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { KpiTile, Note, OpenDifferences, SectionCard } from '../ui';
import type { CellTone } from '../grid/SheetGrid';
import ExportMenu from '../ExportMenu';
import { FixedTaxGrid, type FixedTaxRow } from '../annexures/FixedTaxGrid';
import { StepLink } from '../annexures/StepLink';
import { ANNEX_TAB_PARAM, hasAmount, pickFormulas, previousFY, putFormulas, rupees, toTaxIn, type Head } from '../annexures/taxRows';
import { fmtDmy, itcCutoffDate } from '../notice/cutoff';

/** Columns are labelled by the head they hold, in the order of the firm's sheet (§6 item 14). */
const HEADS: Head[] = ['c', 's', 'i', 'x'];
const HEAD_LABELS: Record<Head, string> = { c: 'CGST', s: 'SGST / UTGST', i: 'IGST', x: 'Cess' };

const TABLE_HEADER = (
  <>
    Table No.
    <br />
    in GSTR-9
  </>
);

type TaxOverrideKey = 'deemedSupplies' | 'unreturnedGoods' | 'pendingDemands';
type TaxInOverrideKey = 'prevYear8C' | 'ineligible4D' | 'itcUsed4A5' | 'reversed4B2';

/** Step 12 — NOTICE FORMATE: the outward / inward summary officers ask for. */
const NoticeStep: React.FC = () => {
  const { client, financialYear, docs, workings, update, readOnly } = useWorkspace();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const N = docs.notice;
  const G = docs.gstr9;
  const o = workings.notice.outward;
  const inw = workings.notice.inward;
  const tol = workings.tolerance;
  const pfy = previousFY(financialYear);
  const startYear = Number(financialYear.slice(0, 4));
  const cutoff = fmtDmy(itcCutoffDate(financialYear));
  const gstr9Fetched = gstr9PortalPresent(docs);
  const threeBFetched = FY_MONTHS.some((m) => !!docs.portal.monthMeta[m]?.source);

  const setN = <K extends keyof NoticeDoc>(k: K, v: NoticeDoc[K]) => update('notice', (d) => ({ ...d, [k]: v }));
  const positiveIsBad = (_h: Head | 'total', v: number): CellTone => (v > tol ? 'error' : undefined);

  /**
   * Outward 3–5: stored as Tax (no SGST mirror, no formulas on the field itself — those live in
   * NoticeDoc.f as "deemedSupplies.c" …), null = from GSTR-9 Tables 16 / 15.
   */
  const taxOverride = (key: TaxOverrideKey, table: string, defaultValue: Tax) => {
    const cur = N[key];
    return {
      kind: 'override' as const,
      stored: cur ? { ...toTaxIn(cur), f: pickFormulas(N.f, key) } : null,
      defaultChip: `From Table ${table}`,
      resetLabel: `Use Table ${table}`,
      defaultValue,
      onChange: (v: TaxIn | null) =>
        update('notice', (d) => ({ ...d, [key]: v ? tin(v) : null, f: putFormulas(d.f, key, v?.f) })),
    };
  };
  /** Inward 2, 4, 7, 8: stored as TaxIn, null = Annexure-4 / as-filed GSTR-3B. */
  const taxInOverride = (key: TaxInOverrideKey, chip: string, reset: string, defaultValue?: Tax) => ({
    kind: 'override' as const,
    stored: N[key],
    defaultChip: chip,
    resetLabel: reset,
    defaultValue,
    onChange: (v: TaxIn | null) => setN(key, v),
  });

  const outwardRows: FixedTaxRow[] = [
    { id: 'o1', no: '1', table: '4N', kind: 'computed', value: o.r1, label: 'Tax on taxable supplies as declared in GSTR-9' },
    { id: 'o2', no: '2', table: '10 − 11', kind: 'computed', value: o.r2, label: 'Add: net increase due to amendments (increase in amendments − decrease in amendments)' },
    { id: 'o3', no: '3', table: '16B', value: o.r3, label: 'Add: tax on deemed supplies', ...taxOverride('deemedSupplies', '16B', taxOf(G.t16.deemedSupply)) },
    { id: 'o4', no: '4', table: '16C', value: o.r4, label: 'Add: tax on unreturned goods', ...taxOverride('unreturnedGoods', '16C', taxOf(G.t16.approvalNotReturned)) },
    {
      id: 'o5', no: '5', table: '15G', value: o.r5, label: 'Pending demands',
      ...taxOverride('pendingDemands', '15G', tax(G.t15.demandPending.i, G.t15.demandPending.c, G.t15.demandPending.s, G.t15.demandPending.x)),
    },
    { id: 'o6', no: '6', kind: 'computed', value: o.r6, emphasis: true, label: 'Total output tax liability as per GSTR-9 (1 + 2 + 3 + 4 + 5)' },
    { id: 'o7', no: '7', table: '9', kind: 'computed', value: o.r7, label: 'Less: total tax paid in cash' },
    { id: 'o8', no: '8', table: '9', kind: 'computed', value: o.r8, label: 'Less: tax paid by adjustment of ITC' },
    { id: 'o9', no: '9', table: '14', kind: 'computed', value: o.r9, label: 'Less: differential tax paid on amendments' },
    {
      id: 'o10', no: '10', table: `14 of FY ${pfy} GSTR-9`, kind: 'typed', value: o.r10, stored: N.prevYearT14,
      label: 'Add: differential tax paid on amendments related to the previous year, paid in the current year',
      onChange: (v) => { if (v) setN('prevYearT14', v); },
    },
    {
      id: 'o11', no: '11', kind: 'computed', value: o.r11, emphasis: true, tone: positiveIsBad,
      label: 'Net tax payable (6 − 7 − 8 − 9 + 10)', hint: 'Above 0: tax short paid for the year · below 0: paid in excess',
    },
  ];

  const inwardRows: FixedTaxRow[] = [
    { id: 'i1', no: '1', table: '8A', kind: 'computed', value: inw.r1, label: 'ITC in the year as per Table 8A of GSTR-9' },
    {
      id: 'i2', no: '2', table: `8C of FY ${pfy}`, value: inw.r2,
      label: 'ITC brought forward from the previous FY to the current FY (Table 8C of the previous FY GSTR-9)',
      ...taxInOverride('prevYear8C', 'From Annexure-4', 'Use Annexure-4', tin(docs.annexures.a4.c8)),
    },
    {
      id: 'i3', no: '3', table: '8C', kind: 'computed', value: inw.r3, hint: 'Table 13 − Table 12, set on the ITC reco step',
      label: 'ITC carried forward from the present FY to the subsequent FY (Table 8C of this GSTR-9)',
    },
    { id: 'i4', no: '4', table: '—', value: inw.r4, label: 'Ineligible ITC as per 4(D) of GSTR-3B', ...taxInOverride('ineligible4D', 'From as-filed 3B', 'Use as-filed 3B') },
    {
      id: 'i5', no: '5', table: '—', kind: 'typed', value: inw.r5, stored: N.ineligible164,
      label: `Ineligible ITC u/s 16(4): the supplier filed returns after the cut-off date ${cutoff} (excluding RCM & POS ITC)`,
      hint: startYear >= 2017 && startYear <= 2020
        ? `FY 2017-18 to 2020-21: 30-11-2021 under s.16(5)`
        : `30 November after the end of FY ${financialYear}`,
      onChange: (v) => { if (v) setN('ineligible164', v); },
    },
    { id: 'i6', no: '6', kind: 'computed', value: inw.r6, emphasis: true, label: 'ITC available for use in the same year (1 + 2 − 3 − 4 − 5)' },
    { id: 'i7', no: '7', table: '—', value: inw.r7, label: 'ITC used in the same year as per 4A(5) of GSTR-3B', ...taxInOverride('itcUsed4A5', 'From as-filed 3B', 'Use as-filed 3B') },
    { id: 'i8', no: '8', table: '—', value: inw.r8, label: 'Reversed in 4(B)(2) of GSTR-3B', ...taxInOverride('reversed4B2', 'From as-filed 3B', 'Use as-filed 3B') },
    {
      id: 'i9', no: '9', kind: 'computed', value: inw.r9, emphasis: true, tone: positiveIsBad,
      label: 'Net excess used (7 − 6 − 8)', hint: 'Above 0: ITC used in excess of what was available',
    },
  ];

  const fillRow10 = async () => {
    setBusy(true);
    try {
      const prev = await loadPreviousYear(client.id, financialYear);
      if (!prev) {
        toast.info(`FY ${pfy} hasn't been worked in the app — type row 10 from last year's filed GSTR-9 (Table 14, paid).`);
        return;
      }
      const t14 = prev.docs.gstr9.t14;
      const next: TaxIn = { i: t14.igst.paid, c: t14.cgst.paid, s: t14.sgst.paid, x: t14.cess.paid };
      if (hasAmount(tin(N.prevYearT14))) {
        const ok = await confirm({
          title: `Replace row 10 with FY ${pfy} Table 14?`,
          description: 'The figures typed in row 10 will be overwritten with the tax paid in Table 14 of last year’s working.',
          confirmText: 'Replace',
        });
        if (!ok) return;
      }
      setN('prevYearT14', next);
      toast.success(`Row 10 filled from Table 14 (paid) of the FY ${pfy} working.`);
    } catch (e) {
      toast.error('Could not load last year’s working: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const netPayable = totalTax(o.r11);
  const netExcess = totalTax(inw.r9);
  const inwardFromThreeB = N.ineligible4D === null || N.itcUsed4A5 === null || N.reversed4B2 === null;

  return (
    <div className="space-y-4">
      <OpenDifferences step="notice" />
      <SectionCard
        title="Notice reply format"
        description="Outward liability against tax paid, and ITC available against ITC used — in the format officers ask for."
        excelRef="NOTICE FORMATE B5:I31"
        actions={<ExportMenu only={['noticepdf']} />}
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <KpiTile label="Output tax liability (outward 6)" value={rupees(totalTax(o.r6))} />
          <KpiTile
            label="Net tax payable (outward 11)"
            value={rupees(netPayable)}
            hint={netPayable > tol ? 'short paid' : netPayable < -tol ? 'paid in excess' : 'matched'}
            tone={netPayable > tol ? 'error' : netPayable < -tol ? 'warn' : 'ok'}
          />
          <KpiTile label="ITC available (inward 6)" value={rupees(totalTax(inw.r6))} />
          <KpiTile
            label="Net excess ITC used (inward 9)"
            value={rupees(netExcess)}
            hint={netExcess > tol ? 'used in excess' : 'within availability'}
            tone={netExcess > tol ? 'error' : 'ok'}
          />
        </div>

        {!gstr9Fetched && (
          <Note tone="warn">
            The GSTR-9 system-computed figures are not fetched: outward rows 1, 7, 8 and inward row 1 read them.{' '}
            <StepLink step="portal">Portal data</StepLink>
          </Note>
        )}
        {!threeBFetched && inwardFromThreeB && (
          <Note tone="warn">
            The as-filed GSTR-3B is not fetched: inward rows 4, 7 and 8 read it, so they show 0 until it is — fetch it or type the
            figures. <StepLink step="portal">Portal data</StepLink>
          </Note>
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Outward</h4>
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={fillRow10} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <History className="mr-1 h-3.5 w-3.5" />}
                Fill row 10 from FY {pfy}
              </Button>
            )}
          </div>
          <FixedTaxGrid
            rows={outwardRows}
            label="Notice format: outward"
            readOnly={readOnly}
            heads={HEADS}
            headLabels={HEAD_LABELS}
            noHeader="S.No"
            labelHeader="Issue"
            showTable
            tableHeader={TABLE_HEADER}
          />
        </div>

        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">Inward</h4>
          <FixedTaxGrid
            rows={inwardRows}
            label="Notice format: inward"
            readOnly={readOnly}
            heads={HEADS}
            headLabels={HEAD_LABELS}
            noHeader="S.No"
            labelHeader="Description"
            showTable
            tableHeader={TABLE_HEADER}
          />
          <p className="text-[11px] text-muted-foreground">
            Row 2 follows clause 8 of{' '}
            <StepLink step="annexures" extra={{ [ANNEX_TAB_PARAM]: 'a4' }}>Annexure-4</StepLink>{' '}
            unless typed here. Section 16(4) cut-off for FY {financialYear}: <span className="font-medium text-foreground">{cutoff}</span>.
          </p>
        </div>

        <Note tone="position">
          Columns are labelled by the head they hold (the sheet&apos;s SGST/CGST headers were swapped and row 2 was shifted a
          column); the previous year&apos;s 8C is its own input (the sheet read this year&apos;s Table 12); and the labels match the
          formulas — available = 1 + 2 − 3 − 4 − 5, net excess used = 7 − 6 − 8 (§6 item 14).
        </Note>
      </SectionCard>
    </div>
  );
};

export default NoticeStep;
