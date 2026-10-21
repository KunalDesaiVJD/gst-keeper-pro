import React, { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { allowManualSource, allowanceControlLabel, revokeManualSource, type ManualSourceAllowance } from '@/lib/manualSource';
import { fmtDateTime } from '@/lib/recoSources';

interface Props {
  clientId: string;
  clientName?: string;
  periodMonth: string;
  /** e.g. 'reco:suspended' */
  scope: string;
  /** What the entry is for, in the dialog: "Suspended Reco", "GST Receivable Reco". */
  what: string;
  /** The live (not revoked) allowance for this client, month and scope, if any. */
  allowance: ManualSourceAllowance | null;
  /** The allowance the opening shown was entered under (opening_allowance_id), if any. */
  openingAllowanceId?: string | null;
  /** First names by user id. */
  names: Map<string, string>;
  onChanged: () => void;
}

// The superadmin allows a manual entry for one client, month and reco when
// the portal pull cannot be done, or revokes it. Everyone else sees whether
// one is open. The database checks who acts (manual_source_allow /
// manual_source_revoke, migration 20261021120000).
const ManualSourceAllowanceControl: React.FC<Props> = ({ clientId, clientName, periodMonth, scope, what, allowance, openingAllowanceId, names, onChanged }) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const isSuperadmin = user?.role === 'superadmin';
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const label = allowance ? allowanceControlLabel(allowance, openingAllowanceId, names.get(allowance.allowed_by)) : '';

  const allow = async () => {
    if (!user?.id) return;
    if (reason.trim().length < 5) { toast.error('Give a reason of at least 5 characters.'); return; }
    setBusy(true);
    try {
      await allowManualSource(user.id, clientId, periodMonth, scope, reason.trim());
      toast.success(`Manual entry allowed for ${what}, ${periodMonth}. It can be used once.`);
      setOpen(false);
      setReason('');
      onChanged();
    } catch (e) {
      toast.error('Could not allow it: ' + (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!user?.id || !allowance) return;
    const go = await confirm({
      title: 'Revoke the manual entry?',
      description: allowance.used_at
        ? `${what} for ${periodMonth} was entered under it. After revoking, it counts as not pulled until it is pulled from the portal.`
        : `The manual entry for ${what}, ${periodMonth} has not been used. It will no longer be allowed.`,
      confirmText: 'Revoke',
      destructive: true,
    });
    if (!go) return;
    setBusy(true);
    try {
      await revokeManualSource(user.id, allowance.id);
      toast.success('Manual entry revoked.');
      onChanged();
    } catch (e) {
      toast.error('Could not revoke it: ' + (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperadmin) {
    if (!allowance || allowance.used_at) return null;
    return (
      <p className="text-[11px] text-muted-foreground">
        Manual entry allowed by {names.get(allowance.allowed_by) || 'the superadmin'}: {allowance.reason}. It can be used once.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowance ? (
        <>
          <span className="text-[11px] text-muted-foreground" title={`Allowed ${fmtDateTime(allowance.allowed_at)}${allowance.used_at ? `, used ${fmtDateTime(allowance.used_at)}` : ', not used yet'}`}>
            {label}
          </span>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={revoke} disabled={busy}>
            <ShieldOff className="h-3 w-3" /> Revoke
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)} disabled={busy}
          title="Superadmin only: allow one manual entry for this client and month when the portal pull cannot be done">
          <ShieldCheck className="h-3 w-3" /> Allow manual entry
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Allow a manual entry</DialogTitle>
            <DialogDescription>
              {what}, {periodMonth}{clientName ? `, ${clientName}` : ''}. Allow it only when the portal pull cannot be done
              (wrong portal password, portal down, no access). It can be used once, and the entry shows as manual everywhere.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="msa-reason" className="text-xs">Reason (required)</Label>
            <Textarea id="msa-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why the pull cannot be done" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={allow} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Allow once'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManualSourceAllowanceControl;
