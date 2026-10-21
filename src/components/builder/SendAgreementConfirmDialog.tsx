import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/gstr9/badge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { formatINR } from '@/utils/builderRates';
import {
  fetchAgreementConfirmationStatus, fetchClientEmails, isFirmAddress, parseEmailList, requestAgreementConfirmations,
  type AgreementConfirmRequest, type AgreementConfirmStatus, type AgreementConfirmUnit, type AnsweredMeanwhile,
} from '@/lib/builderAgreementConfirmData';
import { freshCandidates } from '@/lib/builderConfirmRules';

/**
 * BU Events → "Send confirmation request": one e-mail to everyone typed in To
 * and CC, listing the units still outstanding (pending, disputed or never
 * sent). Staff may untick any. Anyone the e-mail goes to, outside the firm,
 * can answer on the page it links to (src/pages/AgreementConfirmPage.tsx).
 * The statuses are read again each time the pop-up opens, so a unit answered
 * since BU Events loaded is not offered.
 */
export interface ConfirmCandidate extends AgreementConfirmUnit {
  status: AgreementConfirmStatus['status'];
  disputeNotes?: string | null;
  respondedByName?: string | null;
}

const STATUS_LABEL: Partial<Record<AgreementConfirmStatus['status'], string>> = {
  NOT_SENT: 'Not sent', PENDING: 'Pending', DISPUTED: 'Disputed',
};

/** "A-101 (confirmed by Rajesh Shah, rajesh@client.com)". */
const answeredWords = (a: AnsweredMeanwhile) => `${a.unitNo} (${a.status === 'OVERRIDDEN' ? 'accepted by the firm' : 'confirmed'}`
  + `${a.respondedByName ? ` by ${a.respondedByName}${a.respondedByEmail ? `, ${a.respondedByEmail}` : ''}` : ''})`;

const SendAgreementConfirmDialog: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  projectName: string;
  event: { id: string; buDate: string; dastavej: boolean } | null;
  candidates: ConfirmCandidate[];
  lastRequest: AgreementConfirmRequest | null;
  onSent: () => void;
}> = ({ open, onOpenChange, clientId, projectName, event, candidates, lastRequest, onSent }) => {
  const { user } = useAuth();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [toEdited, setToEdited] = useState(false);
  const [fromMaster, setFromMaster] = useState<boolean | null>(null);
  const [masterInvalid, setMasterInvalid] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<AgreementConfirmStatus[] | null>(null);
  const [loadingTo, setLoadingTo] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [sending, setSending] = useState(false);

  const eventId = event?.id;
  // The units' statuses now, not as the page loaded them: a reader may have
  // answered since.
  const reloadUnits = useCallback(async () => {
    if (!eventId) return;
    setLoadingUnits(true);
    try {
      setFresh(await fetchAgreementConfirmationStatus(eventId));
    } catch {
      setFresh(null);
    } finally {
      setLoadingUnits(false);
    }
  }, [eventId]);

  // Fill the boxes each time the pop-up opens: the last request's people when
  // there was one, else the client master's e-mail.
  useEffect(() => {
    if (!open || !eventId) return;
    let live = true;
    setSelected(new Set(candidates.map((c) => c.unitId)));
    setFresh(null);
    setToEdited(false);
    setMasterInvalid([]);
    void reloadUnits();
    if (lastRequest) {
      setTo(lastRequest.to.join(', '));
      setCc(lastRequest.cc.join(', '));
      setFromMaster(null);
      return;
    }
    setTo('');
    setCc('');
    setLoadingTo(true);
    fetchClientEmails(clientId)
      .then((list) => {
        if (!live) return;
        setTo(list.valid.join(', '));
        setFromMaster(list.valid.length > 0);
        setMasterInvalid(list.invalid);
      })
      .catch(() => { if (live) setFromMaster(false); })
      .finally(() => { if (live) setLoadingTo(false); });
    return () => { live = false; };
    // Only when the pop-up opens for an event: later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  const shown = useMemo(() => freshCandidates(candidates, fresh), [candidates, fresh]);
  const droppedSinceLoad = candidates.length - shown.length;
  const toList = useMemo(() => parseEmailList(to), [to]);
  const ccList = useMemo(() => parseEmailList(cc), [cc]);
  const ccOnly = ccList.valid.filter((a) => !toList.valid.includes(a));
  const firmCopies = [...toList.valid, ...ccOnly].filter(isFirmAddress);
  const outsideFirm = [...toList.valid, ...ccOnly].filter((a) => !isFirmAddress(a));
  const ticked = shown.filter((c) => selected.has(c.unitId));
  const total = ticked.reduce((a, c) => a + (Number(c.agreementValue) || 0), 0);
  const allTicked = ticked.length === shown.length && shown.length > 0;

  const problem = !toList.valid.length && !toList.invalid.length
    ? 'Enter at least one To address.'
    : toList.invalid.length ? `Not a valid To address: ${toList.invalid.join(', ')}`
      : ccList.invalid.length ? `Not a valid CC address: ${ccList.invalid.join(', ')}`
        : toList.valid.length > 20 || ccOnly.length > 20 ? 'At most 20 addresses in To and 20 in CC.'
          : !outsideFirm.length ? 'Add at least one address outside the firm. The firm\'s own addresses cannot answer.'
            : !ticked.length ? 'Tick at least one unit.'
              : null;

  const send = async () => {
    if (!event) return;
    if (problem) { toast.error(problem); return; }
    setSending(true);
    try {
      const res = await requestAgreementConfirmations({
        buEventId: event.id,
        clientId,
        projectName,
        buDate: event.buDate,
        dastavejEvent: event.dastavej,
        staffName: user?.firstName ?? null,
        userId: user?.id ?? null,
        to: toList.valid,
        cc: ccOnly,
        units: ticked,
      });
      if (res.skipped.length) {
        toast.info(`Answered meanwhile, so left out: ${res.skipped.map(answeredWords).join('; ')}.`);
      }
      const who = `${toList.valid.join(', ')}${ccOnly.length ? ` (CC ${ccOnly.join(', ')})` : ''}`;
      const what = `${res.sent} unit${res.sent === 1 ? '' : 's'}`;
      if (res.ok) {
        toast.success(`Confirmation request for ${what} sent to ${who}.`);
      } else if (res.status === 'answered') {
        toast.info('Every ticked unit was answered meanwhile. Nothing was sent.');
      } else if (!res.requestId) {
        // Refused before anything was written: keep the pop-up open to fix it,
        // with the units as they stand now.
        toast.error(`Not sent: ${res.reason || res.status}`);
        onSent();
        void reloadUnits();
        return;
      } else if (res.status === 'pending') {
        toast.warning(`Queued for ${what}, but not sent yet: it goes out with the next send run. ${res.reason || ''}`);
      } else if (res.status === 'sending' || res.status === 'unknown') {
        // It may have gone: never invite a second click that sends it twice.
        toast.warning('The send did not report back. Check the e-mail on the Reminders page before sending again.');
      } else {
        toast.error(`The request is recorded but the e-mail failed: ${res.reason || res.status}. `
          + 'The earlier link still takes answers until an e-mail goes out. Fix the address and send again.');
      }
      onOpenChange(false);
      onSent();
    } catch (e) {
      toast.error(`Not sent: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const toggle = (unitId: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(unitId); else next.delete(unitId);
    return next;
  });

  const toSource = toEdited ? '' : lastRequest ? ', as on the last request' : fromMaster ? ', from the client master' : '';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send confirmation request</DialogTitle>
          <DialogDescription>
            {projectName}. One e-mail goes to everyone below, with one link. Anyone it goes to can confirm or
            dispute the values on that page, giving their name and the address it reached them at. The firm's
            own addresses get a copy but cannot answer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="bu-cf-to">To</Label>
            <Input
              id="bu-cf-to" value={to} onChange={(e) => { setTo(e.target.value); setToEdited(true); }}
              placeholder={loadingTo ? 'Loading…' : 'owner@client.com, accounts@client.com'}
              aria-invalid={toList.invalid.length > 0}
            />
            {toList.invalid.length > 0 ? (
              <p className="text-[11px] text-destructive">Not valid: {toList.invalid.join(', ')}</p>
            ) : !toList.valid.length && fromMaster === false ? (
              <p className="text-[11px] text-destructive">The client has no e-mail on record: type it here (and add it in Edit Client).</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {toList.valid.length} address{toList.valid.length === 1 ? '' : 'es'}{toSource}.
                Separate addresses with commas or semicolons. "Name &lt;address&gt;" is fine.
              </p>
            )}
            {!toEdited && masterInvalid.length > 0 && (
              <p className="text-[11px] text-destructive">
                Left out from the client master (not a valid address): {masterInvalid.join(', ')}. Correct it in Edit Client.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="bu-cf-cc">CC (optional)</Label>
            <Input
              id="bu-cf-cc" value={cc} onChange={(e) => setCc(e.target.value)}
              placeholder="director@client.com, accounts@client.com"
              aria-invalid={ccList.invalid.length > 0}
            />
            {ccList.invalid.length > 0 ? (
              <p className="text-[11px] text-destructive">Not valid: {ccList.invalid.join(', ')}</p>
            ) : ccList.valid.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {ccOnly.length} address{ccOnly.length === 1 ? '' : 'es'}
                {ccList.valid.length > ccOnly.length ? ` (${ccList.valid.length - ccOnly.length} already in To, sent once)` : ''}.
              </p>
            )}
          </div>
          {firmCopies.length > 0 && (
            <p className={outsideFirm.length ? 'text-[11px] text-muted-foreground' : 'text-[11px] text-destructive'}>
              The firm's own: {firmCopies.join(', ')}. {firmCopies.length === 1 ? 'It gets' : 'They get'} a copy but cannot answer.
              {outsideFirm.length ? '' : ' Add the client\'s address.'}
            </p>
          )}
        </div>

        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
            <span className="font-medium">
              Units to confirm ({ticked.length} of {shown.length})
              {loadingUnits && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
            </span>
            <button
              type="button" className="font-medium text-primary hover:underline"
              onClick={() => setSelected(allTicked ? new Set() : new Set(shown.map((c) => c.unitId)))}
            >
              {allTicked ? 'Untick all' : 'Tick all'}
            </button>
          </div>
          <ul className="max-h-64 divide-y overflow-y-auto text-xs">
            {shown.map((c) => (
              <li key={c.unitId}>
                <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(c.unitId)}
                    onCheckedChange={(v) => toggle(c.unitId, v === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.unitNo}</span>{' '}
                    <Badge
                      variant={c.status === 'DISPUTED' ? 'destructive' : c.status === 'PENDING' ? 'warning' : 'secondary'}
                      className="ml-1 text-[10px] font-medium"
                    >
                      {STATUS_LABEL[c.status] || c.status}
                    </Badge>
                    {c.status === 'DISPUTED' && c.disputeNotes && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {c.respondedByName ? `${c.respondedByName}: ` : ''}{c.disputeNotes}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatINR(c.agreementValue)}</span>
                </label>
              </li>
            ))}
            {!shown.length && !loadingUnits && (
              <li className="px-3 py-2 text-muted-foreground">Every unit is confirmed or accepted. Nothing is left to ask.</li>
            )}
          </ul>
          <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs font-medium">
            <span>Total of ticked units</span>
            <span className="tabular-nums">{formatINR(total)}</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Confirmed and accepted units are not listed
          {droppedSinceLoad > 0 ? ` (${droppedSinceLoad} answered since this page loaded)` : ''}. Sending again
          replaces the earlier link for the ticked units; answers already given on other units stay. A unit left
          unticked still holds up posting and filing until it is asked or accepted.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button
            onClick={() => void send()}
            disabled={sending || loadingTo || loadingUnits || !!problem}
            title={problem || undefined}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending…' : `Send for ${ticked.length} unit${ticked.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SendAgreementConfirmDialog;
