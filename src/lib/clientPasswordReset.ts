// Client app-login passwords: the e-mailed reset link and staff resets.
// Everything is decided in the database (migration 20261020140000, positions
// in docs/CLIENT_PASSWORD_RESET.md); the Edge Function client-password-reset
// sends the e-mails. The browser never sees a token except the one in the
// link the client opened.
import { supabase } from '@/integrations/supabase/client';

/** What the login page says after any request, whatever happened. */
export const RESET_REQUESTED_MESSAGE =
  'If this GSTIN or User ID is registered with us, a link to set a new password is on its way to the e-mail address we hold for it. ' +
  'If we cannot e-mail one, our team will reset it and contact you. ' +
  'The link works once, for 60 minutes. If nothing arrives, check your spam folder or write to gst@vjdesai.com.';

/** Wakes the mailer now (the database wakes it too); its answer says nothing. */
function wakeMailer(): void {
  void supabase.functions.invoke('client-password-reset', { body: {} }).catch(() => undefined);
}

/** A client asks for a link by GSTIN or User ID. Resolves the same way for every outcome. */
export async function requestClientPasswordReset(identifier: string): Promise<void> {
  const { error } = await supabase.rpc('client_password_reset_request', { p_identifier: identifier.trim() });
  if (error) throw new Error(error.message);
  wakeMailer();
}

/** The token from the link: #token=… (what the e-mail sends) or ?token=…. */
export function extractResetToken(hash: string, search: string): string | null {
  const read = (s: string) => new URLSearchParams(s.replace(/^[#?]/, '')).get('token');
  const t = (read(hash) || read(search) || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}

export interface ResetLinkState {
  valid: boolean;
  clientName?: string;
  gstinMasked?: string;
  expiresAt?: string;
}

export async function checkResetToken(token: string): Promise<ResetLinkState> {
  const { data, error } = await supabase.rpc('client_password_reset_check', { p_token: token });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { valid?: boolean; client_name?: string; gstin_masked?: string; expires_at?: string };
  return { valid: d.valid === true, clientName: d.client_name, gstinMasked: d.gstin_masked, expiresAt: d.expires_at };
}

/** Sets the new password with the link; returns the User ID (GSTIN) to sign in with. */
export async function completeClientPasswordReset(token: string, newPassword: string): Promise<{ userId: string }> {
  const { data, error } = await supabase.rpc('client_password_reset_complete', { p_token: token, p_new_password: newPassword });
  if (error) throw new Error(error.message);
  return { userId: String((data as { user_id?: string } | null)?.user_id ?? '') };
}

/** Any staff member sets a client's password (logged; voids open links). */
export async function staffSetClientPassword(actorId: string, clientId: string, newPassword: string, note?: string): Promise<void> {
  const { data, error } = await supabase.rpc('staff_set_client_password', {
    p_actor_id: actorId,
    p_client_id: clientId,
    p_new_password: newPassword,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw new Error(error.message);
  if (data === false) throw new Error('Client not found.');
}

/** Any staff member e-mails the client a reset link; returns where it goes. */
export async function staffEmailResetLink(actorId: string, clientId: string): Promise<{ sentTo: string }> {
  const { data, error } = await supabase.rpc('staff_send_client_reset_link', { p_actor_id: actorId, p_client_id: clientId });
  if (error) throw new Error(error.message);
  wakeMailer();
  return { sentTo: String((data as { sent_to?: string } | null)?.sent_to ?? '') };
}

export type ClientPasswordAction =
  | 'staff_reset' | 'link_queued' | 'link_sent' | 'link_failed' | 'link_voided' | 'link_used' | 'fallback_request';

export interface ClientPasswordLogEntry {
  id: string;
  at: string;
  action: ClientPasswordAction;
  actor_name: string | null;
  detail: string | null;
}

export const CLIENT_PASSWORD_ACTION_LABEL: Record<ClientPasswordAction, string> = {
  staff_reset: 'Set by staff',
  link_queued: 'Link asked for',
  link_sent: 'Link e-mailed',
  link_failed: 'E-mail failed',
  link_voided: 'Link voided',
  link_used: 'Set by the client',
  fallback_request: 'Request for staff',
};

/**
 * The client's password log, newest first. The table is private (it would
 * show anyone which GSTINs are clients and which have an e-mail);
 * client_password_log_for checks the reader holds a staff level.
 */
export async function loadClientPasswordLog(actorId: string, clientId: string, limit = 8): Promise<ClientPasswordLogEntry[]> {
  const { data, error } = await supabase.rpc('client_password_log_for', {
    p_actor_id: actorId,
    p_client_id: clientId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientPasswordLogEntry[];
}
