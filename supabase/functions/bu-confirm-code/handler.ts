// The request handling of bu-confirm-code, apart from Deno.serve, Supabase
// and Graph so test/handler.test.ts can drive it with fakes.
import { checkedAddress, type ClaimedCode, codeEmail } from './message.ts';

export interface Deps {
  /** builder_bu_confirm_code_claim / _mark through the service role. */
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** Sends one message to one address (no copy in Sent Items). */
  send: (to: string, subject: string, html: string) => Promise<void>;
  log?: (line: string) => void;
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((l: string) => console.log(l));
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (o: unknown, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    let codeId = '';
    try {
      codeId = String(((await req.json()) as { code_id?: unknown })?.code_id ?? '');
    } catch {
      codeId = '';
    }
    if (!UUID_RE.test(codeId)) return json({ ok: false, status: 'none' }, 400);

    const { data, error } = await deps.rpc('builder_bu_confirm_code_claim', { p_code_id: codeId });
    if (error) {
      log(`bu-confirm-code: claim ${codeId} failed: ${error.message}`);
      return json({ ok: false, status: 'failed' }, 500);
    }
    const row = ((data ?? []) as ClaimedCode[])[0];
    if (!row) return json({ ok: true, status: 'none' });

    let problem: string | null = null;
    try {
      const to = checkedAddress(row.to_email);
      const { subject, html } = codeEmail(row);
      await deps.send(to, subject, html);
    } catch (e) {
      problem = ((e as Error)?.message || 'send error').slice(0, 500);
    }
    log(`bu-confirm-code: ${row.code_id} ${problem ? 'failed: ' + problem : 'sent'}`);
    const mark = await deps.rpc('builder_bu_confirm_code_mark', { p_code_id: row.code_id, p_error: problem });
    if (mark.error) log(`bu-confirm-code: mark ${row.code_id} failed: ${mark.error.message}`);
    // Never the code, never the Graph error: the caller is the public page.
    return json({ ok: !problem, status: problem ? 'failed' : 'sent' });
  };
}
