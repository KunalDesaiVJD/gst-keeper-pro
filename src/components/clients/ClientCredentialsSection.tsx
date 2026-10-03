import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordInput } from '@/components/ui/password-input';
import { KeyRound, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { WS_FILTER_LABEL } from '@/components/workspace/theme';

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
      toast.error('Please enter a valid GSTIN to generate credentials.');
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

    toast.success('Client login credentials have been created.');
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
    toast.success(`${label} copied to clipboard.`);
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
        <CardTitle className="flex items-center gap-2 text-[15px] leading-snug">
          <KeyRound className="h-4 w-4 text-primary" />
          Client Login Credentials
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          Generate login credentials for this client to access their portal
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-3">
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
          <Label htmlFor="generateCreds" className="cursor-pointer text-sm">
            Generate login credentials for this client
          </Label>
        </div>

        {generateCredentials && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="space-y-1">
              <Label htmlFor="clientUserId" className={WS_FILTER_LABEL}>User ID (Auto-generated from PAN)</Label>
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
                  aria-label="Copy user ID"
                  onClick={() => copyToClipboard(clientUserId, 'User ID')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="clientPassword" className={WS_FILTER_LABEL}>Initial Password</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <PasswordInput
                    id="clientPassword"
                    value={clientPassword}
                    onChange={(e) => {
                      setClientPassword(e.target.value);
                      if (onCredentialsGenerated) {
                        onCredentialsGenerated(clientUserId, e.target.value);
                      }
                    }}
                    className="font-mono"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy password"
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
                  aria-label="Generate new password"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleUsePANAsPassword}
                  className="h-7 px-2 text-xs"
                >
                  Use PAN as password
                </Button>
              </div>
            </div>

            <Note tone="warn">
              <strong>Note:</strong> The client will be required to change this password on their first login.
              Make sure to communicate these credentials securely to the client.
            </Note>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ClientCredentialsSection;
