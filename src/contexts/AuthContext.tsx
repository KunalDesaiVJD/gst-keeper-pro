import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, AuthState, UserRole } from '@/types';
import { mockUsers, mockPasswords } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';

interface AuthContextType extends AuthState {
  login: (userId: string, password: string) => Promise<boolean>;
  logout: () => void;
  isStaffRole: () => boolean;
  canManageEmployees: () => boolean;
  canUnlockSheets: () => boolean;
  canViewVersionHistory: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
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

  const login = useCallback(async (userId: string, password: string): Promise<boolean> => {
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
      return false;
    }

    // Verify password
    const storedPassword = mockPasswords[user.userId];
    if (password !== storedPassword) {
      toast({
        title: 'Login Failed',
        description: 'Invalid password.',
        variant: 'destructive',
      });
      return false;
    }

    // Store session
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

    return true;
  }, [toast]);

  const logout = useCallback(() => {
    localStorage.removeItem('vjdesai_user');
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

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        isStaffRole,
        canManageEmployees,
        canUnlockSheets,
        canViewVersionHistory,
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
