import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, Save, CalendarClock } from 'lucide-react';

// Fixed order matching the firm's reminder-day table — not DB row order.
const RETURN_TYPES = ['GSTR-1', 'GSTR-3B', 'GSTR-6', 'GSTR-7'] as const;

interface ScheduleRow {
  return_type: string;
  due_day: number;
  reminder_1_day: number;
  reminder_2_day: number;
  reminder_final_day: number;
}

const clampDay = (n: unknown, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(28, Math.max(1, v)) : fallback;
};

/** Staff-editable, firm-wide reminder schedule for GSTR-1 / GSTR-3B / GSTR-6 /
 *  GSTR-7 — one due date + 3 reminder days per return type, the same for
 *  every client. queue-gst-reminders fires reminder_1/2/final on these exact
 *  calendar days for any client with reminders enabled (see the per-client
 *  "GST Data Reminders" card for that on/off switch). Any other return type
 *  keeps using the per-client interval ladder instead of this table. */
const ReturnReminderScheduleCard: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Record<string, ScheduleRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('return_reminder_schedules').select('*');
    if (error) { toast.error('Failed to load reminder schedule: ' + error.message); setLoading(false); return; }
    setRows(Object.fromEntries((data ?? []).map((r) => [r.return_type, r as ScheduleRow])));
    setLoading(false);
  }

  function setField(returnType: string, field: keyof Omit<ScheduleRow, 'return_type'>, value: string) {
    setRows((prev) => {
      const row = prev[returnType];
      if (!row) return prev;
      return { ...prev, [returnType]: { ...row, [field]: value === '' ? ('' as unknown as number) : Number(value) } };
    });
  }

  async function save() {
    setSaving(true);
    const payload = RETURN_TYPES.filter((rt) => rows[rt]).map((rt) => {
      const r = rows[rt];
      return {
        return_type: rt,
        due_day: clampDay(r.due_day, r.due_day),
        reminder_1_day: clampDay(r.reminder_1_day, r.reminder_1_day),
        reminder_2_day: clampDay(r.reminder_2_day, r.reminder_2_day),
        reminder_final_day: clampDay(r.reminder_final_day, r.reminder_final_day),
        updated_by: (user as unknown as { id?: string })?.id ?? null,
      };
    });
    const { error } = await supabase.from('return_reminder_schedules').upsert(payload, { onConflict: 'return_type' });
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success('Reminder schedule saved');
    void load();
  }

  const dayInput = (returnType: string, field: keyof Omit<ScheduleRow, 'return_type'>) => (
    <Input
      type="number"
      min={1}
      max={28}
      value={rows[returnType]?.[field] ?? ''}
      onChange={(e) => setField(returnType, field, e.target.value)}
      className="w-16 text-center"
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" /> Return reminder schedule</CardTitle>
        <CardDescription>
          Firm-wide due date + reminder days (day of the following month) for GSTR-1, GSTR-3B, GSTR-6 and GSTR-7 — the
          same for every client. Reminder 1 / 2 / Final fire automatically on these days for any client with reminders
          enabled. Other return types (ITC-04, CMP-08, …) keep using each client&apos;s reminder interval instead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Return</th>
                    <th className="py-2 pr-3 font-medium">Due date</th>
                    <th className="py-2 pr-3 font-medium">1st reminder</th>
                    <th className="py-2 pr-3 font-medium">2nd reminder</th>
                    <th className="py-2 pr-3 font-medium">Final reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {RETURN_TYPES.filter((rt) => rows[rt]).map((rt) => (
                    <tr key={rt} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{rt}</td>
                      <td className="py-2.5 pr-3">{dayInput(rt, 'due_day')}</td>
                      <td className="py-2.5 pr-3">{dayInput(rt, 'reminder_1_day')}</td>
                      <td className="py-2.5 pr-3">{dayInput(rt, 'reminder_2_day')}</td>
                      <td className="py-2.5 pr-3">{dayInput(rt, 'reminder_final_day')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save schedule
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ReturnReminderScheduleCard;
