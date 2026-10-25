import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { runNoticeAlerts, describeAlertRun, setAlertsMode, type AlertsMode } from '@/lib/noticeAlertQueue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Shield } from 'lucide-react';

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

const ALERT_MODES: { value: AlertsMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No notice alerts are written.' },
  { value: 'preview', label: 'Preview', hint: 'Alerts are written to the outbox as previews and never sent — review them in the Outbox before going live.' },
  { value: 'live', label: 'Live', hint: 'Alerts are e-mailed to staff (the outbox is sent every 15 minutes).' },
];
const NO_RULES = 'Needs the E-mail templates & reminder rules permission — ask a GST Manager to add it to your position';

/** Notice alerts to staff (E1–E13): mode, rules, run now. */
const NoticeAlertsTab: React.FC<{ onRan: () => void }> = ({ onRan }) => {
  const { user, canManageNoticeAlerts, canManageEmailTemplates } = useAuth();
  const [rules, setRules] = useState<AlertRuleRow[]>([]);
  const [mode, setMode] = useState<AlertsMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, settingsRes] = await Promise.all([
      supabase.from('notice_alert_rules').select('id, alert_key, name, description, event_type, schedule, recipient, is_active, priority').order('alert_key'),
      supabase.from('notice_settings').select('alerts_mode').maybeSingle(),
    ]);
    setRules((data ?? []) as AlertRuleRow[]);
    setMode(settingsRes.error ? null : ((settingsRes.data?.alerts_mode ?? null) as AlertsMode | null));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <SectionCard
      title={<span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Notice alerts</span>}
      description="E-mails to staff, written by the database: new notices and assignments every 15 minutes, each owner's morning list at 09:30 IST, the weekly MIS on Mondays. Switch single rules off or run them now; an alert is never written twice."
      actions={
        <Button
          size="sm" variant="outline" className={WS_BTN} disabled={running}
          onClick={async () => {
            setRunning(true);
            const result = await runNoticeAlerts('all');
            setRunning(false);
            if (result.error) { toast.error(result.error); return; }
            toast.success(describeAlertRun(result));
            onRan();
          }}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />} Run notice alerts
        </Button>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-muted-foreground">Mode:</span>
        {ALERT_MODES.map((m) => (
          <Button
            key={m.value} size="sm" variant={mode === m.value ? 'default' : 'outline'} className={WS_BTN}
            disabled={savingMode || !canManageNoticeAlerts() || mode === null} title={m.hint}
            onClick={async () => {
              if (m.value === mode) return;
              if (m.value === 'live' && !window.confirm('Switch notice alerts to live? From now on they are e-mailed to staff.')) return;
              setSavingMode(true);
              const err = await setAlertsMode(m.value, user?.firstName ?? null);
              setSavingMode(false);
              if (err) { toast.error(`Could not change the alert mode: ${err}`); return; }
              setMode(m.value);
              toast.success(`Notice alerts: ${m.label}. ${m.hint}`);
            }}
          >
            {m.label}
          </Button>
        ))}
        {mode === null && !loading && <span className="text-muted-foreground">(alert engine not installed yet)</span>}
        {mode && <span className="text-muted-foreground">{ALERT_MODES.find((m) => m.value === mode)?.hint}</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : rules.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No alert rules configured.</div>
      ) : (
        <div className="space-y-1">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/30">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{rule.alert_key.split('_')[0]}</span>
                  <span className="text-sm font-medium">{rule.name}</span>
                  <Badge variant={rule.priority === 'critical' ? 'destructive' : rule.priority === 'low' ? 'secondary' : 'info'}>{rule.priority}</Badge>
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
                title={canManageEmailTemplates() ? undefined : NO_RULES}
                onCheckedChange={async (checked) => {
                  if (!canManageEmailTemplates()) { toast.error(NO_RULES); return; }
                  const { error } = await supabase.from('notice_alert_rules').update({ is_active: checked }).eq('id', rule.id);
                  if (error) { toast.error('Failed to update rule'); return; }
                  setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: checked } : r)));
                  toast.success(`${rule.name} ${checked ? 'enabled' : 'disabled'}`);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
};

export default NoticeAlertsTab;
