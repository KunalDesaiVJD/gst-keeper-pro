-- Reply Factory · Learning is chosen client by client (the firm's request of
-- 9 October 2026: "Learning should be client wise & not notice wise").
--
-- An admin chooses the clients whose responses teach the assistant
-- (clients.ai_learning). Choosing a client chooses every response of it already
-- read, and every response read later is chosen as it arrives; leaving a client
-- out leaves all of them out. A single response or pair can still be left out
-- under its client (the old per-response switch, now the exception).
--
-- Objects: clients.ai_learning (+ _by_name, _at), ai_documents_learning_default()
-- + trigger, view ai_learning_clients, ai_learning_client_set().

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ai_learning         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_learning_by_name text,
  ADD COLUMN IF NOT EXISTS ai_learning_at      timestamptz;
COMMENT ON COLUMN public.clients.ai_learning IS
  'The client''s responses teach the notice assistant (Reply Factory, Learning): every reply of the client, past and future, is chosen.';

-- A response registered for a chosen client is chosen as it arrives.
CREATE OR REPLACE FUNCTION public.ai_documents_learning_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'reply' AND NOT coalesce(NEW.learning_included, false)
     AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.ai_learning) THEN
    NEW.learning_included := true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_documents_learning_default ON public.ai_documents;
CREATE TRIGGER trg_ai_documents_learning_default
  BEFORE INSERT ON public.ai_documents
  FOR EACH ROW EXECUTE FUNCTION public.ai_documents_learning_default();

-- One row per client with at least one response read or waiting to be read.
CREATE OR REPLACE VIEW public.ai_learning_clients AS
SELECT c.id AS client_id, c.name AS client_name, c.gstin AS client_gstin,
       c.ai_learning, c.ai_learning_by_name, c.ai_learning_at,
       count(r.id)::int AS responses,
       (count(r.id) FILTER (WHERE r.learning_included))::int AS responses_included,
       (count(r.id) FILTER (WHERE r.phase = 'past'))::int AS past,
       (count(r.id) FILTER (WHERE r.phase = 'ongoing'))::int AS ongoing,
       (count(r.id) FILTER (WHERE r.status = 'done'))::int AS read,
       coalesce(sum(r.pairs), 0)::int AS pairs,
       coalesce(sum(r.pairs_included), 0)::int AS pairs_included,
       max(r.response_date) AS last_response_date,
       array_remove(array_agg(DISTINCT r.form_code), NULL) AS forms,
       array_remove(array_agg(DISTINCT nullif(r.financial_year, '')), NULL) AS financial_years
  FROM public.clients c
  JOIN public.ai_learning_responses r ON r.client_id = c.id
 GROUP BY c.id, c.name, c.gstin, c.ai_learning, c.ai_learning_by_name, c.ai_learning_at;
COMMENT ON VIEW public.ai_learning_clients IS
  'Learning, client by client: each client''s responses (past and ongoing), how many are read, their paragraph pairs, and whether the client teaches the assistant.';
GRANT SELECT ON public.ai_learning_clients TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_learning_client_set(p_client_ids uuid[], p_include boolean, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients int;
  v_pairs   int;
BEGIN
  UPDATE public.clients SET ai_learning = p_include, ai_learning_by_name = left(p_actor, 120), ai_learning_at = now()
   WHERE id = ANY (p_client_ids);
  GET DIAGNOSTICS v_clients = ROW_COUNT;
  v_pairs := public.ai_learning_select_where(p_client_ids, 'all', p_include, p_actor);
  RETURN jsonb_build_object('clients', v_clients, 'pairs', v_pairs);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_learning_client_set(uuid[], boolean, text) TO anon, authenticated, service_role;

-- Clients whose every response was already chosen count as chosen.
UPDATE public.clients c SET ai_learning = true, ai_learning_at = now(), ai_learning_by_name = 'from the responses chosen before'
 WHERE NOT c.ai_learning
   AND EXISTS (SELECT 1 FROM public.ai_learning_responses r WHERE r.client_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.ai_learning_responses r WHERE r.client_id = c.id AND NOT r.learning_included);
