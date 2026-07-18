import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Trash2,
  UserPlus,
  Shield,
  Users,
  Loader2,
  Pencil,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useAuth } from '@/contexts/AuthContext';

interface Employee {
  id: string;
  user_id: string;
  first_name: string;
  email: string | null;
  role: 'gst_manager' | 'employee';
}

interface UserMetrics {
  totalStaff: number;
  gstManagers: number;
  employees: number;
}

const UserManagementSection: React.FC = () => {
  const { canManageEmployees } = useAuth();
  const confirm = useConfirm();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'gst_manager' | 'employee'>('all');
  const [metrics, setMetrics] = useState<UserMetrics>({
    totalStaff: 0,
    gstManagers: 0,
    employees: 0,
  });
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    role: 'employee' as 'gst_manager' | 'employee',
  });

  const fetchEmployees = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all profiles first
      const { data: allProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, user_id, first_name, email');
      
      if (profilesError) {
        console.error('UserManagement - Error fetching profiles:', profilesError);
        throw profilesError;
      }

      console.log('UserManagement - All profiles fetched:', allProfiles?.length);

      // Fetch all staff roles (not superadmin, not client)
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['employee', 'gst_manager']);
      
      if (rolesError) {
        console.error('UserManagement - Error fetching roles:', rolesError);
        throw rolesError;
      }

      console.log('UserManagement - Roles fetched:', roles?.length);

      if (!roles || roles.length === 0) {
        setEmployees([]);
        setMetrics({ totalStaff: 0, gstManagers: 0, employees: 0 });
        return;
      }

      // Create a role map by user_id (dedupe by user_id)
      const roleMap = new Map<string, string>();
      roles.forEach(r => {
        if (!roleMap.has(r.user_id)) {
          roleMap.set(r.user_id, r.role);
        }
      });

      console.log('UserManagement - Unique role user_ids:', roleMap.size);

      // Build employee list by matching profiles to roles
      const seenUserIds = new Set<string>();
      const employeeList: Employee[] = [];
      let gstManagerCount = 0;
      let employeeCount = 0;

      (allProfiles || []).forEach(profile => {
        const role = roleMap.get(profile.user_id);
        
        // Only include if this profile has a staff role and we haven't seen this user_id yet
        if (role && !seenUserIds.has(profile.user_id)) {
          seenUserIds.add(profile.user_id);
          
          employeeList.push({
            id: profile.id,
            user_id: profile.user_id,
            first_name: profile.first_name,
            email: profile.email,
            role: role as 'gst_manager' | 'employee',
          });

          if (role === 'gst_manager') gstManagerCount++;
          else if (role === 'employee') employeeCount++;
        }
      });

      console.log('UserManagement - Final list:', employeeList.length, { gstManagerCount, employeeCount });
      
      setEmployees(employeeList);
      setMetrics({
        totalStaff: employeeList.length,
        gstManagers: gstManagerCount,
        employees: employeeCount,
      });
    } catch (error: any) {
      console.error('UserManagement - Error:', error);
      toast.error('Failed to load employees');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Set up realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('user-management-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => {
        console.log('UserManagement - user_roles changed, refetching...');
        fetchEmployees();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        console.log('UserManagement - profiles changed, refetching...');
        fetchEmployees();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchEmployees]);

  const handleAddEmployee = async () => {
    if (!newEmployee.firstName.trim()) {
      toast.error('Please enter the employee name.');
      return;
    }

    try {
      const tempUserId = crypto.randomUUID();
      const email = `${newEmployee.firstName.toLowerCase().replace(/\s+/g, '.')}@staff.local`;
      
      // Insert profile first with default password
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([{
          user_id: tempUserId,
          first_name: newEmployee.firstName,
          email: email,
          password: '2026',
        }]);
      
      if (profileError) throw profileError;

      // Then insert role
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert([{
          user_id: tempUserId,
          role: newEmployee.role,
          is_first_login: true,
        }]);
      
      if (roleError) {
        // Rollback profile if role insert fails
        await supabase.from('profiles').delete().eq('user_id', tempUserId);
        throw roleError;
      }

      toast.success(`${newEmployee.firstName} added. Login: ${newEmployee.firstName} / 2026`);

      setNewEmployee({ firstName: '', role: 'employee' });
      setShowAddDialog(false);
      fetchEmployees();
    } catch (error: any) {
      console.error('Error adding employee:', error);
      toast.error('Failed to add employee: ' + error.message);
    }
  };

  const handleDeleteEmployee = async (employeeId: string, userId: string, name: string) => {
    const ok = await confirm({
      title: 'Remove staff member?',
      description: `${name} will be removed from the system and will no longer be able to log in.`,
      destructive: true,
      confirmText: 'Remove',
    });
    if (!ok) return;

    try {
      // Delete role first (child), then profile (parent)
      const { error: roleError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);
      
      if (roleError) throw roleError;

      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('user_id', userId);
      
      if (profileError) throw profileError;

      toast.success(`${name} has been removed.`);

      fetchEmployees();
    } catch (error: any) {
      toast.error('Failed to delete: ' + error.message);
    }
  };

  const handleEditEmployee = (employee: Employee) => {
    setEditingEmployee(employee);
    setShowEditDialog(true);
  };

  const handleUpdateRole = async () => {
    if (!editingEmployee) return;

    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: editingEmployee.role })
        .eq('user_id', editingEmployee.user_id);

      if (error) throw error;

      toast.success(
        `${editingEmployee.first_name}'s role changed to ${editingEmployee.role === 'gst_manager' ? 'GST Manager' : 'Employee'}.`,
      );

      setShowEditDialog(false);
      setEditingEmployee(null);
      fetchEmployees();
    } catch (error: any) {
      toast.error('Failed to update role: ' + error.message);
    }
  };

  // Only show for users who can manage employees
  if (!canManageEmployees()) {
    return null;
  }

  // Filter employees based on selection
  const filteredEmployees = selectedFilter === 'all' 
    ? employees 
    : employees.filter(e => e.role === selectedFilter);

  const metricCards = [
    {
      label: 'Total Staff',
      value: metrics.totalStaff,
      icon: <Users className="h-6 w-6 text-primary" />,
      filterValue: 'all' as const,
    },
    {
      label: 'GST Managers',
      value: metrics.gstManagers,
      icon: <Shield className="h-6 w-6 text-primary" />,
      filterValue: 'gst_manager' as const,
    },
    {
      label: 'Employees',
      value: metrics.employees,
      icon: <Users className="h-6 w-6 text-muted-foreground" />,
      filterValue: 'employee' as const,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              User Management
            </CardTitle>
            <CardDescription>Manage staff members and their roles</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchEmployees}
            disabled={isLoading}
            title="Refresh staff list"
            aria-label="Refresh staff list"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {metricCards.map((card, index) => (
            <Card 
              key={index}
              className={`border cursor-pointer transition-all duration-200 ${
                selectedFilter === card.filterValue 
                  ? 'ring-2 ring-primary bg-primary/5' 
                  : 'hover:bg-muted/30'
              }`}
              onClick={() => setSelectedFilter(card.filterValue)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-primary/5">
                    {card.icon}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className="text-2xl font-bold tabular-nums">{isLoading ? '—' : card.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Staff List Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-medium flex items-center gap-2">
              {selectedFilter === 'gst_manager' ? 'GST Managers' : selectedFilter === 'employee' ? 'Employees' : 'All Staff'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {filteredEmployees.length} {selectedFilter === 'all' ? 'staff members' : selectedFilter === 'gst_manager' ? 'managers' : 'employees'}
            </p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm" className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Employee Name</Label>
                  <Input
                    id="firstName"
                    value={newEmployee.firstName}
                    onChange={(e) => setNewEmployee(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Enter first name"
                  />
                  <p className="text-xs text-muted-foreground">Used as login ID</p>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={newEmployee.role}
                    onValueChange={(value: 'gst_manager' | 'employee') => 
                      setNewEmployee(prev => ({ ...prev, role: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gst_manager">GST Manager</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-sm font-medium">Credentials:</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Login: <span className="font-mono">{newEmployee.firstName || '[Name]'}</span> / 2026
                  </p>
                  <p className="text-xs text-muted-foreground">
                    (Must change on first login)
                  </p>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                  <Button onClick={handleAddEmployee}>Add Employee</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Staff List */}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <TableEmptyState
              icon={<Users className="h-6 w-6" />}
              title={`No ${selectedFilter === 'all' ? 'staff members' : selectedFilter === 'gst_manager' ? 'GST managers' : 'employees'} found`}
              description="Use Add Employee to create a staff login."
            />
          ) : (
            filteredEmployees.map((emp) => (
              <div
                key={emp.user_id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="font-semibold text-primary">
                      {emp.first_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{emp.first_name}</p>
                      {emp.role === 'gst_manager' ? (
                        <Badge className="bg-primary/10 text-primary border-0 text-xs flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          Manager
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Employee</Badge>
                      )}
                    </div>
                    {emp.email && (
                      <p className="text-xs text-muted-foreground">{emp.email}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={() => handleEditEmployee(emp)}
                    title="Edit role"
                    aria-label={`Edit role for ${emp.first_name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteEmployee(emp.id, emp.user_id, emp.first_name)}
                    title="Remove staff member"
                    aria-label={`Remove staff member ${emp.first_name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Edit Role Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Employee Role</DialogTitle>
            </DialogHeader>
            {editingEmployee && (
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <p className="text-sm font-medium">{editingEmployee.first_name}</p>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={editingEmployee.role}
                    onValueChange={(value: 'gst_manager' | 'employee') => 
                      setEditingEmployee(prev => prev ? { ...prev, role: value } : null)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gst_manager">GST Manager</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
                  <Button onClick={handleUpdateRole}>Update Role</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default UserManagementSection;
