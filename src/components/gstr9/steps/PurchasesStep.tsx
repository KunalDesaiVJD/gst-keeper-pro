import React, { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Calculator, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { maxAbs, totalTax, type StepKey } from '@/lib/gstr9/engine';
import type { InputSection } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, OpenDifferences, useDiffLine } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { HeadLanding } from '../purchases/HeadLanding';
import { PurchaseSectionGrid } from '../purchases/PurchaseSectionGrid';
import { PurchasesSummary } from '../purchases/PurchasesSummary';
import { fillFromRate, rateFlag, SECTION_META, SECTIONS } from '../purchases/purchaseRows';

const HEAD_NAMES = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' } as const;

/** URL parameter that remembers the open part (the page keeps ?client= and ?step= alongside). */
const TAB_PARAM = 'purchasestab';
const TABS = [...SECTIONS, 'summary', 'heads'] as const;
type TabKey = (typeof TABS)[number];

/** Short tab names for the three PL-INPUT sections. */
const SECTION_TAB: Record<InputSection, string> = {
  purchase: '(A) Purchase',
  expense: '(B) Expense',
  capital_goods: '(C) Capital goods',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Step 3 — Purchases & ITC (P&L): the firm's PL-INPUT sheet. Three ledger
 * grids (purchase, expense, capital goods) tagged to the GSTR-9C expense
 * heads, then rows 71–81 (net ITC for the year against Duties & Taxes).
 */
const PurchasesStep: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const p = workings.purchases;
  const rows = docs.purchases.rows;
  const diffLine = useDiffLine('purchases.dt');

  const fromUrl = params.get(TAB_PARAM);
  const tab: TabKey = TABS.some((t) => t === fromUrl) ? (fromUrl as TabKey) : 'purchase';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    setParams(next, { replace: true });
  };

  const go = useCallback(
    (key: StepKey) => {
      const next = new URLSearchParams(params);
      next.set('step', key);
      setParams(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );

  const flagged = useMemo(
    () => rows.map((r) => ({ r, f: rateFlag(r, p.rows[r.id]) })).filter((x) => x.f !== null),
    [rows, p.rows],
  );
  const fillable = useMemo(() => rows.filter((r) => fillFromRate(r) !== r).length, [rows]);
  const untagged = useMemo(() => rows.filter((r) => r.section === 'expense' && r.head === null).length, [rows]);

  const fillTax = () => {
    if (!fillable) {
      toast.info('No ledger has a rate with blank tax — nothing to fill.');
      return;
    }
    update('purchases', (d) => ({ ...d, rows: d.rows.map(fillFromRate) }));
    toast.success(`Filled tax from the rate on ${fillable} ledger${fillable === 1 ? '' : 's'}.`);
  };

  const diff = p.diffVsDt;
  const diffMag = maxAbs(diff);
  const diffHint =
    (['i', 'c', 's', 'x'] as const)
      .filter((h) => Math.abs(diff[h]) >= 0.005)
      .map((h) => `${HEAD_NAMES[h]} ${fmtMoney(diff[h])}`)
      .join(' · ') || 'All heads match';
  const diffTone: 'ok' | 'error' | 'warn' | 'neutral' = diffMag < 0.005 ? 'ok' : diffLine?.open ? 'error' : 'neutral';

  const empty = rows.length === 0;
  const trigger = 'gap-1.5 px-2.5 py-1 text-xs';
  const flaggedIn = (s: InputSection) => flagged.filter((x) => x.r.section === s).length;
  const flaggedWhere = SECTIONS.filter((s) => flaggedIn(s) > 0).map((s) => SECTION_META[s].letter).join(', ');

  return (
    <div className="space-y-3">
      <OpenDifferences step="purchases" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="ITC as per P&L (row 71)" value={fmtMoney(totalTax(p.totalPl))} hint={`${rows.length} ledger${rows.length === 1 ? '' : 's'} · value ${fmtMoney(p.totalPl.t)}`} />
        <KpiTile label="Net ITC for the year (row 79)" value={fmtMoney(totalTax(p.netItc))} hint="After suspended ITC and RCM" />
        <KpiTile label="As per Duties & Taxes (row 80)" value={fmtMoney(totalTax(p.dtNet))} hint="Net, after last-year effect" />
        <KpiTile label="Difference P&L − D&T (row 81)" value={fmtMoney(totalTax(diff))} hint={diffHint} tone={diffTone} />
        <KpiTile
          label="Rate checks"
          value={flagged.length}
          hint={flagged.length ? `Implied rate ≠ GST rate · in ${flaggedWhere}` : rows.length ? 'Every implied rate is a GST rate' : 'No ledgers yet'}
          tone={flagged.length ? 'warn' : rows.length ? 'ok' : 'neutral'}
        />
      </div>

      {empty && (
        <Note>
          <span className="inline-flex items-center gap-1 font-medium">
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" /> Start by pasting from the PL-INPUT sheet.
          </span>{' '}
          For each section, copy columns C–H (Head in books, Taxable value, IGST, CGST, SGST, Rate) of its rows in the sheet —{' '}
          {SECTIONS.map((s) => `${SECTION_META[s].letter}: ${SECTION_META[s].sheetRows}`).join(', ')} — then open its tab, click inside the
          grid and press Ctrl+V. Rows are added as needed; totals and the net ITC fill in as you go.
        </Note>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-full overflow-x-auto">
            <TabsList className="h-8 w-max">
              {SECTIONS.map((s) => {
                const n = rows.filter((r) => r.section === s).length;
                const f = flaggedIn(s);
                return (
                  <TabsTrigger key={s} value={s} className={trigger} title={SECTION_META[s].title}>
                    {SECTION_TAB[s]}
                    <Badge variant="secondary" className="h-4 min-w-4 justify-center rounded-full px-1.5 text-[10px] font-normal leading-none" title={plural(n, 'ledger')}>
                      <span aria-hidden="true">{n}</span>
                      <span className="sr-only">{plural(n, 'ledger')}</span>
                    </Badge>
                    {f > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-foreground" title={`${plural(f, 'ledger')} where tax is not the GST rate on the value`}>
                        <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
                        {plural(f, 'rate check')}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="summary" className={trigger} title="PL-INPUT rows 71–81">
                ITC summary
                <span className="font-normal text-muted-foreground">· rows 71–81</span>
                {diffLine?.open && (
                  <Badge variant="destructive" className="h-4 rounded-full px-1.5 text-[10px] font-medium leading-none">
                    {diffLine.stale ? 'Re-check' : 'Reason needed'}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="heads" className={trigger} title="Where each ledger lands in GSTR-9C Table 14">
                9C heads
                {untagged > 0 && (
                  <span className="text-[10px] font-normal text-muted-foreground">· {untagged} untagged</span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
          {!readOnly && !empty && (
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={fillTax} disabled={!fillable} title="Fill IGST (inter-state) or CGST/SGST (intra-state) from the rate, only on ledgers with no tax typed — in all three sections">
              <Calculator className="mr-1 h-3.5 w-3.5" /> Fill tax from rate{fillable ? ` (${fillable})` : ''}
            </Button>
          )}
        </div>

        {SECTIONS.map((s) => (
          <TabsContent key={s} value={s}>
            <PurchaseSectionGrid section={s} />
          </TabsContent>
        ))}
        <TabsContent value="summary">
          <PurchasesSummary onGo={go} />
        </TabsContent>
        <TabsContent value="heads">
          <HeadLanding onGo={go} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PurchasesStep;
