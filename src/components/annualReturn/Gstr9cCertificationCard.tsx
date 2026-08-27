import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchGstr9cCertification } from '@/lib/annualReturnAggregates';

interface Fields {
  place: string; signatory_name: string; membership_no: string; signature_date: string;
  building_no: string; floor_number: string; premises_name: string; road_street: string;
  city_town_locality: string; district: string; state: string; pin_code: string; pan: string;
}
const emptyFields = (): Fields => ({
  place: '', signatory_name: '', membership_no: '', signature_date: '',
  building_no: '', floor_number: '', premises_name: '', road_street: '',
  city_town_locality: '', district: '', state: '', pin_code: '', pan: '',
});

interface Props { clientId: string; financialYear: string; }

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; disabled: boolean; className?: string }> = ({ label, value, onChange, disabled, className }) => (
  <div className={className}>
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <Input className="mt-1 h-9" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} />
  </div>
);

/**
 * GSTR-9C certification block — the verification declaration's signatory
 * and address details, from the real sheet "PT V" (below the Part V
 * liability grid). Verified against GSTR_9C_Offline_Utility.xlsm (v2.8),
 * 27 Aug 2026. One record per client/year; every field is mandatory on
 * the real form, but nothing here is enforced — this is a working draft
 * area, not the filed certificate.
 */
export const Gstr9cCertificationCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const { user } = useAuth();
  const [saved, setSaved] = useState<Fields>(emptyFields());
  const [draft, setDraft] = useState<Fields>(emptyFields());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchGstr9cCertification(clientId, financialYear)
      .then((next) => {
        if (cancelled) return;
        setSaved(next);
        setDraft(next);
      })
      .catch((err) => toast.error('Could not load certification details: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (field: keyof Fields, v: string) => setDraft((prev) => ({ ...prev, [field]: v }));

  const saveAll = async () => {
    setSaving(true);
    try {
      const payload = {
        client_id: clientId, financial_year: financialYear, ...draft,
        signature_date: draft.signature_date || null,
        entered_by: user?.id || null, updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('gstr9c_certification').upsert(payload, { onConflict: 'client_id,financial_year' });
      if (error) throw error;
      setSaved(draft);
      toast.success('Certification details saved.');
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Certification</CardTitle>
        <CardDescription>Verification declaration — signatory and address details.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center gap-2 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">Certification</CardTitle>
          <CardDescription>
            "I hereby solemnly affirm and declare that the information given herein above is true and correct to the best of my knowledge and belief and nothing has been concealed there from."
          </CardDescription>
        </div>
        <Button size="sm" disabled={saving || !dirty} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 max-w-3xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Place" value={draft.place} onChange={(v) => update('place', v)} disabled={saving} />
          <Field label="Date" value={draft.signature_date} onChange={(v) => update('signature_date', v)} disabled={saving} />
          <Field label="Name of the signatory" value={draft.signatory_name} onChange={(v) => update('signatory_name', v)} disabled={saving} />
          <Field label="Membership No." value={draft.membership_no} onChange={(v) => update('membership_no', v)} disabled={saving} />
        </div>
        <div>
          <div className="text-sm font-medium mb-3">Full address</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Building No / Flat No" value={draft.building_no} onChange={(v) => update('building_no', v)} disabled={saving} />
            <Field label="Floor Number" value={draft.floor_number} onChange={(v) => update('floor_number', v)} disabled={saving} />
            <Field label="Name of the Premises/Building" value={draft.premises_name} onChange={(v) => update('premises_name', v)} disabled={saving} />
            <Field label="Road/Street" value={draft.road_street} onChange={(v) => update('road_street', v)} disabled={saving} />
            <Field label="City/Town/Locality/Village" value={draft.city_town_locality} onChange={(v) => update('city_town_locality', v)} disabled={saving} />
            <Field label="District" value={draft.district} onChange={(v) => update('district', v)} disabled={saving} />
            <Field label="State" value={draft.state} onChange={(v) => update('state', v)} disabled={saving} />
            <Field label="Pin Code" value={draft.pin_code} onChange={(v) => update('pin_code', v)} disabled={saving} />
          </div>
        </div>
        <Field label="PAN details for digital signature" value={draft.pan} onChange={(v) => update('pan', v)} disabled={saving} className="max-w-xs" />
      </CardContent>
    </Card>
  );
};

export default Gstr9cCertificationCard;
