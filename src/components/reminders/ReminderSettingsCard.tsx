import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Save, BellRing } from 'lucide-react';

interface Props { clientId: string }

interface Settings {
  enabled: boolean;
  interval_days: number;
  escalate: boolean;
  send_confirmation: boolean;
  max_reminders: number | null;
}
const DEFAULTS: Settings = { enabled: false, interval_days: 3, escalate: true, send_confirmation: true, max_reminders: null };

/** Per-client GST reminder configuration (writes only to
 *  public.client_reminder_settings — independent of the client form). */
const ReminderSettingsCard: React.FC<Props> = ({ clientId }) => {
  const { user } = useAuth();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('client_reminder_settings')
        .select('enabled, interval_days, escalate, send_confirmation, max_reminders')
        .eq('client_id', clientId)
        .maybeSingle();
      if (cancelled) return;
      setS(data ? { ...DEFAULTS, ...data } : DEFAULTS);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  async function save() {
    setSaving(true);
    const interval = Math.min(90, Math.max(1, Math.round(Number(s.interval_days) || 3)));
    const { error } = await supabase
      .from('client_reminder_settings')
      .upsert(
        {
          client_id: clientId,
          enabled: s.enabled,
          interval_days: interval,
          escalate: s.escalate,
          send_confirmation: s.send_confirmation,
          max_reminders: s.max_reminders,
          updated_by: (user as unknown as { id?: string })?.id ?? null,
        },
        { onConflict: 'client_id' },
      );
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    setS(v => ({ ...v, interval_days: interval }));
    toast.success('Reminder settings saved');
  }

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" /> GST Data Reminders</CardTitle>
        <CardDescription>
          Automatic email reminders (from gst@vjdesai.com) asking this client to share their GST return data,
          plus a confirmation once the return is filed. Set per client.
        </CardDescription>
        <CardDescription className="pt-1">
          The on/off switch below applies to every return type. For GSTR-1, GSTR-3B, GSTR-6 and GSTR-7 the reminder
          days follow the firm-wide schedule (Settings → GST Reminders → Return reminder schedule), not the interval
          setting here — the interval and escalation settings below only apply to other return types (ITC-04, CMP-08, …).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y">
            {row(
              'Send reminders',
              'Master on/off switch for this client.',
              <Switch checked={s.enabled} onCheckedChange={v => setS(x => ({ ...x, enabled: v }))} />,
            )}
            {row(
              'Reminder interval',
              'How often to re-send while the data is still pending.',
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={90} value={s.interval_days} disabled={!s.enabled}
                  onChange={e => setS(x => ({ ...x, interval_days: Number(e.target.value) }))}
                  className="w-20 text-right" />
                <span className="text-sm text-muted-foreground">days</span>
              </div>,
            )}
            {row(
              'Escalate wording',
              'Move from a cordial reminder to a firmer one at each step (Reminder 1 → 2 → Final).',
              <Switch checked={s.escalate} disabled={!s.enabled} onCheckedChange={v => setS(x => ({ ...x, escalate: v }))} />,
            )}
            {row(
              'Stop after',
              'Optional cap on reminders (leave blank to keep reminding until data is received or the return is filed).',
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={20} value={s.max_reminders ?? ''} disabled={!s.enabled}
                  placeholder="—"
                  onChange={e => setS(x => ({ ...x, max_reminders: e.target.value === '' ? null : Number(e.target.value) }))}
                  className="w-20 text-right" />
                <span className="text-sm text-muted-foreground">reminders</span>
              </div>,
            )}
            {row(
              'Filing confirmation',
              'Email this client automatically when their return is marked "Filed" (no attachment).',
              <Switch checked={s.send_confirmation} onCheckedChange={v => setS(x => ({ ...x, send_confirmation: v }))} />,
            )}

            <div className="flex justify-end pt-4">
              <Button onClick={save} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save reminder settings
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ReminderSettingsCard;
