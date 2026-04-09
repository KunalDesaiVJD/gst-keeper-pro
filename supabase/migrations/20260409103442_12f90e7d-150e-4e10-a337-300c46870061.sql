
CREATE TABLE public.client_scheme_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  old_scheme text NOT NULL,
  new_scheme text NOT NULL,
  effective_from_date date NOT NULL,
  changed_by uuid,
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text
);

ALTER TABLE public.client_scheme_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view scheme history"
ON public.client_scheme_history FOR SELECT
USING (true);

CREATE POLICY "Anyone can manage scheme history"
ON public.client_scheme_history FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_scheme_history_client ON public.client_scheme_history (client_id, effective_from_date DESC);
