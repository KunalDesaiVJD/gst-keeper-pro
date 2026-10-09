import React, { useState } from 'react';
import { Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import {
  sendEinvoiceThresholdAlerts,
  type DueEinvoiceAlert,
  type EinvoiceAlertSendResult,
} from '@/lib/einvoice/thresholdAlerts';

const STATUS: Record<DueEinvoiceAlert['att'], { label: string; variant: 'warning' | 'destructive' }> = {
  approaching: { label: 'Approaching', variant: 'warning' },
  next_fy: { label: 'Applies next FY', variant: 'warning' },
  should_tick: { label: 'Mandatory — not ticked', variant: 'destructive' },
};

const crore = (n: number) => `₹${(n / 1_00_00_000).toFixed(2)} cr`;
const key = (d: DueEinvoiceAlert) => `${d.client.id}|${d.fy}|${d.level}`;

const summarise = (r: EinvoiceAlertSendResult): string => {
  const parts = [`${r.sent} email${r.sent === 1 ? '' : 's'} sent`];
  if (r.alreadySent) parts.push(`${r.alreadySent} already sent by someone else`);
  if (r.noEmail) parts.push(`${r.noEmail} skipped — no email on file`);
  if (r.failed) parts.push(`${r.failed} failed`);
  return parts.join(' · ');
};

/**
 * Clients due an e-invoice threshold email. Nothing is sent until staff press
 * Send (per client) or Send all — the email goes to the client, so it is a
 * deliberate act, not a side effect of opening the page.
 */
export const EinvoiceAlertsPanel: React.FC<{
  due: DueEinvoiceAlert[];
  actor: { id?: string | null; name?: string | null };
  onSent: () => void;
}> = ({ due, actor, onSent }) => {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | 'all' | null>(null);
  if (!due.length) return null;

  const withEmail = due.filter((d) => !!d.client.email);

  const send = async (items: DueEinvoiceAlert[], busyKey: string) => {
    setBusy(busyKey);
    try {
      const r = await sendEinvoiceThresholdAlerts(items, actor);
      if (r.failed) toast.error(summarise(r));
      else toast.success(summarise(r));
    } catch (e) {
      toast.error('Could not send: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
      onSent();
    }
  };

  const sendOne = async (d: DueEinvoiceAlert) => {
    const ok = await confirm({
      title: `Email ${d.client.name}?`,
      description: `Sends the e-invoice threshold letter to ${d.client.email}: FY ${d.fy} turnover ${crore(d.turnover)} — ${STATUS[d.att].label.toLowerCase()}.`,
      confirmText: 'Send email',
    });
    if (ok) await send([d], key(d));
  };

  const sendAll = async () => {
    const ok = await confirm({
      title: `Email ${withEmail.length} client${withEmail.length === 1 ? '' : 's'}?`,
      description: `Sends the e-invoice threshold letter to every client below that has an email on file.${due.length > withEmail.length ? ` ${due.length - withEmail.length} without an email will be skipped.` : ''}`,
      confirmText: `Send ${withEmail.length} email${withEmail.length === 1 ? '' : 's'}`,
    });
    if (ok) await send(withEmail, 'all');
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          E-invoice alerts to send
          <Badge variant="warning" className="text-[10px] font-medium">{due.length}</Badge>
        </span>
      }
      description="Clients approaching or past the ₹5 crore e-invoice limit who have not been told for that year. Nothing is emailed until you press Send."
      actions={
        <Button size="sm" className={WS_BTN} onClick={sendAll} disabled={!!busy || !withEmail.length}>
          {busy === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send all ({withEmail.length})
        </Button>
      }
    >
      <div className={cn(WS_TABLE_WRAP, 'max-h-72')}>
        <table className={WS_TABLE} aria-label="E-invoice alerts to send">
          <thead>
            <tr>
              <th className={WS_TH}>Client</th>
              <th className={WS_TH}>Status</th>
              <th className={WS_TH}>FY</th>
              <th className={cn(WS_TH, 'text-right')}>Turnover</th>
              <th className={WS_TH}>Email</th>
              <th className={cn(WS_TH, 'border-r-0')} aria-label="Send" />
            </tr>
          </thead>
          <tbody>
            {due.map((d) => (
              <tr key={key(d)} className={WS_TR}>
                <td className={WS_TD}>{d.client.name}</td>
                <td className={WS_TD}>
                  <Badge variant={STATUS[d.att].variant} className="text-[10px] font-medium">{STATUS[d.att].label}</Badge>
                </td>
                <td className={WS_TD}>{d.fy}</td>
                <td className={WS_TD_NUM}>{crore(d.turnover)}</td>
                <td className={cn(WS_TD, !d.client.email && 'text-muted-foreground')}>
                  {d.client.email || 'No email on file — add it in Edit Client'}
                </td>
                <td className={cn(WS_TD, 'border-r-0 text-right')}>
                  <Button
                    variant="outline"
                    size="sm"
                    className={WS_BTN}
                    disabled={!!busy || !d.client.email}
                    onClick={() => sendOne(d)}
                    title={d.client.email ? `Email ${d.client.email}` : 'No email on file'}
                  >
                    {busy === key(d) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                    Send
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
};

export default EinvoiceAlertsPanel;
