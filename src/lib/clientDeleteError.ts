// Plain-language message for a refused client delete.
//
// Since Phase 0 of the notices roadmap, a client that has notices, litigation
// matters or statutory deadlines on record cannot be deleted: the foreign keys
// from gst_notices / litigation_matters / matter_deadlines are ON DELETE RESTRICT
// (supabase/migrations/20261006103000_protect_client_notices_litigation.sql), so
// the firm's work on a dispute can no longer be erased by one click.
interface PostgrestLikeError { code?: string; message?: string }

export function describeClientDeleteError(error: PostgrestLikeError, many = false): string {
  const msg = error.message ?? '';
  if (error.code === '23503' || /violates foreign key constraint/i.test(msg)) {
    const what = /litigation_matters|matter_deadlines/.test(msg) ? 'litigation matters' : 'GST notices';
    return `${many ? 'One or more of the selected clients have' : 'This client has'} ${what} on record, so ${many ? 'they' : 'it'} can't be deleted. Mark ${many ? 'them' : 'it'} inactive in Edit Client instead.`;
  }
  return msg;
}
