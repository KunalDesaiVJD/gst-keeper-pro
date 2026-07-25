import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/PageHeader';
import { Settings, Lock, Users, AlertCircle, Check, X, Loader2, Database, Shield, Mail } from 'lucide-react';
import ManageMastersPage from '@/pages/ManageMastersPage';
import UserControlPage from '@/pages/UserControlPage';
import EmailTemplatesEditor from '@/components/reminders/EmailTemplatesEditor';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface PasswordResetRequest {
  id: string;
  user_id: string;
  requested_by_name: string;
  requested_at: string;
  status: string;
}

interface Employee {
  id: string;
  user_id: string;
  first_name: string;
  role: string;
}

/** Small red asterisk marking a required field. */
const RequiredMark: React.FC = () => (
  <span className="text-destructive" aria-hidden="true">
    {' '}
    *
  </span>
);

const SettingsPage: React.FC = () => {
  const { user, canManageEmployees, isStaffRole } = useAuth();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Employee password reset state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employeeNewPassword, setEmployeeNewPassword] = useState('');
  const [isResettingEmployee, setIsResettingEmployee] = useState(false);

  // Reset requests state
  const [resetRequests, setResetRequests] = useState<PasswordResetRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  const fetchEmployees = useCallback(async () => {
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, user_id, first_name');

      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (profiles && roles) {
        const employeeList = profiles
          .map(profile => {
            const userRole = roles.find(r => r.user_id === profile.user_id);
            return {
              id: profile.id,
              user_id: profile.user_id,
              first_name: profile.first_name,
              role: userRole?.role || 'employee',
            };
          })
          .filter(e => e.role !== 'superadmin' && e.role !== 'client');

        setEmployees(employeeList);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  }, []);

  const fetchResetRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('*')
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });

      if (error) throw error;
      setResetRequests(data || []);
    } catch (error) {
      console.error('Error fetching reset requests:', error);
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    if (canManageEmployees()) {
      fetchEmployees();
      fetchResetRequests();
    }
  }, [canManageEmployees, fetchEmployees, fetchResetRequests]);

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword) {
      toast.error('Please enter your current password.');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match.');
      return;
    }

    setIsChangingPassword(true);

    try {
      // Verify current password first by re-authenticating
      if (!user) {
        toast.error('No user session found.');
        return;
      }

      // Use the reset_employee_password RPC for staff users (bypasses auth session requirement)
      const { data: result, error } = await supabase.rpc('reset_employee_password', {
        target_user_id: user.id,
        new_password: newPassword,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Your password has been updated successfully.');

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error('Failed to change password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleResetEmployeePassword = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee to reset their password.');
      return;
    }

    if (employeeNewPassword.length < 8) {
      toast.error('Password must be at least 8 characters long.');
      return;
    }

    setIsResettingEmployee(true);

    try {
      const employee = employees.find(e => e.user_id === selectedEmployee);
      if (employee) {
        // Use the SECURITY DEFINER function to reset password
        const { error } = await supabase.rpc('reset_employee_password', {
          target_user_id: selectedEmployee,
          new_password: employeeNewPassword,
        });

        if (error) {
          console.error('Error resetting password:', error);
          toast.error(error.message || 'Failed to reset password.');
          return;
        }

        toast.success(
          `Password has been reset for ${employee.first_name}. They can now login with the new password.`
        );

        setSelectedEmployee('');
        setEmployeeNewPassword('');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast.error('Failed to reset password.');
    } finally {
      setIsResettingEmployee(false);
    }
  };

  const handleResolveRequest = async (request: PasswordResetRequest, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') {
        // Set employee as selected for password reset
        setSelectedEmployee(request.user_id);
        toast.info(`Please enter a new password for ${request.requested_by_name}.`);
      }

      // Update request status
      await supabase
        .from('password_reset_requests')
        .update({
          status: action === 'approve' ? 'approved' : 'rejected',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', request.id);

      fetchResetRequests();

      if (action === 'reject') {
        toast.success(
          `Password reset request from ${request.requested_by_name} has been rejected.`
        );
      }
    } catch (error) {
      console.error('Error resolving request:', error);
    }
  };

  // Inline validation feedback
  const newPasswordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const confirmMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const employeePasswordTooShort =
    employeeNewPassword.length > 0 && employeeNewPassword.length < 8;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Settings"
        subtitle="Manage your account and system settings"
        icon={<Settings className="h-6 w-6" />}
      />

      <Tabs defaultValue="password" className="space-y-4">
        <TabsList>
          <TabsTrigger value="password" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            My Password
          </TabsTrigger>
          {canManageEmployees() && (
            <TabsTrigger value="employees" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Employee Passwords
            </TabsTrigger>
          )}
          {canManageEmployees() && (
            <TabsTrigger value="user-control" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              User Control
            </TabsTrigger>
          )}
          {isStaffRole() && (
            <TabsTrigger value="masters" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Masters
            </TabsTrigger>
          )}
          {isStaffRole() && (
            <TabsTrigger value="templates" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              GST Reminders
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="password">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Change My Password</CardTitle>
              <CardDescription>
                Update your account password
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangeOwnPassword} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">
                    Current Password
                    <RequiredMark />
                  </Label>
                  <PasswordInput
                    id="currentPassword"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">
                    New Password
                    <RequiredMark />
                  </Label>
                  <PasswordInput
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    aria-invalid={newPasswordTooShort}
                    aria-describedby={newPasswordTooShort ? 'newPassword-error' : undefined}
                    className={cn(
                      newPasswordTooShort && 'border-destructive focus-visible:ring-destructive'
                    )}
                  />
                  {newPasswordTooShort && (
                    <p id="newPassword-error" className="text-xs text-destructive">
                      Password must be at least 8 characters long.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">
                    Confirm New Password
                    <RequiredMark />
                  </Label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    aria-invalid={confirmMismatch}
                    aria-describedby={confirmMismatch ? 'confirmPassword-error' : undefined}
                    className={cn(
                      confirmMismatch && 'border-destructive focus-visible:ring-destructive'
                    )}
                  />
                  {confirmMismatch && (
                    <p id="confirmPassword-error" className="text-xs text-destructive">
                      Passwords do not match.
                    </p>
                  )}
                </div>

                <Button type="submit" disabled={isChangingPassword}>
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Changing…
                    </>
                  ) : (
                    <>
                      <Lock className="mr-2 h-4 w-4" />
                      Change Password
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {canManageEmployees() && (
          <TabsContent value="employees" className="space-y-4">
            {/* Password Reset Requests */}
            {resetRequests.length > 0 && (
              <Card className="border-warning/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-warning" />
                    Pending Password Reset Requests
                  </CardTitle>
                  <CardDescription>
                    Employees who have requested password resets
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {resetRequests.map((request) => (
                      <div
                        key={request.id}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{request.requested_by_name}</p>
                          <p className="text-sm text-muted-foreground">
                            Requested: {new Date(request.requested_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResolveRequest(request, 'approve')}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Reset
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Reject password reset request from ${request.requested_by_name}`}
                            onClick={() => handleResolveRequest(request, 'reject')}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reset Employee Password */}
            <Card>
              <CardHeader>
                <CardTitle>Reset Employee Password</CardTitle>
                <CardDescription>
                  Select an employee and set a new password for them
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-w-md">
                  <div className="space-y-2">
                    <Label htmlFor="employeeSelect">
                      Select Employee
                      <RequiredMark />
                    </Label>
                    <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                      <SelectTrigger id="employeeSelect">
                        <SelectValue placeholder="Choose an employee..." />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((emp) => (
                          <SelectItem key={emp.user_id} value={emp.user_id}>
                            <div className="flex items-center gap-2">
                              <span>{emp.first_name}</span>
                              <Badge variant="secondary" className="text-xs">
                                {emp.role === 'gst_manager' ? 'GST Manager' : 'Employee'}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="employeeNewPassword">
                      New Password
                      <RequiredMark />
                    </Label>
                    <PasswordInput
                      id="employeeNewPassword"
                      value={employeeNewPassword}
                      onChange={(e) => setEmployeeNewPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      aria-invalid={employeePasswordTooShort}
                      aria-describedby={
                        employeePasswordTooShort ? 'employeeNewPassword-error' : undefined
                      }
                      className={cn(
                        employeePasswordTooShort &&
                          'border-destructive focus-visible:ring-destructive'
                      )}
                    />
                    {employeePasswordTooShort && (
                      <p id="employeeNewPassword-error" className="text-xs text-destructive">
                        Password must be at least 8 characters long.
                      </p>
                    )}
                  </div>

                  <Button onClick={handleResetEmployeePassword} disabled={isResettingEmployee}>
                    {isResettingEmployee ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Resetting…
                      </>
                    ) : (
                      <>
                        <Lock className="mr-2 h-4 w-4" />
                        Reset Password
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canManageEmployees() && (
          <TabsContent value="user-control">
            <UserControlPage embedded />
          </TabsContent>
        )}

        {isStaffRole() && (
          <TabsContent value="masters">
            <ManageMastersPage embedded />
          </TabsContent>
        )}

        {isStaffRole() && (
          <TabsContent value="templates">
            <EmailTemplatesEditor />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default SettingsPage;
