-- The engagement letter, version 3 (the firm, 28 October 2026: "no need of
-- mentioning anything related to fees"; "no need of withdraw my consent link as
-- if they want to then they will send us an email"): version 2 with no fee of
-- any kind named. Clause 14 limits the firm's liability to direct loss from its
-- own negligence or wilful default (no cap by the fees); clauses 3, 6 and 14
-- name tax, interest and penalties. Published with the firm's details from
-- firm_profile, version 2 retired (no letter was made on it). The signed page
-- no longer offers to withdraw the AI consent: a client who wants to withdraws
-- it by e-mail to the grievance officer (clause 8), recorded by staff.

INSERT INTO public.engagement_letter_templates (version, title, intro, clauses, firm, status, note, created_by, updated_by)
SELECT 3, v2.title,
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
  "text": "You keep the books, invoices, e-invoices, e-way bills and records the GST laws require; give us complete and correct information on time; approve each return, reply or application before it is filed and share the one time password needed to file it; pay the tax, interest and penalties due; tell us promptly of any notice received outside the portal and of any change in your business, bank account, signatory or e-mail address; and keep your portal credentials secure. As the registered person you remain responsible for every return and form filed for you, including those we file as your GST Practitioner (section 59 of the CGST Act, 2017 and rule 83 of the CGST Rules, 2017)."
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
  "text": "Where the services include notices and appeals, we follow your notices and orders on the portal, tell you of each one and its time limit, and draft replies, applications and appeals on your instructions, for your approval before filing. Time limits are strict, so we need your instructions and documents in good time. Any pre deposit, tax, interest or penalty is payable by you. We give our professional view but cannot guarantee the outcome of a proceeding."
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
  "summary": "We answer only for direct loss from our own negligence; tax, interest and penalties stay yours.",
  "text": "We are liable only for direct loss caused by our own negligence or wilful default, and not for indirect or consequential loss, or for loss caused by information that was late, incomplete or wrong. Tax, interest and penalties under the GST laws remain payable by you."
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
       COALESCE(v2.firm, '{}'::jsonb) || (SELECT jsonb_strip_nulls(jsonb_build_object(
         'name', f.name, 'frn', f.frn, 'address', f.address, 'city', f.city, 'email', f.email, 'phone', f.phone,
         'partner_name', f.partner_name, 'partner_membership_no', f.partner_membership_no,
         'grievance_name', f.grievance_name, 'grievance_email', f.grievance_email)) FROM public.firm_profile f WHERE f.id),
       'draft',
       'Version 3 (28 October 2026): version 2 with no fee of any kind named; liability limited to direct loss from the firm''s own negligence.',
       'The firm (28 October 2026)', 'The firm (28 October 2026)'
  FROM public.engagement_letter_templates v2
 WHERE v2.version = 2 AND NOT EXISTS (SELECT 1 FROM public.engagement_letter_templates WHERE version = 3);

DO $p$
DECLARE missing text[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.engagement_letter_templates WHERE version = 3 AND status = 'draft') THEN
    SELECT array_agg(k) INTO missing
      FROM public.engagement_letter_templates t,
           unnest(ARRAY['name', 'frn', 'address', 'email', 'partner_name', 'partner_membership_no', 'grievance_name', 'grievance_email', 'city']) k
     WHERE t.version = 3 AND btrim(COALESCE(t.firm ->> k, '')) = '';
    IF missing IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('engagement_letter_templates'));
      UPDATE public.engagement_letter_templates SET status = 'retired' WHERE status = 'published';
      UPDATE public.engagement_letter_templates
         SET status = 'published', published_at = now(), published_by = 'The firm (28 October 2026)'
       WHERE version = 3;
    END IF;
  END IF;
END $p$;
