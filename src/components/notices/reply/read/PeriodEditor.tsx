// The tax period a notice covers, typed by staff when no reader found it (the
// Evidence tab compares returns month by month over it — DRC-01B / DRC-01C
// carry no period on the portal list). Saved as the person who typed it.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { fmtPeriod, monthEnd, monthStart, setPeriod, toMonth } from '@/lib/noticeReading';

export const PeriodEditor: React.FC<{
  noticeId: string;
  from: string | null;
  to: string | null;
  /** The button's text: "Set the period" when missing, "Change" otherwise. */
  label: string;
  prominent?: boolean;
  onSaved: () => void;
}> = ({ noticeId, from, to, label, prominent, onSaved }) => {
  const { user } = useAuth();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(toMonth(from));
  const [b, setB] = useState(toMonth(to));
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setA(toMonth(from)); setB(toMonth(to)); } }, [open, from, to]);

  const save = async () => {
    if (!user) return;
    if (!a || !b) { toast.error('Give the first and the last month.'); return; }
    if (a > b) { toast.error('The first month is after the last.'); return; }
    setBusy(true);
    try {
      await setPeriod(noticeId, a, b, user);
      toast.success(`Tax period set: ${fmtPeriod(monthStart(a), monthEnd(b))}`);
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(`Couldn't save the period: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant={prominent ? 'default' : 'ghost'} className="h-6 px-2 text-[11px]">
          {label}<span className="sr-only"> (tax period)</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="start">
        <div className="text-sm font-medium">Tax period of the notice</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-from`} className="text-xs">First month</Label>
            <Input id={`${id}-from`} type="month" value={a} onChange={(e) => setA(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-to`} className="text-xs">Last month</Label>
            <Input id={`${id}-to`} type="month" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Saved as typed by you. The Evidence tab compares the returns for these months.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={save}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default PeriodEditor;
