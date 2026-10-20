import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { KeyRound, Loader2, Mail, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { staffEmailResetLink, staffSetClientPassword } from '@/lib/clientPasswordReset';
import { staffClientPasswordProblem } from '@/lib/passwordRules';
import { resetLinkAddresses, resetLinkBlock } from '@/lib/clientResetLink';

export interface ResetClientTarget {
  id: string;
  name: string;
  gstin: string;
  /** The e-mail address saved on the client: where the link goes. */
  email?: string | null;
  /** On a screen that edits the address: what the form shows now. */
  typedEmail?: string | null;
}

interface Props {
  client: ResetClientTarget | null;
  onOpenChange: (open: boolean) => void;
  /** After a password is set or a link queued (e.g. to refresh a list). */
  onDone?: (how: 'password' | 'link') => void;
}

/**
 * Any staff member resets a client's app-login password from their own login:
 * e-mail the client a reset link, or set a password now and tell them. The
 * database checks the actor is staff and logs it (client_password_log).
 */
const ResetClientPasswordDialog: React.FC<Props> = ({ client, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<null | 'password' | 'link'>(null);
  const [queuedTo, setQueuedTo] = useState<string | null>(null);

  useEffect(() => {
    setNewPassword('');
    setConfirmPassword('');
    setQueuedTo(null);
  }, [client?.id]);

  const linkBlock = client ? resetLinkBlock({ saved: client.email, typed: client.typedEmail }) : null;
  // Only the well-formed addresses: the ones the database sends the link to.
  const linkTo = client ? resetLinkAddresses(client.email) : '';
  const tooShort = newPassword.length > 0 && !!staffClientPasswordProblem(newPassword);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const sendLink = async () => {
    if (!client || !user) return;
    setBusy('link');
    try {
      const { sentTo } = await staffEmailResetLink(user.id, client.id);
      setQueuedTo(sentTo);
      toast.success(`Reset link on its way to ${sentTo}.`);
      onDone?.('link');
    } catch (e) {
      toast.error((e as Error).message || 'Could not send the link.');
    } finally {
      setBusy(null);
    }
  };

  const setPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    // The dialog is portaled, but React still bubbles submit to a parent form
    // (Edit Client is one): keep this submit to itself.
    e.stopPropagation();
    if (!client || !user) return;
    const problem = staffClientPasswordProblem(newPassword);
    if (problem) { toast.error(problem); return; }
    if (newPassword !== confirmPassword) { toast.error('The two passwords do not match.'); return; }
    setBusy('password');
    try {
      await staffSetClientPassword(user.id, client.id, newPassword);
      toast.success(`Password set for ${client.name}. User ID: ${client.gstin}.`);
      onDone?.('password');
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message || 'Could not set the password.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!client} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Reset app password
          </DialogTitle>
          <DialogDescription>
            {client?.name} · User ID <span className="font-mono">{client?.gstin}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">E-mail the client a reset link</p>
            {queuedTo ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                On its way to {queuedTo}. The link works once, for 60 minutes; the current password keeps working until it is used.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {linkBlock ?? <>The client chooses their own password. Goes to {linkTo}.</>}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!!linkBlock || busy !== null || !!queuedTo}
              onClick={() => void sendLink()}
            >
              {busy === 'link' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              E-mail reset link
            </Button>
          </div>

          <form onSubmit={setPassword} className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Or set a password now</p>
            <div className="space-y-1.5">
              <Label htmlFor="staff-client-new-password">New password</Label>
              <PasswordInput
                id="staff-client-new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
              {tooShort && <p className="text-xs text-destructive">{staffClientPasswordProblem(newPassword)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-client-confirm-password">Confirm password</Label>
              <PasswordInput
                id="staff-client-confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              {mismatch && <p className="text-xs text-destructive">The two passwords do not match.</p>}
            </div>
            <p className="text-xs text-muted-foreground">
              Tell the client the new password yourself. Set the GSTIN as the password and the client must choose a new
              one at first sign-in.
            </p>
            <Button type="submit" size="sm" className="w-full" disabled={busy !== null || !newPassword || !confirmPassword}>
              {busy === 'password' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Set password
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ResetClientPasswordDialog;
