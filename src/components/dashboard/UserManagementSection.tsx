import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Trash2,
  UserPlus,
  Shield,
  Users,
  Loader2,
  Pencil,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useAuth } from '@/contexts/AuthContext';
import SuperadminPasswordDialog from '@/components/dialogs/SuperadminPasswordDialog';
import { addStaffLevel, endStaffSessions, removeStaff, setStaffLevel, STAFF_LEVEL_LABEL } from '@/lib/staffLevels';

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

/** A change waiting for the superadmin's password (the GST Manager level is theirs alone). */
interface PasswordAsk {
  title: string;
  confirmText: string;
  run: (password: string) => Promise<void>;
}

const UserManagementSection: React.FC = () => {
  const { user, canManageEmployees, canChangeStaffLevel } = useAuth();
  const confirm = useConfirm();
  const [passwordAsk, setPasswordAsk] = useState<PasswordAsk | null>(null);
  // Set while the Add dialog closes to make way for the password prompt, so
  // the closing dialog does not hand focus back to its trigger behind it.
  const passwordNext = useRef(false);
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

  // Runs a change, turning the database's refusal into a toast; true when it went through.
  const attempt = async (run: () => Promise<void>, failure: string): Promise<boolean> => {
    try {
      await run();
      return true;
    } catch (error) {
      toast.error(`${failure}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const handleAddEmployee = async () => {
    const firstName = newEmployee.firstName.trim();
    if (!firstName) {
      toast.error('Please enter the employee name.');
      return;
    }
    if (!user) return;
    const level = newEmployee.role;
    if (level === 'gst_manager' && !canChangeStaffLevel()) {
      toast.error('Only the superadmin can add a GST Manager.');
      return;
    }

    const create = async (password?: string) => {
      const tempUserId = crypto.randomUUID();
      const email = `${firstName.toLowerCase().replace(/\s+/g, '.')}@staff.local`;
      // The profile first, with the default password; then its level.
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
      toast.success(`${firstName} added as ${STAFF_LEVEL_LABEL[level]}. Login: ${firstName} / 2026`);
      setNewEmployee({ firstName: '', role: 'employee' });
      setShowAddDialog(false);
      fetchEmployees();
    };

    if (level === 'gst_manager') {
      passwordNext.current = true;
      setShowAddDialog(false);
      setPasswordAsk({ title: `Add ${firstName} as a GST Manager`, confirmText: 'Add', run: create });
      return;
    }
    await attempt(() => create(), 'Failed to add employee');
  };

  const handleDeleteEmployee = async (emp: Employee) => {
    if (!user) return;
    if (emp.role === 'gst_manager' && !canChangeStaffLevel()) {
      toast.error('Only the superadmin can remove a GST Manager.');
      return;
    }
    const ok = await confirm({
      title: 'Remove staff member?',
      description: `${emp.first_name} will be removed from the system and will no longer be able to log in.`,
      destructive: true,
      confirmText: 'Remove',
    });
    if (!ok) return;

    const remove = async (password?: string) => {
      await removeStaff(user.id, emp.user_id, password);
      toast.success(`${emp.first_name} has been removed.`);
      fetchEmployees();
    };
    if (emp.role === 'gst_manager') {
      setPasswordAsk({ title: `Remove ${emp.first_name} (GST Manager)`, confirmText: 'Remove', run: remove });
      return;
    }
    await attempt(() => remove(), 'Failed to remove');
  };

  const handleEndSessions = async (emp: Employee) => {
    if (!user) return;
    if (emp.role === 'gst_manager' && !canChangeStaffLevel()) {
      toast.error('Only the superadmin can log out a GST Manager.');
      return;
    }
    const ok = await confirm({
      title: `Log out ${emp.first_name}?`,
      description: `${emp.first_name} will be signed out on every computer and must log in again.`,
      confirmText: 'Log out',
    });
    if (!ok) return;
    const end = async (password?: string) => {
      await endStaffSessions(user.id, emp.user_id, password);
      toast.success(`${emp.first_name} is logged out and must log in again.`);
    };
    if (emp.role === 'gst_manager') {
      setPasswordAsk({ title: `Log out ${emp.first_name} (GST Manager)`, confirmText: 'Log out', run: end });
      return;
    }
    await attempt(() => end(), 'Failed to log out');
  };

  const handleEditEmployee = (employee: Employee) => {
    setEditingEmployee(employee);
    setShowEditDialog(true);
  };

  const handleUpdateRole = async () => {
    if (!canChangeStaffLevel()) {
      toast.error('Only the superadmin can change a staff level.');
      return;
    }
    if (!editingEmployee || !user) return;
    const target = editingEmployee;
    const current = employees.find((e) => e.user_id === target.user_id)?.role;
    if (current === target.role) {
      setShowEditDialog(false);
      setEditingEmployee(null);
      return;
    }
    setShowEditDialog(false);
    setPasswordAsk({
      title: `Make ${target.first_name} ${target.role === 'gst_manager' ? 'a GST Manager' : 'an Employee'}`,
      confirmText: 'Change level',
      run: async (password) => {
        await setStaffLevel(user.id, password, target.user_id, target.role);
        toast.success(`${target.first_name}'s level changed to ${STAFF_LEVEL_LABEL[target.role]}.`);
        setEditingEmployee(null);
        fetchEmployees();
      },
    });
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
      filterValue: 'all' as const,
    },
    {
      label: 'GST Managers',
      value: metrics.gstManagers,
      filterValue: 'gst_manager' as const,
    },
    {
      label: 'Employees',
      value: metrics.employees,
      filterValue: 'employee' as const,
    },
  ];

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          User Management
        </span>
      }
      description="Manage staff members and their roles"
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={fetchEmployees}
          disabled={isLoading}
          title="Refresh staff list"
          aria-label="Refresh staff list"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      }
    >
        {/* Metric tiles double as the role filter */}
        <div className="grid grid-cols-3 gap-2">
          {metricCards.map((card) => (
            <button
              key={card.filterValue}
              type="button"
              onClick={() => setSelectedFilter(card.filterValue)}
              title={`Show: ${card.label}`}
              aria-pressed={selectedFilter === card.filterValue}
              className={cn(
                'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
                selectedFilter === card.filterValue && 'ring-2 ring-primary/60',
              )}
            >
              <KpiTile label={card.label} value={isLoading ? '—' : card.value} />
            </button>
          ))}
        </div>

        {/* Staff List Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">
              {selectedFilter === 'gst_manager' ? 'GST Managers' : selectedFilter === 'employee' ? 'Employees' : 'All Staff'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {filteredEmployees.length} {selectedFilter === 'all' ? 'staff members' : selectedFilter === 'gst_manager' ? 'managers' : 'employees'}
            </p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm" className={WS_BTN}>
                <UserPlus className="h-3.5 w-3.5" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent onCloseAutoFocus={(e) => { if (passwordNext.current) { e.preventDefault(); passwordNext.current = false; } }}>
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
                      <SelectItem value="gst_manager" disabled={!canChangeStaffLevel()}>GST Manager</SelectItem>
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
        <div className="max-h-80 overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
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
                className="flex items-center justify-between gap-2 border-b px-3 py-1.5 transition-colors last:border-b-0 hover:bg-muted/30"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-xs font-semibold text-primary">
                      {emp.first_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{emp.first_name}</p>
                      {emp.role === 'gst_manager' ? (
                        <Badge variant="info" className="flex items-center gap-1 text-[10px] font-medium">
                          <Shield className="h-3 w-3" />
                          Manager
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-medium">Employee</Badge>
                      )}
                    </div>
                    {emp.email && (
                      <p className="truncate text-xs text-muted-foreground">{emp.email}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={() => handleEndSessions(emp)}
                    disabled={emp.role === 'gst_manager' && !canChangeStaffLevel()}
                    title={emp.role === 'gst_manager' && !canChangeStaffLevel() ? 'Only the superadmin can log out a GST Manager' : 'Log out (must log in again)'}
                    aria-label={`Log out ${emp.first_name}`}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={() => handleEditEmployee(emp)}
                    disabled={!canChangeStaffLevel()}
                    title={canChangeStaffLevel() ? 'Change level' : 'Only the superadmin can change a level'}
                    aria-label={`Change level for ${emp.first_name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteEmployee(emp)}
                    disabled={emp.role === 'gst_manager' && !canChangeStaffLevel()}
                    title={emp.role === 'gst_manager' && !canChangeStaffLevel() ? 'Only the superadmin can remove a GST Manager' : 'Remove staff member'}
                    aria-label={`Remove staff member ${emp.first_name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
              <DialogTitle>Change staff level</DialogTitle>
            </DialogHeader>
            {editingEmployee && (
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <p className="text-sm font-medium">{editingEmployee.first_name}</p>
                </div>
                <div className="space-y-2">
                  <Label>Level</Label>
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
                      <SelectItem value="gst_manager" disabled={!canChangeStaffLevel()}>GST Manager</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
                  <Button onClick={handleUpdateRole}>Change level</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <SuperadminPasswordDialog
          open={!!passwordAsk}
          title={passwordAsk?.title ?? ''}
          confirmText={passwordAsk?.confirmText}
          onOpenChange={(open) => { if (!open) setPasswordAsk(null); }}
          onConfirm={async (password) => (passwordAsk ? attempt(() => passwordAsk.run(password), 'Not done') : false)}
        />
    </SectionCard>
  );
};

export default UserManagementSection;
