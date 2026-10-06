import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { logReply } from '@/lib/noticeWorkspace';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, noticeTitle } from '@/lib/noticeFormat';
import type { NoticeRef } from './NoticeContext';

export interface PortalReply { date: string | null; ref: string | null }

/**
 * Log a reply filed on the portal (audit U-30-1/2): titled with the notice it
 * is for, pre-filled from the reply the portal shows in the case folder, and
 * moving the notice to Filed.
 */
export const LogReplyDialog: React.FC<{
  notice: NoticeRef;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  portalReply?: PortalReply | null;
}> = ({ notice, open, onOpenChange, onDone, portalReply }) => {
  const { user } = useAuth();
  const [date, setDate] = useState(istToday());
  const [ref, setRef] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(portalReply?.date || istToday());
    setRef(portalReply?.ref || '');
  }, [open, portalReply]);

  const save = async () => {
    if (!user || !date) return;
    setSaving(true);
    try {
      await logReply(notice.id, { date, ref: ref.trim() || null, arn: ref.trim() || null }, user);
      toast.success('Reply logged — the notice is now Filed.');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(`Couldn't log the reply: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log reply · {notice.client_name}</DialogTitle>
          <DialogDescription>
            {notice.reference_number || notice.case_id || 'No reference'} · {noticeTitle(notice)}
            {notice.effective_due ? ` · due ${fmtDate(notice.effective_due)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {portalReply && (portalReply.date || portalReply.ref) && (
          <Note tone="info">Filled from the reply the portal shows in this case's folder — check it.</Note>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="reply-date" className="text-xs">Filed on <span className="text-destructive">*</span></Label>
            <Input id="reply-date" type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reply-ref" className="text-xs">ARN / acknowledgement no.</Label>
            <Input id="reply-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. AD2410260012345" className="h-9 font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!date || saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Log reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogReplyDialog;
