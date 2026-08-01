import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';
import {
  CHARGE_HEADS,
  CHARGE_HEAD_LABEL,
  CHARGE_HEAD_SETTING_KEY,
  type ChargeHead,
  type ChargeInclusionSettings,
} from '@/utils/builderRates';

// Per-builder-client elections. Captured as a questionnaire at setup and then
// confirmed by the client in writing, because each one changes the GST charged
// to their members and the returns we file for them.

export type ExtraWorkRate = 'UNIT_RATE' | 'EIGHTEEN';
export type DelayInterestBasis = 'FLAT_18' | 'UNIT_RATE';
export type ExcessTaxTreatment = 'ADJUST' | 'REFUND' | 'ABSORB';
export type FsiTreatment = 'PAY' | 'IGNORE';

export interface BuilderClientSettings extends ChargeInclusionSettings {
  client_id: string;
  /**
   * False for a promoter who never raises a milestone tax invoice — every
   * rupee is either an advance (Table 11A) or falls due at the BU/dastavej
   * differential. Hides the manual invoicing controls on the ledger; the
   * automatic BU differential invoice still fires regardless, since that one
   * isn't something staff raise by hand.
   */
  raises_invoices: boolean;
  /**
   * Default metro/non-metro for a NEW project created for this client — set
   * once here instead of re-selected on every project, since every one of
   * this firm's clients builds on Gujarat property and no Gujarat city is on
   * the metro list. An existing project's own election is never touched by
   * changing this.
   */
  default_is_metro: boolean;
  extra_work_rate: ExtraWorkRate;
  delay_interest_basis: DelayInterestBasis;
  excess_tax_treatment: ExcessTaxTreatment;
  default_fsi_treatment: FsiTreatment;
  confirmation_outbox_id: string | null;
  confirmation_sent_at: string | null;
  confirmation_received_at: string | null;
  confirmation_document_url: string | null;
  confirmation_notes: string | null;
}

export const DEFAULT_BUILDER_SETTINGS: Omit<BuilderClientSettings, 'client_id'> = {
  raises_invoices: true,
  default_is_metro: false,
  incl_plc: true,
  incl_development: true,
  incl_parking: true,
  incl_club: true,
  incl_utility_deposit: true,
  incl_legal: true,
  incl_maintenance_corpus: true,
  incl_other: true,
  extra_work_rate: 'EIGHTEEN',
  delay_interest_basis: 'FLAT_18',
  excess_tax_treatment: 'ADJUST',
  default_fsi_treatment: 'PAY',
  confirmation_outbox_id: null,
  confirmation_sent_at: null,
  confirmation_received_at: null,
  confirmation_document_url: null,
  confirmation_notes: null,
};

// Re-exported so existing importers keep working; the list itself now lives in
// builderRates.ts so pure modules can use it without pulling in the DB client.
export { CHARGE_HEADS } from '@/utils/builderRates';

export const EXTRA_WORK_LABEL: Record<ExtraWorkRate, string> = {
  UNIT_RATE: "At the unit's own rate (1.5% / 7.5% / 18% on 2/3rd value)",
  EIGHTEEN: '18% — treated as a supply separate from construction',
};

export const DELAY_INTEREST_LABEL: Record<DelayInterestBasis, string> = {
  FLAT_18: '18% flat',
  UNIT_RATE: "At the unit's own rate — s.15(2)(d) treatment",
};

export const EXCESS_TAX_LABEL: Record<ExcessTaxTreatment, string> = {
  ADJUST: "Adjust against the project's future liability",
  REFUND: 'Claim refund u/s 54 (2-year limit from the relevant date)',
  ABSORB: 'Absorb — no adjustment claimed',
};

export const FSI_TREATMENT_LABEL: Record<FsiTreatment, string> = {
  PAY: 'Pay RCM @18% on TDR / FSI',
  IGNORE: "Do not pay — requires the client's written instruction on file",
};

/** Settings for a client, falling back to defaults when none are saved yet. */
export async function fetchBuilderSettings(clientId: string): Promise<BuilderClientSettings> {
  const { data } = await supabase
    .from('builder_client_settings')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (!data) return { client_id: clientId, ...DEFAULT_BUILDER_SETTINGS };
  return data as unknown as BuilderClientSettings;
}

/** Renders the charge-head block that goes into the confirmation letter. */
export function describeChargeHeads(settings: ChargeInclusionSettings): string {
  return CHARGE_HEADS.map((head) => {
    const key = CHARGE_HEAD_SETTING_KEY[head] as keyof ChargeInclusionSettings;
    const included = settings[key] !== false;
    return `   ${included ? '[INCLUDED]' : '[EXCLUDED]'}  ${CHARGE_HEAD_LABEL[head]}`;
  }).join('\n');
}

// Flat rather than a discriminated union: this project compiles with
// `strict: false` / `strictNullChecks: false`, under which TypeScript will not
// narrow a union by a boolean discriminant, so `res.reason` after `!res.ok`
// would not type-check.
interface QueueResult {
  ok: boolean;
  outboxId?: string;
  reason?: string;
}

/**
 * Queue the setup-confirmation letter for a builder client.
 *
 * Writes a `pending` row to email_outbox — the same queue the reminders use, so
 * the existing gst@vjdesai.com sender picks it up. Returns the outbox id so the
 * settings row can point at the letter that was sent.
 */
export async function enqueueBuilderSetupConfirmation(opts: {
  clientId: string;
  settings: BuilderClientSettings;
  staffName?: string | null;
}): Promise<QueueResult> {
  const { data: client } = await supabase
    .from('clients')
    .select('name, email, gstin')
    .eq('id', opts.clientId)
    .maybeSingle();
  if (!client) return { ok: false, reason: 'Client not found.' };
  if (!client.email) return { ok: false, reason: 'No email address on file for this client.' };

  const { data: tpl } = await supabase
    .from('email_templates')
    .select('subject, body, is_active')
    .eq('key', 'builder_setup_confirmation')
    .maybeSingle();
  if (!tpl) return { ok: false, reason: 'Template "builder_setup_confirmation" is missing.' };
  if (tpl.is_active === false) return { ok: false, reason: 'The setup-confirmation template is inactive.' };

  const s = opts.settings;
  const vars: Record<string, string> = {
    contact_person: client.name,
    client_name: client.name,
    gstin: client.gstin ?? '',
    charge_heads: describeChargeHeads(s),
    extra_work_rate: EXTRA_WORK_LABEL[s.extra_work_rate],
    delay_interest_basis: DELAY_INTEREST_LABEL[s.delay_interest_basis],
    fsi_treatment: FSI_TREATMENT_LABEL[s.default_fsi_treatment],
    staff_name: opts.staffName || GST_FIRM.team,
    firm_name: GST_FIRM.name,
    firm_email: GST_FIRM.email,
    firm_phone: GST_FIRM.phone,
  };

  const { data, error } = await supabase
    .from('email_outbox')
    .insert({
      client_id: opts.clientId,
      to_email: client.email,
      kind: 'builder_setup' as never,
      template_key: 'builder_setup_confirmation',
      return_type: null,
      period_month: null,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      render_vars: vars,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, reason: error?.message || 'Could not queue the email.' };

  // Flush now so the letter goes out immediately; the daily cron is the backstop.
  void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
  return { ok: true, outboxId: data.id };
}
