-- Notices Phase 4 · Reply options: several replies prepared for every notice by itself
-- (asked by the firm on 2026-10-06; docs/REPLY_FACTORY_POSITIONS.md §12, templates in
-- 20261008161000_reply_templates_seed.sql and docs/REPLY_TEMPLATES.md).
--
-- When a notice is fetched, or its facts, issues or annexures change, the database
-- renders one reply per active template for the notice's form (the general templates
-- when the form has none of its own) with the notice's facts, and keeps them on
-- notice_reply_options. A person picks one: notice_reply_option_use() renders it again
-- with today's facts and starts the next draft version from it; nothing is filed or sent.
--
-- Wording rule (the firm's): formal legal English with no hyphen or dash of any kind.
-- Templates, issue paragraphs and every rendered reply are checked by constraint
-- (reply_has_dash); every fact put into a template is cleaned first (reply_dehyphen:
-- 2023-24 → 2023/24, DRC-01 → DRC 01, any other dash → a space). Amounts are written
-- "Rs. 1,23,456 (Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six only)",
-- dates "6 October 2026", forms "FORM GST DRC 01".
--
-- Objects: reply_has_dash, reply_dehyphen, reply_inr, reply_inr_words, reply_date_long,
-- reply_form_name, reply_state_act, reply_templates, reply_issue_types.para_contest /
-- para_accept, notice_settings.reply_place / reply_signatory, notice_reply_options,
-- notice_drafts.source_option_id / source_template_key, notice_reply_context,
-- reply_render, notice_reply_options_refresh, notice_reply_option_use, and the triggers
-- on gst_notices, notice_issues, reply_annexures, reply_templates, reply_issue_types and
-- notice_type_settings that keep the options current.

-- ── Text helpers ───────────────────────────────────────────────────────────
-- Hyphen, soft hyphen, the Unicode dashes U+2010 to U+2015, minus, small and fullwidth hyphen.
CREATE OR REPLACE FUNCTION public.reply_has_dash(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(p ~ '[-­‐-―−﹘﹣－]', false)
$$;
COMMENT ON FUNCTION public.reply_has_dash(text) IS 'True when the text holds any hyphen or dash character (the reply wording rule).';

-- A fact going into a reply: "Rs. 500/-" loses its "/-", a dash between digits becomes
-- "/" (2023-24 → 2023/24, 01-04-2023 → 01/04/2023), any other dash a space; line breaks stay.
CREATE OR REPLACE FUNCTION public.reply_dehyphen(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(replace(p, U&'\00AD', ''),
            '/[ \t]*[-‐-―−﹘﹣－]+(?![0-9])', '', 'g'),
          '([0-9])[ \t]*[-‐-―−﹘﹣－][ \t]*(?=[0-9])', '\1/', 'g'),
        '[ \t]*[-‐-―−﹘﹣－]+[ \t]*', ' ', 'g'),
      '[ \t]{2,}', ' ', 'g'), E' \t')
  END
$$;

-- Indian digit grouping: Rs. 1,23,45,678 (paise only when there are any).
CREATE OR REPLACE FUNCTION public.reply_inr(p numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v      numeric;
  v_int  text;
  v_out  text;
  v_rest text;
  v_p    int;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  v := round(abs(p), 2);
  v_int := trunc(v)::text;
  v_p := ((v - trunc(v)) * 100)::int;
  IF length(v_int) <= 3 THEN
    v_out := v_int;
  ELSE
    v_out := right(v_int, 3);
    v_rest := left(v_int, length(v_int) - 3);
    WHILE length(v_rest) > 2 LOOP
      v_out := right(v_rest, 2) || ',' || v_out;
      v_rest := left(v_rest, length(v_rest) - 2);
    END LOOP;
    v_out := v_rest || ',' || v_out;
  END IF;
  IF v_p > 0 THEN v_out := v_out || '.' || lpad(v_p::text, 2, '0'); END IF;
  RETURN 'Rs. ' || CASE WHEN p < 0 THEN 'minus ' ELSE '' END || v_out;
END;
$$;

-- Words for 0 to 999.
CREATE OR REPLACE FUNCTION public.reply_words_999(n int)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH w AS (
    SELECT ARRAY['One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen',
                 'Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'] AS ones,
           ARRAY['','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'] AS tens
  ), parts AS (
    SELECT n / 100 AS h, n % 100 AS r, w.ones, w.tens FROM w
  )
  SELECT btrim(
           CASE WHEN h > 0 THEN ones[h] || ' Hundred' ELSE '' END
           || CASE WHEN r = 0 THEN ''
                   WHEN r < 20 THEN ' ' || ones[r]
                   ELSE ' ' || tens[r / 10] || CASE WHEN r % 10 > 0 THEN ' ' || ones[r % 10] ELSE '' END END)
    FROM parts
$$;

-- Indian system words: "One Crore Twenty Lakh Five Thousand Six Hundred Seven".
CREATE OR REPLACE FUNCTION public.reply_num_words(p bigint)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_crore bigint := p / 10000000;
  v_lakh  int := ((p / 100000) % 100)::int;
  v_thou  int := ((p / 1000) % 100)::int;
  v_rest  int := (p % 1000)::int;
  v_out   text := '';
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF p = 0 THEN RETURN 'Zero'; END IF;
  IF v_crore > 0 THEN v_out := public.reply_num_words(v_crore) || ' Crore'; END IF;
  IF v_lakh > 0 THEN v_out := v_out || ' ' || public.reply_words_999(v_lakh) || ' Lakh'; END IF;
  IF v_thou > 0 THEN v_out := v_out || ' ' || public.reply_words_999(v_thou) || ' Thousand'; END IF;
  IF v_rest > 0 THEN v_out := v_out || ' ' || public.reply_words_999(v_rest); END IF;
  RETURN btrim(v_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.reply_inr_words(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    'Rupees ' || public.reply_num_words(trunc(abs(round(p, 2)))::bigint)
    || CASE WHEN ((abs(round(p, 2)) - trunc(abs(round(p, 2)))) * 100)::int > 0
            THEN ' and ' || public.reply_words_999(((abs(round(p, 2)) - trunc(abs(round(p, 2)))) * 100)::int) || ' Paise'
            ELSE '' END
    || ' only' END
$$;

CREATE OR REPLACE FUNCTION public.reply_amount_text(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE public.reply_inr(p) || ' (' || public.reply_inr_words(p) || ')' END
$$;

-- 6 October 2026
CREATE OR REPLACE FUNCTION public.reply_date_long(p date)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE to_char(p, 'FMDD FMMonth YYYY') END
$$;

-- FORM GST DRC 01 / FORM GSTR 3A; names that are not forms (APL-HEARING, SUMMONS) → NULL.
CREATE OR REPLACE FUNCTION public.reply_form_name(p_form_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_form_code ~ '^GSTR-[0-9]+[A-Z]?$' THEN 'FORM ' || replace(p_form_code, '-', ' ')
              WHEN p_form_code ~ '^[A-Z]{2,4}-[0-9]{2}[A-Z]?$' THEN 'FORM GST ' || replace(p_form_code, '-', ' ')
         END
$$;

-- The State or Union Territory GST Act from the GSTIN's state code.
CREATE OR REPLACE FUNCTION public.reply_state_act(p_gstin text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN left(p_gstin, 2) IN ('04', '25', '26', '31', '35', '38', '97') THEN 'the Union Territory Goods and Services Tax Act, 2017'
    WHEN s.name IS NOT NULL THEN 'the ' || s.name || ' Goods and Services Tax Act, 2017'
    ELSE 'the State Goods and Services Tax Act, 2017' END
    FROM (SELECT (jsonb_build_object(
      '01', 'Jammu and Kashmir', '02', 'Himachal Pradesh', '03', 'Punjab', '05', 'Uttarakhand', '06', 'Haryana',
      '07', 'Delhi', '08', 'Rajasthan', '09', 'Uttar Pradesh', '10', 'Bihar', '11', 'Sikkim', '12', 'Arunachal Pradesh',
      '13', 'Nagaland', '14', 'Manipur', '15', 'Mizoram', '16', 'Tripura', '17', 'Meghalaya', '18', 'Assam',
      '19', 'West Bengal', '20', 'Jharkhand', '21', 'Odisha', '22', 'Chhattisgarh', '23', 'Madhya Pradesh',
      '24', 'Gujarat', '27', 'Maharashtra', '28', 'Andhra Pradesh', '29', 'Karnataka', '30', 'Goa', '32', 'Kerala',
      '33', 'Tamil Nadu', '34', 'Puducherry', '36', 'Telangana', '37', 'Andhra Pradesh') ->> left(coalesce(p_gstin, ''), 2)) AS name) s
$$;

-- ── Templates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reply_templates (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  title           text NOT NULL CHECK (btrim(title) <> '' AND NOT public.reply_has_dash(title)),
  summary         text NOT NULL DEFAULT '' CHECK (NOT public.reply_has_dash(summary)),
  stance          text NOT NULL CHECK (stance IN ('contest', 'partial', 'accept_pay', 'explain', 'complied', 'adjournment',
                                                  'documents', 'rectify', 'appeal_stay', 'consent', 'general')),
  forms           text[] NOT NULL DEFAULT '{}',
  sort            int  NOT NULL DEFAULT 100,
  body            text NOT NULL CHECK (btrim(body) <> '' AND NOT public.reply_has_dash(body)),
  is_active       boolean NOT NULL DEFAULT true,
  version         int  NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_name text
);
COMMENT ON TABLE public.reply_templates IS
  'Reply templates in formal legal wording without any hyphen or dash. forms = the notice form codes a template is for; an empty list is a general template, used when the notice''s form has none of its own. {{placeholders}} are filled by notice_reply_context().';
CREATE INDEX IF NOT EXISTS idx_reply_templates_forms ON public.reply_templates USING gin (forms);

ALTER TABLE public.reply_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reply_templates_public" ON public.reply_templates;
CREATE POLICY "reply_templates_public" ON public.reply_templates FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reply_templates TO anon, authenticated, service_role;

-- An edited template is a new version; its options are prepared again.
CREATE OR REPLACE FUNCTION public.reply_templates_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.body, NEW.title, NEW.summary, NEW.stance, NEW.forms)
     IS DISTINCT FROM (OLD.body, OLD.title, OLD.summary, OLD.stance, OLD.forms) THEN
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reply_templates_version ON public.reply_templates;
CREATE TRIGGER trg_reply_templates_version BEFORE UPDATE ON public.reply_templates
  FOR EACH ROW EXECUTE FUNCTION public.reply_templates_version();

-- The paragraph a reply uses for an issue code, contesting it or accepting it.
ALTER TABLE public.reply_issue_types
  ADD COLUMN IF NOT EXISTS para_contest text,
  ADD COLUMN IF NOT EXISTS para_accept  text;
ALTER TABLE public.reply_issue_types DROP CONSTRAINT IF EXISTS reply_issue_types_paras_no_dash;
ALTER TABLE public.reply_issue_types ADD CONSTRAINT reply_issue_types_paras_no_dash
  CHECK (NOT public.reply_has_dash(para_contest) AND NOT public.reply_has_dash(para_accept));

-- The signature block of every reply.
ALTER TABLE public.notice_settings
  ADD COLUMN IF NOT EXISTS reply_place     text,
  ADD COLUMN IF NOT EXISTS reply_signatory text;
ALTER TABLE public.notice_settings DROP CONSTRAINT IF EXISTS notice_settings_reply_no_dash;
ALTER TABLE public.notice_settings ADD CONSTRAINT notice_settings_reply_no_dash
  CHECK (NOT public.reply_has_dash(reply_place) AND NOT public.reply_has_dash(reply_signatory));

-- ── The options prepared for each notice ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_reply_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id        uuid NOT NULL REFERENCES public.gst_notices (id) ON DELETE CASCADE,
  template_key     text NOT NULL REFERENCES public.reply_templates (key) ON UPDATE CASCADE ON DELETE CASCADE,
  template_version int  NOT NULL,
  title            text NOT NULL,
  summary          text NOT NULL DEFAULT '',
  stance           text NOT NULL,
  sort             int  NOT NULL DEFAULT 100,
  body             text NOT NULL CHECK (NOT public.reply_has_dash(body)),
  inputs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs_hash      text NOT NULL,
  status           text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'used')),
  used_draft_id    uuid,
  used_at          timestamptz,
  used_by_name     text,
  rendered_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, template_key)
);
COMMENT ON TABLE public.notice_reply_options IS
  'Replies prepared for a notice, one per applicable template, rendered from its facts, issues and annexures (inputs). Kept current by triggers; status used once a draft was started from it (the draft keeps its own text).';
CREATE INDEX IF NOT EXISTS idx_notice_reply_options_notice ON public.notice_reply_options (notice_id, sort);

ALTER TABLE public.notice_reply_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notice_reply_options_public" ON public.notice_reply_options;
CREATE POLICY "notice_reply_options_public" ON public.notice_reply_options FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_reply_options TO anon, authenticated, service_role;

ALTER TABLE public.notice_drafts
  ADD COLUMN IF NOT EXISTS source_option_id    uuid,
  ADD COLUMN IF NOT EXISTS source_template_key text;
ALTER TABLE public.notice_drafts DROP CONSTRAINT IF EXISTS notice_drafts_source_option_id_fkey;
ALTER TABLE public.notice_drafts ADD CONSTRAINT notice_drafts_source_option_id_fkey
  FOREIGN KEY (source_option_id) REFERENCES public.notice_reply_options (id) ON DELETE SET NULL;
ALTER TABLE public.notice_reply_options DROP CONSTRAINT IF EXISTS notice_reply_options_used_draft_id_fkey;
ALTER TABLE public.notice_reply_options ADD CONSTRAINT notice_reply_options_used_draft_id_fkey
  FOREIGN KEY (used_draft_id) REFERENCES public.notice_drafts (id) ON DELETE SET NULL;

-- ── The facts a template is filled with ────────────────────────────────────
-- Every value is a finished phrase without a dash; a fact the app does not hold
-- becomes a graceful phrase or a [fill in] the person completes, never a gap.
CREATE OR REPLACE FUNCTION public.notice_reply_context(p_notice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g        public.gst_notices;
  c        public.clients;
  v_rule   public.notice_form_rules;
  v_set    public.notice_settings;
  v_due    date;
  v_total  numeric;
  v_sec    text;
  v_short  text;
  v_fy     text;
  v_period text;
  v_heads  text;
  v_parts  text[];
  v_list   text;
  v_contest text;
  v_accept text;
  v_annex  text;
  v_officer text;
  v_label  text;
  v_form   text;
  r        record;
  i        int := 0;
BEGIN
  SELECT * INTO g FROM public.gst_notices WHERE id = p_notice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.clients WHERE id = g.client_id;
  SELECT * INTO v_rule FROM public.notice_form_rules WHERE form_code = g.form_code;
  SELECT * INTO v_set FROM public.notice_settings LIMIT 1;

  v_due := coalesce(g.extended_due_date, g.due_date, public.notice_computed_due(g.issue_date, g.case_id, g.form_code));
  v_total := coalesce(nullif(g.demand_total, 0), nullif(g.amount_of_demand, 0));

  -- The provision: the section read from the notice, else the form's own.
  v_sec := nullif(btrim(coalesce(g.section_of_law, '')), '');
  IF v_sec IS NOT NULL THEN
    v_short := 'section ' || public.reply_dehyphen(v_sec);
    v_sec := v_short || ' of the Central Goods and Services Tax Act, 2017 read with the corresponding provision of '
             || public.reply_state_act(c.gstin);
  ELSIF g.form_code IN ('DRC-01B', 'DRC-01C') THEN
    v_short := CASE g.form_code WHEN 'DRC-01B' THEN 'rule 88C' ELSE 'rule 88D' END;
    v_sec := v_short || ' of the Central Goods and Services Tax Rules, 2017';
  ELSE
    v_short := CASE g.form_code
      WHEN 'ASMT-10' THEN 'section 61' WHEN 'ASMT-14' THEN 'section 63' WHEN 'GSTR-3A' THEN 'section 46'
      WHEN 'REG-17' THEN 'section 29' WHEN 'REG-SCN' THEN 'section 29' WHEN 'MOV-07' THEN 'section 129'
      WHEN 'MOV-09' THEN 'section 129' WHEN 'ADT-01' THEN 'section 65' WHEN 'ADT-02' THEN 'section 65'
      WHEN 'DRC-22' THEN 'section 83' WHEN 'DRC-13' THEN 'section 79' WHEN 'SUMMONS' THEN 'section 70'
      WHEN 'RFD-08' THEN 'section 54' WHEN 'RFD-03' THEN 'section 54' WHEN 'RFD-06' THEN 'section 54' END;
    v_sec := CASE WHEN v_short IS NOT NULL
                  THEN v_short || ' of the Central Goods and Services Tax Act, 2017 read with the corresponding provision of '
                       || public.reply_state_act(c.gstin)
                  ELSE 'the relevant provisions of the Central Goods and Services Tax Act, 2017 and '
                       || public.reply_state_act(c.gstin) END;
  END IF;

  -- The period and the financial year.
  v_fy := nullif(btrim(coalesce(g.financial_year, '')), '');
  -- A period inside one financial year (April to March) names it.
  IF v_fy IS NULL AND g.period_from IS NOT NULL AND g.period_to IS NOT NULL
     AND extract(year FROM (g.period_from - interval '3 months')) = extract(year FROM (g.period_to - interval '3 months')) THEN
    v_fy := extract(year FROM (g.period_from - interval '3 months'))::int || '/'
            || right((extract(year FROM (g.period_from - interval '3 months'))::int + 1)::text, 2);
  END IF;
  v_fy := public.reply_dehyphen(v_fy);
  v_period := CASE
    WHEN g.period_from IS NOT NULL AND g.period_to IS NOT NULL
      THEN 'the period from ' || public.reply_date_long(g.period_from) || ' to ' || public.reply_date_long(g.period_to)
    WHEN v_fy IS NOT NULL THEN 'the financial year ' || v_fy
    ELSE 'the period covered by the notice' END;

  -- Demand by component, summed over the heads: "tax of Rs. X, interest of Rs. Y and penalty of Rs. Z".
  SELECT array_agg(x.part ORDER BY x.ord) INTO v_parts
    FROM (
      SELECT k.ord, k.label || ' of ' || public.reply_inr(sum((h.value ->> k.key)::numeric)) AS part
        FROM jsonb_each(CASE WHEN jsonb_typeof(g.demand) = 'object' THEN g.demand ELSE '{}'::jsonb END) h
        CROSS JOIN (VALUES (1, 'tax', 'tax'), (2, 'interest', 'interest'), (3, 'penalty', 'penalty'),
                           (4, 'fee', 'late fee'), (5, 'others', 'other amounts')) AS k(ord, key, label)
       WHERE jsonb_typeof(h.value) = 'object' AND coalesce((h.value ->> k.key)::numeric, 0) <> 0
       GROUP BY k.ord, k.label, k.key
      HAVING sum((h.value ->> k.key)::numeric) <> 0
    ) x;
  v_heads := CASE WHEN coalesce(cardinality(v_parts), 0) = 0 THEN NULL
                  WHEN cardinality(v_parts) = 1 THEN v_parts[1]
                  ELSE array_to_string(v_parts[1:cardinality(v_parts) - 1], ', ') || ' and ' || v_parts[cardinality(v_parts)] END;

  -- Issues: a numbered list and the paragraphs for contesting or accepting each.
  v_list := ''; v_contest := ''; v_accept := '';
  FOR r IN
    SELECT i2.seq, i2.title, i2.amount, t.para_contest, t.para_accept
      FROM public.notice_issues i2
      LEFT JOIN public.reply_issue_types t ON t.code = i2.issue_code
     WHERE i2.notice_id = p_notice_id
     ORDER BY i2.seq, i2.created_at
  LOOP
    i := i + 1;
    -- (a), (b), (c) so the list never clashes with the reply's numbered paragraphs
    v_list := v_list || CASE WHEN i > 1 THEN E';\n' ELSE '' END
              || '(' || CASE WHEN i <= 26 THEN chr(96 + i) ELSE i::text END || ') ' || public.reply_dehyphen(btrim(r.title))
              || CASE WHEN coalesce(r.amount, 0) > 0 THEN ' amounting to ' || public.reply_inr(r.amount) ELSE '' END;
    v_contest := v_contest || CASE WHEN i > 1 THEN E'\n\n' ELSE '' END
              || 'Issue (' || CASE WHEN i <= 26 THEN chr(96 + i) ELSE i::text END || '): ' || public.reply_dehyphen(btrim(r.title))
              || CASE WHEN coalesce(r.amount, 0) > 0 THEN ' (' || public.reply_inr(r.amount) || ')' ELSE '' END || E'\n'
              || coalesce(r.para_contest,
                   'The noticee respectfully submits that the proposal on this issue is not sustainable on facts and in law. '
                   || '[Set out the facts, the reconciliation and the legal submissions on this issue.]');
    v_accept := v_accept || CASE WHEN i > 1 THEN E'\n\n' ELSE '' END
              || 'Issue (' || CASE WHEN i <= 26 THEN chr(96 + i) ELSE i::text END || '): ' || public.reply_dehyphen(btrim(r.title))
              || CASE WHEN coalesce(r.amount, 0) > 0 THEN ' (' || public.reply_inr(r.amount) || ')' ELSE '' END || E'\n'
              || coalesce(r.para_accept,
                   'The noticee accepts the liability on this issue and has discharged the same together with applicable '
                   || 'interest under section 50, as set out in this reply.');
  END LOOP;
  IF i > 0 THEN v_list := v_list || '.'; END IF;
  IF i = 0 THEN
    v_list := '(a) The matters set out in the notice.';
    v_contest := 'The noticee respectfully submits that the matters raised in the notice are not sustainable on facts and '
              || 'in law. [Set out the facts, the reconciliation and the legal submissions on each matter raised in the notice.]';
    v_accept := 'The noticee has examined the matters set out in the notice and accepts the liability proposed therein. '
              || '[Describe the liability accepted and how it has been computed.]';
  END IF;

  -- Annexures prepared for the notice (the evidence recipes).
  SELECT string_agg('Annexure ' || n || ': ' || public.reply_dehyphen(t), E'\n' ORDER BY n) INTO v_annex
    FROM (
      SELECT row_number() OVER (ORDER BY a.generated_at, a.recipe_key) AS n,
             regexp_replace(coalesce(nullif(btrim(a.title), ''), initcap(replace(a.recipe_key, '_', ' '))), '\s*·\s*', ', ', 'g')
             || CASE WHEN a.financial_year IS NOT NULL AND coalesce(a.title, '') !~ '20[0-9]{2}'
                     THEN ' for the financial year ' || a.financial_year ELSE '' END AS t
        FROM public.reply_annexures a
       WHERE a.notice_id = p_notice_id AND a.is_current AND a.status IN ('ready', 'partial')
    ) x;

  v_officer := nullif(btrim(regexp_replace(coalesce(g.issued_by, ''), '^\s*the\s+', '', 'i')), '');
  v_label := nullif(btrim(regexp_replace(coalesce(v_rule.label, ''), '\s*\([^)]*\)\s*$', '')), '');
  v_form := public.reply_form_name(g.form_code);

  RETURN jsonb_build_object(
    'today_long', public.reply_date_long(public.ist_today()),
    'client_name', coalesce(nullif(btrim(c.name), ''), '[name of the taxpayer]'),
    'gstin', coalesce(nullif(btrim(c.gstin), ''), '[GSTIN]'),
    'sgst_act', public.reply_state_act(c.gstin),
    'form_code_text', coalesce(replace(g.form_code, '-', ' '), ''),
    'form_name', coalesce(v_form, 'the notice'),
    'form_title', coalesce(lower(left(v_label, 1)) || substr(v_label, 2), 'notice'),
    'notice_ref', coalesce(nullif(btrim(g.reference_number), ''), nullif(btrim(g.case_id), ''), '[reference number]'),
    'notice_date_long', coalesce(public.reply_date_long(g.issue_date), '[date of the notice]'),
    'din_clause', CASE WHEN nullif(btrim(g.din), '') IS NOT NULL
                       THEN ', bearing Document Identification Number ' || btrim(g.din) || ',' ELSE '' END,
    'officer', coalesce(v_officer, CASE WHEN g.form_code IN ('APL-HEARING', 'APL-02', 'APL-04') THEN 'Appellate Authority'
                                        ELSE 'Proper Officer' END),
    'section_text', v_sec,
    'section_short', coalesce(v_short, 'the relevant section'),
    'period_text', v_period,
    'fy_text', CASE WHEN v_fy IS NOT NULL THEN 'the financial year ' || v_fy ELSE 'the relevant financial year' END,
    'demand_total_text', coalesce(public.reply_amount_text(v_total), 'the amount proposed in the notice'),
    'demand_total_figure', coalesce(public.reply_inr(v_total), '[amount]'),
    'demand_heads_text', coalesce(v_heads, 'the amounts set out therein'),
    'reply_due_long', coalesce(public.reply_date_long(v_due), 'the date specified in the notice'),
    'hearing_clause', CASE WHEN g.hearing_date IS NOT NULL
                           THEN 'The personal hearing in the matter is fixed on ' || public.reply_date_long(g.hearing_date) || '.'
                           ELSE '' END,
    'hearing_date_long', coalesce(public.reply_date_long(g.hearing_date), '[date of hearing]'),
    'issues_list', v_list,
    'issues_contest_paras', v_contest,
    'issues_accept_paras', v_accept,
    'annexure_list', coalesce(v_annex, '[List of documents enclosed]'),
    'payment_clause', 'through FORM GST DRC 03 vide ARN [ARN of FORM GST DRC 03] dated [date of payment]',
    'place', coalesce(nullif(btrim(v_set.reply_place), ''), '[place]'),
    'signatory', coalesce(nullif(btrim(v_set.reply_signatory), ''), 'Authorised Signatory'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_reply_context(uuid) TO anon, authenticated, service_role;

-- Fills {{placeholders}}; an unknown one becomes a visible [fill in]. Tidies spacing.
CREATE OR REPLACE FUNCTION public.reply_render(p_body text, p_ctx jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v   text := coalesce(p_body, '');
  k   text;
  val text;
BEGIN
  FOR k, val IN SELECT key, value FROM jsonb_each_text(coalesce(p_ctx, '{}'::jsonb)) LOOP
    v := replace(v, '{{' || k || '}}', coalesce(public.reply_dehyphen(val), ''));
  END LOOP;
  v := regexp_replace(v, '\{\{\s*([a-z0-9_]+)\s*\}\}', '[\1]', 'g');
  v := regexp_replace(v, '[ \t]+([,.;:])', '\1', 'g');
  v := regexp_replace(v, '([^\n])[ \t]{2,}', '\1 ', 'g');
  v := regexp_replace(v, '[ \t]+\n', E'\n', 'g');
  v := regexp_replace(v, '\n{3,}', E'\n\n', 'g');
  v := btrim(v, E' \n\t');
  IF public.reply_has_dash(v) THEN v := public.reply_dehyphen(v); END IF;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reply_render(text, jsonb) TO anon, authenticated, service_role;

-- ── Prepare (or bring up to date) the options of one notice ────────────────
-- Templates for the notice's form, else the general ones. Nothing for a notice type
-- that needs no reply, or for a closed notice (unless forced). An option whose inputs,
-- template and version are unchanged is left alone; a used option is updated too (its
-- draft keeps the text it was started with). Returns how many options were written.
CREATE OR REPLACE FUNCTION public.notice_reply_options_refresh(p_notice_id uuid, p_force boolean DEFAULT false)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g       public.gst_notices;
  v_need  text;
  v_ctx   jsonb;
  v_key   jsonb;
  v_t     public.reply_templates;
  v_hash  text;
  v_old   text;
  v_keys  text[] := '{}';
  v_n     int := 0;
  v_own   boolean;
BEGIN
  SELECT * INTO g FROM public.gst_notices WHERE id = p_notice_id;
  IF NOT FOUND OR g.deleted_at IS NOT NULL OR g.source IS DISTINCT FROM 'notices' THEN RETURN 0; END IF;
  SELECT coalesce((SELECT s.response_need FROM public.notice_type_settings s WHERE s.form_code = g.form_code), 'critical')
    INTO v_need;
  IF v_need = 'none' THEN
    DELETE FROM public.notice_reply_options WHERE notice_id = p_notice_id AND status = 'ready';
    RETURN 0;
  END IF;
  IF public.notice_is_closed(g.staff_status) AND NOT coalesce(p_force, false) THEN RETURN 0; END IF;

  v_ctx := public.notice_reply_context(p_notice_id);
  v_key := v_ctx - 'today_long';
  v_own := EXISTS (SELECT 1 FROM public.reply_templates t WHERE t.is_active AND g.form_code = ANY (t.forms));

  FOR v_t IN
    SELECT t.* FROM public.reply_templates t
     WHERE t.is_active
       AND ((v_own AND g.form_code = ANY (t.forms)) OR (NOT v_own AND cardinality(t.forms) = 0))
     ORDER BY t.sort, t.key
  LOOP
    v_keys := v_keys || v_t.key;
    v_hash := md5(v_t.key || '|' || v_t.version || '|' || v_key::text);
    SELECT o.inputs_hash INTO v_old FROM public.notice_reply_options o
     WHERE o.notice_id = p_notice_id AND o.template_key = v_t.key;
    IF FOUND AND v_old = v_hash AND NOT coalesce(p_force, false) THEN CONTINUE; END IF;
    INSERT INTO public.notice_reply_options AS o
           (notice_id, template_key, template_version, title, summary, stance, sort, body, inputs, inputs_hash, rendered_at)
    VALUES (p_notice_id, v_t.key, v_t.version, v_t.title, v_t.summary, v_t.stance, v_t.sort,
            public.reply_render(v_t.body, v_ctx), v_ctx, v_hash, now())
    ON CONFLICT (notice_id, template_key) DO UPDATE
       SET template_version = EXCLUDED.template_version, title = EXCLUDED.title, summary = EXCLUDED.summary,
           stance = EXCLUDED.stance, sort = EXCLUDED.sort, body = EXCLUDED.body, inputs = EXCLUDED.inputs,
           inputs_hash = EXCLUDED.inputs_hash, rendered_at = now();
    v_n := v_n + 1;
  END LOOP;

  DELETE FROM public.notice_reply_options o
   WHERE o.notice_id = p_notice_id AND o.status = 'ready' AND NOT (o.template_key = ANY (v_keys));
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_reply_options_refresh(uuid, boolean) TO anon, authenticated, service_role;

-- Every open notice (after a template, issue paragraph or type setting changed).
CREATE OR REPLACE FUNCTION public.notice_reply_options_refresh_open(p_form_codes text[] DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r   record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT g.id FROM public.gst_notices g
     WHERE g.deleted_at IS NULL AND g.source = 'notices' AND NOT public.notice_is_closed(g.staff_status)
       AND (p_form_codes IS NULL OR g.form_code = ANY (p_form_codes))
  LOOP
    BEGIN
      v_n := v_n + public.notice_reply_options_refresh(r.id, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reply options for notice % not prepared: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notice_reply_options_refresh_open(text[]) FROM PUBLIC, anon, authenticated;

-- ── Use an option: the next draft version, rendered with today's facts ─────
CREATE OR REPLACE FUNCTION public.notice_reply_option_use(p_option_id uuid, p_author_id uuid DEFAULT NULL,
                                                          p_author_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o       public.notice_reply_options;
  v_t     public.reply_templates;
  v_ctx   jsonb;
  v_body  text;
  v_ver   int;
  v_draft uuid;
BEGIN
  SELECT * INTO o FROM public.notice_reply_options WHERE id = p_option_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notice_reply_option_use: no such reply option' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.gst_notices WHERE id = o.notice_id FOR UPDATE;
  SELECT * INTO v_t FROM public.reply_templates WHERE key = o.template_key;
  v_ctx := public.notice_reply_context(o.notice_id);
  v_body := CASE WHEN v_t.key IS NOT NULL THEN public.reply_render(v_t.body, v_ctx) ELSE o.body END;

  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM public.notice_drafts WHERE notice_id = o.notice_id;
  INSERT INTO public.notice_drafts (notice_id, version, body, status, author_id, author_name, source_option_id, source_template_key)
  VALUES (o.notice_id, v_ver, v_body, 'draft', p_author_id, p_author_name, o.id, o.template_key)
  RETURNING id INTO v_draft;

  UPDATE public.notice_reply_options
     SET status = 'used', used_draft_id = v_draft, used_at = now(), used_by_name = p_author_name,
         body = v_body, inputs = v_ctx, template_version = coalesce(v_t.version, template_version),
         inputs_hash = md5(o.template_key || '|' || coalesce(v_t.version, o.template_version) || '|' || (v_ctx - 'today_long')::text),
         rendered_at = now()
   WHERE id = o.id;

  PERFORM public.notice_log_event(o.notice_id, 'reply_option_used', NULL,
    jsonb_build_object('template_key', o.template_key, 'title', o.title, 'version', v_ver), p_author_id, p_author_name);
  RETURN jsonb_build_object('draft_id', v_draft, 'version', v_ver, 'notice_id', o.notice_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_reply_option_use(uuid, uuid, text) TO anon, authenticated, service_role;

-- ── Keep the options current ───────────────────────────────────────────────
-- A notice fetched, or a fact a reply uses changed.
CREATE OR REPLACE FUNCTION public.gst_notices_reply_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.source IS DISTINCT FROM 'notices' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND
     (NEW.form_code, NEW.section_of_law, NEW.period_from, NEW.period_to, NEW.financial_year, NEW.din, NEW.demand,
      NEW.demand_total, NEW.amount_of_demand, NEW.due_date, NEW.extended_due_date, NEW.hearing_date, NEW.issue_date,
      NEW.reference_number, NEW.case_id, NEW.issued_by, NEW.client_id, public.notice_is_closed(NEW.staff_status))
     IS NOT DISTINCT FROM
     (OLD.form_code, OLD.section_of_law, OLD.period_from, OLD.period_to, OLD.financial_year, OLD.din, OLD.demand,
      OLD.demand_total, OLD.amount_of_demand, OLD.due_date, OLD.extended_due_date, OLD.hearing_date, OLD.issue_date,
      OLD.reference_number, OLD.case_id, OLD.issued_by, OLD.client_id, public.notice_is_closed(OLD.staff_status)) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.notice_reply_options_refresh(NEW.id, false);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reply options for notice % not prepared: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_gst_notices_reply_options ON public.gst_notices;
CREATE TRIGGER trg_gst_notices_reply_options AFTER INSERT OR UPDATE ON public.gst_notices
  FOR EACH ROW EXECUTE FUNCTION public.gst_notices_reply_options();

-- An issue or an annexure of the notice added, changed or removed.
CREATE OR REPLACE FUNCTION public.notice_child_reply_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.notice_reply_options_refresh(CASE WHEN TG_OP = 'DELETE' THEN OLD.notice_id ELSE NEW.notice_id END, false);
    IF TG_OP = 'UPDATE' AND NEW.notice_id IS DISTINCT FROM OLD.notice_id THEN
      PERFORM public.notice_reply_options_refresh(OLD.notice_id, false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reply options not prepared after a % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_issues_reply_options ON public.notice_issues;
CREATE TRIGGER trg_notice_issues_reply_options AFTER INSERT OR UPDATE OR DELETE ON public.notice_issues
  FOR EACH ROW EXECUTE FUNCTION public.notice_child_reply_options();
DROP TRIGGER IF EXISTS trg_reply_annexures_reply_options ON public.reply_annexures;
CREATE TRIGGER trg_reply_annexures_reply_options AFTER INSERT OR UPDATE OR DELETE ON public.reply_annexures
  FOR EACH ROW EXECUTE FUNCTION public.notice_child_reply_options();

-- Templates, issue paragraphs or a type's reply need changed: every open notice they touch.
CREATE OR REPLACE FUNCTION public.reply_templates_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notice_reply_options_refresh_open(NULL);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_reply_templates_changed ON public.reply_templates;
CREATE TRIGGER trg_reply_templates_changed AFTER INSERT OR UPDATE OR DELETE ON public.reply_templates
  FOR EACH STATEMENT EXECUTE FUNCTION public.reply_templates_changed();

CREATE OR REPLACE FUNCTION public.reply_issue_paras_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF (NEW.para_contest, NEW.para_accept) IS NOT DISTINCT FROM (OLD.para_contest, OLD.para_accept) THEN RETURN NULL; END IF;
  FOR r IN
    SELECT DISTINCT i.notice_id FROM public.notice_issues i
      JOIN public.gst_notices g ON g.id = i.notice_id
     WHERE i.issue_code = NEW.code AND g.deleted_at IS NULL AND NOT public.notice_is_closed(g.staff_status)
  LOOP
    PERFORM public.notice_reply_options_refresh(r.notice_id, false);
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_reply_issue_paras_changed ON public.reply_issue_types;
CREATE TRIGGER trg_reply_issue_paras_changed AFTER UPDATE OF para_contest, para_accept ON public.reply_issue_types
  FOR EACH ROW EXECUTE FUNCTION public.reply_issue_paras_changed();

CREATE OR REPLACE FUNCTION public.notice_type_settings_reply_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.response_need IS NOT DISTINCT FROM OLD.response_need THEN RETURN NULL; END IF;
  PERFORM public.notice_reply_options_refresh_open(ARRAY[NEW.form_code]);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_type_settings_reply_options ON public.notice_type_settings;
CREATE TRIGGER trg_notice_type_settings_reply_options AFTER INSERT OR UPDATE ON public.notice_type_settings
  FOR EACH ROW EXECUTE FUNCTION public.notice_type_settings_reply_options();

-- The signature block changed: every open notice.
CREATE OR REPLACE FUNCTION public.notice_settings_reply_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.reply_place, NEW.reply_signatory) IS NOT DISTINCT FROM (OLD.reply_place, OLD.reply_signatory) THEN RETURN NULL; END IF;
  PERFORM public.notice_reply_options_refresh_open(NULL);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_settings_reply_options ON public.notice_settings;
CREATE TRIGGER trg_notice_settings_reply_options AFTER UPDATE OF reply_place, reply_signatory ON public.notice_settings
  FOR EACH ROW EXECUTE FUNCTION public.notice_settings_reply_options();

-- Options for what is already on file are prepared when the templates arrive
-- (20261008161000: its INSERT fires trg_reply_templates_changed once).
