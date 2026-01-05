import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ForgotPasswordDialogProps {
  children?: React.ReactNode;
}

const ForgotPasswordDialog: React.FC<ForgotPasswordDialogProps> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!userId.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter your User ID (First Name).',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Find the user by first_name in profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id, first_name')
        .ilike('first_name', userId.trim())
        .single();

      if (!profile) {
        toast({
          title: 'User Not Found',
          description: 'No employee found with that User ID. Please contact your administrator.',
          variant: 'destructive',
        });
        return;
      }

      // Create password reset request
      const { error } = await supabase
        .from('password_reset_requests')
        .insert([{
          user_id: profile.user_id,
          requested_by_name: profile.first_name,
          status: 'pending',
        }]);

      if (error) throw error;

      toast({
        title: 'Request Submitted',
        description: 'Your password reset request has been sent to the administrator. They will reset your password shortly.',
      });

      setOpen(false);
      setUserId('');
    } catch (error: any) {
      console.error('Error submitting reset request:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit request. Please try again.',
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
            Forgot Password? (Employees Only)
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Request Password Reset
          </DialogTitle>
          <DialogDescription>
            Enter your User ID (First Name). Your administrator will be notified to reset your password.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 pt-4">
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              <strong className="text-amber-600">Note:</strong> This is for Employees and GST Managers only. 
              Clients should contact their assigned accountant for password assistance.
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="userId">User ID (First Name)</Label>
            <Input
              id="userId"
              type="text"
              placeholder="Enter your User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
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

export default ForgotPasswordDialog;
