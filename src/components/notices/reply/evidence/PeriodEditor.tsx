// Setting the tax period a notice covers, when the notice does not state it
// (DRC-01B and DRC-01C are always for a period) or it was assumed. Saved on the
// notice as the signed-in person; every recipe without its own issue period
// then uses it.
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { setNoticePeriod } from '@/lib/reply';

const toInput = (p: string | undefined) => (p ? `${p.slice(3)}-${p.slice(0, 2)}` : '');
const fromInput = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : '');

export const PeriodEditor: React.FC<{
  noticeId: string;
  idPrefix: string;
  periods: string[];
  onSaved: () => void;
  onCancel?: () => void;
}> = ({ noticeId, idPrefix, periods, onSaved, onCancel }) => {
  const { user } = useAuth();
  const [from, setFrom] = useState(toInput(periods[0]));
  const [to, setTo] = useState(toInput(periods[periods.length - 1]));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!user) return;
    const a = fromInput(from), b = fromInput(to || from);
    if (!a || !b) { toast.error('Pick the first and the last month of the period.'); return; }
    setBusy(true);
    try {
      await setNoticePeriod(noticeId, a, b, user);
      toast.success('Period saved on the notice; the evidence is rebuilding.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-from`} className="text-xs">First month</Label>
        <Input id={`${idPrefix}-from`} type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-to`} className="text-xs">Last month</Label>
        <Input id={`${idPrefix}-to`} type="month" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" />
      </div>
      <Button size="sm" className={WS_BTN} onClick={save} disabled={busy || !from}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save period</Button>
      {onCancel && <Button size="sm" variant="ghost" className={WS_BTN} onClick={onCancel}>Cancel</Button>}
    </div>
  );
};

export default PeriodEditor;
