-- Test helpers, created after the migrations (they call the new functions).
-- Send a request for event e1…01 the way the BU Events dialog does: the
-- template filled in with {{confirm_link}} left for the function.
CREATE FUNCTION public.t_send(p_units uuid[], p_to text[], p_cc text[],
                               p_actor uuid DEFAULT '10000000-0000-0000-0000-000000000001',
                               p_event uuid DEFAULT 'e1000000-0000-0000-0000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.builder_bu_confirm_request_send(
    p_event, p_units, p_to, p_cc, p_actor, 'https://gst.vjdesai.com/',
    'Please confirm the agreement values · Test Heights | Shree Test Infra',
    E'Our working uses these agreement values (3 units):\n\nUnit A-101: Rs. 45,00,000.00\n\n{{confirm_link}}\n\nAnyone who received this e-mail may answer.',
    '{"project_name": "Test Heights", "confirm_link": "{{confirm_link}}"}'::jsonb);
$$;
-- The page's view of a link: "A-101:PENDING,A-102:CONFIRMED,…".
CREATE FUNCTION public.t_states(p_token text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg((u ->> 'unit_no') || ':' || (u ->> 'state'), ',' ORDER BY ord)
    FROM jsonb_array_elements(public.builder_bu_confirm_lookup(p_token) -> 'units') WITH ORDINALITY t(u, ord);
$$;
-- One answer as the page sends it.
CREATE FUNCTION public.t_answer(p_unit uuid, p_action text, p_notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('unit_id', p_unit, 'action', p_action, 'notes', p_notes) $$;
-- The results of a respond call: "A-101:CONFIRMED,…".
CREATE FUNCTION public.t_results(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg((r ->> 'unit_no') || ':' || (r ->> 'result'), ',' ORDER BY ord)
    FROM jsonb_array_elements(p) WITH ORDINALITY t(r, ord);
$$;
