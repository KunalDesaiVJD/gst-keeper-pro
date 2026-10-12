// "Not required": a superadmin or GST manager hides one notice from every list,
// count and e-mail (notice_exclude, 20261014110000); the rest of its case stays.
// Brought back from Notices · Settings, Hidden.
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { excludeNotice } from '@/lib/noticeCases';

const REASONS = ['Not required', 'Duplicate of another notice', 'Handled by another CA', 'Informational only'];

export const NoticeExcludeDialog: React.FC<{ noticeId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }> = ({ noticeId, open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await excludeNotice(noticeId, true, reason.trim(), { id: user.id, firstName: user.firstName });
      toast.success('Hidden: the notice is out of every list.');
      onOpenChange(false);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hide this notice</DialogTitle>
          <DialogDescription>It leaves every dashboard, list, count and e-mail. The rest of its case stays. Bring it back from Notices · Settings.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={`rounded-full border px-2.5 py-1 text-xs ${reason === r ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{r}</button>
          ))}
        </div>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} aria-label="Reason" className="text-sm" />
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || !reason.trim()} onClick={save}>{busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Hide notice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NoticeExcludeDialog;
