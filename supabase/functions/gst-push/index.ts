// Supabase Edge Function: gst-push
// -----------------------------------------------------------------------------
// Pushes a single client's stored GSTR-1 return for a given period to the GST
// portal via the Humonex Push API (https://app.humonex.com/api/v1/gst-push/run).
//
// Why this runs server-side (and not from the browser):
//   * The Humonex bearer token is a SECRET. It must never ship in the frontend
//     bundle. Here it lives only in the HUMONEX_BEARER_TOKEN function secret.
//   * Humonex is a server-to-server API and will typically block a browser
//     (CORS) call. The frontend calls THIS function; this function calls Humonex.
//   * The client's GST-portal username/password are read from the DB with the
//     service-role key, so they never travel through the browser at push time.
//
// Request body (from the app): { clientId, periodMonth, actorId?, actorRole? }
//   - periodMonth is "MM/YYYY" (the app's shared MonthContext format).
//
// Response: always HTTP 200 for anything we handle gracefully, with an `ok`
// boolean so the frontend can read `data` uniformly (supabase-js `invoke` only
// populates `data` on 2xx). Only unexpected crashes return 500.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HUMONEX_URL = 'https://app.humonex.com/api/v1/gst-push/run';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// "MM/YYYY" -> the filing-period fields Humonex expects, plus the short label
// ("May-26") that gstr1_data.period_month is keyed on. Uses the Indian financial
// year (Apr–Mar) for quarter and financial_year.
function derivePeriod(mmYyyy: string) {
  const [mmStr, yyyyStr] = String(mmYyyy).split('/');
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  if (!mm || mm < 1 || mm > 12 || !yyyy) return null;

  const shortLabel = `${MONTH_SHORT[mm - 1]}-${String(yyyy).slice(-2)}`;
  const period = MONTH_FULL[mm - 1];

  // Indian FY: Apr(4)..Dec belong to year Y; Jan..Mar belong to the prior year's FY.
  const fyStart = mm >= 4 ? yyyy : yyyy - 1;
  const fyEnd = fyStart + 1;
  const financialYear = `${fyStart}-${String(fyEnd).slice(-2)}`;

  let quarter: string;
  if (mm >= 4 && mm <= 6) quarter = 'Quarter 1 (Apr - Jun)';
  else if (mm >= 7 && mm <= 9) quarter = 'Quarter 2 (Jul - Sep)';
  else if (mm >= 10 && mm <= 12) quarter = 'Quarter 3 (Oct - Dec)';
  else quarter = 'Quarter 4 (Jan - Mar)';

  return { shortLabel, period, financialYear, quarter };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed. Use POST.' });

  try {
    const token = Deno.env.get('HUMONEX_BEARER_TOKEN');
    if (!token) {
      return json({
        ok: false,
        error: 'Server is not configured: HUMONEX_BEARER_TOKEN secret is missing.',
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, error: 'Request body is not valid JSON.' });
    }

    const clientId = payload?.clientId as string | undefined;
    const periodMonth = payload?.periodMonth as string | undefined;
    // actorRole from the client is intentionally ignored — the caller's real
    // permission is re-derived from the DB below (never trust a client-sent role).
    const actorId = (payload?.actorId as string | undefined) ?? null;

    if (!clientId || !periodMonth) {
      return json({ ok: false, error: 'clientId and periodMonth are required.' });
    }

    const derived = derivePeriod(periodMonth);
    if (!derived) {
      return json({ ok: false, error: `Invalid periodMonth "${periodMonth}" (expected "MM/YYYY").` });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 0) Authorize the caller SERVER-SIDE. The UI already hides the button, but
    // because this app uses custom (localStorage) auth there is no verifiable
    // session token, so we re-derive the actor's permission from the DB rather
    // than trusting the role the client sent. A caller must be a real staff
    // member who is superadmin/gst_manager, or an employee holding the
    // 'edit_filing_status' permission — mirroring canEditFilingStatus() in-app.
    if (!actorId) {
      return json({ ok: false, error: 'Not authorized: missing actor identity.' });
    }
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', actorId)
      .maybeSingle();
    const resolvedRole = roleRow?.role as string | undefined;
    const STAFF_ROLES = ['superadmin', 'gst_manager', 'employee'];
    if (!resolvedRole || !STAFF_ROLES.includes(resolvedRole)) {
      return json({ ok: false, error: 'Not authorized to push returns to the GST portal.' });
    }
    let authorized = resolvedRole === 'superadmin' || resolvedRole === 'gst_manager';
    if (!authorized) {
      const { data: permRow } = await supabase
        .from('user_permissions')
        .select('permission_key')
        .eq('user_id', actorId)
        .eq('permission_key', 'edit_filing_status')
        .maybeSingle();
      authorized = !!permRow;
    }
    if (!authorized) {
      return json({ ok: false, error: 'You do not have permission to push returns to the GST portal.' });
    }

    // 1) Client + GST-portal credentials (stored on the client record).
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name, gstin, gst_user_id, gst_password')
      .eq('id', clientId)
      .maybeSingle();

    if (clientErr) return json({ ok: false, error: `Failed to load client: ${clientErr.message}` });
    if (!client) return json({ ok: false, error: 'Client not found.' });
    if (!client.gst_user_id || !client.gst_password) {
      return json({
        ok: false,
        error: `GST portal credentials are not set for ${client.name}. Add the GST User ID and Password on the client record first.`,
      });
    }

    // 2) The stored GSTR-1 payload for this client + period.
    const { data: gstr1, error: gstr1Err } = await supabase
      .from('gstr1_data')
      .select('raw_json, file_name')
      .eq('client_id', clientId)
      .eq('period_month', derived.shortLabel)
      .maybeSingle();

    if (gstr1Err) return json({ ok: false, error: `Failed to load GSTR-1 data: ${gstr1Err.message}` });
    if (!gstr1 || !gstr1.raw_json) {
      return json({
        ok: false,
        error: `No GSTR-1 data saved for ${client.name} for ${derived.shortLabel}. Import the JSON first.`,
      });
    }

    // Guard against pushing one client's return under another's GSTIN.
    const jsonGstin = (gstr1.raw_json as Record<string, unknown>)?.gstin as string | undefined;
    if (jsonGstin && client.gstin && jsonGstin.toUpperCase() !== client.gstin.toUpperCase()) {
      return json({
        ok: false,
        error: `GSTIN mismatch: the saved GSTR-1 JSON is for ${jsonGstin} but ${client.name}'s GSTIN is ${client.gstin}. Re-import the correct file.`,
      });
    }

    // 3) Build the Humonex request and send it.
    const humonexBody = {
      username: client.gst_user_id,
      password: client.gst_password,
      quarter: derived.quarter,
      financial_year: derived.financialYear,
      period: derived.period,
      gstr1_json: gstr1.raw_json,
    };

    let httpStatus = 0;
    let response: unknown = null;
    try {
      const resp = await fetch(HUMONEX_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(humonexBody),
      });
      httpStatus = resp.status;
      const text = await resp.text();
      try {
        response = JSON.parse(text);
      } catch {
        response = text;
      }
    } catch (e) {
      return json({
        ok: false,
        error: `Could not reach Humonex: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const ok = httpStatus >= 200 && httpStatus < 300;
    const pushMessage = ok
      ? null
      : (typeof response === 'object' && response !== null
          ? ((response as Record<string, unknown>).message ?? (response as Record<string, unknown>).error ?? `HTTP ${httpStatus}`)
          : (typeof response === 'string' && response ? response : `HTTP ${httpStatus}`));

    // Persist the "last pushed" status onto the return so the team can see what
    // has already been filed. Best-effort: if the push-status columns are not
    // present yet (migration not applied), this quietly no-ops.
    try {
      await supabase
        .from('gstr1_data')
        .update({
          last_pushed_at: new Date().toISOString(),
          last_push_status: ok ? 'success' : 'failed',
          last_push_by: actorId,
          last_push_message: pushMessage,
        })
        .eq('client_id', clientId)
        .eq('period_month', derived.shortLabel);
    } catch (_) {
      // ignore — never block the push result on a status write
    }

    // Best-effort audit trail (reuses the existing audit_log table). Never let a
    // logging failure change the push result the operator sees.
    try {
      await supabase.from('audit_log').insert({
        user_id: actorId,
        user_role: resolvedRole,
        client_id: client.id,
        client_name: client.name,
        module: 'GSTR-1 Push',
        action: ok ? 'push_success' : 'push_failed',
        financial_year: derived.financialYear,
        details: {
          period: derived.period,
          quarter: derived.quarter,
          period_month: derived.shortLabel,
          gstin: client.gstin,
          file_name: gstr1.file_name,
          http_status: httpStatus,
          response,
        },
      });
    } catch (_) {
      // ignore
    }

    return json({
      ok,
      httpStatus,
      quarter: derived.quarter,
      period: derived.period,
      financialYear: derived.financialYear,
      periodMonth: derived.shortLabel,
      response,
      ...(ok ? {} : { error: `Humonex rejected the push (HTTP ${httpStatus}).` }),
    });
  } catch (e) {
    // Truly unexpected — surface as a 500 so the client shows a hard failure.
    return json(
      { ok: false, error: `Unexpected server error: ${e instanceof Error ? e.message : String(e)}` },
      500,
    );
  }
});
