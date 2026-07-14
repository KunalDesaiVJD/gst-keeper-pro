import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Shown when the Agent parks a job as needs_human with a CAPTCHA. The office
// staff types it once; the Agent then reuses the session for hours.
export const PortalCaptchaDialog: React.FC<{
  open: boolean;
  image?: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}> = ({ open, image, onSubmit, onCancel }) => {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);

  const submit = () => { if (text.trim()) onSubmit(text.trim()); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Enter the portal CAPTCHA</DialogTitle>
          <DialogDescription>
            The agent needs the CAPTCHA to log in. Type what you see — the session is then reused
            for hours, so this only happens occasionally.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {image
            ? <img src={image} alt="CAPTCHA" className="rounded border bg-white p-1" />
            : <div className="text-sm text-muted-foreground">Loading CAPTCHA…</div>}
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type the CAPTCHA"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="w-48 text-center tracking-widest"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={!text.trim()}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
