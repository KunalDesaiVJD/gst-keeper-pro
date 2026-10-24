import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/PageHeader';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_PAGE, WS_BTN } from '@/components/workspace/theme';
import { toast } from 'sonner';
import { BellRing, CalendarRange, Inbox, Loader2, Mail, RefreshCw, Send, Shield, Users, FileText } from 'lucide-react';
import ReminderDatesTab from '@/components/reminders/ReminderDatesTab';
import SendNowTab from '@/components/reminders/SendNowTab';
import OutboxTab, { type OutboxRow } from '@/components/reminders/OutboxTab';
import ReminderClientsTab from '@/components/reminders/ReminderClientsTab';
import NoticeAlertsTab from '@/components/reminders/NoticeAlertsTab';
import EmailTemplatesEditor from '@/components/reminders/EmailTemplatesEditor';

// GST Reminders: one tab per job, so the page stays short.
//   Dates      when each reminder goes out, per return period (any date, e.g.
//              before Diwali), plus the every-month standard
//   Send now   one reminder now for any period, or today's scheduled ones
//   Outbox     every e-mail queued, read it as sent, stop a queued one
//   Clients    who gets reminders and filing confirmations
//   Templates  the wording
//   Notice alerts  staff alerts (E1–E13)
// The date rules are in supabase/functions/_shared/reminderPlan.ts.

const TABS = ['dates', 'send', 'outbox', 'clients', 'templates', 'alerts'] as const;
type TabKey = (typeof TABS)[number];
const TAB_STORE = 'gst-reminders-tab';
const NO_SEND = 'Needs the Send client e-mails permission — ask a GST Manager to add it to your position';

const readTab = (): TabKey => {
  try {
    const v = localStorage.getItem(TAB_STORE);
    return (TABS as readonly string[]).includes(v ?? '') ? (v as TabKey) : 'dates';
  } catch { return 'dates'; }
};

interface RemindersPageProps {
  // When rendered inside the Settings "GST Reminders" tab, hide the big page
  // title/description (Settings already provides the heading) but keep the
  // Send-queued / Refresh actions.
  embedded?: boolean;
}

const RemindersPage: React.FC<RemindersPageProps> = ({ embedded = false }) => {
  const { isStaffRole, canSendClientEmails } = useAuth();
  const [tab, setTab] = useState<TabKey>(readTab);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: outbox }, { data: clients }] = await Promise.all([
      supabase
        .from('email_outbox')
        .select('id, client_id, to_email, kind, return_type, period_month, subject, status, error, reminder_step, created_at, sent_at')
        .order('created_at', { ascending: false })
        .limit(400),
      supabase.from('clients').select('id, name'),
    ]);
    setRows((outbox ?? []) as OutboxRow[]);
    setNames(Object.fromEntries((clients ?? []).map((c) => [c.id as string, c.name as string])));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const changeTab = (v: string) => {
    setTab(v as TabKey);
    try { localStorage.setItem(TAB_STORE, v); } catch { /* per-viewer convenience only */ }
  };
  const refreshAll = () => { void load(); setRefreshKey((k) => k + 1); };

  const sendNow = async () => {
    if (!canSendClientEmails()) { toast.error(NO_SEND); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-gst-email', { body: {} });
    setSending(false);
    if (error) { toast.error(`Send failed: ${error.message}`); return; }
    const r = (data ?? {}) as { sent?: number; failed?: number };
    if ((r.sent ?? 0) === 0 && (r.failed ?? 0) === 0) toast.info('Nothing queued to send.');
    else toast.success(`Sent ${r.sent ?? 0}${r.failed ? ` · ${r.failed} failed` : ''}.`);
    void load();
  };

  const queued = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows]);

  if (!isStaffRole()) {
    return <div className="py-12 text-center text-muted-foreground">This page is for staff only.</div>;
  }

  return (
    <div className={embedded ? 'space-y-3' : WS_PAGE}>
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
              disabled={sending || !canSendClientEmails() || queued === 0}
              title={canSendClientEmails() ? 'Send the queued e-mails now instead of waiting up to 15 minutes' : NO_SEND}
              className={WS_BTN}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send {queued || ''} queued now
            </Button>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading} className={WS_BTN}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </>
        }
      />

      <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" />
        <span>
          Sending is <strong>live</strong> from <strong>gst@vjdesai.com</strong>. Reminders are queued at 9:30 am IST on their dates;
          filing confirmations when a return is marked <em>Filed</em>. Queued e-mails go out every 15 minutes
          {queued ? <> · <button type="button" className="font-medium underline" onClick={() => changeTab('outbox')}>{queued} queued now</button></> : null}.
        </span>
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className={TAB_LIST_CLASS}>
          <TabsTrigger value="dates" className={TAB_TRIGGER_CLASS}><CalendarRange className="h-4 w-4" /> Reminder dates</TabsTrigger>
          <TabsTrigger value="send" className={TAB_TRIGGER_CLASS}><Send className="h-4 w-4" /> Send now</TabsTrigger>
          <TabsTrigger value="outbox" className={TAB_TRIGGER_CLASS}><Inbox className="h-4 w-4" /> Outbox{queued ? ` (${queued})` : ''}</TabsTrigger>
          <TabsTrigger value="clients" className={TAB_TRIGGER_CLASS}><Users className="h-4 w-4" /> Clients</TabsTrigger>
          <TabsTrigger value="templates" className={TAB_TRIGGER_CLASS}><FileText className="h-4 w-4" /> E-mail wording</TabsTrigger>
          <TabsTrigger value="alerts" className={TAB_TRIGGER_CLASS}><Shield className="h-4 w-4" /> Notice alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="dates" className="mt-3"><ReminderDatesTab key={refreshKey} /></TabsContent>
        <TabsContent value="send" className="mt-3"><SendNowTab key={refreshKey} onQueued={() => void load()} /></TabsContent>
        <TabsContent value="outbox" className="mt-3"><OutboxTab rows={rows} names={names} loading={loading} onChanged={() => void load()} /></TabsContent>
        <TabsContent value="clients" className="mt-3"><ReminderClientsTab key={refreshKey} /></TabsContent>
        <TabsContent value="templates" className="mt-3">
          <p className="mb-2 text-sm text-muted-foreground">
            The wording of each reminder, confirmation and notice alert. The letterhead, details box and signature are added automatically.
          </p>
          <EmailTemplatesEditor />
        </TabsContent>
        <TabsContent value="alerts" className="mt-3"><NoticeAlertsTab key={refreshKey} onRan={() => void load()} /></TabsContent>
      </Tabs>
    </div>
  );
};

export default RemindersPage;
