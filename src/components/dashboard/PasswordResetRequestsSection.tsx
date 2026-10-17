import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { PasswordInput } from '@/components/ui/password-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, Loader2, CheckCircle2, Clock, User, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import ResetClientPasswordDialog, { type ResetClientTarget } from '@/components/clients/ResetClientPasswordDialog';

interface PasswordResetRequest {
  id: string;
  user_id: string;
  requested_by_name: string;
  requested_at: string;
  status: string;
  note?: string | null;
  /** Set when the request is a client's (user_id is a client id). */
  client?: ResetClientTarget;
}

// Client requests reach every staff member (any staff level may reset a
// client's password); staff requests only those who manage employees.
const PasswordResetRequestsSection: React.FC = () => {
  const { user, canManageEmployees, canResetClientPasswords } = useAuth();
  const confirm = useConfirm();
  const [clientTarget, setClientTarget] = useState<ResetClientTarget | null>(null);
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
      const rows = (data || []) as PasswordResetRequest[];
      const ids = [...new Set(rows.map((r) => r.user_id))];
      const clientById = new Map<string, ResetClientTarget>();
      if (ids.length) {
        const { data: cs } = await supabase.from('clients').select('id, name, gstin, email').in('id', ids);
        (cs || []).forEach((c) => clientById.set(c.id, c));
      }
      setRequests(
        rows
          .map((r) => ({ ...r, client: clientById.get(r.user_id) }))
          .filter((r) => (r.client ? canResetClientPasswords() : canManageEmployees())),
      );
    } catch (error) {
      console.error('Error fetching reset requests:', error);
    } finally {
      setIsLoading(false);
    }
  }, [canManageEmployees, canResetClientPasswords]);

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
      toast.error('Please enter a new password');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Staff accounts only: client requests open ResetClientPasswordDialog.
      const { error: employeeError } = await supabase.rpc('staff_set_password', {
        p_actor_id: user?.id ?? '',
        p_target_user_id: selectedRequest.user_id,
        p_new_password: newPassword,
      });
      if (employeeError) throw new Error(employeeError.message);

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

      toast.success(`Password for ${selectedRequest.requested_by_name} has been set successfully.`);

      setSelectedRequest(null);
      setNewPassword('');
      fetchRequests();
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast.error('Failed to set password: ' + error.message);
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
    const ok = await confirm({
      title: 'Cancel password reset request?',
      description: `This dismisses the request from ${request.requested_by_name} from this list. It does NOT change their password.`,
      destructive: true,
      confirmText: 'Cancel request',
      cancelText: 'Keep request',
    });
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
      toast.success(`Password reset request from ${request.requested_by_name} was dismissed.`);
    } catch (error: any) {
      console.error('Error cancelling reset request:', error);
      toast.error('Failed to cancel request: ' + (error?.message || 'Unknown error'));
    } finally {
      setCancellingId(null);
    }
  };

  const clientDialog = (
    <ResetClientPasswordDialog
      client={clientTarget}
      onOpenChange={(open) => { if (!open) setClientTarget(null); }}
      onDone={() => fetchRequests()}
    />
  );

  if (requests.length === 0 && !isLoading) {
    // No section without pending requests; a dialog still open (its request
    // just resolved) stays until closed.
    return clientDialog;
  }

  return (
    <>
      <SectionCard
        className="border-warning/50"
        title={
          <span className="flex items-center gap-2">
            <Key className="h-4 w-4 text-warning" />
            Password Reset Requests
            {requests.length > 0 && (
              <Badge variant="warning" className="text-[10px] font-medium">
                {requests.length} pending
              </Badge>
            )}
          </span>
        }
        description="Clients and staff waiting for a password reset. A client can also be sent a link to set their own."
      >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="rounded-md border">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/10">
                      <User className="h-3.5 w-3.5 text-warning" />
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {request.client?.name ? `${request.client.name} (${request.client.gstin})` : request.requested_by_name}
                        <Badge variant={request.client ? 'secondary' : 'outline'} className="text-[10px] font-medium">
                          {request.client ? 'Client' : 'Staff'}
                        </Badge>
                      </p>
                      {request.note && <p className="truncate text-xs text-muted-foreground">{request.note}</p>}
                      <div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
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
                      className={cn(WS_BTN, 'text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40')}
                    >
                      {cancellingId === request.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className={WS_BTN}
                      onClick={() => (request.client ? setClientTarget(request.client) : setSelectedRequest(request))}
                    >
                      <Key className="h-3.5 w-3.5" />
                      {request.client ? 'Reset password' : 'Set New Password'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </SectionCard>

      {clientDialog}

      {/* Set Password Dialog (staff accounts) */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set New Password for {selectedRequest?.requested_by_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <PasswordInput
                id="newPassword"
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
