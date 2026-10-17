import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

interface SuperadminPasswordDialogProps {
  open: boolean;
  /** What is being confirmed, e.g. "Make Riya a GST Manager". */
  title: string;
  description?: string;
  confirmText?: string;
  onOpenChange: (open: boolean) => void;
  /** Runs the change with the password; resolves true when it went through (the dialog then closes). */
  onConfirm: (password: string) => Promise<boolean>;
}

/**
 * Asks the superadmin for their own password before a change only they may
 * make (giving or taking away the GST Manager level). The database checks
 * the password; this only collects it.
 */
const SuperadminPasswordDialog: React.FC<SuperadminPasswordDialogProps> = ({
  open, title, description, confirmText = 'Confirm', onOpenChange, onConfirm,
}) => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setPassword(''); setBusy(false); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      if (await onConfirm(password)) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {title}
            </DialogTitle>
            <DialogDescription>
              {description || 'Only the superadmin can give or take away the GST Manager level. Enter your password to confirm.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="superadmin-password">Your password</Label>
            <PasswordInput
              id="superadmin-password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={!password || busy}>{busy ? 'Checking…' : confirmText}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SuperadminPasswordDialog;
