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
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center text-center py-6">
            <CheckCircle2 className="h-12 w-12 text-success mb-4" />
            <h3 className="text-lg font-semibold mb-2">Request Submitted</h3>
            <p className="text-muted-foreground">
              Your password reset request has been submitted. An employee will set your new password shortly.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Request Password Reset
        </CardTitle>
        <CardDescription>
          Submit a request to have an employee reset your password
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for password reset request..."
            className="min-h-[80px]"
          />
        </div>
        <Button 
          onClick={handleSubmitRequest} 
          disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Submit Request
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ClientPasswordResetRequest;
