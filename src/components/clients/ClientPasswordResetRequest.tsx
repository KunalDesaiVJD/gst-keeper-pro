import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Mail, Loader2, MailCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { requestClientPasswordReset } from '@/lib/clientPasswordReset';
import { toast } from 'sonner';

/**
 * A signed-in client changes their password through the same e-mailed link
 * as "Forgot password" (client_password_reset_request with their GSTIN). When
 * no link can go (no e-mail on record, a limit) the database files a request
 * for staff instead.
 */
const ClientPasswordResetRequest: React.FC = () => {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const handleSubmitRequest = async () => {
    if (!user?.userId) return;
    setIsSubmitting(true);
    try {
      await requestClientPasswordReset(user.userId);
      setHasSubmitted(true);
    } catch (error) {
      console.error('Error requesting a reset link:', error);
      toast.error('Could not send the request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (hasSubmitted) {
    return (
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <MailCheck className="mb-2 h-8 w-8 text-success" />
            <h3 className="mb-1 text-[15px] font-semibold">Check your e-mail</h3>
            <p className="text-sm text-muted-foreground">
              A link to set a new password is on its way to the e-mail address we hold for you. It works once, for
              60 minutes. If we cannot e-mail one, our team has been asked to reset it and will contact you.
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
          Change your password
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          We e-mail you a link to choose a new password. Your current password keeps working until you use it.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <Button
          onClick={handleSubmitRequest}
          disabled={isSubmitting}
          size="sm"
          className="h-8 w-full gap-1 text-xs"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Mail className="h-3.5 w-3.5" />
              E-mail me a link
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ClientPasswordResetRequest;
