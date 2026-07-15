import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, Loader2, CheckCircle2, Clock, User, X } from 'lucide-react';
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
  // Per-row id currently being cancelled — used to disable that row's Cancel
  // button while its update is in flight, so a double-click doesn't fire twice.
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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

    if (newPassword.length < 8) {
      toast({
        title: 'Invalid Password',
        description: 'Password must be at least 8 characters long.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // First try to reset as employee password
      const { error: employeeError } = await supabase.rpc('reset_employee_password', {
        target_user_id: selectedRequest.user_id,
        new_password: newPassword,
      });

      // If employee reset fails, try client reset
      if (employeeError) {
        const { error: clientError } = await supabase.rpc('reset_client_password', {
          target_client_id: selectedRequest.user_id,
          new_password: newPassword,
        });

        if (clientError) {
          throw new Error('Failed to reset password. User not found as employee or client.');
        }
      }

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

  // Cancel a duplicate/no-longer-needed request without changing anyone's
  // password. Records the cancel like a resolve so the audit fields
  // (resolved_by / resolved_at) reflect who dismissed it and when. The
  // realtime subscription refetches automatically, but we also filter locally
  // so the row disappears immediately without waiting for the socket.
  const handleCancelRequest = async (request: PasswordResetRequest) => {
    const ok = window.confirm(
      `Cancel the password reset request from ${request.requested_by_name}? This does NOT change their password — it just dismisses the request from this list.`,
    );
    if (!ok) return;
    setCancellingId(request.id);
    try {
      const { error } = await supabase
        .from('password_reset_requests')
        .update({
          status: 'cancelled',
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      if (error) throw error;
      setRequests(prev => prev.filter(r => r.id !== request.id));
      toast({
        title: 'Request cancelled',
        description: `Password reset request from ${request.requested_by_name} was dismissed.`,
      });
    } catch (error: any) {
      console.error('Error cancelling reset request:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel request: ' + (error?.message || 'Unknown error'),
        variant: 'destructive',
      });
    } finally {
      setCancellingId(null);
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
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCancelRequest(request)}
                      disabled={cancellingId === request.id}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40"
                    >
                      {cancellingId === request.id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <X className="h-4 w-4 mr-2" />
                      )}
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setSelectedRequest(request)}
                    >
                      <Key className="h-4 w-4 mr-2" />
                      Set New Password
                    </Button>
                  </div>
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
