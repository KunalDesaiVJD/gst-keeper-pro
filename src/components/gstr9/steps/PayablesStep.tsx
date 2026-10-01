import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, HandCoins, Lock } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { drc03Available, drc03MatchesFY, SIDE_LABEL, type PayableSide } from '@/lib/gstr9/payables';
import type { Tax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, rupees, sumTax, useGoToStep } from '../overview/steps';
import PayableDisclosure from '../payables/PayableDisclosure';
import SetOffDialog from '../payables/SetOffDialog';
import SetOffRegister from '../payables/SetOffRegister';
import { StepTab, StepTabsList, TabSub } from '../reco/StepTabs';

const HEADS: Array<[keyof Tax, string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST'], ['x', 'Cess']];

/** The step's tabs, kept in the URL as ?payablestab=. */
const TAB_PARAM = 'payablestab';
type PayablesTab = 'disclosure' | 'register' | 'drc03';
const TABS: PayablesTab[] = ['disclosure', 'register', 'drc03'];

/**
 * Step 14 — what the annual reconciliation leaves payable, disclosed
 * output-wise and input-wise, and how each part is set off. A set-off needs
 * its evidence in the system: a DRC-03 imported (synced from the portal or
 * its copy uploaded), or a GSTR-3B effect with the filing date and the copy.
 * Recording set-offs stays open after the lock.
 */
const PayablesStep: React.FC = () => {
  const { workings: w, period, locked, isStaff, drc03s, setOffs, financialYear } = useWorkspace();
  const go = useGoToStep();
  const [dialog, setDialog] = useState<{ open: boolean; side?: PayableSide }>({ open: false });
  const P = w.payables;
  const payable = sumTax(P.totals.payable);
  const balance = sumTax(P.totals.balance);
  const fyDrc03s = useMemo(() => drc03s.filter((d) => drc03MatchesFY(d.financialYear, financialYear)), [drc03s, financialYear]);
  const frozen = period?.payables_at_lock as { totals?: { payable?: Tax } } | null | undefined;
  const frozenTotal = frozen?.totals?.payable ? sumTax(frozen.totals.payable) : null;

  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(TAB_PARAM) as PayablesTab | null;
  const tab: PayablesTab = fromUrl && TABS.includes(fromUrl) ? fromUrl : 'disclosure';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    setParams(next, { replace: true });
  };
  const activeSetOffs = setOffs.filter((o) => !o.deletedAt).length;
  const count = (n: number) => <span className="tabular-nums text-muted-foreground">{n}</span>;

  return (
    <div className="space-y-3">
      {locked ? (
        <>
          <Note tone="info">
            <span className="inline-flex items-center gap-1 font-medium"><Lock className="h-3 w-3" /> Final</span> — as verified and locked by {period?.reviewed_by_name ?? period?.locked_by ?? '—'}
            {period?.reviewed_at || period?.locked_at ? ` on ${fmtWhen(period?.reviewed_at ?? period?.locked_at)}` : ''}. Set-offs can still be recorded: DRC-03s are usually paid after the return is filed.
          </Note>
          {/* A warning of its own, so it is not folded away inside the one-line info note. */}
          {frozenTotal !== null && Math.abs(frozenTotal - payable) > 0.5 && (
            <Note tone="warn">The payable at the lock was {rupees(frozenTotal)}; the working now shows {rupees(payable)}. Check with the reviewer.</Note>
          )}
        </>
      ) : (
        <Note tone="warn">
          Provisional — these figures become final when a GST manager or superadmin verifies and locks the year (Review &amp; lock). A set-off paid before filing can be recorded now.
        </Note>
      )}

      {/* The figures to act on and the one way to act on them stay in sight whichever tab is open. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-4">
          <KpiTile label="Output tax payable" value={rupees(sumTax(P.output.payable))} />
          <KpiTile label="Input tax credit payable" value={rupees(sumTax(P.input.payable))} />
          <KpiTile label="Set off" value={rupees(sumTax(P.totals.setOff))} tone={payable > 0.5 && sumTax(P.totals.setOff) > 0 ? 'ok' : 'neutral'} />
          <KpiTile label="Balance outstanding" value={rupees(balance)} tone={balance > w.tolerance ? 'error' : payable > 0.5 ? 'ok' : 'neutral'} hint={payable > 0.5 && balance <= w.tolerance ? (balance < 0.5 ? 'Fully set off' : `Within the ${rupees(w.tolerance)} tolerance`) : undefined} />
        </div>
        {isStaff && balance > w.tolerance && (
          <Button size="sm" onClick={() => setDialog({ open: true })}><HandCoins className="mr-1 h-3.5 w-3.5" /> Record a set-off</Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-2">
        <StepTabsList label="Payables & set-off" value={tab}>
          <StepTab value="disclosure">Disclosure <TabSub>output &amp; input</TabSub></StepTab>
          <StepTab value="register">Set-off register {count(activeSetOffs)}</StepTab>
          <StepTab value="drc03">DRC-03s for FY {financialYear} {count(fyDrc03s.length)}</StepTab>
        </StepTabsList>

        <TabsContent value="disclosure" className="mt-0 space-y-2">
          {/* Side by side on a wide screen; each table keeps its own horizontal scroll. */}
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {(['output', 'input'] as PayableSide[]).map((side) => (
              <SectionCard
                key={side}
                title={`${SIDE_LABEL[side]} — payable`}
                description={side === 'output'
                  ? 'Tax payable as per books not paid in the return, RCM to be paid and other output payments — from Annexure-3.'
                  : 'Excess ITC claimed as per the reconciliation and other input-side payments — from Annexure-3.'}
                excelRef="ANNEXURE B39:G46"
                actions={isStaff && sumTax(P[side].balance) > w.tolerance ? (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setDialog({ open: true, side })} aria-label={`Record a set-off — ${SIDE_LABEL[side]}`}>
                    <HandCoins className="mr-1 h-3.5 w-3.5" /> Record a set-off
                  </Button>
                ) : undefined}
              >
                <PayableDisclosure side={side} data={P[side]} tolerance={w.tolerance} />
              </SectionCard>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            The rows come from <button type="button" className="text-primary hover:underline" onClick={() => go('annexures')}>Annexure-3</button>; an “other payment” is disclosed on the side chosen for it there.
          </p>
        </TabsContent>

        <TabsContent value="register" className="mt-0">
          <SectionCard
            title="Set-off register"
            description="Every set-off with its evidence. Only a DRC-03 in the system, or a GSTR-3B effect with its filing date and copy, is accepted."
          >
            <SetOffRegister />
          </SectionCard>
        </TabsContent>

        <TabsContent value="drc03" className="mt-0">
          <SectionCard
            title={`DRC-03s for FY ${financialYear}`}
            description="As synced from the GST portal by the browser extension (cause of payment for this financial year), and how much of each is used in the register."
          >
            {fyDrc03s.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None in the system for this FY{drc03s.length ? ` (${drc03s.length} for other years)` : ''}. Sync them from the portal in “Record a set-off”, or import one by uploading its copy there.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[820px] border-collapse text-xs" aria-label="DRC-03s for this financial year">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="border-b px-2 py-1.5 text-left font-semibold">ARN · date</th>
                      <th className="border-b px-2 py-1.5 text-left font-semibold">Cause · section</th>
                      {HEADS.map(([h, l]) => <th key={h} className="w-24 border-b px-2 py-1.5 text-right font-semibold">{l}</th>)}
                      <th className="w-28 border-b px-2 py-1.5 text-right font-semibold">Left to use</th>
                      <th className="border-b px-2 py-1.5 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fyDrc03s.map((d) => {
                      const left = sumTax(drc03Available(d, setOffs));
                      return (
                        <tr key={d.id} className="align-top">
                          <td className="border-b px-2 py-1.5">
                            <div className="font-mono">{d.arn ?? '—'}</div>
                            <div className="text-[11px] text-muted-foreground">{d.filedDate ?? ''}</div>
                            {d.pdfUrl && <a href={d.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline">copy <ExternalLink className="h-3 w-3" /></a>}
                          </td>
                          <td className="border-b px-2 py-1.5">{d.cause ?? '—'}<div className="text-[11px] text-muted-foreground">{d.section ?? ''}</div></td>
                          {HEADS.map(([h]) => <td key={h} className="border-b px-2 py-1.5 text-right tabular-nums">{fmtMoney(d.tax[h])}</td>)}
                          <td className="border-b px-2 py-1.5 text-right font-medium tabular-nums">{fmtMoney(left)}</td>
                          <td className="border-b px-2 py-1.5">
                            {left < 0.5 ? <Badge variant="success" className="text-[10px] font-medium">Fully used</Badge> : <span className="text-muted-foreground">{d.status ?? '—'}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <SetOffDialog open={dialog.open} initialSide={dialog.side} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
};

export default PayablesStep;
