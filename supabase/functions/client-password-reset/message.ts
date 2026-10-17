// The reset e-mail. Fixed in code on purpose: email_templates can be edited by
// anyone holding the anon key, and this message carries a sign-in link.
import { buildEmailHtml } from '../_shared/email.ts';

export interface ClaimedLink {
  reset_id: string;
  token: string;
  link: string;
  client_id: string;
  client_name: string;
  gstin: string;
  to_email: string;
  expires_at: string;
  via: 'self' | 'staff' | string;
}

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The sign-in page next to the reset page (same origin as the link). */
export function loginUrl(link: string): string {
  try {
    return new URL('/login', link).toString();
  } catch {
    return 'https://gst.vjdesai.com/login';
  }
}

export function resetEmail(row: ClaimedLink): { subject: string; html: string } {
  // The link is ours (the base URL from settings plus a hex token); it is still
  // escaped like everything else that goes into the HTML.
  const link = esc(row.link);
  const login = esc(loginUrl(row.link));
  const opening = row.via === 'staff'
    ? 'Our team has sent you this link so that you can set a new password for the GST client portal of V. J. Desai &amp; Co. LLP.'
    : 'We received a request to reset the password you use to sign in to the GST client portal of V. J. Desai &amp; Co. LLP.';
  const message = [
    opening,
    'Use the button above to choose a new password. The link works once and expires in 60 minutes.',
    `If the button does not work, copy this address into your browser:\n<a href="${link}" style="color:#0f2b46;word-break:break-all;">${link}</a>`,
    `Afterwards, sign in at <a href="${login}" style="color:#0f2b46;">${login}</a> with your GSTIN as the User ID and your new password.`,
    'If you did not ask for this, you can ignore this e-mail: your current password keeps working.',
  ].join('\n\n');
  const html = buildEmailHtml({
    key: 'client_password_reset',
    kind: 'client_password_reset',
    message,
    vars: {
      client_name: esc(row.client_name),
      gstin: esc(row.gstin),
      user_id: esc(row.gstin),
      valid_for: '60 minutes, one use',
      cta_url: link,
      cta_label: 'Set a new password',
    },
  });
  return { subject: `Reset your password · ${row.client_name}`, html };
}
