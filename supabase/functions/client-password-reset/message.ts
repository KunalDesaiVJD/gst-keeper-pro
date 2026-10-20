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

/**
 * The app's address, fixed in code. The database fixes it too
 * (client_password_reset_claim); it is never read from a setting, since the
 * app's tables can be changed with the anon key and a link to another site
 * would hand that site a working token.
 */
export const APP_ORIGIN = 'https://gst.vjdesai.com';

/** The sign-in page, always on the app's own address. */
export const LOGIN_URL = `${APP_ORIGIN}/login`;

/**
 * The link to e-mail: exactly the app's reset page with this row's token.
 * Anything else (another site, another token) is refused, and the mailer
 * reports the link as failed instead of sending it.
 */
export function checkedLink(row: Pick<ClaimedLink, 'token' | 'link'>): string {
  const token = String(row.token ?? '');
  const expected = `${APP_ORIGIN}/reset-password#token=${token}`;
  if (!/^[0-9a-f]{64}$/.test(token) || row.link !== expected) {
    throw new Error('refused: the reset link does not point at the app');
  }
  return expected;
}

export function resetEmail(row: ClaimedLink): { subject: string; html: string } {
  // The link is ours (the fixed address plus a hex token, checked); it is
  // still escaped like everything else that goes into the HTML.
  const link = esc(checkedLink(row));
  const login = esc(LOGIN_URL);
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
