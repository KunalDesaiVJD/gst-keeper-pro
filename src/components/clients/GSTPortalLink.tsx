import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExternalLink, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface GSTPortalLinkProps {
  clientId: string;
  clientName?: string;
}

const GSTPortalLink: React.FC<GSTPortalLinkProps> = ({ clientId, clientName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [credentials, setCredentials] = useState<{ userId: string; password: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchCredentials = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('gst_user_id, gst_password')
        .eq('id', clientId)
        .single();

      if (error) throw error;

      if (data?.gst_user_id || data?.gst_password) {
        setCredentials({
          userId: data.gst_user_id || '',
          password: data.gst_password || '',
        });
      } else {
        setCredentials(null);
      }
    } catch (error) {
      console.error('Error fetching credentials:', error);
      setCredentials(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDialog = () => {
    setIsOpen(true);
    fetchCredentials();
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleOpenGSTPortal = () => {
    // Open GST portal in new tab
    window.open('https://services.gst.gov.in/services/login', '_blank');
    
    // Try to auto-fill using JavaScript (will only work if same origin, which it won't)
    // This is for future extension/browser compatibility
    if (credentials?.userId && credentials?.password) {
      // Store credentials temporarily for potential browser extension pickup
      sessionStorage.setItem('gst_auto_fill', JSON.stringify({
        userId: credentials.userId,
        password: credentials.password,
      }));
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpenDialog}
        className="gap-2"
        title="Open GST Portal"
      >
        <ExternalLink className="h-3 w-3" />
        GST
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>GST Portal Login</DialogTitle>
            <DialogDescription>
              {clientName ? `Credentials for ${clientName}` : 'GST Portal credentials for this client'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-4 text-muted-foreground">
                Loading credentials...
              </div>
            ) : credentials ? (
              <>
                <div className="space-y-2">
                  <Label>GST User ID</Label>
                  <div className="flex gap-2">
                    <Input
                      value={credentials.userId}
                      readOnly
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopy(credentials.userId, 'User ID')}
                    >
                      {copiedField === 'User ID' ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>GST Password</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={credentials.password}
                        readOnly
                        className="font-mono pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopy(credentials.password, 'Password')}
                    >
                      {copiedField === 'Password' ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="pt-2">
                  <Button onClick={handleOpenGSTPortal} className="w-full gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Open GST Portal
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Copy the credentials above and paste them on the GST portal login page.
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-4 space-y-4">
                <p className="text-muted-foreground">
                  No GST portal credentials found for this client.
                </p>
                <p className="text-xs text-muted-foreground">
                  You can add credentials in the Edit Client form.
                </p>
                <Button onClick={handleOpenGSTPortal} variant="outline" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Open GST Portal Anyway
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GSTPortalLink;
