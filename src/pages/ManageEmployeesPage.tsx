import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import {
  Trash2,
  UserPlus,
  Shield,
  Users,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import SuperadminPasswordDialog from '@/components/dialogs/SuperadminPasswordDialog';
import { addStaffLevel, removeStaff, STAFF_LEVEL_LABEL } from '@/lib/staffLevels';


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

/** Small red asterisk marking a required field. */
const RequiredMark: React.FC = () => (
  <span className="text-destructive" aria-hidden="true">
    {' '}
    *
  </span>
);

const ManageEmployeesPage: React.FC<ManageEmployeesPageProps> = ({ embedded = false }) => {
  const { user, canManageEmployees, canManagePositions, canChangeStaffLevel } = useAuth();
  // A change waiting for the superadmin's password (the GST Manager level is theirs alone).
  const [passwordAsk, setPasswordAsk] = useState<{ title: string; confirmText: string; run: (password: string) => Promise<void> } | null>(null);
  // Set while the Add dialog closes to make way for the password prompt, so
  // the closing dialog does not hand focus back to its trigger behind it.
  const passwordNext = useRef(false);
  const confirm = useConfirm();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    role: 'employee' as 'gst_manager' | 'employee',
    positionId: '',
  });
  const [positions, setPositions] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!canManagePositions()) return;
    void supabase.from('staff_positions').select('id, name').eq('is_active', true).eq('is_legacy', false).order('sort_order').order('name')
      .then(({ data }) => setPositions(data || []));
  }, [canManagePositions]);

  // Fetch employees from Supabase
  const fetchEmployees = useCallback(async () => {
    try {
      // First fetch roles for staff (gst_manager and employee)
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['gst_manager', 'employee']);

      if (rolesError) throw rolesError;

      if (!roles || roles.length === 0) {
        setEmployees([]);
        return;
      }

      // Get unique user IDs of staff (dedupe)
      const uniqueUserIds = [...new Set(roles.map(r => r.user_id))];

      // Fetch profiles for those users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, user_id, first_name, email')
        .in('user_id', uniqueUserIds);

      if (profilesError) throw profilesError;

      // Create a map of user_id to role (take first occurrence)
      const roleMap = new Map<string, string>();
      roles.forEach(role => {
        if (!roleMap.has(role.user_id)) {
          roleMap.set(role.user_id, role.role);
        }
      });

      // Only include users that have matching profiles with valid names
      const employeeList: Employee[] = [];

      profiles?.forEach(profile => {
        const role = roleMap.get(profile.user_id);
        if (role && profile.first_name && profile.first_name !== 'Unknown') {
          employeeList.push({
            id: profile.id,
            user_id: profile.user_id,
            first_name: profile.first_name,
            email: profile.email || null,
            role: role as 'gst_manager' | 'employee',
          });
        }
      });

      setEmployees(employeeList);
    } catch (error: any) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleAddEmployee = async () => {
    const firstName = newEmployee.firstName.trim();
    if (!firstName) {
      setShowValidation(true);
      toast.error('Please enter the employee name.');
      return;
    }
    if (!user) return;
    const level = newEmployee.role;
    if (level === 'gst_manager' && !canChangeStaffLevel()) {
      toast.error('Only the superadmin can add a GST Manager.');
      return;
    }
    const positionId = newEmployee.positionId;

    const create = async (password?: string) => {
      // Generate a unique user_id for the employee
      const tempUserId = crypto.randomUUID();
      const email = `${firstName.toLowerCase().replace(/\s+/g, '.')}@staff.local`;

      // First the profile, with the default password; then its level.
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([{ user_id: tempUserId, first_name: firstName, email, password: '2026' }]);
      if (profileError) throw profileError;
      try {
        await addStaffLevel(user.id, tempUserId, level, password);
      } catch (error) {
        // A profile without a level is not staff: take it out again.
        await supabase.from('profiles').delete().eq('user_id', tempUserId);
        throw error;
      }

      // An employee's controls come from their position (User Control).
      if (level === 'employee' && positionId) {
        const { error: posError } = await supabase.rpc('staff_assign_position', {
          p_user_id: tempUserId, p_position_id: positionId, p_actor_id: user.id,
        });
        if (posError) toast.error(`Added, but the role was not set: ${posError.message}`);
      }

      toast.success(`${firstName} has been added as ${STAFF_LEVEL_LABEL[level]}. Login: ${firstName} / 2026`);
      setNewEmployee({ firstName: '', role: 'employee', positionId: '' });
      setShowValidation(false);
      setShowAddDialog(false);
      fetchEmployees();
    };

    if (level === 'gst_manager') {
      passwordNext.current = true;
      setShowAddDialog(false);
      setPasswordAsk({ title: `Add ${firstName} as a GST Manager`, confirmText: 'Add', run: create });
      return;
    }
    setIsSubmitting(true);
    try {
      await create();
    } catch (error) {
      console.error('Error adding employee:', error);
      toast.error('Failed to add employee: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEmployee = async (emp: Employee) => {
    if (!user) return;
    if (emp.role === 'gst_manager' && !canChangeStaffLevel()) {
      toast.error('Only the superadmin can remove a GST Manager.');
      return;
    }
    if (!(await confirm({
      title: 'Remove employee?',
      description: `This permanently deletes ${emp.first_name}'s account — login, role and profile. This cannot be undone.`,
      destructive: true,
      confirmText: 'Delete',
    }))) return;
    // Level, permissions and profile go together (staff_remove).
    const remove = async (password?: string) => {
      await removeStaff(user.id, emp.user_id, password);
      toast.success(`${emp.first_name} has been removed from the system.`);
      fetchEmployees();
    };
    if (emp.role === 'gst_manager') {
      setPasswordAsk({ title: `Remove ${emp.first_name} (GST Manager)`, confirmText: 'Remove', run: remove });
      return;
    }
    try {
      await remove();
    } catch (error) {
      toast.error('Failed to delete employee: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const nameInvalid = showValidation && !newEmployee.firstName.trim();

  // Gated even when embedded — the embedding page is not the only way in.
  // Kept after all hook declarations so hook order stays stable (Rules of Hooks).
  if (!canManageEmployees()) {
    return <Navigate to="/dashboard" replace />;
  }

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
          <Dialog
            open={showAddDialog}
            onOpenChange={(open) => {
              setShowAddDialog(open);
              if (!open) setShowValidation(false);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent onCloseAutoFocus={(e) => { if (passwordNext.current) { e.preventDefault(); passwordNext.current = false; } }}>
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
                <DialogDescription>
                  Create a staff login. The employee signs in with their first name and the default
                  password, then must set their own on first login.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">
                    Employee Name (First Name)
                    <RequiredMark />
                  </Label>
                  <Input
                    id="firstName"
                    value={newEmployee.firstName}
                    onChange={(e) => setNewEmployee(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Enter first name"
                    aria-invalid={nameInvalid}
                    aria-describedby={nameInvalid ? 'firstName-error' : 'firstName-hint'}
                    className={cn(nameInvalid && 'border-destructive focus-visible:ring-destructive')}
                  />
                  {nameInvalid ? (
                    <p id="firstName-error" className="text-xs text-destructive">
                      Employee name is required.
                    </p>
                  ) : (
                    <p id="firstName-hint" className="text-xs text-muted-foreground">
                      This will be used as the login ID
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employeeRole">
                    Role
                    <RequiredMark />
                  </Label>
                  <Select
                    value={newEmployee.role}
                    onValueChange={(value: 'gst_manager' | 'employee') =>
                      setNewEmployee(prev => ({ ...prev, role: value }))
                    }
                  >
                    <SelectTrigger id="employeeRole">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gst_manager" disabled={!canChangeStaffLevel()}>GST Manager</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newEmployee.role === 'employee' && (
                  <div className="space-y-2">
                    <Label htmlFor="employeePosition">Role</Label>
                    {canManagePositions() ? (
                      <Select
                        value={newEmployee.positionId}
                        onValueChange={(value) => setNewEmployee(prev => ({ ...prev, positionId: value }))}
                      >
                        <SelectTrigger id="employeePosition">
                          <SelectValue placeholder="Choose the role — it decides what they can do" />
                        </SelectTrigger>
                        <SelectContent>
                          {positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        A GST Manager gives them a position in Settings → User Control. Until then they have no permissions.
                      </p>
                    )}
                  </div>
                )}
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-sm font-medium">Auto-generated Credentials:</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    User ID: <span className="font-mono">{newEmployee.firstName || '[First Name]'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Password: <span className="font-mono">2026</span> (must change on first login)
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => setShowAddDialog(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddEmployee} disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {isSubmitting ? 'Adding…' : 'Add Employee'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
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
                    aria-label={`Remove ${emp.first_name}`}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteEmployee(emp)}
                    disabled={emp.role === 'gst_manager' && !canChangeStaffLevel()}
                    title={emp.role === 'gst_manager' && !canChangeStaffLevel() ? 'Only the superadmin can remove a GST Manager' : undefined}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {employees.length === 0 && (
                <TableEmptyState
                  icon={<Users className="h-6 w-6" />}
                  title="No employees yet"
                  description="Use “Add Employee” above to create your first staff login."
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <SuperadminPasswordDialog
        open={!!passwordAsk}
        title={passwordAsk?.title ?? ''}
        confirmText={passwordAsk?.confirmText}
        onOpenChange={(open) => { if (!open) setPasswordAsk(null); }}
        onConfirm={async (password) => {
          if (!passwordAsk) return false;
          try {
            await passwordAsk.run(password);
            return true;
          } catch (error) {
            toast.error('Not done: ' + (error instanceof Error ? error.message : String(error)));
            return false;
          }
        }}
      />
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Manage Employees"
        subtitle="Add, edit, or remove staff members"
        icon={<Users className="h-6 w-6" />}
      />
      {content}
    </div>
  );
};

export default ManageEmployeesPage;
