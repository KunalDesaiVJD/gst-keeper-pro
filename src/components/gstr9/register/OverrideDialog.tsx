import React, { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { applicability, croreText, type ApplicabilityInput, type Override } from '@/lib/gstr9/applicability';
import { setApplicabilityOverride, type OverridePatch } from '@/lib/gstr9/register';
import { ViewSwitch } from '../reco/StepTabs';

type Choice = 'auto' | Override;

export interface OverrideTarget {
  clientId: string;
  name: string;
  gstin: string | null;
  /** What the engine is given, without the override, to show the turnover rule's own answer. */
  input: ApplicabilityInput;
  current9: Override | null;
  current9c: Override | null;
  reason: string;
  by: string | null;
  at: string | null;
}

const CHOICES = [
  { value: 'auto' as const, label: 'Auto', title: 'Decided by the aggregate turnover' },
  { value: 'required' as const, label: 'Required' },
  { value: 'not_required' as const, label: 'Not required' },
];

const ruleText = (need: string, file: boolean): string =>
  need === 'required' ? 'Required' : need === 'unknown' ? 'Turnover not typed' : file ? 'Exempt, filing (client wishes)' : 'Not required';

/**
 * The superadmin's override of one client's GSTR-9 / 9C applicability for the
 * year, over the turnover rule, with a reason; Auto puts it back on the rule.
 * The database checks the actor again (annual_return_set_applicability_override).
 */
export const OverrideDialog: React.FC<{
  target: OverrideTarget | null;
  financialYear: string;
  actorId: string;
  onClose: () => void;
  onSaved: (clientId: string, patch: OverridePatch) => void;
}> = ({ target, financialYear, actorId, onClose, onSaved }) => {
  const [g9, setG9] = useState<Choice>('auto');
  const [g9c, setG9c] = useState<Choice>('auto');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setG9(target.current9 ?? 'auto');
    setG9c(target.current9c ?? 'auto');
    setReason(target.reason);
  }, [target]);

  if (!target) return null;
  const rule = applicability({ ...target.input, gstr9Override: null, gstr9cOverride: null });
  const th = rule.thresholds;
  const auto = g9 === 'auto' && g9c === 'auto';
  const had = !!(target.current9 || target.current9c);
  const conflict = g9 === 'not_required' && g9c === 'required';
  const unchanged = (target.current9 ?? 'auto') === g9 && (target.current9c ?? 'auto') === g9c && target.reason.trim() === reason.trim();
  const needReason = !auto && !reason.trim();

  const pick9 = (v: Choice) => {
    setG9(v);
    // 9C goes with the GSTR-9 it reconciles.
    if (v === 'not_required' && g9c === 'required') setG9c('not_required');
  };
  const pick9c = (v: Choice) => {
    setG9c(v);
    if (v === 'required' && g9 === 'not_required') setG9('required');
  };

  const save = async (clear: boolean) => {
    setBusy(true);
    try {
      const p = await setApplicabilityOverride(
        target.clientId, financialYear, actorId,
        clear || g9 === 'auto' ? null : g9, clear || g9c === 'auto' ? null : g9c, clear ? '' : reason.trim(),
      );
      onSaved(target.clientId, p);
      toast.success(clear || (!p.gstr9_override && !p.gstr9c_override) ? `${target.name}: back to the turnover rule` : `${target.name}: override saved`);
      onClose();
    } catch (e) {
      toast.error('Not saved: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden /> Override applicability · FY {financialYear}
          </DialogTitle>
          <DialogDescription>
            {target.name}{target.gstin ? ` · ${target.gstin}` : ''}. Set GSTR-9 or 9C as Required or Not required whatever the turnover says.
            Auto goes back to the rule (GSTR-9 above {croreText(th.gstr9)}, GSTR-9C above {croreText(th.gstr9c)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {([
            ['GSTR-9', g9, pick9, ruleText(rule.gstr9, rule.file9)],
            ['GSTR-9C', g9c, pick9c, ruleText(rule.gstr9c, rule.file9c)],
          ] as const).map(([label, value, pick, ruleSays]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <div>
                <div className="font-medium">{label}</div>
                <div className="text-[11px] text-muted-foreground">By turnover: {ruleSays}</div>
              </div>
              <ViewSwitch<Choice> label={`${label} applicability`} value={value} onChange={pick} options={CHOICES} />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="ar-override-reason" className="text-xs">Reason{auto ? '' : ' (required)'}</Label>
            <Textarea
              id="ar-override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              placeholder="e.g. client wants the reconciliation for a bank / lender; turnover will be revised"
              rows={2}
              disabled={auto}
              className="text-xs"
            />
          </div>
          {had && target.by && (
            <p className="text-[11px] text-muted-foreground">
              Overridden by {target.by}{target.at ? ` on ${new Date(target.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}.
            </p>
          )}
          {conflict && <p className="text-[11px] text-destructive">GSTR-9C goes with the GSTR-9 it reconciles.</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {had
            ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save(true)}>Revert to auto</Button>
            : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="button" size="sm" disabled={busy || unchanged || needReason || conflict || (auto && !had)} onClick={() => void save(auto)}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OverrideDialog;
