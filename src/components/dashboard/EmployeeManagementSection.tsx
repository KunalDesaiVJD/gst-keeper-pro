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
  Users
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Employee {
  id: string;
  user_id: string;
  first_name: string;
  email: string | null;
  role: 'gst_manager' | 'employee';
}

const EmployeeManagementSection: React.FC = () => {
  const { canManageEmployees } = useAuth();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    role: 'employee' as 'gst_manager' | 'employee',
  });

  const fetchEmployees = useCallback(async () => {
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, user_id, first_name, email');
      
      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');
      
      if (rolesError) throw rolesError;

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
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      const tempUserId = crypto.randomUUID();
      
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([{
          user_id: tempUserId,
          first_name: newEmployee.firstName,
          email: `${newEmployee.firstName.toLowerCase()}@staff.local`,
        }]);
      
      if (profileError) throw profileError;

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert([{
          user_id: tempUserId,
          role: newEmployee.role,
        }]);
      
      if (roleError) throw roleError;

      toast({
        title: 'Employee Added',
        description: `${newEmployee.firstName} has been added as ${newEmployee.role === 'gst_manager' ? 'GST Manager' : 'Employee'}.`,
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
    if (!confirm(`Remove ${name} from the system?`)) return;
    
    try {
      await supabase.from('user_roles').delete().eq('user_id', userId);
      await supabase.from('profiles').delete().eq('id', employeeId);

      toast({
        title: 'Employee Removed',
        description: `${name} has been removed.`,
      });
      
      fetchEmployees();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to delete: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  // Only show for users who can manage employees
  if (!canManageEmployees()) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Employee Management
            </CardTitle>
            <CardDescription>{employees.length} staff members</CardDescription>
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
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                  <Button onClick={handleAddEmployee}>Add Employee</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {isLoading ? (
            <p className="text-center py-4 text-muted-foreground">Loading...</p>
          ) : employees.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">No employees yet.</p>
          ) : (
            employees.map((emp) => (
              <div
                key={emp.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="font-semibold text-primary text-sm">
                      {emp.first_name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{emp.first_name}</p>
                      {emp.role === 'gst_manager' ? (
                        <Badge className="bg-primary/10 text-primary border-0 text-xs flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          Manager
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Employee</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">ID: {emp.first_name}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDeleteEmployee(emp.id, emp.user_id, emp.first_name)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EmployeeManagementSection;
