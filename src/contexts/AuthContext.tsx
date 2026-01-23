import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type UserRole = 'superadmin' | 'gst_manager' | 'employee' | 'client';

interface UserPermissions {
  manage_employees: boolean;
  unlock_sheets: boolean;
  view_version_history: boolean;
  add_edit_clients: boolean;
  delete_clients: boolean;
  edit_filing_status: boolean;
  export_data: boolean;
  delete_2b_rows: boolean;
  manage_rcm_masters: boolean;
}

const DEFAULT_PERMISSIONS: UserPermissions = {
  manage_employees: false,
  unlock_sheets: false,
  view_version_history: false,
  add_edit_clients: false,
  delete_clients: false,
  edit_filing_status: false,
  export_data: false,
  delete_2b_rows: false,
  manage_rcm_masters: false,
};

interface AppUser {
  id: string;
  email: string;
  firstName: string;
  role: UserRole;
  userId: string;
  permissions: UserPermissions;
}

interface AuthContextType {
  user: AppUser | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; isFirstLogin?: boolean }>;
  logout: () => Promise<void>;
  completeFirstLogin: (newPassword: string) => Promise<boolean>;
  isStaffRole: () => boolean;
  canManageEmployees: () => boolean;
  canUnlockSheets: () => boolean;
  canViewVersionHistory: () => boolean;
  canResetPasswords: () => boolean;
  canAddEditClients: () => boolean;
  canDeleteClients: () => boolean;
  canEditFilingStatus: () => boolean;
  canExportData: () => boolean;
  canDelete2BRows: () => boolean;
  canManageRCMMasters: () => boolean;
  hasPermission: (permission: keyof UserPermissions) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const FALLBACK_AUTH_KEY = 'vjdesai_user';

// Fetch permissions from database
const fetchUserPermissions = async (userId: string): Promise<UserPermissions> => {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('permission_key')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching permissions:', error);
    return { ...DEFAULT_PERMISSIONS };
  }

  const permissions = { ...DEFAULT_PERMISSIONS };
  data?.forEach(p => {
    if (p.permission_key in permissions) {
      permissions[p.permission_key as keyof UserPermissions] = true;
    }
  });

  return permissions;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingFirstLogin, setPendingFirstLogin] = useState<{ userId: string; firstName: string } | null>(null);
  const { toast } = useToast();

  const fetchUserData = useCallback(async (authUserId: string, email: string): Promise<AppUser | null> => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name')
        .eq('user_id', authUserId)
        .maybeSingle();

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', authUserId)
        .maybeSingle();

      if (!roleData) {
        console.warn('No role found for user:', authUserId);
        return null;
      }

      const firstName = profile?.first_name || email.split('@')[0];
      let userIdValue = firstName;
      
      if (roleData.role === 'client') {
        const { data: client } = await supabase
          .from('clients')
          .select('client_user_id')
          .eq('email', email)
          .maybeSingle();
        
        if (client?.client_user_id) {
          userIdValue = client.client_user_id;
        }
      }

      // Fetch permissions for staff
      const permissions = roleData.role !== 'client' 
        ? await fetchUserPermissions(authUserId)
        : { ...DEFAULT_PERMISSIONS };

      return {
        id: authUserId,
        email: email,
        firstName: firstName,
        role: roleData.role as UserRole,
        userId: userIdValue,
        permissions,
      };
    } catch (error) {
      console.error('Error fetching user data:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const storedUser = localStorage.getItem(FALLBACK_AUTH_KEY);
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser) as AppUser;
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', parsedUser.id)
            .maybeSingle();
          
          if (roleData) {
            // Refresh permissions on load
            const permissions = roleData.role !== 'client'
              ? await fetchUserPermissions(parsedUser.id)
              : { ...DEFAULT_PERMISSIONS };
            
            const updatedUser = { ...parsedUser, permissions };
            setUser(updatedUser);
            localStorage.setItem(FALLBACK_AUTH_KEY, JSON.stringify(updatedUser));
            setIsLoading(false);
            return;
          } else {
            localStorage.removeItem(FALLBACK_AUTH_KEY);
          }
        } catch {
          localStorage.removeItem(FALLBACK_AUTH_KEY);
        }
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, newSession) => {
          setSession(newSession);
          
          if (newSession?.user) {
            setTimeout(async () => {
              const userData = await fetchUserData(newSession.user.id, newSession.user.email || '');
              setUser(userData);
              setIsLoading(false);
            }, 0);
          } else if (!localStorage.getItem(FALLBACK_AUTH_KEY)) {
            setUser(null);
            setIsLoading(false);
          }
        }
      );

      const { data: { session: existingSession } } = await supabase.auth.getSession();
      setSession(existingSession);
      
      if (existingSession?.user) {
        const userData = await fetchUserData(existingSession.user.id, existingSession.user.email || '');
        setUser(userData);
      }
      setIsLoading(false);

      return () => subscription.unsubscribe();
    };

    initAuth();
  }, [fetchUserData]);

  const login = useCallback(async (identifier: string, password: string): Promise<{ success: boolean; isFirstLogin?: boolean }> => {
    try {
      const { data: staffData, error: staffError } = await supabase.rpc('authenticate_staff', {
        identifier: identifier,
        pass: password
      });

      if (staffError) {
        console.error('Staff auth error:', staffError);
      }

      if (staffData && staffData.length > 0) {
        const staff = staffData[0];
        
        if (staff.is_first_login && password === '2026') {
          setPendingFirstLogin({ userId: staff.user_id, firstName: staff.first_name });
          toast({
            title: 'Password Change Required',
            description: 'Please set a new password to continue.',
          });
          return { success: true, isFirstLogin: true };
        }

        // Fetch permissions for staff user
        const permissions = await fetchUserPermissions(staff.user_id);

        const userData: AppUser = {
          id: staff.user_id,
          email: staff.email || '',
          firstName: staff.first_name,
          role: staff.role as UserRole,
          userId: staff.first_name,
          permissions,
        };

        localStorage.setItem(FALLBACK_AUTH_KEY, JSON.stringify(userData));
        setUser(userData);
        
        toast({
          title: 'Login Successful',
          description: `Welcome back, ${userData.firstName}!`,
        });
        
        return { success: true, isFirstLogin: false };
      }

      if (!identifier.includes('@')) {
        const { data: client } = await supabase
          .from('clients')
          .select('id, name, email, client_user_id')
          .ilike('client_user_id', identifier)
          .maybeSingle();
        
        if (client) {
          if (password !== client.client_user_id) {
            toast({
              title: 'Login Failed',
              description: 'Invalid password.',
              variant: 'destructive',
            });
            return { success: false };
          }

          const clientUser: AppUser = {
            id: client.id,
            email: client.email || '',
            firstName: client.name,
            role: 'client',
            userId: client.client_user_id,
            permissions: { ...DEFAULT_PERMISSIONS },
          };

          localStorage.setItem(FALLBACK_AUTH_KEY, JSON.stringify(clientUser));
          setUser(clientUser);
          
          toast({
            title: 'Login Successful',
            description: `Welcome, ${clientUser.firstName}!`,
          });
          
          return { success: true, isFirstLogin: false };
        }
      }

      toast({
        title: 'Login Failed',
        description: 'Invalid credentials. Please check your User ID and password.',
        variant: 'destructive',
      });
      return { success: false };
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: 'Login Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
      return { success: false };
    }
  }, [toast]);

  const completeFirstLogin = useCallback(async (newPassword: string): Promise<boolean> => {
    if (!pendingFirstLogin) {
      return false;
    }

    try {
      const { error: updateError } = await supabase.rpc('complete_first_login', {
        target_user_id: pendingFirstLogin.userId,
        new_password: newPassword
      });

      if (updateError) {
        toast({
          title: 'Error',
          description: 'Failed to update password: ' + updateError.message,
          variant: 'destructive',
        });
        return false;
      }

      const { data: userData, error: snapshotError } = await supabase.rpc('get_user_snapshot', {
        target_user_id: pendingFirstLogin.userId
      });

      if (snapshotError || !userData || userData.length === 0) {
        toast({
          title: 'Error',
          description: 'Failed to complete login.',
          variant: 'destructive',
        });
        return false;
      }

      const userInfo = userData[0];
      const permissions = await fetchUserPermissions(userInfo.user_id);
      
      const appUser: AppUser = {
        id: userInfo.user_id,
        email: userInfo.email || '',
        firstName: userInfo.first_name,
        role: userInfo.role as UserRole,
        userId: userInfo.first_name,
        permissions,
      };

      localStorage.setItem(FALLBACK_AUTH_KEY, JSON.stringify(appUser));
      setUser(appUser);
      setPendingFirstLogin(null);

      toast({
        title: 'Password Set Successfully',
        description: `Welcome, ${appUser.firstName}!`,
      });

      return true;
    } catch (error) {
      console.error('Error completing first login:', error);
      toast({
        title: 'Error',
        description: 'Failed to set password. Please try again.',
        variant: 'destructive',
      });
      return false;
    }
  }, [pendingFirstLogin, toast]);

  const logout = useCallback(async () => {
    localStorage.removeItem(FALLBACK_AUTH_KEY);
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setPendingFirstLogin(null);
    
    toast({
      title: 'Logged Out',
      description: 'You have been successfully logged out.',
    });
  }, [toast]);

  // Role-based permission checks - Superadmin has all permissions by default
  const isStaffRole = useCallback((): boolean => {
    const staffRoles: UserRole[] = ['superadmin', 'gst_manager', 'employee'];
    return user ? staffRoles.includes(user.role) : false;
  }, [user]);

  const hasPermission = useCallback((permission: keyof UserPermissions): boolean => {
    if (!user) return false;
    // Superadmin has all permissions
    if (user.role === 'superadmin') return true;
    // GST Manager has all permissions
    if (user.role === 'gst_manager') return true;
    // Check specific permission for employees
    return user.permissions[permission] === true;
  }, [user]);

  const canManageEmployees = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return hasPermission('manage_employees');
  }, [user, hasPermission]);

  const canUnlockSheets = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('unlock_sheets');
  }, [user, hasPermission]);

  const canViewVersionHistory = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('view_version_history');
  }, [user, hasPermission]);

  const canResetPasswords = useCallback((): boolean => {
    return user?.role === 'superadmin' || user?.role === 'gst_manager';
  }, [user]);

  const canAddEditClients = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('add_edit_clients');
  }, [user, hasPermission]);

  const canDeleteClients = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('delete_clients');
  }, [user, hasPermission]);

  const canEditFilingStatus = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('edit_filing_status');
  }, [user, hasPermission]);

  const canExportData = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('export_data');
  }, [user, hasPermission]);

  const canDelete2BRows = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('delete_2b_rows');
  }, [user, hasPermission]);

  const canManageRCMMasters = useCallback((): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'gst_manager') return true;
    return hasPermission('manage_rcm_masters');
  }, [user, hasPermission]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        completeFirstLogin,
        isStaffRole,
        canManageEmployees,
        canUnlockSheets,
        canViewVersionHistory,
        canResetPasswords,
        canAddEditClients,
        canDeleteClients,
        canEditFilingStatus,
        canExportData,
        canDelete2BRows,
        canManageRCMMasters,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};