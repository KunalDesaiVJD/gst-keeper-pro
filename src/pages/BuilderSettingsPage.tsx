import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL, WS_FILTER_LABEL, WS_PAGE } from '@/components/workspace/theme';
import { useBuilderEmbedded } from '@/contexts/BuilderWorkspaceContext';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import {
  Building2, Save, Loader2, Mail, CheckCircle2, Paperclip, MapPin,
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
  const embedded = useBuilderEmbedded();
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
          raises_invoices: settings.raises_invoices,
          default_is_metro: settings.default_is_metro,
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
          updated_by: user?.id ?? null,
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

  const optionClass = (on: boolean) => cn(
    'flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-xs',
    on ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
  );

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        embedded={embedded}
        title="Builder Setup"
        subtitle="Client-level GST elections for real estate projects, and the written confirmation trail"
        icon={<Building2 />}
        actions={
          settings && !readOnly ? (
            <>
              <Button variant="outline" size="sm" className={WS_BTN} onClick={handleSendConfirmation} disabled={isSending || isSaving}>
                {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Send confirmation
              </Button>
              <Button size="sm" className={WS_BTN} onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="px-3 py-2">
          <label className="block max-w-md space-y-0.5">
            <span className={WS_FILTER_LABEL}>Builder client</span>
            <SearchableSelect
              options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined }))}
              value={selectedClientId || ''}
              onValueChange={setSelectedClientId}
              placeholder="Search builder client..."
              searchPlaceholder="Type to search..."
              emptyText="No builder clients. Set a client's sub-type to Builder first."
              className={WS_CONTROL}
            />
          </label>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
          </CardContent>
        </Card>
      )}

      {settings && !isLoading && (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* ── Invoicing model ──────────────────────────────────────────── */}
          <SectionCard
            title="1. How this client bills members"
            description={(
              <>
                Most promoters raise a milestone tax invoice as construction progresses. Some never do —
                they collect strictly against the agreement, and the whole balance falls due only at the
                BU (or an earlier dastavej) cut-off. Get this right first: it decides whether "Raise
                invoice" appears on the ledger at all.
              </>
            )}
          >
            <div className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="text-xs font-medium">Raises milestone invoices</p>
                <p className="text-[11px] text-muted-foreground">
                  {settings.raises_invoices
                    ? 'Milestone, delay-interest and other manual invoices are available on the ledger.'
                    : 'Invoicing hidden on the ledger. Tax is charged only on advances (Table 11A) and '
                      + "at the BU/dastavej differential — the two events this client actually uses. "
                      + 'The automatic BU differential invoice still fires when that event posts.'}
                </p>
              </div>
              <Switch
                checked={settings.raises_invoices}
                disabled={readOnly}
                onCheckedChange={(v) => patch({ raises_invoices: v })}
              />
            </div>
          </SectionCard>

          {/* ── Metro / non-metro ────────────────────────────────────────── */}
          <SectionCard
            title={<span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> 2. Metropolitan city</span>}
            description={(
              <>
                Decides the affordable-housing carpet limit: 60 sq m in a metropolitan city, 90 sq m
                elsewhere. The metro list is Bengaluru, Chennai, Delhi NCR, Hyderabad, Kolkata and MMR —
                Gujarat cities are never metro. This is only a default for a <strong>new</strong> project
                created for this client; it is set per project (a client could in principle build in more
                than one city) and never changes an existing project's own election.
              </>
            )}
          >
            <div className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="text-xs font-medium">New projects default to metropolitan</p>
                <p className="text-[11px] text-muted-foreground">
                  {settings.default_is_metro
                    ? 'New projects for this client start as metro (60 sq m affordable limit). Override per project if one falls outside the metro list.'
                    : 'New projects for this client start as non-metro (90 sq m affordable limit) — the default for Gujarat property.'}
                </p>
              </div>
              <Switch
                checked={settings.default_is_metro}
                disabled={readOnly}
                onCheckedChange={(v) => patch({ default_is_metro: v })}
              />
            </div>
          </SectionCard>

          {/* ── Charge heads ─────────────────────────────────────────────── */}
          <SectionCard
            className="lg:col-span-2"
            title="3. Charges forming part of the unit price"
            description={(
              <>
                Whatever is switched on here forms the "gross amount charged" for the apartment. That one
                base decides both the ₹45 lakh affordable limit and the taxable value — they are the same
                statutory concept, which is why each head has a single switch rather than two.
              </>
            )}
          >
            <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
              {CHARGE_HEADS.map((head) => {
                const key = CHARGE_HEAD_SETTING_KEY[head] as keyof ChargeInclusionSettings;
                const on = settings[key] !== false;
                return (
                  <div
                    key={head}
                    className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{CHARGE_HEAD_LABEL[head]}</p>
                      <p className="text-[11px] text-muted-foreground">
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
            </div>
            <p className="text-[11px] text-muted-foreground">
              Stamp duty, registration charges and GST itself are never part of this base.
            </p>
          </SectionCard>

          {/* ── Extra work ───────────────────────────────────────────────── */}
          <SectionCard
            title="4. Extra / additional work billed to members"
            description="Modifications and upgrades charged over and above the unit price."
          >
            <RadioGroup
              value={settings.extra_work_rate}
              onValueChange={(v) => patch({ extra_work_rate: v as ExtraWorkRate })}
              disabled={readOnly}
              className="gap-1.5"
            >
              {(Object.keys(EXTRA_WORK_LABEL) as ExtraWorkRate[]).map((k) => (
                <label key={k} htmlFor={`extra-${k}`} className={optionClass(settings.extra_work_rate === k)}>
                  <RadioGroupItem value={k} id={`extra-${k}`} />
                  <span>{EXTRA_WORK_LABEL[k]}</span>
                </label>
              ))}
            </RadioGroup>
          </SectionCard>

          {/* ── Delay interest ───────────────────────────────────────────── */}
          <SectionCard
            title="5. Interest recovered on delayed instalments"
            description={(
              <>
                Section 15(2)(d) includes such interest in the value of the principal supply, which would
                carry the unit's own rate. A flat 18% is the more conservative election — it never
                under-charges, so it carries no exposure to the department, but it does cost the member more.
              </>
            )}
          >
            <RadioGroup
              value={settings.delay_interest_basis}
              onValueChange={(v) => patch({ delay_interest_basis: v as DelayInterestBasis })}
              disabled={readOnly}
              className="gap-1.5"
            >
              {(Object.keys(DELAY_INTEREST_LABEL) as DelayInterestBasis[]).map((k) => (
                <label key={k} htmlFor={`delay-${k}`} className={optionClass(settings.delay_interest_basis === k)}>
                  <RadioGroupItem value={k} id={`delay-${k}`} />
                  <span>{DELAY_INTEREST_LABEL[k]}</span>
                </label>
              ))}
            </RadioGroup>
          </SectionCard>

          {/* ── Excess tax ───────────────────────────────────────────────── */}
          <SectionCard
            title="6. Excess tax paid on GST-inclusive receipts"
            description={(
              <>
                Where a receipt was inclusive of GST but tax was computed on the whole figure, tax has been
                paid on the tax. This is how the excess is dealt with once the receipt is restated.
              </>
            )}
          >
            <RadioGroup
              value={settings.excess_tax_treatment}
              onValueChange={(v) => patch({ excess_tax_treatment: v as ExcessTaxTreatment })}
              disabled={readOnly}
              className="gap-1.5"
            >
              {(Object.keys(EXCESS_TAX_LABEL) as ExcessTaxTreatment[]).map((k) => (
                <label key={k} htmlFor={`excess-${k}`} className={optionClass(settings.excess_tax_treatment === k)}>
                  <RadioGroupItem value={k} id={`excess-${k}`} />
                  <span>{EXCESS_TAX_LABEL[k]}</span>
                </label>
              ))}
            </RadioGroup>
          </SectionCard>

          {/* ── FSI ──────────────────────────────────────────────────────── */}
          <SectionCard
            title="7. TDR / FSI under reverse charge — default"
            description={(
              <>
                Overridable per project. Choosing not to pay requires the client's written instruction on
                file and GST Manager sign-off before the affected return can be filed.
              </>
            )}
          >
            <RadioGroup
              value={settings.default_fsi_treatment}
              onValueChange={(v) => patch({ default_fsi_treatment: v as FsiTreatment })}
              disabled={readOnly}
              className="gap-1.5"
            >
              {(Object.keys(FSI_TREATMENT_LABEL) as FsiTreatment[]).map((k) => (
                <label key={k} htmlFor={`fsi-${k}`} className={optionClass(settings.default_fsi_treatment === k)}>
                  <RadioGroupItem value={k} id={`fsi-${k}`} />
                  <span>{FSI_TREATMENT_LABEL[k]}</span>
                </label>
              ))}
            </RadioGroup>
            {settings.default_fsi_treatment === 'IGNORE' && (
              <Note tone="warn">
                The TDR/FSI liability crystallises on the BU date. Returns for a period carrying an
                ignored FSI liability stay blocked until the client's written instruction is attached
                and approved by the GST Manager.
              </Note>
            )}
          </SectionCard>

          {/* ── Confirmation trail ───────────────────────────────────────── */}
          <SectionCard
            className="lg:col-span-2"
            title={(
              <span className="flex flex-wrap items-center gap-1.5">
                8. Client confirmation
                {confirmationState === 'received' && (
                  <Badge variant="success" className="gap-1 text-[10px] font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Confirmed
                  </Badge>
                )}
                {confirmationState === 'sent' && (
                  <Badge variant="warning" className="text-[10px] font-medium">Awaiting reply</Badge>
                )}
                {confirmationState === 'none' && (
                  <Badge variant="outline" className="text-[10px] font-medium">Not sent</Badge>
                )}
              </span>
            )}
            description={(
              <>
                The elections above are the client's, not ours. Send the letter from {`gst@vjdesai.com`},
                then record their reply here.
              </>
            )}
            actions={!readOnly && settings.confirmation_sent_at && !settings.confirmation_received_at ? (
              <Button variant="outline" size="sm" className={WS_BTN} onClick={markReceived}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mark confirmation received
              </Button>
            ) : undefined}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiTile label="Letter sent" value={<span className="text-xs">{fmtWhen(settings.confirmation_sent_at)}</span>} />
              <KpiTile
                label="Reply received"
                value={<span className="text-xs">{fmtWhen(settings.confirmation_received_at)}</span>}
                tone={settings.confirmation_received_at ? 'ok' : 'neutral'}
              />
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="block space-y-0.5" htmlFor="conf-doc">
                <span className={cn(WS_FILTER_LABEL, 'flex items-center gap-1')}>
                  <Paperclip className="h-3 w-3" />
                  Link to the client's written confirmation
                </span>
                <Input
                  id="conf-doc"
                  className={WS_CONTROL}
                  value={settings.confirmation_document_url || ''}
                  disabled={readOnly}
                  placeholder="Paste a link to the email or scanned letter"
                  onChange={(e) => patch({ confirmation_document_url: e.target.value })}
                />
              </label>

              <label className="block space-y-0.5" htmlFor="conf-notes">
                <span className={WS_FILTER_LABEL}>Notes</span>
                <Textarea
                  id="conf-notes"
                  rows={2}
                  className="min-h-[2rem] text-xs"
                  value={settings.confirmation_notes || ''}
                  disabled={readOnly}
                  placeholder="Anything the client asked to change, and what was agreed"
                  onChange={(e) => patch({ confirmation_notes: e.target.value })}
                />
              </label>
            </div>

            {selectedClient && !selectedClient.email && (
              <Note tone="warn">
                No email address on file for {selectedClient.name}. Add one on the client record before
                sending the confirmation letter.
              </Note>
            )}
          </SectionCard>
        </div>
      )}

      {!selectedClientId && !isLoading && (
        <Card>
          <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
            <Building2 className="mx-auto mb-2 h-6 w-6 opacity-40" />
            Select a builder client to capture their GST elections.
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BuilderSettingsPage;
