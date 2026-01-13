import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Lock, Users, AlertCircle, Check, X, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

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

const SettingsPage: React.FC = () => {
  const { user, canManageEmployees } = useAuth();
  const { toast } = useToast();
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // Employee password reset state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employeeNewPassword, setEmployeeNewPassword] = useState('');
  const [showEmployeePassword, setShowEmployeePassword] = useState(false);
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

    if (newPassword.length < 8) {
      toast({
        title: 'Invalid Password',
        description: 'New password must be at least 8 characters long.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: 'Password Mismatch',
        description: 'New passwords do not match.',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      // Update password using Supabase Auth
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Password Changed',
        description: 'Your password has been updated successfully.',
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Error changing password:', error);
      toast({
        title: 'Error',
        description: 'Failed to change password.',
        variant: 'destructive',
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleResetEmployeePassword = async () => {
    if (!selectedEmployee) {
      toast({
        title: 'Select Employee',
        description: 'Please select an employee to reset their password.',
        variant: 'destructive',
      });
      return;
    }

    if (employeeNewPassword.length < 8) {
      toast({
        title: 'Invalid Password',
        description: 'Password must be at least 8 characters long.',
        variant: 'destructive',
      });
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
          toast({
            title: 'Error',
            description: error.message || 'Failed to reset password.',
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: 'Password Reset',
          description: `Password has been reset for ${employee.first_name}. They can now login with the new password.`,
        });

        setSelectedEmployee('');
        setEmployeeNewPassword('');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast({
        title: 'Error',
        description: 'Failed to reset password.',
        variant: 'destructive',
      });
    } finally {
      setIsResettingEmployee(false);
    }
  };

  const handleResolveRequest = async (request: PasswordResetRequest, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') {
        // Set employee as selected for password reset
        setSelectedEmployee(request.user_id);
        toast({
          title: 'Set New Password',
          description: `Please enter a new password for ${request.requested_by_name}.`,
        });
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
        toast({
          title: 'Request Rejected',
          description: `Password reset request from ${request.requested_by_name} has been rejected.`,
        });
      }
    } catch (error) {
      console.error('Error resolving request:', error);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground">Manage your account and system settings</p>
        </div>
      </div>

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
        </TabsList>

        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle>Change My Password</CardTitle>
              <CardDescription>
                Update your account password
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangeOwnPassword} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                </div>

                <Button type="submit" disabled={isChangingPassword}>
                  {isChangingPassword ? 'Changing...' : 'Change Password'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {canManageEmployees() && (
          <TabsContent value="employees" className="space-y-4">
            {/* Password Reset Requests */}
            {resetRequests.length > 0 && (
              <Card className="border-amber-500/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-500" />
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
                    <Label>Select Employee</Label>
                    <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                      <SelectTrigger>
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
                    <Label htmlFor="employeeNewPassword">New Password</Label>
                    <div className="relative">
                      <Input
                        id="employeeNewPassword"
                        type={showEmployeePassword ? 'text' : 'password'}
                        value={employeeNewPassword}
                        onChange={(e) => setEmployeeNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEmployeePassword(!showEmployeePassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showEmployeePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button onClick={handleResetEmployeePassword} disabled={isResettingEmployee}>
                    {isResettingEmployee ? 'Resetting...' : 'Reset Password'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default SettingsPage;
