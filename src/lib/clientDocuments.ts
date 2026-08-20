// Every PDF the extension has ever captured for a client, normalized into one
// shape and pulled from wherever it actually lives — filing_status (filed
// return PDFs), gst_drc03_filings (one per filing), gst_refund_applications
// (a jsonb array — 2A/2B/order/etc. per application, an open-ended set per
// refund reason), gst_taxpayer_profile (the Registration Certificate).
// Reference: Power GST's "Browse Software Files" link only works because it's
// a desktop app with a local download folder to point at; a browser-based
// multi-user app has no equivalent local folder, so this in-app library is
// the actual replacement, not a copy of that pattern.
import { supabase } from '@/integrations/supabase/client';

export type DocumentSource = 'Filed Return' | 'DRC-03' | 'Refund Application' | 'Registration Certificate';

export interface ClientDocument {
  id: string;
  source: DocumentSource;
  title: string;
  detail: string;
  date: string | null; // ISO, for sorting; null sorts last
  url: string;
}

interface RefundDoc { tab: string; label: string; url: string; }

export const fetchClientDocuments = async (clientId: string): Promise<ClientDocument[]> => {
  const [filed, drc03, refunds, profile] = await Promise.all([
    supabase.from('filing_status')
      .select('id, return_type, period_month, filed_date, return_pdf_url')
      .eq('client_id', clientId).not('return_pdf_url', 'is', null),
    supabase.from('gst_drc03_filings')
      .select('id, arn, cause_of_payment, filed_date, pdf_url')
      .eq('client_id', clientId).not('pdf_url', 'is', null),
    supabase.from('gst_refund_applications')
      .select('id, arn, refund_type, filed_date, documents')
      .eq('client_id', clientId),
    supabase.from('gst_taxpayer_profile')
      .select('id, registration_certificate_url, pulled_at')
      .eq('client_id', clientId).not('registration_certificate_url', 'is', null).maybeSingle(),
  ]);

  const docs: ClientDocument[] = [];

  for (const r of filed.data || []) {
    if (!r.return_pdf_url) continue;
    docs.push({
      id: `filed-${r.id}`, source: 'Filed Return',
      title: `${r.return_type} — ${r.period_month}`,
      detail: r.filed_date ? `Filed ${r.filed_date}` : '—',
      date: r.filed_date, url: r.return_pdf_url,
    });
  }

  for (const r of drc03.data || []) {
    if (!r.pdf_url) continue;
    docs.push({
      id: `drc03-${r.id}`, source: 'DRC-03',
      title: r.arn || 'DRC-03 filing',
      detail: r.cause_of_payment || '—',
      date: r.filed_date, url: r.pdf_url,
    });
  }

  for (const r of refunds.data || []) {
    const list = Array.isArray(r.documents) ? (r.documents as RefundDoc[]) : [];
    for (const d of list) {
      if (!d.url) continue;
      docs.push({
        id: `refund-${r.id}-${d.tab}-${d.label}`, source: 'Refund Application',
        title: `${r.arn || 'Refund'} — ${d.label}`,
        detail: `${d.tab} · ${r.refund_type || '—'}`,
        date: r.filed_date, url: d.url,
      });
    }
  }

  if (profile.data?.registration_certificate_url) {
    docs.push({
      id: `regcert-${profile.data.id}`, source: 'Registration Certificate',
      title: 'Registration Certificate',
      detail: 'Taxpayer Profile',
      date: null, url: profile.data.registration_certificate_url,
    });
  }

  docs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return docs;
};
