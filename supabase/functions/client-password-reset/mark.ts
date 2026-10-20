// Reporting a link back to the database (client_password_reset_mark), with
// retries. Once the e-mail has gone, a report that does not arrive would leave
// the link claimed and unconfirmed: the database voids it after 15 minutes
// ("the send could not be confirmed") and asks staff, while the client holds
// a dead link. So the report is retried a few times, waiting longer each
// time. A repeat is safe: the database keeps a link's first report and
// ignores any after it (a report can arrive and still fail on the way back).

/** One call of the report; supabase-js answers with { error }, or throws on a network failure. */
export type MarkCall = () => PromiseLike<{ error: { message: string } | null }>;

export interface MarkOutcome {
  ok: boolean;
  /** How many times the report was made. */
  attempts: number;
  /** The last error, when every attempt failed. */
  error?: string;
}

/** The waits between attempts: four attempts in all, about 6 seconds. */
export const MARK_RETRY_DELAYS_MS: readonly number[] = [500, 1500, 4000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function markWithRetry(
  call: MarkCall,
  opts: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<MarkOutcome> {
  const delays = opts.delays ?? MARK_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? wait;
  let last = '';
  for (let attempt = 1; ; attempt++) {
    try {
      const { error } = await call();
      if (!error) return { ok: true, attempts: attempt };
      last = error.message || 'the report failed';
    } catch (e) {
      last = (e as Error)?.message || String(e);
    }
    if (attempt > delays.length) return { ok: false, attempts: attempt, error: last };
    await sleep(delays[attempt - 1]);
  }
}
