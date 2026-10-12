import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { prettyPeriod } from '@/lib/gstReminders';
import { runNoticeAlerts, describeAlertRun, setAlertsMode, type AlertsMode } from '@/lib/noticeAlertQueue';
import { buildEmailHtml } from '@/lib/emailTemplate';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import EmailTemplatesEditor from '@/components/reminders/EmailTemplatesEditor';
import ReturnReminderScheduleCard from '@/components/reminders/ReturnReminderScheduleCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR, WS_FILTER_LABEL, WS_CONTROL,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { BellRing, Send, RefreshCw, Loader2, Mail, Clock, CheckCircle2, XCircle, Ban, AlertTriangle, Shield, Eye } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────
type OutboxStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'preview';

interface OutboxRow {
  id: string;
  client_id: string;
  to_email: string;
  kind: 'reminder' | 'confirmation' | 'notice_alert';
  return_type: string;
  period_month: string | null;
  subject: string;
  status: OutboxStatus;
  error: string | null;
  reminder_step: number | null;
  created_at: string;
  sent_at: string | null;
  notice_id: string | null;
}

interface AlertRuleRow {
  id: string;
  alert_key: string;
  name: string;
  description: string | null;
  event_type: string | null;
  schedule: string | null;
  recipient: string;
  is_active: boolean;
  priority: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** 'MM/YYYY' → 'YYYY-MM' for the native <input type="month">. */
const toInputMonth = (mmYYYY: string): string => {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(mmYYYY || '');
  return m ? `${m[2]}-${m[1].padStart(2, '0')}` : '';
};
/** 'YYYY-MM' → 'MM/YYYY'. */
const fromInputMonth = (yyyyMM: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMM || '');
  return m ? `${m[2]}/${m[1]}` : yyyyMM;
};

const fmtWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type StatusVariant = 'warning' | 'success' | 'destructive' | 'secondary' | 'info';
const STATUS_META: Record<OutboxStatus, { label: string; variant: StatusVariant; icon: React.ReactNode }> = {
  pending: { label: 'Queued', variant: 'warning', icon: <Clock className="h-3 w-3" /> },
  sent: { label: 'Sent', variant: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: 'Failed', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  skipped: { label: 'Skipped', variant: 'secondary', icon: <Ban className="h-3 w-3" /> },
  cancelled: { label: 'Cancelled', variant: 'secondary', icon: <Ban className="h-3 w-3" /> },
  // Notice alerts written while the engine is in preview mode: never sent.
  preview: { label: 'Preview', variant: 'info', icon: <Eye className="h-3 w-3" /> },
};

const FILTERS = ['all', 'pending', 'sent', 'failed', 'preview'] as const;

const ALERT_MODES: { value: AlertsMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No notice alerts are written.' },
  { value: 'preview', label: 'Preview', hint: 'Alerts are written to the outbox as previews and never sent — review them here before going live.' },
  { value: 'live', label: 'Live', hint: 'Alerts are e-mailed to staff (the outbox is sent every 15 minutes).' },
];
type FilterKey = (typeof FILTERS)[number];

// ── Page ───────────────────────────────────────────────────────────────────────
interface RemindersPageProps {
  // When rendered inside the Settings "GST Reminders" tab, hide the big page
  // title/description (Settings already provides the heading) but keep the
  // Send-queued / Refresh actions.
  embedded?: boolean;
}

const RemindersPage: React.FC<RemindersPageProps> = ({ embedded = false }) => {
  const { user, isStaffRole, canManageNoticeAlerts, canSendClientEmails, canManageEmailTemplates } = useAuth();
  const { selectedMonth } = useMonth();

  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [queueing, setQueueing] = useState(false);
  const [sending, setSending] = useState(false);
  const [period, setPeriod] = useState(selectedMonth);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [alertRules, setAlertRules] = useState<AlertRuleRow[]>([]);
  const [runningAlerts, setRunningAlerts] = useState(false);
  const [alertsMode, setAlertsModeState] = useState<AlertsMode | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [previewRow, setPreviewRow] = useState<{ subject: string; html: string; to: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: outbox }, { data: clients }, { data: rules }, settingsRes] = await Promise.all([
      supabase
        .from('email_outbox')
        .select('id, client_id, to_email, kind, return_type, period_month, subject, status, error, reminder_step, created_at, sent_at, notice_id')
        .order('created_at', { ascending: false })
        .limit(400),
      supabase.from('clients').select('id, name'),
      supabase.from('notice_alert_rules').select('id, alert_key, name, description, event_type, schedule, recipient, is_active, priority').order('alert_key'),
      supabase.from('notice_settings').select('alerts_mode').maybeSingle(),
    ]);
    setAlertsModeState(settingsRes.error ? null : ((settingsRes.data?.alerts_mode ?? null) as AlertsMode | null));
    setRows((outbox ?? []) as OutboxRow[]);
    setNames(Object.fromEntries((clients ?? []).map((c) => [c.id as string, c.name as string])));
    setAlertRules((rules ?? []) as AlertRuleRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const queueDue = async () => {
    if (!canSendClientEmails()) { toast.error('Needs the Send client e-mails permission — ask a GST Manager to add it to your position'); return; }
    setQueueing(true);
    const { data, error } = await supabase.functions.invoke('queue-gst-reminders', {
      body: { period, staffName: user?.firstName ?? null },
    });
    setQueueing(false);
    if (error) { toast.error(`Queue failed: ${error.message}`); return; }
    const r = (data ?? {}) as { queued?: number; skipped?: number };
    if ((r.queued ?? 0) > 0) toast.success(`Queued ${r.queued} reminder${r.queued === 1 ? '' : 's'} for ${prettyPeriod(period)}.`);
    else toast.info(`No reminders due for ${prettyPeriod(period)}.${r.skipped ? ` (${r.skipped} not yet due / capped)` : ''}`);
    void load();
  };

  const sendNow = async () => {
    if (!canSendClientEmails()) { toast.error('Needs the Send client e-mails permission — ask a GST Manager to add it to your position'); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-gst-email', { body: {} });
    setSending(false);
    if (error) { toast.error(`Send failed: ${error.message}`); return; }
    const r = (data ?? {}) as { sent?: number; failed?: number };
    if ((r.sent ?? 0) === 0 && (r.failed ?? 0) === 0) toast.info('Nothing queued to send.');
    else toast.success(`Sent ${r.sent ?? 0}${r.failed ? ` · ${r.failed} failed` : ''}.`);
    void load();
  };

  const counts = useMemo(() => {
    const c = { pending: 0, sent: 0, failed: 0, preview: 0 };
    for (const r of rows) if (r.status in c) (c as Record<string, number>)[r.status]++;
    return c;
  }, [rows]);

  // Shows a notice alert exactly as it will look when sent (same letterhead
  // shell the sender applies), so a preview week can be reviewed here.
  const openPreview = async (id: string) => {
    const { data, error } = await supabase.from('email_outbox')
      .select('to_email, subject, body, kind, template_key, render_vars').eq('id', id).maybeSingle();
    if (error || !data) { toast.error('Could not load this e-mail.'); return; }
    const vars = (data.render_vars ?? {}) as Record<string, string>;
    setPreviewRow({
      to: data.to_email,
      subject: data.subject,
      html: buildEmailHtml({ key: data.template_key, kind: data.kind, message: data.body, vars }),
    });
  };

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  if (!isStaffRole()) {
    return <div className="py-12 text-center text-muted-foreground">This page is for staff only.</div>;
  }

  return (
    <div className={embedded ? 'space-y-3' : WS_PAGE}>
      {/* Header */}
      <PageHeader
        compact
        embedded={embedded}
        title="GST Reminders"
        subtitle={embedded ? undefined : 'Data-request reminders and filing confirmations'}
        icon={<BellRing />}
        actions={
          <>
            <Button
              size="sm"
              onClick={sendNow}
              disabled={sending || !canSendClientEmails()}
              title={canSendClientEmails() ? undefined : 'Needs the Send client e-mails permission — ask a GST Manager to add it to your position'}
              className={WS_BTN}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send queued now
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className={WS_BTN}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </>
        }
      />
      {!embedded && (
        <p className="text-sm text-muted-foreground">
          Data-request reminders and filing confirmations for clients. Choose who gets them per client on their edit
          page; edit the wording in the Email templates section below.
        </p>
      )}

      {/* Sending status */}
      <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" />
        <span>
          Sending is <strong>live</strong> from <strong>gst@vjdesai.com</strong>. Filing confirmations queue automatically
          when a return is marked <em>Filed</em>; reminders queue when due. Queued mail goes out on the daily run — or
          click <strong>Send queued now</strong> to flush it immediately.
        </span>
      </div>

      {/* Firm-wide reminder-day schedule for GSTR-1 / GSTR-3B / GSTR-6 / GSTR-7 */}
      <ReturnReminderScheduleCard />

      {/* Queue-due action */}
      <SectionCard
        title="Queue due reminders"
        description={
          <>
            For every client with reminders enabled whose return is still <strong>Data Pending</strong> this period,
            queue the next reminder if it's due — the fixed schedule above for GSTR-1 / GSTR-3B / GSTR-6 / GSTR-7,
            or the interval-based ladder (under the cap) for any other return type.
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <label htmlFor="reminder-period" className={WS_FILTER_LABEL}>Return period</label>
            <input
              id="reminder-period"
              type="month"
              value={toInputMonth(period)}
              onChange={(e) => setPeriod(fromInputMonth(e.target.value))}
              className={cn('block rounded-md border border-input bg-background px-2.5', WS_CONTROL, 'text-sm')}
            />
          </div>
          <Button
            size="sm"
            onClick={queueDue}
            disabled={queueing || !canSendClientEmails()}
            title={canSendClientEmails() ? undefined : 'Needs the Send client e-mails permission — ask a GST Manager to add it to your position'}
            className={WS_BTN}
          >
            {queueing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Queue due reminders
          </Button>
          <span className="pb-1.5 text-sm text-muted-foreground">{prettyPeriod(period)}</span>
        </div>
      </SectionCard>

      {/* Outbox */}
      <SectionCard
        title="Email outbox"
        description={
          <>
            {counts.pending} queued · {counts.sent} sent · {counts.failed} failed
            {counts.preview > 0 ? ` · ${counts.preview} notice-alert previews (not sent)` : ''}
          </>
        }
        actions={
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
            <TabsList className={TAB_LIST_CLASS}>
              {FILTERS.map((f) => (
                <TabsTrigger key={f} value={f} className={cn(TAB_TRIGGER_CLASS, 'capitalize')}>{f === 'all' ? 'All' : STATUS_META[f].label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      >
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nothing queued yet.</div>
          ) : (
            <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
              <table className={WS_TABLE}>
                <thead>
                  <tr>
                    <th className={WS_TH}>Client</th>
                    <th className={WS_TH}>Type</th>
                    <th className={WS_TH}>Return · Period</th>
                    <th className={WS_TH}>Subject</th>
                    <th className={WS_TH}>Status</th>
                    <th className={WS_TH}>Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const meta = STATUS_META[r.status] ?? STATUS_META.pending;
                    return (
                      <tr key={r.id} className={cn(WS_TR, 'align-top')}>
                        <td className={WS_TD}>
                          <div className="font-medium">{names[r.client_id] ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">{r.to_email}</div>
                        </td>
                        <td className={cn(WS_TD, 'whitespace-nowrap')}>
                          {r.kind === 'confirmation' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmation</span>
                          ) : r.kind === 'notice_alert' ? (
                            <span className="inline-flex items-center gap-1 text-violet-700"><AlertTriangle className="h-3.5 w-3.5" /> Notice Alert</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <BellRing className="h-3.5 w-3.5" /> Reminder{r.reminder_step ? ` #${r.reminder_step}` : ''}
                            </span>
                          )}
                        </td>
                        <td className={cn(WS_TD, 'whitespace-nowrap')}>
                          <div>{r.return_type}</div>
                          <div className="text-xs text-muted-foreground">{prettyPeriod(r.period_month)}</div>
                        </td>
                        <td className={cn(WS_TD, 'max-w-[22rem] truncate')} title={r.subject}>
                          {r.kind === 'notice_alert' ? (
                            <button
                              type="button"
                              className="max-w-full truncate text-left text-primary hover:underline"
                              onClick={() => void openPreview(r.id)}
                            >
                              {r.subject}
                            </button>
                          ) : r.subject}
                        </td>
                        <td className={WS_TD}>
                          <Badge variant={meta.variant} className="gap-1">{meta.icon}{meta.label}</Badge>
                          {r.status === 'failed' && r.error && (
                            <div className="mt-1 max-w-[16rem] truncate text-xs text-destructive-strong" title={r.error}>{r.error}</div>
                          )}
                        </td>
                        <td className={cn(WS_TD, 'whitespace-nowrap text-muted-foreground tabular-nums')}>{fmtWhen(r.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </SectionCard>

      {/* Notice Alerts — E1–E13 alert rules and manual trigger */}
      <SectionCard
        title={<span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Notice Alerts</span>}
        description="Written by the database: new notices and assignments every 15 minutes, each owner's morning list at 09:30 IST, the weekly MIS on Mondays. Toggle individual rules or run them now — an alert is never written twice."
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={runningAlerts}
            className={WS_BTN}
            onClick={async () => {
              setRunningAlerts(true);
              const result = await runNoticeAlerts('all');
              setRunningAlerts(false);
              if (result.error) { toast.error(result.error); return; }
              toast.success(describeAlertRun(result));
              void load();
            }}
          >
            {runningAlerts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Run notice alerts
          </Button>
        }
      >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Mode:</span>
              {ALERT_MODES.map((m) => (
                <Button
                  key={m.value}
                  size="sm"
                  variant={alertsMode === m.value ? 'default' : 'outline'}
                  className={WS_BTN}
                  disabled={savingMode || !canManageNoticeAlerts() || alertsMode === null}
                  title={m.hint}
                  onClick={async () => {
                    if (m.value === alertsMode) return;
                    if (m.value === 'live' && !window.confirm('Switch notice alerts to live? From now on they are e-mailed to staff.')) return;
                    setSavingMode(true);
                    const err = await setAlertsMode(m.value, user?.firstName ?? null);
                    setSavingMode(false);
                    if (err) { toast.error(`Could not change the alert mode: ${err}`); return; }
                    setAlertsModeState(m.value);
                    toast.success(`Notice alerts: ${m.label}. ${m.hint}`);
                  }}
                >
                  {m.label}
                </Button>
              ))}
              {alertsMode === null && <span className="text-muted-foreground">(alert engine not installed yet)</span>}
              {alertsMode && <span className="text-muted-foreground">{ALERT_MODES.find((m) => m.value === alertsMode)?.hint}</span>}
            </div>

          {alertRules.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No alert rules configured.</div>
          ) : (
            <div className="space-y-1">
              {alertRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{rule.alert_key.split('_')[0]}</span>
                      <span className="text-sm font-medium">{rule.name}</span>
                      <Badge variant={
                        rule.priority === 'critical' ? 'destructive' :
                        rule.priority === 'low' ? 'secondary' :
                        'info'
                      }>
                        {rule.priority}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{rule.recipient}</Badge>
                    </div>
                    {rule.description && <p className="mt-0.5 text-xs text-muted-foreground">{rule.description}</p>}
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {rule.event_type && <span>Trigger: <strong>{rule.event_type}</strong></span>}
                      {rule.schedule && <span>Schedule: <code className="rounded bg-muted px-1">{rule.schedule}</code></span>}
                    </div>
                  </div>
                  <Switch
                    checked={rule.is_active}
                    disabled={!canManageEmailTemplates()}
                    title={canManageEmailTemplates() ? undefined : 'Needs the E-mail templates & reminder rules permission — ask a GST Manager to add it to your position'}
                    onCheckedChange={async (checked) => {
                      if (!canManageEmailTemplates()) { toast.error('Needs the E-mail templates & reminder rules permission — ask a GST Manager to add it to your position'); return; }
                      const { error } = await supabase.from('notice_alert_rules').update({ is_active: checked }).eq('id', rule.id);
                      if (error) { toast.error('Failed to update rule'); return; }
                      setAlertRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: checked } : r));
                      toast.success(`${rule.name} ${checked ? 'enabled' : 'disabled'}`);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
      </SectionCard>

      <Dialog open={!!previewRow} onOpenChange={(o) => { if (!o) setPreviewRow(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">{previewRow?.subject}</DialogTitle>
            <DialogDescription>To {previewRow?.to}</DialogDescription>
          </DialogHeader>
          {previewRow && (
            <iframe
              title="E-mail preview"
              sandbox=""
              srcDoc={previewRow.html}
              className="h-[60vh] w-full rounded-md border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Email templates — edit the wording right here (also under Settings). */}
      <div className="pt-1">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-snug">
          <Mail className="h-4 w-4 text-primary" /> Email templates
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">
          Edit the wording of each reminder, confirmation, and notice alert. The letterhead, details box and signature are applied automatically.
        </p>
        <EmailTemplatesEditor />
      </div>
    </div>
  );
};

export default RemindersPage;
