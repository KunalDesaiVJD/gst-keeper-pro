import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  carryForward, editableReason, emptyBuilderAdv, emptyTieOut, normalizeBuilderAdv, openingsDiffer, prevFy, rollForward, withCarry,
  type BuilderAdvAdjustment, type BuilderAdvanceDoc, type BuilderAdvTieOut, type BuilderChainYear,
} from '@/lib/gstr9/builderAdvances';
import { closeBuilderYear, loadBuilderChain, loadBuilderYearMoney, reopenBuilderYear } from '@/lib/gstr9/builderAdvancesData';
import { newId } from '@/lib/gstr9/defaults';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

// Sales › Advances (Builder clients only): the customer-advance roll-forward of
// the firm's TURNOVER IN 9C sheet. Earlier years are read-only; only the one
// open year can change, and the database holds the same rule
// (20261123150000_annual_return_builder_advances.sql). The figures fill Table 5.

const fmt = (n: number) => fmtMoney(n);

const MoneyInput: React.FC<{ value: number; onChange: (v: number) => void; disabled?: boolean; label: string }> = ({ value, onChange, disabled, label }) => {
  const [text, setText] = useState(String(value || ''));
  useEffect(() => setText(value ? String(value) : ''), [value]);
  const commit = () => {
    const n = Number(text.replace(/,/g, '').trim() || 0);
    if (!Number.isFinite(n)) {
      setText(value ? String(value) : '');
      return;
    }
    if (Math.abs(n - value) > 0.0001) onChange(Math.round(n * 100) / 100);
  };
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="h-8 w-44 text-right tabular-nums"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
};

type ReasonAsk = { kind: 'close' | 'reopen'; fy: string } | null;

const BuilderAdvanceCard: React.FC = () => {
  const { docs, workings, update, readOnly, client, financialYear, me, flush } = useWorkspace();
  const doc = normalizeBuilderAdv(docs.gstr9c.builderAdv);
  const W = workings.gstr9c;
  const [chain, setChain] = useState<BuilderChainYear[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<ReasonAsk>(null);
  const [reason, setReason] = useState('');

  const reloadChain = useCallback(async () => {
    try {
      setLoadError(null);
      setChain(await loadBuilderChain(client.id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not read the earlier years.');
    }
  }, [client.id]);
  useEffect(() => { void reloadChain(); }, [reloadChain]);

  const prevYear = chain?.find((y) => y.fy === prevFy(financialYear)) ?? null;
  const carry = prevYear ? carryForward(prevYear.doc) : null;
  const self = chain?.find((y) => y.fy === financialYear) ?? null;
  // The chain as the rule sees it, with this year's live figures.
  const liveChain = useMemo<BuilderChainYear[]>(() => {
    const rest = (chain ?? []).filter((y) => y.fy !== financialYear);
    return doc ? [...rest, { ...(self ?? { fy: financialYear, closed: false, closedHow: null, closedBy: null, closedAt: null, closeReason: null }), doc }] : rest;
  }, [chain, doc, self, financialYear]);
  const why = chain ? editableReason(financialYear, liveChain) : null;
  const editable = !readOnly && !!chain && why === null;
  const isSuper = me.role === 'superadmin';

  const setDoc = (fn: (d: BuilderAdvanceDoc) => BuilderAdvanceDoc, action?: string) =>
    update('gstr9c', (d) => ({ ...d, builderAdv: fn(normalizeBuilderAdv(d.builderAdv) ?? emptyBuilderAdv(carry)) }), action ? { action } : undefined);

  // Keep the openings what the closed year before carries forward.
  useEffect(() => {
    if (doc && carry && editable && openingsDiffer(doc, carry)) {
      setDoc((d) => withCarry(d, carry), `Openings carried from FY ${prevYear?.fy}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, carry, editable]);

  const start = () => update('gstr9c', (d) => ({ ...d, builderAdv: emptyBuilderAdv(carry) }), { action: 'Started the Builder advance roll-forward' });
  const stop = () => update('gstr9c', (d) => ({ ...d, builderAdv: null }), { action: 'Switched off the Builder advance roll-forward' });

  const setAdj = (id: string, patch: Partial<BuilderAdvAdjustment>) =>
    setDoc((d) => ({ ...d, adjustments: d.adjustments.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  const setTie = (patch: Partial<BuilderAdvTieOut>) =>
    setDoc((d) => ({ ...d, tieOut: { ...(d.tieOut ?? emptyTieOut()), source: 'books', readAt: '', ...patch } }));

  // GSTR-1 and GSTR-3B are often not prepared in this app, so the Builder module may hold
  // nothing for the year: then the money is typed from the client's collection register,
  // and the module is only read when it has the year's receipts.
  const readMoney = async (withSuggestions: boolean) => {
    setBusy(true);
    try {
      const m = await loadBuilderYearMoney(client.id, financialYear);
      const fresh = withSuggestions ? m.cancellations.filter((c) => !doc.adjustments.some((a) => a.sourceId === c.id)) : [];
      if (!withSuggestions && m.receiptCount === 0 && m.refunds === 0) {
        toast.info(`The Builder module holds no receipts for FY ${financialYear}. Type the figures from the collection register.`);
        return;
      }
      if (withSuggestions && fresh.length === 0) {
        toast.info(m.cancellations.length ? 'Every refunded cancellation is already listed.' : `The Builder module holds no refunds for FY ${financialYear}. Add the line by hand.`);
        return;
      }
      setDoc((d) => {
        if (withSuggestions) {
          const added: BuilderAdvAdjustment[] = fresh.map((c) => ({
            id: newId(), row: 'O', sourceId: c.id, amount: c.refunded,
            label: `Advance refunded to a cancelled member${c.unit ? ` (unit ${c.unit})` : ''}`,
            reason: `Booking cancelled${c.date ? ` on ${c.date}` : ''}; GST was paid on the advance when received and the refund reduced the advance in the books.`,
          }));
          return { ...d, adjustments: [...d.adjustments, ...added] };
        }
        return {
          ...d,
          tieOut: { source: 'builder', receipts: m.receipts, gstIncluded: 0, chequeReturns: 0, refunds: m.refunds, readAt: new Date().toISOString(), note: d.tieOut?.note ?? '' },
        };
      }, withSuggestions ? 'Suggested 5O lines from Builder cancellations' : 'Read receipts and refunds from the Builder module');
      toast.success(withSuggestions
        ? `Added ${fresh.length} refunded cancellation${fresh.length === 1 ? '' : 's'}.`
        : `Read ${m.receiptCount} receipt${m.receiptCount === 1 ? '' : 's'} from the Builder module.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the Builder module.');
    } finally {
      setBusy(false);
    }
  };

  const submitReason = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      if (ask.kind === 'close') await flush();
      if (ask.kind === 'close') await closeBuilderYear(client.id, ask.fy, me.id, reason);
      else await reopenBuilderYear(client.id, ask.fy, me.id, reason);
      toast.success(ask.kind === 'close' ? `FY ${ask.fy} closed.` : `FY ${ask.fy} reopened.`);
      setAsk(null);
      setReason('');
      await reloadChain();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!doc) {
    return (
      <SectionCard title="Builder advance roll-forward" description="Customer advances, year by year, explaining Table 5 (the firm's TURNOVER IN 9C sheet).">
        <Note tone="info">
          Advance received in the FY = closing advance − opening advance + revenue recognised. Once started, it fills 5B, 5C, 5H, 5I, 5J and 5O.
          {prevYear ? ` The openings come from FY ${prevYear.fy}.` : ' This is the first year of the chain, so its openings are typed.'}
        </Note>
        {why && <Note tone="warn">{why}</Note>}
        <Button size="sm" onClick={start} disabled={readOnly || !chain || !!why}>Start the advance roll-forward</Button>
        {loadError && <Note tone="warn">{loadError}</Note>}
      </SectionCard>
    );
  }

  const rf = rollForward(doc);
  const first = !prevYear;
  const later = (chain ?? []).filter((y) => y.fy > financialYear);
  const rows: Array<{ fy: string; r: ReturnType<typeof rollForward>; year: BuilderChainYear | null }> = [
    ...(chain ?? []).filter((y) => y.fy < financialYear).map((y) => ({ fy: y.fy, r: rollForward(y.doc), year: y })),
    { fy: financialYear, r: rf, year: self },
    ...later.map((y) => ({ fy: y.fy, r: rollForward(y.doc), year: y })),
  ];
  const latestClosed = [...(chain ?? [])].filter((y) => y.closed && y.closedHow === 'closed').sort((a, b) => b.fy.localeCompare(a.fy))[0] ?? null;
  const canReopen = isSuper && latestClosed && !(chain ?? []).some((y) => y.fy > latestClosed.fy && y.closed);
  const revenueVs5A = Math.abs(doc.revenue - W.t5.A) > 0.5;

  const field = (label: string, value: number, onChange: (v: number) => void, opts: { locked?: boolean; note?: string } = {}) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-0">
      <div className="min-w-0 text-sm">
        {label}
        {opts.note && <div className="text-[11px] text-muted-foreground">{opts.note}</div>}
      </div>
      {opts.locked || !editable
        ? <span className="w-44 text-right text-sm tabular-nums text-muted-foreground">{fmt(value)}</span>
        : <MoneyInput label={label} value={value} onChange={onChange} />}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile label={`Advance received in FY ${financialYear}`} value={fmt(rf.received)} />
        <KpiTile label="Unadjusted advance at the end" value={fmt(rf.unadjustedEnd)} tone={Math.abs(rf.unadjustedEnd - rf.closingAdvance) > 0.5 ? 'warn' : 'neutral'} />
        <KpiTile label="5P · Turnover after adjustments" value={fmt(W.t5.P)} />
        <KpiTile label="5R · Un-reconciled" value={fmt(W.t5.R)} tone={Math.abs(W.t5.R) > 1 ? 'warn' : 'ok'} />
      </div>

      <SectionCard
        title="Builder advance roll-forward"
        description="Earlier years are read-only. Only the open year changes, and its openings are carried from the closed year before."
        excelRef="TURNOVER IN 9C · MAIN"
        actions={(
          <>
            {self?.closed
              ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />FY {financialYear} closed</span>
              : me.isManager && (
                <Button size="sm" variant="outline" disabled={readOnly || busy || !!why} onClick={() => setAsk({ kind: 'close', fy: financialYear })}>
                  <Lock className="mr-1 h-3.5 w-3.5" />Close FY {financialYear}
                </Button>
              )}
            {canReopen && latestClosed && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk({ kind: 'reopen', fy: latestClosed.fy })}>
                <LockOpen className="mr-1 h-3.5 w-3.5" />Reopen FY {latestClosed.fy}
              </Button>
            )}
          </>
        )}
      >
        {why && <Note tone="warn">{why}</Note>}
        {loadError && <Note tone="warn">{loadError}</Note>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="border-b text-right">
                <th className="py-1.5 text-left font-medium">FY</th>
                <th className="font-medium">Opening advance</th>
                <th className="font-medium">Closing advance</th>
                <th className="font-medium">Revenue recognised</th>
                <th className="font-medium">Advance received</th>
                <th className="font-medium">Received to date</th>
                <th className="font-medium">Sales to date</th>
                <th className="font-medium">Unadjusted at end</th>
                <th className="pl-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ fy, r, year }) => (
                <tr key={fy} className={`border-b text-right last:border-0 ${fy === financialYear ? 'bg-muted/40 font-medium' : 'text-muted-foreground'}`}>
                  <td className="py-1.5 text-left">{fy}</td>
                  <td>{fmt(r.openingAdvance)}</td>
                  <td>{fmt(r.closingAdvance)}</td>
                  <td>{fmt(r.revenue)}</td>
                  <td>{fmt(r.received)}</td>
                  <td>{fmt(r.receivedToDate)}</td>
                  <td>{fmt(r.salesToDate)}</td>
                  <td>{fmt(r.unadjustedEnd)}</td>
                  <td className="pl-2 text-left">
                    {year?.closed
                      ? <span title={year.closeReason ?? undefined} className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />{year.closedHow === 'locked' ? 'Locked' : `Closed${year.closedBy ? ` by ${year.closedBy}` : ''}`}</span>
                      : fy === financialYear ? (editable ? 'Open' : 'Read-only') : 'Open'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title={`FY ${financialYear} figures`} description="From the audited financial statements.">
          {field('Opening advance', doc.openingAdvance, (v) => setDoc((d) => ({ ...d, openingAdvance: v })), { locked: !first, note: first ? 'First year of the chain: typed' : `Carried from FY ${prevYear?.fy}` })}
          {field('Unbilled revenue at the beginning (5B)', doc.openingUnbilled, (v) => setDoc((d) => ({ ...d, openingUnbilled: v })), { locked: !first })}
          {first && field('Advance received before this FY', doc.receivedBefore, (v) => setDoc((d) => ({ ...d, receivedBefore: v })), { note: 'Total advance received in all earlier years' })}
          {first && field('Sales accounted before this FY', doc.salesBefore, (v) => setDoc((d) => ({ ...d, salesBefore: v })))}
          {field('Closing advance (5C)', doc.closingAdvance, (v) => setDoc((d) => ({ ...d, closingAdvance: v })), { note: `Customer advances in the balance sheet at 31 March ${Number(financialYear.slice(0, 4)) + 1}` })}
          {field('Revenue recognised (transferred to WIP / sales)', doc.revenue, (v) => setDoc((d) => ({ ...d, revenue: v })))}
          {revenueVs5A && (
            <Note tone="warn">
              Revenue recognised differs from 5A ({fmt(W.t5.A)}).
              {editable && <Button size="sm" variant="link" className="h-auto px-1 py-0 text-xs" onClick={() => setDoc((d) => ({ ...d, revenue: W.t5.A }))}>Use 5A</Button>}
            </Note>
          )}
          {field('Unbilled revenue at the end (5H)', doc.closingUnbilled, (v) => setDoc((d) => ({ ...d, closingUnbilled: v })))}
        </SectionCard>

        <SectionCard
          title="Tie-out with collections"
          description="Collections in the FY from the collection register or bank book, less GST and cheque returns and refunds, against the advance received above. A check only: it never fills Table 5."
          actions={<Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void readMoney(false)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Fill from Builder module</Button>}
        >
          {(() => {
            const T = doc.tieOut ?? emptyTieOut();
            const fromBuilder = T.source === 'builder';
            return (
              <>
                <p className="text-[11px] text-muted-foreground">
                  {fromBuilder
                    ? `Read from the Builder module${T.readAt ? ` on ${new Date(T.readAt).toLocaleString('en-IN')}` : ''} (receipts excl. GST, bounced cheques left out). Typing a figure switches to the books.`
                    : 'Typed from the books. Use Fill from Builder module only where the year\'s receipts were recorded there.'}
                </p>
                {field('Total collected from customers', T.receipts, (v) => setTie({ receipts: v }))}
                {field('Less: GST included in the collections', T.gstIncluded, (v) => setTie({ gstIncluded: v }))}
                {field('Less: cheques returned', T.chequeReturns, (v) => setTie({ chequeReturns: v }))}
                {field('Less: refunds paid to cancelled members', T.refunds, (v) => setTie({ refunds: v }))}
                {rf.tieOut && (
                  <>
                    {field('Net advance collected', rf.tieOut.net, () => undefined, { locked: true })}
                    {field('Difference against the roll-forward', rf.tieOut.diff, () => undefined, { locked: true })}
                    <Textarea
                      aria-label="Tie-out note"
                      placeholder="Why the figures differ (opening entries, receipts before onboarding, adjustments by journal …)"
                      className="min-h-[60px] text-sm"
                      disabled={!editable}
                      defaultValue={T.note}
                      onBlur={(e) => { if (e.target.value !== T.note) setDoc((d) => ({ ...d, tieOut: { ...(d.tieOut ?? emptyTieOut()), note: e.target.value } })); }}
                    />
                  </>
                )}
              </>
            );
          })()}
        </SectionCard>
      </div>

      <SectionCard
        title="Other adjustments (5J and 5O)"
        description="An advance refunded to a cancelled member is 5O (+). Use 5J (−) only where a credit note was raised in the books."
        actions={(
          <>
            <Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void readMoney(true)}>Suggest from cancellations</Button>
            <Button size="sm" variant="outline" disabled={!editable} onClick={() => setDoc((d) => ({ ...d, adjustments: [...d.adjustments, { id: newId(), row: 'O', label: '', amount: 0, reason: '', sourceId: null }] }))}>
              <Plus className="mr-1 h-3.5 w-3.5" />Add line
            </Button>
          </>
        )}
      >
        {doc.adjustments.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        {doc.adjustments.map((a) => (
          <div key={a.id} className="grid gap-2 border-b pb-2 last:border-0 sm:grid-cols-[90px_1fr_auto_auto]">
            <select
              aria-label="Table 5 row"
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={a.row}
              disabled={!editable}
              onChange={(e) => setAdj(a.id, { row: e.target.value === 'J' ? 'J' : 'O' })}
            >
              <option value="O">5O (+)</option>
              <option value="J">5J (−)</option>
            </select>
            <div className="space-y-1">
              <Input aria-label="Description" className="h-8 text-sm" placeholder="Description" disabled={!editable} defaultValue={a.label} onBlur={(e) => { if (e.target.value !== a.label) setAdj(a.id, { label: e.target.value }); }} />
              <Input aria-label="Reason" className="h-8 text-xs" placeholder="Reason (goes to Table 6)" disabled={!editable} defaultValue={a.reason} onBlur={(e) => { if (e.target.value !== a.reason) setAdj(a.id, { reason: e.target.value }); }} />
            </div>
            {editable ? <MoneyInput label="Amount" value={a.amount} onChange={(v) => setAdj(a.id, { amount: v })} /> : <span className="w-44 text-right text-sm tabular-nums">{fmt(a.amount)}</span>}
            <Button size="icon" variant="ghost" aria-label="Remove line" disabled={!editable} onClick={() => setDoc((d) => ({ ...d, adjustments: d.adjustments.filter((x) => x.id !== a.id) }))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Justification of difference in GSTR-9C (Table 5)" description="What the roll-forward puts in Table 5.">
        {[
          ['5A', 'Turnover as per audit report', W.t5.A],
          ['5B', 'Add: unbilled revenue at the beginning', rf.t5.B],
          ['5C', 'Add: unadjusted advances at the end', rf.t5.C],
          ['5H', 'Less: unbilled revenue at the end', rf.t5.H],
          ['5I', 'Less: unadjusted advances at the beginning', rf.t5.I],
          ['5J', 'Less: credit notes not permissible under GST', rf.t5.J],
          ['5O', 'Add: other adjustments', rf.t5.O],
          ['5P', 'Annual turnover after adjustments', W.t5.P],
          ['5Q', 'Turnover as per GSTR-9', W.t5.Q],
          ['5R', 'Difference (Q − P)', W.t5.R],
        ].map(([code, label, v]) => (
          <div key={code as string} className={`flex items-center justify-between border-b py-1 text-sm last:border-0 ${code === '5R' || code === '5P' ? 'font-semibold' : ''}`}>
            <span><span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>{label}</span>
            <span className="tabular-nums">{fmt(v as number)}</span>
          </div>
        ))}
        {editable && <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={stop}>Switch off the roll-forward for FY {financialYear}</Button>}
      </SectionCard>

      <Dialog open={!!ask} onOpenChange={(o) => { if (!o) { setAsk(null); setReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ask?.kind === 'close' ? `Close FY ${ask?.fy}` : `Reopen FY ${ask?.fy}`}</DialogTitle>
            <DialogDescription>
              {ask?.kind === 'close'
                ? 'A closed year is read-only, and the next year opens with its closing figures. Only the superadmin can reopen it.'
                : 'The year becomes editable again, and the next year cannot change until it is closed again.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button>
            <Button disabled={busy || !reason.trim()} onClick={() => void submitReason()}>{ask?.kind === 'close' ? 'Close the year' : 'Reopen the year'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderAdvanceCard;
