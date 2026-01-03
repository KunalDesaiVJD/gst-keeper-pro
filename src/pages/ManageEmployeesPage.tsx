import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Plus, 
  Trash2,
  UserPlus,
  Shield,
  Users
} from 'lucide-react';
import { mockUsers } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';
import { Navigate } from 'react-router-dom';

const ManageEmployeesPage: React.FC = () => {
  const { user, canManageEmployees } = useAuth();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    role: 'employee' as 'gst_manager' | 'employee',
  });

  // Only Superadmin can access this page
  if (!canManageEmployees()) {
    return <Navigate to="/dashboard" replace />;
  }

  const employees = mockUsers.filter(u => u.role === 'gst_manager' || u.role === 'employee');

  const handleAddEmployee = () => {
    if (!newEmployee.firstName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter the employee name.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Employee Added',
      description: `${newEmployee.firstName} has been added as ${newEmployee.role === 'gst_manager' ? 'GST Manager' : 'Employee'}. Login: ${newEmployee.firstName} / 2026`,
    });

    setNewEmployee({ firstName: '', role: 'employee' });
    setShowAddDialog(false);
  };

  const handleDeleteEmployee = (employeeId: string, name: string) => {
    toast({
      title: 'Employee Removed',
      description: `${name} has been removed from the system.`,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Manage Employees</h1>
          <p className="text-muted-foreground">Add, edit, or remove staff members</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
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
      </div>

      {/* Employee List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Staff Members
          </CardTitle>
          <CardDescription>
            {employees.length} employees in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {employees.map((emp) => (
              <div
                key={emp.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="font-semibold text-primary">
                      {emp.firstName.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{emp.firstName}</p>
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
                      Login ID: {emp.userId}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDeleteEmployee(emp.id, emp.firstName)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ManageEmployeesPage;
