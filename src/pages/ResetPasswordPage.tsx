import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, KeyRound, Loader2, XCircle } from 'lucide-react';
import logo from '@/assets/logo.png';
import ClientForgotPasswordDialog from '@/components/auth/ClientForgotPasswordDialog';
import {
  checkResetToken,
  completeClientPasswordReset,
  extractResetToken,
  type ResetLinkState,
} from '@/lib/clientPasswordReset';
import { clientPasswordProblem } from '@/lib/passwordRules';

// Public page, reached from the e-mailed link (/reset-password#token=…). The
// token, not a session, is what lets the client set a new password; it is
// taken off the address bar at once, works once, for 60 minutes
// (client_password_reset_check / _complete, migration 20261020100000).

type Stage = 'checking' | 'invalid' | 'form' | 'done' | 'error';

const ResetPasswordPage: React.FC = () => {
  const [token] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : extractResetToken(window.location.hash, window.location.search));
  const [stage, setStage] = useState<Stage>(token ? 'checking' : 'invalid');
  const [link, setLink] = useState<ResetLinkState | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    // Keep the token out of the address bar, history and any later referrer.
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (!token) return;
    let cancelled = false;
    checkResetToken(token)
      .then((state) => {
        if (cancelled) return;
        setLink(state);
        setStage(state.valid ? 'form' : 'invalid');
      })
      .catch(() => { if (!cancelled) setStage('error'); });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const p = clientPasswordProblem(newPassword);
    if (p) { setProblem(p); return; }
    if (newPassword !== confirmPassword) { setProblem('The two passwords do not match.'); return; }
    setProblem(null);
    setIsSaving(true);
    try {
      const done = await completeClientPasswordReset(token, newPassword);
      setUserId(done.userId);
      setStage('done');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const msg = (err as Error).message || 'Could not set the password.';
      if (/invalid or has expired/i.test(msg)) setStage('invalid');
      else setProblem(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <div className="w-full max-w-md animate-fade-in">
        <Card className="shadow-xl border-0 bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center space-y-4 pb-2">
            <div className="flex justify-center">
              <img src={logo} alt="V. J. Desai & Co. LLP" className="h-16 object-contain" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">{children}</CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-4">
          © 2026 V. J. Desai & Co. LLP. All rights reserved.
        </p>
      </div>
    </div>
  );

  if (stage === 'checking') {
    return shell(<div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>);
  }

  if (stage === 'invalid' || stage === 'error') {
    return shell(
      <div className="space-y-4 py-2 text-center">
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <CardTitle className="text-lg">
          {stage === 'error' ? 'Could not check this link' : 'This link is invalid or has expired'}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {stage === 'error'
            ? 'Please check your connection and open the link from the e-mail again.'
            : 'A reset link works once, for 60 minutes, and a newer request replaces an older link. Ask for a new one below.'}
        </p>
        <div className="flex flex-col gap-2">
          <ClientForgotPasswordDialog>
            <Button className="w-full">Send a new link</Button>
          </ClientForgotPasswordDialog>
          <Button asChild variant="outline" className="w-full"><Link to="/login">Back to sign in</Link></Button>
        </div>
      </div>,
    );
  }

  if (stage === 'done') {
    return shell(
      <div className="space-y-4 py-2 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <CardTitle className="text-lg">Your password has been changed</CardTitle>
        <p className="text-sm text-muted-foreground">
          Sign in with your User ID{userId ? <> <span className="font-mono font-medium text-foreground">{userId}</span></> : ' (your GSTIN)'} and
          the new password.
        </p>
        <Button asChild className="w-full"><Link to="/login">Go to sign in</Link></Button>
      </div>,
    );
  }

  return shell(
    <form onSubmit={submit} className="space-y-4">
      <div className="text-center">
        <CardTitle className="flex items-center justify-center gap-2 text-xl font-heading text-primary">
          <KeyRound className="h-5 w-5" /> Set a new password
        </CardTitle>
        <CardDescription className="mt-1">
          {link?.clientName}
          {link?.gstinMasked ? <span className="block font-mono text-xs">{link.gstinMasked}</span> : null}
        </CardDescription>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-new-password">New password</Label>
        <PasswordInput
          id="reset-new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className="h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm-password">Confirm new password</Label>
        <PasswordInput
          id="reset-confirm-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className="h-11"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        8 to 72 characters, not your GSTIN, no space at the start or end. This link works once.
      </p>
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
      <Button type="submit" className="h-11 w-full" disabled={isSaving || !newPassword || !confirmPassword}>
        {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Set new password'}
      </Button>
    </form>,
  );
};

export default ResetPasswordPage;
