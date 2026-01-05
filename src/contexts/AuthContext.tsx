import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, AuthState, UserRole } from '@/types';
import { mockUsers, mockPasswords } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType extends AuthState {
  login: (userId: string, password: string) => Promise<{ success: boolean; isFirstLogin?: boolean }>;
  logout: () => void;
  completeFirstLogin: (newPassword: string) => Promise<boolean>;
  isStaffRole: () => boolean;
  canManageEmployees: () => boolean;
  canUnlockSheets: () => boolean;
  canViewVersionHistory: () => boolean;
  canResetPasswords: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
  const [pendingFirstLogin, setPendingFirstLogin] = useState<User | null>(null);
  const { toast } = useToast();

  // Check for stored session on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('vjdesai_user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser) as User;
        setAuthState({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        localStorage.removeItem('vjdesai_user');
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    } else {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (userId: string, password: string): Promise<{ success: boolean; isFirstLogin?: boolean }> => {
    // Find user by userId (case-sensitive for clients/PAN, case-insensitive for staff)
    const user = mockUsers.find(u => 
      u.userId.toLowerCase() === userId.toLowerCase() || u.userId === userId
    );

    if (!user) {
      toast({
        title: 'Login Failed',
        description: 'User ID not found.',
        variant: 'destructive',
      });
      return { success: false };
    }

    // Verify password
    const storedPassword = mockPasswords[user.userId];
    if (password !== storedPassword) {
      toast({
        title: 'Login Failed',
        description: 'Invalid password.',
        variant: 'destructive',
      });
      return { success: false };
    }

    // Check if it's first login (staff with default password or newly created client)
    const isDefaultPassword = password === '2026' || password === user.userId; // 2026 for staff, PAN for clients
    
    // Check first login status from database
    let isFirstLogin = user.isFirstLogin;
    
    try {
      // Try to get first login status from database
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('is_first_login')
        .eq('user_id', user.id)
        .single();
      
      if (roleData) {
        isFirstLogin = roleData.is_first_login ?? false;
      }
    } catch {
      // Use local data if database check fails
    }

    if (isFirstLogin && isDefaultPassword) {
      // Store user for password change flow
      setPendingFirstLogin(user);
      toast({
        title: 'Password Change Required',
        description: 'Please set a new password to continue.',
      });
      return { success: true, isFirstLogin: true };
    }

    // Normal login - store session
    localStorage.setItem('vjdesai_user', JSON.stringify(user));
    
    setAuthState({
      user,
      isAuthenticated: true,
      isLoading: false,
    });

    toast({
      title: 'Login Successful',
      description: `Welcome back, ${user.firstName}!`,
    });

    return { success: true, isFirstLogin: false };
  }, [toast]);

  const completeFirstLogin = useCallback(async (newPassword: string): Promise<boolean> => {
    if (!pendingFirstLogin) {
      return false;
    }

    try {
      // Update password in mock store
      mockPasswords[pendingFirstLogin.userId] = newPassword;

      // Update first login status in database
      await supabase
        .from('user_roles')
        .update({ is_first_login: false })
        .eq('user_id', pendingFirstLogin.id);

      // Update local user object
      const updatedUser = { ...pendingFirstLogin, isFirstLogin: false };

      // Store session
      localStorage.setItem('vjdesai_user', JSON.stringify(updatedUser));
      
      setAuthState({
        user: updatedUser,
        isAuthenticated: true,
        isLoading: false,
      });

      setPendingFirstLogin(null);

      toast({
        title: 'Password Set Successfully',
        description: `Welcome, ${updatedUser.firstName}! You can now access the dashboard.`,
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

  const logout = useCallback(() => {
    localStorage.removeItem('vjdesai_user');
    setPendingFirstLogin(null);
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    toast({
      title: 'Logged Out',
      description: 'You have been successfully logged out.',
    });
  }, [toast]);

  // Role-based permission checks
  const isStaffRole = useCallback((): boolean => {
    const staffRoles: UserRole[] = ['superadmin', 'gst_manager', 'employee'];
    return authState.user ? staffRoles.includes(authState.user.role) : false;
  }, [authState.user]);

  const canManageEmployees = useCallback((): boolean => {
    return authState.user?.role === 'superadmin';
  }, [authState.user]);

  const canUnlockSheets = useCallback((): boolean => {
    return authState.user?.role === 'superadmin' || authState.user?.role === 'gst_manager';
  }, [authState.user]);

  const canViewVersionHistory = useCallback((): boolean => {
    return authState.user?.role === 'superadmin' || authState.user?.role === 'gst_manager';
  }, [authState.user]);

  const canResetPasswords = useCallback((): boolean => {
    return authState.user?.role === 'superadmin' || authState.user?.role === 'gst_manager';
  }, [authState.user]);

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        completeFirstLogin,
        isStaffRole,
        canManageEmployees,
        canUnlockSheets,
        canViewVersionHistory,
        canResetPasswords,
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
