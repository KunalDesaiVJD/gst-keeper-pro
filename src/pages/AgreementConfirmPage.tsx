import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@/utils/builderRates';
import logo from '@/assets/logo.png';

// Public, no-login confirmation page — the client reaches this from the
// tokenized link in the BU agreement-value confirmation email
// (requestAgreementConfirmations() in builderAgreementConfirmData.ts). The
// token itself, not a session, is what scopes every call here to this one
// unit's confirmation row.

interface Details {
  unitNo: string;
  projectName: string;
  agreementValue: number;
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED';
}

const AgreementConfirmPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [details, setDetails] = useState<Details | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeNotes, setDisputeNotes] = useState('');
  const [done, setDone] = useState<'CONFIRMED' | 'DISPUTED' | null>(null);

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    (async () => {
      const { data, error } = await supabase.rpc('builder_bu_agreement_confirmation_lookup', { _token: token });
      if (error || !data || !data.length) { setDetails(null); setIsLoading(false); return; }
      const row = data[0];
      setDetails({
        unitNo: row.unit_no, projectName: row.project_name,
        agreementValue: Number(row.agreement_value) || 0,
        status: row.status as Details['status'],
      });
      setIsLoading(false);
    })();
  }, [token]);

  const respond = async (action: 'CONFIRM' | 'DISPUTE') => {
    if (!token) return;
    if (action === 'DISPUTE' && !disputeNotes.trim()) {
      toast.error('Please add a note about what has changed.');
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.rpc('builder_bu_agreement_confirm', {
        _token: token, _action: action, _notes: disputeNotes.trim(),
      });
      if (error) throw error;
      if (!data) { toast.error('This link has already been used or has expired.'); return; }
      setDone(action === 'CONFIRM' ? 'CONFIRMED' : 'DISPUTED');
    } catch (e) {
      toast.error(`Could not save your response: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <div className="w-full max-w-md">
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

  if (!details) {
    return shell(
      <div className="text-center space-y-2 py-4">
        <XCircle className="h-10 w-10 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          This link is not valid. It may have been superseded by a newer request — please check your latest
          email, or contact us directly.
        </p>
      </div>,
    );
  }

  if (done || details.status !== 'PENDING') {
    const outcome = done || details.status;
    return shell(
      <div className="text-center space-y-2 py-4">
        {outcome === 'CONFIRMED' ? (
          <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
        ) : (
          <XCircle className="h-10 w-10 text-amber-600 mx-auto" />
        )}
        <CardTitle className="text-lg">
          {outcome === 'CONFIRMED' ? 'Confirmed — thank you' : 'Noted — we will follow up'}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Unit {details.unitNo}, {details.projectName}
        </p>
      </div>,
    );
  }

  return shell(
    <>
      <div className="text-center">
        <CardTitle className="text-lg">Confirm the agreement value</CardTitle>
        <CardDescription>Unit {details.unitNo}, {details.projectName}</CardDescription>
      </div>
      <div className="rounded-md border p-4 text-center">
        <div className="text-2xl font-semibold">{formatINR(details.agreementValue)}</div>
        <p className="text-xs text-muted-foreground mt-1">Agreement value on record</p>
      </div>

      {!showDispute ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setShowDispute(true)} disabled={isSaving}>
            Dispute
          </Button>
          <Button onClick={() => void respond('CONFIRM')} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Confirm
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            placeholder="What has changed about the agreement value?"
            value={disputeNotes}
            onChange={(e) => setDisputeNotes(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setShowDispute(false)} disabled={isSaving}>Back</Button>
            <Button variant="destructive" onClick={() => void respond('DISPUTE')} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Submit dispute
            </Button>
          </div>
        </div>
      )}
    </>,
  );
};

export default AgreementConfirmPage;
