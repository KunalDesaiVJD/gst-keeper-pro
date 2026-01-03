import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Eye, EyeOff, Lock, User, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import logo from '@/assets/logo.png';

const LoginPage: React.FC = () => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [forgotPasswordPan, setForgotPasswordPan] = useState('');
  const [showForgotDialog, setShowForgotDialog] = useState(false);
  
  const { login } = useAuth();
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
      const success = await login(userId, password);
      if (success) {
        navigate('/dashboard');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (!forgotPasswordPan.trim() || forgotPasswordPan.length !== 10) {
      toast({
        title: 'Invalid PAN',
        description: 'Please enter a valid 10-character PAN number.',
        variant: 'destructive',
      });
      return;
    }

    // Simulate OTP sent
    toast({
      title: 'OTP Sent',
      description: `An OTP has been sent to the registered email address for PAN ${forgotPasswordPan}.`,
    });
    setShowForgotDialog(false);
    setForgotPasswordPan('');
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
            
            {/* Forgot Password - Only for Clients */}
            <div className="mt-6 text-center">
              <Dialog open={showForgotDialog} onOpenChange={setShowForgotDialog}>
                <DialogTrigger asChild>
                  <button className="text-sm text-primary hover:text-primary/80 hover:underline transition-colors">
                    Forgot Password? (Clients Only)
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <KeyRound className="h-5 w-5 text-primary" />
                      Reset Password
                    </DialogTitle>
                    <DialogDescription>
                      Enter your PAN number. An OTP will be sent to your registered email address.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="pan">PAN Number</Label>
                      <Input
                        id="pan"
                        type="text"
                        placeholder="Enter your 10-digit PAN"
                        value={forgotPasswordPan}
                        onChange={(e) => setForgotPasswordPan(e.target.value.toUpperCase())}
                        maxLength={10}
                        className="uppercase"
                      />
                    </div>
                    <Button onClick={handleForgotPassword} className="w-full">
                      Send OTP
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            
            {/* Demo Credentials Info */}
            <div className="mt-6 p-4 bg-muted/50 rounded-lg border border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2">Demo Credentials:</p>
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Superadmin:</strong> superadmin / 123</p>
                <p><strong>GST Manager:</strong> Kunal / 2026</p>
                <p><strong>Employee:</strong> Amit / 2026</p>
                <p><strong>Client:</strong> AAQCS2345D / AAQCS2345D</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <p className="text-center text-xs text-muted-foreground mt-4">
          © 2025 V.J. Desai & Co. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
