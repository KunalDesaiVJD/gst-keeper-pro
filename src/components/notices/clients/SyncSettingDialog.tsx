// Change whether chosen clients are synced (audit U-53-1..3): names the clients,
// says exactly which setting changes and what it does to Sync now, the
// freshness count and Filing Status, and starts with nothing chosen.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { plural } from '@/lib/noticeFormat';

type Choice = 'include' | 'exclude' | 'inactive' | 'active';

const CHOICES: { key: Choice; label: string; effect: string }[] = [
  { key: 'exclude', label: 'Exclude from notices sync', effect: 'Sync now skips them and they leave the freshness count. Their notices stay. Filing Status is not affected.' },
  { key: 'include', label: 'Include in notices sync', effect: 'Sync now picks them up again (if they have a portal user ID and are active).' },
  { key: 'inactive', label: 'Mark inactive at hand', effect: 'Firm-wide: also hides them from Filing Status. Sync now skips them until they are made active.' },
  { key: 'active', label: 'Mark active', effect: 'Shows them in Filing Status again; synced unless excluded.' },
];

const PATCH: Record<Choice, { notices_sync_excluded?: boolean; inactive_at_hand?: boolean }> = {
  exclude: { notices_sync_excluded: true },
  include: { notices_sync_excluded: false },
  inactive: { inactive_at_hand: true },
  active: { inactive_at_hand: false },
};

export const SyncSettingDialog: React.FC<{
  clients: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ clients, open, onOpenChange, onDone }) => {
  const uid = useId();
  const [choice, setChoice] = useState<Choice | ''>('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setChoice(''); }, [open]);

  const apply = async () => {
    if (!choice) return;
    setSaving(true);
    const { error } = await supabase.from('clients').update(PATCH[choice]).in('id', clients.map((c) => c.id));
    setSaving(false);
    if (error) { toast.error(`Couldn't change the setting: ${error.message}`); return; }
    toast.success(`${CHOICES.find((c) => c.key === choice)?.label} · ${plural(clients.length, 'client')}`);
    onOpenChange(false);
    onDone();
  };

  const shown = clients.slice(0, 8);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sync setting for {plural(clients.length, 'client')}</DialogTitle>
          <DialogDescription>
            {shown.map((c) => c.name).join(', ')}{clients.length > shown.length ? ` and ${clients.length - shown.length} more` : ''}.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as Choice)} aria-label="What to change" className="space-y-1.5">
          {CHOICES.map((c) => (
            <Label key={c.key} htmlFor={`${uid}-${c.key}`}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem id={`${uid}-${c.key}`} value={c.key} className="mt-0.5" />
              <span><span className="font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.effect}</span></span>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!choice || saving || clients.length === 0}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />} Apply to {plural(clients.length, 'client')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SyncSettingDialog;
