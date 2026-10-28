// What an engagement letter's state and fingerprint are, apart from the
// database client so scripts/verify-engagement-letter.mjs checks them
// (src/lib/engagementLetters.ts re-exports them; migration 20261028110000).

/** What these rules read of a letter (an EngagementLetter of engagementLetters.ts). */
export interface LetterStateInput {
  status: 'ready' | 'sent' | 'signed' | 'revoked'; send_error: string | null; expires_at: string; created_at: string;
  first_opened_at: string | null; full_opened_at: string | null; declined_at: string | null;
}

/** How long a letter may stay "being sent" before it counts as not e-mailed. */
export const SENDING_MS = 10 * 60_000;

/** Where a letter stands, as the list shows it. */
export type LetterState = 'ready' | 'failed' | 'sent' | 'opened' | 'read' | 'changes' | 'signed' | 'expired' | 'revoked';
export function letterState(l: LetterStateInput, now = new Date()): LetterState {
  if (l.status === 'signed') return 'signed';
  if (l.status === 'revoked') return 'revoked';
  // A letter made but not e-mailed: failed, or never reached the mailer (10 minutes on).
  if (l.status === 'ready') return l.send_error || now.getTime() - new Date(l.created_at).getTime() > SENDING_MS ? 'failed' : 'ready';
  if (new Date(l.expires_at) < now) return 'expired';
  if (l.declined_at) return 'changes';
  if (l.full_opened_at) return 'read';
  if (l.first_opened_at) return 'opened';
  return 'sent';
}
export const LETTER_STATE: Record<LetterState, { label: string; tone: 'success' | 'info' | 'warning' | 'destructive' | 'secondary' }> = {
  ready: { label: 'Being sent', tone: 'secondary' },
  failed: { label: 'Not e-mailed', tone: 'destructive' },
  sent: { label: 'Sent, not opened', tone: 'info' },
  opened: { label: 'Summary opened', tone: 'info' },
  read: { label: 'Read in full', tone: 'info' },
  changes: { label: 'Changes asked', tone: 'warning' },
  signed: { label: 'Signed', tone: 'success' },
  expired: { label: 'Link expired', tone: 'warning' },
  revoked: { label: 'Withdrawn', tone: 'secondary' },
};


/** The letter as one text, exactly as the database fingerprints it (engagement_letter_doc_text). */
export function letterDocText(title: string, intro: string, clauses: { heading: string; text: string }[]): string {
  return [title, intro, clauses.map((c, i) => `${i + 1}. ${c.heading}\n${c.text}`).join('\n\n')].join('\n\n');
}
