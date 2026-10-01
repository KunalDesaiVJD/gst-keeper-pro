import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileUp, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addSetOff, loadDrc03s, uploadEvidence } from '@/lib/gstr9/store';
import { drc03Available, drc03MatchesFY, GSTR3B_TABLES, SIDE_LABEL, type PayableSide, type SetOffMethod } from '@/lib/gstr9/payables';
import type { Tax } from '@/lib/gstr9/types';
import { fmtMoney, parsePlain } from '../grid/money';
import { Note } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { useExtensionBridge } from '../portal/useExtensionBridge';
import { rupees, sumTax } from '../overview/steps';

const HEADS: Array<[keyof Tax, string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST'], ['x', 'Cess']];
const RUPEE_TOLERANCE = 1;
const POLL_MS = 10_000;
const POLL_MAX = 36;

const minT = (a: Tax, b: Tax): Tax => ({ i: Math.min(a.i, b.i), c: Math.min(a.c, b.c), s: Math.min(a.s, b.s), x: Math.min(a.x, b.x) });
const clamp0 = (a: Tax): Tax => ({ i: Math.max(a.i, 0), c: Math.max(a.c, 0), s: Math.max(a.s, 0), x: Math.max(a.x, 0) });
const round2 = (n: number) => Math.round(n * 100) / 100;
const toText = (t: Tax): Record<keyof Tax, string> => ({ i: t.i ? String(round2(t.i)) : '', c: t.c ? String(round2(t.c)) : '', s: t.s ? String(round2(t.s)) : '', x: t.x ? String(round2(t.x)) : '' });

/** "MM/YYYY" from April of the FY to March two years later, newest first. */
const periodsFrom = (fy: string): string[] => {
  const start = Number(fy.slice(0, 4));
  const out: string[] = [];
  for (let k = 0; k < 36; k++) {
    const m = ((3 + k) % 12) + 1;
    const y = start + Math.floor((3 + k) / 12);
    out.push(`${String(m).padStart(2, '0')}/${y}`);
  }
  return out.reverse();
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Record how a payable was set off. Only two ways are accepted, and each needs
 * its evidence in the system (the database refuses anything less):
 *  - a DRC-03 imported into the system — picked from the DRC-03s synced from
 *    the portal, or imported here by uploading its copy with ARN and date;
 *  - an effect given in a GSTR-3B — its return period, filing date, the table
 *    it went into, and the filed GSTR-3B's copy.
 */
export const SetOffDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; initialSide?: PayableSide }> = ({ open, onOpenChange, initialSide }) => {
  const { client, financialYear, workings: w, setOffs, drc03s, reloadPayables, userName } = useWorkspace();
  const bridge = useExtensionBridge(client.id);
  const [side, setSide] = useState<PayableSide>(initialSide ?? 'output');
  const [method, setMethod] = useState<SetOffMethod>('drc03');
  const [drcMode, setDrcMode] = useState<'synced' | 'upload'>('synced');
  const [drc03Id, setDrc03Id] = useState<string>('');
  const [reference, setReference] = useState('');
  const [docDate, setDocDate] = useState('');
  const [period, setPeriod] = useState('');
  const [table, setTable] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [amounts, setAmounts] = useState<Record<keyof Tax, string>>({ i: '', c: '', s: '', x: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const outstanding = w.payables[side].balance;
  const periods = useMemo(() => periodsFrom(financialYear), [financialYear]);
  const drcList = useMemo(() => {
    const withLeft = drc03s.map((d) => ({ d, left: drc03Available(d, setOffs), fy: drc03MatchesFY(d.financialYear, financialYear) }));
    return withLeft.sort((a, b) => Number(b.fy) - Number(a.fy));
  }, [drc03s, setOffs, financialYear]);
  const picked = drcList.find((x) => x.d.id === drc03Id);

  // Fresh form each time it opens — on the side asked for, else the one with more outstanding.
  const startSide: PayableSide = initialSide ?? (sumTax(clamp0(w.payables.input.balance)) > sumTax(clamp0(w.payables.output.balance)) ? 'input' : 'output');
  useEffect(() => {
    if (!open) return;
    setSide(startSide);
    setMethod('drc03');
    setDrcMode(drc03s.length ? 'synced' : 'upload');
    setDrc03Id('');
    setReference('');
    setDocDate('');
    setPeriod('');
    setTable('');
    setFile(null);
    setNote('');
    setAmounts(toText(clamp0(w.payables[startSide].balance)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  // Prefill the amounts: what is outstanding on this side, capped by what the picked DRC-03 has left.
  useEffect(() => {
    if (!open) return;
    const base = clamp0(w.payables[side].balance);
    setAmounts(toText(method === 'drc03' && drcMode === 'synced' && picked ? minT(base, picked.left) : base));
    setTable('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, method, drcMode, drc03Id]);

  const tax: Tax = {
    i: parsePlain(amounts.i) ?? 0, c: parsePlain(amounts.c) ?? 0, s: parsePlain(amounts.s) ?? 0, x: parsePlain(amounts.x) ?? 0,
  };

  const problems: string[] = [];
  if (HEADS.some(([h]) => tax[h] < 0)) problems.push('Amounts cannot be negative.');
  if (sumTax(tax) <= 0) problems.push('Enter the amount set off for at least one head.');
  HEADS.forEach(([h, l]) => {
    if (tax[h] > Math.max(outstanding[h], 0) + RUPEE_TOLERANCE) problems.push(`${l} ${rupees(tax[h])} is more than the ${SIDE_LABEL[side].toLowerCase()} balance outstanding (${rupees(Math.max(outstanding[h], 0))}).`);
  });
  if (method === 'drc03') {
    if (drcMode === 'synced') {
      if (!picked) problems.push('Pick the DRC-03.');
      else HEADS.forEach(([h, l]) => { if (tax[h] > picked.left[h] + RUPEE_TOLERANCE) problems.push(`${l} ${rupees(tax[h])} is more than DRC-03 ${picked.d.arn ?? ''} has left (${rupees(picked.left[h])}).`); });
    } else {
      if (!reference.trim()) problems.push('Enter the DRC-03 ARN.');
      if (!docDate) problems.push('Enter the DRC-03 date.');
      if (!file) problems.push('Attach the DRC-03 copy.');
    }
  } else {
    if (!period) problems.push('Pick the GSTR-3B return period.');
    if (!docDate) problems.push('Enter the GSTR-3B filing date.');
    if (!table) problems.push('Pick the GSTR-3B table the effect was given in.');
    if (!file) problems.push('Attach the filed GSTR-3B copy — the effect is accepted only with it.');
  }
  if (docDate && docDate > today()) problems.push('The date cannot be in the future.');

  const syncDrc03 = () => {
    if (!bridge.ready) {
      toast.error('The GST Keeper browser extension is not available in this browser. Import the DRC-03 by uploading its copy instead.');
      return;
    }
    const before = new Set(drc03s.map((d) => `${d.id}|${d.status}`));
    setSyncing(true);
    bridge.start({ mode: 'drc03' }, (ok, err) => {
      if (ok) toast.success('A GST portal tab is opening — type the CAPTCHA there; the DRC-03s are read and appear here.');
      else { setSyncing(false); toast.error(`Could not start the DRC-03 sync: ${err || 'the extension did not answer'}`); }
    });
    if (pollTimer.current) clearInterval(pollTimer.current);
    let tries = 0;
    const run = setInterval(async () => {
      tries += 1;
      try {
        const list = await loadDrc03s(client.id);
        if (pollTimer.current !== run) return;
        const fresh = list.filter((d) => !before.has(`${d.id}|${d.status}`)).length;
        if (fresh > 0 || tries >= POLL_MAX) {
          clearInterval(run);
          pollTimer.current = null;
          setSyncing(false);
          await reloadPayables();
          if (fresh > 0) toast.success(`${fresh} DRC-03${fresh === 1 ? '' : 's'} synced from the portal.`);
          else toast.warning('No new DRC-03 arrived after 6 minutes. Check the portal tab, or import the DRC-03 by uploading its copy.');
        }
      } catch { /* keep polling */ }
    }, POLL_MS);
    pollTimer.current = run;
  };

  const save = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      let evidence: { url: string; name: string } | null = null;
      if (file && !(method === 'drc03' && drcMode === 'synced')) evidence = await uploadEvidence(client.id, financialYear, file);
      await addSetOff(client.id, financialYear, userName, {
        side,
        method,
        tax,
        drc03Id: method === 'drc03' && drcMode === 'synced' ? drc03Id : null,
        reference: method === 'drc03' && drcMode === 'synced' ? null : reference.trim() || null,
        docDate: method === 'drc03' && drcMode === 'synced' ? null : docDate,
        gstr3bPeriod: method === 'gstr3b' ? period : null,
        gstr3bTable: method === 'gstr3b' ? table : null,
        evidenceUrl: evidence?.url ?? null,
        evidenceName: evidence?.name ?? null,
        note: note.trim() || null,
      });
      await reloadPayables();
      toast.success(`Set off ${rupees(sumTax(tax))} of the ${SIDE_LABEL[side].toLowerCase()} payable.`);
      onOpenChange(false);
    } catch (e) {
      toast.error(`Could not record the set-off: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a set-off</DialogTitle>
          <DialogDescription>
            A payable is set off only against a DRC-03 in the system, or an effect given in a GSTR-3B whose filing date and copy are on record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">1 · Which payable</legend>
            <RadioGroup value={side} onValueChange={(v) => setSide(v as PayableSide)} className="flex flex-wrap gap-4">
              {(['output', 'input'] as PayableSide[]).map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2">
                  <RadioGroupItem value={s} id={`side-${s}`} />
                  <span>{SIDE_LABEL[s]} <span className="text-xs text-muted-foreground">— {rupees(Math.max(sumTax(w.payables[s].balance), 0))} outstanding</span></span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">2 · How it was set off</legend>
            <RadioGroup value={method} onValueChange={(v) => setMethod(v as SetOffMethod)} className="grid gap-2 sm:grid-cols-2">
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2', method === 'drc03' && 'border-primary bg-primary/5')}>
                <RadioGroupItem value="drc03" id="m-drc03" className="mt-0.5" />
                <span><span className="font-medium">DRC-03</span><br /><span className="text-xs text-muted-foreground">Paid through DRC-03 and imported into the system</span></span>
              </label>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2', method === 'gstr3b' && 'border-primary bg-primary/5')}>
                <RadioGroupItem value="gstr3b" id="m-3b" className="mt-0.5" />
                <span><span className="font-medium">GSTR-3B</span><br /><span className="text-xs text-muted-foreground">Effect given in a GSTR-3B — filing date and copy needed</span></span>
              </label>
            </RadioGroup>
          </fieldset>

          {method === 'drc03' ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-muted-foreground">3 · The DRC-03</legend>
              <RadioGroup value={drcMode} onValueChange={(v) => setDrcMode(v as 'synced' | 'upload')} className="flex flex-wrap gap-4 text-xs">
                <label className="flex cursor-pointer items-center gap-2"><RadioGroupItem value="synced" id="drc-synced" /> Synced from the portal ({drc03s.length})</label>
                <label className="flex cursor-pointer items-center gap-2"><RadioGroupItem value="upload" id="drc-upload" /> Import it by uploading its copy</label>
              </RadioGroup>
              {drcMode === 'synced' ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">DRC-03s of this client, this FY&apos;s first.</span>
                    <Button type="button" size="sm" variant="outline" className="h-7" onClick={syncDrc03} disabled={syncing}>
                      {syncing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                      {syncing ? 'Waiting for the portal…' : 'Sync DRC-03s from the portal'}
                    </Button>
                  </div>
                  {drcList.length === 0 ? (
                    <Note tone="warn">No DRC-03 is in the system for this client. Sync them from the portal, or import this one by uploading its copy.</Note>
                  ) : (
                    <RadioGroup value={drc03Id} onValueChange={setDrc03Id} className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-1">
                      {drcList.map(({ d, left, fy }) => {
                        const nothingLeft = sumTax(left) < 0.5;
                        return (
                          <label key={d.id} className={cn('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted', drc03Id === d.id && 'bg-primary/5', nothingLeft && 'opacity-60')}>
                            <RadioGroupItem value={d.id} id={`drc-${d.id}`} className="mt-0.5" disabled={nothingLeft} />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono font-medium">{d.arn ?? 'ARN not read'}</span>
                                <span className="text-muted-foreground">{d.filedDate ?? ''}</span>
                                {fy && <Badge variant="success" className="px-1.5 py-0 text-[10px] font-medium">FY {financialYear}</Badge>}
                                {d.financialYear && !fy && <span className="text-muted-foreground">FY {d.financialYear}</span>}
                                {d.pdfUrl && <a href={d.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>copy <ExternalLink className="h-3 w-3" /></a>}
                              </span>
                              <span className="block truncate text-muted-foreground">{d.cause ?? ''}{d.section ? ` · ${d.section}` : ''}</span>
                              <span className="block tabular-nums">
                                Paid {HEADS.filter(([h]) => d.tax[h] > 0).map(([h, l]) => `${l} ${fmtMoney(d.tax[h])}`).join(' · ') || '—'}
                                <span className="text-muted-foreground"> · left {nothingLeft ? 'nothing' : HEADS.filter(([h]) => left[h] > 0).map(([h, l]) => `${l} ${fmtMoney(left[h])}`).join(' · ')}</span>
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  )}
                </>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor="drc-arn" className="text-xs">DRC-03 ARN</Label><Input id="drc-arn" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="AD2403…" className="font-mono" /></div>
                  <div className="space-y-1"><Label htmlFor="drc-date" className="text-xs">DRC-03 date</Label><Input id="drc-date" type="date" max={today()} value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
                  <EvidenceInput id="drc-file" label="DRC-03 copy (PDF)" file={file} onFile={setFile} />
                </div>
              )}
            </fieldset>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-muted-foreground">3 · The GSTR-3B the effect was given in</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Return period</Label>
                  <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger aria-label="GSTR-3B return period"><SelectValue placeholder="MM/YYYY" /></SelectTrigger>
                    <SelectContent>{periods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label htmlFor="g3b-date" className="text-xs">Filed on</Label><Input id="g3b-date" type="date" max={today()} value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Table</Label>
                  <Select value={table} onValueChange={setTable}>
                    <SelectTrigger aria-label="GSTR-3B table"><SelectValue placeholder="Table" /></SelectTrigger>
                    <SelectContent>{GSTR3B_TABLES[side].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label htmlFor="g3b-arn" className="text-xs">ARN (optional)</Label><Input id="g3b-arn" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className="font-mono" /></div>
                <div className="sm:col-span-2"><EvidenceInput id="g3b-file" label="Filed GSTR-3B copy (PDF) — required" file={file} onFile={setFile} /></div>
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">4 · Amount set off</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HEADS.map(([h, l]) => (
                <div key={h} className="space-y-1">
                  <Label htmlFor={`amt-${h}`} className="text-xs">{l} <span className="text-muted-foreground">· due {fmtMoney(Math.max(outstanding[h], 0))}</span></Label>
                  <Input id={`amt-${h}`} inputMode="decimal" value={amounts[h]} onChange={(e) => setAmounts((a) => ({ ...a, [h]: e.target.value }))} className="text-right tabular-nums" />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Total {rupees(sumTax(tax))}</p>
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="so-note" className="text-xs">Note (optional)</Label>
            <Textarea id="so-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive-strong" aria-live="polite">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || problems.length > 0}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Record set-off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const EvidenceInput: React.FC<{ id: string; label: string; file: File | null; onFile: (f: File | null) => void }> = ({ id, label, file, onFile }) => (
  <div className="space-y-1 sm:col-span-2">
    <Label htmlFor={id} className="text-xs">{label}</Label>
    <label htmlFor={id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs hover:bg-muted', file && 'border-solid border-success/50 bg-success/5')}>
      <FileUp className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'Choose the file…'}</span>
    </label>
    <input
      id={id}
      type="file"
      accept="application/pdf,image/png,image/jpeg"
      className="sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        if (f && f.size > 10 * 1024 * 1024) { toast.error('The copy is larger than 10 MB.'); return; }
        onFile(f);
      }}
    />
    <p className="text-[11px] text-muted-foreground">Kept as evidence — once uploaded it cannot be replaced or deleted.</p>
  </div>
);

export default SetOffDialog;
