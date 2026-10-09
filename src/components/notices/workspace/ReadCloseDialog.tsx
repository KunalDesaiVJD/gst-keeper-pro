// "Read and close" (roadmap Phase 4b; contract A): a notice whose type needs no
// reply (notice_type_settings.response_need = 'none') is closed once someone
// has read it, with one of the firm's close reasons (positions doc §6).
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CloseReasonFields, useCloseReason } from '@/components/notices/StagePicker';
import { CLOSE_REASONS } from '@/lib/noticeStages';

const INFORMATIONAL = CLOSE_REASONS.find((r) => r.startsWith('Informational')) ?? '';

const Body: React.FC<{ onCancel: () => void; onClose: (reason: string) => Promise<void>; defaultReason?: string; label?: string }> = ({ onCancel, onClose, defaultReason = INFORMATIONAL, label = 'Close notice' }) => {
  const close = useCloseReason();
  const { setReason } = close;
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (defaultReason) setReason(defaultReason); }, [setReason, defaultReason]);
  const submit = async () => {
    setSaving(true);
    try { await onClose(close.value); } finally { setSaving(false); }
  };
  return (
    <>
      <CloseReasonFields state={close} idPrefix="read-close" />
      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={!close.valid || saving} onClick={submit}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />} {label}
        </Button>
      </DialogFooter>
    </>
  );
};

export const ReadCloseDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Closes the notice with the reason (the page's stage change). */
  onClose: (reason: string) => Promise<void>;
  /** Many notices at once (the list's bulk bar): its own title, no reason chosen in advance. */
  count?: number;
}> = ({ open, onOpenChange, onClose, count }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{count ? `Close ${count} notice${count === 1 ? '' : 's'}` : 'Read and close'}</DialogTitle>
        <DialogDescription>
          {count ? 'Each notice is closed with the reason chosen here, which stays with it. You can undo this right after.'
            : 'This notice type needs no reply. Close it once you have read it; the reason stays with the notice.'}
        </DialogDescription>
      </DialogHeader>
      {open && <Body onCancel={() => onOpenChange(false)} onClose={async (reason) => { await onClose(reason); onOpenChange(false); }}
        defaultReason={count ? '' : undefined} label={count ? `Close ${count}` : undefined} />}
    </DialogContent>
  </Dialog>
);

export default ReadCloseDialog;
