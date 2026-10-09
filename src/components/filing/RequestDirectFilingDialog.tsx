import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import {
  DirectFilingApproval,
  MIN_REASON_LENGTH,
  decideDirectFilingApproval,
  requestDirectFilingApproval,
} from '@/lib/directFilingApprovals';

export interface DirectFilingTarget {
  clientId: string;
  clientName: string;
  returnType: string;
  periodMonth: string;
  /** The approval row currently speaking for this return, if any. */
  current: DirectFilingApproval | null;
  /** Opened from the status dropdown's "Filed" choice — offers to carry on. */
  fromFiled?: boolean;
}

export const REASON_PROMPT = 'What happened — why was this return filed directly on the portal instead of being pushed from GST Keeper?';

const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

const RequestDirectFilingDialog: React.FC<{
  target: DirectFilingTarget | null;
  onClose: () => void;
  isSuperadmin: boolean;
  userId: string | null;
  /** Names for requested_by / decided_by ids. */
  userNames?: Record<string, string>;
  /** Called after a successful write. `approved` = the return may now be filed. */
  onDone: (approval: DirectFilingApproval, approved: boolean) => void;
}> = ({ target, onClose, isSuperadmin, userId, userNames = {}, onDone }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'request' | 'approve' | null>(null);

  useEffect(() => {
    setReason('');
    setBusy(null);
  }, [target?.clientId, target?.returnType, target?.periodMonth]);

  if (!target) return null;
  const pending = target.current?.status === 'pending' ? target.current : null;
  const rejected = target.current?.status === 'rejected' ? target.current : null;
  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= MIN_REASON_LENGTH;

  const submit = async (approveNow: boolean) => {
    setBusy(approveNow ? 'approve' : 'request');
    try {
      if (pending && approveNow) {
        // Superadmin settling an open request from the row.
        const r = await decideDirectFilingApproval({ id: pending.id, approve: true, note: trimmed || null, decidedBy: userId });
        if (!r.ok) { toast.error(r.error); return; }
        toast.success(`Direct filing of ${target.returnType} ${target.periodMonth} approved for ${target.clientName}.`);
        onDone(r.approval, true);
        return;
      }
      const r = await requestDirectFilingApproval({
        clientId: target.clientId,
        returnType: target.returnType,
        periodMonth: target.periodMonth,
        reason: trimmed,
        requestedBy: userId,
        approveNow,
      });
      if (r.ok) {
        if (approveNow) toast.success(`Recorded and approved — ${target.returnType} ${target.periodMonth} can now be marked Filed.`);
        else toast.success('Request sent to the superadmin. You can mark it Filed once it is approved.');
        onDone(r.approval, approveNow);
      } else if (r.alreadyPending) {
        toast.info('A request for this return is already waiting for the superadmin.');
        if (r.approval) onDone(r.approval, false);
      } else {
        toast.error('Could not send the request: ' + r.error);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Direct-filing approval needed</DialogTitle>
          <DialogDescription className="text-xs">
            {target.clientName} · {target.returnType} · {target.periodMonth}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <Note tone="warn">
            This {target.returnType} was not pushed to the portal through GST Keeper. It cannot be marked Filed or
            pulled from the portal until a superadmin approves a direct-filing request — the request is how the
            superadmin learns what went wrong.
          </Note>

          {pending && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="info" className="px-1.5 text-[10px]">Awaiting superadmin</Badge>
                <span className="text-muted-foreground">
                  {pending.requested_by ? `${userNames[pending.requested_by] || 'Unknown'}, ` : ''}{fmtWhen(pending.requested_at)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-foreground">{pending.reason}</p>
            </div>
          )}

          {rejected && (
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="px-1.5 text-[10px]">Rejected</Badge>
                <span className="text-muted-foreground">
                  {rejected.decided_by ? `${userNames[rejected.decided_by] || 'Unknown'}, ` : ''}{fmtWhen(rejected.decided_at)}
                </span>
              </div>
              {rejected.decision_note && <p className="whitespace-pre-wrap text-foreground">Superadmin: {rejected.decision_note}</p>}
              <p className="text-muted-foreground">Earlier reason: {rejected.reason}</p>
            </div>
          )}

          {(!pending || isSuperadmin) && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">
                {pending ? 'Approval note (optional)' : REASON_PROMPT}
              </span>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="text-sm"
                placeholder={pending ? 'Optional note for the record' : 'e.g. Client filed it themselves from their own login before we pushed the JSON.'}
                autoFocus
              />
              {!pending && (
                <span className={trimmed.length && !reasonOk ? 'text-[11px] text-destructive' : 'text-[11px] text-muted-foreground'}>
                  At least {MIN_REASON_LENGTH} characters ({trimmed.length}).
                </span>
              )}
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-1">
          <Button variant="outline" size="sm" className={WS_BTN} onClick={onClose} disabled={!!busy}>
            {pending && !isSuperadmin ? 'Close' : 'Cancel'}
          </Button>
          {!pending && (
            <Button size="sm" variant={isSuperadmin ? 'outline' : 'default'} className={WS_BTN} disabled={!reasonOk || !!busy} onClick={() => submit(false)}>
              {busy === 'request' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send to superadmin
            </Button>
          )}
          {isSuperadmin && (
            <Button size="sm" className={WS_BTN} disabled={(!pending && !reasonOk) || !!busy} onClick={() => submit(true)}>
              {busy === 'approve' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {target.fromFiled ? 'Approve now & mark Filed' : 'Approve now'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestDirectFilingDialog;
