import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
  Users
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { mockPasswords, mockUsers } from '@/data/mockData';

interface Employee {
  id: string;
  user_id: string;
  first_name: string;
  email: string | null;
  role: 'gst_manager' | 'employee';
}

interface ManageEmployeesPageProps {
  embedded?: boolean;
}

const ManageEmployeesPage: React.FC<ManageEmployeesPageProps> = ({ embedded = false }) => {
  const { user, canManageEmployees } = useAuth();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    role: 'employee' as 'gst_manager' | 'employee',
  });

  // Only Superadmin can access this page (unless embedded)
  if (!embedded && !canManageEmployees()) {
    return <Navigate to="/dashboard" replace />;
  }

  // Fetch employees from Supabase
  const fetchEmployees = useCallback(async () => {
    try {
      // Fetch profiles with their roles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, user_id, first_name, email');
      
      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');
      
      if (rolesError) throw rolesError;

      // Combine profiles with roles, filter for staff only
      const employeeList = (profiles || [])
        .map(p => {
          const roleRecord = roles?.find(r => r.user_id === p.user_id);
          return {
            id: p.id,
            user_id: p.user_id,
            first_name: p.first_name,
            email: p.email,
            role: roleRecord?.role as 'gst_manager' | 'employee' || 'employee',
          };
        })
        .filter(e => e.role === 'gst_manager' || e.role === 'employee');

      setEmployees(employeeList);
    } catch (error: any) {
      console.error('Error fetching employees:', error);
      toast({
        title: 'Error',
        description: 'Failed to load employees: ' + error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleAddEmployee = async () => {
    if (!newEmployee.firstName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter the employee name.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Generate a unique user_id for the employee
      const tempUserId = crypto.randomUUID();
      const email = `${newEmployee.firstName.toLowerCase().replace(/\s+/g, '.')}@staff.local`;
      
      // First, insert into profiles (which is the referenced table)
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([{
          user_id: tempUserId,
          first_name: newEmployee.firstName,
          email: email,
        }]);
      
      if (profileError) throw profileError;

      // Then insert into user_roles (references profiles via user_id)
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

      // Add to mock data for login functionality
      mockPasswords[newEmployee.firstName] = '2026';
      mockUsers.push({
        id: tempUserId,
        userId: newEmployee.firstName,
        firstName: newEmployee.firstName,
        role: newEmployee.role,
        email: email,
        isFirstLogin: true,
        createdAt: new Date(),
      });

      toast({
        title: 'Employee Added',
        description: `${newEmployee.firstName} has been added as ${newEmployee.role === 'gst_manager' ? 'GST Manager' : 'Employee'}. Login: ${newEmployee.firstName} / 2026`,
      });

      setNewEmployee({ firstName: '', role: 'employee' });
      setShowAddDialog(false);
      fetchEmployees();
    } catch (error: any) {
      console.error('Error adding employee:', error);
      toast({
        title: 'Error',
        description: 'Failed to add employee: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const handleDeleteEmployee = async (employeeId: string, userId: string, name: string) => {
    try {
      // Delete from user_roles first (child table)
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);
      
      // Delete from profiles (parent table)
      await supabase
        .from('profiles')
        .delete()
        .eq('id', employeeId);

      // Remove from mock data
      delete mockPasswords[name];
      const mockIndex = mockUsers.findIndex(u => u.userId === name);
      if (mockIndex > -1) mockUsers.splice(mockIndex, 1);

      toast({
        title: 'Employee Removed',
        description: `${name} has been removed from the system.`,
      });
      
      fetchEmployees();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to delete employee: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const content = (
    <>
      {/* Employee List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Staff Members
            </CardTitle>
            <CardDescription>
              {employees.length} employees in the system
            </CardDescription>
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
                  <Label htmlFor="firstName">Employee Name (First Name)</Label>
                  <Input
                    id="firstName"
                    value={newEmployee.firstName}
                    onChange={(e) => setNewEmployee(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Enter first name"
                  />
                  <p className="text-xs text-muted-foreground">
                    This will be used as the login ID
                  </p>
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
                  <p className="text-sm font-medium">Auto-generated Credentials:</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    User ID: <span className="font-mono">{newEmployee.firstName || '[First Name]'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Password: <span className="font-mono">2026</span> (must change on first login)
                  </p>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddEmployee}>
                    Add Employee
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (
            <div className="space-y-3">
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="font-semibold text-primary">
                        {emp.first_name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{emp.first_name}</p>
                        {emp.role === 'gst_manager' && (
                          <Badge className="bg-primary/10 text-primary border-0 flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            GST Manager
                          </Badge>
                        )}
                        {emp.role === 'employee' && (
                          <Badge variant="secondary">Employee</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Login ID: {emp.first_name}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteEmployee(emp.id, emp.user_id, emp.first_name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {employees.length === 0 && (
                <p className="text-center py-8 text-muted-foreground">No employees found. Add your first employee above.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Manage Employees</h1>
        <p className="text-muted-foreground">Add, edit, or remove staff members</p>
      </div>
      {content}
    </div>
  );
};

export default ManageEmployeesPage;
