import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { Shield, Users, Save, Loader2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';

// Define available permissions
const AVAILABLE_PERMISSIONS = [
  {
    key: 'manage_employees',
    label: 'Manage Employees',
    description: 'Add, edit, and delete employee accounts',
  },
  {
    key: 'unlock_sheets',
    label: 'Unlock Sheets',
    description: 'Unlock locked 2B reconciliation and ITC sheets',
  },
  {
    key: 'view_version_history',
    label: 'View Version History',
    description: 'Access version history of 2B running sheets',
  },
  {
    key: 'add_edit_clients',
    label: 'Add/Edit Clients',
    description: 'Add new clients and edit existing client records',
  },
  {
    key: 'delete_clients',
    label: 'Delete Clients',
    description: 'Delete client records from the system',
  },
  {
    key: 'edit_filing_status',
    label: 'Edit Filing Status',
    description: 'Update filing status and mark returns as filed',
  },
  {
    key: 'export_data',
    label: 'Export Data',
    description: 'Export data to Excel and PDF formats',
  },
  {
    key: 'delete_2b_rows',
    label: 'Delete 2B Rows',
    description: 'Delete rows from 2B Reconciliation tables',
  },
  {
    key: 'manage_rcm_masters',
    label: 'Manage RCM Masters',
    description: 'Add, edit, and delete RCM expense masters',
  },
  {
    key: 'edit_update_sheet',
    label: 'Edit Update Sheet',
    description: 'Edit entries on the GST Update Sheet',
  },
  {
    key: 'import_excel',
    label: 'Import Excel',
    description: 'Import data from Excel files in 2B Reconciliation',
  },
  {
    key: 'manual_override',
    label: 'Manual Override',
    description: 'Override opening balance on Suspended Reco and GST Receivable Reco (requires justification)',
  },
];

interface Employee {
  user_id: string;
  first_name: string;
  email: string | null;
  role: string;
}

interface UserPermission {
  permission_key: string;
}

const UserControlPage: React.FC = () => {
  const { user, canManageEmployees } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch employees (non-client users)
  useEffect(() => {
    const fetchEmployees = async () => {
      setLoading(true);
      try {
        // Fetch roles first to get staff user_ids
        const { data: rolesData, error: rolesError } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('role', ['gst_manager', 'employee']);

        if (rolesError) throw rolesError;
        console.log('UserControl - Roles fetched:', rolesData?.length, rolesData);

        if (!rolesData || rolesData.length === 0) {
          console.log('UserControl - No roles found');
          setEmployees([]);
          return;
        }

        // Get unique user_ids from roles
        const staffUserIds = [...new Set(rolesData.map(r => r.user_id))];

        // Create role map (dedupe by user_id, first occurrence wins)
        const roleMap = new Map<string, string>();
        rolesData.forEach(role => {
          if (!roleMap.has(role.user_id)) {
            roleMap.set(role.user_id, role.role);
          }
        });
        console.log('UserControl - Role map size:', roleMap.size);

        // Fetch profiles only for staff users
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, first_name, email')
          .in('user_id', staffUserIds);

        if (profilesError) throw profilesError;
        console.log('UserControl - Profiles fetched:', profilesData?.length, profilesData);

        // Build employee list - dedupe by user_id (not name)
        const seenUserIds = new Set<string>();
        const employeeList: Employee[] = [];
        
        (profilesData || []).forEach(profile => {
          const role = roleMap.get(profile.user_id);
          
          if (role && profile.first_name && !seenUserIds.has(profile.user_id)) {
            seenUserIds.add(profile.user_id);
            employeeList.push({
              user_id: profile.user_id,
              first_name: profile.first_name,
              email: profile.email || null,
              role: role,
            });
          }
        });

        console.log('UserControl - Final employee list:', employeeList);
        setEmployees(employeeList);
      } catch (error) {
        console.error('Error fetching employees:', error);
        toast.error('Failed to load employees');
      } finally {
        setLoading(false);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch permissions when employee is selected
  useEffect(() => {
    const fetchPermissions = async () => {
      if (!selectedEmployee) {
        setPermissions(new Set());
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_permissions')
          .select('permission_key')
          .eq('user_id', selectedEmployee);

        if (error) throw error;

        const permSet = new Set<string>(data?.map((p: UserPermission) => p.permission_key) || []);
        setPermissions(permSet);
      } catch (error) {
        console.error('Error fetching permissions:', error);
        toast.error('Failed to load permissions');
      }
    };

    fetchPermissions();
  }, [selectedEmployee]);

  const handlePermissionChange = (permissionKey: string, checked: boolean) => {
    setPermissions(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(permissionKey);
      } else {
        newSet.delete(permissionKey);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    console.log('handleSave called - selectedEmployee:', selectedEmployee, 'permissions:', Array.from(permissions));
    
    if (!selectedEmployee) {
      toast.error('Please select an employee first');
      return;
    }

    setSaving(true);
    try {
      console.log('Deleting existing permissions for user:', selectedEmployee);
      // Delete existing permissions for this user
      const { error: deleteError, count: deleteCount } = await supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', selectedEmployee);

      console.log('Delete result - error:', deleteError, 'count:', deleteCount);
      if (deleteError) throw deleteError;

      // Insert new permissions
      if (permissions.size > 0) {
        const permissionsToInsert = Array.from(permissions).map(key => ({
          user_id: selectedEmployee,
          permission_key: key,
          granted_by: user?.id || null, // Use user.id (UUID) not userId (display name)
        }));

        console.log('Inserting permissions:', permissionsToInsert);
        const { error: insertError, data: insertData } = await supabase
          .from('user_permissions')
          .insert(permissionsToInsert)
          .select();

        console.log('Insert result - error:', insertError, 'data:', insertData);
        if (insertError) throw insertError;
      }

      toast.success('Permissions updated successfully');
    } catch (error: any) {
      console.error('Error saving permissions:', error);
      toast.error(error?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const selectedEmployeeData = employees.find(e => e.user_id === selectedEmployee);

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'gst_manager': return 'GST Manager';
      case 'employee': return 'Employee';
      default: return role;
    }
  };

  // Redirect if not superadmin.
  // Kept after all hook declarations so hook order stays stable (Rules of Hooks).
  if (!canManageEmployees()) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="User Control"
        subtitle="Manage employee permissions and access rights"
        icon={<Shield className="h-6 w-6" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Employee Selection */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Select Employee
            </CardTitle>
            <CardDescription>
              Choose an employee to manage their permissions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger>
                <SelectValue placeholder="Select an employee..." />
              </SelectTrigger>
              <SelectContent>
                {employees.map(employee => (
                  <SelectItem key={employee.user_id} value={employee.user_id}>
                    <div className="flex flex-col">
                      <span>{employee.first_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {getRoleLabel(employee.role)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedEmployeeData && (
              <div className="p-3 bg-muted rounded-lg space-y-1">
                <p className="font-medium">{selectedEmployeeData.first_name}</p>
                <p className="text-sm text-muted-foreground">
                  Role: {getRoleLabel(selectedEmployeeData.role)}
                </p>
                {selectedEmployeeData.email && (
                  <p className="text-sm text-muted-foreground">
                    Email: {selectedEmployeeData.email}
                  </p>
                )}
              </div>
            )}

            {!loading && employees.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No staff members found. Add employees first on the Manage Employees page.
              </p>
            )}

            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Permissions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
            <CardDescription>
              {selectedEmployee 
                ? 'Select the permissions to grant to this employee'
                : 'Select an employee to view and manage their permissions'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedEmployee ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {AVAILABLE_PERMISSIONS.map(permission => (
                    <div
                      key={permission.key}
                      className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={permission.key}
                        checked={permissions.has(permission.key)}
                        onCheckedChange={(checked) => 
                          handlePermissionChange(permission.key, checked as boolean)
                        }
                      />
                      <div className="space-y-1">
                        <Label
                          htmlFor={permission.key}
                          className="font-medium cursor-pointer"
                        >
                          {permission.label}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          {permission.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-4 border-t">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Permissions
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  Select an employee from the list to manage their permissions
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default UserControlPage;
