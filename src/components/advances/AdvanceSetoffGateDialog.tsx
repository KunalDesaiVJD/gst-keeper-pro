import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Info, Loader2, ShieldCheck, Wand2, Clock, XCircle } from 'lucide-react';
import type { AdvanceCheckResult, AdvanceFinding } from '@/lib/advanceSetoffCheck';
import { OVERRIDE_REASON_MIN, type AdvanceOverride, type GateDecision } from '@/lib/advanceSetoffOverrides';

const inr = (n: number | undefined) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface AdvanceSetoffGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  periodMonth: string;
  returnLabel: string;
  check: AdvanceCheckResult | null;
  gate: GateDecision | null;
  override: AdvanceOverride | null;
  /** Whether this user may raise a request at all. */
  canRequest: boolean;
  /** Whether this user may decide — a manager gets a one-step self-override. */
  canApprove: boolean;
  /**
   * Present only where the draft can be fixed in place (the GSTR-1 gate).
   * Undefined hides the one-click fix and the dialog tells staff where to go.
   */
  onApplySuggested?: () => Promise<void>;
  onSubmitRequest: (reason: string) => Promise<void>;
  onApproveOwn: (reason: string) => Promise<void>;
  busy?: boolean;
}

const FindingRow: React.FC<{ f: AdvanceFinding }> = ({ f }) => {
  const hard = f.severity === 'hard';
  return (
    <div className={`rounded-md border p-3 ${hard ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5'}`}>
      <div className="flex items-start gap-2">
        {hard
          ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          : <Info className="h-4 w-4 mt-0.5 shrink-0 text-warning" />}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{f.title}</span>
            {/* Status carried by a word, not by colour alone — these get read
                on printouts and by anyone who can't distinguish the tints. */}
            <span className={`text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${
              hard ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'
            }`}>
              {hard ? 'Blocking' : 'Advisory'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.detail}</p>
          {f.suggested && (
            <p className="text-xs mt-1.5 text-foreground">
              Suggested Table 11B entry: <span className="font-semibold tabular-nums">{inr(f.suggested.taxable)}</span>
              {' '}at {f.suggested.ratePct}% — tax{' '}
              <span className="font-semibold tabular-nums">
                {inr(f.suggested.tax.igst + f.suggested.tax.cgst + f.suggested.tax.sgst)}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export const AdvanceSetoffGateDialog: React.FC<AdvanceSetoffGateDialogProps> = ({
  open, onOpenChange, clientName, periodMonth, returnLabel,
  check, gate, override, canRequest, canApprove, onApplySuggested,
  onSubmitRequest, onApproveOwn, busy,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hard = useMemo(() => (check?.findings || []).filter((f) => f.severity === 'hard'), [check]);
  const soft = useMemo(() => (check?.findings || []).filter((f) => f.severity === 'soft'), [check]);
  const hasSuggestions = hard.some((f) => f.suggested);
  const reasonOk = reason.trim().length >= OVERRIDE_REASON_MIN;

  const submit = async (approveOwn: boolean) => {
    if (!reasonOk) return;
    setSubmitting(true);
    try {
      await (approveOwn ? onApproveOwn(reason.trim()) : onSubmitRequest(reason.trim()));
      setReason('');
    } finally {
      setSubmitting(false);
    }
  };

  const waiting = gate?.reason === 'awaiting_approval';
  const rejected = gate?.reason === 'rejected';
  const lapsed = gate?.reason === 'lapsed';
  const working = busy || submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Advance set-off check — {returnLabel}
          </DialogTitle>
          <DialogDescription>
            {clientName} · {periodMonth}
            {check?.openTotal ? <> · open advance <span className="tabular-nums">{inr(check.openTotal.taxable)}</span></> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {hard.map((f, i) => <FindingRow key={`h${i}`} f={f} />)}
          {soft.map((f, i) => <FindingRow key={`s${i}`} f={f} />)}

          {/* The correct action has to be reachable from inside the block. If
              staff must navigate elsewhere to fix it, they override instead —
              and the gate ends up generating overrides, not corrections. */}
          {hasSuggestions && onApplySuggested && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                The set-off can be written into this return now. Table 11B is filled with the suggested
                figures and the check runs again — nothing is filed by this.
              </p>
              <Button size="sm" onClick={onApplySuggested} disabled={working}>
                {working ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
                Generate Table 11B &amp; re-check
              </Button>
            </div>
          )}
          {hasSuggestions && !onApplySuggested && (
            <p className="text-xs text-muted-foreground">
              Fix this on the GSTR-1 page for this period — Table 11B feeds 3.1(a), so correcting it there
              corrects this return too.
            </p>
          )}

          {waiting && override && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Clock className="h-4 w-4 text-warning" /> Waiting for a GST Manager to approve
              </div>
              <p className="text-muted-foreground mt-1">
                Requested by {override.requested_by_name || 'a colleague'} on{' '}
                {new Date(override.requested_at).toLocaleString('en-IN')} — “{override.request_reason}”.
                Filing stays blocked until it is approved.
              </p>
            </div>
          )}
          {rejected && override && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <XCircle className="h-4 w-4 text-destructive" /> Override rejected
              </div>
              <p className="text-muted-foreground mt-1">
                {override.decided_by_name || 'A manager'} rejected this
                {override.decision_note ? <> — “{override.decision_note}”</> : null}. Fix the set-off rather
                than re-requesting.
              </p>
            </div>
          )}
          {lapsed && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Clock className="h-4 w-4 text-warning" /> Earlier approval no longer applies
              </div>
              <p className="text-muted-foreground mt-1">
                The return changed after it was approved, so the findings are not the ones the manager saw.
                A fresh request is needed.
              </p>
            </div>
          )}

          {/* An override is always possible — it is made expensive, not
              prevented. A block that cannot be passed gets routed around by
              filing outside the app, which is worse than a recorded override. */}
          {!waiting && canRequest && hard.length > 0 && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {canApprove ? 'Override this block' : 'Request an override'}
              </p>
              <p className="text-xs text-muted-foreground">
                {canApprove
                  ? 'Recorded against your name, shown on the filing record and printed on the exception certificate.'
                  : 'A GST Manager has to approve before this return can go out. Say why the set-off is not due — for example the invoice relates to a different supply than the open advance.'}
              </p>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (required, at least 20 characters)"
                rows={3}
                disabled={working}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {reason.trim().length}/{OVERRIDE_REASON_MIN} characters
                </span>
                <Button
                  size="sm"
                  variant={canApprove ? 'default' : 'outline'}
                  disabled={!reasonOk || working}
                  onClick={() => submit(canApprove)}
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
                  {canApprove ? 'Override and continue' : 'Send request to GST Manager'}
                </Button>
              </div>
            </div>
          )}
          {!canRequest && hard.length > 0 && (
            <p className="text-xs text-muted-foreground">
              You do not have the “Request Advance Set-off Override” permission. Ask a GST Manager to review
              this, or correct the set-off above.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdvanceSetoffGateDialog;
