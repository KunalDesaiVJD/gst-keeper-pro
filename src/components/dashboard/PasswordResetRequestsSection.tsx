import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, Loader2, CheckCircle2, Clock, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { mockPasswords } from '@/data/mockData';

interface PasswordResetRequest {
  id: string;
  user_id: string;
  requested_by_name: string;
  requested_at: string;
  status: string;
}

const PasswordResetRequestsSection: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<PasswordResetRequest | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('*')
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error fetching reset requests:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('password-reset-requests')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'password_reset_requests' 
      }, () => {
        fetchRequests();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRequests]);

  const handleSetPassword = async () => {
    if (!selectedRequest || !newPassword) {
      toast({
        title: 'Error',
        description: 'Please enter a new password',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Update the password in profiles table
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ password: newPassword })
        .eq('user_id', selectedRequest.user_id);

      if (profileError) throw profileError;

      // Update mock passwords for immediate login
      mockPasswords[selectedRequest.requested_by_name] = newPassword;

      // Mark request as resolved
      const { error: requestError } = await supabase
        .from('password_reset_requests')
        .update({ 
          status: 'resolved',
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', selectedRequest.id);

      if (requestError) throw requestError;

      // Reset first login flag so they can login directly
      await supabase
        .from('user_roles')
        .update({ is_first_login: false })
        .eq('user_id', selectedRequest.user_id);

      toast({
        title: 'Password Reset',
        description: `Password for ${selectedRequest.requested_by_name} has been set successfully.`,
      });

      setSelectedRequest(null);
      setNewPassword('');
      fetchRequests();
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast({
        title: 'Error',
        description: 'Failed to set password: ' + error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (requests.length === 0 && !isLoading) {
    return null; // Don't show section if no pending requests
  }

  return (
    <>
      <Card className="border-warning/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-warning" />
            Password Reset Requests
            {requests.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {requests.length} pending
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Client password reset requests waiting for approval
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-warning" />
                    </div>
                    <div>
                      <p className="font-medium">{request.requested_by_name}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          {new Date(request.requested_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setSelectedRequest(request)}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Set New Password
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Set Password Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set New Password for {selectedRequest?.requested_by_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button 
                variant="outline" 
                onClick={() => {
                  setSelectedRequest(null);
                  setNewPassword('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSetPassword} disabled={isSubmitting || !newPassword}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Set Password
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PasswordResetRequestsSection;
