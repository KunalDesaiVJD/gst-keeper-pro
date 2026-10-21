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
  fetchAgreementConfirmationStatus, fetchClientEmails, fetchFirmAddresses, isFirmAddress, parseEmailList,
  requestAgreementConfirmations,
  type AgreementConfirmRequest, type AgreementConfirmStatus, type AgreementConfirmUnit, type AnsweredMeanwhile,
} from '@/lib/builderAgreementConfirmData';
import {
  askedMeanwhile, failedMailWords, freshCandidates, mailOutcome, masterState, meanwhileHeading, meanwhileWords, seenFor,
  unitAsk,
} from '@/lib/builderConfirmRules';

/**
 * BU Events → "Send confirmation request": one e-mail to everyone typed in To
 * and CC, listing the units still outstanding (pending, disputed or never
 * sent). Staff may untick any. Anyone the e-mail goes to, outside the firm,
 * can answer on the page it links to (src/pages/AgreementConfirmPage.tsx),
 * after proving their address with a code. The statuses are read again each
 * time the pop-up opens and sent with the send: a unit answered since is
 * never asked over its answer (a dispute stops the send and is shown here),
 * and a colleague's request about a unit sent meanwhile is shown, with its To
 * and CC, rather than replaced unseen.
 */
export interface ConfirmCandidate extends AgreementConfirmUnit {
  status: AgreementConfirmStatus['status'];
  disputeNotes?: string | null;
  respondedByName?: string | null;
  respondedByEmail?: string | null;
  respondedAt?: string | null;
  /** The request the unit is on (null: none, or a per-unit e-mail). */
  requestId?: string | null;
  /** A per-unit e-mail of before 21 Oct 2026 asked about it. */
  legacyLink?: boolean;
}

const STATUS_LABEL: Partial<Record<AgreementConfirmStatus['status'], string>> = {
  NOT_SENT: 'Not sent', PENDING: 'Pending', DISPUTED: 'Disputed',
};

/** "A-101 (confirmed by Rajesh Shah, rajesh@client.com)", or "A-101 (asked
 *  meanwhile in another request to priya@client.com)". */
const answeredWords = (a: AnsweredMeanwhile) => meanwhileWords(a);

const SendAgreementConfirmDialog: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  projectName: string;
  event: { id: string; buDate: string; dastavej: boolean } | null;
  candidates: ConfirmCandidate[];
  lastRequest: AgreementConfirmRequest | null;
  /** The event's requests, newest first: whether each unit's e-mail went out. */
  requests: AgreementConfirmRequest[];
  onSent: () => void;
}> = ({ open, onOpenChange, clientId, projectName, event, candidates, lastRequest, requests, onSent }) => {
  const { user } = useAuth();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [toEdited, setToEdited] = useState(false);
  const [master, setMaster] = useState<ReturnType<typeof masterState>>(null);
  const [masterInvalid, setMasterInvalid] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<AgreementConfirmStatus[] | null>(null);
  const [loadingTo, setLoadingTo] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [sending, setSending] = useState(false);
  // Typed addresses the database counts as the firm's (a staff member's own
  // address, which the browser cannot tell).
  const [dbFirm, setDbFirm] = useState<string[]>([]);
  // Units answered (a dispute above all) after the pop-up read them: the send
  // stopped; shown until the next send.
  const [changedNotice, setChangedNotice] = useState<AnsweredMeanwhile[]>([]);

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
    setChangedNotice([]);
    setDbFirm([]);
    void reloadUnits();
    if (lastRequest) {
      setTo(lastRequest.to.join(', '));
      setCc(lastRequest.cc.join(', '));
      setMaster(null);
      return;
    }
    setTo('');
    setCc('');
    setLoadingTo(true);
    fetchClientEmails(clientId)
      .then((list) => {
        if (!live) return;
        setTo(list.valid.join(', '));
        setMaster(masterState(list));
        setMasterInvalid(list.invalid);
      })
      .catch(() => { if (live) setMaster(null); })
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
  const everyone = [...toList.valid, ...ccOnly];
  const everyoneKey = everyone.join(',');
  const userId = user?.id ?? null;
  // Ask the database which typed addresses are the firm's own, a moment after typing stops.
  useEffect(() => {
    if (!open || !everyoneKey) { setDbFirm([]); return; }
    let live = true;
    const t = window.setTimeout(() => {
      fetchFirmAddresses(userId, everyoneKey.split(',')).then((list) => { if (live) setDbFirm(list); });
    }, 400);
    return () => { live = false; window.clearTimeout(t); };
  }, [open, everyoneKey, userId]);
  const isFirm = (a: string) => isFirmAddress(a) || dbFirm.includes(a);
  const firmCopies = everyone.filter(isFirm);
  const outsideFirm = everyone.filter((a) => !isFirm(a));
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
  // Already said in red under the box it belongs to (To, CC, the firm's own)
  // or by the unit list; otherwise shown above the buttons, since a disabled
  // button shows no tooltip.
  const problemShown = !!problem && (
    toList.invalid.length > 0 || ccList.invalid.length > 0
    || (!toList.valid.length && master === 'empty')
    || (everyone.length > 0 && !outsideFirm.length)
    || (!ticked.length && !shown.length));

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
        seen: seenFor(ticked),
      });
      if (res.skipped.length) {
        toast.info(`Answered meanwhile, so left out: ${res.skipped.map(answeredWords).join('; ')}.`);
      }
      if (res.status === 'changed') {
        // A dispute given since the pop-up read the units, or a colleague's
        // request about one: nothing was sent. Show it, untick it, and let
        // staff decide.
        setChangedNotice(res.changed);
        setSelected((prev) => {
          const next = new Set(prev);
          res.changed.forEach((c) => next.delete(c.unitId));
          return next;
        });
        const one = res.changed.length === 1;
        toast.warning(`Not sent. Since this pop-up opened: ${res.changed.map(answeredWords).join('; ')}. `
          + `Read it below. ${one ? 'It is' : 'They are'} unticked now: send for the others, or tick ${one ? 'it' : 'them'} to ask again.`);
        onSent();
        void reloadUnits();
        return;
      }
      const who = `${toList.valid.join(', ')}${ccOnly.length ? ` (CC ${ccOnly.join(', ')})` : ''}`;
      const what = `${res.sent} unit${res.sent === 1 ? '' : 's'}`;
      const cancelled = res.cancelledEarlier
        ? ` The earlier e-mail still waiting to go was cancelled${res.cancelledEarlier > 1 ? ` (${res.cancelledEarlier})` : ''}.`
        : '';
      if (res.ok) {
        toast.success(`Confirmation request for ${what} sent to ${who}.${cancelled}`);
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
        toast.warning(`Queued for ${what}, but not sent yet: it goes out with the next send run. ${res.reason || ''}${cancelled}`);
      } else if (res.status === 'sending' || res.status === 'unknown') {
        // It may have gone: never invite a second click that sends it twice.
        toast.warning('The send did not report back. Check the e-mail on the Reminders page before sending again.');
      } else {
        const sentNos = ticked.filter((c) => !res.skipped.some((k) => k.unitId === c.unitId)).map((c) => c.unitNo);
        toast.error(`The request is recorded but the e-mail failed: ${(res.reason || res.status).trim().replace(/[.\s]+$/, '')}. `
          + `${failedMailWords(res.earlierLink, sentNos)} Fix the address and send again.`);
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

  const toSource = toEdited ? '' : lastRequest ? ', as on the last request' : master === 'ok' ? ', from the client master' : '';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send confirmation request</DialogTitle>
          <DialogDescription>
            {projectName}. One e-mail goes to everyone below, with one link. Anyone it goes to can confirm or
            dispute the values on that page, with their name and the address it reached them at; a code e-mailed
            to that address proves it is theirs. The firm's own addresses get a copy but cannot answer.
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
            ) : !toList.valid.length && master === 'empty' ? (
              <p className="text-[11px] text-destructive">The client has no e-mail on record: type it here (and add it in Edit Client).</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {toList.valid.length} address{toList.valid.length === 1 ? '' : 'es'}{toSource}.
                Separate addresses with commas or semicolons. "Name &lt;address&gt;" is fine.
              </p>
            )}
            {!toEdited && lastRequest && mailOutcome(lastRequest.mailStatus) === 'failed' && (
              <p className="text-[11px] text-destructive [overflow-wrap:anywhere]">
                The last e-mail to these addresses failed
                {lastRequest.mailError ? `: ${lastRequest.mailError.trim().replace(/[.\s]+$/, '')}` : ''}. Check them before sending.
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

        {changedNotice.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">{meanwhileHeading(changedNotice)}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {changedNotice.map((c) => (
                <li key={c.unitId}>
                  {answeredWords(c)}{c.disputeNotes ? `: ${c.disputeNotes}` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              {changedNotice.length === 1 ? 'It is' : 'They are'} unticked. Send for the others
              {changedNotice.some((c) => c.status === 'DISPUTED')
                ? ', or tick a disputed unit to ask again once the working is right (that clears the dispute; it stays in the unit\'s history)'
                : ''}
              .
              {changedNotice.some(askedMeanwhile)
                && ' A unit asked in another request waits on that e-mail. Tick it only to ask again here: once this e-mail is out, that link stops taking answers for it.'}
            </p>
          </div>
        )}

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
            {shown.map((c) => {
              // Pending, but did its e-mail go out? (round 4)
              const ask = unitAsk(c.unitId, c, requests);
              const notOut = ask && ask.state !== 'asked' ? ask : null;
              return (
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
                        variant={c.status === 'DISPUTED' || notOut?.state === 'failed' ? 'destructive'
                          : c.status === 'PENDING' ? 'warning' : 'secondary'}
                        className="ml-1 text-[10px] font-medium"
                      >
                        {STATUS_LABEL[c.status] || c.status}
                        {notOut ? (notOut.state === 'failed' ? ' · e-mail failed' : ' · not sent yet') : ''}
                      </Badge>
                      {notOut && (
                        <span className={`mt-0.5 block text-[11px] [overflow-wrap:anywhere] ${notOut.state === 'failed'
                          ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}`}>
                          {notOut.state === 'failed'
                            ? `Its e-mail failed${notOut.error ? `: ${notOut.error.trim().replace(/[.\s]+$/, '')}` : ''}.`
                            : 'Its e-mail is queued and has not gone yet.'}
                          {notOut.earlier?.kind === 'request'
                            ? ' The link e-mailed before still takes answers.'
                            : notOut.earlier?.kind === 'legacy'
                              ? ' The per-unit link e-mailed before still takes answers.'
                              : notOut.state === 'failed' ? ' The client was never asked about it.' : ''}
                        </span>
                      )}
                      {c.status === 'DISPUTED' && c.disputeNotes && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {c.respondedByName ? `${c.respondedByName}: ` : ''}{c.disputeNotes}
                        </span>
                      )}
                      {c.status === 'DISPUTED' && selected.has(c.unitId) && (
                        <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-400">
                          Sending asks again and clears this dispute. It stays in the unit's history.
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatINR(c.agreementValue)}</span>
                  </label>
                </li>
              );
            })}
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
          {droppedSinceLoad > 0 ? ` (${droppedSinceLoad} answered since this page loaded)` : ''}. Once the new
          e-mail is out, the earlier link no longer takes answers for the ticked units; answers already given on
          other units stay. A unit left unticked still holds up posting and filing until it is asked or accepted.
        </p>

        {problem && !problemShown && (
          <p className="text-xs text-destructive" role="alert">{problem}</p>
        )}

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
