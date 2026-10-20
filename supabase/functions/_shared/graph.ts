// Microsoft Graph mail, as send-gst-email does it: application permission
// Mail.Send, client-credentials flow, from GRAPH_SENDER (gst@vjdesai.com).
// Used by client-password-reset; send-gst-email still carries its own copy.
//
// Secrets (function env, never in the repo):
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER

const env = (k: string) => Deno.env.get(k) ?? '';

export async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: env('GRAPH_CLIENT_ID'),
    client_secret: env('GRAPH_CLIENT_SECRET'),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${env('GRAPH_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.access_token as string;
}

/** "a@x.com, b@y.in" or "a@x.com; b@y.in" → Graph recipients. */
export const recipients = (list: string | null | undefined) =>
  String(list ?? '').split(/[,;]+/).map((a) => a.trim()).filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

/** Sends one HTML message; throws unless Graph accepts it (202). */
export async function sendMail(token: string, to: string, subject: string, html: string): Promise<void> {
  const sender = env('GRAPH_SENDER') || 'gst@vjdesai.com';
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: subject || '(no subject)',
        body: { contentType: 'HTML', content: html },
        toRecipients: recipients(to),
      },
      // A reset link is not kept in the shared mailbox's Sent Items.
      saveToSentItems: false,
    }),
  });
  if (r.status !== 202) {
    const t = await r.text();
    throw new Error(`sendMail ${r.status}: ${t.slice(0, 400)}`);
  }
}
