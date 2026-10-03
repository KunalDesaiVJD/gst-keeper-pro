import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Lock, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const ClientPasswordResetRequest: React.FC = () => {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const handleSubmitRequest = async () => {
    if (!user?.id) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('password_reset_requests')
        .insert({
          user_id: user.id,
          requested_by_name: user.firstName || user.userId,
          status: 'pending',
        });

      if (error) throw error;

      setHasSubmitted(true);
      toast.success('Your password reset request has been sent to the admin team.');
    } catch (error: any) {
      console.error('Error submitting request:', error);
      toast.error('Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (hasSubmitted) {
    return (
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <CheckCircle2 className="mb-2 h-8 w-8 text-success" />
            <h3 className="mb-1 text-[15px] font-semibold">Request Submitted</h3>
            <p className="text-sm text-muted-foreground">
              Your password reset request has been submitted. An employee will set your new password shortly.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
        <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
          <Lock className="h-4 w-4 text-primary" />
          Request Password Reset
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          Submit a request to have an employee reset your password
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-3">
        <div className="space-y-1">
          <Label htmlFor="reason" className="text-[11px] font-medium text-muted-foreground">Reason (optional)</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for password reset request..."
            className="min-h-[72px] text-sm"
          />
        </div>
        <Button 
          onClick={handleSubmitRequest} 
          disabled={isSubmitting}
          size="sm"
          className="h-8 w-full gap-1 text-xs"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5" />
              Submit Request
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ClientPasswordResetRequest;
