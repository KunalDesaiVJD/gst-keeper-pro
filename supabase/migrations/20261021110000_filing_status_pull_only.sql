-- Filing Status is pulled from the portal only (the firm's decision of
-- 21 Oct 2026; docs/FILING_STATUS_PULL_ONLY.md). Extension 0.15.0 and the
-- Filing Status page go with it.
--
--  * Filed, the ARN, the filing date and the return PDF are written only by
--    filing_record_pull (the extension's portal pull: filed / refreshed /
--    conflict / refused) and filing_attach_manual (a staff member, under the
--    superadmin's manual_source_allowances entry for that client, period and
--    return, which it uses up). Pulled only, the firm's "1 & 3B": GSTR-1 and
--    GSTR-3B (monthly). GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 and GSTR-7 keep a
--    manual route, no allowance needed, until their pull is proven to work
--    (their pull stays and writes as for GSTR-1 / 3B); CMP-08 and ITC-04 have
--    no pull yet (round 3; filing_manual_reason says which).
--    Both need the Filing status permission (filing__can_edit: GST Manager,
--    superadmin, or an employee holding edit_filing_status). trigger_filing_status_source
--    refuses every other write, for every level, refuses moving a row that
--    holds a filed return to another client, period or return type, and
--    refuses deleting one (except by its client's cascade). Same pattern as
--    filing_status_guard_pushed: the routes set a transaction-local
--    app.filing_source.
--  * A pull is recorded only for a staff member's request (p_actor_id; the
--    request id and extension version are logged), and a PDF only at this
--    project's return-pdfs address in the client's folder (filing_pdf_url_ok).
--  * The pull's filing date is the portal's, never CURRENT_DATE: the guard
--    fires after trigger_auto_lock_on_filed and puts back the route's date.
--  * A different ARN is never put over a stored one: a conflict is logged for
--    the superadmin (filing_pull_conflict_decide), naming the row meant and
--    the ARN it holds; Accept never replaces an ARN the conflict did not show,
--    and unlocks the GSTR-3B it takes the ARN from (round 2). A pull without
--    a checked PDF never takes a PDF attached by hand off the row: it stays,
--    shown as "attached by hand, not checked by a pull" (pdf_note); only a
--    PDF stored by an extension before 0.15.0 (the System generated summary
--    problem) is taken off, the log keeping it. A date typed by hand that no
--    pull confirmed is kept and says so (date_note) (round 3). A pull that
--    lands the checked PDF closes the superadmin's allowance for the return;
--    nothing manual goes over it (round 2). A refused pull leaves no new row
--    behind (round 3). A scheme change keeps
--    filed returns (round 2). Leaving Filed no longer wipes the ARN: Unlock
--    (filing_status_unlock, for whoever holds unlock_sheets) keeps it; Take off
--    Filed (filing_status_unfile, superadmin, reason) clears it and unlocks a
--    GSTR-3B. Scheme twins share one ARN (no duplicate-key error). Every write
--    and pull outcome is in filing_status_log. What followed a manual Filed in
--    the page (the confirmation e-mail, the advance set-off stamp, GSTR-3B (Q)
--    locks) runs here once, on every route; no e-mail until the portal's
--    filing date is read.
--  * manual_source_allowances (+ its guard, manual_source_allow / _revoke /
--    _take) is shared with the reco branch: the block from its CREATE TABLE to
--    the GRANT on manual_source_revoke is byte-identical in both migrations.
--
-- Changes no existing row. Safe to re-run.
--
-- Needs: staff_level_of (20261017100000), user_permissions (staff positions,
-- 20261014120000), filing_effective_return_type (20261009200000), and
-- 20261021100000 (twob-simple), whose auto_lock_on_filed carries GSTR-3B (Q)
-- forward: this migration REFUSES TO APPLY before it (it raises, naming it,
-- and leaves nothing behind), since a pulled GSTR-3B (Q) would otherwise be
-- locked and never carried. With 20261021120000 (reco branch), which shares
-- the allowance block, either order works.
--
-- LIVE APPLY (project gcquafqxbykxkbexcdpy only; never SUPABASE_PROJECT_REF)
-- 1. Dry checks, SELECT only (management API, read_only):
--    a. SELECT count(*) total, count(*) FILTER (WHERE status::text = 'Filed') filed,
--              count(arn) arns, count(return_pdf_url) pdfs FROM filing_status;
--       21 Oct 2026: 8195 / 2949 / 2860 / 2858. Note today's.
--    b. SELECT count(*) FROM filing_status WHERE arn !~ '^[A-Z]{2}[0-9]{6}[A-Z0-9]{7}$';  -> 0
--    c. SELECT count(*) FROM filing_status WHERE status::text <> 'Filed'
--         AND (arn IS NOT NULL OR filed_date IS NOT NULL);                             -> 0
--    d. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.filing_status'::regclass
--         AND NOT tgisinternal ORDER BY 1;  -> the 6 of 21 Oct (filing_status_close_gstr3a,
--         trg_filing_status_guard_direct_filing, trg_filing_status_guard_pushed,
--         trigger_auto_lock_on_filed, update_filing_status_updated_at,
--         validate_filing_status_filed_requirements_trigger), plus trg_twob_record_filed
--         if 20261021100000 is in; no other trigger named before 'trigger_filing'.
--    e. SELECT to_regclass('public.manual_source_allowances'),
--              pg_get_function_result(to_regprocedure('public.manual_source_allow(uuid,uuid,text,text,text)'));
--         -> NULL, NULL (21 Oct 2026); or the reco branch's table and 'manual_source_allowances'
--         (then: SELECT count(*) FROM manual_source_allowances). Never 'jsonb'.
--    f. SELECT position('GSTR-3B (Q)' IN pg_get_functiondef('public.auto_lock_on_filed()'::regprocedure)) > 0;
--         -> MUST be true. false on 21 Oct 2026: STOP and apply 20261021100000 first (the file
--         refuses to apply otherwise; that is expected, not a fault).
--    g. SELECT count(*) FROM filing_status WHERE return_pdf_url IS NOT NULL AND return_pdf_url NOT LIKE
--         'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/' || client_id::text || '/%';
--         -> 2051 on 21 Oct 2026 (PDFs still on the old Lovable project's storage address). They are
--         kept as they are; only new writes are checked, and a pull of the same ARN replaces one
--         with a checked PDF here.
--    h. SELECT count(DISTINCT up.user_id) FROM user_permissions up JOIN user_roles ur
--         ON ur.user_id = up.user_id AND ur.role::text = 'employee' WHERE up.permission_key = 'unlock_sheets';
--         -> 2 on 21 Oct 2026: the employees who keep Unlock on Filing Status. The same with
--         'edit_filing_status' -> 12 of 20 employees on 21 Oct 2026: the employees who may pull
--         and attach (GST Managers and the superadmin always may); the other 8 lose Pull.
--    j. SELECT return_type::text, count(*), count(*) FILTER (WHERE status::text = 'Filed')
--         FROM filing_status GROUP BY 1 ORDER BY 1;  -> 21 Oct 2026: GSTR-1 3820 / 1350,
--         GSTR-3B 3707 / 1338 (pulled only from the apply on; a manual upload needs the
--         superadmin's allowance); GSTR-1 (IFF) 156 / 97, GSTR-3B (Q) 51 / 31, GSTR-6 37 / 36,
--         GSTR-7 271 / 72 (manual route kept until their pull is proven, round 3); CMP-08
--         149 / 21, ITC-04 4 / 4 (no pull; manual route).
--    k. SELECT old_pull, filed, count(*) FROM (SELECT return_pdf_url ~
--         '/return-pdfs/[^/]+/[0-9]{2}-[0-9]{4}/[^/]*-[A-Za-z]{2}[0-9]{6}[A-Za-z0-9]{7}\.[Pp][Dd][Ff]$'
--         AS old_pull, status::text = 'Filed' AS filed FROM filing_status
--         WHERE return_pdf_url IS NOT NULL) x GROUP BY 1, 2 ORDER BY 1, 2;
--         -> 21 Oct 2026: false/false 5, false/true 2474 (attached by hand: a pull without a
--         checked PDF keeps them, marked "not checked by a pull"), true/true 379 (stored by
--         extension 0.14.0's pull: such a pull takes them off, the log keeps the address; 26 of
--         the 28 System generated summaries on the repair list are among them).
--    i. Staff finish or close any portal pull tab: a 0.14.0 pull fails from the apply on.
-- 2. Apply this file (it has its own BEGIN / COMMIT).
-- 3. Verify, SELECT only:
--    a. The counts of 1a and 1g, unchanged.
--    b. SELECT count(*) FROM filing_status_log;  -> 0 (nothing is logged until a write).
--    c. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.filing_status'::regclass AND NOT tgisinternal;
--         -> also trigger_filing_status_source and trg_filing_status_after_write.
--    d. has_function_privilege('anon', f, 'EXECUTE') true for filing_record_pull,
--       filing_pull_report, filing_attach_manual, filing_status_unlock, filing_status_unfile,
--       filing_pull_conflict_decide, manual_source_allow, manual_source_revoke,
--       filing_arn_problem, filing_pdf_url_ok, filing_manual_reason, filing_pdf_from_old_pull;
--       false for manual_source_take, filing__route,
--       filing__log, filing__target_row, filing__can_edit, filing_status_on_filed,
--       filing_queue_confirmation.
--    e. SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--         -> also filing_status_log, manual_source_allowances, gstr1_direct_filing_approvals.
--    f. SELECT public.filing_pdf_url_ok(client_id, return_pdf_url), count(*) FROM filing_status
--         WHERE return_pdf_url IS NOT NULL GROUP BY 1;  -> true 788 / false 2070 on 21 Oct 2026
--         (the 2051 of 1g, and 19 old uploads named after the client with an '&' or '..'). Stored
--         addresses are not re-checked; only new writes are.
--    g. With the ANON key from .env (the app's path; the management API bypasses RLS and
--       privileges): POST /rest/v1/rpc/filing_arn_problem {"p_client_id":"<a client>",
--       "p_return_type":"GSTR-3B","p_period_month":"09/2026","p_arn":"AB990926123456X"}
--       -> a sentence naming the state code. PATCH /rest/v1/filing_status?id=eq.<a GSTR-3B row
--       that is not Filed> {"return_pdf_url":"x"} -> 400 "GSTR-3B is marked Filed only by the
--       portal pull ..." and PATCH /rest/v1/filing_status?id=eq.<a Filed row> {"period_month":"01/2020"}
--       -> 400 "... stays on its client, period and return type ..." (both refused, so nothing
--       changes; do not try an allowed write).
--    h. SELECT public.filing_pull_only('GSTR-3B'), public.filing_pull_only('GSTR-1'),
--              public.filing_pull_only('GSTR-1 (IFF)'), public.filing_pull_only('GSTR-7'),
--              public.filing_manual_reason('GSTR-7'), public.filing_manual_reason('CMP-08');
--         -> true, true, false, false, 'the portal pull for GSTR-7 is not proven yet',
--            'CMP-08 has no portal pull yet'.
--       SELECT count(*) FROM information_schema.columns WHERE table_name = 'filing_status'
--         AND column_name IN ('filed_source', 'manual_allowance_id', 'pulled_at', 'pdf_note', 'date_note');  -> 5
--    i. SELECT position('Kept Filed' IN pg_get_functiondef(
--         'public.clear_inapplicable_filing_status_after_scheme_change()'::regprocedure)) > 0;  -> true.
-- 4. Deploy the app (the page calls the new functions; it needs extension 0.15.0).
-- 5. Extension 0.15.0: copy extension/ over the extension folder on every PC that pulls
--    (the firm's Chrome with "Run scheduled syncs in this Chrome", the office agent PC,
--    staff PCs), chrome://extensions -> Reload, check the popup shows 0.15.0. Older copies
--    are refused by the app (MIN_EXTENSION_VERSION 0.15.0) and by this guard.
-- 6. No Edge Function deploy: send-gst-email sends the outbox rows this queues.
-- 7. Repair: pull again with 0.15.0 the returns on the repair lists (28 GSTR-3B system
--    summaries, 7 wrong-return or wrong-month PDFs, 5 GSTR-1 rows holding a GSTR-1A,
--    89 Filed without an ARN, 82 dates that are not the ARN date). The same ARN refreshes
--    (a new PDF address; the log keeps the old one); a different ARN waits for the
--    superadmin under Exceptions to the portal pull. A re-pull that brings no checked PDF
--    keeps a PDF attached by hand, marked "attached by hand, not checked by a pull" (and a
--    filing date typed by hand, marked as such); it takes off only a PDF extension 0.14.0's
--    pull stored (1k: 379; the log's old_pdf_url keeps it; the row says "No checked PDF").
--    For a GSTR-1 / GSTR-3B the superadmin can then allow a manual upload, with a reason;
--    GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 and GSTR-7 are attached by hand without one.
--    "Pull filed returns" now also asks for every Filed row never pulled (2,949 Filed on
--    21 Oct 2026), and keeps waiting while the extension says the pull is running, so
--    pull one month at a time.
--    When a GSTR-1 (IFF), GSTR-3B (Q), GSTR-6 or GSTR-7 pull has landed Filed with its
--    checked PDF (SELECT return_type, count(*) FROM filing_status_log WHERE event IN
--    ('filed', 'refreshed') AND (detail->'pulled'->>'pdf_url') IS NOT NULL GROUP BY 1),
--    make it pulled only: add it to filing_pull_only here (CREATE OR REPLACE) and to
--    PULL_ONLY_RETURN_TYPES in src/lib/filingPull.ts.
-- 8. Extension release: 0.15.0 (review rounds 1 to 3 included, manifest unchanged, no new
--    permission). Release as this repo does: the extension/ folder as it is on main is the
--    release (no build step); note it in extension/CHANGELOG.md (done), then step 5 on every PC.
--    Staff close any portal pull tab before the Reload (a pull running then is dropped by
--    Chrome; the next Pull ends it and reports its returns as not pulled).
-- Undo: DROP TRIGGER trigger_filing_status_source ON public.filing_status;
--       DROP TRIGGER trg_filing_status_after_write ON public.filing_status; then re-run the
--       old validate_filing_status_filed_requirements (20260520073517) and
--       clear_inapplicable_filing_status_after_scheme_change (20260520073658). The new
--       columns, tables and functions can stay.

BEGIN;

-- A pulled GSTR-3B (Q) is locked here and carried forward by
-- auto_lock_on_filed, which carries GSTR-3B (Q) only from 20261021100000
-- (twob-simple) on. Without it every quarterly client's pending 2B items
-- would silently miss the next month, so this migration refuses to apply
-- until that one is in (and leaves nothing behind).
DO $$
BEGIN
  IF COALESCE(position('GSTR-3B (Q)' IN pg_get_functiondef(to_regprocedure('public.auto_lock_on_filed()'))), 0) = 0 THEN
    RAISE EXCEPTION 'Apply 20261021100000_twob_prior_month_simple.sql first: auto_lock_on_filed does not carry GSTR-3B (Q) forward yet, so a pulled GSTR-3B (Q) would be locked but never carried. Nothing was changed.';
  END IF;
END $$;

-- ===========================================================================
-- 0. Manual-source allowances (shared with the reco branch; keep identical)
-- ===========================================================================
-- One superadmin exception for one client, period and scope ('filing:GSTR-3B',
-- 'reco:suspended', 'reco:receivable', ...), with a reason. Given and taken
-- back only through manual_source_allow / manual_source_revoke; the page that
-- uses one marks it used through manual_source_take. Every other write is
-- refused by the guard below.
--
-- Everything from the CREATE TABLE below to the GRANT on manual_source_revoke
-- is byte for byte the same in 20261021120000_reco_pull_push_gate.sql (reco
-- branch), so either migration applies after the other
-- (supabase/tests/filing_pull/run.sh checks both orders, and that the two
-- copies agree once both files are in the tree). The reco branch's first
-- draft (never applied live) returned jsonb from manual_source_allow /
-- _revoke and had manual_source_use instead of _take: drop those if a local
-- database has them, so the shared definitions apply.
DO $$
BEGIN
  -- to_regprocedure, not a ::regprocedure cast: the cast fails on a
  -- database without the function (as the live one is) even behind an AND.
  IF pg_get_function_result(to_regprocedure('public.manual_source_allow(uuid,uuid,text,text,text)')) = 'jsonb' THEN
    DROP FUNCTION public.manual_source_allow(uuid, uuid, text, text, text);
  END IF;
  IF pg_get_function_result(to_regprocedure('public.manual_source_revoke(uuid,uuid)')) = 'jsonb' THEN
    DROP FUNCTION public.manual_source_revoke(uuid, uuid);
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.manual_source_use(uuid, uuid, text, text);

CREATE TABLE IF NOT EXISTS public.manual_source_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text NOT NULL CHECK (period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  scope text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  allowed_by uuid NOT NULL,
  allowed_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS manual_source_allowances_one_live ON public.manual_source_allowances (client_id, period_month, scope) WHERE revoked_at IS NULL;
ALTER TABLE public.manual_source_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manual_source_allowances_public ON public.manual_source_allowances;
CREATE POLICY manual_source_allowances_public ON public.manual_source_allowances FOR ALL TO public USING (true) WITH CHECK (true);

-- Writes only from the three functions below (they turn
-- app.manual_source_write on for their own statement). A client's
-- allowances go with the client.
CREATE OR REPLACE FUNCTION public.manual_source_allowances_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.manual_source_write', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Only the superadmin gives or takes back a manual allowance, and only from GST Keeper.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_source_allowances_guard ON public.manual_source_allowances;
CREATE TRIGGER trg_manual_source_allowances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.manual_source_allowances
  FOR EACH ROW EXECUTE FUNCTION public.manual_source_allowances_guard();

-- The superadmin allows one manual upload for a client, period and scope.
-- One live allowance per client, period and scope: a used one is taken back
-- (manual_source_revoke) before another is given, so each exception stays a
-- separate, dated record.
CREATE OR REPLACE FUNCTION public.manual_source_allow(
  p_actor_id  uuid,
  p_client_id uuid,
  p_period    text,
  p_scope     text,
  p_reason    text
)
RETURNS public.manual_source_allowances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row  public.manual_source_allowances;
  v_live public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can allow a manual upload.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_period IS NULL OR p_period !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The period must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_scope IS NULL OR p_scope !~ '^[a-z][a-z0-9_]*:\S' THEN
    RAISE EXCEPTION 'Unknown allowance scope.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason of at least 5 characters.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_live FROM public.manual_source_allowances
   WHERE client_id = p_client_id AND period_month = p_period AND scope = p_scope AND revoked_at IS NULL
   FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION '%', CASE WHEN v_live.used_at IS NULL
      THEN 'A manual upload is already allowed for this. Take it back first to give it again.'
      ELSE 'The manual upload allowed for this was used. Take it back first to allow another.' END
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('app.manual_source_write', 'on', true);
  BEGIN
    INSERT INTO public.manual_source_allowances (client_id, period_month, scope, reason, allowed_by)
    VALUES (p_client_id, p_period, p_scope, btrim(p_reason), p_actor_id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('app.manual_source_write', '', true);
    RAISE EXCEPTION 'A manual upload is already allowed for this. Take it back first to give it again.'
      USING ERRCODE = 'unique_violation';
  END;
  PERFORM set_config('app.manual_source_write', '', true);
  RETURN v_row;
END;
$$;

-- The superadmin takes an allowance back (used or not). Data entered under a
-- used one stays, still marked manual with this allowance's reason.
CREATE OR REPLACE FUNCTION public.manual_source_revoke(
  p_actor_id uuid,
  p_id       uuid
)
RETURNS public.manual_source_allowances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.manual_source_allowances;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can take back a manual allowance.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_row FROM public.manual_source_allowances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allowance not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN v_row;
  END IF;
  PERFORM set_config('app.manual_source_write', 'on', true);
  UPDATE public.manual_source_allowances
     SET revoked_at = now(), revoked_by = p_actor_id
   WHERE id = p_id
  RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source_write', '', true);
  RETURN v_row;
END;
$$;

-- Internal (no grant): the live, unused allowance for a client, period and
-- scope, marked used by p_actor_id. Raises when there is none. Called inside
-- the SECURITY DEFINER function that writes the manual data, in the same
-- transaction, so a refused write leaves the allowance unused.
CREATE OR REPLACE FUNCTION public.manual_source_take(
  p_actor_id  uuid,
  p_client_id uuid,
  p_period    text,
  p_scope     text
)
RETURNS public.manual_source_allowances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.manual_source_allowances;
BEGIN
  SELECT * INTO v_row FROM public.manual_source_allowances
   WHERE client_id = p_client_id AND period_month = p_period AND scope = p_scope
     AND revoked_at IS NULL AND used_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no manual allowance for this. Ask the superadmin to allow a manual upload, with a reason.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.manual_source_write', 'on', true);
  UPDATE public.manual_source_allowances
     SET used_by = p_actor_id, used_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('app.manual_source_write', '', true);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_source_take(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_source_allow(uuid, uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manual_source_revoke(uuid, uuid) TO anon, authenticated, service_role;

-- ===========================================================================
-- 1. Where a filed return came from
-- ===========================================================================
-- filed_source: 'portal' (the extension's pull, through filing_record_pull)
-- or 'manual' (filing_attach_manual: under the superadmin's allowance for
-- a return that is pulled only (filing_pull_only), or the manual route kept
-- for the others, filing_manual_reason). NULL on rows written before this
-- migration. manual_allowance_id: the allowance used. pulled_at: the last
-- pull that wrote the row. pdf_note: why the row has no checked PDF; on a
-- row that still shows a PDF, why that PDF is not a checked one (attached by
-- hand, not checked by a pull). date_note: on a portal row, why the filing
-- date shown is not the portal's (typed by hand, no pull read it).
ALTER TABLE public.filing_status ADD COLUMN IF NOT EXISTS filed_source text;
ALTER TABLE public.filing_status ADD COLUMN IF NOT EXISTS manual_allowance_id uuid;
ALTER TABLE public.filing_status ADD COLUMN IF NOT EXISTS pulled_at timestamptz;
ALTER TABLE public.filing_status ADD COLUMN IF NOT EXISTS pdf_note text;
ALTER TABLE public.filing_status ADD COLUMN IF NOT EXISTS date_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filing_status_filed_source_check'
                    AND conrelid = 'public.filing_status'::regclass) THEN
    ALTER TABLE public.filing_status
      ADD CONSTRAINT filing_status_filed_source_check CHECK (filed_source IN ('portal', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filing_status_manual_allowance_fkey'
                    AND conrelid = 'public.filing_status'::regclass) THEN
    ALTER TABLE public.filing_status
      ADD CONSTRAINT filing_status_manual_allowance_fkey
      FOREIGN KEY (manual_allowance_id) REFERENCES public.manual_source_allowances(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- The returns that are pulled only (the firm's decision of 21 Oct 2026,
-- "1 & 3B"; round 3): GSTR-1 and GSTR-3B, the monthly returns whose pull
-- has landed hundreds of times. GSTR-1 (IFF) (an IFF client's every GSTR-1,
-- the quarter's included), GSTR-3B (Q), GSTR-6 and GSTR-7 can be pulled too,
-- and a pull writes them as it writes GSTR-1 / 3B, but no pull of theirs has
-- landed yet: until one is proven to work they keep a manual route with no
-- allowance, as CMP-08 and ITC-04 (no pull at all: the pull sets a monthly
-- period, theirs is a quarter and a half-year). The manual route still goes
-- through filing_attach_manual (ARN checked, PDF required, logged, marked
-- manual with the reason below). To make one pulled only once its pull is
-- proven, add it here and to PULL_ONLY_RETURN_TYPES in src/lib/filingPull.ts.
CREATE OR REPLACE FUNCTION public.filing_pull_only(p_return_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_return_type IN ('GSTR-1', 'GSTR-3B'), false);
$$;

-- Why a return that is not pulled only may be attached by hand (NULL for
-- GSTR-1 / GSTR-3B): shown with the row and in the log. Same words as
-- manualRouteReason() in src/lib/filingPull.ts.
CREATE OR REPLACE FUNCTION public.filing_manual_reason(p_return_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.filing_pull_only(p_return_type) THEN NULL
    WHEN p_return_type IN ('CMP-08', 'ITC-04') THEN p_return_type || ' has no portal pull yet'
    ELSE 'the portal pull for ' || COALESCE(p_return_type, 'this return') || ' is not proven yet'
  END;
$$;

-- Was this PDF stored by the extension's own pull before 0.15.0? Those were
-- named <client>/<MM-YYYY>/<type>-<ARN>.pdf, and 26 of 191 GSTR-3B among
-- them were the System generated summary, which 0.14.0 could not tell from
-- the filed return. A PDF attached by hand on the page was stored under
-- <client>/<type>/<MM-YYYY>/... (before 21 Oct 2026) or .../manual-... (the
-- manual route), and 0.15.0's checked ones end in a time stamp: none of them
-- has this form. Used only to decide what a pull without a checked PDF does
-- with the PDF on the row (filing_record_pull).
CREATE OR REPLACE FUNCTION public.filing_pdf_from_old_pull(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_url ~ '/return-pdfs/[^/]+/[0-9]{2}-[0-9]{4}/[^/]*-[A-Za-z]{2}[0-9]{6}[A-Za-z0-9]{7}\.[Pp][Dd][Ff]$', false);
$$;

-- Who may pull filed returns or attach one by hand: whoever the page offers
-- it to (canEditFilingStatus): a GST Manager, the superadmin, or an
-- employee whose position holds edit_filing_status.
CREATE OR REPLACE FUNCTION public.filing__can_edit(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_actor_id IS NOT NULL
    AND (COALESCE(public.staff_level_of(p_actor_id) IN ('superadmin', 'gst_manager'), false)
         OR (public.staff_level_of(p_actor_id) = 'employee'
             AND EXISTS (SELECT 1 FROM public.user_permissions up
                          WHERE up.user_id = p_actor_id AND up.permission_key = 'edit_filing_status')));
$$;
REVOKE ALL ON FUNCTION public.filing__can_edit(uuid) FROM PUBLIC, anon, authenticated;

-- The rows of one return on Filing Status: GSTR-1 and GSTR-1 (IFF) are one
-- return (scheme twins), as are GSTR-3B and GSTR-3B (Q).
CREATE OR REPLACE FUNCTION public.filing_family(p_return_type text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_return_type IN ('GSTR-1', 'GSTR-1 (IFF)') THEN ARRAY['GSTR-1', 'GSTR-1 (IFF)']
    WHEN p_return_type IN ('GSTR-3B', 'GSTR-3B (Q)') THEN ARRAY['GSTR-3B', 'GSTR-3B (Q)']
    ELSE ARRAY[p_return_type]
  END;
$$;

-- Is this the address of a PDF in this client's folder of the return-pdfs
-- bucket on project gcquafqxbykxkbexcdpy? Exactly that prefix, a path of
-- plain characters (letters, digits, space, %, brackets, dot, dash,
-- underscore; no '..') and a .pdf ending. Anything else (another host,
-- another client's folder, a javascript: address) is never stored as a
-- return's PDF.
CREATE OR REPLACE FUNCTION public.filing_pdf_url_ok(p_client_id uuid, p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_client_id IS NOT NULL
    AND left(p_url, length('https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/' || p_client_id::text || '/'))
        = 'https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/' || p_client_id::text || '/'
    AND substr(p_url, length('https://gcquafqxbykxkbexcdpy.supabase.co/storage/v1/object/public/return-pdfs/' || p_client_id::text || '/') + 1)
        ~ '^[A-Za-z0-9 ()%._-]+(/[A-Za-z0-9 ()%._-]+)*\.[Pp][Dd][Ff]$'
    AND position('..' IN p_url) = 0,
    false);
$$;

-- NULL when the ARN can be this return's, else why not. An ARN is two
-- letters, the state code, the tax period as MMYY and seven more characters
-- (all 2,860 ARNs on Filing Status on 21 Oct 2026 have that form). The two
-- letters are a series (AA, AB and AC each appear on every return type), so
-- the ARN itself does not say which return it is: the pull's exact
-- return-type match and, for a manual upload, the form name in the PDF do.
-- ITC-04's period code is the half-year, not a month, so it is not checked.
CREATE OR REPLACE FUNCTION public.filing_arn_problem(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_arn          text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arn   text := upper(btrim(COALESCE(p_arn, '')));
  v_state text;
BEGIN
  IF v_arn = '' THEN
    RETURN 'No ARN was given.';
  END IF;
  IF v_arn !~ '^[A-Z]{2}[0-9]{6}[A-Z0-9]{7}$' THEN
    RETURN format('%s is not an ARN. An ARN has 15 characters: two letters, the state code, the tax period (MMYY) and seven more.', v_arn);
  END IF;
  SELECT left(c.gstin, 2) INTO v_state FROM public.clients c WHERE c.id = p_client_id;
  IF v_state ~ '^[0-9]{2}$' AND substr(v_arn, 3, 2) <> v_state THEN
    RETURN format('ARN %s has state code %s, but the client''s GSTIN is in state %s.', v_arn, substr(v_arn, 3, 2), v_state);
  END IF;
  IF COALESCE(p_return_type, '') <> 'ITC-04' AND p_period_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
     AND substr(v_arn, 5, 4) <> left(p_period_month, 2) || right(p_period_month, 2) THEN
    RETURN format('ARN %s is for the tax period %s/20%s, not %s.', v_arn, substr(v_arn, 5, 2), substr(v_arn, 7, 2), p_period_month);
  END IF;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.filing_pull_only(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_manual_reason(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_pdf_from_old_pull(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_pdf_url_ok(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_family(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_arn_problem(uuid, text, text, text) TO anon, authenticated, service_role;

-- ===========================================================================
-- 2. The log: every pull's outcome and every change to a filed return
-- ===========================================================================
-- event: filed | refreshed | conflict | refused | not_found | failed |
-- manual_attach | unlocked | unfiled | conflict_accepted | gstr1a_seen |
-- scheme_change | changed (any other write) | deleted.
-- route: portal | manual | unlock | unfile | conflict | scheme | push | direct.
-- A conflict waits for the superadmin (resolved_at).
CREATE TABLE IF NOT EXISTS public.filing_status_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at               timestamptz NOT NULL DEFAULT now(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_type      text NOT NULL,
  period_month     text NOT NULL,
  filing_status_id uuid,
  event            text NOT NULL,
  route            text NOT NULL DEFAULT 'direct',
  actor_id         uuid,
  old_status       text,
  new_status       text,
  old_arn          text,
  new_arn          text,
  old_filed_date   date,
  new_filed_date   date,
  old_pdf_url      text,
  new_pdf_url      text,
  old_locked       boolean,
  new_locked       boolean,
  message          text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowance_id     uuid,
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolution       text
);
CREATE INDEX IF NOT EXISTS filing_status_log_period_idx ON public.filing_status_log (period_month, at DESC);
CREATE INDEX IF NOT EXISTS filing_status_log_client_idx ON public.filing_status_log (client_id, period_month, return_type, at DESC);
CREATE INDEX IF NOT EXISTS filing_status_log_open_conflicts_idx ON public.filing_status_log (at DESC)
  WHERE event = 'conflict' AND resolved_at IS NULL;

ALTER TABLE public.filing_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS filing_status_log_public ON public.filing_status_log;
CREATE POLICY filing_status_log_public ON public.filing_status_log FOR ALL TO public USING (true) WITH CHECK (true);
-- Read by anyone with the app; written only by the functions in this file.
GRANT SELECT ON public.filing_status_log TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.filing_status_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Route settings (transaction-local; set by the functions below, read by the
-- triggers). app.filing_source is the route; nothing else sets it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filing__route(
  p_route      text,
  p_event      text,
  p_actor      uuid,
  p_message    text,
  p_detail     jsonb,
  p_filed_date date,
  p_allowance  uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.filing_source', COALESCE(p_route, ''), true);
  PERFORM set_config('app.filing_event', COALESCE(p_event, ''), true);
  PERFORM set_config('app.filing_actor', COALESCE(p_actor::text, ''), true);
  PERFORM set_config('app.filing_message', COALESCE(p_message, ''), true);
  PERFORM set_config('app.filing_detail', COALESCE(p_detail, '{}'::jsonb)::text, true);
  PERFORM set_config('app.filing_filed_date', COALESCE(to_char(p_filed_date, 'YYYY-MM-DD'), ''), true);
  PERFORM set_config('app.filing_allowance', COALESCE(p_allowance::text, ''), true);
END;
$$;

CREATE OR REPLACE FUNCTION public.filing__route_end()
RETURNS void
LANGUAGE sql
AS $$
  SELECT public.filing__route(NULL, NULL, NULL, NULL, NULL, NULL, NULL);
$$;

-- One log row for an outcome that changed nothing (refused, conflict, not
-- found, failed). Returns its id.
CREATE OR REPLACE FUNCTION public.filing__log(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_fs_id        uuid,
  p_event        text,
  p_route        text,
  p_actor        uuid,
  p_message      text,
  p_detail       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_row public.filing_status;
BEGIN
  IF p_fs_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.filing_status WHERE id = p_fs_id;
  END IF;
  INSERT INTO public.filing_status_log
    (client_id, return_type, period_month, filing_status_id, event, route, actor_id,
     old_status, new_status, old_arn, new_arn, old_filed_date, new_filed_date, old_pdf_url, new_pdf_url,
     message, detail)
  VALUES
    (p_client_id, p_return_type, p_period_month, p_fs_id, p_event, COALESCE(p_route, 'direct'), p_actor,
     v_row.status::text, v_row.status::text, v_row.arn, v_row.arn, v_row.filed_date, v_row.filed_date,
     v_row.return_pdf_url, v_row.return_pdf_url,
     left(p_message, 1000), COALESCE(p_detail, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.filing__route(text, text, uuid, text, jsonb, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.filing__route_end() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.filing__log(uuid, text, text, uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. The guard: Filed, ARN, filing date and PDF come from the routes only
-- ===========================================================================
-- Named to fire after trigger_auto_lock_on_filed (triggers of one kind fire
-- in name order), so the route's filing date replaces that trigger's
-- COALESCE(filed_date, CURRENT_DATE): a pull that could not read the portal's
-- date leaves it blank (shown as "date not read"), never the pull's day.
-- Refused for every direct write (the app's anon key, the old extension's
-- markFiled upsert, a SQL session without a route): becoming or leaving
-- Filed, and any change of arn, filed_date, return_pdf_url, filed_source,
-- manual_allowance_id, pulled_at, pdf_note or date_note. Status changes between the
-- other statuses, remarks, target dates, NIL, locks and the push marker are
-- not touched. A row holding a filed return (Filed, or an ARN, filing date,
-- PDF or source) stays on its client, period and return type, on every route
-- (moving one would file another month or client with this one's ARN), and
-- is deleted only by the cascade of its client's deletion (pg_trigger_depth()
-- > 1 and the client gone), never by a DELETE of its own.
CREATE OR REPLACE FUNCTION public.filing_status_source_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_route   text := COALESCE(NULLIF(current_setting('app.filing_source', true), ''), 'direct');
  v_changed boolean;
  v_holds   boolean;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_holds := OLD.status::text = 'Filed' OR OLD.arn IS NOT NULL OR OLD.filed_date IS NOT NULL
      OR NULLIF(btrim(OLD.return_pdf_url), '') IS NOT NULL OR OLD.filed_source IS NOT NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT v_holds
       OR (pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'A filed return, or one holding an ARN, filing date or return PDF, cannot be deleted.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND v_holds
     AND (NEW.client_id, NEW.period_month, NEW.return_type) IS DISTINCT FROM (OLD.client_id, OLD.period_month, OLD.return_type) THEN
    RAISE EXCEPTION 'A filed return, or one holding an ARN, filing date or return PDF, stays on its client, period and return type (% %).',
      OLD.return_type::text, OLD.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.arn := NULLIF(upper(btrim(NEW.arn)), '');

  -- The route states the filing date (none when the portal gave none), and a
  -- GSTR-3B / GSTR-3B (Q) it files is locked.
  IF v_route IN ('portal', 'manual', 'conflict') AND NEW.status::text = 'Filed' THEN
    NEW.filed_date := NULLIF(current_setting('app.filing_filed_date', true), '')::date;
    IF NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)')
       AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'Filed') THEN
      NEW.is_locked := true;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.status::text = 'Filed' OR NEW.arn IS NOT NULL OR NEW.filed_date IS NOT NULL
      OR NULLIF(btrim(NEW.return_pdf_url), '') IS NOT NULL OR NEW.filed_source IS NOT NULL
      OR NEW.manual_allowance_id IS NOT NULL OR NEW.pulled_at IS NOT NULL OR NEW.pdf_note IS NOT NULL
      OR NEW.date_note IS NOT NULL;
  ELSE
    v_changed := (NEW.status::text = 'Filed') IS DISTINCT FROM (OLD.status::text = 'Filed')
      OR NEW.arn IS DISTINCT FROM NULLIF(upper(btrim(OLD.arn)), '')
      OR NEW.filed_date IS DISTINCT FROM OLD.filed_date
      OR NULLIF(btrim(NEW.return_pdf_url), '') IS DISTINCT FROM NULLIF(btrim(OLD.return_pdf_url), '')
      OR NEW.filed_source IS DISTINCT FROM OLD.filed_source
      OR NEW.manual_allowance_id IS DISTINCT FROM OLD.manual_allowance_id
      OR NEW.pulled_at IS DISTINCT FROM OLD.pulled_at
      OR NEW.pdf_note IS DISTINCT FROM OLD.pdf_note
      OR NEW.date_note IS DISTINCT FROM OLD.date_note;
  END IF;

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;
  IF v_route = 'direct' THEN
    RAISE EXCEPTION '%', CASE WHEN public.filing_pull_only(NEW.return_type::text)
      THEN format('%s is marked Filed only by the portal pull (Filing Status, Pull from portal). The ARN, filing date and return PDF come with it. When a pull cannot be done, the superadmin can allow a manual upload for this one return, with a reason.', NEW.return_type::text)
      ELSE format('A filed %s is recorded only through Attach filed return on Filing Status, which checks the ARN and keeps the PDF.', NEW.return_type::text) END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_filing_status_source ON public.filing_status;
CREATE TRIGGER trigger_filing_status_source
  BEFORE INSERT OR UPDATE OR DELETE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.filing_status_source_guard();

-- What a Filed row needs. Changed in two ways: a portal pull may be Filed
-- without a PDF (the ARN and date came from the portal; pdf_note says why no
-- checked PDF was stored), and leaving Filed no longer wipes the ARN and
-- filing date (Unlock keeps them; Take off Filed clears them itself).
CREATE OR REPLACE FUNCTION public.validate_filing_status_filed_requirements()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.arn := NULLIF(upper(btrim(NEW.arn)), '');

  IF NEW.status::text = 'Filed' THEN
    IF NEW.arn IS NULL THEN
      RAISE EXCEPTION 'ARN is mandatory before marking return as Filed';
    END IF;
    IF NEW.arn !~ '^[A-Z0-9]{15}$' THEN
      RAISE EXCEPTION 'ARN must be exactly 15 alphanumeric characters';
    END IF;
    IF NULLIF(btrim(NEW.return_pdf_url), '') IS NULL AND NEW.filed_source IS DISTINCT FROM 'portal' THEN
      RAISE EXCEPTION 'Return PDF is mandatory before marking return as Filed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 4. What happens once a return is Filed (any route, once)
-- ===========================================================================
-- Moved here from FilingStatusPage.tsx, which ran them only for a Filed
-- chosen by hand: the client's confirmation e-mail, the advance set-off
-- override stamp and, for GSTR-3B (Q), the sheet locks. GSTR-3B's locks and
-- the carry forward stay with auto_lock_on_filed (GSTR-3B (Q) as well once
-- 20261021100000 is applied), which every route reaches through an UPDATE.

-- 'MM/YYYY' -> 'July 2026', as prettyPeriod() in src/lib/gstReminders.ts.
CREATE OR REPLACE FUNCTION public.filing_period_words(p_period text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
    THEN (ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'])[split_part(p_period, '/', 1)::int]
         || ' ' || split_part(p_period, '/', 2)
    ELSE COALESCE(p_period, '') END;
$$;

-- {{var}} -> value; an unknown variable renders as '' (renderTemplate()).
CREATE OR REPLACE FUNCTION public.filing_render_template(p_text text, p_vars jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := COALESCE(p_text, '');
  k text;
  val text;
BEGIN
  FOR k, val IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    v := replace(v, '{{' || k || '}}', COALESCE(val, ''));
  END LOOP;
  RETURN regexp_replace(v, '\{\{\w+\}\}', '', 'g');
END;
$$;

-- The client's filing confirmation (enqueueConfirmation() in
-- src/lib/gstReminders.ts, which this replaces for Filing Status): skipped
-- when the client turned it off, has no e-mail or the template is off, for
-- a return filed more than 30 days ago (a pull of an old period records it
-- without writing to the client), and while the portal's filing date is not
-- read (never a confirmation with a blank date, nor one for an old period
-- whose date could not be read; filing_status_after_write queues it when a
-- later pull reads the date). One per client, return and period
-- (uq_email_outbox_confirmation). The 15-minute gst-send-outbox job sends it.
CREATE OR REPLACE FUNCTION public.filing_queue_confirmation(p_row public.filing_status, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client record;
  v_tpl    record;
  v_staff  text;
  v_vars   jsonb;
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p_row.filed_date IS NULL THEN
    RETURN 'skipped: filing date not read';
  END IF;
  IF p_row.filed_date < v_today - 30 THEN
    RETURN 'skipped: filed more than 30 days ago';
  END IF;
  IF EXISTS (SELECT 1 FROM public.client_reminder_settings s
              WHERE s.client_id = p_row.client_id AND s.send_confirmation = false) THEN
    RETURN 'skipped: confirmations are off for this client';
  END IF;
  SELECT c.name, c.email, c.gstin INTO v_client FROM public.clients c WHERE c.id = p_row.client_id;
  IF NULLIF(btrim(v_client.email), '') IS NULL THEN
    RETURN 'skipped: no e-mail address';
  END IF;
  SELECT t.subject, t.body, t.is_active INTO v_tpl FROM public.email_templates t WHERE t.key = 'confirmation';
  IF NOT FOUND OR v_tpl.is_active IS FALSE THEN
    RETURN 'skipped: confirmation template is off';
  END IF;
  IF p_actor IS NOT NULL THEN
    SELECT p.first_name INTO v_staff FROM public.profiles p WHERE p.user_id = p_actor LIMIT 1;
  END IF;
  v_vars := jsonb_build_object(
    'contact_person', v_client.name,
    'client_name', v_client.name,
    'gstin', COALESCE(v_client.gstin, ''),
    'return_type', p_row.return_type::text,
    'period', public.filing_period_words(p_row.period_month),
    'arn', COALESCE(p_row.arn, ''),
    'filing_date', COALESCE(to_char(p_row.filed_date, 'YYYY-MM-DD'), ''),
    'staff_name', COALESCE(NULLIF(btrim(v_staff), ''), 'V. J. Desai & Co. (GST Team)'),
    'firm_name', 'V. J. Desai & Co. LLP',
    'firm_email', 'gst@vjdesai.com',
    'firm_phone', '',
    'due_date', '',
    'data_by_date', '');
  INSERT INTO public.email_outbox
    (client_id, to_email, kind, template_key, return_type, period_month, subject, body,
     render_vars, status, filing_status_id, created_by)
  VALUES
    (p_row.client_id, btrim(v_client.email), 'confirmation', 'confirmation', p_row.return_type, p_row.period_month,
     public.filing_render_template(v_tpl.subject, v_vars), public.filing_render_template(v_tpl.body, v_vars),
     v_vars, 'pending', p_row.id, p_actor)
  ON CONFLICT (client_id, return_type, period_month) WHERE kind = 'confirmation' DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'queued' ELSE 'skipped: already queued' END;
END;
$$;

-- The side effects of one return becoming Filed.
CREATE OR REPLACE FUNCTION public.filing_status_on_filed(p_row public.filing_status, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mail     text;
  v_stamped  integer := 0;
  v_base     text;
BEGIN
  v_mail := public.filing_queue_confirmation(p_row, p_actor);

  -- Advance set-off: the standing approved override (the latest request for
  -- the return) is stamped as the authority the return went out under, both
  -- the one approved on Filing Status (FILING_STATUS:<type>) and the one
  -- approved on the GSTR-1 / GSTR-3B page (markFiledForPeriod()).
  IF p_row.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)') THEN
    v_base := CASE WHEN p_row.return_type::text IN ('GSTR-1', 'GSTR-1 (IFF)') THEN 'GSTR-1' ELSE 'GSTR-3B' END;
    UPDATE public.advance_setoff_overrides o
       SET filed_after_override = true, arn = p_row.arn, updated_at = now()
     WHERE o.status = 'APPROVED'
       AND o.id IN (SELECT DISTINCT ON (x.return_type) x.id
                      FROM public.advance_setoff_overrides x
                     WHERE x.client_id = p_row.client_id
                       AND x.period_month = p_row.period_month
                       AND x.return_type IN ('FILING_STATUS:' || p_row.return_type::text, v_base)
                     ORDER BY x.return_type, x.requested_at DESC);
    GET DIAGNOSTICS v_stamped = ROW_COUNT;
  END IF;

  -- GSTR-3B (Q): the month's sheets are locked, as the page did. (GSTR-3B's
  -- are locked by auto_lock_on_filed; doing it again changes nothing.)
  IF p_row.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN
    UPDATE public.bills_not_in_2b SET is_locked = true
     WHERE client_id = p_row.client_id AND period_month = p_row.period_month AND is_locked IS DISTINCT FROM true;
    UPDATE public.bills_not_in_books SET is_locked = true
     WHERE client_id = p_row.client_id AND period_month = p_row.period_month AND is_locked IS DISTINCT FROM true;
    UPDATE public.itc_summaries SET is_locked = true
     WHERE client_id = p_row.client_id AND period_month = p_row.period_month AND is_locked IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object('confirmation', v_mail, 'advance_overrides_stamped', v_stamped);
END;
$$;

-- The log row for every write, and the side effects when a return becomes
-- Filed. Fires once per row write, whatever the route.
CREATE OR REPLACE FUNCTION public.filing_status_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route  text := COALESCE(NULLIF(current_setting('app.filing_source', true), ''), 'direct');
  v_event  text := NULLIF(current_setting('app.filing_event', true), '');
  v_actor  uuid := NULLIF(current_setting('app.filing_actor', true), '')::uuid;
  v_msg    text := NULLIF(current_setting('app.filing_message', true), '');
  v_detail jsonb := COALESCE(NULLIF(current_setting('app.filing_detail', true), '')::jsonb, '{}'::jsonb);
  v_allow  uuid := NULLIF(current_setting('app.filing_allowance', true), '')::uuid;
  v_effects jsonb;
BEGIN
  -- A push being recorded (filing_record_push) is its own route.
  IF v_route = 'direct' AND COALESCE(current_setting('app.filing_push', true), '') = 'on' THEN
    v_route := 'push';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF (OLD.status::text = 'Filed' OR OLD.arn IS NOT NULL OR OLD.return_pdf_url IS NOT NULL)
       AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id) THEN
      INSERT INTO public.filing_status_log
        (client_id, return_type, period_month, filing_status_id, event, route, actor_id,
         old_status, old_arn, old_filed_date, old_pdf_url, old_locked, message, detail)
      VALUES
        (OLD.client_id, OLD.return_type::text, OLD.period_month, OLD.id, 'deleted', v_route, v_actor,
         OLD.status::text, OLD.arn, OLD.filed_date, OLD.return_pdf_url, OLD.is_locked, v_msg, v_detail);
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text NOT IN ('Filed', 'Pushed') AND NEW.arn IS NULL AND NEW.return_pdf_url IS NULL THEN
      RETURN NULL;
    END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.arn IS NOT DISTINCT FROM OLD.arn
    AND NEW.filed_date IS NOT DISTINCT FROM OLD.filed_date
    AND NEW.return_pdf_url IS NOT DISTINCT FROM OLD.return_pdf_url
    AND NEW.filed_source IS NOT DISTINCT FROM OLD.filed_source
    AND NEW.is_locked IS NOT DISTINCT FROM OLD.is_locked
    AND NEW.pulled_at IS NOT DISTINCT FROM OLD.pulled_at
    AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
    AND NEW.period_month IS NOT DISTINCT FROM OLD.period_month
    AND NEW.return_type IS NOT DISTINCT FROM OLD.return_type THEN
    RETURN NULL;
  END IF;

  -- A row moved to another client, period or return type (only a row
  -- holding no filed return can be: the guard refuses the rest) says where
  -- it came from.
  IF TG_OP = 'UPDATE' AND (NEW.client_id, NEW.period_month, NEW.return_type) IS DISTINCT FROM (OLD.client_id, OLD.period_month, OLD.return_type) THEN
    v_detail := v_detail || jsonb_build_object('moved_from', jsonb_build_object(
      'client_id', OLD.client_id, 'period_month', OLD.period_month, 'return_type', OLD.return_type::text));
  END IF;

  IF NEW.status::text = 'Filed' AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'Filed') THEN
    v_effects := public.filing_status_on_filed(NEW, COALESCE(v_actor, NEW.updated_by));
  ELSIF TG_OP = 'UPDATE' AND NEW.status::text = 'Filed' AND OLD.filed_date IS NULL AND NEW.filed_date IS NOT NULL THEN
    -- Filed earlier without the portal's date (no confirmation then): a
    -- later pull read it, so the confirmation goes now, under the same rules
    -- (one per return, none for a return filed more than 30 days ago).
    v_effects := jsonb_build_object('confirmation', public.filing_queue_confirmation(NEW, COALESCE(v_actor, NEW.updated_by)));
  END IF;

  INSERT INTO public.filing_status_log
    (client_id, return_type, period_month, filing_status_id, event, route, actor_id,
     old_status, new_status, old_arn, new_arn, old_filed_date, new_filed_date, old_pdf_url, new_pdf_url,
     old_locked, new_locked, message, detail, allowance_id)
  VALUES
    (NEW.client_id, NEW.return_type::text, NEW.period_month, NEW.id, COALESCE(v_event, 'changed'), v_route,
     COALESCE(v_actor, NEW.updated_by),
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END, NEW.status::text,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.arn END, NEW.arn,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.filed_date END, NEW.filed_date,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.return_pdf_url END, NEW.return_pdf_url,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_locked END, NEW.is_locked,
     v_msg,
     v_detail || CASE WHEN v_effects IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('on_filed', v_effects) END,
     COALESCE(v_allow, NEW.manual_allowance_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_filing_status_after_write ON public.filing_status;
CREATE TRIGGER trg_filing_status_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.filing_status
  FOR EACH ROW EXECUTE FUNCTION public.filing_status_after_write();

REVOKE ALL ON FUNCTION public.filing_queue_confirmation(public.filing_status, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.filing_status_on_filed(public.filing_status, uuid) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 5. The routes
-- ===========================================================================
-- The row of a return a pull or upload lands on. GSTR-1 / GSTR-1 (IFF) and
-- GSTR-3B / GSTR-3B (Q) are one return: the row already holding the ARN when
-- there is one, else the type Filing Status shows for the period
-- (filing_effective_return_type), else the requested type when only its row
-- exists. The row is created (not Filed) when missing, so Filed is always
-- reached by an UPDATE and auto_lock_on_filed runs. Locks the row.
CREATE OR REPLACE FUNCTION public.filing__target_row(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text
)
RETURNS public.filing_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type   text;
  v_row    public.filing_status;
  v_family text[] := public.filing_family(p_return_type);
BEGIN
  v_type := CASE WHEN array_length(v_family, 1) > 1
    THEN public.filing_effective_return_type(p_client_id, p_return_type, p_period_month)
    ELSE p_return_type END;
  IF v_type <> p_return_type
     AND NOT EXISTS (SELECT 1 FROM public.filing_status f
                      WHERE f.client_id = p_client_id AND f.period_month = p_period_month AND f.return_type::text = v_type)
     AND EXISTS (SELECT 1 FROM public.filing_status f
                  WHERE f.client_id = p_client_id AND f.period_month = p_period_month AND f.return_type::text = p_return_type) THEN
    v_type := p_return_type;
  END IF;

  INSERT INTO public.filing_status (client_id, return_type, period_month, status, target_date, updated_at)
  SELECT p_client_id, v_type::public.return_type, p_period_month, 'Prepared'::public.filing_status_type,
         CASE WHEN v_type IN ('GSTR-1', 'GSTR-1 (IFF)', 'GSTR-6', 'GSTR-7', 'GSTR-1A')
              THEN COALESCE(c.target_date_group1, 11) ELSE COALESCE(c.target_date_group2, 20) END,
         now()
    FROM public.clients c WHERE c.id = p_client_id
  ON CONFLICT (client_id, return_type, period_month) DO NOTHING;

  SELECT * INTO v_row FROM public.filing_status
   WHERE client_id = p_client_id AND period_month = p_period_month AND return_type::text = v_type
   FOR UPDATE;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.filing__target_row(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Shared input checks; raises on a bad call.
CREATE OR REPLACE FUNCTION public.filing__check_call(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_period_month IS NULL OR p_period_month !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'The period must be MM/YYYY.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_return_type IS NULL
     OR NOT (p_return_type = ANY (enum_range(NULL::public.return_type)::text[]))
     OR p_return_type IN ('GSTR-9', 'GSTR-9C') THEN
    RAISE EXCEPTION 'Unknown return type %.', COALESCE(p_return_type, '(none)') USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.filing__check_call(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5a. The portal pull (extension 0.15.0 and later)
-- ---------------------------------------------------------------------------
-- What the extension read on the portal for one return: the ARN and filing
-- date (formdetails / the e-Filed Returns row, never the day of the pull),
-- and the stored PDF when it is the filed return and shows that ARN (else
-- p_pdf_url is NULL and p_pdf_note says why). Outcomes:
--   filed      the return is now Filed from the portal;
--   refreshed  it already held this ARN: date and PDF refreshed;
--   conflict   the row holds another ARN, or the ARN is on another return:
--              nothing changes, the superadmin decides (filing_pull_conflict_decide);
--   refused    the ARN cannot be this return's, the staff member may not
--              pull (Filing status permission), or a rule refused Filed (the
--              direct-filing approval for GSTR-1 from 09/2026).
-- Without a checked PDF from this pull, the PDF on the row is never passed
-- off as a checked one, and one attached by hand is never taken off (round
-- 3, the firm's decision): a PDF an earlier pull checked is kept; a PDF
-- attached by hand under the superadmin's allowance (or the manual route)
-- is kept and the row stays manual; any other PDF attached by hand (before
-- 21 Oct 2026) is kept, marked "attached by hand, not checked by a pull"
-- (pdf_note); only a PDF the extension's own pull stored before 0.15.0
-- (filing_pdf_from_old_pull: the System generated summary problem) is taken
-- off, the log keeping its address (old_pdf_url). A filing date typed by
-- hand that no pull read is kept and marked (date_note). A pull that leaves
-- the return with its checked PDF closes the superadmin's allowance for it
-- (used or not; revoked with the puller as revoked_by): nothing manual can
-- then be put over it. A refused pull writes nothing, not even the row it
-- would have created. Every outcome is logged (filing_status_log), so the
-- page learns it even when the portal tab or the page was closed.
CREATE OR REPLACE FUNCTION public.filing_record_pull(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_arn          text,
  p_filed_date   date DEFAULT NULL,
  p_pdf_url      text DEFAULT NULL,
  p_pdf_note     text DEFAULT NULL,
  p_actor_id     uuid DEFAULT NULL,
  p_detail       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arn     text := NULLIF(upper(btrim(p_arn)), '');
  v_pdf     text := NULLIF(btrim(p_pdf_url), '');
  v_note    text := NULLIF(btrim(p_pdf_note), '');
  v_date    date := p_filed_date;
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_family  text[] := public.filing_family(p_return_type);
  v_problem text;
  v_detail  jsonb;
  v_target  public.filing_status;
  v_holder  public.filing_status;
  v_outcome text;
  v_msg     text;
  v_log     uuid;
  v_who     text;
  -- What the row holds after the pull.
  v_new_pdf    text;
  v_new_note   text;
  v_new_source text;
  v_new_allow  uuid;
  v_pdf_words  text := '';
  v_closed     integer := 0;
  v_old_pdf    text;
  v_new_date   date;
  v_new_date_note text;
BEGIN
  PERFORM public.filing__check_call(p_client_id, p_return_type, p_period_month);
  v_detail := jsonb_build_object('pulled', jsonb_build_object(
      'arn', v_arn, 'filed_date', p_filed_date, 'pdf_url', v_pdf, 'pdf_note', v_note))
    || jsonb_build_object('ext_version', 'not given')
    || COALESCE(p_detail, '{}'::jsonb);

  -- A pull is asked for by a staff member on Filing Status; the extension
  -- passes who (p_actor_id) and the page's request id (p_detail.request_id),
  -- and both are logged. This is a record of who asked, not a proof: the
  -- anon key can still call this function with a staff member's id.
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS NULL THEN
    v_msg := 'The pull was not recorded: it did not come from a GST Keeper staff member''s request on Filing Status.';
    v_log := public.filing__log(p_client_id, p_return_type, p_period_month, NULL, 'refused', 'portal', p_actor_id, v_msg, v_detail);
    RETURN jsonb_build_object('outcome', 'refused', 'message', v_msg, 'log_id', v_log);
  END IF;
  IF NOT public.filing__can_edit(p_actor_id) THEN
    v_msg := 'The pull was not recorded: pulling filed returns needs the Filing status & portal push permission. Ask a GST Manager to add it to your position.';
    v_log := public.filing__log(p_client_id, p_return_type, p_period_month, NULL, 'refused', 'portal', p_actor_id, v_msg, v_detail);
    RETURN jsonb_build_object('outcome', 'refused', 'message', v_msg, 'log_id', v_log);
  END IF;

  v_problem := public.filing_arn_problem(p_client_id, p_return_type, p_period_month, v_arn);
  IF v_problem IS NOT NULL THEN
    v_log := public.filing__log(p_client_id, p_return_type, p_period_month, NULL, 'refused', 'portal', p_actor_id,
      'The pull was not recorded. ' || v_problem, v_detail);
    RETURN jsonb_build_object('outcome', 'refused', 'message', 'The pull was not recorded. ' || v_problem, 'log_id', v_log);
  END IF;

  IF v_pdf IS NOT NULL AND NOT public.filing_pdf_url_ok(p_client_id, v_pdf) THEN
    v_pdf := NULL;
    v_note := 'The PDF was not in this client''s folder of return PDFs in GST Keeper, so it was not stored.';
  END IF;
  IF v_pdf IS NULL AND v_note IS NULL THEN
    v_note := 'No PDF came with the pull.';
  END IF;
  IF v_date IS NOT NULL AND (v_date > v_today OR v_date < to_date('01/' || p_period_month, 'DD/MM/YYYY')) THEN
    v_detail := v_detail || jsonb_build_object('date_refused', v_date);
    v_date := NULL;
  END IF;

  -- One pull of a return at a time.
  PERFORM pg_advisory_xact_lock(hashtext('filing_status:' || p_client_id::text || ':' || p_period_month || ':' || v_family[1]));

  SELECT * INTO v_holder FROM public.filing_status WHERE arn = v_arn FOR UPDATE;
  IF FOUND THEN
    IF v_holder.client_id = p_client_id AND v_holder.period_month = p_period_month
       AND v_holder.return_type::text = ANY (v_family) THEN
      v_target := v_holder;
    ELSE
      -- The ARN sits on another return. The conflict also names this
      -- return's row and the ARN it holds (old_arn, the panel's "Holds"),
      -- so the superadmin sees everything Accept would replace.
      SELECT * INTO v_target FROM public.filing_status f
       WHERE f.client_id = p_client_id AND f.period_month = p_period_month AND f.return_type::text = ANY (v_family)
       ORDER BY (f.arn IS NOT NULL) DESC, (f.status::text = 'Filed') DESC, (f.return_type::text = p_return_type) DESC
       LIMIT 1;
      SELECT c.name INTO v_who FROM public.clients c WHERE c.id = v_holder.client_id;
      v_msg := format('The portal gave ARN %s, but that ARN is on %s, %s %s.', v_arn, COALESCE(v_who, 'another client'),
          v_holder.return_type::text, v_holder.period_month)
        || CASE WHEN v_target.arn IS NOT NULL THEN format(' This return holds ARN %s.', v_target.arn) ELSE '' END
        || ' Nothing was changed. The superadmin decides which is right.';
      v_log := public.filing__log(p_client_id, COALESCE(v_target.return_type::text, p_return_type), p_period_month, v_target.id,
        'conflict', 'portal', p_actor_id, v_msg,
        v_detail || jsonb_build_object('arn_on', v_holder.id, 'pulled_filed_date', v_date, 'pulled_pdf_url', v_pdf, 'pulled_pdf_note', v_note));
      RETURN jsonb_build_object('outcome', 'conflict', 'message', v_msg, 'log_id', v_log, 'id', v_target.id,
        'return_type', COALESCE(v_target.return_type::text, p_return_type));
    END IF;
  END IF;

  -- Round 3: everything that writes, the row's creation included, is in
  -- one block, so a refused pull leaves nothing behind (it used to leave a
  -- new 'Prepared' row where the page showed Data Pending).
  BEGIN
    IF v_target.id IS NULL THEN
      v_target := public.filing__target_row(p_client_id, p_return_type, p_period_month);
    END IF;

    IF v_target.arn IS NOT NULL AND v_target.arn <> v_arn THEN
      v_msg := format('The portal gave ARN %s, but this return holds ARN %s. Nothing was changed. The superadmin decides which is right.',
        v_arn, v_target.arn);
      v_log := public.filing__log(p_client_id, v_target.return_type::text, p_period_month, v_target.id, 'conflict', 'portal', p_actor_id, v_msg,
        v_detail || jsonb_build_object('pulled_filed_date', v_date, 'pulled_pdf_url', v_pdf, 'pulled_pdf_note', v_note));
      RETURN jsonb_build_object('outcome', 'conflict', 'message', v_msg, 'log_id', v_log, 'id', v_target.id,
        'return_type', v_target.return_type::text);
    END IF;

    v_outcome := CASE WHEN v_target.status::text = 'Filed' AND v_target.arn = v_arn THEN 'refreshed' ELSE 'filed' END;
    v_old_pdf := NULLIF(btrim(v_target.return_pdf_url), '');

    -- The PDF the row shows afterwards (see above).
    v_new_source := 'portal';
    v_new_allow := NULL;
    IF v_pdf IS NOT NULL THEN
      v_new_pdf := v_pdf;
      v_new_note := NULL;
    ELSIF v_old_pdf IS NOT NULL AND v_target.filed_source = 'portal' AND v_target.pdf_note IS NULL THEN
      v_new_pdf := v_old_pdf;
      v_new_note := NULL;
      v_pdf_words := ' No checked PDF this time (' || rtrim(v_note, '.') || '); the one an earlier pull checked is kept.';
    ELSIF v_old_pdf IS NOT NULL AND v_target.filed_source = 'manual' THEN
      v_new_pdf := v_old_pdf;
      v_new_note := NULL;
      v_new_source := 'manual';
      v_new_allow := v_target.manual_allowance_id;
      v_pdf_words := ' No checked PDF from the portal (' || rtrim(v_note, '.') || '); the PDF attached by hand is kept, still marked manual.';
    ELSIF v_old_pdf IS NOT NULL AND NOT public.filing_pdf_from_old_pull(v_old_pdf) THEN
      -- Round 3 (the firm's decision): a PDF attached by hand is never taken
      -- off by a pull that brings no checked PDF. It stays on the row, shown
      -- as attached by hand and not checked by a pull (pdf_note).
      v_new_pdf := v_old_pdf;
      v_new_note := 'Attached by hand, not checked by a pull. ' || v_note;
      v_pdf_words := ' No checked PDF from the portal (' || rtrim(v_note, '.') || '); the PDF attached by hand is kept, marked as not checked by a pull.';
    ELSE
      -- No PDF, or one stored by the extension's pull before 0.15.0, which
      -- could not tell the System generated summary from the filed return:
      -- taken off; the log keeps its address (old_pdf_url).
      v_new_pdf := NULL;
      v_new_note := v_note || CASE WHEN v_old_pdf IS NOT NULL
        THEN ' The PDF an earlier copy of the extension stored was not checked, so it is no longer shown (the log keeps its address).' ELSE '' END;
      v_pdf_words := ' ' || v_new_note;
    END IF;

    -- The filing date (round 3): the portal's when the pull read it. Else the
    -- one the row holds for this ARN is kept; when no pull read that one (it
    -- was typed by hand), the row says so (date_note) and a bulk pull asks
    -- again, instead of showing it under "Portal".
    v_new_date := COALESCE(v_date, CASE WHEN v_target.arn = v_arn OR v_target.arn IS NULL THEN v_target.filed_date END);
    v_new_date_note := CASE
      WHEN v_date IS NOT NULL OR v_new_date IS NULL OR v_new_source <> 'portal' THEN NULL
      WHEN v_target.filed_source = 'portal' THEN v_target.date_note
      ELSE 'Typed by hand; no pull has read the portal''s filing date yet.' END;

    v_msg := CASE v_outcome
      WHEN 'refreshed' THEN 'Pulled again from the portal: same ARN.'
      ELSE 'Filed, from the portal.' END
      || CASE WHEN v_date IS NULL AND v_new_date IS NULL THEN ' The portal''s filing date was not read.'
              WHEN v_date IS NULL AND v_new_date_note IS NOT NULL THEN ' The portal''s filing date was not read; the date typed by hand is kept, marked as such.'
              WHEN v_date IS NULL THEN ' The portal''s filing date was not read this time; the one read before is kept.'
              ELSE '' END
      || v_pdf_words;

    -- The superadmin's allowance for this return (used or not) is closed
    -- once the return holds its checked PDF from the portal. Inside this
    -- block, so a refused write leaves it open.
    IF v_new_source = 'portal' AND v_new_pdf IS NOT NULL AND v_new_note IS NULL THEN
      PERFORM set_config('app.manual_source_write', 'on', true);
      UPDATE public.manual_source_allowances a
         SET revoked_at = now(), revoked_by = p_actor_id
       WHERE a.client_id = p_client_id AND a.period_month = p_period_month AND a.revoked_at IS NULL
         AND a.scope IN (SELECT 'filing:' || t FROM unnest(v_family) t);
      GET DIAGNOSTICS v_closed = ROW_COUNT;
      PERFORM set_config('app.manual_source_write', '', true);
      IF v_closed > 0 THEN
        v_msg := v_msg || ' The manual upload allowed for this return was closed by this pull.';
        v_detail := v_detail || jsonb_build_object('allowances_closed', v_closed);
      END IF;
    END IF;

    PERFORM public.filing__route('portal', v_outcome, p_actor_id, v_msg, v_detail, v_new_date, v_new_allow);
    UPDATE public.filing_status
       SET status = 'Filed'::public.filing_status_type,
           arn = v_arn,
           return_pdf_url = v_new_pdf,
           filed_source = v_new_source,
           manual_allowance_id = v_new_allow,
           pulled_at = now(),
           pdf_note = v_new_note,
           date_note = v_new_date_note,
           updated_by = COALESCE(p_actor_id, updated_by),
           updated_at = now()
     WHERE id = v_target.id
    RETURNING * INTO v_target;
  EXCEPTION WHEN check_violation OR raise_exception OR unique_violation THEN
    v_msg := 'The pull was not recorded. ' || SQLERRM;
    PERFORM public.filing__route_end();
    -- A row this pull created went with the block: the log names none then.
    v_log := public.filing__log(p_client_id, COALESCE(v_target.return_type::text, p_return_type), p_period_month,
      (SELECT f.id FROM public.filing_status f WHERE f.id = v_target.id), 'refused', 'portal',
      p_actor_id, v_msg, v_detail - 'allowances_closed');
    RETURN jsonb_build_object('outcome', 'refused', 'message', v_msg, 'log_id', v_log,
      'id', (SELECT f.id FROM public.filing_status f WHERE f.id = v_target.id),
      'return_type', COALESCE(v_target.return_type::text, p_return_type));
  END;
  PERFORM public.filing__route_end();

  RETURN jsonb_build_object('outcome', v_outcome, 'message', v_msg, 'id', v_target.id,
    'return_type', v_target.return_type::text, 'filed_date', v_target.filed_date,
    'pdf_stored', v_pdf IS NOT NULL);
END;
$$;

-- An outcome that wrote nothing: the return was not found on the portal,
-- the pull failed (login, CAPTCHA, a page that did not load), or a GSTR-1A
-- was seen and kept apart. Logged so the page shows it.
CREATE OR REPLACE FUNCTION public.filing_pull_report(
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_outcome      text,
  p_message      text,
  p_actor_id     uuid DEFAULT NULL,
  p_detail       jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.filing__check_call(p_client_id, p_return_type, p_period_month);
  IF p_outcome IS NULL OR p_outcome NOT IN ('not_found', 'failed', 'gstr1a_seen') THEN
    RAISE EXCEPTION 'Unknown pull outcome %.', COALESCE(p_outcome, '(none)') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN public.filing__log(p_client_id, p_return_type, p_period_month,
    (SELECT f.id FROM public.filing_status f WHERE f.client_id = p_client_id AND f.period_month = p_period_month
        AND f.return_type::text = p_return_type),
    p_outcome, 'portal', p_actor_id, left(COALESCE(NULLIF(btrim(p_message), ''), p_outcome), 500),
    COALESCE(p_detail, '{}'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5b. The manual route
-- ---------------------------------------------------------------------------
-- A staff member attaches the filed return's PDF (already uploaded to this
-- client's folder in return-pdfs) with its ARN and filing date. For a return
-- that is pulled only (GSTR-1, GSTR-3B), asked for or landed on as a twin,
-- the superadmin's live allowance for that client, period and return
-- ('filing:<return type>') is required and used up; the others say why they
-- may be attached by hand (filing_manual_reason). A PDF attached by hand that
-- no pull checked may be replaced this way (round 3). The
-- ARN must fit the client's state and the period; a row holding another ARN
-- is never overwritten, nor one already pulled from the portal with its
-- checked PDF (whatever allowance is live). The staff member needs the
-- Filing status permission, as the page offers it. The row is marked
-- manual, with the allowance.
CREATE OR REPLACE FUNCTION public.filing_attach_manual(
  p_actor_id     uuid,
  p_client_id    uuid,
  p_return_type  text,
  p_period_month text,
  p_arn          text,
  p_filed_date   date,
  p_pdf_url      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arn     text := NULLIF(upper(btrim(p_arn)), '');
  v_pdf     text := NULLIF(btrim(p_pdf_url), '');
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_family  text[] := public.filing_family(p_return_type);
  v_problem text;
  v_target  public.filing_status;
  v_holder  public.filing_status;
  v_allow   public.manual_source_allowances;
  v_who     text;
  v_msg     text;
  v_type    text;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS NULL THEN
    RAISE EXCEPTION 'Only staff can attach a filed return.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.filing__can_edit(p_actor_id) THEN
    RAISE EXCEPTION 'Attaching a filed return needs the Filing status & portal push permission. Ask a GST Manager to add it to your position.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.filing__check_call(p_client_id, p_return_type, p_period_month);
  v_problem := public.filing_arn_problem(p_client_id, p_return_type, p_period_month, v_arn);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.filing_pdf_url_ok(p_client_id, v_pdf) THEN
    RAISE EXCEPTION 'Attach the filed return''s PDF (uploaded to this client''s folder in GST Keeper).' USING ERRCODE = 'check_violation';
  END IF;
  IF p_filed_date IS NULL OR p_filed_date > v_today OR p_filed_date < to_date('01/' || p_period_month, 'DD/MM/YYYY') THEN
    RAISE EXCEPTION 'Give the filing date shown on the return (the date of ARN), not before the period and not in the future.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('filing_status:' || p_client_id::text || ':' || p_period_month || ':' || v_family[1]));

  SELECT * INTO v_holder FROM public.filing_status WHERE arn = v_arn FOR UPDATE;
  IF FOUND THEN
    IF v_holder.client_id = p_client_id AND v_holder.period_month = p_period_month
       AND v_holder.return_type::text = ANY (v_family) THEN
      v_target := v_holder;
    ELSE
      SELECT c.name INTO v_who FROM public.clients c WHERE c.id = v_holder.client_id;
      RAISE EXCEPTION 'ARN % is already on %, % %.', v_arn, COALESCE(v_who, 'another client'),
        v_holder.return_type::text, v_holder.period_month USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    SELECT * INTO v_target FROM public.filing_status
     WHERE client_id = p_client_id AND period_month = p_period_month AND return_type::text = p_return_type
     FOR UPDATE;
    IF NOT FOUND THEN
      v_target := public.filing__target_row(p_client_id, p_return_type, p_period_month);
    END IF;
  END IF;
  IF v_target.arn IS NOT NULL AND v_target.arn <> v_arn THEN
    RAISE EXCEPTION 'This return already holds ARN %. A different ARN is not put over it: the superadmin can take it off Filed first.',
      v_target.arn USING ERRCODE = 'check_violation';
  END IF;
  IF v_target.filed_source = 'portal' AND NULLIF(btrim(v_target.return_pdf_url), '') IS NOT NULL AND v_target.pdf_note IS NULL THEN
    RAISE EXCEPTION 'This % was pulled from the portal with its checked PDF. A manual upload is not put over it.', v_target.return_type::text
      USING ERRCODE = 'check_violation';
  END IF;

  -- The row the PDF lands on decides as well as the type asked for (round
  -- 3): GSTR-1 (IFF) / GSTR-3B (Q) keep a manual route, so asking for one
  -- of them must not file the client's GSTR-1 / GSTR-3B twin row without
  -- the superadmin's allowance.
  v_type := CASE WHEN public.filing_pull_only(p_return_type) THEN p_return_type
                 WHEN public.filing_pull_only(v_target.return_type::text) THEN v_target.return_type::text END;
  IF v_type IS NOT NULL THEN
    v_allow := public.manual_source_take(p_actor_id, p_client_id, p_period_month, 'filing:' || v_type);
  END IF;

  v_msg := CASE WHEN v_allow.id IS NOT NULL
    THEN 'Attached by hand, allowed by the superadmin: ' || v_allow.reason
    ELSE format('Attached by hand (%s).', public.filing_manual_reason(v_target.return_type::text)) END;
  PERFORM public.filing__route('manual', 'manual_attach', p_actor_id, v_msg,
    jsonb_build_object('arn', v_arn, 'filed_date', p_filed_date, 'pdf_url', v_pdf), p_filed_date, v_allow.id);
  UPDATE public.filing_status
     SET status = 'Filed'::public.filing_status_type,
         arn = v_arn,
         return_pdf_url = v_pdf,
         filed_source = 'manual',
         manual_allowance_id = v_allow.id,
         pdf_note = NULL,
         date_note = NULL,
         updated_by = p_actor_id,
         updated_at = now()
   WHERE id = v_target.id
  RETURNING * INTO v_target;
  PERFORM public.filing__route_end();

  RETURN jsonb_build_object('outcome', 'manual_attach', 'message', v_msg, 'id', v_target.id,
    'return_type', v_target.return_type::text, 'allowance_id', v_allow.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5c. Unlock, take off Filed, and conflicts
-- ---------------------------------------------------------------------------
-- Unlock (GST Manager, superadmin, or an employee holding unlock_sheets): the
-- period's GSTR-3B / GSTR-3B (Q) rows go to 'Prepared Pending' (shown as Not
-- to File) and are unlocked, as before, but keep their ARN, filing date and
-- PDF: the return is still filed on the portal, and pulling that row again
-- files it again (same ARN). The page's bulk and per-client pulls leave such
-- a row out, so a correction is never re-locked behind the staff's back. The
-- sheets themselves are unlocked by the page, as before.
CREATE OR REPLACE FUNCTION public.filing_status_unlock(
  p_actor_id     uuid,
  p_client_id    uuid,
  p_period_month text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  -- Who may unlock is who the page offers Unlock to (canUnlockSheets): a GST
  -- Manager, the superadmin, or an employee whose position holds Unlock
  -- sheets (unlock_sheets).
  IF p_actor_id IS NULL
     OR NOT (COALESCE(public.staff_level_of(p_actor_id) IN ('superadmin', 'gst_manager'), false)
             OR (public.staff_level_of(p_actor_id) = 'employee'
                 AND EXISTS (SELECT 1 FROM public.user_permissions up
                              WHERE up.user_id = p_actor_id AND up.permission_key = 'unlock_sheets'))) THEN
    RAISE EXCEPTION 'Unlocking a filed return needs the Unlock sheets permission (a GST Manager, the superadmin, or a position that holds it).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.filing__route('unlock', 'unlocked', p_actor_id, 'Unlocked. The ARN, filing date and PDF are kept.', NULL, NULL, NULL);
  UPDATE public.filing_status
     SET status = 'Prepared Pending'::public.filing_status_type,
         is_locked = false,
         updated_by = p_actor_id,
         updated_at = now()
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.filing__route_end();
  RETURN v_n;
END;
$$;

-- Take off Filed (superadmin, with a reason): the row goes back to Prepared
-- and loses its ARN, filing date and PDF. The log keeps what it held. A
-- GSTR-3B / GSTR-3B (Q) is unlocked too, so staff can work the return again;
-- the page unlocks the month's sheets, as Unlock does.
CREATE OR REPLACE FUNCTION public.filing_status_unfile(
  p_actor_id uuid,
  p_id       uuid,
  p_reason   text
)
RETURNS public.filing_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.filing_status;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin can take a return off Filed.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason of at least 5 characters.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_row FROM public.filing_status WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return not found.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM public.filing__route('unfile', 'unfiled', p_actor_id, 'Taken off Filed: ' || btrim(p_reason), NULL, NULL, NULL);
  UPDATE public.filing_status
     SET status = CASE WHEN status::text IN ('Filed', 'Prepared Pending') THEN 'Prepared'::public.filing_status_type ELSE status END,
         arn = NULL,
         filed_date = NULL,
         return_pdf_url = NULL,
         filed_source = NULL,
         manual_allowance_id = NULL,
         pulled_at = NULL,
         pdf_note = NULL,
         date_note = NULL,
         is_locked = CASE WHEN return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN false ELSE is_locked END,
         updated_by = p_actor_id,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;
  PERFORM public.filing__route_end();
  RETURN v_row;
END;
$$;

-- The superadmin decides a pull's conflict. Keep: nothing changes. Accept:
-- the pulled ARN, date and PDF go on the return; when the ARN was on another
-- return, that one is taken off Filed first, and unlocked as Take off Filed
-- does (both logged). Accept is refused when the return now holds an ARN
-- the conflict did not show (old_arn, the panel's "Holds": a conflict
-- logged before round 2 named only the other return, or the row changed
-- since): nothing nobody saw is replaced. Keep it and pull again.
CREATE OR REPLACE FUNCTION public.filing_pull_conflict_decide(
  p_actor_id uuid,
  p_log_id   uuid,
  p_accept   boolean,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log    public.filing_status_log;
  v_pulled jsonb;
  v_arn    text;
  v_date   date;
  v_pdf    text;
  v_note   text;
  v_target public.filing_status;
  v_holder public.filing_status;
  v_msg    text;
BEGIN
  IF p_actor_id IS NULL OR public.staff_level_of(p_actor_id) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only the superadmin decides a pull conflict.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_log FROM public.filing_status_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND OR v_log.event <> 'conflict' THEN
    RAISE EXCEPTION 'Conflict not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_log.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This conflict was already decided.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT COALESCE(p_accept, false) THEN
    UPDATE public.filing_status_log
       SET resolved_at = now(), resolved_by = p_actor_id,
           resolution = 'Kept as it was' || COALESCE(': ' || NULLIF(btrim(p_note), ''), '.')
     WHERE id = p_log_id;
    RETURN jsonb_build_object('outcome', 'kept');
  END IF;

  v_pulled := v_log.detail -> 'pulled';
  v_arn := v_pulled ->> 'arn';
  v_date := NULLIF(v_log.detail ->> 'pulled_filed_date', '')::date;
  v_pdf := NULLIF(v_log.detail ->> 'pulled_pdf_url', '');
  v_note := NULLIF(v_log.detail ->> 'pulled_pdf_note', '');
  IF public.filing_arn_problem(v_log.client_id, v_log.return_type, v_log.period_month, v_arn) IS NOT NULL THEN
    RAISE EXCEPTION 'The pulled ARN no longer fits this return.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('filing_status:' || v_log.client_id::text || ':' || v_log.period_month || ':'
    || (public.filing_family(v_log.return_type))[1]));

  IF v_log.filing_status_id IS NOT NULL THEN
    SELECT * INTO v_target FROM public.filing_status WHERE id = v_log.filing_status_id FOR UPDATE;
  END IF;
  IF v_target.id IS NULL THEN
    v_target := public.filing__target_row(v_log.client_id, v_log.return_type, v_log.period_month);
  END IF;
  IF v_target.arn IS NOT NULL AND v_target.arn <> v_arn AND v_target.arn IS DISTINCT FROM v_log.old_arn THEN
    RAISE EXCEPTION 'This return now holds ARN %, which this conflict did not show. Keep this conflict and pull the return again.',
      v_target.arn USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_holder FROM public.filing_status WHERE arn = v_arn FOR UPDATE;
  IF FOUND AND v_holder.id <> v_target.id THEN
    PERFORM public.filing__route('unfile', 'unfiled', p_actor_id,
      format('Taken off Filed: the superadmin gave ARN %s to %s %s instead.', v_arn, v_log.return_type, v_log.period_month),
      jsonb_build_object('conflict_log_id', p_log_id), NULL, NULL);
    UPDATE public.filing_status
       SET status = CASE WHEN status::text IN ('Filed', 'Prepared Pending') THEN 'Prepared'::public.filing_status_type ELSE status END,
           arn = NULL, filed_date = NULL, return_pdf_url = NULL, filed_source = NULL,
           manual_allowance_id = NULL, pulled_at = NULL, pdf_note = NULL, date_note = NULL,
           is_locked = CASE WHEN return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)') THEN false ELSE is_locked END,
           updated_by = p_actor_id, updated_at = now()
     WHERE id = v_holder.id;
    PERFORM public.filing__route_end();
  END IF;

  v_msg := 'The superadmin accepted the pulled ARN ' || v_arn || COALESCE(': ' || NULLIF(btrim(p_note), ''), '.');
  PERFORM public.filing__route('conflict', 'conflict_accepted', p_actor_id, v_msg,
    jsonb_build_object('conflict_log_id', p_log_id), v_date, NULL);
  UPDATE public.filing_status
     SET status = 'Filed'::public.filing_status_type,
         arn = v_arn,
         return_pdf_url = v_pdf,
         filed_source = 'portal',
         manual_allowance_id = NULL,
         pulled_at = v_log.at,
         pdf_note = CASE WHEN v_pdf IS NOT NULL THEN NULL ELSE COALESCE(v_note, 'No PDF came with the pull.') END,
         date_note = NULL,
         updated_by = p_actor_id,
         updated_at = now()
   WHERE id = v_target.id
  RETURNING * INTO v_target;
  PERFORM public.filing__route_end();

  UPDATE public.filing_status_log
     SET resolved_at = now(), resolved_by = p_actor_id,
         resolution = 'Accepted' || COALESCE(': ' || NULLIF(btrim(p_note), ''), '.')
   WHERE id = p_log_id;
  RETURN jsonb_build_object('outcome', 'accepted', 'id', v_target.id, 'return_type', v_target.return_type::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.filing_record_pull(uuid, text, text, text, date, text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_pull_report(uuid, text, text, text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_attach_manual(uuid, uuid, text, text, text, date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_status_unlock(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_status_unfile(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filing_pull_conflict_decide(uuid, uuid, boolean, text) TO anon, authenticated, service_role;

-- ===========================================================================
-- 6. Scheme change: a filed return is kept
-- ===========================================================================
-- Before, a scheme change (Edit Client, any staff member holding Add/Edit
-- clients, from any back date) took every return of the old scheme off
-- Filed and wiped its ARN and date, with no reason and no superadmin. Now a
-- row holding a filed return (Filed, or an ARN, filing date, PDF or source)
-- is kept as it is: it was filed on the portal, and the page shows a twin
-- of the other scheme as "Not applicable" anyway. The log says it was kept;
-- only the superadmin takes a return off Filed (filing_status_unfile, with a
-- reason). A locked row holding no filed return is reset as before.
CREATE OR REPLACE FUNCTION public.clear_inapplicable_filing_status_after_scheme_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicable_returns public.return_type[];
BEGIN
  applicable_returns := CASE NEW.new_scheme
    WHEN 'Regular' THEN ARRAY['GSTR-1', 'GSTR-3B', 'ITC-04']::public.return_type[]
    WHEN 'IFF' THEN ARRAY['GSTR-1 (IFF)', 'GSTR-3B (Q)']::public.return_type[]
    WHEN 'Composition' THEN ARRAY['CMP-08']::public.return_type[]
    WHEN 'Tax Deductor' THEN ARRAY['GSTR-7']::public.return_type[]
    WHEN 'ISD' THEN ARRAY['GSTR-6']::public.return_type[]
    ELSE ARRAY[]::public.return_type[]
  END;

  -- Filed returns of the old scheme: kept, and logged as kept.
  INSERT INTO public.filing_status_log
    (client_id, return_type, period_month, filing_status_id, event, route, actor_id,
     old_status, new_status, old_arn, new_arn, old_filed_date, new_filed_date, old_pdf_url, new_pdf_url,
     old_locked, new_locked, message, detail)
  SELECT fs.client_id, fs.return_type::text, fs.period_month, fs.id, 'scheme_change', 'scheme', NEW.changed_by,
         fs.status::text, fs.status::text, fs.arn, fs.arn, fs.filed_date, fs.filed_date, fs.return_pdf_url, fs.return_pdf_url,
         fs.is_locked, fs.is_locked,
         format('Kept Filed: not a return of the %s scheme from %s, but it was filed. Only the superadmin takes a return off Filed.',
           NEW.new_scheme, to_char(NEW.effective_from_date, 'DD Mon YYYY')),
         jsonb_build_object('scheme_history_id', NEW.id)
    FROM public.filing_status fs
   WHERE fs.client_id = NEW.client_id
     AND to_date('01/' || fs.period_month, 'DD/MM/YYYY') >= date_trunc('month', NEW.effective_from_date)::date
     AND NOT (fs.return_type = ANY(applicable_returns))
     AND (fs.status::text = 'Filed' OR fs.arn IS NOT NULL OR fs.filed_date IS NOT NULL
          OR NULLIF(btrim(fs.return_pdf_url), '') IS NOT NULL OR fs.filed_source IS NOT NULL);

  -- Locked rows holding no filed return: reset, as before.
  PERFORM public.filing__route('scheme', 'scheme_change', NEW.changed_by,
    format('Reset: not a return of the %s scheme from %s.', NEW.new_scheme, to_char(NEW.effective_from_date, 'DD Mon YYYY')),
    jsonb_build_object('scheme_history_id', NEW.id), NULL, NULL);
  UPDATE public.filing_status fs
  SET status = 'Data Pending',
      is_locked = false,
      updated_at = now()
  WHERE fs.client_id = NEW.client_id
    AND to_date('01/' || fs.period_month, 'DD/MM/YYYY') >= date_trunc('month', NEW.effective_from_date)::date
    AND NOT (fs.return_type = ANY(applicable_returns))
    AND fs.is_locked = true
    AND fs.status::text <> 'Filed' AND fs.arn IS NULL AND fs.filed_date IS NULL
    AND NULLIF(btrim(fs.return_pdf_url), '') IS NULL AND fs.filed_source IS NULL;
  PERFORM public.filing__route_end();

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_inapplicable_filing_status_after_scheme_change() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 7. Realtime: the page hears a pull's outcome and the allowances
-- ===========================================================================
-- A channel naming a table outside the publication fails as a whole, which
-- is why the Filing Status page never heard the extension's writes (its
-- channel also named gstr1_data and gstr1_direct_filing_approvals). The page
-- now uses one channel per table; these three are added so they can be heard.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['filing_status_log', 'manual_source_allowances', 'gstr1_direct_filing_approvals'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

COMMIT;
