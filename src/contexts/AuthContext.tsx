import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type UserRole = 'superadmin' | 'gst_manager' | 'employee' | 'client';

interface AppUser {
  id: string;
  email: string;
  firstName: string;
  role: UserRole;
  userId: string; // For backward compatibility - PAN for clients, name for staff
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Storage key for fallback auth
const FALLBACK_AUTH_KEY = 'vjdesai_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingFirstLogin, setPendingFirstLogin] = useState<{ userId: string; firstName: string } | null>(null);
  const { toast } = useToast();

  // Fetch user profile and role from database
  const fetchUserData = useCallback(async (authUserId: string, email: string): Promise<AppUser | null> => {
    try {
      // Fetch profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name')
        .eq('user_id', authUserId)
        .maybeSingle();

      // Fetch role
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
      
      // For clients, userId is their PAN (extracted from client record)
      // For staff, userId is their first_name (for backward compatibility with login)
      let userIdValue = firstName;
      
      if (roleData.role === 'client') {
        // Try to find the client's PAN
        const { data: client } = await supabase
          .from('clients')
          .select('client_user_id')
          .eq('email', email)
          .maybeSingle();
        
        if (client?.client_user_id) {
          userIdValue = client.client_user_id;
        }
      }

      return {
        id: authUserId,
        email: email,
        firstName: firstName,
        role: roleData.role as UserRole,
        userId: userIdValue,
      };
    } catch (error) {
      console.error('Error fetching user data:', error);
      return null;
    }
  }, []);

  // Initialize auth state - check for stored fallback session first
  useEffect(() => {
    const initAuth = async () => {
      // First, check for fallback auth (stored in localStorage)
      const storedUser = localStorage.getItem(FALLBACK_AUTH_KEY);
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser) as AppUser;
          // Verify user still exists in database
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', parsedUser.id)
            .maybeSingle();
          
          if (roleData) {
            setUser(parsedUser);
            setIsLoading(false);
            return;
          } else {
            // User no longer exists, clear storage
            localStorage.removeItem(FALLBACK_AUTH_KEY);
          }
        } catch {
          localStorage.removeItem(FALLBACK_AUTH_KEY);
        }
      }

      // Then check Supabase auth
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
      // First try staff authentication using the secure database function
      const { data: staffData, error: staffError } = await supabase.rpc('authenticate_staff', {
        identifier: identifier,
        pass: password
      });

      if (staffError) {
        console.error('Staff auth error:', staffError);
      }

      // Check if staff authentication succeeded
      if (staffData && staffData.length > 0) {
        const staff = staffData[0];
        
        // Check for first login with default password
        if (staff.is_first_login && password === '2026') {
          setPendingFirstLogin({ userId: staff.user_id, firstName: staff.first_name });
          toast({
            title: 'Password Change Required',
            description: 'Please set a new password to continue.',
          });
          return { success: true, isFirstLogin: true };
        }

        // Create user object and store
        const userData: AppUser = {
          id: staff.user_id,
          email: staff.email || '',
          firstName: staff.first_name,
          role: staff.role as UserRole,
          userId: staff.first_name,
        };

        localStorage.setItem(FALLBACK_AUTH_KEY, JSON.stringify(userData));
        setUser(userData);
        
        toast({
          title: 'Login Successful',
          description: `Welcome back, ${userData.firstName}!`,
        });
        
        return { success: true, isFirstLogin: false };
      }

      // If staff auth failed, try client login (PAN-based)
      if (!identifier.includes('@')) {
        const { data: client } = await supabase
          .from('clients')
          .select('id, name, email, client_user_id')
          .ilike('client_user_id', identifier)
          .maybeSingle();
        
        if (client) {
          // For clients, password is their PAN
          if (password !== client.client_user_id) {
            toast({
              title: 'Login Failed',
              description: 'Invalid password.',
              variant: 'destructive',
            });
            return { success: false };
          }

          // Create client user object
          const clientUser: AppUser = {
            id: client.id,
            email: client.email || '',
            firstName: client.name,
            role: 'client',
            userId: client.client_user_id,
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

      // No valid user found
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
      // Use the secure database function to complete first login
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

      // Fetch complete user data using the secure function
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
      const appUser: AppUser = {
        id: userInfo.user_id,
        email: userInfo.email || '',
        firstName: userInfo.first_name,
        role: userInfo.role as UserRole,
        userId: userInfo.first_name,
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
    // Clear fallback auth
    localStorage.removeItem(FALLBACK_AUTH_KEY);
    
    // Clear Supabase session if exists
    await supabase.auth.signOut();
    
    setSession(null);
    setUser(null);
    setPendingFirstLogin(null);
    
    toast({
      title: 'Logged Out',
      description: 'You have been successfully logged out.',
    });
  }, [toast]);

  // Role-based permission checks
  const isStaffRole = useCallback((): boolean => {
    const staffRoles: UserRole[] = ['superadmin', 'gst_manager', 'employee'];
    return user ? staffRoles.includes(user.role) : false;
  }, [user]);

  const canManageEmployees = useCallback((): boolean => {
    return user?.role === 'superadmin';
  }, [user]);

  const canUnlockSheets = useCallback((): boolean => {
    return user?.role === 'superadmin' || user?.role === 'gst_manager';
  }, [user]);

  const canViewVersionHistory = useCallback((): boolean => {
    return user?.role === 'superadmin' || user?.role === 'gst_manager';
  }, [user]);

  const canResetPasswords = useCallback((): boolean => {
    return user?.role === 'superadmin' || user?.role === 'gst_manager';
  }, [user]);

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
