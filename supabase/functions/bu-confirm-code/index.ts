// bu-confirm-code — e-mails the one-time code a reader of a BU agreement
// value confirmation link asked for (migration 20261021140000_bu_confirm_cc.sql,
// docs/BUILDER_GST_POSITIONS.md section 6).
//
// The public page asks the database for a code (builder_bu_confirm_code_request,
// which checks the address is one the request went to, outside the firm, and
// the limits) and then calls this function with the code_id it got. Here,
// with the service role, builder_bu_confirm_code_claim mints the code (only
// its hash is stored) and hands it over; it is e-mailed through Microsoft
// Graph to that one address, and reported with builder_bu_confirm_code_mark.
// The code never goes through email_outbox (the anon key can read it), and
// the message is not kept in the shared mailbox's Sent Items (_shared/graph.ts
// sendMail, saveToSentItems false): a staff member who can open the firm's
// mailbox must not be able to read a client's code there.
//
// The e-mail is marked with the code's reference (codeRef in message.ts, 4
// letters from the code id, as builder_bu_confirm_code_ref and the page work
// it out, migration 20261021160000), so a reader who gets codes asked for by
// two pages types the one their page shows. The database refuses to mint a
// code over the daily ceilings (it then sends nothing).
//
// Input: { code_id } only. What is sent, and to whom, comes from the
// database. A code_id already claimed, or older than 15 minutes, sends
// nothing. Answers { ok, status: 'sent' | 'failed' | 'none' } and never the
// code or the Graph error. Never logs a code.
//
// Secrets: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER.
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { graphToken, sendMail } from '../_shared/graph.ts';
import { makeHandler } from './handler.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
});

Deno.serve(makeHandler({
  rpc: (fn, args) => sb.rpc(fn, args),
  send: async (to, subject, html) => sendMail(await graphToken(), to, subject, html),
}));
