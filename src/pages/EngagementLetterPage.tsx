// The client's engagement letter at /engagement/:token: public, no login (the
// firm's request of 28 October 2026; migration 20261028110000,
// docs/ENGAGEMENT_LETTERS.md). The link from our e-mail opens the one page
// summary: each term in a line, each line opening its clause of the full
// letter (?clause=<n> from the e-mail lands there; ?part=full on the whole
// letter). Signing opens once the full letter has been opened (the database
// refuses before): the signer's name and capacity, the two required consents,
// an explicit yes or no to AI tools (optional, DPDP s.6), a drawn signature if
// they wish, and a 6 digit code e-mailed to the letter's address. Signed, the
// page shows the signature, the fingerprint of the text signed, a PDF to keep,
// and the way to withdraw the AI consent (as easy as giving it, s.6(4)). The
// token scopes every call; the page never sees the code or another letter.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, Download, FileText, Loader2, Mail, PenLine, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';
import {
  askLetterCode, CAPACITIES, declineLetter, downloadLetterPdf, fingerprintMatches, istDateTime, letterError, LETTER_ERRORS, signLetter, viewLetter,
  withdrawLetterAi, type LetterClause, type LetterView,
} from '@/lib/engagementLetters';

const longDate = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** A clause's text: paragraphs, and lines starting "• " as a list. */
const ClauseText: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-2.5 text-[15px] leading-relaxed text-foreground/90">
    {text.split(/\n{2,}/).map((p, i) => {
      const lines = p.split('\n');
      const bullets = lines.filter((l) => l.startsWith('• '));
      const lead = lines.filter((l) => !l.startsWith('• '));
      return (
        <div key={i} className="space-y-1.5">
          {lead.map((l, k) => <p key={k}>{l}</p>)}
          {bullets.length > 0 && <ul className="list-disc space-y-1 pl-6">{bullets.map((b, k) => <li key={k}>{b.slice(2)}</li>)}</ul>}
        </div>
      );
    })}
  </div>
);

/** A small pad to draw a signature with a finger, a pen or the mouse (optional). */
const SignaturePad: React.FC<{ onChange: (png: string | null) => void }> = ({ onChange }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f2b46';
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    drawn.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (drawn.current && ref.current) onChange(ref.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
    onChange(null);
  };
  return (
    <div className="space-y-1">
      <canvas ref={ref} width={600} height={160} aria-label="Draw your signature (optional)"
        className="h-28 w-full touch-none rounded-md border border-dashed bg-white"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <button type="button" onClick={clear} className="text-xs text-muted-foreground underline hover:text-foreground">Clear the drawing</button>
    </div>
  );
};

type CodeStep = { codeId: string; ref: string; toMasked: string; sent: boolean };

/** Ask for a code, type it: shared by signing and by withdrawing the AI consent. */
const CodeBox: React.FC<{
  token: string; purpose: 'sign' | 'withdraw'; disabled?: boolean; busy: boolean; actionLabel: string;
  onSubmit: (step: CodeStep, code: string) => void;
}> = ({ token, purpose, disabled, busy, actionLabel, onSubmit }) => {
  const [step, setStep] = useState<CodeStep | null>(null);
  const [code, setCode] = useState('');
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ask = async () => {
    setAsking(true); setMsg(null);
    try {
      const s = await askLetterCode(token, purpose);
      setStep(s); setCode('');
      if (!s.sent) setMsg('The code could not be e-mailed just now. Please try again in a minute.');
    } catch (e) { setMsg(letterError(e)); } finally { setAsking(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" variant={step ? 'outline' : 'default'} disabled={disabled || asking} onClick={() => void ask()}>
          {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {step ? 'E-mail a new code' : 'E-mail me a code'}
        </Button>
        {step && (
          <>
            <div className="space-y-1">
              <Label htmlFor={`code-${purpose}`} className="text-xs">Code</Label>
              <Input id={`code-${purpose}`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
                maxLength={9} className="h-10 w-32 text-lg tracking-widest" />
            </div>
            <Button type="button" disabled={disabled || busy || code.replace(/\D/g, '').length !== 6} onClick={() => onSubmit(step, code)}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {actionLabel}
            </Button>
          </>
        )}
      </div>
      {step && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {step.sent ? 'A code is on its way to' : 'The code goes to'} <strong className="text-foreground">{step.toMasked}</strong>, in an e-mail marked{' '}
          <strong className="tracking-wider text-foreground">{step.ref}</strong>. It works for 30 minutes.
        </p>
      )}
      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
};

const EngagementLetterPage: React.FC = () => {
  const { token = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const wantClause = Number(sp.get('clause')) || null;
  const [view, setView] = useState<'summary' | 'full'>(sp.get('part') === 'full' || wantClause ? 'full' : 'summary');
  const [letter, setLetter] = useState<LetterView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState<boolean | null>(null);
  const loadedPart = useRef<'summary' | 'full' | null>(null);

  const load = useCallback(async (part: 'summary' | 'full') => {
    try {
      const r = await viewLetter(token, part);
      if ('error' in r) { setFailure(r.error); setLetter(null); return; }
      setLetter(r); setFailure(null);
      loadedPart.current = part;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(view); /* the first open only; later opens are recorded by openFull */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(() => { if (letter) fingerprintMatches(letter).then(setVerified); }, [letter]);
  // A clause link from the e-mail: once the full letter is on screen, go to it.
  useEffect(() => {
    if (view === 'full' && letter && wantClause) document.getElementById(`clause-${wantClause}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [view, letter, wantClause]);

  const openFull = (n?: number) => {
    setView('full');
    const next = new URLSearchParams(sp);
    next.set('part', 'full');
    if (n) next.set('clause', String(n)); else next.delete('clause');
    setSp(next, { replace: true });
    if (loadedPart.current !== 'full' || !letter?.full_opened) void load('full');
    setTimeout(() => {
      if (n) document.getElementById(`clause-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
  };
  const openSummary = () => {
    setView('summary');
    const next = new URLSearchParams(sp);
    next.delete('part'); next.delete('clause');
    setSp(next, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const firm = letter?.firm ?? {};
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <header className="flex flex-col items-center gap-1 text-center">
          <img src={logo} alt={firm.name || 'V. J. Desai & Co. LLP'} className="h-14 object-contain" />
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Chartered Accountants</div>
        </header>
        {children}
        <footer className="pt-2 text-center text-xs text-muted-foreground">
          {firm.name || 'V. J. Desai & Co. LLP'}{firm.email ? <> · <a className="underline" href={`mailto:${firm.email}`}>{firm.email}</a></> : null}
        </footer>
      </div>
    </div>
  );
  const card = 'rounded-xl border bg-card/95 p-5 shadow-sm sm:p-7';

  if (loading) return shell(<div className={cn(card, 'flex justify-center py-12')}><Loader2 className="h-6 w-6 animate-spin" /></div>);
  if (!letter) {
    return shell(
      <div className={cn(card, 'space-y-2 py-10 text-center')}>
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="text-[15px] text-muted-foreground">{LETTER_ERRORS[failure ?? 'not_found'] ?? 'This page could not be opened just now. Please try again.'}</p>
      </div>,
    );
  }
  if (letter.state === 'revoked' || letter.state === 'expired' || letter.state === 'ready') {
    return shell(
      <div className={cn(card, 'space-y-2 py-10 text-center')}>
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{letter.title} for {letter.client_name}</h1>
        <p className="text-[15px] text-muted-foreground">{LETTER_ERRORS[letter.state]}{letter.state === 'revoked' && letter.revoke_reason ? ` (${letter.revoke_reason})` : ''}</p>
      </div>,
    );
  }

  const signed = letter.state === 'signed';
  return shell(
    <>
      <section className={cn(card, 'space-y-1')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-bold leading-tight sm:text-2xl">{letter.title}</h1>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              For {letter.client_name}{letter.gstin ? `, GSTIN ${letter.gstin}` : ''} · version {letter.version} · ref {letter.ref}
            </p>
          </div>
          <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', signed ? 'bg-success/15 text-success-strong' : 'bg-info/15 text-info')}>
            {signed ? `Signed ${longDate(letter.signed_at)}` : `Awaiting your signature · link valid until ${longDate(letter.expires_at)}`}
          </span>
        </div>
        {signed && (
          <p className="flex flex-wrap items-center gap-1.5 pt-1 text-sm text-success-strong">
            <CheckCircle2 className="h-4 w-4" /> Signed by {letter.signer_name} ({letter.signer_capacity}) on {istDateTime(letter.signed_at)}.
          </p>
        )}
      </section>

      {view === 'summary' ? (
        <section className={cn(card, 'space-y-4')} aria-label="The letter on one page">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">The letter on one page</h2>
            <p className="text-sm text-muted-foreground">Each line is a clause of the engagement letter. Open any of them, or the whole letter, to read it in full{signed ? '' : ' before you sign'}.</p>
          </div>
          <ol className="divide-y rounded-lg border">
            {letter.clauses.map((c: LetterClause, i: number) => (
              <li key={c.key} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 w-6 shrink-0 text-right text-sm font-semibold text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => openFull(i + 1)} className="text-left text-[15px] font-semibold text-primary hover:underline">{c.heading}</button>
                  <p className="text-sm text-foreground/80">{c.summary}</p>
                </div>
              </li>
            ))}
          </ol>
          <Button size="lg" onClick={() => openFull()} className="w-full sm:w-auto"><FileText className="h-4 w-4" /> Read the full engagement letter</Button>
        </section>
      ) : (
        <article className={cn(card, 'space-y-6')} aria-label="The full engagement letter">
          <button type="button" onClick={openSummary} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ChevronLeft className="h-4 w-4" /> Back to the one page summary
          </button>
          <ClauseText text={letter.intro} />
          {letter.clauses.map((c, i) => (
            <section key={c.key} id={`clause-${i + 1}`} className={cn('scroll-mt-4 space-y-2 rounded-lg', wantClause === i + 1 && 'bg-primary/5 p-3 ring-1 ring-primary/30')}>
              <h2 className="text-[17px] font-semibold">{i + 1}. {c.heading}</h2>
              <ClauseText text={c.text} />
            </section>
          ))}
          <div className="space-y-0.5 border-t pt-4 text-sm">
            <div className="font-semibold">For {firm.name}, Chartered Accountants (FRN {firm.frn})</div>
            <div>{firm.partner_name}, Partner{firm.partner_membership_no ? `, membership no. ${firm.partner_membership_no}` : ''}</div>
            {firm.address && <div className="text-muted-foreground">{firm.address}</div>}
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            <ShieldCheck className={cn('h-4 w-4 shrink-0', verified ? 'text-success' : 'text-muted-foreground')} />
            Fingerprint of this text (SHA-256): <span className="font-mono">{letter.doc_sha256}</span>
            {verified === true && <span className="text-success-strong">· matches the text shown</span>}
            {verified === false && <span className="text-destructive">· could not be checked in this browser</span>}
          </p>
        </article>
      )}

      {signed ? <SignedPanel token={token} letter={letter} onChanged={() => void load(view)} />
        : <SignPanel token={token} letter={letter} onRead={() => openFull()} onSigned={() => void load(view)} />}
    </>,
  );
};

/** The e-signature: name, capacity, consents, the AI choice, an optional drawing, the code. */
const SignPanel: React.FC<{ token: string; letter: LetterView; onRead: () => void; onSigned: () => void }> = ({ token, letter, onRead, onSigned }) => {
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [otherCapacity, setOtherCapacity] = useState('');
  const [agree, setAgree] = useState(false);
  const [data, setData] = useState(false);
  const [ai, setAi] = useState<'yes' | 'no' | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [askedChanges, setAskedChanges] = useState(!!letter.declined_at);
  const cap = capacity === 'Other' ? otherCapacity.trim() : capacity;
  const ready = letter.full_opened && name.trim().length >= 3 && !!cap && agree && data && ai !== null;
  const aiClause = useMemo(() => letter.clauses.findIndex((c) => c.key === 'ai') + 1 || 11, [letter.clauses]);
  const dataClause = useMemo(() => letter.clauses.findIndex((c) => c.key === 'personal_data') + 1 || 9, [letter.clauses]);

  const sign = async (step: CodeStep, code: string) => {
    setBusy(true); setMsg(null);
    try {
      await signLetter({ token, codeId: step.codeId, code, name: name.trim(), capacity: cap, consents: { engagement: true, data_processing: true, ai_processing: ai === 'yes' }, signature: png });
      onSigned();
    } catch (e) { setMsg(letterError(e)); } finally { setBusy(false); }
  };
  const askChanges = async () => {
    setBusy(true); setMsg(null);
    try { await declineLetter(token, reason.trim()); setAskedChanges(true); setAsking(false); } catch (e) { setMsg(letterError(e)); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-5 rounded-xl border-2 border-primary/30 bg-card p-5 shadow-sm sm:p-7" aria-label="E-sign the letter">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><PenLine className="h-5 w-5 text-primary" /> E-sign the letter</h2>
        <p className="text-sm text-muted-foreground">On behalf of {letter.client_name}. We record your name, the time, the network address and browser you sign from, and the fingerprint of the letter, and e-mail you a signed copy.</p>
      </div>
      {!letter.full_opened && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-3 text-sm">
          <span className="flex-1">Please read the full letter first: signing opens once you have opened it.</span>
          <Button size="sm" variant="outline" onClick={onRead}><FileText className="h-4 w-4" /> Read the full letter</Button>
        </div>
      )}
      <fieldset disabled={!letter.full_opened} className="space-y-5 disabled:opacity-60">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="el-name">Your full name</Label>
            <Input id="el-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-10" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="el-cap">You sign as</Label>
            <Select value={capacity} onValueChange={setCapacity}>
              <SelectTrigger id="el-cap" className="h-10"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{[...CAPACITIES, 'Other'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            {capacity === 'Other' && <Input value={otherCapacity} onChange={(e) => setOtherCapacity(e.target.value)} placeholder="Your capacity" className="mt-1.5 h-10" />}
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-2.5 text-[15px]">
            <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} className="mt-1" />
            <span>I have read the full engagement letter and agree to its terms on behalf of {letter.client_name}.</span>
          </label>
          <label className="flex items-start gap-2.5 text-[15px]">
            <Checkbox checked={data} onCheckedChange={(v) => setData(!!v)} className="mt-1" />
            <span>I consent to {letter.firm.name || 'the firm'} processing the personal data described in clause {dataClause}, for the services in this letter and as the law requires.</span>
          </label>
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <div className="text-[15px] font-medium">May we use AI tools on your notices and documents (clause {aiClause})? This is optional.</div>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="AI tools">
              {([['yes', 'Yes, as clause ' + aiClause + ' describes'], ['no', 'No, do not use AI tools']] as const).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={ai === k} onClick={() => setAi(k)}
                  className={cn('rounded-md border px-3 py-2 text-sm font-medium', ai === k ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50')}>
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Either answer keeps the engagement as it is. You can withdraw a yes at any time.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm font-medium">Your signature</div>
            <div className="flex h-28 items-center rounded-md border bg-white px-4 font-serif text-3xl italic text-[#0f2b46] [overflow-wrap:anywhere]">
              {name.trim() || <span className="text-base not-italic text-muted-foreground">Your typed name signs</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">Draw it too (optional)</div>
            <SignaturePad onChange={setPng} />
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="text-sm font-medium">Confirm with a code</div>
          <p className="text-sm text-muted-foreground">We e-mail a 6 digit code to the address this letter was sent to ({letter.to_masked}). Typing it signs the letter.</p>
          <CodeBox token={token} purpose="sign" disabled={!ready} busy={busy} actionLabel="Sign the engagement letter" onSubmit={(s, c) => void sign(s, c)} />
          {!ready && letter.full_opened && <p className="text-xs text-muted-foreground">Fill your name and capacity, tick both boxes and answer the AI question to sign.</p>}
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </div>
      </fieldset>

      <div className="border-t pt-3 text-sm">
        {askedChanges ? <p className="text-muted-foreground">We have your note and will be in touch. You can still sign this letter if it suits you.</p>
          : asking ? (
            <div className="space-y-2">
              <Label htmlFor="el-changes">What would you like changed?</Label>
              <Textarea id="el-changes" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 5} onClick={() => void askChanges()}>Send to the firm</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
              </div>
            </div>
          ) : <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => setAsking(true)}>Something to change before you sign? Tell us</button>}
      </div>
    </section>
  );
};

/** Signed: keep a PDF, and withdraw the AI consent if it was given. */
const SignedPanel: React.FC<{ token: string; letter: LetterView; onChanged: () => void }> = ({ token, letter, onChanged }) => {
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ai = letter.consents?.ai_processing === true;
  const pdf = () => downloadLetterPdf({
    ref: letter.ref, title: letter.title, intro: letter.intro, clauses: letter.clauses, firm: letter.firm, version: letter.version, doc_sha256: letter.doc_sha256,
    client_name: letter.client_name, gstin: letter.gstin, to: letter.to_masked, sent_at: letter.sent_at, signed_at: letter.signed_at,
    signer_name: letter.signer_name, signer_capacity: letter.signer_capacity, consents: letter.consents, ai_withdrawn_at: letter.ai_withdrawn_at,
  });
  const withdraw = async (s: CodeStep, code: string) => {
    setBusy(true); setMsg(null);
    try { await withdrawLetterAi(token, s.codeId, code); setWithdrawing(false); onChanged(); } catch (e) { setMsg(letterError(e)); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-4 rounded-xl border-2 border-success/40 bg-card p-5 shadow-sm sm:p-7" aria-label="The signed letter">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5 text-success" /> Signed</h2>
        <p className="text-[15px]">By {letter.signer_name} ({letter.signer_capacity}) on {istDateTime(letter.signed_at)} · ref {letter.ref}</p>
        <p className="text-sm text-muted-foreground">
          Terms of the letter and personal data processing: agreed. AI tools: {ai ? 'allowed' : 'not allowed'}
          {letter.ai_withdrawn_at ? ` (consent withdrawn on ${istDateTime(letter.ai_withdrawn_at)})` : ''}.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void pdf()}><Download className="h-4 w-4" /> Download the signed letter (PDF)</Button>
      </div>
      {ai && (
        <div className="space-y-2 border-t pt-3">
          {withdrawing ? (
            <>
              <p className="text-sm">To withdraw your consent to AI tools, confirm with a code e-mailed to {letter.to_masked}. No new document of yours goes to the AI tool after that; the rest of the engagement stays as it is.</p>
              <CodeBox token={token} purpose="withdraw" busy={busy} actionLabel="Withdraw my consent" onSubmit={(s, c) => void withdraw(s, c)} />
              {msg && <p className="text-sm text-destructive">{msg}</p>}
            </>
          ) : <button type="button" className="text-sm text-muted-foreground underline hover:text-foreground" onClick={() => setWithdrawing(true)}>Withdraw my consent to AI tools</button>}
        </div>
      )}
    </section>
  );
};

export default EngagementLetterPage;
