import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Clients page: set the service categories (Edit Client → Services,
 * 20261121100000) of many clients at once. Each service is left as it is,
 * ticked or unticked for every selected client.
 */
export interface ServiceFlags {
  id: string;
  returns_filing: boolean;
  annual_return_assigned: boolean;
  notices_handled: boolean;
}

type Choice = 'keep' | 'on' | 'off';
type Col = 'returns_filing' | 'annual_return_assigned' | 'notices_handled';

const SERVICES: { col: Col; label: string }[] = [
  { col: 'returns_filing', label: 'Returns filing' },
  { col: 'annual_return_assigned', label: 'GSTR-9 / 9C' },
  { col: 'notices_handled', label: 'Notices & Litigation' },
];

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'keep', label: 'Leave as is' },
  { value: 'on', label: 'Tick' },
  { value: 'off', label: 'Untick' },
];

const BulkServicesDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ServiceFlags[];
  onDone: () => void;
}> = ({ open, onOpenChange, clients, onDone }) => {
  const [choice, setChoice] = useState<Record<Col, Choice>>({
    returns_filing: 'keep', annual_return_assigned: 'keep', notices_handled: 'keep',
  });
  const [saving, setSaving] = useState(false);

  const after = (c: ServiceFlags, col: Col) => (choice[col] === 'keep' ? c[col] : choice[col] === 'on');
  const leftWithNone = clients.filter((c) => SERVICES.every((s) => !after(c, s.col))).length;
  const nothingChosen = SERVICES.every((s) => choice[s.col] === 'keep');

  const apply = async () => {
    const patch: Partial<Record<Col, boolean>> = {};
    SERVICES.forEach((s) => { if (choice[s.col] !== 'keep') patch[s.col] = choice[s.col] === 'on'; });
    setSaving(true);
    const ids = clients.map((c) => c.id);
    // One statement per 200 ids keeps the request URL short.
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('clients').update(patch).in('id', ids.slice(i, i + 200));
      if (error) {
        setSaving(false);
        toast.error('Could not update services: ' + error.message);
        onDone();
        return;
      }
    }
    setSaving(false);
    toast.success(`Services updated for ${ids.length} client${ids.length === 1 ? '' : 's'}`);
    setChoice({ returns_filing: 'keep', annual_return_assigned: 'keep', notices_handled: 'keep' });
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set services</DialogTitle>
          <DialogDescription>
            For the {clients.length} selected client{clients.length === 1 ? '' : 's'}. Each module lists only the clients ticked for it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {SERVICES.map((s) => {
            const ticked = clients.filter((c) => c[s.col]).length;
            return (
              <div key={s.col} className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-xs text-muted-foreground">ticked now: {ticked} of {clients.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={s.label}>
                  {CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={choice[s.col] === c.value}
                      onClick={() => setChoice((p) => ({ ...p, [s.col]: c.value }))}
                      className={cn(
                        'rounded-md border px-2 py-1.5 text-xs transition-colors',
                        choice[s.col] === c.value ? 'border-primary bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {leftWithNone > 0 && (
            <p className="text-sm text-destructive">
              {leftWithNone} client{leftWithNone === 1 ? ' would' : 's would'} be left with no service and show in no module.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={apply} disabled={saving || nothingChosen || leftWithNone > 0 || clients.length === 0}>
            {saving ? 'Saving…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkServicesDialog;
