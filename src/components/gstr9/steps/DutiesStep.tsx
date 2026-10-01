import React, { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { FY_MONTHS } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import InputTab from '../duties/InputTab';
import DutiesOpenStrip from '../duties/OpenStrip';
import OutputTab from '../duties/OutputTab';
import { hasCess, openCount, type DutiesView } from '../duties/helpers';
import { useTabParam } from '../reco/helpers';
import { OpenBadge, StepTab, StepTabsList, ViewSwitch } from '../reco/StepTabs';

const TABS = ['output', 'input'] as const;

/**
 * The month grids fill the screen below the step's header area and scroll
 * inside themselves (header and totals stay pinned), so the adjustment and
 * last-year-effect cards are a short scroll away. Both floors keep all twelve
 * months in view on a laptop (the Input grid pins seven footer lines, so it
 * scrolls a few months there).
 */
const GRID_MAX_HEIGHT = { output: 'max(540px, calc(100vh - 290px))', input: 'max(600px, calc(100vh - 250px))' };

const VIEW_OPTIONS: Record<(typeof TABS)[number], Array<{ value: DutiesView; label: string; title: string }>> = {
  output: [
    { value: 'sheet', label: 'All columns', title: 'The sheet’s layout: Sales, Credit note, Net sales, As per 3B, Diff' },
    { value: 'recon', label: 'Books vs 3B', title: 'Only Net sales, As per 3B and the difference — the Sales and Credit note columns are hidden' },
  ],
  input: [
    { value: 'sheet', label: 'All columns', title: 'The sheet’s layout, every suspended-ITC group shown' },
    { value: 'compact', label: 'Compact', title: 'The four suspended-ITC groups folded into their net (I + L − O − R)' },
    { value: 'recon', label: 'Books vs 3B', title: 'Only Net purchase, As per 3B and the difference — the typed books columns are hidden' },
  ],
};

/** The columns choice is a per-viewer convenience, remembered in this browser only. */
const VIEW_KEY = 'gstk_ar_duties_view';
const readView = (): DutiesView => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'compact' || v === 'recon' ? v : 'sheet';
  } catch {
    return 'sheet';
  }
};

/**
 * Step 4 — Duties & Taxes: the month-wise GST ledgers from the books against
 * the as-filed GSTR-3B (DUTIES & TAXES-OUTPUT and DUTIES & TAXES-INPUT).
 */
const DutiesStep: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const [tab, setTab] = useTabParam('dutiestab', TABS, 'output');
  const [cessChoice, setCessChoice] = useState<boolean | null>(null);
  const [view, setViewState] = useState<DutiesView>(readView);
  const setView = (v: DutiesView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable — the choice lasts for this visit */
    }
  };

  // Cess columns are shown by default only when some cess figure exists (the workbook has none).
  const cessUsed = useMemo(() => {
    const o = docs.duties_output;
    const i = docs.duties_input;
    return (
      FY_MONTHS.some((m) => {
        const im = i.months[m];
        const pm = docs.portal.months[m];
        return hasCess(o.months[m].sales, o.months[m].creditNote, im.purchase, im.debitNote, im.suspRev, im.suspRev180, im.suspReclaim, im.suspReclaim180, pm.outTax, pm.itcExclRcm);
      }) ||
      hasCess(i.lastYearEffect, ...o.adjustments, ...i.adjustments) ||
      hasCess(workings.dto.asPerPl, workings.dti.asPerPl, workings.dti.rcmBooks, workings.dti.rcmPortal)
    );
  }, [docs.duties_output, docs.duties_input, docs.portal.months, workings.dto.asPerPl, workings.dti.asPerPl, workings.dti.rcmBooks, workings.dti.rcmPortal]);
  const cess = cessChoice ?? cessUsed;

  const outOpen = openCount(workings.diffs, 'dto');
  const inOpen = openCount(workings.diffs, 'dti');
  // "Compact" exists only on the Input sheet; the Output grid shows all columns then.
  const outView: DutiesView = view === 'compact' ? 'sheet' : view;

  return (
    <div className="space-y-3">
      <DutiesOpenStrip />

      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <StepTabsList label="Duties & Taxes ledger">
            <StepTab value="output">
              Output (Cr side) <OpenBadge n={outOpen} />
            </StepTab>
            <StepTab value="input">
              Input (Dr side, excl. RCM) <OpenBadge n={inOpen} />
            </StepTab>
          </StepTabsList>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ViewSwitch<DutiesView>
              label="Columns shown in the month table"
              value={tab === 'output' ? outView : view}
              options={VIEW_OPTIONS[tab]}
              onChange={setView}
            />
            <div className="flex items-center gap-2">
              <Switch id="dt-show-cess" checked={cess} onCheckedChange={setCessChoice} />
              <Label htmlFor="dt-show-cess" className="text-xs font-normal">
                Show cess
                {!cess && cessUsed && <span className="ml-1 font-medium text-destructive-strong">(cess figures hidden)</span>}
              </Label>
            </div>
          </div>
        </div>

        <TabsContent value="output" className="mt-0 space-y-3">
          <OutputTab cess={cess} view={outView} gridMaxHeight={GRID_MAX_HEIGHT.output} />
        </TabsContent>
        <TabsContent value="input" className="mt-0 space-y-3">
          <InputTab cess={cess} view={view} gridMaxHeight={GRID_MAX_HEIGHT.input} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DutiesStep;
