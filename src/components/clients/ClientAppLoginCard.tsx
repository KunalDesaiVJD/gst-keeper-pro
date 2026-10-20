import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import ResetClientPasswordDialog from '@/components/clients/ResetClientPasswordDialog';
import { gstinUnsaved } from '@/lib/clientResetLink';
import {
  CLIENT_PASSWORD_ACTION_LABEL,
  loadClientPasswordLog,
  type ClientPasswordLogEntry,
} from '@/lib/clientPasswordReset';

interface Props {
  clientId: string;
  /** The name and GSTIN as saved: the GSTIN is the client's User ID. */
  name: string;
  gstin: string;
  /** The GSTIN the form shows now; a reset waits until it is saved. */
  typedGstin?: string;
  /** The e-mail address saved on the client (where a link goes). */
  email?: string | null;
  /** The address the form shows now; a link waits until it is saved. */
  typedEmail?: string | null;
}

/** Edit Client: how the client signs in to the app, a reset, and who changed it last. */
const ClientAppLoginCard: React.FC<Props> = ({ clientId, name, gstin, typedGstin, email, typedEmail }) => {
  const { user, canResetClientPasswords } = useAuth();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<ClientPasswordLogEntry[]>([]);
  const actorId = user?.id;
  // A password set now goes on the saved row; with a new GSTIN typed but not
  // saved, the User ID to tell the client is not settled yet.
  const newGstin = gstinUnsaved(gstin, typedGstin);

  const refresh = useCallback(() => {
    if (!actorId) { setLog([]); return; }
    loadClientPasswordLog(actorId, clientId, 6).then(setLog).catch(() => setLog([]));
  }, [actorId, clientId]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SectionCard
      title="Client app login"
      description={<>
        Signs in at /login with the GSTIN <span className="font-mono">{gstin}</span> as User ID. Forgot password e-mails a link to the saved e-mail address.
        {newGstin && canResetClientPasswords() && <> Save the new GSTIN first to reset the password.</>}
      </>}
      actions={canResetClientPasswords() ? (
        <Button type="button" size="sm" variant="outline" className={WS_BTN} disabled={newGstin} onClick={() => setOpen(true)}>
          <KeyRound className="h-3.5 w-3.5" /> Reset app password
        </Button>
      ) : undefined}
    >
      {log.length === 0 ? (
        <p className="text-xs text-muted-foreground">No password changes recorded yet.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {log.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums text-muted-foreground">{format(new Date(l.at), 'dd MMM yyyy, HH:mm')}</span>
              <span className="font-medium">{CLIENT_PASSWORD_ACTION_LABEL[l.action] ?? l.action}</span>
              {l.actor_name && <span className="text-muted-foreground">by {l.actor_name}</span>}
              {l.detail && <span className="min-w-0 break-words text-muted-foreground">· {l.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <ResetClientPasswordDialog
        client={open && !newGstin ? { id: clientId, name, gstin, email, typedEmail } : null}
        onOpenChange={(v) => setOpen(v)}
        onDone={refresh}
      />
    </SectionCard>
  );
};

export default ClientAppLoginCard;
