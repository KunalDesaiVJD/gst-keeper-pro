import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Note } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import { logOrder } from '@/lib/noticeWorkspace';
import { istToday } from '@/lib/noticeFacts';
import { noticeTitle } from '@/lib/noticeFormat';
import type { NoticeRef } from './NoticeContext';

/** Log the officer's order: the notice moves to Order and the appeal clock starts (s.107, computed by the database). */
export const LogOrderDialog: React.FC<{
  notice: NoticeRef;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ notice, open, onOpenChange, onDone }) => {
  const { user } = useAuth();
  const [date, setDate] = useState(istToday());
  const [num, setNum] = useState('');
  const [demand, setDemand] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(istToday());
    setNum('');
    setDemand(notice.amount_of_demand ?? null);
  }, [open, notice.amount_of_demand]);

  const save = async () => {
    if (!user || !date) return;
    setSaving(true);
    try {
      await logOrder(notice.id, { date, number: num.trim() || null, demand }, user);
      toast.success('Order logged — the appeal clock is on the Deadlines tab.');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(`Couldn't log the order: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log order · {notice.client_name}</DialogTitle>
          <DialogDescription>{notice.reference_number || notice.case_id || 'No reference'} · {noticeTitle(notice)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="order-date" className="text-xs">Order dated <span className="text-destructive">*</span></Label>
            <Input id="order-date" type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="order-no" className="text-xs">Order no.</Label>
            <Input id="order-no" value={num} onChange={(e) => setNum(e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="order-demand" className="text-xs">Demand confirmed (₹)</Label>
            <NumberInput id="order-demand" value={demand ?? ''} onChange={(e) => setDemand(e.target.value === '' ? null : Number(e.target.value))} className="h-9" />
          </div>
        </div>
        <Note tone="position">The appeal window runs from the order date (s.107: three months, plus one with condonation). The periods are unconfirmed until the firm confirms them.</Note>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!date || saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Log order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogOrderDialog;
