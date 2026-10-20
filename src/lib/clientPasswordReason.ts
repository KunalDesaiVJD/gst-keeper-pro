// Why a client's request is waiting for staff on the Dashboard. The open
// request carries one fixed note for every reason ("Reset password shows
// why."), since password_reset_requests is open to the anon key; the reason
// is in the client's private password log, which every staff level reads
// through client_password_log_for. The reset dialog shows it, so nobody is
// sent to a screen they may not be able to open (Edit Client).

export interface PasswordLogLine {
  action: string;
  at: string;
  detail: string | null;
}

export interface FallbackReason {
  at: string;
  text: string;
}

// The sentence the database adds to every fallback_request entry
// (client_password_staff_request); in the dialog, opened from that very
// request, it says nothing.
const DASHBOARD_TAIL = /\s*A request is waiting on the Dashboard\.\s*$/;

const time = (at: string) => {
  const t = Date.parse(at);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * The newest 'fallback_request' entry (staff were asked because no link
 * reached the client), or null when the log holds none. The database files
 * one pending request per client and logs a reason only when it files one,
 * so the newest such entry is the reason for the request waiting now.
 */
export function latestFallbackReason(log: readonly PasswordLogLine[]): FallbackReason | null {
  let best: PasswordLogLine | null = null;
  for (const line of log) {
    if (line.action !== 'fallback_request') continue;
    if (!best || time(line.at) > time(best.at)) best = line;
  }
  if (!best) return null;
  const text = (best.detail ?? '').replace(DASHBOARD_TAIL, '').trim();
  return text ? { at: best.at, text } : null;
}
