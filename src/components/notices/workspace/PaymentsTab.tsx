import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { linkPayment, unlinkPayment, type Workspace } from '@/lib/noticeWorkspace';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<string, string> = { drc03: 'DRC-03', pre_deposit: 'Pre-deposit', other: 'Other' };

/**
 * What has been paid against the notice (audit U-77-3): DRC-03s of this client
 * linked by ARN, pre-deposits and other payments; the matter's own payments
 * stay on the matter.
 */
export const PaymentsTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void }> = ({ ws, canEdit, onChanged }) => {
  const { user } = useAuth();
  const [arn, setArn] = useState('');
  const [kind, setKind] = useState<'pre_deposit' | 'other'>('pre_deposit');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(istToday());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const linked = new Set(ws.payments.map((p) => p.drc03_arn).filter(Boolean));
  const candidates = ws.drc03.filter((d) => d.arn && !linked.has(d.arn));
  const total = ws.payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const linkDrc03 = () => {
    const d = ws.drc03.find((x) => x.arn === arn);
    if (!d || !user) return;
    const amt = Number(d.cash_amount || 0) + Number(d.credit_amount || 0);
    run(() => linkPayment(ws.notice.id, { kind: 'drc03', drc03_arn: d.arn, amount: amt, paid_on: d.filed_date, note: d.cause_of_payment }, user), `DRC-03 ${d.arn} linked`).then(() => setArn(''));
  };

  return (
    <div className="space-y-3">
      {ws.payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment recorded against this notice.</p>
      ) : (
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE}>
            <thead><tr>
              <th scope="col" className={WS_TH}>Kind</th><th scope="col" className={WS_TH}>ARN / note</th>
              <th scope="col" className={WS_TH}>Paid on</th><th scope="col" className={cn(WS_TH, 'text-right')}>Amount</th>
              {canEdit && <th scope="col" className={cn(WS_TH, 'w-10')}><span className="sr-only">Unlink</span></th>}
            </tr></thead>
            <tbody>
              {ws.payments.map((p) => (
                <tr key={p.id} className={WS_TR}>
                  <td className={WS_TD}>{KIND_LABEL[p.kind] ?? p.kind}</td>
                  <td className={cn(WS_TD, 'text-xs')}><span className="font-mono">{p.drc03_arn}</span>{p.note ? <span className="block text-muted-foreground">{p.note}</span> : null}</td>
                  <td className={WS_TD}>{fmtDate(p.paid_on)}</td>
                  <td className={WS_TD_NUM}>{fmtInr(p.amount)}</td>
                  {canEdit && <td className={WS_TD}>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Unlink payment ${p.drc03_arn ?? ''}`} disabled={busy}
                      onClick={() => run(() => unlinkPayment(p.id), 'Payment unlinked')}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className={WS_TR_TOTAL}>
              <td className={WS_TD} colSpan={3}>Paid against this notice</td><td className={WS_TD_NUM}>{fmtInr(total)}</td>{canEdit && <td className={WS_TD} />}
            </tr></tfoot>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="grid gap-3 lg:grid-cols-2">
          <SectionCard title="Link a DRC-03" description={candidates.length ? `${candidates.length} of this client's DRC-03s are not linked to it` : 'No unlinked DRC-03 of this client on record'}>
            <div className="flex gap-2">
              <Select value={arn} onValueChange={setArn} disabled={!candidates.length}>
                <SelectTrigger className="h-8 text-xs" aria-label="DRC-03"><SelectValue placeholder="Pick a DRC-03" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((d) => (
                    <SelectItem key={d.id} value={d.arn as string} className="text-xs">
                      {d.arn} · {fmtDate(d.filed_date)} · {fmtInr(Number(d.cash_amount || 0) + Number(d.credit_amount || 0))}{d.cause_of_payment ? ` · ${d.cause_of_payment}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs" disabled={!arn || busy} onClick={linkDrc03}>{busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Link</Button>
            </div>
            <Link to={`/drc03-all?client=${ws.notice.client_id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">All DRC-03s of this client <ExternalLink className="h-3 w-3" /></Link>
          </SectionCard>
          <SectionCard title="Record a pre-deposit or other payment">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pay-kind" className="text-xs">Kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as 'pre_deposit' | 'other')}>
                  <SelectTrigger id="pay-kind" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="pre_deposit" className="text-xs">Pre-deposit (appeal)</SelectItem><SelectItem value="other" className="text-xs">Other</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-amount" className="text-xs">Amount (₹)</Label>
                <NumberInput id="pay-amount" value={amount ?? ''} onChange={(e) => setAmount(e.target.value === '' ? null : Number(e.target.value))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-date" className="text-xs">Paid on</Label>
                <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-note" className="text-xs">Note</Label>
                <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="h-8 text-xs" disabled={!amount || busy}
                onClick={() => user && run(() => linkPayment(ws.notice.id, { kind, amount: amount ?? 0, paid_on: date || null, note: note || null }, user), 'Payment recorded').then(() => { setAmount(null); setNote(''); })}>
                Record
              </Button>
            </div>
          </SectionCard>
        </div>
      )}
      {ws.matter && (
        <Note tone="info" open>
          Matter <Link to={`/litigation/${ws.matter.id}`} className="font-medium text-primary hover:underline">{ws.matter.matter_no}</Link> records its own payments:
          paid {fmtInr(ws.matter.paid_total)} · pre-deposit {fmtInr(ws.matter.pre_deposit_total)}.
        </Note>
      )}
    </div>
  );
};

export default PaymentsTab;
