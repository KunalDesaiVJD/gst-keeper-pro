-- Reply templates (migration 20261008161000_reply_templates_seed.sql): the firm's replies
-- for every notice type that needs one. A synthetic notice of every form, once with every
-- fact and once with none, gets two to five options when its type needs a reply, none
-- when it does not, and the general replies when it has no form. No rendered reply holds
-- a dash, a placeholder or an unknown key; each has the letter's shape with its paragraphs
-- numbered in order; the issue paragraphs land in place; and re-running the seed never
-- overwrites the firm's own wording.
BEGIN;

-- ── The seed itself ────────────────────────────────────────────────────────
SELECT t_eq((SELECT count(*) FROM reply_templates WHERE cardinality(forms) = 0 AND is_active), 3::bigint,
            'three general templates');
SELECT t_eq((SELECT count(*) FROM reply_issue_types WHERE para_contest IS NULL OR para_accept IS NULL), 0::bigint,
            'every issue code has a contesting and an accepting paragraph');
SELECT t_eq((SELECT count(*) FROM reply_templates
              WHERE reply_has_dash(title) OR reply_has_dash(summary) OR reply_has_dash(body)), 0::bigint,
            'no dash in any template');
SELECT t_eq((SELECT count(*) FROM reply_issue_types
              WHERE reply_has_dash(para_contest) OR reply_has_dash(para_accept)
                 OR para_contest ~ '\{\{' OR para_accept ~ '\{\{'), 0::bigint,
            'no dash and no placeholder in any issue paragraph');
SELECT t_eq((SELECT string_agg(DISTINCT f, ',') FROM reply_templates t CROSS JOIN LATERAL unnest(t.forms) f
              WHERE NOT EXISTS (SELECT 1 FROM notice_type_settings s WHERE s.form_code = f AND s.response_need <> 'none')),
            NULL::text, 'templates only for notice types that need a reply');
SELECT t_eq((SELECT string_agg(s.form_code || '=' || n, ',' ORDER BY s.form_code) FROM notice_type_settings s
              CROSS JOIN LATERAL (SELECT count(*) AS n FROM reply_templates t WHERE t.is_active AND s.form_code = ANY (t.forms)) c
              WHERE s.response_need <> 'none' AND c.n NOT BETWEEN 2 AND 5),
            NULL::text, 'two to five templates for every type that needs a reply');
SELECT t_eq((SELECT count(*) FROM reply_templates t, notice_type_settings s
              WHERE s.response_need = 'none' AND s.form_code = ANY (t.forms)), 0::bigint,
            'none for the information only types');

-- ── A synthetic notice of every form: every fact, and none ────────────────
INSERT INTO clients (id, name, gstin, gst_user_id, inactive_at_hand) VALUES
 ('c6100000-0000-0000-0000-000000000001', 'Template Test Textiles Private Limited', '24TMPLT0000T1Z5', 'tmpl1', false),
 ('c6100000-0000-0000-0000-000000000002', '', '', 'tmpl2', false);
UPDATE notice_settings SET reply_place = 'Ahmedabad', reply_signatory = 'Partner, for the Authorised Signatory';

-- Each synthetic notice carries portal wording that the classifier reads as its form, as a sync would.
CREATE TEMP TABLE forms AS
SELECT r.form_code, row_number() OVER (ORDER BY r.form_code) AS n,
       CASE r.form_code
         WHEN 'DROPPED' THEN 'Proceedings dropped' WHEN 'ACCEPTED' THEN 'Acceptance of response'
         WHEN 'LUT-APPROVED' THEN 'LUT approved' WHEN 'LUT' THEN 'Letter of undertaking'
         WHEN 'REG-SCN' THEN 'Registration SCN' WHEN 'REG-06' THEN 'Registration certificate'
         WHEN 'REG-15' THEN 'Order of amendment' WHEN 'REG-22' THEN 'Order for revocation of cancellation'
         WHEN 'REG-CANCEL-REJ' THEN 'Cancellation rejection order' WHEN 'SUMMONS' THEN 'Notice to summon'
         WHEN 'APL-HEARING' THEN 'Hearing notice issued' WHEN 'RECT-ORDER' THEN 'Rectification of orders: order rectified'
         WHEN 'SPL-APPROVED' THEN 'Approval of waiver' WHEN 'ADT-CLOSURE' THEN 'Audit closure report'
         WHEN 'PMT-03' THEN 'Re-credit of the amount to cash or credit ledger'
         ELSE 'Notice (' || r.form_code || ')' END AS description
  FROM notice_form_rules r
UNION ALL SELECT NULL, 999, 'A letter the rules do not know';
SELECT t_eq((SELECT string_agg(form_code || '>' || coalesce(notice_form_code(NULL, description), 'none'), ',') FROM forms
              WHERE notice_form_code(NULL, description) IS DISTINCT FROM form_code), NULL::text,
            'each synthetic notice is classified as its form');

INSERT INTO gst_notices (id, client_id, source, portal_key, description, reference_number, issue_date, due_date, din, issued_by,
                         section_of_law, financial_year, period_from, period_to, demand, demand_total, hearing_date)
SELECT ('c6200000-0000-0000-0000-' || lpad(f.n::text, 12, '0'))::uuid, 'c6100000-0000-0000-0000-000000000001', 'notices',
       'full-' || coalesce(f.form_code, 'none'), f.description, 'ZD24TPL' || lpad(f.n::text, 4, '0'), ist_today() - 5, ist_today() + 25,
       '20261056YY' || lpad(f.n::text, 6, '0') || 'X', 'the Deputy Commissioner of State Tax, Ghatak-12',
       CASE WHEN f.form_code IN ('DRC-01', 'DRC-01A', 'DRC-07') THEN '73' END, '2023-24', '2023-04-01', '2024-03-31',
       '{"cgst": {"tax": 60000, "interest": 5400, "penalty": 6000}, "sgst": {"tax": 60000, "interest": 5400, "penalty": 6000}}',
       142800, ist_today() + 10
  FROM forms f;
INSERT INTO gst_notices (id, client_id, source, portal_key, description)
SELECT ('c6300000-0000-0000-0000-' || lpad(f.n::text, 12, '0'))::uuid, 'c6100000-0000-0000-0000-000000000002', 'notices',
       'bare-' || coalesce(f.form_code, 'none'), f.description
  FROM forms f;
-- An unclassified notice must not carry an issue implied by a form (notice_read_form); this test does not depend on that.
DELETE FROM notice_issues i USING gst_notices g
 WHERE g.id = i.notice_id AND i.source = 'form' AND g.form_code IS NULL
   AND g.client_id IN ('c6100000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002');

-- The DRC 01 with every fact carries one issue of every code; the ASMT 10 two, and an annexure.
INSERT INTO notice_issues (notice_id, seq, title, amount, issue_code)
SELECT ('c6200000-0000-0000-0000-' || lpad((SELECT n FROM forms WHERE form_code = 'DRC-01')::text, 12, '0'))::uuid,
       row_number() OVER (ORDER BY t.sort, t.code), t.title, 1000 * row_number() OVER (ORDER BY t.sort, t.code), t.code
  FROM reply_issue_types t;
INSERT INTO notice_issues (notice_id, seq, title, amount, issue_code) VALUES
 (('c6200000-0000-0000-0000-' || lpad((SELECT n FROM forms WHERE form_code = 'ASMT-10')::text, 12, '0'))::uuid, 1,
  'ITC claimed in GSTR-3B exceeds GSTR-2B', 90000, 'ITC_2B_V_3B'),
 (('c6200000-0000-0000-0000-' || lpad((SELECT n FROM forms WHERE form_code = 'ASMT-10')::text, 12, '0'))::uuid, 2,
  'Interest on delayed payment', 30000, 'INTEREST_50');
SELECT reply_annexure_save(('c6200000-0000-0000-0000-' || lpad((SELECT n FROM forms WHERE form_code = 'ASMT-10')::text, 12, '0'))::uuid,
       NULL, 'gstr3b_vs_2b', 'ready', 'ITC: GSTR-3B v GSTR-2B', ARRAY['04/2023'], '2023-24', '{}', '[]', '{}', 'h1', 9000, 6000);

-- Prepared again by force, so a reply that cannot be rendered fails here instead of only warning.
SELECT t_eq((SELECT sum(notice_reply_options_refresh(g.id, true)) > 0 FROM gst_notices g
              WHERE g.client_id IN ('c6100000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002')),
            true, 'every synthetic notice renders');

CREATE TEMP TABLE opts AS
SELECT o.*, g.form_code, g.client_id, coalesce(s.response_need, 'critical') AS need
  FROM notice_reply_options o
  JOIN gst_notices g ON g.id = o.notice_id
  LEFT JOIN notice_type_settings s ON s.form_code = g.form_code
 WHERE g.client_id IN ('c6100000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002');

-- ── Which options each notice gets ─────────────────────────────────────────
SELECT t_eq((SELECT string_agg(coalesce(g.form_code, 'none') || '/' || g.portal_key || '=' || c.n, ',')
               FROM gst_notices g
               LEFT JOIN notice_type_settings s ON s.form_code = g.form_code
               CROSS JOIN LATERAL (SELECT count(*) AS n FROM notice_reply_options o WHERE o.notice_id = g.id) c
              WHERE g.client_id IN ('c6100000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002')
                AND coalesce(s.response_need, 'critical') <> 'none'
                AND c.n <> (SELECT count(*) FROM reply_templates t WHERE t.is_active
                             AND CASE WHEN g.form_code IS NULL THEN cardinality(t.forms) = 0 ELSE g.form_code = ANY (t.forms) END)),
            NULL::text, 'every notice that needs a reply gets every template of its form');
SELECT t_eq((SELECT min(c.n) >= 2 FROM gst_notices g
               JOIN notice_type_settings s ON s.form_code = g.form_code AND s.response_need <> 'none'
               CROSS JOIN LATERAL (SELECT count(*) AS n FROM notice_reply_options o WHERE o.notice_id = g.id) c
              WHERE g.client_id IN ('c6100000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002')),
            true, 'at least two options for every critical or optional form, with facts and without');
SELECT t_eq((SELECT count(*) FROM opts WHERE need = 'none'), 0::bigint, 'no options for the information only types');
SELECT t_eq((SELECT string_agg(DISTINCT template_key, ',' ORDER BY template_key) FROM opts WHERE form_code IS NULL),
            'general_comply,general_reply,general_time', 'a notice without a form gets the general replies');
SELECT t_eq((SELECT string_agg(t.key, ',') FROM reply_templates t WHERE NOT EXISTS (SELECT 1 FROM opts o WHERE o.template_key = t.key)),
            NULL::text, 'every template is rendered for some notice');

-- ── What every rendered reply looks like ───────────────────────────────────
SELECT t_eq((SELECT count(*) FROM opts WHERE reply_has_dash(body) OR reply_has_dash(title) OR reply_has_dash(summary)),
            0::bigint, 'no dash in any rendered reply');
SELECT t_eq((SELECT count(*) FROM opts WHERE body ~ '\{\{|\}\}' OR body ~ '\[[a-z0-9]+_[a-z0-9_]+\]'), 0::bigint,
            'no placeholder left and no unknown key');
SELECT t_eq((SELECT count(*) FROM opts
              WHERE body !~ E'^To,\nThe '
                 OR body !~ E'\n\nSubject: '
                 OR body !~ E'\n\nRespected Sir/Madam,\n\n1\\. '
                 OR body !~ E'\n\nThanking you,\n\nYours faithfully,\nFor '
                 OR body !~ ('Date: ' || reply_date_long(ist_today()) || '$')), 0::bigint,
            'every reply has the shape of the letter');
SELECT t_eq((SELECT count(*) FROM opts WHERE body ~ E'  |\n\n\n|,,|\\.\\.|, \\.| ,|\\( | \\)'), 0::bigint,
            'no doubled spaces, blank lines or stray punctuation');
WITH nums AS (
  SELECT o.id, (m.v)[1]::int AS n, m.ord
    FROM opts o, LATERAL regexp_matches(o.body, E'(?:^|\n\n)([0-9]+)\\. ', 'g') WITH ORDINALITY AS m(v, ord)
)
SELECT t_eq((SELECT count(DISTINCT id) FROM nums WHERE n <> ord), 0::bigint, 'paragraphs numbered 1, 2, 3 in order');
SELECT t_eq((SELECT count(*) FROM reply_templates t
               CROSS JOIN LATERAL regexp_matches(t.body, '\{\{([a-z0-9_]+)\}\}', 'g') AS m(k)
              WHERE NOT notice_reply_context('c6200000-0000-0000-0000-000000000001') ? (m.k)[1]), 0::bigint,
            'every placeholder is one the renderer fills');

-- ── Facts in, and graceful phrases when there are none ─────────────────────
SELECT t_eq((SELECT body ~ ('The Deputy Commissioner of State Tax, Ghatak 12' || E'\n\nSubject: Reply in FORM GST DRC 06 to FORM GST DRC 01 '
                            || 'with reference number ZD24TPL[0-9]{4} dated [0-9]{1,2} [A-Z][a-z]+ [0-9]{4}, bearing Document '
                            || 'Identification Number 20261056YY[0-9]{6}X, for the period from 1 April 2023 to 31 March 2024')
               FROM opts WHERE template_key = 'drc01_contest' AND client_id = 'c6100000-0000-0000-0000-000000000001'),
            true, 'officer without the article and the dash, form, reference, date, DIN and period');
SELECT t_eq((SELECT body ~ 'issued under section 73 of the Central Goods and Services Tax Act, 2017 read with the corresponding provision of the Gujarat Goods and Services Tax Act, 2017'
                   AND body ~ 'why tax of Rs\. 1,20,000, interest of Rs\. 10,800 and penalty of Rs\. 12,000 should not be demanded'
                   AND body ~ 'denies the liability for Rs\. 1,42,800 \(Rupees One Lakh Forty Two Thousand Eight Hundred only\) in its entirety'
                   AND body ~ 'The personal hearing in the matter is fixed on '
                   AND body ~ E'\nFor Template Test Textiles Private Limited\n\nPartner, for the Authorised Signatory\nGSTIN: 24TMPLT0000T1Z5\nPlace: Ahmedabad\n'
               FROM opts WHERE template_key = 'drc01_contest' AND client_id = 'c6100000-0000-0000-0000-000000000001'),
            true, 'section, State Act, demand by head and in words, hearing and signature block');
SELECT t_eq((SELECT body ~ 'show cause why the amounts set out therein should not be demanded'
                   AND body ~ 'denies the liability for the amount proposed in the notice in its entirety'
                   AND body ~ 'with reference number \[reference number\] dated \[date of the notice\] for the period covered by the notice'
                   AND body ~ 'issued under the relevant provisions of the Central Goods and Services Tax Act, 2017 and the State Goods and Services Tax Act, 2017'
                   AND body ~ '^To,\nThe Proper Officer\n'
                   AND body ~ '\[name of the taxpayer\] \(hereinafter referred to as "the noticee"\)'
                   AND body !~ 'The personal hearing in the matter is fixed on'
                   AND body ~ E'\n\\[List of documents enclosed\\]\n'
                   AND body ~ E'\nFor \\[name of the taxpayer\\]\n\nPartner, for the Authorised Signatory\nGSTIN: \\[GSTIN\\]\nPlace: Ahmedabad\n'
               FROM opts WHERE template_key = 'drc01_contest' AND client_id = 'c6100000-0000-0000-0000-000000000002'),
            true, 'every fact missing: graceful phrases and fill ins, never a gap');

-- ── Issue paragraphs in place ──────────────────────────────────────────────
SELECT t_eq((SELECT (SELECT count(*) FROM regexp_matches(o.body, E'\nIssue \\([a-s]\\): ', 'g')) FROM opts o
              WHERE o.template_key = 'drc01_contest' AND o.client_id = 'c6100000-0000-0000-0000-000000000001'),
            19::bigint, 'one paragraph for each of the nineteen issues');
SELECT t_eq((SELECT count(*) FROM reply_issue_types t, opts o
              WHERE o.template_key = 'drc01_contest' AND o.client_id = 'c6100000-0000-0000-0000-000000000001'
                AND strpos(o.body, t.para_contest) = 0), 0::bigint, 'each issue contested in its own words');
SELECT t_eq((SELECT count(*) FROM reply_issue_types t, opts o
              WHERE o.template_key = 'drc01_pay_conclude' AND o.client_id = 'c6100000-0000-0000-0000-000000000001'
                AND strpos(o.body, t.para_accept) = 0), 0::bigint, 'and accepted in its own words');
SELECT t_eq((SELECT body ~ E'\n\nIssue \\([a-c]\\): ITC claimed in GSTR 3B exceeds GSTR 2B \\(Rs\\. 90,000\\)\nIt is respectfully submitted'
                   AND body ~ E'\nAnnexure 1: ITC: GSTR 3B v GSTR 2B'
               FROM opts WHERE template_key = 'asmt10_explain' AND client_id = 'c6100000-0000-0000-0000-000000000001'),
            true, 'the ASMT 10 explanation carries its issues and annexure');

-- ── A draft started from one of them ───────────────────────────────────────
SELECT t_eq((notice_reply_option_use((SELECT id FROM opts WHERE template_key = 'gstr3a_filed'
                                        AND client_id = 'c6100000-0000-0000-0000-000000000001'), NULL, 'Asha') ->> 'version')::int,
            1, 'a reply option starts the first draft');
SELECT t_eq((SELECT d.body ~ '^To,\nThe Deputy Commissioner' AND NOT reply_has_dash(d.body) FROM notice_drafts d
              JOIN gst_notices g ON g.id = d.notice_id
             WHERE g.portal_key = 'full-GSTR-3A' AND g.client_id = 'c6100000-0000-0000-0000-000000000001'),
            true, 'the draft holds the reply text');

-- ── Re-running the seed keeps the firm's wording ───────────────────────────
UPDATE reply_templates SET body = body || E'\n\nEdited by the firm.', is_active = true WHERE key = 'drc01_contest';
UPDATE reply_templates SET is_active = false WHERE key = 'drc01_documents';
UPDATE reply_issue_types SET para_contest = 'The firm contests this issue in its own words. Its reasons are enclosed.'
 WHERE code = 'OTHER';
\ir ../../migrations/20261008161000_reply_templates_seed.sql
SELECT t_eq((SELECT body ~ 'Edited by the firm\.$' AND version = 2 FROM reply_templates WHERE key = 'drc01_contest'), true,
            'an edited template is not overwritten');
SELECT t_eq((SELECT is_active FROM reply_templates WHERE key = 'drc01_documents'), false, 'a template switched off stays off');
SELECT t_eq((SELECT para_contest FROM reply_issue_types WHERE code = 'OTHER'),
            'The firm contests this issue in its own words. Its reasons are enclosed.', 'an edited issue paragraph is not overwritten');
SELECT t_eq((SELECT para_accept IS NOT NULL FROM reply_issue_types WHERE code = 'OTHER'), true, 'and its other paragraph stays');
SELECT t_eq((SELECT count(*) FROM notice_reply_options o JOIN gst_notices g ON g.id = o.notice_id
              WHERE o.template_key = 'drc01_documents' AND o.status = 'ready'
                AND g.client_id IN ('c6100000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002')), 0::bigint,
            'the options of a template switched off are withdrawn');

ROLLBACK;
