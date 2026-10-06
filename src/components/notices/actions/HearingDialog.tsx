import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { setHearing } from '@/lib/noticeWorkspace';
import { noticeTitle } from '@/lib/noticeFormat';
import type { NoticeRef } from './NoticeContext';

/** Fix (or clear) the personal hearing: date plus time, venue and officer. */
export const HearingDialog: React.FC<{
  notice: NoticeRef;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ notice, open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(notice.hearing_date ?? '');
    setNote(notice.hearing_note ?? '');
  }, [open, notice.hearing_date, notice.hearing_note]);

  const save = async (clear = false) => {
    if (!user) return;
    setSaving(true);
    try {
      await setHearing(notice.id, clear ? { date: null, note: null } : { date: date || null, note: note.trim() || null }, user);
      toast.success(clear ? 'Hearing cleared.' : 'Hearing saved — it is on the calendar and the owner\'s morning list.');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(`Couldn't save the hearing: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Personal hearing · {notice.client_name}</DialogTitle>
          <DialogDescription>{notice.reference_number || notice.case_id || 'No reference'} · {noticeTitle(notice)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="hearing-date" className="text-xs">Hearing on <span className="text-destructive">*</span></Label>
            <Input id="hearing-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hearing-note" className="text-xs">Time, venue, officer</Label>
            <Input id="hearing-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="11:30 · Range III, Ahmedabad · Asst. Commissioner" className="h-9" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {notice.hearing_date && <Button variant="outline" className="mr-auto" onClick={() => save(true)} disabled={saving}>Clear hearing</Button>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save(false)} disabled={!date || saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HearingDialog;
