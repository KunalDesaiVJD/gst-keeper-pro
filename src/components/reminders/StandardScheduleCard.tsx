import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Save } from 'lucide-react';
import { PLAN_RETURN_TYPES, loadStandardSchedule, saveStandardSchedule, standardProblems, type StandardScheduleRow } from '@/lib/reminderPlans';

const NO_EDIT = 'Needs the E-mail templates & reminder rules permission — ask a GST Manager to add it to your position';
type Field = 'due_day' | 'due_day_y' | 'reminder_1_day' | 'reminder_2_day' | 'reminder_final_day';

/** The every-month standard: days of the month after the period. Collapsed by default. */
const StandardScheduleCard: React.FC<{ onSaved?: () => void }> = ({ onSaved }) => {
  const { user, canManageEmailTemplates } = useAuth();
  const canEdit = canManageEmailTemplates();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, StandardScheduleRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await loadStandardSchedule();
      setRows(Object.fromEntries(data.map((r) => [r.return_type, r])));
      setDirty(false);
    } catch (e) { toast.error(`Could not load the standard dates: ${(e as Error).message}`); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const set = (rt: string, f: Field, v: string) => {
    setDirty(true);
    setRows((p) => ({ ...p, [rt]: { ...p[rt], [f]: v === '' ? null : Number(v) } }));
  };

  const present = PLAN_RETURN_TYPES.filter((rt) => rows[rt]);
  const problems = present.flatMap((rt) => standardProblems(rows[rt]).map((p) => `${rt}: ${p}`))
    .concat(present.filter((rt) => [rows[rt].reminder_1_day, rows[rt].reminder_2_day, rows[rt].reminder_final_day].some((d) => d == null)).map((rt) => `${rt}: every standard reminder needs a day.`));

  const save = async () => {
    if (!canEdit) { toast.error(NO_EDIT); return; }
    setSaving(true);
    try {
      await saveStandardSchedule(present.map((rt) => rows[rt]), user?.id ?? null);
      toast.success('Standard dates saved. Periods with their own dates keep them.');
      await load();
      onSaved?.();
    } catch (e) { toast.error(`Save failed: ${(e as Error).message}`); }
    setSaving(false);
  };

  const dayInput = (rt: string, f: Field) => (
    <Input
      type="number" min={1} max={28}
      value={rows[rt]?.[f] ?? ''}
      disabled={!canEdit}
      onChange={(e) => set(rt, f, e.target.value)}
      className="h-8 w-16 text-center text-sm"
      aria-label={`${rt} ${f}`}
    />
  );

  return (
    <SectionCard
      title={
        <button type="button" className="flex items-center gap-1.5 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Standard dates (every month)
        </button>
      }
      description="The day of the month after the period on which each reminder goes out, for every period without dates of its own. Each reminder must come before the next, and none after the due day."
      actions={open && dirty ? (
        <Button size="sm" className={WS_BTN} onClick={() => void save()} disabled={saving || problems.length > 0 || !canEdit} title={canEdit ? undefined : NO_EDIT}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save standard dates
        </Button>
      ) : undefined}
    >
      {!open ? null : loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={WS_TH}>Return</th>
                  <th className={WS_TH}>Due day</th>
                  <th className={WS_TH}>1st reminder</th>
                  <th className={WS_TH}>2nd reminder</th>
                  <th className={WS_TH}>Final reminder</th>
                </tr>
              </thead>
              <tbody>
                {present.map((rt) => (
                  <tr key={rt} className={WS_TR}>
                    <td className={cn(WS_TD, 'whitespace-nowrap font-medium')}>{rt}</td>
                    <td className={WS_TD}>
                      <div className="flex items-center gap-1.5">
                        {dayInput(rt, 'due_day')}
                        {rt === 'GSTR-3B (Q)' && <><span className="text-xs text-muted-foreground">24th group</span>{dayInput(rt, 'due_day_y')}</>}
                      </div>
                    </td>
                    <td className={WS_TD}>{dayInput(rt, 'reminder_1_day')}</td>
                    <td className={WS_TD}>{dayInput(rt, 'reminder_2_day')}</td>
                    <td className={WS_TD}>{dayInput(rt, 'reminder_final_day')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {problems.length > 0 && (
            <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive-strong">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Other returns (ITC-04, CMP-08, …) are reminded every few days instead, as set on each client's page.
          </p>
        </div>
      )}
    </SectionCard>
  );
};

export default StandardScheduleCard;
