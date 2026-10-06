// Deleting a client from the notices list (audit U-50-3): one client at a time,
// from the row menu, after typing its GSTIN. A client with notices or matters
// cannot be deleted at all (the database refuses); the message says so.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { describeClientDeleteError } from '@/lib/clientDeleteError';

export const DeleteClientDialog: React.FC<{
  client: { id: string; name: string; gstin: string } | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}> = ({ client, onOpenChange, onDone }) => {
  const uid = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTyped(''); }, [client]);

  const ok = !!client && typed.trim().toUpperCase() === client.gstin.toUpperCase();
  const remove = async () => {
    if (!client || !ok) return;
    setBusy(true);
    const { error } = await supabase.from('clients').delete().eq('id', client.id);
    setBusy(false);
    if (error) { toast.error(`Not deleted: ${describeClientDeleteError(error)}`); return; }
    toast.success(`${client.name} deleted.`);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={!!client} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {client?.name}?</DialogTitle>
          <DialogDescription>
            This removes the client and its sync history, refunds and DRC-03 records for good. A client with notices or litigation
            matters on record cannot be deleted; mark it inactive instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor={`${uid}-gstin`} className="text-xs">Type the GSTIN <span className="font-mono">{client?.gstin}</span> to confirm</Label>
          <Input id={`${uid}-gstin`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-9 font-mono text-sm" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={remove} disabled={!ok || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />} Delete client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteClientDialog;
