-- A client's own login may set Import 2B actions on its own GSTIN (the firm,
-- 20 Nov 2026: "edit like staff, own GSTIN only, only Import 2B").
-- The app's client login sends its client id as the actor (x-gst-actor, and
-- p_actor_id on the calls); these three checks now accept that actor for that
-- client's own rows, as they accept a holder of Import 2B & post:
--   twob__autopost_touch     a save that changes the ledger
--   twob_import2b_reclaim    Reclaim
--   twob_import2b_unreclaim  a document out of Reclaim
-- Everything else stays staff-only (deleting 2B, Clear Data, Restore, prior
-- months, the books register, catch-up). Filed months stay locked as before.
-- Undo: re-create the three functions from 20261021170000.

CREATE OR REPLACE FUNCTION public.twob__autopost_touch(p_client_id uuid, p_period text, p_book_ids uuid[], p_doc_ids uuid[], p_by uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v jsonb;
  v_actor uuid;
  v_req uuid := public.twob__acting_user();
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id) THEN
    RETURN;   -- a client being deleted
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  -- The guard (20261021100000) refuses a save in a prior month before this
  -- runs (it lets through only stamps and links, which post nothing); a
  -- month marked filed while the statement waited for the lock stops it
  -- here. twob_month_is_prior's condition, written out as the guard writes
  -- it: a statement's plan is kept for the session, a SQL function's is made
  -- again in every transaction, and every save is one.
  IF EXISTS (SELECT 1 FROM public.twob_ever_filed e
              WHERE e.client_id = p_client_id AND e.reopened_at IS NULL
                AND e.cover_key >= public.twob_period_key(p_period)) THEN
    RAISE EXCEPTION 'Not saved: % was just marked filed. Reload the page.', public.twob_month_name(p_period);
  END IF;
  v_actor := COALESCE(v_req, p_by);
  -- twob__staff_may(v_req, 'work_2b_import'), written out: this runs on
  -- every save, and the function (through staff_level_of, SECURITY DEFINER
  -- with its own search_path) cost more than the rest of a save's
  -- write-through.
  -- The client's own login (x-gst-actor = its client id) may post its own
  -- Import 2B actions (the firm, 20 Nov 2026), as a holder of the permission.
  IF v_req IS NOT NULL AND v_req IS DISTINCT FROM p_client_id AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_req
          AND (ur.role IN ('superadmin', 'gst_manager')
               OR (ur.role = 'employee' AND EXISTS (SELECT 1 FROM public.user_permissions up
                                                     WHERE up.user_id = v_req AND up.permission_key = 'work_2b_import')))) THEN
    v := public.twob__autopost_apply(p_client_id, p_period, p_book_ids, p_doc_ids, v_req, true, false);
    IF COALESCE((v ->> 'written')::integer, 0) > 0 THEN
      RAISE EXCEPTION 'Not saved: this change would change the 2B Reconciliation ledger, which needs the Import 2B & post permission. Ask a GST Manager to add it to your position.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN;
  END IF;
  v := public.twob__autopost_apply(p_client_id, p_period, p_book_ids, p_doc_ids, v_actor, false, false);
  IF COALESCE((v ->> 'written')::integer, 0) > 0 THEN
    PERFORM public.twob__autopost_changed(p_client_id, p_period, v_actor);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.twob_import2b_reclaim(p_actor_id uuid, p_client_id uuid, p_period text, p_pending_id uuid, p_doc_id uuid, p_expect_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc record;
  v_other jsonb;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL OR p_pending_id IS NULL OR p_doc_id IS NULL THEN
    RAISE EXCEPTION 'Choose the entry and the 2B document.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_expect_action, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Say which treatment the page showed for the 2B document (p_expect_action). Nothing was saved.';
  END IF;
  IF p_actor_id IS NULL OR (p_actor_id IS DISTINCT FROM p_client_id
     AND COALESCE(public.staff_level_of(p_actor_id), '') NOT IN ('superadmin', 'gst_manager', 'employee')) THEN
    RAISE EXCEPTION 'Only staff, or the client on its own GSTIN, record a reclaim.';
  END IF;
  SELECT d.id, d.itc_action, d.doc_type, COALESCE(d.is_amendment, false) AS am INTO v_doc
    FROM public.twob_import_docs d
   WHERE d.id = p_doc_id AND d.client_id = p_client_id AND d.period_month = p_period
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'document',
      'message', 'This 2B document is no longer in this month. Nothing was saved; the page shows the month as it is now.');
  END IF;
  IF v_doc.am OR COALESCE(v_doc.doc_type, 'INVOICE') NOT IN ('INVOICE', 'DEBIT_NOTE') THEN
    RAISE EXCEPTION 'Only an original invoice or debit note can evidence a reclaim.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change.';
  END IF;
  -- The document as the page showed it, and the evidence of no other reclaim
  -- (read under the client's lock, which every writer of a reclaim takes).
  IF v_doc.itc_action IS DISTINCT FROM p_expect_action THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'document', 'now', v_doc.itc_action,
      'message', format('This 2B document was changed elsewhere since the page showed it: it is %s now, not %s. Nothing was saved; the page shows the month as it is now.',
                        public.twob__treatment_label(v_doc.itc_action), public.twob__treatment_label(p_expect_action)));
  END IF;
  SELECT to_jsonb(t) INTO v_other FROM public.bills_not_in_2b t
   WHERE t.reclaimed_via_doc_id = p_doc_id AND t.id <> p_pending_id ORDER BY t.id LIMIT 1;
  IF v_other IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'document',
      'message', format('This 2B document is already the evidence of the reclaim of %s (%s, %s); one document evidences one reclaim. Nothing was saved; the page shows the month as it is now.',
                        COALESCE(public.twob__entry_name(v_other), 'another entry'),
                        COALESCE(NULLIF(btrim(COALESCE(v_other ->> 'reclaim_month', '')), ''), 'reclaimed'), public.twob_month_name(v_other ->> 'period_month')));
  END IF;
  -- The entry, still awaiting a reclaim, held; then the document made
  -- Reclaim, then the entry names it (an entry names only a Reclaim
  -- document: twob__reclaim_via_check, round 6).
  PERFORM 1 FROM public.bills_not_in_2b t
   WHERE t.id = p_pending_id AND t.client_id = p_client_id AND t.period_month = p_period
     AND NULLIF(btrim(COALESCE(t.reclaim_month, '')), '') IS NULL AND t.reclaim_subtype IS NULL
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'entry',
      'message', 'This entry is no longer awaiting a reclaim in this month. It was changed elsewhere (another tab, or a correction of a filed month that reached this month). Nothing was saved; the page shows the month as it is now.');
  END IF;
  UPDATE public.twob_import_docs SET itc_action = 'RECLAIM', updated_by = p_actor_id, updated_at = now() WHERE id = p_doc_id;
  UPDATE public.bills_not_in_2b t
     SET reclaim_month = public.twob_period_label(p_period), reclaim_subtype = NULL, reclaimed_via_doc_id = p_doc_id,
         updated_by = p_actor_id, updated_at = now()
   WHERE t.id = p_pending_id;
  RETURN jsonb_build_object('ok', true, 'was', v_doc.itc_action);
END;
$function$;

CREATE OR REPLACE FUNCTION public.twob_import2b_unreclaim(p_actor_id uuid, p_client_id uuid, p_period text, p_doc_id uuid, p_action text, p_expect_entry uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_was text;
  v_now uuid[];
  v_entry jsonb;
  n integer;
BEGIN
  IF p_client_id IS NULL OR public.twob_period_key(p_period) IS NULL OR p_doc_id IS NULL THEN
    RAISE EXCEPTION 'Choose the 2B document.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_action, '')), '') IS NULL OR p_action = 'RECLAIM' THEN
    RAISE EXCEPTION 'Choose the treatment the document takes instead of Reclaim.';
  END IF;
  IF p_actor_id IS DISTINCT FROM p_client_id AND NOT public.twob__staff_may(p_actor_id, 'work_2b_import') THEN
    RAISE EXCEPTION 'Needs the Import 2B & post permission. Ask a GST Manager to add it to your position.';
  END IF;
  SELECT d.itc_action INTO v_was FROM public.twob_import_docs d
   WHERE d.id = p_doc_id AND d.client_id = p_client_id AND d.period_month = p_period
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'gone', true,
      'message', 'This 2B document is no longer in this month. Nothing was saved; the page shows the month as it is now.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('twob:' || p_client_id::text, 0));
  IF public.twob_month_is_prior(p_client_id, p_period) THEN
    RAISE EXCEPTION 'This month is filed. Its 2B documents and the reversal, reclaim and book entry months cannot change.';
  END IF;
  IF v_was IS DISTINCT FROM 'RECLAIM' THEN
    RETURN jsonb_build_object('ok', false, 'gone', true, 'now', v_was,
      'message', format('This 2B document was changed elsewhere since the page showed it: it is %s now, not Reclaim. Nothing was saved; the page shows the month as it is now.',
                        public.twob__treatment_label(v_was)));
  END IF;
  -- The reclaim it evidences now, the entries held (no entry newly names
  -- the document meanwhile: that takes its row, held above), against the one
  -- the page showed. A document two entries name, recorded before the
  -- one-reclaim rule (GROWQ's July REDEL 25 on live), shows one of them on
  -- the page: either is the reclaim it showed, and both are released with it
  -- (verification round 8: before, every Save of it was refused as changed
  -- elsewhere, so it could never leave Reclaim). No entry newly names a
  -- document another names (twob__reclaim_via_check), so such a pair is
  -- never one recorded since the page loaded.
  SELECT COALESCE(array_agg(z.id ORDER BY z.id), '{}'::uuid[]) INTO v_now
    FROM (SELECT t.id FROM public.bills_not_in_2b t WHERE t.reclaimed_via_doc_id = p_doc_id ORDER BY t.id FOR NO KEY UPDATE) z;
  IF (CASE WHEN p_expect_entry IS NULL THEN cardinality(v_now) > 0 ELSE NOT (p_expect_entry = ANY (v_now)) END) THEN
    SELECT to_jsonb(t) INTO v_entry FROM public.bills_not_in_2b t WHERE t.id = v_now[1];
    RETURN jsonb_build_object('ok', false, 'gone', true, 'what', 'reclaim', 'now', to_jsonb(v_now),
      'message', format('The reclaim this 2B document evidences was changed elsewhere since the page showed it (another tab or another user): it is now the evidence of %s. Nothing was saved; the page shows the month as it is now.',
                        CASE WHEN v_entry IS NULL THEN 'no reclaim'
                             ELSE format('the reclaim of %s (%s, %s)', COALESCE(public.twob__entry_name(v_entry), 'an entry'),
                                         COALESCE(NULLIF(btrim(COALESCE(v_entry ->> 'reclaim_month', '')), ''), 'reclaimed'),
                                         public.twob_month_name(v_entry ->> 'period_month')) END));
  END IF;
  UPDATE public.bills_not_in_2b t
     SET reclaim_month = NULL, reclaim_subtype = NULL, reclaimed_via_doc_id = NULL, updated_by = p_actor_id, updated_at = now()
   WHERE t.reclaimed_via_doc_id = p_doc_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.twob_import_docs SET itc_action = p_action, updated_by = p_actor_id, updated_at = now() WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true, 'was', v_was, 'released', n);
END;
$function$;
