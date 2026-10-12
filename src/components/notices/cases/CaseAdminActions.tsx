// Closing a case for good, reopening it, or marking it handled elsewhere (by
// another CA): superadmin and GST manager only, checked again in the database
// (notice_case_close / notice_case_reopen / notice_case_exclude, migration
// 20261013110000). A case handled elsewhere leaves every tile, list and count.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Loader2, MoreHorizontal, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { closeCase, excludeCase, reopenCase } from '@/lib/noticeCases';
import { canManageNoticeTypes } from '@/lib/noticeTypes';

const CLOSE_REASONS = ['No action required', 'Settled: paid and accepted', 'Dropped by the department', 'Time barred', 'Duplicate of another case'];
const ELSEWHERE_REASONS = ['Handled by another CA', 'Handled by the client', 'Not in our engagement'];

export const CaseAdminActions: React.FC<{ clientId: string; caseKey: string; open: boolean }> = ({ clientId, caseKey, open }) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'close' | 'elsewhere' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || !canManageNoticeTypes(user.role)) return null;
  const actor = { id: user.id, firstName: user.firstName };

  const refresh = () => {
    for (const k of ['notice-case', 'notice-cases', 'notice-case-counts', 'notice-case-items', 'notice-case-advice', 'notices-command-centre']) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  const run = async (what: () => Promise<void>, done: string, after?: () => void) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      setDialog(null);
      refresh();
      after?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const openDialog = (d: 'close' | 'elsewhere') => { setReason(d === 'close' ? CLOSE_REASONS[0] : ELSEWHERE_REASONS[0]); setDialog(d); };

  return (
    <>
      {open ? (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => openDialog('close')}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Close case
        </Button>
      ) : (
        <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => run(() => reopenCase(clientId, caseKey, actor), 'Case reopened')}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className={WS_BTN} aria-label="More case actions"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openDialog('elsewhere')}><Ban className="mr-2 h-4 w-4" /> Handled elsewhere (hide everywhere)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === 'close' ? 'Close the case' : 'Handled elsewhere'}</DialogTitle>
            <DialogDescription>
              {dialog === 'close'
                ? 'Every open notice of the case is closed with this reason. No appeal or reply is offered on a closed case; reopen it if something comes up.'
                : 'The case leaves every dashboard, list, count and e-mail, and so does anything that arrives in it later. Bring it back from Notices · Settings.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {(dialog === 'close' ? CLOSE_REASONS : ELSEWHERE_REASONS).map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={`rounded-full border px-2.5 py-1 text-xs ${reason === r ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{r}</button>
            ))}
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} aria-label="Reason" className="text-sm" />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={busy || !reason.trim()}
              onClick={() => dialog === 'close'
                ? run(() => closeCase(clientId, caseKey, reason.trim(), actor), 'Case closed')
                : run(() => excludeCase(clientId, caseKey, true, reason.trim(), actor), 'Hidden: handled elsewhere', () => navigate('/notices-cases'))}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {dialog === 'close' ? 'Close case' : 'Hide the case'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CaseAdminActions;
