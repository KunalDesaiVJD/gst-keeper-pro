import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';

export interface ReasonDialogSpec {
  title: string;
  subtitle: string;
  /** What the action does, in a sentence or two. */
  explain: string;
  prompt: string;
  placeholder?: string;
  confirmText: string;
  destructive?: boolean;
  minLength?: number;
  run: (reason: string) => Promise<void>;
}

/** A superadmin action that needs a reason (allow a manual upload, take a return off Filed). */
const ReasonDialog: React.FC<{ spec: ReasonDialogSpec | null; onClose: () => void }> = ({ spec, onClose }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setBusy(false); }, [spec]);
  if (!spec) return null;
  const min = spec.minLength ?? 5;
  const ok = reason.trim().length >= min;
  const go = async () => {
    setBusy(true);
    try { await spec.run(reason.trim()); onClose(); } catch { /* run says why */ } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{spec.title}</DialogTitle>
          <DialogDescription className="text-xs">{spec.subtitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Note tone={spec.destructive ? 'warn' : 'info'}>{spec.explain}</Note>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{spec.prompt}</span>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="text-sm" placeholder={spec.placeholder} autoFocus />
            <span className={reason.trim().length && !ok ? 'text-[11px] text-destructive' : 'text-[11px] text-muted-foreground'}>
              At least {min} characters ({reason.trim().length}). Kept on the record.
            </span>
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-1">
          <Button variant="outline" size="sm" className={WS_BTN} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant={spec.destructive ? 'destructive' : 'default'} className={WS_BTN} onClick={go} disabled={!ok || busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {spec.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReasonDialog;
