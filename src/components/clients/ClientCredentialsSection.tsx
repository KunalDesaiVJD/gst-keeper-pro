import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, Copy, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ClientCredentialsSectionProps {
  gstin: string;
  onCredentialsGenerated?: (userId: string, password: string) => void;
}

const ClientCredentialsSection: React.FC<ClientCredentialsSectionProps> = ({
  gstin,
  onCredentialsGenerated,
}) => {
  const [generateCredentials, setGenerateCredentials] = useState(false);
  const [clientUserId, setClientUserId] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  // Extract PAN from GSTIN (characters 3-12)
  const extractPAN = (gstinValue: string): string => {
    if (gstinValue.length >= 12) {
      return gstinValue.substring(2, 12);
    }
    return '';
  };

  const generateRandomPassword = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleGenerateCredentials = () => {
    const pan = extractPAN(gstin);
    if (!pan) {
      toast({
        title: 'Invalid GSTIN',
        description: 'Please enter a valid GSTIN to generate credentials.',
        variant: 'destructive',
      });
      return;
    }

    const userId = pan;
    const password = generateRandomPassword();

    setClientUserId(userId);
    setClientPassword(password);
    setGenerateCredentials(true);

    if (onCredentialsGenerated) {
      onCredentialsGenerated(userId, password);
    }

    toast({
      title: 'Credentials Generated',
      description: 'Client login credentials have been created.',
    });
  };

  const handleUsePANAsPassword = () => {
    const pan = extractPAN(gstin);
    if (pan) {
      setClientPassword(pan);
      if (onCredentialsGenerated) {
        onCredentialsGenerated(clientUserId, pan);
      }
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard.`,
    });
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          Client Login Credentials
        </CardTitle>
        <CardDescription>
          Generate login credentials for this client to access their portal
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="generateCreds"
            checked={generateCredentials}
            onCheckedChange={(checked) => {
              if (checked) {
                handleGenerateCredentials();
              } else {
                setGenerateCredentials(false);
                setClientUserId('');
                setClientPassword('');
              }
            }}
          />
          <Label htmlFor="generateCreds" className="cursor-pointer">
            Generate login credentials for this client
          </Label>
        </div>

        {generateCredentials && (
          <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
            <div className="space-y-2">
              <Label htmlFor="clientUserId">User ID (Auto-generated from PAN)</Label>
              <div className="flex gap-2">
                <Input
                  id="clientUserId"
                  value={clientUserId}
                  readOnly
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(clientUserId, 'User ID')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientPassword">Initial Password</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="clientPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={clientPassword}
                    onChange={(e) => {
                      setClientPassword(e.target.value);
                      if (onCredentialsGenerated) {
                        onCredentialsGenerated(clientUserId, e.target.value);
                      }
                    }}
                    className="font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(clientPassword, 'Password')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const newPwd = generateRandomPassword();
                    setClientPassword(newPwd);
                    if (onCredentialsGenerated) {
                      onCredentialsGenerated(clientUserId, newPwd);
                    }
                  }}
                  title="Generate new password"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleUsePANAsPassword}
                  className="text-xs"
                >
                  Use PAN as password
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded border border-amber-500/30">
              <strong>Note:</strong> The client will be required to change this password on their first login.
              Make sure to communicate these credentials securely to the client.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ClientCredentialsSection;
