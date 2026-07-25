import { supabase } from '@/integrations/supabase/client';

// Firm identity used to fill the {{firm_*}} template variables. gst@vjdesai.com
// is fixed (the sending address); phone is left blank for the firm to fill in
// the template footer or here later.
export const GST_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  email: 'gst@vjdesai.com',
  phone: '',
  team: 'V. J. Desai & Co. (GST Team)',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'MM/YYYY' → 'July 2025' (falls back to the raw string if unparseable). */
export function prettyPeriod(mmYYYY?: string | null): string {
  if (!mmYYYY) return '';
  const m = /^(\d{1,2})\/(\d{4})$/.exec(mmYYYY.trim());
  if (!m) return mmYYYY;
  const mi = Number(m[1]) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${m[2]}` : mmYYYY;
}

/** Substitute {{var}} tokens; an unknown/absent variable renders as ''. */
export function renderTemplate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

type EnqueueResult = 'queued' | 'skipped' | 'error';

/**
 * Queue the filing-confirmation email for a client whose return was just marked
 * "Filed". Writes a `pending` row to email_outbox — the actual send happens
 * later via the gst@vjdesai.com sender. Best-effort and idempotent (the DB
 * unique index blocks a second confirmation for the same client/return/period).
 * Never throws to the caller.
 */
export async function enqueueConfirmation(opts: {
  clientId: string;
  returnType: string;
  periodMonth: string;
  arn: string;
  filedDate: string;
  filingStatusId?: string | null;
  staffName?: string | null;
}): Promise<EnqueueResult> {
  try {
    // Confirmation is ON by default; only skip if the client explicitly turned it off.
    const { data: st } = await supabase
      .from('client_reminder_settings')
      .select('send_confirmation')
      .eq('client_id', opts.clientId)
      .maybeSingle();
    if (st && st.send_confirmation === false) return 'skipped';

    const { data: client } = await supabase
      .from('clients')
      .select('name, email, gstin')
      .eq('id', opts.clientId)
      .maybeSingle();
    if (!client?.email) return 'skipped'; // no address on file → nothing to send

    const { data: tpl } = await supabase
      .from('email_templates')
      .select('subject, body, is_active')
      .eq('key', 'confirmation')
      .maybeSingle();
    if (!tpl || tpl.is_active === false) return 'skipped';

    const vars: Record<string, string> = {
      contact_person: client.name,
      client_name: client.name,
      gstin: client.gstin ?? '',
      return_type: opts.returnType,
      period: prettyPeriod(opts.periodMonth),
      arn: opts.arn,
      filing_date: opts.filedDate,
      staff_name: opts.staffName || GST_FIRM.team,
      firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email,
      firm_phone: GST_FIRM.phone,
      due_date: '',
      data_by_date: '',
    };

    const { error } = await supabase.from('email_outbox').insert({
      client_id: opts.clientId,
      to_email: client.email,
      kind: 'confirmation',
      template_key: 'confirmation',
      return_type: opts.returnType as never,
      period_month: opts.periodMonth,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      status: 'pending',
      filing_status_id: opts.filingStatusId ?? null,
    });
    if (error) {
      // 23505 = the confirmation for this (client, return, period) is already queued.
      if ((error as { code?: string }).code === '23505') return 'skipped';
      throw error;
    }
    return 'queued';
  } catch (e) {
    console.warn('[gstReminders] enqueueConfirmation failed (non-fatal):', (e as Error)?.message);
    return 'error';
  }
}
