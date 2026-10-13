import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/gstr9/badge';
import { supabase } from '@/integrations/supabase/client';
import { EINVOICE_APPROACH_AT, EINVOICE_THRESHOLD, type EinvoiceAssessment } from '@/lib/einvoice/threshold';
import {
  loadEinvoiceData,
  listDueEinvoiceAlerts,
  sendEinvoiceThresholdAlerts,
  type DueEinvoiceAlert,
} from '@/lib/einvoice/thresholdAlerts';

const crore = (n: number) => `₹${(n / 1_00_00_000).toFixed(2)} cr`;

interface SentAlert { financial_year: string; level: string; turnover: number; notified_at: string }

/**
 * The e-invoice threshold alert for one client, inside Edit Client →
 * E-invoicing. Only clients still below ₹5 crore and at ₹4 crore or more are
 * alerted — clients past ₹5 crore already e-invoice. Nothing is sent until
 * staff press Send; the email goes to the client.
 */
export const EinvoiceAlertCard: React.FC<{ clientId: string }> = ({ clientId }) => {
  const confirm = useConfirm();
  const { user, canSendClientEmails } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [assessment, setAssessment] = useState<EinvoiceAssessment | null>(null);
  const [due, setDue] = useState<DueEinvoiceAlert | null>(null);
  const [sent, setSent] = useState<SentAlert[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { assessments, clientsById } = await loadEinvoiceData([clientId]);
      setAssessment(assessments.get(clientId) ?? null);
      setDue((await listDueEinvoiceAlerts(assessments, clientsById))[0] ?? null);
      const { data } = await supabase
        .from('einvoice_threshold_alerts')
        .select('financial_year, level, turnover, notified_at')
        .eq('client_id', clientId)
        .order('notified_at', { ascending: false });
      setSent((data as SentAlert[] | null) ?? []);
    } catch (err) {
      console.error('E-invoice alert check failed:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!due) return;
    if (!canSendClientEmails()) { toast.error('Needs the Send client e-mails permission — ask a GST Manager to add it to the role'); return; }
    // The saved email is what the alert goes to; an unsaved edit is not used.
    const to = due.client.email;
    if (!to) { toast.error('No email saved for this client — add one and save first'); return; }
    const ok = await confirm({
      title: 'Send the e-invoice alert?',
      description: `Emails ${to}: FY ${due.fy} turnover ${crore(due.turnover)}, approaching the ₹5 crore e-invoice limit.`,
      confirmText: 'Send email',
    });
    if (!ok) return;
    setSending(true);
    try {
      const r = await sendEinvoiceThresholdAlerts([due], { id: user?.id ?? null, name: user?.firstName ?? null });
      if (r.sent) toast.success('E-invoice alert sent');
      else if (r.alreadySent) toast.info('Already sent by someone else');
      else toast.error('Could not send the alert');
    } catch (e) {
      toast.error('Could not send: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
      void load();
    }
  };

  if (loading) {
    return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking turnover…</p>;
  }

  const y = assessment?.decidingYear;
  const inBand = !!y && y.turnover >= EINVOICE_APPROACH_AT && y.turnover < EINVOICE_THRESHOLD;
  const last = sent[0];

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Threshold alert</p>
          <p className="text-xs text-muted-foreground">
            {y ? `FY ${y.financial_year} turnover ${crore(y.turnover)} (${y.source === 'entered' ? 'entered' : 'from GSTR-1'})` : 'No turnover on record'}
          </p>
        </div>
        {due ? (
          <div className="flex items-center gap-2">
            <Badge variant="warning">Alert due</Badge>
            <Button type="button" size="sm" onClick={() => void send()} disabled={sending || !due.client.email || !canSendClientEmails()}>
              {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Send alert
            </Button>
          </div>
        ) : last ? (
          <Badge variant="success">Sent</Badge>
        ) : (
          <Badge variant="secondary">{inBand ? 'Not due' : 'Not tracked'}</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Sent only to clients still below ₹5 crore with turnover of ₹4 crore or more; clients past ₹5 crore already e-invoice.
      </p>
      {due && !due.client.email && <p className="text-xs text-destructive">No email saved for this client — add one and save before sending.</p>}
      {last && (
        <p className="text-xs text-muted-foreground">
          Last sent {format(new Date(last.notified_at), 'dd MMM yyyy, HH:mm')} for FY {last.financial_year} ({crore(Number(last.turnover))}).
        </p>
      )}
    </div>
  );
};
