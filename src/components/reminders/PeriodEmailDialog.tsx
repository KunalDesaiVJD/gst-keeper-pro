import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { prettyPeriod } from '@/lib/gstReminders';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import {
  STEPS, STEP_LABEL, STEP_TEMPLATE, clearPeriodEmail, formatDate, loadReminderTemplates, savePeriodEmail,
  type PeriodEmailRow, type ReminderEmail, type ResolvedPlan, type ReminderStep,
} from '@/lib/reminderPlans';
import ReminderEmailComposer from './ReminderEmailComposer';

/**
 * The e-mail of each reminder of one return for one period: the template, or
 * wording written for this period only (reminder_period_emails).
 */
const PeriodEmailDialog: React.FC<{
  period: string;
  returnType: string;
  plan: ResolvedPlan;
  saved: PeriodEmailRow[];
  canEdit: boolean;
  user: { id: string | null; name: string | null };
  onClose: () => void;
  onChanged: () => void;
}> = ({ period, returnType, plan, saved, canEdit, user, onClose, onChanged }) => {
  const steps = STEPS.filter((s) => plan.dates[s]);
  const [step, setStep] = useState<ReminderStep>(steps.find((s) => saved.some((e) => e.step === s)) ?? steps[0] ?? 1);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof loadReminderTemplates>> | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ReminderStep, ReminderEmail>>>(
    Object.fromEntries(saved.map((e) => [e.step, { subject: e.subject, body: e.body }])),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadReminderTemplates().then(setTemplates).catch((e) => toast.error(`Could not load the templates: ${(e as Error).message}`));
  }, []);

  const savedRow = saved.find((e) => e.step === step);
  const draft = drafts[step];
  const tpl = templates?.[step];
  const own = !!draft;
  const dirty = own
    ? !savedRow || savedRow.subject !== draft.subject || savedRow.body !== draft.body
    : false;

  const writeOwn = () => setDrafts((d) => ({ ...d, [step]: { subject: tpl?.subject ?? '', body: tpl?.body ?? '' } }));

  const save = async () => {
    if (!draft || !draft.subject.trim() || !draft.body.trim()) { toast.error('Write a subject and a message.'); return; }
    setBusy(true);
    try {
      await savePeriodEmail({ period_month: period, return_type: returnType, step, ...draft }, user);
      toast.success(`${returnType} ${prettyPeriod(period)}: ${STEP_LABEL[step].toLowerCase()} will use this e-mail.`);
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  const useTemplate = async () => {
    if (savedRow) {
      if (!window.confirm(`Send the template again for the ${STEP_LABEL[step].toLowerCase()} of ${returnType}, ${prettyPeriod(period)}? The wording written here is removed.`)) return;
      setBusy(true);
      try {
        await clearPeriodEmail(period, returnType, step);
        toast.success(`${STEP_LABEL[step]} is back on the template.`);
        onChanged();
      } catch (e) { toast.error((e as Error).message); setBusy(false); return; }
      setBusy(false);
    }
    setDrafts((d) => { const n = { ...d }; delete n[step]; return n; });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base">E-mail · {returnType} · {prettyPeriod(period)}</DialogTitle>
          <DialogDescription>
            Write the wording for {prettyPeriod(period)} only. Other months keep the template.
          </DialogDescription>
        </DialogHeader>

        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminder dates for this period.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {steps.map((s) => {
                const isOwn = saved.some((e) => e.step === s);
                return (
                  <Button key={s} size="sm" variant={step === s ? 'default' : 'outline'} className={WS_BTN} onClick={() => setStep(s)}>
                    {STEP_LABEL[s]} · {formatDate(plan.dates[s])}
                    <span className={cn('ml-1 text-[10px] font-normal', step === s ? 'opacity-80' : 'text-muted-foreground')}>{isOwn ? 'own e-mail' : 'template'}</span>
                  </Button>
                );
              })}
            </div>

            {!own ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm">
                  The {STEP_LABEL[step].toLowerCase()} goes with the template{tpl ? <> “<span className="font-medium">{tpl.subject}</span>”</> : ''}.
                  {tpl && !tpl.is_active && <span className="text-amber-700"> The template is switched off, so this reminder is not sent unless you write one here.</span>}
                </p>
                <Button size="sm" className={WS_BTN} disabled={!canEdit || !templates} onClick={writeOwn}>
                  Write my own for {prettyPeriod(period)}
                </Button>
              </div>
            ) : (
              <ReminderEmailComposer
                value={draft!}
                onChange={(v) => setDrafts((d) => ({ ...d, [step]: v }))}
                templateKey={STEP_TEMPLATE[step]}
                sample={{ return_type: returnType, period: prettyPeriod(period), due_date: formatDate(plan.dueDate), data_by_date: formatDate(plan.dataByDate) }}
                disabled={!canEdit}
              />
            )}
            {savedRow?.updated_by_name && (
              <p className="text-[11px] text-muted-foreground">Written by {savedRow.updated_by_name}{savedRow.updated_at ? ` on ${new Date(savedRow.updated_at).toLocaleString('en-IN')}` : ''}.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {own && (
            <Button size="sm" variant="outline" className={WS_BTN} disabled={!canEdit || busy} onClick={() => void useTemplate()}>
              <RotateCcw className="h-3.5 w-3.5" /> Use the template
            </Button>
          )}
          <Button size="sm" variant="ghost" className={WS_BTN} onClick={onClose}>Close</Button>
          {own && (
            <Button size="sm" className={WS_BTN} disabled={!canEdit || busy || !dirty} onClick={() => void save()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save for {prettyPeriod(period)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PeriodEmailDialog;
