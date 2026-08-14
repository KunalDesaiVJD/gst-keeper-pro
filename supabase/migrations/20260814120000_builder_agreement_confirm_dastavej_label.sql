-- The BU agreement confirmation email always said "the building use permission
-- ... is dated {{bu_date}}", even for a single-unit dastavej-triggered
-- auto-post where bu_date is literally the dastavej (registered sale deed)
-- date, not a real BU permission date — the same "BU date" vs "dastavej
-- date" conflation raised for Plot No. 148 (Shree Maruti Infra). The
-- template now takes a {{cutoff_label}} var so the sentence names the right
-- document; src/lib/builderAgreementConfirmData.ts supplies it based on
-- builder_bu_event_units.cut_off_source at the call site.
UPDATE public.email_templates
SET body = $b$Dear {{contact_person}},

The {{cutoff_label}} for {{project_name}} is dated {{bu_date}}. Under GST, that date is when the balance consideration for unit {{unit_no}} becomes taxable, whether or not it has been received.

Our working uses the following agreement value for this unit:

   Rs. {{agreement_value}}

Please confirm this is correct by clicking the link below. If it has changed and we have not been informed, please use the dispute option instead so we can correct our working before filing.

{{confirm_link}}

We will hold this unit's differential until we hear from you.

Warm regards,
{{staff_name}}
{{firm_name}}  |  {{firm_email}}  |  {{firm_phone}}$b$
WHERE key = 'builder_bu_agreement_confirm';
