import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatINR } from '@/utils/builderRates';
import { EMAIL_RE } from '@/lib/builderAgreementConfirmData';
import logo from '@/assets/logo.png';

// Public, no-login confirmation page. The link comes from the BU agreement
// value e-mail: since 21 Oct 2026 one link per e-mail, listing every unit
// asked about (builder_bu_confirm_requests); before that one link per unit,
// which still works here as a list of one. The token, not a session, scopes
// every call (builder_bu_confirm_lookup / builder_bu_confirm_respond).
// Anyone who received the e-mail may answer; the page asks their name and
// e-mail and records them on each unit they answer. Only an open unit takes
// an answer: a confirmed one stays confirmed, a disputed one waits for the firm.

type UnitState = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'ACCEPTED' | 'REPLACED';

interface PageUnit {
  unit_id: string;
  unit_no: string;
  agreement_value: number;
  state: UnitState;
  responded_by_name: string | null;
  responded_by_email: string | null;
  responded_at: string | null;
  dispute_notes: string | null;
}

interface PageData {
  kind: 'request' | 'unit';
  project_name: string;
  bu_date: string | null;
  units: PageUnit[];
}

interface Answer { unit_id: string; unit_no: string; result: string }

const longDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const RESULT_WORDS: Record<string, string> = {
  REPLACED: 'was asked again in a newer e-mail; please use the link there',
  ALREADY_CONFIRMED: 'had already been confirmed by someone else',
  ALREADY_DISPUTED: 'had already been disputed by someone else',
  ALREADY_ACCEPTED: 'had already been settled by the firm',
};

const AgreementConfirmPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [page, setPage] = useState<PageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingUnit, setSavingUnit] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [disputeOpen, setDisputeOpen] = useState<string | null>(null);
  const [disputeNotes, setDisputeNotes] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) { setPage(null); setIsLoading(false); return; }
    const { data, error } = await supabase.rpc('builder_bu_confirm_lookup', { _token: token });
    if (error || !data) { setPage(null); setIsLoading(false); return; }
    const d = data as unknown as PageData;
    setPage({ ...d, units: (d.units || []).map((u) => ({ ...u, agreement_value: Number(u.agreement_value) || 0 })) });
    setIsLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const who = () => {
    const n = name.trim().replace(/\s+/g, ' ');
    const e = email.trim().toLowerCase();
    if (n.length < 2) { toast.error('Please give your name.'); return null; }
    if (!EMAIL_RE.test(e)) { toast.error('Please give a valid e-mail address.'); return null; }
    return { n, e };
  };

  const respond = async (answers: { unit_id: string; action: 'CONFIRM' | 'DISPUTE'; notes?: string }[], key: string) => {
    if (!token || !answers.length) return;
    const person = who();
    if (!person) return;
    setSavingUnit(key);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc('builder_bu_confirm_respond', {
        _token: token, _answers: answers, _name: person.n, _email: person.e,
      });
      if (error) throw error;
      const results = (data || []) as unknown as Answer[];
      const done = results.filter((r) => r.result === 'CONFIRMED' || r.result === 'DISPUTED');
      const missed = results.filter((r) => !(r.result === 'CONFIRMED' || r.result === 'DISPUTED'));
      if (done.length) {
        toast.success(done.length === 1
          ? `Unit ${done[0].unit_no}: ${done[0].result === 'CONFIRMED' ? 'confirmed' : 'dispute noted'}. Thank you.`
          : `${done.length} units recorded. Thank you.`);
      }
      if (missed.length) {
        setNotice(missed.map((r) => `Unit ${r.unit_no} ${RESULT_WORDS[r.result] || 'could not be answered'}.`).join(' '));
      }
      setDisputeOpen(null);
      setDisputeNotes('');
      await load();
    } catch (e) {
      toast.error(`Could not save your answer: ${(e as Error).message}`);
    } finally {
      setSavingUnit(null);
    }
  };

  const shell = (children: React.ReactNode, wide = false) => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <div className={cn('w-full', wide ? 'max-w-2xl' : 'max-w-md')}>
        <Card className="shadow-xl border-0 bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center space-y-4 pb-2">
            <div className="flex justify-center">
              <img src={logo} alt="V. J. Desai & Co. LLP" className="h-16 object-contain" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>
      </div>
    </div>
  );

  if (isLoading) {
    return shell(<div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>);
  }

  if (!page || !page.units.length) {
    return shell(
      <div className="text-center space-y-2 py-4">
        <XCircle className="h-10 w-10 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          This link is not valid. Please use the link in our latest e-mail, or contact us directly.
        </p>
      </div>,
    );
  }

  const open = page.units.filter((u) => u.state === 'PENDING');
  const allReplaced = page.units.every((u) => u.state === 'REPLACED');

  if (allReplaced) {
    return shell(
      <div className="text-center space-y-2 py-4">
        <XCircle className="h-10 w-10 text-muted-foreground mx-auto" />
        <CardTitle className="text-lg">Replaced by a newer request</CardTitle>
        <p className="text-sm text-muted-foreground">
          We sent a newer e-mail about {page.units.length === 1 ? `unit ${page.units[0].unit_no}` : 'these units'},{' '}
          {page.project_name}. Please use the link in that e-mail.
        </p>
      </div>,
    );
  }

  const total = page.units.filter((u) => u.state !== 'REPLACED').reduce((a, u) => a + u.agreement_value, 0);

  const stateLine = (u: PageUnit) => {
    const by = u.responded_by_name
      ? ` by ${u.responded_by_name}${u.responded_by_email ? ` (${u.responded_by_email})` : ''}${u.responded_at ? ` on ${longDate(u.responded_at)}` : ''}`
      : '';
    switch (u.state) {
      case 'CONFIRMED': return { tone: 'text-emerald-700 dark:text-emerald-400', text: `Confirmed${by}.` };
      case 'DISPUTED': {
        const note = (u.dispute_notes || '').trim().replace(/[.\s]+$/, '');
        return { tone: 'text-amber-700 dark:text-amber-400', text: `Disputed${by}${note ? `: ${note}` : ''}. We will follow up.` };
      }
      case 'ACCEPTED': return { tone: 'text-muted-foreground', text: 'Settled by the firm. Nothing more is needed.' };
      case 'REPLACED': return { tone: 'text-muted-foreground', text: 'Replaced by a newer request. Please use the link in the newer e-mail.' };
      default: return null;
    }
  };

  return shell(
    <>
      <div className="text-center">
        <CardTitle className="text-lg">
          {page.units.length === 1 ? 'Confirm the agreement value' : 'Confirm the agreement values'}
        </CardTitle>
        <CardDescription>
          {page.project_name}
          {page.bu_date ? `, dated ${longDate(page.bu_date)}` : ''}
          {page.units.length > 1 ? ` · ${page.units.length} units` : ''}
        </CardDescription>
      </div>

      {open.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cf-name">Your name</Label>
            <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-email">Your e-mail</Label>
            <Input id="cf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Anyone who received our e-mail may answer. We keep your name and e-mail with each answer.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-md border p-3 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Every unit here has an answer. Thank you.
        </div>
      )}

      {notice && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          {notice}
        </p>
      )}

      <ul className="divide-y rounded-md border">
        {page.units.map((u) => {
          const line = stateLine(u);
          const busy = savingUnit !== null;
          return (
            <li key={u.unit_id} className={cn('px-3 py-2.5', u.state === 'REPLACED' && 'opacity-60')}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">Unit {u.unit_no}</span>
                <span className="tabular-nums font-semibold">Rs. {formatINR(u.agreement_value)}</span>
              </div>
              {line && <p className={cn('mt-1 text-xs', line.tone)}>{line.text}</p>}
              {u.state === 'PENDING' && disputeOpen !== u.unit_id && (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm" variant="outline" disabled={busy}
                    onClick={() => { setDisputeOpen(u.unit_id); setDisputeNotes(''); }}
                  >
                    Dispute
                  </Button>
                  <Button
                    size="sm" disabled={busy}
                    onClick={() => void respond([{ unit_id: u.unit_id, action: 'CONFIRM' }], u.unit_id)}
                  >
                    {savingUnit === u.unit_id && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
                  </Button>
                </div>
              )}
              {u.state === 'PENDING' && disputeOpen === u.unit_id && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    placeholder="What has changed? For example, the revised agreement value and its date."
                    value={disputeNotes}
                    onChange={(e) => setDisputeNotes(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setDisputeOpen(null)}>Back</Button>
                    <Button
                      size="sm" variant="destructive" disabled={busy}
                      onClick={() => {
                        if (!disputeNotes.trim()) { toast.error('Please say what has changed.'); return; }
                        void respond([{ unit_id: u.unit_id, action: 'DISPUTE', notes: disputeNotes.trim() }], u.unit_id);
                      }}
                    >
                      {savingUnit === u.unit_id && <Loader2 className="h-4 w-4 animate-spin" />} Submit dispute
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {page.units.length > 1 && (
        <div className="flex items-center justify-between px-1 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular-nums font-semibold">Rs. {formatINR(total)}</span>
        </div>
      )}

      {open.length > 1 && (
        <Button
          className="w-full" disabled={savingUnit !== null}
          onClick={() => void respond(open.map((u) => ({ unit_id: u.unit_id, action: 'CONFIRM' as const })), 'all')}
        >
          {savingUnit === 'all' && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm all {open.length} open units
        </Button>
      )}
    </>,
    page.units.length > 1,
  );
};

export default AgreementConfirmPage;
