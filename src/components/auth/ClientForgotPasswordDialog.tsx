import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, MailCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { RESET_REQUESTED_MESSAGE, requestClientPasswordReset } from '@/lib/clientPasswordReset';

interface ClientForgotPasswordDialogProps {
  children?: React.ReactNode;
}

/**
 * A client asks for a link to set a new password, e-mailed to the address the
 * firm holds for them. The answer is the same whether or not the GSTIN is a
 * client (client_password_reset_request); when no link can go (no e-mail on
 * record, a limit), staff get a request on the Dashboard instead.
 */
const ClientForgotPasswordDialog: React.FC<ClientForgotPasswordDialogProps> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const reset = () => {
    setIdentifier('');
    setSent(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!identifier.trim()) {
      toast.error('Please enter your GSTIN or User ID.');
      return;
    }
    setIsSubmitting(true);
    try {
      await requestClientPasswordReset(identifier);
      setSent(true);
    } catch (error) {
      console.error('Error requesting a reset link:', error);
      toast.error('Could not send the request. Please try again, or write to gst@vjdesai.com.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {children || (
          <button className="text-sm text-primary hover:text-primary/80 hover:underline transition-colors">
            Forgot Password? (Clients)
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Client Password Reset
          </DialogTitle>
          <DialogDescription>
            We will e-mail a link to set a new password to the address we hold for you.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
              <MailCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
              <p className="text-sm text-foreground">{RESET_REQUESTED_MESSAGE}</p>
            </div>
            <Button className="w-full" onClick={() => { setOpen(false); reset(); }}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="client-reset-identifier">GSTIN or User ID</Label>
              <Input
                id="client-reset-identifier"
                type="text"
                placeholder="e.g., 24AABCU9603R1ZM"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
                maxLength={64}
                autoComplete="username"
                className="uppercase"
              />
              <p className="text-xs text-muted-foreground">
                The same User ID you sign in with. The link works once, for 60 minutes; your current password keeps
                working until you use it.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
              ) : (
                'E-mail me a reset link'
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ClientForgotPasswordDialog;
