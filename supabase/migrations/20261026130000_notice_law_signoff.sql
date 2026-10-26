-- Notices & Litigation, the law audit of 26 October 2026, L16: no statutory
-- period, form rule or limitation year had ever been confirmed by a partner.
-- These doors let a GST Manager or the superadmin confirm one (Notices · Setup
-- → Law rules), correcting its value in the same step. Additive.

CREATE OR REPLACE FUNCTION public.litigation_rule_confirm(p_key text, p_value numeric, p_note text, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can confirm a law rule.');
  END IF;
  IF p_value IS NULL OR p_value < 0 THEN RETURN jsonb_build_object('error', 'Give the value the law sets.'); END IF;
  UPDATE public.litigation_rules
     SET value = p_value, note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
         confirmed_at = now(), confirmed_by = left(coalesce(p_actor_name, p_actor_id::text), 120)
   WHERE key = p_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'No such rule.'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.litigation_rule_confirm(text, numeric, text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_form_rule_confirm(p_form_code text, p_reply_days int, p_reply_day_kind text, p_appeal_section text,
                                                           p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can confirm a form rule.');
  END IF;
  IF p_reply_day_kind IS NOT NULL AND p_reply_day_kind NOT IN ('calendar', 'working') THEN
    RETURN jsonb_build_object('error', 'Days are calendar or working days.');
  END IF;
  IF nullif(p_appeal_section, '') IS NOT NULL AND p_appeal_section NOT IN ('s107', 's112') THEN
    RETURN jsonb_build_object('error', 'An appeal lies under s.107 or s.112.');
  END IF;
  UPDATE public.notice_form_rules
     SET reply_days = p_reply_days, reply_day_kind = coalesce(p_reply_day_kind, reply_day_kind),
         appeal_section = nullif(p_appeal_section, ''),
         confirmed_at = now(), confirmed_by = left(coalesce(p_actor_name, p_actor_id::text), 120)
   WHERE form_code = p_form_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'No such form.'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_form_rule_confirm(text, int, text, text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gst_limitation_year_confirm(p_fy text, p_annual_return_due date, p_s73_order_by date, p_s74_order_by date,
                                                              p_s74a_scn_by date, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can confirm a limitation year.');
  END IF;
  IF p_annual_return_due IS NULL THEN RETURN jsonb_build_object('error', 'Give the annual return due date.'); END IF;
  UPDATE public.gst_limitation_years
     SET annual_return_due = p_annual_return_due, s73_order_by = p_s73_order_by, s74_order_by = p_s74_order_by, s74a_scn_by = p_s74a_scn_by,
         confirmed_at = now(), confirmed_by = left(coalesce(p_actor_name, p_actor_id::text), 120), updated_at = now()
   WHERE fy = p_fy;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'No such year.'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.gst_limitation_year_confirm(text, date, date, date, date, uuid, text) TO anon, authenticated, service_role;
