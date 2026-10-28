-- The engagement letter, version 2 (the firm, 28 October 2026): "default
-- permission is Yes only … if the client does not want then will not sign it",
-- "design letter only in 3 pages, keep AI paragraph only in 1/2 liners … no need
-- to name any AI tool", "delete fees clause".
--
-- 0. The firm's details, kept once (the firm, 28 October 2026: "save everything
--    our firm details in our GST Software permanently"): firm_profile, one row,
--    open to read, written only by a migration; src/utils/reportTheme.ts
--    REPORT_FIRM carries the same for the app's papers.
-- 1. engagement_letter_create asks for the fees only when the published letter
--    quotes {{fees}} (version 2 does not).
-- 2. Version 2 of the letter: 17 short clauses (no fees clause), the AI clause in
--    two lines naming no tool, the DPDP Act clauses kept (roles and consent,
--    safeguards and sharing, retention, rights and grievances, breach). It is
--    published with the firm's details (0), version 1 retired (a published
--    version never changes, and the letter signed on version 1 keeps its text).
--    The signature is the consent to the whole letter, AI tools included: the
--    page asks no separate question (engagement_letter_sign still records it).

-- ── 0. The firm's details ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.firm_profile (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  name                  text NOT NULL,
  designation           text NOT NULL DEFAULT 'Chartered Accountants',
  frn                   text NOT NULL,
  address               text NOT NULL,
  city                  text NOT NULL,
  email                 text NOT NULL,
  phone                 text,
  partner_name          text NOT NULL,
  partner_membership_no text NOT NULL,
  grievance_name        text,
  grievance_email       text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text
);
COMMENT ON TABLE public.firm_profile IS
  'The firm''s own details, kept once: name, FRN, address, the engagement partner and membership number, the DPDP grievance officer. Read by the engagement letter (version 2 on); written only by a migration (20261028130000).';
ALTER TABLE public.firm_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_profile_read ON public.firm_profile;
CREATE POLICY firm_profile_read ON public.firm_profile FOR SELECT TO public USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.firm_profile FROM anon, authenticated;
GRANT SELECT ON public.firm_profile TO anon, authenticated;
GRANT ALL ON public.firm_profile TO service_role;

INSERT INTO public.firm_profile AS f (id, name, frn, address, city, email, phone, partner_name, partner_membership_no, grievance_name, grievance_email, updated_by)
VALUES (true, 'V. J. Desai & Co. LLP', '113541W/W101248',
        'B-901/902, Ratnaakar Nine Square, Opp ITC Narmada, Satellite, Ahmedabad-380015', 'Ahmedabad',
        'gst@vjdesai.com', '9426662515', 'CA Kunal Desai', '153784', 'Mukesh Baldha', 'info@vjdesai.com',
        'The firm (28 October 2026)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, frn = EXCLUDED.frn, address = EXCLUDED.address, city = EXCLUDED.city,
  email = EXCLUDED.email, phone = EXCLUDED.phone, partner_name = EXCLUDED.partner_name,
  partner_membership_no = EXCLUDED.partner_membership_no, grievance_name = EXCLUDED.grievance_name,
  grievance_email = EXCLUDED.grievance_email, updated_at = now(), updated_by = EXCLUDED.updated_by;

-- ── 1. The fees only where the letter quotes them ──────────────────────────
CREATE OR REPLACE FUNCTION public.engagement_letter_create(
  p_client_ids uuid[], p_to text, p_cc text, p_services text[], p_fees text, p_start_date date,
  p_valid_days int, p_message text, p_replace boolean, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t       public.engagement_letter_templates;
  c       record;
  v_to    text;
  v_vars  jsonb;
  v_title text; v_intro text; v_clauses jsonb; v_id uuid;
  made    jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  v_days  int := LEAST(GREATEST(COALESCE(p_valid_days, 30), 3), 90);
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_serv  text;
BEGIN
  IF NOT public.notice_case_admin(p_actor_id) THEN
    RETURN jsonb_build_object('error', 'Only a GST Manager or the superadmin can send engagement letters.');
  END IF;
  SELECT * INTO t FROM public.engagement_letter_templates WHERE status = 'published';
  IF t.version IS NULL THEN
    RETURN jsonb_build_object('error', 'No engagement letter is published yet: a GST Manager or the superadmin reads the draft, fills the firm''s details and publishes it.');
  END IF;
  IF COALESCE(array_length(p_client_ids, 1), 0) = 0 THEN RETURN jsonb_build_object('error', 'Choose a client.'); END IF;
  IF array_length(p_client_ids, 1) > 1 AND NULLIF(btrim(COALESCE(p_to, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'A typed address is for one client; many clients each get their own address on file.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_cc, '')), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(p_cc, '\s*[,;]\s*')) a WHERE btrim(a) <> '' AND NOT public.engagement_letter_email_ok(a)) THEN
    RETURN jsonb_build_object('error', 'A CC address is not valid.');
  END IF;
  IF COALESCE(array_length(p_services, 1), 0) = 0 THEN RETURN jsonb_build_object('error', 'Choose the services.'); END IF;
  -- The fees only where the letter quotes them (version 2 has no fees clause).
  IF btrim(COALESCE(p_fees, '')) = '' AND position('{{fees}}' IN COALESCE(t.intro, '') || COALESCE(t.clauses::text, '')) > 0 THEN
    RETURN jsonb_build_object('error', 'Say the fees.');
  END IF;
  IF (SELECT count(*) FROM public.engagement_letters WHERE created_at > now() - interval '1 day') + array_length(p_client_ids, 1) > 300 THEN
    RETURN jsonb_build_object('error', 'At most 300 letters a day.');
  END IF;
  SELECT string_agg('• ' || left(btrim(s), 300), E'\n') INTO v_serv FROM unnest(p_services[1:25]) s WHERE btrim(s) <> '';

  FOR c IN SELECT id, name, gstin, email FROM public.clients WHERE id = ANY (p_client_ids) ORDER BY name LOOP
    v_to := lower(btrim(COALESCE(NULLIF(btrim(COALESCE(p_to, '')), ''), c.email, '')));
    IF NOT public.engagement_letter_email_ok(v_to) THEN
      skipped := skipped || jsonb_build_object('client_id', c.id, 'name', c.name, 'why', 'no valid e-mail address on file');
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.engagement_letters l WHERE l.client_id = c.id AND l.status IN ('ready', 'sent') AND l.expires_at > now()) THEN
      IF NOT COALESCE(p_replace, false) THEN
        skipped := skipped || jsonb_build_object('client_id', c.id, 'name', c.name, 'why', 'a letter sent earlier is still open (send with "replace" to withdraw it)');
        CONTINUE;
      END IF;
      UPDATE public.engagement_letters l SET status = 'revoked', revoked_at = now(), revoked_by = left(p_actor_name, 120), revoke_reason = 'replaced by a newer letter'
       WHERE l.client_id = c.id AND l.status IN ('ready', 'sent');
    END IF;
    v_vars := COALESCE(t.firm, '{}'::jsonb) || jsonb_build_object(
      'firm_name', COALESCE(t.firm ->> 'name', ''), 'firm_frn', COALESCE(t.firm ->> 'frn', ''), 'firm_address', COALESCE(t.firm ->> 'address', ''),
      'firm_email', COALESCE(t.firm ->> 'email', ''), 'firm_phone', COALESCE(t.firm ->> 'phone', ''),
      'client_name', c.name, 'gstin', COALESCE(c.gstin, ''),
      'pan', CASE WHEN length(COALESCE(c.gstin, '')) = 15 THEN substr(c.gstin, 3, 10) ELSE '' END,
      'services', v_serv, 'fees', left(btrim(COALESCE(p_fees, '')), 2000),
      'start_date', to_char(COALESCE(p_start_date, v_today), 'FMDD FMMonth YYYY'),
      'letter_date', to_char(v_today, 'FMDD FMMonth YYYY'));
    v_title := public.engagement_letter_fill(t.title, v_vars);
    v_intro := public.engagement_letter_fill(t.intro, v_vars);
    SELECT jsonb_agg(jsonb_build_object('key', COALESCE(x ->> 'key', 'c' || n), 'heading', public.engagement_letter_fill(x ->> 'heading', v_vars),
             'summary', public.engagement_letter_fill(x ->> 'summary', v_vars), 'text', public.engagement_letter_fill(x ->> 'text', v_vars)) ORDER BY n)
      INTO v_clauses FROM jsonb_array_elements(t.clauses) WITH ORDINALITY e(x, n);
    INSERT INTO public.engagement_letters (client_id, client_name, client_gstin, template_version, to_email, cc_email, vars, title, intro, clauses, firm,
                                           doc_sha256, status, created_by_id, created_by_name, expires_at)
    VALUES (c.id, c.name, c.gstin, t.version, v_to, NULLIF(btrim(COALESCE(p_cc, '')), ''),
            v_vars || jsonb_build_object('message', left(NULLIF(btrim(COALESCE(p_message, '')), ''), 2000), 'services_list', to_jsonb(p_services[1:25])),
            v_title, v_intro, v_clauses, t.firm,
            encode(extensions.digest(convert_to(public.engagement_letter_doc_text(v_title, v_intro, v_clauses), 'UTF8'), 'sha256'), 'hex'),
            'ready', p_actor_id, left(p_actor_name, 120), now() + make_interval(days => v_days))
    RETURNING id INTO v_id;
    PERFORM public.engagement_letter_log(v_id, 'created', jsonb_build_object('version', t.version, 'to', v_to, 'cc', NULLIF(btrim(COALESCE(p_cc, '')), '')), p_actor_name);
    made := made || jsonb_build_object('id', v_id, 'client_id', c.id, 'name', c.name, 'to', v_to);
  END LOOP;
  RETURN jsonb_build_object('letters', made, 'skipped', skipped, 'version', t.version);
END;
$$;

-- ── 2. Version 2 of the letter ─────────────────────────────────────────────
INSERT INTO public.engagement_letter_templates (version, title, intro, clauses, firm, status, note, created_by, updated_by)
SELECT 2, v1.title,
       'Dear {{client_name}},

This letter, dated {{letter_date}}, sets out the terms on which {{firm_name}}, Chartered Accountants, will act for you under the Goods and Services Tax laws, and how we protect your personal data under the Digital Personal Data Protection Act, 2023. Please read it in full before you sign.',
       $c$[
 {
  "key": "parties",
  "heading": "The parties and this letter",
  "summary": "{{firm_name}} (FRN {{firm_frn}}) acts for {{client_name}} (GSTIN {{gstin}}) from {{start_date}} on these terms.",
  "text": "This letter is between {{firm_name}}, Chartered Accountants (FRN {{firm_frn}}), {{firm_address}} (\"we\", \"the firm\"), and {{client_name}}, GSTIN {{gstin}} (\"you\"). It applies from {{start_date}} to the services in clause 2 and to any further GST work you ask us to do, unless other terms are agreed in writing, and continues until it is ended under clause 15."
 },
 {
  "key": "scope",
  "heading": "The services",
  "summary": "The GST work listed here; anything else is agreed separately.",
  "text": "We will provide these services:\n{{services}}\n\nWork not listed, such as audits, certifications, representation before the Appellate Tribunal or the courts, or advice on other laws, is outside this engagement unless agreed in writing (an e-mail is enough). We rely on the information you give us and do not audit or verify your records unless we agree to do so."
 },
 {
  "key": "client_duties",
  "heading": "Your responsibilities",
  "summary": "You give complete and correct information on time, approve what is filed and pay the tax due.",
  "text": "You keep the books, invoices, e-invoices, e-way bills and records the GST laws require; give us complete and correct information on time; approve each return, reply or application before it is filed and share the one time password needed to file it; pay the tax, interest, late fee and penalty due; tell us promptly of any notice received outside the portal and of any change in your business, bank account, signatory or e-mail address; and keep your portal credentials secure. As the registered person you remain responsible for every return and form filed for you, including those we file as your GST Practitioner (section 59 of the CGST Act, 2017 and rule 83 of the CGST Rules, 2017)."
 },
 {
  "key": "firm_duties",
  "heading": "Our responsibilities",
  "summary": "We act with due care under the ICAI's standards and keep you informed of your due dates.",
  "text": "We carry out the services with due care and skill under the standards and Code of Ethics of the Institute of Chartered Accountants of India, tell you of your due dates and of anything that needs your attention, and file on time when we receive complete information and your approval in time. We are not responsible for a delay or error caused by information that is late, incomplete or wrong, by the GST portal being unavailable, or by a change in the law after our work was done."
 },
 {
  "key": "portal",
  "heading": "GST portal access and authority",
  "summary": "You authorise us to use the GST portal for you, to file what you approve and download your records.",
  "text": "You authorise our partners and staff to log in to the GST portal on your behalf, and to act as your GST Practitioner where you engage us as one, to prepare and file what you approve and to download your returns, ledgers, notices, orders and case documents. Your credentials are kept in our practice management system, reachable only by our staff and used only for your work. Appearing for you before a tax authority (section 116 of the CGST Act, 2017) needs your written authority for each proceeding."
 },
 {
  "key": "notices",
  "heading": "Notices, replies and appeals",
  "summary": "We track your notices and draft replies and appeals on your instructions; time limits are strict.",
  "text": "Where the services include notices and appeals, we follow your notices and orders on the portal, tell you of each one and its time limit, and draft replies, applications and appeals on your instructions, for your approval before filing. Time limits are strict, so we need your instructions and documents in good time. Any pre deposit, tax, interest, penalty or fee is payable by you. We give our professional view but cannot guarantee the outcome of a proceeding."
 },
 {
  "key": "confidentiality",
  "heading": "Confidentiality",
  "summary": "Your information stays confidential under the Chartered Accountants Act, 1949 and the ICAI Code of Ethics.",
  "text": "We keep your information confidential as the Chartered Accountants Act, 1949 and the ICAI Code of Ethics require, and disclose it only with your consent, where a law, court or authority requires it, to the ICAI or its reviewers, or to our service providers who are bound to keep it confidential (clause 9)."
 },
 {
  "key": "personal_data",
  "heading": "Personal data (DPDP Act, 2023)",
  "summary": "We use personal data only for these services and the law; by signing you consent to it.",
  "text": "We handle personal data under the Digital Personal Data Protection Act, 2023 and its Rules of 2025. For the personal data of you and your proprietor, partners, directors and authorised persons (names, PAN, Aadhaar only where the GST law needs it, addresses, e-mail addresses and mobile numbers, signatures, bank details and portal credentials) we are the Data Fiduciary and use it only to provide the services, to communicate with you and to meet our legal obligations. For the personal data of your customers, suppliers and employees in your records, you are the Data Fiduciary and we process it only on your behalf for these services (section 8(2)); you confirm that you may share it with us. By signing you consent to this processing. You may withdraw your consent at any time by writing to our grievance officer (clause 12); processing that a law requires continues as the law allows."
 },
 {
  "key": "safeguards",
  "heading": "Security and sharing",
  "summary": "Reasonable safeguards, service providers bound by contract, and no sale or advertising use of your data.",
  "text": "We take reasonable security safeguards (section 8(5) and rule 6): access only for the staff on your matters, encrypted connections, records of access and changes, backups, and contracts that bind our service providers to the same care. We share personal data only with the providers who help us deliver the services (hosting, e-mail, the GST portal and GSTN, and the tools in clause 10), some of whom may process it outside India as section 16 permits. We never sell personal data or use it for advertising."
 },
 {
  "key": "ai",
  "heading": "Technology tools",
  "summary": "Secure AI tools may assist our work; a member of the firm reviews everything.",
  "text": "We may use secure AI tools to help read your documents and prepare drafts. A member of the firm reviews all such work before anything is filed or sent."
 },
 {
  "key": "retention",
  "heading": "How long we keep records",
  "summary": "At least 72 months from the annual return's due date, longer while a proceeding is pending; then erased.",
  "text": "We keep your records for the engagement and then as long as the law requires: at least 72 months from the due date of the annual return for the year (section 36 of the CGST Act, 2017), and longer while a proceeding about them is pending. We keep this letter and the record of its signing for eight years after the engagement ends. We then erase personal data or make it anonymous (section 8(7))."
 },
 {
  "key": "rights",
  "heading": "Your rights and grievances",
  "summary": "Access, correction, erasure and grievances through {{grievance_name}} ({{grievance_email}}).",
  "text": "You may ask for a summary of the personal data we process and with whom we share it, have it corrected, completed, updated or erased, have a grievance redressed, and nominate a person to act for you (sections 11 to 14). Write to our grievance officer, {{grievance_name}}, at {{grievance_email}}; we answer within the time the Rules allow and in any case within 90 days. If you are not satisfied, you may complain to the Data Protection Board of India."
 },
 {
  "key": "breach",
  "heading": "Personal data breach",
  "summary": "We tell you without delay and inform the Data Protection Board as the Rules require.",
  "text": "If a breach affects personal data we process, we tell those affected without delay (what happened, its likely effect, what we are doing and what they can do), inform the Data Protection Board without delay and give it the detailed report within 72 hours, and, where we act as your Data Processor, tell you without delay."
 },
 {
  "key": "liability",
  "heading": "Limitation of liability",
  "summary": "Our liability is limited to the fees for the service concerned in the previous 12 months.",
  "text": "Our total liability for any claim under this engagement is limited to the fees paid for the service concerned in the 12 months before the claim, except where the law does not allow it to be limited. We are not liable for indirect loss or for loss caused by information that was late, incomplete or wrong. Tax, interest, late fee and penalty remain payable by you."
 },
 {
  "key": "term",
  "heading": "Ending the engagement",
  "summary": "Either of us may end it with 30 days' notice by e-mail; we hand over your documents.",
  "text": "Either of us may end this engagement with 30 days' notice by e-mail, and we may end it at once if continuing would breach a law or our professional standards. We then hand over your documents, or send them to your new adviser on your instructions, keep copies only as clause 11 allows, and delete the portal credentials we hold."
 },
 {
  "key": "esign",
  "heading": "Communication and electronic signature",
  "summary": "We communicate by e-mail and the portal; signing here with a one time code is a valid contract.",
  "text": "We communicate by e-mail, through our portal and by telephone or WhatsApp on the numbers you give us. Signing this letter on our portal, confirmed by a one time code sent to your e-mail address, forms a valid contract (section 10A of the Information Technology Act, 2000). We keep a record of the signing (the time, your name and capacity, the network address and browser, and the fingerprint of the text) and e-mail you a signed copy."
 },
 {
  "key": "general",
  "heading": "General terms",
  "summary": "Indian law applies; disputes go first to discussion, then to arbitration at {{city}}.",
  "text": "This letter is the whole agreement on the services; a change is valid only in writing (an e-mail from each of us is enough), and an invalid part does not affect the rest. It is governed by the laws of India. A dispute not settled by discussion within 30 days goes to a sole arbitrator under the Arbitration and Conciliation Act, 1996, seated at {{city}}; subject to that, the courts at {{city}} have jurisdiction."
 }
]$c$::jsonb,
       COALESCE(v1.firm, '{}'::jsonb) || (SELECT jsonb_strip_nulls(jsonb_build_object(
         'name', f.name, 'frn', f.frn, 'address', f.address, 'city', f.city, 'email', f.email, 'phone', f.phone,
         'partner_name', f.partner_name, 'partner_membership_no', f.partner_membership_no,
         'grievance_name', f.grievance_name, 'grievance_email', f.grievance_email)) FROM public.firm_profile f WHERE f.id),
       'draft',
       'Version 2 (28 October 2026): three pages, the AI clause in two lines naming no tool, no fees clause; the signature is the consent to the whole letter.',
       'The firm (28 October 2026)', 'The firm (28 October 2026)'
  FROM public.engagement_letter_templates v1
 WHERE v1.version = 1 AND NOT EXISTS (SELECT 1 FROM public.engagement_letter_templates WHERE version = 2);

-- Published as engagement_letter_template_publish does, with its checks on the firm's details.
DO $p$
DECLARE missing text[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.engagement_letter_templates WHERE version = 2 AND status = 'draft') THEN
    SELECT array_agg(k) INTO missing
      FROM public.engagement_letter_templates t,
           unnest(ARRAY['name', 'frn', 'address', 'email', 'partner_name', 'partner_membership_no', 'grievance_name', 'grievance_email', 'city']) k
     WHERE t.version = 2 AND btrim(COALESCE(t.firm ->> k, '')) = '';
    IF missing IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('engagement_letter_templates'));
      UPDATE public.engagement_letter_templates SET status = 'retired' WHERE status = 'published';
      UPDATE public.engagement_letter_templates
         SET status = 'published', published_at = now(), published_by = 'The firm (28 October 2026)'
       WHERE version = 2;
    END IF;
  END IF;
END $p$;
