// Fix a failed portal login where it is reported (audit U-51-1 "Update password
// (inline)", U-50-6 "edit in place, stay on the list"): the client's GST portal
// user ID and password, saved to the client record the extension logs in with.
import React, { useEffect, useId, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { WS_BTN } from '@/components/workspace/theme';

export const PortalLoginPopover: React.FC<{
  client: { id: string; name: string; gst_user_id: string | null };
  /** "Update password" for a failed login, "Add portal user ID" when there is none. */
  label: string;
  onSaved: (opts: { retry: boolean }) => void;
  align?: 'start' | 'center' | 'end';
}> = ({ client, label, onSaved, align = 'end' }) => {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(client.gst_user_id ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUserId(client.gst_user_id ?? '');
    setPassword('');
  }, [open, client.gst_user_id]);

  const changed = userId.trim() !== (client.gst_user_id ?? '') || password !== '';
  const save = async () => {
    setSaving(true);
    const patch: { gst_user_id: string | null; gst_password?: string } = { gst_user_id: userId.trim() || null };
    if (password) patch.gst_password = password;
    const { error } = await supabase.from('clients').update(patch).eq('id', client.id);
    setSaving(false);
    if (error) { toast.error(`Couldn't save the portal login: ${error.message}`); return; }
    setOpen(false);
    const canRetry = !!patch.gst_user_id;
    toast.success(`Portal login saved for ${client.name}.`, canRetry ? {
      action: { label: 'Sync now', onClick: () => onSaved({ retry: true }) },
    } : undefined);
    onSaved({ retry: false });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className={WS_BTN}><KeyRound className="h-3.5 w-3.5" aria-hidden /> {label}</Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 space-y-2.5">
        <div>
          <div className="text-sm font-semibold">GST portal login</div>
          <p className="text-xs text-muted-foreground">{client.name}. The next sync logs in with these.</p>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (changed) save(); }}>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-user`} className="text-xs">Portal user ID</Label>
            <Input id={`${uid}-user`} value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-pass`} className="text-xs">New portal password</Label>
            <Input id={`${uid}-pass`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              placeholder={client.gst_user_id ? 'Leave empty to keep the saved one' : ''} className="h-8 text-xs" />
          </div>
          <p className="text-[11px] text-muted-foreground">Ask the client for the password the portal now accepts; three wrong tries lock the portal account.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={!changed || saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};

export default PortalLoginPopover;
