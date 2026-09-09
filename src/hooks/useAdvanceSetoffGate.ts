// One gate, three call sites — GSTR-1 upload, GSTR-3B push, Filing Status ->
// Filed. Everything a call site needs is `await gate.evaluate(...)` returning
// a boolean, plus spreading `gate.dialogProps` into the dialog. Keeping the
// call sites this thin is the point: three hand-written checks would drift,
// and a drifted gate teaches staff the block is unreliable.
//
// docs/ADVANCE_SETOFF_POSITIONS.md §5, §6.

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  runAdvanceSetoffCheck, applySuggestedSetoff,
  type AdvanceCheckResult,
} from '@/lib/advanceSetoffCheck';
import {
  fetchOverride, requestOverride, evaluateGate, lapseOverride,
  type AdvanceOverride, type GateDecision, type OverrideReturnType,
} from '@/lib/advanceSetoffOverrides';

export interface EvaluateInput {
  clientId: string;
  clientName: string;
  gstin: string;
  /** MM/YYYY */
  periodMonth: string;
  /** The JSON about to be filed — the draft, not necessarily what is stored. */
  draftJson: unknown;
  regularSubType?: string | null;
  /** clients.registration_type — lets the checker spot an optional IFF month. */
  registrationType?: string | null;
  /**
   * Overrides the hook's return type for this evaluation. The Filing Status
   * gate needs it: four return types pass through that one screen, and an
   * override must not carry from one to another.
   */
  returnType?: OverrideReturnType;
}

export interface UseAdvanceSetoffGateOptions {
  returnType: OverrideReturnType;
  /** Human label for the dialog header, e.g. "GSTR-1 upload". */
  returnLabel: string;
  /**
   * Persist a corrected draft. Provide it only where the draft can be fixed in
   * place (the GSTR-1 gate); omitting it hides the one-click fix and the
   * dialog points staff at GSTR-1 instead.
   */
  persistDraft?: (nextJson: unknown) => Promise<void>;
}

export function useAdvanceSetoffGate(options: UseAdvanceSetoffGateOptions) {
  const { user, canRequestAdvanceOverride, canApproveAdvanceOverride } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<AdvanceCheckResult | null>(null);
  const [gate, setGate] = useState<GateDecision | null>(null);
  const [override, setOverride] = useState<AdvanceOverride | null>(null);
  const [input, setInput] = useState<EvaluateInput | null>(null);

  /** The return this evaluation is scoped to — per call, falling back to the hook's. */
  const scopeOf = useCallback(
    (i: EvaluateInput | null): OverrideReturnType => i?.returnType || options.returnType,
    [options.returnType],
  );

  /** Runs the check and the gate. Reports whether the return may go out. */
  const assess = useCallback(async (i: EvaluateInput): Promise<{ allowed: boolean; findingCount: number }> => {
    const result = await runAdvanceSetoffCheck({
      clientId: i.clientId,
      gstin: i.gstin,
      periodMonth: i.periodMonth,
      draftJson: i.draftJson,
      regularSubType: i.regularSubType,
      registrationType: i.registrationType,
    });
    const existing = await fetchOverride(i.clientId, i.periodMonth, scopeOf(i));
    const decision = evaluateGate(result, existing);

    // A stale approval is retired as soon as it is seen, so it stops showing
    // as live authority on the manager's inbox.
    if (decision.reason === 'lapsed' && existing) {
      await lapseOverride(existing.id);
    }

    setCheck(result);
    setOverride(existing);
    setGate(decision);
    setInput(i);
    return { allowed: decision.allowed, findingCount: result.findings.length };
  }, [scopeOf]);

  const evaluate = useCallback(async (i: EvaluateInput): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await assess(i);
      if (!result.allowed) {
        setOpen(true);
        return false;
      }
      // A soft-only result never blocked, and until now never showed either —
      // the dialog opened on a block alone, so rules 5-9 reached nobody and
      // the QRMP downgrade silenced findings instead of demoting them. Surface
      // them without stopping the return: a toast that says how many, with a
      // way into the same dialog.
      if (result.findingCount > 0) {
        toast.warning(
          `${result.findingCount} advisory advance finding${result.findingCount === 1 ? '' : 's'} — not blocking this return.`,
          { action: { label: 'Review', onClick: () => setOpen(true) }, duration: 8000 },
        );
      }
      return true;
    } catch (err) {
      // The gate must fail SAFE. If the check itself breaks we do not silently
      // wave the return through — but we also do not pretend to know there is
      // a problem, so this is surfaced as an error, not a finding.
      toast.error(`Advance set-off check failed: ${(err as Error).message}. Filing is blocked until it runs cleanly.`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [assess]);

  const onApplySuggested = useCallback(async () => {
    if (!input || !check || !options.persistDraft) return;
    setBusy(true);
    try {
      const next = applySuggestedSetoff(input.draftJson, check.findings, (input.gstin || '').slice(0, 2));
      await options.persistDraft(next);
      const nextInput = { ...input, draftJson: next };
      const { allowed } = await assess(nextInput);
      if (allowed) {
        setOpen(false);
        toast.success('Table 11B written and the advance set-off check now passes. Re-run the action to continue.');
      } else {
        toast.message('Table 11B written — some findings remain.');
      }
    } catch (err) {
      toast.error(`Could not write Table 11B: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [input, check, options, assess]);

  const submitOverride = useCallback(async (reason: string, selfApprove: boolean) => {
    if (!input || !check) return;
    setBusy(true);
    try {
      await requestOverride({
        clientId: input.clientId,
        clientName: input.clientName,
        periodMonth: input.periodMonth,
        returnType: scopeOf(input),
        check,
        reason,
        userId: user?.id || null,
        userName: user?.firstName || user?.email || 'Unknown',
        userRole: user?.role || 'unknown',
        selfApprove,
      });
      await assess(input);
      if (selfApprove) {
        setOpen(false);
        toast.success('Override recorded. Re-run the action to continue.');
      } else {
        toast.success('Request sent to the GST Manager. Filing stays blocked until it is approved.');
      }
    } catch (err) {
      toast.error(`Could not record the override: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [input, check, scopeOf, user, assess]);

  return {
    evaluate,
    busy,
    dialogProps: {
      open,
      onOpenChange: setOpen,
      clientName: input?.clientName || '',
      periodMonth: input?.periodMonth || '',
      returnLabel: options.returnLabel,
      check,
      gate,
      override,
      canRequest: canRequestAdvanceOverride(),
      canApprove: canApproveAdvanceOverride(),
      onApplySuggested: options.persistDraft ? onApplySuggested : undefined,
      onSubmitRequest: (reason: string) => submitOverride(reason, false),
      onApproveOwn: (reason: string) => submitOverride(reason, true),
      busy,
    },
  };
}
