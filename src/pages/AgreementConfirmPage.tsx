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
import { emailOk } from '@/lib/builderAgreementConfirmData';
import { confirmAllTargets, pageSummary, type PageUnitState } from '@/lib/builderConfirmRules';
import { GST_FIRM } from '@/lib/gstReminders';
import logo from '@/assets/logo.png';

// Public, no-login confirmation page. The link comes from the BU agreement
// value e-mail: since 21 Oct 2026 one link per e-mail, listing every unit
// asked about (builder_bu_confirm_requests); before that one link per unit,
// which still works here as a list of one. The token, not a session, scopes
// every call (builder_bu_confirm_lookup / builder_bu_confirm_respond).
// Anyone the e-mail was sent to (To or CC) may answer; the page asks their
// name and e-mail, the database checks the e-mail against the request, and
// both are recorded on each unit they answer. Only an open unit takes an
// answer: a confirmed one stays confirmed, a disputed one waits for the firm.
// A unit whose dispute box is open is left out of "Confirm all".

type UnitState = PageUnitState;

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
  ALREADY_DISPUTED: 'had already been disputed by someone else. The firm will check it and write to you',
  ALREADY_ACCEPTED: 'had already been settled by the firm',
};

const CONTACT = `If you have not received it, please write to us at ${GST_FIRM.email}.`;

const AgreementConfirmPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [page, setPage] = useState<PageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingUnit, setSavingUnit] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Open dispute boxes and what has been typed in each, by unit. Answering
  // another unit leaves them as they are.
  const [disputes, setDisputes] = useState<Record<string, string>>({});
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
    if (!emailOk(e)) { toast.error('Please give a valid e-mail address.'); return null; }
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
      // Close the boxes of the units just answered; keep the others' drafts.
      const answered = new Set(results.map((r) => r.unit_id));
      setDisputes((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !answered.has(id))));
      await load();
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(`Could not save your answer: ${msg}`);
      setNotice(msg);
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
  const summary = pageSummary(page.units);
  const disputing = Object.keys(disputes).filter((id) => open.some((u) => u.unit_id === id));
  const allTargets = confirmAllTargets(page.units, disputing);
  const unitNo = (id: string) => page.units.find((u) => u.unit_id === id)?.unit_no || '';

  if (summary.allReplaced) {
    return shell(
      <div className="text-center space-y-2 py-4">
        <XCircle className="h-10 w-10 text-muted-foreground mx-auto" />
        <CardTitle className="text-lg">Replaced by a newer request</CardTitle>
        <p className="text-sm text-muted-foreground">
          We sent a newer e-mail about {page.units.length === 1 ? `unit ${page.units[0].unit_no}` : 'these units'},{' '}
          {page.project_name}. Please use the link in that e-mail. {CONTACT}
        </p>
      </div>,
    );
  }

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
      case 'REPLACED': return { tone: 'text-muted-foreground', text: `Replaced by a newer request. Please use the link in the newer e-mail. ${CONTACT}` };
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
            Anyone our e-mail was sent to (To or CC) may answer. Please give the e-mail address it reached you at.
            We keep your name and e-mail with each answer.
          </p>
        </div>
      ) : summary.restReplaced ? (
        <div className="flex items-center justify-center gap-2 rounded-md border p-3 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          Every unit still on this link has an answer. The others were asked again in a newer e-mail.
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
              {u.state === 'PENDING' && disputes[u.unit_id] === undefined && (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm" variant="outline" disabled={busy}
                    onClick={() => setDisputes((prev) => ({ ...prev, [u.unit_id]: '' }))}
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
              {u.state === 'PENDING' && disputes[u.unit_id] !== undefined && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    placeholder="What has changed? For example, the revised agreement value and its date."
                    value={disputes[u.unit_id]}
                    onChange={(e) => {
                      const text = e.target.value;
                      setDisputes((prev) => ({ ...prev, [u.unit_id]: text }));
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm" variant="outline" disabled={busy}
                      onClick={() => setDisputes((prev) => {
                        const next = { ...prev };
                        delete next[u.unit_id];
                        return next;
                      })}
                    >
                      Back
                    </Button>
                    <Button
                      size="sm" variant="destructive" disabled={busy}
                      onClick={() => {
                        const note = (disputes[u.unit_id] || '').trim();
                        if (!note) { toast.error('Please say what has changed.'); return; }
                        void respond([{ unit_id: u.unit_id, action: 'DISPUTE', notes: note }], u.unit_id);
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
          <span className="text-muted-foreground">{summary.totalLabel}</span>
          <span className="tabular-nums font-semibold">Rs. {formatINR(summary.total)}</span>
        </div>
      )}

      {open.length > 1 && allTargets.length > 0 && (
        <div className="space-y-1">
          <Button
            className="w-full" disabled={savingUnit !== null}
            onClick={() => void respond(allTargets.map((id) => ({ unit_id: id, action: 'CONFIRM' as const })), 'all')}
          >
            {savingUnit === 'all' && <Loader2 className="h-4 w-4 animate-spin" />}
            {disputing.length
              ? `Confirm the other ${allTargets.length} open unit${allTargets.length === 1 ? '' : 's'}`
              : `Confirm all ${allTargets.length} open units`}
          </Button>
          {disputing.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Left out: unit {disputing.map(unitNo).join(', ')}, whose dispute is open. Submit it, or press Back to confirm it too.
            </p>
          )}
        </div>
      )}
    </>,
    page.units.length > 1,
  );
};

export default AgreementConfirmPage;
