import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import logo from '@/assets/logo.png';
import ChangePasswordDialog from '@/components/auth/ChangePasswordDialog';
import ForgotPasswordDialog from '@/components/auth/ForgotPasswordDialog';

const LoginPage: React.FC = () => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showFirstLoginDialog, setShowFirstLoginDialog] = useState(false);
  const [pendingUserName, setPendingUserName] = useState('');
  
  const { login, completeFirstLogin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId.trim() || !password.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter both User ID and Password.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const result = await login(userId, password);
      if (result.success) {
        if (result.isFirstLogin) {
          // Show password change dialog
          setPendingUserName(userId);
          setShowFirstLoginDialog(true);
        } else {
          navigate('/dashboard');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFirstLoginPasswordChange = async (newPassword: string) => {
    const success = await completeFirstLogin(newPassword);
    if (success) {
      setShowFirstLoginDialog(false);
      navigate('/dashboard');
    }
  };

  // Check if the user ID looks like a staff ID (not a PAN)
  const isStaffUser = (id: string): boolean => {
    // PAN is 10 characters with specific format: ABCDE1234F
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return !panRegex.test(id.toUpperCase());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <div className="w-full max-w-md animate-fade-in">
        <Card className="shadow-xl border-0 bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center space-y-4 pb-2">
            {/* Logo */}
            <div className="flex justify-center">
              <img 
                src={logo} 
                alt="V.J. Desai & Co." 
                className="h-16 object-contain"
              />
            </div>
            <div>
              <CardTitle className="text-2xl font-heading text-primary">
                GST Management System
              </CardTitle>
              <CardDescription className="text-muted-foreground mt-1">
                Sign in to access your account
              </CardDescription>
            </div>
          </CardHeader>
          
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="userId" className="text-sm font-medium">
                  User ID
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="userId"
                    type="text"
                    placeholder="Enter your User ID"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="pl-10 h-11"
                    autoComplete="username"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-11"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              
              <Button
                type="submit"
                className="w-full h-11 font-medium"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
            
            {/* Forgot Password - Only for Employees/GST Managers (not Clients or Superadmin) */}
            <div className="mt-6 text-center">
              <ForgotPasswordDialog />
            </div>
            
            {/* Development notice */}
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-6 p-4 bg-amber-500/10 rounded-lg border border-amber-500/30">
                <p className="text-xs font-medium text-amber-600 mb-1">⚠️ Development Environment</p>
                <p className="text-xs text-muted-foreground">
                  Staff: Use name + "2026". Clients: Use PAN as both ID and password.
                  First login requires password change.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        
        <p className="text-center text-xs text-muted-foreground mt-4">
          © 2025 V.J. Desai & Co. All rights reserved.
        </p>
      </div>

      {/* First Login Password Change Dialog */}
      <ChangePasswordDialog
        open={showFirstLoginDialog}
        onOpenChange={setShowFirstLoginDialog}
        onPasswordChanged={handleFirstLoginPasswordChange}
        isFirstLogin={true}
        userName={pendingUserName}
      />
    </div>
  );
};

export default LoginPage;
