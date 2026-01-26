import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, AlertCircle, Building } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ClientForgotPasswordDialogProps {
  children?: React.ReactNode;
}

const ClientForgotPasswordDialog: React.FC<ClientForgotPasswordDialogProps> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [gstin, setGstin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!gstin.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter your GSTIN.',
        variant: 'destructive',
      });
      return;
    }

    // Validate GSTIN format (15 characters)
    if (gstin.trim().length !== 15) {
      toast({
        title: 'Invalid GSTIN',
        description: 'GSTIN must be exactly 15 characters.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Find the client by GSTIN
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name, gstin')
        .ilike('gstin', gstin.trim())
        .single();

      if (clientError || !client) {
        toast({
          title: 'Client Not Found',
          description: 'No client found with that GSTIN. Please verify your GSTIN or contact your accountant.',
          variant: 'destructive',
        });
        return;
      }

      // Create password reset request
      const { error } = await supabase
        .from('password_reset_requests')
        .insert([{
          user_id: client.id,
          requested_by_name: `${client.name} (${client.gstin})`,
          status: 'pending',
        }]);

      if (error) throw error;

      toast({
        title: 'Request Submitted',
        description: 'Your password reset request has been sent. Your accountant will reset your password shortly.',
      });

      setOpen(false);
      setGstin('');
    } catch (error: any) {
      console.error('Error submitting reset request:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit request. Please try again or contact your accountant.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            Enter your GSTIN. Your accountant will be notified to reset your password.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 pt-4">
          <div className="flex items-start gap-2 p-3 bg-primary/10 rounded-lg border border-primary/30">
            <Building className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              <strong className="text-primary">Client Portal:</strong> Enter your 15-character GSTIN to request a password reset.
              Your assigned accountant will reset it for you.
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="gstin">GSTIN</Label>
            <Input
              id="gstin"
              type="text"
              placeholder="e.g., 27AABCU9603R1ZM"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              maxLength={15}
              className="uppercase"
            />
          </div>
          
          <Button onClick={handleSubmit} className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Submit Reset Request'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ClientForgotPasswordDialog;
