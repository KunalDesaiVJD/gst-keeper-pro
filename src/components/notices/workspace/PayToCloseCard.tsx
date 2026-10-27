import React, { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { fmtDate, fmtInr } from '@/lib/noticeFormat';
import { istToday } from '@/lib/noticeFacts';
import { HEAD_LABEL, payToCloseQuote, quoteText, type QuoteNotice } from '@/lib/noticePayToClose';
import { cn } from '@/lib/utils';

/**
 * What it costs to end the demand by paying it (section C of the law audit):
 * tax, interest to the day of payment and the reduced penalty still open, head
 * by head as the DRC-03 takes them, and the last day those figures hold.
 */
export const PayToCloseCard: React.FC<{ notice: QuoteNotice & { reference_number?: string | null } }> = ({ notice }) => {
  const today = istToday();
  const [payOn, setPayOn] = useState(today);
  const q = useMemo(() => payToCloseQuote(notice, today, payOn && payOn >= (notice.issue_date ?? '') ? payOn : today), [notice, today, payOn]);
  if (!q) return null;
  const label = `${notice.form_code ?? 'Notice'}${notice.reference_number ? ` ${notice.reference_number}` : ''}`;
  return (
    <SectionCard title="Pay to close" description={`${q.title} (${q.law})`}
      info="Worked out from the demand the portal records on the notice, head by head. Interest keeps running at 18% a year on the tax from the notice's date to the day of payment. The reduced penalty holds only while its window is open, and only if the tax and interest are paid in full. Check the figures against the portal before paying."
      actions={<>
        {q.payBy && <Badge variant={q.payBy >= today ? 'warning' : 'secondary'} className="text-[11px]">Pay by {fmtDate(q.payBy)}</Badge>}
        <Button size="sm" variant="ghost" className={WS_BTN}
          onClick={() => navigator.clipboard.writeText(quoteText(q, label)).then(() => toast.success('Copied.'), () => toast.error('Could not copy.'))}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
        </Button>
      </>}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ptc-date" className="text-xs">Paid on</Label>
          <Input id="ptc-date" type="date" value={payOn} min={today} onChange={(e) => setPayOn(e.target.value || today)} className="h-8 w-40 text-xs" />
        </div>
        <p className="text-xs text-muted-foreground">Penalty: {q.penaltyBasis}. {q.closes ? 'Paid in full, this ends the proceedings.' : 'Paying now stops interest; the order still decides the penalty.'}</p>
      </div>
      <div className={WS_TABLE_WRAP}>
        <table className={WS_TABLE}>
          <thead><tr>
            <th scope="col" className={WS_TH}>Head</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Tax</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Interest in the notice</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Interest since</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Penalty</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>To pay</th>
          </tr></thead>
          <tbody>
            {q.rows.map((r) => (
              <tr key={r.head} className={WS_TR}>
                <td className={WS_TD}>{HEAD_LABEL[r.head]}</td>
                <td className={WS_TD_NUM}>{fmtInr(r.tax)}</td>
                <td className={WS_TD_NUM}>{fmtInr(r.interest_notice)}</td>
                <td className={WS_TD_NUM}>{fmtInr(r.interest_since)}</td>
                <td className={WS_TD_NUM}>{fmtInr(r.penalty)}</td>
                <td className={WS_TD_NUM}>{fmtInr(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className={WS_TR_TOTAL}>
            <td className={WS_TD}>Total</td>
            <td className={WS_TD_NUM}>{fmtInr(q.total.tax)}</td>
            <td className={WS_TD_NUM}>{fmtInr(q.total.interest_notice)}</td>
            <td className={WS_TD_NUM}>{fmtInr(q.total.interest_since)}</td>
            <td className={WS_TD_NUM}>{fmtInr(q.total.penalty)}</td>
            <td className={WS_TD_NUM}>{fmtInr(q.total.total)}</td>
          </tr></tfoot>
        </table>
      </div>
      <p className="text-xs">{q.howToPay}</p>
      {q.next && <p className="text-xs text-muted-foreground">{q.next}</p>}
      <Note tone="info">{q.notes.join(' ')}</Note>
    </SectionCard>
  );
};

export default PayToCloseCard;
