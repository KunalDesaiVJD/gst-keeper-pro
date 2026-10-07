// The matter's money (audit U-86-1..5, U-93-1..4): the arithmetic in one
// place (demand − paid − pre-deposit = outstanding, refunds apart), the
// pre-deposit an appeal needs and whether it is covered, every payment with
// its DRC-03 ARN checked against the portal, and a payment form that starts
// from the client's synced DRC-03s, knows what each kind does and previews the
// effect before saving.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtInr } from '@/lib/noticeFormat';
import {
  forumKey, PAYMENT_KINDS, paymentKind, paymentTotal, recordPayment, removePayment, type Drc03Filing, type MatterPayment, type MatterWorkspace,
} from '@/lib/litigationData';
import { cn } from '@/lib/utils';

const HEADS = ['tax', 'interest', 'penalty', 'cess'] as const;
type Head = (typeof HEADS)[number];
const HEAD_LABEL: Record<Head, string> = { tax: 'Tax', interest: 'Interest', penalty: 'Penalty', cess: 'Cess' };
const n0 = (v: unknown) => Number(v) || 0;
const cell = (v: number) => (v ? fmtInr(v) : '—');

/** Paid and deposited per head, from the payment rows (refunds apart). */
function byHead(payments: MatterPayment[]) {
  const z = () => ({ tax: 0, interest: 0, penalty: 0, cess: 0 });
  const paid = z(), pre = z(), refund = z();
  payments.forEach((p) => {
    const eff = paymentKind(p.kind).effect;
    const into = eff === 'pre_deposit' ? pre : eff === 'refund' ? refund : paid;
    HEADS.forEach((h) => { into[h] += n0(p[h]); });
  });
  return { paid, pre, refund };
}

const drcHeads = (d: Drc03Filing) => ({
  tax: n0(d.igst_amount) + n0(d.cgst_amount) + n0(d.sgst_amount), interest: n0(d.interest_amount),
  penalty: n0(d.penalty_amount) + n0(d.late_fee_amount), cess: n0(d.cess_amount),
});
const drcTotal = (d: Drc03Filing) => {
  const h = drcHeads(d);
  return h.tax + h.interest + h.penalty + h.cess || n0(d.cash_amount) + n0(d.credit_amount);
};

/** Is this an appeal (it needs a pre-deposit)? */
export const isAppeal = (ws: MatterWorkspace) => {
  const f = forumKey(ws.matter);
  return f === 'appellate' || f === 'tribunal' || ws.matter.lifecycle === 'appeal' || ws.matter.lifecycle === 'tribunal';
};

/** The pre-deposit the appeal needs, from the litigation rules. */
export function preDepositNeed(ws: MatterWorkspace) {
  const tax = n0(ws.matter.demand_tax);
  const p107 = ws.rules.get('predeposit_pct.s107') ?? 10;
  const p112 = ws.rules.get('predeposit_pct.s112') ?? 10;
  const first = Math.round((tax * p107) / 100);
  const further = Math.round((tax * p112) / 100);
  const tribunal = forumKey(ws.matter) === 'tribunal' || ws.matter.lifecycle === 'tribunal';
  return { tax, p107, p112, first, further, required: tribunal ? first + further : first, tribunal };
}

export const RecordPaymentDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; ws: MatterWorkspace; onDone: () => void; kind?: string }> = ({ open, onOpenChange, ws, onDone, kind: presetKind }) => {
  const { user } = useAuth();
  const m = ws.matter;
  const available = useMemo(() => ws.drc03.filter((d) => d.arn && !ws.usedArns.has(d.arn)), [ws.drc03, ws.usedArns]);
  const [drc, setDrc] = useState('');
  const [kind, setKind] = useState('voluntary');
  const [arn, setArn] = useState('');
  const [heads, setHeads] = useState<Record<Head, number>>({ tax: 0, interest: 0, penalty: 0, cess: 0 });
  const [paidOn, setPaidOn] = useState(istToday());
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDrc(''); setKind(presetKind ?? (isAppeal(ws) ? 'pre_deposit' : 'voluntary')); setArn('');
    setHeads({ tax: 0, interest: 0, penalty: 0, cess: 0 }); setPaidOn(istToday()); setRemarks('');
  }, [open, presetKind, ws]);

  const pick = (a: string) => {
    setDrc(a);
    const d = available.find((x) => x.arn === a);
    if (!d) return;
    const h = drcHeads(d);
    setHeads(h.tax + h.interest + h.penalty + h.cess ? h : { tax: drcTotal(d), interest: 0, penalty: 0, cess: 0 });
    setArn(d.arn ?? '');
    if (d.filed_date) setPaidOn(d.filed_date);
    if (/pre-?deposit|107\(6\)|112\(8\)/i.test(`${d.cause_of_payment ?? ''} ${d.section ?? ''}`)) setKind('pre_deposit');
    setRemarks(d.cause_of_payment ?? '');
  };

  const def = paymentKind(kind);
  const total = HEADS.reduce((s, h) => s + heads[h], 0);
  const done = byHead(ws.payments);
  const demand: Record<Head, number> = { tax: n0(m.demand_tax), interest: n0(m.demand_interest), penalty: n0(m.demand_penalty), cess: n0(m.demand_cess) };
  const left = (h: Head) => Math.max(demand[h] - done.paid[h] - done.pre[h], 0);
  const over = def.effect !== 'refund' ? HEADS.filter((h) => demand[h] > 0 && heads[h] > left(h)) : [];
  const after = def.effect === 'refund' ? ws.money.outstanding : Math.max(ws.money.outstanding - total, 0);
  const errors = [
    total <= 0 ? 'Enter an amount' : '',
    !paidOn ? 'Enter the date paid' : paidOn > istToday() ? 'The date cannot be in the future' : '',
    def.arnRequired && !arn.trim() ? 'A DRC-03 needs its ARN' : '',
  ].filter(Boolean);

  const save = async () => {
    if (!user || errors.length) return;
    setSaving(true);
    try {
      await recordPayment(m.id, { kind, drc03_arn: arn.trim() || null, ...heads, paid_on: paidOn, remarks: remarks.trim() || null }, user);
      toast.success(`${fmtInr(total)} recorded · ${def.label}`);
      onOpenChange(false); onDone();
    } catch (e) { toast.error(`Couldn't record the payment: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>{m.matter_no} · {ws.client?.name} · outstanding {fmtInr(ws.money.outstanding)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rp-drc" className="text-xs">From a DRC-03 synced from the portal</Label>
            <Select value={drc} onValueChange={pick} disabled={!available.length}>
              <SelectTrigger id="rp-drc" className="h-9 text-sm"><SelectValue placeholder={available.length ? `Pick one of ${available.length}` : 'None of this client\'s DRC-03s is unrecorded'} /></SelectTrigger>
              <SelectContent>
                {available.map((d) => (
                  <SelectItem key={d.id} value={d.arn as string}>{d.arn} · {fmtDate(d.filed_date)} · {fmtInr(drcTotal(d))}{d.cause_of_payment ? ` · ${d.cause_of_payment}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Fills the heads, the date and the ARN; or type them below.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-kind" className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="rp-kind" className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{def.help}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rp-arn" className="text-xs">ARN / CPIN / challan{def.arnRequired && <span className="text-destructive"> *</span>}</Label>
              <Input id="rp-arn" value={arn} onChange={(e) => setArn(e.target.value)} className="h-9 font-mono" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-date" className="text-xs">Paid on <span className="text-destructive">*</span></Label>
              <Input id="rp-date" type="date" value={paidOn} max={istToday()} onChange={(e) => setPaidOn(e.target.value)} className="h-9" />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Amount by head (₹) <span className="font-normal text-muted-foreground">· total {fmtInr(total)}</span></legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HEADS.map((h) => (
                <div key={h} className="space-y-1">
                  <Label htmlFor={`rp-${h}`} className="text-xs">{HEAD_LABEL[h]}</Label>
                  <NumberInput id={`rp-${h}`} min={0} value={heads[h] || ''} className={cn('h-9', over.includes(h) && 'border-warning')}
                    onChange={(e) => setHeads((x) => ({ ...x, [h]: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) }))} />
                  <p className="text-[11px] text-muted-foreground">{demand[h] > 0 ? `${fmtInr(left(h))} open` : 'no demand'}</p>
                </div>
              ))}
            </div>
          </fieldset>
          {over.length > 0 && <Note tone="warn">More than is open on {over.map((h) => HEAD_LABEL[h].toLowerCase()).join(', ')} — check the heads, or edit the demand first.</Note>}
          <div className="space-y-1">
            <Label htmlFor="rp-remarks" className="text-xs">Remarks</Label>
            <Input id="rp-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="h-9" />
          </div>
          {total > 0 && (
            <p className="text-xs">
              {def.effect === 'refund' ? <>A refund does not change what is outstanding ({fmtInr(ws.money.outstanding)}).</>
                : <>Outstanding {fmtInr(ws.money.outstanding)} → <span className="font-semibold">{fmtInr(after)}</span>{def.effect === 'pre_deposit' ? ' (as pre-deposit)' : ''}</>}
            </p>
          )}
          {errors.length > 0 && total > 0 && <p className="text-xs text-destructive-strong">{errors.join(' · ')}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || errors.length > 0}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const MatterPaymentsTab: React.FC<{ ws: MatterWorkspace; canEdit: boolean; onRecord: () => void; onChanged: () => void }> = ({ ws, canEdit, onRecord, onChanged }) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const m = ws.matter;
  const money = ws.money;
  const heads = byHead(ws.payments);
  const demand: Record<Head, number> = { tax: n0(m.demand_tax), interest: n0(m.demand_interest), penalty: n0(m.demand_penalty), cess: n0(m.demand_cess) };
  const portal = new Map(ws.drc03.filter((d) => d.arn).map((d) => [d.arn as string, d]));
  const withArn = ws.payments.filter((p) => p.drc03_arn);
  const onPortal = withArn.filter((p) => portal.has(p.drc03_arn as string)).length;
  const need = isAppeal(ws) ? preDepositNeed(ws) : null;
  const rowsSum = HEADS.reduce((s, h) => s + heads.paid[h] + heads.pre[h], 0);
  const drift = Math.abs(rowsSum - (money.paid + money.preDeposit)) > 1;

  const remove = async (p: MatterPayment) => {
    if (!user) return;
    if (!(await confirm({ title: `Remove this ${paymentKind(p.kind).label.toLowerCase()}?`, description: `${fmtInr(paymentTotal(p))} paid ${fmtDate(p.paid_on)}. The totals are worked out again and the removal is logged.`, confirmText: 'Remove', destructive: true }))) return;
    setBusy(p.id);
    try { await removePayment(p, user); toast.success('Payment removed'); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <SectionCard title="Where the money stands"
        description={money.recorded ? <>{fmtInr(money.demand)} demand − {fmtInr(money.paid)} paid − {fmtInr(money.preDeposit)} pre-deposit = <span className="font-semibold text-foreground">{fmtInr(money.outstanding)} outstanding</span></> : 'No demand recorded on this matter yet.'}
        actions={canEdit && <Button size="sm" className={WS_BTN} onClick={onRecord}><Plus className="h-3.5 w-3.5" aria-hidden /> Record payment</Button>}>
        <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="Demand, paid and outstanding by head">
          <table className={WS_TABLE}>
            <thead><tr>
              <th scope="col" className={WS_TH}><span className="sr-only">Line</span></th>
              {HEADS.map((h) => <th key={h} scope="col" className={cn(WS_TH, 'text-right')}>{HEAD_LABEL[h]}</th>)}
              <th scope="col" className={cn(WS_TH, 'text-right')}>Total</th>
            </tr></thead>
            <tbody>
              <tr className={WS_TR}><th scope="row" className={cn(WS_TD, 'text-left font-medium')}>Demand</th>{HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{cell(demand[h])}</td>)}<td className={WS_TD_NUM}>{cell(money.demand)}</td></tr>
              <tr className={WS_TR}><th scope="row" className={cn(WS_TD, 'text-left font-medium')}>Less paid</th>{HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{cell(heads.paid[h])}</td>)}<td className={WS_TD_NUM}>{cell(money.paid)}</td></tr>
              <tr className={WS_TR}><th scope="row" className={cn(WS_TD, 'text-left font-medium')}>Less pre-deposit</th>{HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{cell(heads.pre[h])}</td>)}<td className={WS_TD_NUM}>{cell(money.preDeposit)}</td></tr>
            </tbody>
            <tfoot><tr className={WS_TR_TOTAL}>
              <th scope="row" className={cn(WS_TD, 'text-left')}>Outstanding</th>
              {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{cell(Math.max(demand[h] - heads.paid[h] - heads.pre[h], 0))}</td>)}
              <td className={WS_TD_NUM}>{fmtInr(money.outstanding)}</td>
            </tr></tfoot>
          </table>
        </div>
        {money.refunded > 0 && <p className="text-xs">Refunded to the client: <span className="font-semibold">{fmtInr(money.refunded)}</span> (kept apart: a refund does not change what is outstanding).</p>}
        {drift && <Note tone="warn">The matter's saved totals (paid {fmtInr(money.paid)}, pre-deposit {fmtInr(money.preDeposit)}) differ from its payment rows — recording or removing a payment works them out again.</Note>}
      </SectionCard>

      {need && (
        <SectionCard title="Pre-deposit for the appeal" description={`${need.p107}% of the tax in dispute (s.107(6))${need.tribunal ? ` plus a further ${need.p112}% before the Tribunal (s.112(8))` : ''}`}>
          {need.tax <= 0 ? <p className="text-sm text-muted-foreground">Record the tax in dispute (Edit demand) to work out the pre-deposit.</p> : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-2"><div className="text-xs text-muted-foreground">Required</div><div className="text-lg font-semibold tabular-nums">{fmtInr(need.required)}</div>
                <div className="text-xs text-muted-foreground">on tax of {fmtInr(need.tax)}</div></div>
              <div className="rounded-md border px-3 py-2"><div className="text-xs text-muted-foreground">Deposited</div><div className="text-lg font-semibold tabular-nums">{fmtInr(money.preDeposit)}</div>
                <div className="text-xs text-muted-foreground">{ws.payments.filter((p) => paymentKind(p.kind).effect === 'pre_deposit').length} payment(s)</div></div>
              <div className={cn('rounded-md border px-3 py-2', money.preDeposit >= need.required ? 'border-success/40' : 'border-warning/60')}>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className={cn('text-sm font-semibold', money.preDeposit >= need.required ? 'text-success-strong' : 'text-foreground')}>
                  {money.preDeposit >= need.required ? 'Covered' : `${fmtInr(need.required - money.preDeposit)} short`}
                </div>
                <div className="text-xs text-muted-foreground">{money.preDeposit >= need.required ? 'recovery of the balance is stayed while the appeal is pending (s.107(7))' : 'pay before filing the appeal'}</div>
              </div>
            </div>
          )}
          <Note tone="position">
            {need.tribunal ? '' : `Before the Tribunal a further ${need.p112}% (${fmtInr(need.further)}) would be due (s.112(8)). `}
            A pre-deposit is refunded with interest if the appeal succeeds (s.115). Rates come from the firm's litigation rules; the statutory caps and the base for penalty-only orders need confirming.
          </Note>
        </SectionCard>
      )}

      <SectionCard title="Payments" description={ws.payments.length ? `${ws.payments.length} recorded${withArn.length ? ` · ${onPortal} of ${withArn.length} with an ARN found among the client's portal DRC-03s` : ''}` : 'None recorded yet'}>
        {ws.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payment recorded.{' '}
            <Link to={`/drc03-all?client=${m.client_id}`} className="text-primary underline underline-offset-2">See this client's DRC-03s</Link>
          </p>
        ) : (
          <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="Payments">
            <table className={WS_TABLE}>
              <thead><tr>
                <th scope="col" className={WS_TH}>Kind</th><th scope="col" className={WS_TH}>ARN / reference</th><th scope="col" className={WS_TH}>Paid on</th>
                {HEADS.map((h) => <th key={h} scope="col" className={cn(WS_TH, 'text-right')}>{HEAD_LABEL[h]}</th>)}
                <th scope="col" className={cn(WS_TH, 'text-right')}>Total</th>
                {canEdit && <th scope="col" className={cn(WS_TH, 'w-10')}><span className="sr-only">Remove</span></th>}
              </tr></thead>
              <tbody>
                {ws.payments.map((p) => {
                  const d = p.drc03_arn ? portal.get(p.drc03_arn) : undefined;
                  return (
                    <tr key={p.id} className={WS_TR}>
                      <td className={WS_TD}>
                        <div className="font-medium">{paymentKind(p.kind).label}</div>
                        {p.remarks && <div className="text-xs text-foreground/80">{p.remarks}</div>}
                      </td>
                      <td className={cn(WS_TD, 'text-xs')}>
                        {p.drc03_arn ? <span className="font-mono">{p.drc03_arn}</span> : <span className="text-muted-foreground">—</span>}
                        {p.drc03_arn && (d ? (
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <Badge variant="success" className="text-[10px]">On the portal</Badge>
                            {d.pdf_url && <a href={d.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2">PDF <ExternalLink className="h-3 w-3" aria-hidden /></a>}
                          </span>
                        ) : <span className="block text-[11px] text-muted-foreground">not among the synced DRC-03s</span>)}
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap')}>{fmtDate(p.paid_on)}</td>
                      {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{cell(n0(p[h]))}</td>)}
                      <td className={cn(WS_TD_NUM, 'font-semibold')}>{fmtInr(paymentTotal(p))}</td>
                      {canEdit && <td className={WS_TD}>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy === p.id} onClick={() => remove(p)}
                          aria-label={`Remove the payment of ${fmtInr(paymentTotal(p))} on ${fmtDate(p.paid_on)}`}>
                          {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={WS_TR_TOTAL}>
                  <th scope="row" colSpan={3} className={cn(WS_TD, 'text-left')}>Paid and deposited</th>
                  {HEADS.map((h) => <td key={h} className={WS_TD_NUM}>{cell(heads.paid[h] + heads.pre[h])}</td>)}
                  <td className={WS_TD_NUM}>{fmtInr(rowsSum)}</td>
                  {canEdit && <td className={WS_TD} />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};
