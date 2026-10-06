import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/contexts/AuthContext';
import { addComment, setExtension } from '@/lib/noticeWorkspace';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, noticeTitle } from '@/lib/noticeFormat';
import type { NoticeRef } from './NoticeContext';

/**
 * Time to reply: record that an extension was asked for (Activity), or that the
 * officer granted one (the extended date then drives every due date — U-42-2).
 */
export const ExtensionDialog: React.FC<{
  notice: NoticeRef;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ notice, open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const [mode, setMode] = useState<'requested' | 'granted'>('requested');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(notice.extended_due_date ? 'granted' : 'requested');
    setDate(notice.extended_due_date ?? istToday());
    setNote('');
  }, [open, notice.extended_due_date]);

  const save = async (clear = false) => {
    if (!user) return;
    setSaving(true);
    try {
      if (clear) await setExtension(notice.id, null, user);
      else if (mode === 'granted') await setExtension(notice.id, date, user);
      else await addComment(notice, `Extension requested on ${fmtDate(date)}${note.trim() ? ` — ${note.trim()}` : ''}`, user, 'extension_requested');
      toast.success(clear ? 'Extension removed.' : mode === 'granted' ? `Due date extended to ${fmtDate(date)}.` : 'Extension request recorded.');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extension · {notice.client_name}</DialogTitle>
          <DialogDescription>
            {noticeTitle(notice)} · {notice.due_date ? `original due ${fmtDate(notice.due_date)}` : 'no portal due date'}
            {notice.extended_due_date ? ` · extended to ${fmtDate(notice.extended_due_date)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(v) => { setMode(v as 'requested' | 'granted'); if (v === 'requested') setDate(istToday()); }} className="space-y-1">
          <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="requested" /> We asked the officer for more time</Label>
          <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="granted" /> The officer granted more time</Label>
        </RadioGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ext-date" className="text-xs">{mode === 'granted' ? 'New due date' : 'Asked on'} <span className="text-destructive">*</span></Label>
            <Input id="ext-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          {mode === 'requested' && (
            <div className="space-y-1">
              <Label htmlFor="ext-note" className="text-xs">Note</Label>
              <Input id="ext-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 15 days asked" className="h-9" />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {notice.extended_due_date && <Button variant="outline" className="mr-auto" onClick={() => save(true)} disabled={saving}>Remove extension</Button>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save(false)} disabled={!date || saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ExtensionDialog;
