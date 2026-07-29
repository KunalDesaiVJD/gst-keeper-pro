import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import {
  Building2, Save, Loader2, Mail, CheckCircle2, AlertTriangle, Paperclip,
} from 'lucide-react';
import {
  CHARGE_HEADS,
  DEFAULT_BUILDER_SETTINGS,
  DELAY_INTEREST_LABEL,
  EXCESS_TAX_LABEL,
  EXTRA_WORK_LABEL,
  FSI_TREATMENT_LABEL,
  enqueueBuilderSetupConfirmation,
  fetchBuilderSettings,
  type BuilderClientSettings,
  type DelayInterestBasis,
  type ExcessTaxTreatment,
  type ExtraWorkRate,
  type FsiTreatment,
} from '@/lib/builderSettings';
import {
  CHARGE_HEAD_LABEL,
  CHARGE_HEAD_SETTING_KEY,
  type ChargeInclusionSettings,
} from '@/utils/builderRates';

interface BuilderClientRow {
  id: string;
  name: string;
  gstin: string | null;
  email: string | null;
}

const fmtWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * Builder client setup questionnaire.
 *
 * Every switch here changes the GST charged to the client's members, so the
 * page does two jobs: capture the elections, and get them confirmed by the
 * client in writing before the projects are worked.
 */
const BuilderSettingsPage: React.FC = () => {
  const { canManageBuilderProjects, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();

  const [clients, setClients] = useState<BuilderClientRow[]>([]);
  const [settings, setSettings] = useState<BuilderClientSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const readOnly = !canManageBuilderProjects();
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  );

  // Only Regular/Builder clients belong here.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, gstin, email, regular_sub_type')
        .eq('regular_sub_type', 'Builder')
        .order('name');
      if (error) {
        toast.error('Could not load builder clients');
        return;
      }
      setClients((data || []) as BuilderClientRow[]);
    })();
  }, []);

  const loadSettings = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      setSettings(await fetchBuilderSettings(clientId));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) void loadSettings(selectedClientId);
    else setSettings(null);
  }, [selectedClientId, loadSettings]);

  const patch = (p: Partial<BuilderClientSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...p } : prev));

  const handleSave = async () => {
    if (!settings || !selectedClientId) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('builder_client_settings')
        .upsert({
          client_id: selectedClientId,
          incl_plc: settings.incl_plc,
          incl_development: settings.incl_development,
          incl_parking: settings.incl_parking,
          incl_club: settings.incl_club,
          incl_utility_deposit: settings.incl_utility_deposit,
          incl_legal: settings.incl_legal,
          incl_maintenance_corpus: settings.incl_maintenance_corpus,
          incl_other: settings.incl_other,
          extra_work_rate: settings.extra_work_rate,
          delay_interest_basis: settings.delay_interest_basis,
          excess_tax_treatment: settings.excess_tax_treatment,
          default_fsi_treatment: settings.default_fsi_treatment,
          confirmation_received_at: settings.confirmation_received_at,
          confirmation_document_url: settings.confirmation_document_url,
          confirmation_notes: settings.confirmation_notes,
          updated_by: user?.userId ?? null,
        }, { onConflict: 'client_id' });
      if (error) throw error;
      toast.success('Settings saved');
      await loadSettings(selectedClientId);
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendConfirmation = async () => {
    if (!settings || !selectedClientId) return;
    setIsSending(true);
    try {
      // Save first, so the letter always reflects what is stored.
      await handleSave();
      const res = await enqueueBuilderSetupConfirmation({
        clientId: selectedClientId,
        settings,
        staffName: user?.firstName,
      });
      if (!res.ok) {
        toast.error(res.reason || 'Could not queue the confirmation letter.');
        return;
      }
      const { error } = await supabase
        .from('builder_client_settings')
        .update({
          confirmation_outbox_id: res.outboxId,
          confirmation_sent_at: new Date().toISOString(),
          // A fresh letter supersedes any earlier confirmation.
          confirmation_received_at: null,
        })
        .eq('client_id', selectedClientId);
      if (error) throw error;
      toast.success('Confirmation letter queued to the client');
      await loadSettings(selectedClientId);
    } catch (e) {
      toast.error(`Could not send: ${(e as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const markReceived = async () => {
    if (!selectedClientId) return;
    patch({ confirmation_received_at: new Date().toISOString() });
    toast.info("Marked as received — press Save to record it.");
  };

  const confirmationState: 'none' | 'sent' | 'received' = !settings?.confirmation_sent_at
    ? 'none'
    : settings.confirmation_received_at ? 'received' : 'sent';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Builder Setup"
        subtitle="Client-level GST elections for real estate projects, and the written confirmation trail"
        icon={<Building2 className="h-5 w-5" />}
        actions={
          settings && !readOnly ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSendConfirmation} disabled={isSending || isSaving}>
                {isSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                Send confirmation
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="max-w-md">
            <Label className="mb-1.5 block">Builder client</Label>
            <SearchableSelect
              options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
              value={selectedClientId || ''}
              onValueChange={setSelectedClientId}
              placeholder="Search builder client..."
              searchPlaceholder="Type to search..."
              emptyText="No builder clients. Set a client's sub-type to Builder first."
            />
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      )}

      {settings && !isLoading && (
        <>
          {/* ── Charge heads ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Charges forming part of the unit price</CardTitle>
              <CardDescription>
                Whatever is switched on here forms the "gross amount charged" for the apartment. That one
                base decides both the ₹45 lakh affordable limit and the taxable value — they are the same
                statutory concept, which is why each head has a single switch rather than two.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {CHARGE_HEADS.map((head) => {
                const key = CHARGE_HEAD_SETTING_KEY[head] as keyof ChargeInclusionSettings;
                const on = settings[key] !== false;
                return (
                  <div
                    key={head}
                    className="flex items-center justify-between py-2 border-b last:border-b-0 border-border/60"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{CHARGE_HEAD_LABEL[head]}</p>
                      <p className="text-xs text-muted-foreground">
                        {on ? 'Included in gross amount charged' : 'Excluded — not taxed, not counted toward ₹45 lakh'}
                      </p>
                    </div>
                    <Switch
                      checked={on}
                      disabled={readOnly}
                      onCheckedChange={(v) => patch({ [key]: v } as Partial<BuilderClientSettings>)}
                    />
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground pt-3">
                Stamp duty, registration charges and GST itself are never part of this base.
              </p>
            </CardContent>
          </Card>

          {/* ── Extra work ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Extra / additional work billed to members</CardTitle>
              <CardDescription>Modifications and upgrades charged over and above the unit price.</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={settings.extra_work_rate}
                onValueChange={(v) => patch({ extra_work_rate: v as ExtraWorkRate })}
                disabled={readOnly}
                className="space-y-2"
              >
                {(Object.keys(EXTRA_WORK_LABEL) as ExtraWorkRate[]).map((k) => (
                  <label
                    key={k}
                    htmlFor={`extra-${k}`}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                      settings.extra_work_rate === k ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={k} id={`extra-${k}`} />
                    <span className="text-sm">{EXTRA_WORK_LABEL[k]}</span>
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* ── Delay interest ───────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Interest recovered on delayed instalments</CardTitle>
              <CardDescription>
                Section 15(2)(d) includes such interest in the value of the principal supply, which would
                carry the unit's own rate. A flat 18% is the more conservative election — it never
                under-charges, so it carries no exposure to the department, but it does cost the member more.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={settings.delay_interest_basis}
                onValueChange={(v) => patch({ delay_interest_basis: v as DelayInterestBasis })}
                disabled={readOnly}
                className="space-y-2"
              >
                {(Object.keys(DELAY_INTEREST_LABEL) as DelayInterestBasis[]).map((k) => (
                  <label
                    key={k}
                    htmlFor={`delay-${k}`}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                      settings.delay_interest_basis === k ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={k} id={`delay-${k}`} />
                    <span className="text-sm">{DELAY_INTEREST_LABEL[k]}</span>
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* ── Excess tax ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Excess tax paid on GST-inclusive receipts</CardTitle>
              <CardDescription>
                Where a receipt was inclusive of GST but tax was computed on the whole figure, tax has been
                paid on the tax. This is how the excess is dealt with once the receipt is restated.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={settings.excess_tax_treatment}
                onValueChange={(v) => patch({ excess_tax_treatment: v as ExcessTaxTreatment })}
                disabled={readOnly}
                className="space-y-2"
              >
                {(Object.keys(EXCESS_TAX_LABEL) as ExcessTaxTreatment[]).map((k) => (
                  <label
                    key={k}
                    htmlFor={`excess-${k}`}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                      settings.excess_tax_treatment === k ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={k} id={`excess-${k}`} />
                    <span className="text-sm">{EXCESS_TAX_LABEL[k]}</span>
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* ── FSI ──────────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. TDR / FSI under reverse charge — default</CardTitle>
              <CardDescription>
                Overridable per project. Choosing not to pay requires the client's written instruction on
                file and GST Manager sign-off before the affected return can be filed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={settings.default_fsi_treatment}
                onValueChange={(v) => patch({ default_fsi_treatment: v as FsiTreatment })}
                disabled={readOnly}
                className="space-y-2"
              >
                {(Object.keys(FSI_TREATMENT_LABEL) as FsiTreatment[]).map((k) => (
                  <label
                    key={k}
                    htmlFor={`fsi-${k}`}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                      settings.default_fsi_treatment === k ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={k} id={`fsi-${k}`} />
                    <span className="text-sm">{FSI_TREATMENT_LABEL[k]}</span>
                  </label>
                ))}
              </RadioGroup>
              {settings.default_fsi_treatment === 'IGNORE' && (
                <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="text-xs">
                    The TDR/FSI liability crystallises on the BU date. Returns for a period carrying an
                    ignored FSI liability stay blocked until the client's written instruction is attached
                    and approved by the GST Manager.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Confirmation trail ───────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                6. Client confirmation
                {confirmationState === 'received' && (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmed
                  </Badge>
                )}
                {confirmationState === 'sent' && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">Awaiting reply</Badge>
                )}
                {confirmationState === 'none' && (
                  <Badge variant="outline">Not sent</Badge>
                )}
              </CardTitle>
              <CardDescription>
                The elections above are the client's, not ours. Send the letter from {`gst@vjdesai.com`},
                then record their reply here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Letter sent</Label>
                  <p className="text-sm font-medium">{fmtWhen(settings.confirmation_sent_at)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Reply received</Label>
                  <p className="text-sm font-medium">{fmtWhen(settings.confirmation_received_at)}</p>
                </div>
              </div>

              <div>
                <Label htmlFor="conf-doc" className="mb-1.5 block">
                  <Paperclip className="h-3 w-3 inline mr-1" />
                  Link to the client's written confirmation
                </Label>
                <Input
                  id="conf-doc"
                  value={settings.confirmation_document_url || ''}
                  disabled={readOnly}
                  placeholder="Paste a link to the email or scanned letter"
                  onChange={(e) => patch({ confirmation_document_url: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="conf-notes" className="mb-1.5 block">Notes</Label>
                <Textarea
                  id="conf-notes"
                  rows={3}
                  value={settings.confirmation_notes || ''}
                  disabled={readOnly}
                  placeholder="Anything the client asked to change, and what was agreed"
                  onChange={(e) => patch({ confirmation_notes: e.target.value })}
                />
              </div>

              {!readOnly && settings.confirmation_sent_at && !settings.confirmation_received_at && (
                <Button variant="outline" size="sm" onClick={markReceived}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Mark confirmation received
                </Button>
              )}

              {selectedClient && !selectedClient.email && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="text-xs">
                    No email address on file for {selectedClient.name}. Add one on the client record before
                    sending the confirmation letter.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!selectedClientId && !isLoading && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Building2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Select a builder client to capture their GST elections.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BuilderSettingsPage;
