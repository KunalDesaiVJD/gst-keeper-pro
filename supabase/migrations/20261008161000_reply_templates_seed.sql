-- Notices Phase 4 · Reply options: the firm's reply templates and issue paragraphs
-- (asked by the firm on 2026-10-06: "prepare different replies ... legal wordings ...
-- without hyphen"). Catalogue, legal basis and fill-ins: docs/REPLY_TEMPLATES.md.
-- Machinery (rendering, triggers, the no-dash constraints): 20261008160000_reply_options.sql.
--
-- Every template, title, summary and paragraph below is formal legal English with no
-- hyphen or dash character of any kind (public.reply_has_dash rejects them). Facts the app
-- cannot know are written as [fill ins] for the person who completes the draft.
--
-- Re-running never overwrites the firm's own wording:
--   1. issue paragraphs are set only where still empty (coalesce, per column);
--   2. templates are added with ON CONFLICT (key) DO NOTHING.
-- The paragraphs come first, so that the single INSERT of templates (its statement trigger
-- prepares the options of every open notice once) renders them with the paragraphs in place.
-- Forms that need no reply (DROPPED, ACCEPTED, LUT, LUT-APPROVED, APL-01, APL-02, REG-06,
-- REG-15, REG-22, SPL-APPROVED, DRC-03, PMT-03, RFD-04, ADT-CLOSURE) have no templates.

-- ── 1. Issue paragraphs: contesting and accepting each issue code ──────────
UPDATE public.reply_issue_types AS t
   SET para_contest = coalesce(t.para_contest, v.para_contest),
       para_accept  = coalesce(t.para_accept, v.para_accept)
  FROM (VALUES
    ('LIAB_GSTR1_V_3B',
     $p$It is respectfully submitted that the difference between the tax reported in FORM GSTR 1 and the tax paid through FORM GSTR 3B does not, by itself, establish any short payment of tax. The enclosed reconciliation, prepared month by month and for the financial year as a whole, shows that the difference arises from items such as tax on supplies reported in one month but paid with the return of a later month, amendments and credit notes reported in later statements, advances on which tax was paid earlier and adjusted later, and errors in reporting since corrected. Where tax was paid with the return of a later month, it stands discharged, and the only consequence is interest under section 50 of the Act for the period of delay, computed in accordance with that section and the proviso to section 50(1), to the extent applicable. No tax therefore remains unpaid on this issue.$p$,
     $p$The difference between the tax reported in FORM GSTR 1 and the tax paid through FORM GSTR 3B for the period has been reconciled, and the short payment that remains after the reconciliation is accepted. The tax so accepted has been paid through FORM GST DRC 03, together with interest under section 50 of the Act, as set out in this reply.$p$),
    ('ITC_2B_V_3B',
     $p$It is respectfully submitted that the input tax credit availed in FORM GSTR 3B is supported by tax invoices and satisfies the conditions of section 16 of the Act, and that the difference with FORM GSTR 2B does not represent any credit availed in excess of the entitlement for the period. The enclosed reconciliation, prepared month by month and head by head, shows that the difference arises from items such as invoices reflected in FORM GSTR 2B of a later month, credit reversed earlier and reclaimed as permitted, and credit that by its nature is not reflected in FORM GSTR 2B, such as tax paid on self invoices for supplies received from unregistered persons. As the credit is admissible, no amount is payable on this issue. In any event, interest under section 50(3) of the Act arises only where credit is wrongly availed and also utilised.$p$,
     $p$The excess of the input tax credit availed in FORM GSTR 3B over that available in FORM GSTR 2B, to the extent it remains after the reconciliation, is accepted. The credit so accepted has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act to the extent the credit was utilised, as set out in this reply.$p$),
    ('ITC_2A_V_3B',
     $p$It is respectfully submitted that, for the period in question, the availment of input tax credit was not conditional on the invoice of the supplier being reflected in FORM GSTR 2A, the condition in section 16(2)(aa) of the Act having come into force only on 1 January 2022, and the only restriction linked to that statement being the limit then prescribed by rule 36(4) of the Rules, where applicable. The conditions of section 16(2) of the Act are satisfied in respect of the credit in question, as the tax invoices are held, the goods or services have been received, the suppliers have been paid and the returns have been furnished. For the differences, reliance is placed on the certificates and documents contemplated by Circular No. 183/15/2022 GST dated 27 December 2022 and Circular No. 193/05/2023 GST dated 17 July 2023, to the extent those circulars apply to the period, which are enclosed. The credit is therefore admissible and no amount is payable on this issue.$p$,
     $p$The difference between the input tax credit availed and the credit reflected in FORM GSTR 2A is accepted to the extent it could not be supported by the documents required for the period. The credit so accepted has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act to the extent the credit was utilised, as set out in this reply.$p$),
    ('RCM_LIAB',
     $p$It is respectfully submitted that the tax payable under reverse charge for the period has been paid in cash, and that input tax credit of that tax has been availed only after its payment and only to the extent of the tax so paid, on the documents prescribed by rule 36 of the Rules. Self invoices raised for supplies received from unregistered persons, and tax paid on the import of services, are not reflected in FORM GSTR 2B by design, and their absence from that statement is therefore no ground to deny the credit. The enclosed statement shows, month by month, the tax paid under reverse charge and the credit availed on it, and that the credit did not exceed the tax paid. No amount is therefore payable on this issue.$p$,
     $p$The liability under reverse charge, or the excess of the credit availed over the tax so paid, is accepted to the extent it remains after the reconciliation. The tax has been paid in cash through FORM GST DRC 03, together with interest under section 50 of the Act, as set out in this reply. Credit of the tax so paid, where admissible, will be availed in accordance with the Act.$p$),
    ('INTEREST_50',
     $p$It is respectfully submitted that the interest demanded is not payable as computed. In terms of the proviso to section 50(1) of the Act, where tax on supplies made in a tax period is declared in the return for that period furnished after the due date, interest is leviable only on the portion of the tax paid by debiting the electronic cash ledger, save where the return is furnished after the commencement of proceedings under section 73 or section 74 of the Act for that period. Under section 50(3) of the Act, interest on input tax credit is leviable only where the credit has been wrongly availed and utilised. The computation on this basis is enclosed.$p$,
     $p$The interest payable under section 50 of the Act on the delayed payment of tax, as computed in the notice or on the reconciliation enclosed, is accepted. The interest has been paid through FORM GST DRC 03, as set out in this reply.$p$),
    ('LATE_FEE_47',
     $p$It is respectfully submitted that the late fee demanded exceeds the amount leviable under section 47 of the Act. The late fee is to be computed for the actual days of delay at the rate notified for the return and period concerned, subject to the maximum notified for the class of turnover of the registered person, and to the lower maximum notified for a return showing nil tax liability, where applicable. Where a notification waiving or restricting the late fee covers the return, the late fee is limited as that notification provides. The computation on this basis is enclosed.$p$,
     $p$The late fee leviable under section 47 of the Act for the delay in furnishing the return, as computed in the notice or on the computation enclosed, is accepted. The late fee has been paid through FORM GST DRC 03, as set out in this reply.$p$),
    ('ITC_16_4',
     $p$It is respectfully submitted that the input tax credit in question was availed within the time allowed by section 16(4) of the Act. As amended by the Finance Act, 2022, that provision permits credit on an invoice or debit note to be availed up to the thirtieth day of November following the end of the financial year to which it pertains, or the date of furnishing the annual return, whichever is earlier, and credit is availed when the return in FORM GSTR 3B claiming it is furnished. Section 16(5) of the Act further entitles a registered person to credit for the financial years 2017/18 to 2020/21 availed in a return furnished up to 30 November 2021, and section 16(6) of the Act protects credit where a cancelled registration is restored on revocation. The enclosed statement shows that the credit in question falls within these provisions.$p$,
     $p$It is accepted that the input tax credit identified in the enclosed statement was availed after the time allowed by section 16(4) of the Act and is not saved by section 16(5) or section 16(6) of the Act. The credit so accepted has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act to the extent the credit was utilised, as set out in this reply.$p$),
    ('ITC_17_5',
     $p$It is respectfully submitted that the input tax credit in question is not blocked by section 17(5) of the Act. Each item of expenditure has been examined against the clause of section 17(5) cited in the notice, and each falls either outside that clause or within an exception that the clause itself provides, for instance where the goods or services are used for making a further taxable supply of the same category, or where the works relate to plant and machinery. The analysis, item by item, is enclosed, and the credit is therefore admissible.$p$,
     $p$It is accepted that the input tax credit on the items identified in the enclosed statement falls within section 17(5) of the Act and is not available. The credit so accepted has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act to the extent the credit was utilised, as set out in this reply.$p$),
    ('ITC_CANCELLED_SUPPLIER',
     $p$It is respectfully submitted that the suppliers in question held valid registrations on the dates of the invoices, and that the conditions of section 16(2) of the Act are satisfied in respect of the credit, as the tax invoices are held, the goods or services have been received, the value with tax has been paid to the suppliers through banking channels and the returns have been furnished. The subsequent cancellation of the registration of a supplier, even with retrospective effect, does not by itself render a genuine transaction void or deny credit to a bona fide recipient who has paid the tax to the supplier. The invoices, proof of receipt, proof of payment and the registration status of the suppliers on the invoice dates are enclosed. The credit is therefore admissible.$p$,
     $p$It is accepted that the input tax credit on the invoices of the suppliers identified in the enclosed statement is not available. The credit so accepted has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act to the extent the credit was utilised, as set out in this reply.$p$),
    ('ITC_NONFILER',
     $p$It is respectfully submitted that the conditions of section 16(2) of the Act are satisfied in respect of the credit in question, as the tax invoices are held, the goods or services have been received, the suppliers have been paid and the returns have been furnished. The failure of a supplier to furnish its returns or to pay the tax collected is a default of the supplier, for which the law provides recovery from the supplier, and a bona fide recipient who has paid the tax to the supplier ought not to be denied credit merely on that account. For the periods to which Circular No. 183/15/2022 GST dated 27 December 2022 and Circular No. 193/05/2023 GST dated 17 July 2023 apply, the certificates contemplated by those circulars are enclosed. The credit is therefore admissible.$p$,
     $p$It is accepted that the input tax credit on the invoices of the non filing suppliers identified in the enclosed statement cannot be supported for the period. The credit so accepted has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act to the extent the credit was utilised, as set out in this reply.$p$),
    ('ITC_RULE_42_43',
     $p$It is respectfully submitted that the common credit attributable to exempt supplies and to non business purposes has been reversed as required by rules 42 and 43 of the Rules. The credit to be reversed has been determined for each tax period, and finally for the financial year, on the actual turnover of taxable and exempt supplies, as those rules require, and the amounts reversed in the returns match that computation. The computation is enclosed, and no further reversal is called for.$p$,
     $p$The shortfall in the reversal of common credit under rules 42 and 43 of the Rules, as recomputed in the enclosed statement on the actual turnover for the financial year, is accepted. The shortfall has been reversed or paid through FORM GST DRC 03, together with interest under section 50 of the Act, as set out in this reply.$p$),
    ('TURNOVER_MISMATCH',
     $p$It is respectfully submitted that the difference between the turnover declared in the returns under the Act and the turnover shown in the income tax return, Form 26AS or the financial statements does not represent any taxable supply on which tax has not been paid. The enclosed statement reconciles the difference item by item, and shows that it arises from receipts that are not supplies or are exempt, such as interest, dividends and the sale of securities, from other income and closing adjustments made in the books, and from differences in the timing of recognition of revenue and of invoicing. As tax under the Act is leviable only on taxable supplies, no tax is payable on the reconciled difference.$p$,
     $p$It is accepted that taxable supplies of the value shown in the enclosed reconciliation were not reported in the returns. The tax on those supplies has been paid through FORM GST DRC 03, together with interest under section 50 of the Act, as set out in this reply.$p$),
    ('GSTR9_V_3B',
     $p$It is respectfully submitted that the differences between the annual return in FORM GSTR 9 and the returns in FORM GSTR 3B for the financial year do not represent any tax unpaid or any credit availed in excess. The enclosed statement reconciles the differences, which arise from items reported in the annual return that were discharged or adjusted in the returns for later months, or that were paid through FORM GST DRC 03 when the annual return was filed, with the particulars of each payment. No further amount is therefore payable on this issue.$p$,
     $p$The differences between the annual return in FORM GSTR 9 and the returns in FORM GSTR 3B for the financial year, to the extent they remain after the reconciliation enclosed, are accepted. The tax so accepted has been paid through FORM GST DRC 03, together with interest under section 50 of the Act, as set out in this reply.$p$),
    ('EWB_V_GSTR1',
     $p$It is respectfully submitted that the e way bills generated during the period do not, by themselves, evidence supplies omitted from FORM GSTR 1. The enclosed reconciliation shows that the difference arises from e way bills generated for movements that are not supplies, such as goods sent for job work, goods returned and transfers within the same registration, from e way bills cancelled or not acted upon, and from differences in timing between the generation of an e way bill and the reporting of the invoice. The remaining e way bills correspond to supplies reported in FORM GSTR 1, on which tax has been paid.$p$,
     $p$It is accepted that supplies covered by the e way bills identified in the enclosed reconciliation were not reported in FORM GSTR 1. The tax on those supplies has been paid through FORM GST DRC 03, together with interest under section 50 of the Act, as set out in this reply.$p$),
    ('RETURN_NOT_FILED',
     $p$It is respectfully submitted that no return was pending as alleged. The return referred to in the notice has either been furnished, as shown by the acknowledgement enclosed, or was not required to be furnished for the period, for the reason stated in this reply. The proceedings founded on the alleged default ought therefore to be dropped.$p$,
     $p$It is accepted that the return referred to in the notice was not furnished by the due date. The return has since been furnished, together with the late fee payable under section 47 of the Act and interest under section 50 of the Act on the tax paid late, as set out in this reply.$p$),
    ('REGISTRATION_QUERY',
     $p$It is respectfully submitted that each point raised in the notice is answered by the facts stated in this reply and by the documents enclosed, which establish the particulars declared, including the principal place of business, the constitution of the business and the identity of the persons in charge of it. The particulars so declared are correct, and there is therefore no ground for the action proposed in the notice.$p$,
     $p$The deficiency pointed out in the notice is accepted, and it has since been made good, as set out in this reply, by furnishing the documents and particulars called for and by taking the steps required to regularise the registration. It is requested that the matter be closed on that basis.$p$),
    ('REFUND_DEFICIENCY',
     $p$It is respectfully submitted that the refund claimed is admissible in full, and that each ground stated for its rejection is answered by the statements, declarations and documents enclosed, which are those prescribed by rule 89 of the Rules for the category of refund claimed. The refund has been computed in accordance with rule 89 of the Rules, and the claim was filed within the period prescribed by section 54(1) of the Act. The grounds stated for the proposed rejection therefore do not survive, and the refund ought to be sanctioned.$p$,
     $p$It is accepted that the part of the claim identified in the enclosed statement is not admissible, and the claim is not pressed to that extent. It is requested that the balance of the claim be sanctioned, and that the amount debited for the part not pressed be recredited in accordance with rule 93 of the Rules.$p$),
    ('PROCEDURE_OBJECTION',
     $p$It is respectfully submitted that the proceedings suffer from the following procedural defects, which go to the root of the matter and are raised at the threshold, without prejudice to the submissions on the merits: [each objection that applies, such as the bar of limitation under section 73, section 74 or section 74A of the Act, the absence of a Document Identification Number, lack of jurisdiction, the absence of any specific allegation of fraud, wilful misstatement or suppression of facts where section 74 of the Act is invoked, or the denial of a personal hearing under section 75(4) of the Act]. A demand that is barred by limitation, or is raised without jurisdiction or in breach of the principles of natural justice, cannot be sustained whatever its merits. Further, under section 75(7) of the Act, no demand can be confirmed in excess of the amount specified in the notice or on grounds other than those specified in it. The proceedings ought therefore to be dropped on these grounds alone.$p$,
     $p$The procedural objections available in the matter are not pressed, in view of the acceptance and payment set out in this reply. The acceptance is made to buy peace and to avoid litigation, and is not an admission of any allegation in the notice beyond the liability so accepted.$p$),
    ('OTHER',
     $p$It is respectfully submitted that the proposal on this issue is not sustainable on facts or in law, for the following reasons: [facts and grounds on which the issue is contested]. The documents in support are enclosed, and the proposal on this issue ought therefore to be dropped.$p$,
     $p$The amount proposed on this issue is accepted. The tax so accepted has been paid through FORM GST DRC 03, together with interest under section 50 of the Act where payable, as set out in this reply.$p$)
  ) AS v (code, para_contest, para_accept)
 WHERE t.code = v.code
   AND (t.para_contest IS NULL OR t.para_accept IS NULL);

-- ── 2. Templates: two to five per form that needs a reply, three general ones ──
-- One statement: its statement trigger prepares every open notice's options once.
INSERT INTO public.reply_templates (key, title, summary, stance, forms, sort, body) VALUES
-- asmt10_explain: ASMT-10
('asmt10_explain', $t$Explanation of every discrepancy$t$,
 $t$Use when every discrepancy in the scrutiny notice can be explained and no tax is short paid.$t$,
 'explain', '{ASMT-10}', 10,
$t$To,
The {{officer}}

Subject: Reply in FORM GST ASMT 11 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 61 of the Act read with rule 99 of the Rules, by which the discrepancies noticed on scrutiny of the returns of the noticee for {{period_text}} have been communicated and its explanation has been sought.

3. The noticee has examined each discrepancy with reference to its books of account and the returns furnished for the period. It submits that each discrepancy is explained by the facts and the reconciliation set out below, and that no tax, interest or other amount is short paid on account of it. This explanation is furnished in FORM GST ASMT 11 under rule 99(2) of the Rules.

4. The explanation of the noticee on each discrepancy is as follows:

{{issues_contest_paras}}

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. Section 61(2) of the Act provides that where the explanation is found acceptable, the registered person shall be informed accordingly and no further action shall be taken in the matter. In view of the foregoing, it is respectfully prayed that:
(a) the explanation furnished in this reply be accepted;
(b) the noticee be informed in FORM GST ASMT 12 under rule 99(3) of the Rules that the explanation has been found acceptable and that no further action is called for; and
(c) should any point require further clarification, the noticee be informed and given an opportunity to furnish it, or to be heard, before any action is initiated under section 61(3) of the Act.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- asmt10_accept_pay: ASMT-10
('asmt10_accept_pay', $t$Acceptance of the discrepancies with payment$t$,
 $t$Use when the discrepancies are accepted and the tax, interest and other dues arising from them have been paid through FORM GST DRC 03.$t$,
 'accept_pay', '{ASMT-10}', 20,
$t$To,
The {{officer}}

Subject: Reply in FORM GST ASMT 11 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 61 of the Act read with rule 99 of the Rules, by which the discrepancies noticed on scrutiny of the returns of the noticee for {{period_text}} have been communicated and its explanation has been sought.

3. The noticee has examined the discrepancies with reference to its books of account and the returns furnished for the period and, in terms of rule 99(2) of the Rules, accepts them to the extent set out below. Its position on each discrepancy is as follows:

{{issues_accept_paras}}

4. The tax, interest and other amounts arising from the discrepancies so accepted have been paid {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Other amounts, if any: Rs. [other amount paid]

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, the noticee has paid the tax, interest and other amounts arising from the discrepancies, as contemplated by rule 99(2) of the Rules. It is therefore respectfully prayed that:
(a) the acceptance of the discrepancies and the payment made be taken on record;
(b) the noticee be informed in FORM GST ASMT 12 under rule 99(3) of the Rules that no further action is called for in the matter; and
(c) no further proceedings be initiated in respect of the discrepancies so accepted and paid.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- asmt10_partial: ASMT-10
('asmt10_partial', $t$Part explanation and part payment$t$,
 $t$Use when some discrepancies are explained and the rest are accepted and paid through FORM GST DRC 03.$t$,
 'partial', '{ASMT-10}', 30,
$t$To,
The {{officer}}

Subject: Reply in FORM GST ASMT 11 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 61 of the Act read with rule 99 of the Rules, by which the discrepancies noticed on scrutiny of the returns of the noticee for {{period_text}} have been communicated and its explanation has been sought.

3. The noticee has examined each discrepancy with reference to its books of account and the returns furnished for the period. Some of the discrepancies are explained by the facts set out below; the others are accepted, and the amounts arising from them have been paid. This reply is furnished in FORM GST ASMT 11 under rule 99(2) of the Rules.

4. Discrepancies accepted. The noticee accepts the following discrepancies: [identify each discrepancy accepted, with its amount]. The tax, interest and other amounts arising from them have been paid {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]

5. Discrepancies explained. The explanation of the noticee on the remaining discrepancies is as follows:

{{issues_contest_paras}}

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) the explanation on the discrepancies explained be accepted, and the payment made on the discrepancies accepted be taken on record;
(b) the noticee be informed in FORM GST ASMT 12 under rule 99(3) of the Rules that no further action is called for in the matter; and
(c) should any point require further clarification, the noticee be informed and given an opportunity to furnish it, or to be heard, before any action is initiated under section 61(3) of the Act.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- asmt10_time: ASMT-10
('asmt10_time', $t$Request for more time to reply$t$,
 $t$Use when the explanation cannot be completed within the time allowed and further time is needed.$t$,
 'adjournment', '{ASMT-10}', 40,
$t$To,
The {{officer}}

Subject: Request for further time to reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 61 of the Act read with rule 99 of the Rules, by which the discrepancies noticed on scrutiny of its returns for {{period_text}} have been communicated and its explanation has been sought by {{reply_due_long}}.

3. To furnish a complete explanation, the noticee is reconciling the figures in the notice with its books of account and returns and is collecting the supporting records. This work could not be completed within the time allowed for the following reason: [reason for which further time is needed].

4. Rule 99(1) of the Rules permits the explanation to be furnished within thirty days of the service of the notice or within such further period as the Proper Officer may permit. The noticee therefore requests that it be permitted to furnish its explanation in FORM GST ASMT 11 within a further period of [number of days] days, that is, on or before [date up to which time is sought].

5. The noticee assures your goodself of its full cooperation and undertakes to furnish its explanation within the period so permitted. It is prayed that the request be granted and that no action under section 61(3) of the Act be initiated in the meantime.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01a_contest: DRC-01A
('drc01a_contest', $t$Submissions disputing the ascertained amount$t$,
 $t$Use to dispute the tax ascertained in Part A of FORM GST DRC 01A, so that no show cause notice is issued.$t$,
 'contest', '{DRC-01A}', 10,
$t$To,
The {{officer}}

Subject: Submissions in Part B on the intimation in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in these submissions to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 142(1A) of the Rules, by which the tax, interest and penalty ascertained with reference to {{section_text}} for {{period_text}} have been communicated to the noticee, namely {{demand_heads_text}}.

3. In terms of rule 142(2A) of the Rules, the noticee files these submissions in Part B of FORM GST DRC 01A against the liability so ascertained. The noticee does not accept the amount ascertained, for the reasons set out below.

4. The submissions of the noticee on each issue are as follows:

{{issues_contest_paras}}

5. Without prejudice to the above, as no tax is short paid, the question of interest under section 50 of the Act or of any penalty does not arise.

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of these submissions:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) these submissions be accepted and the liability ascertained in the intimation be treated as fully explained;
(b) no show cause notice be issued under {{section_short}} of the Act, or otherwise, in respect of the matters covered by the intimation; and
(c) should any point require further explanation, the noticee be informed and given an opportunity of being heard before any show cause notice is issued.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01a_pay: DRC-01A
('drc01a_pay', $t$Full payment and request not to issue a show cause notice$t$,
 $t$Use when the ascertained amount is accepted and paid in full through FORM GST DRC 03 before any show cause notice is issued.$t$,
 'accept_pay', '{DRC-01A}', 20,
$t$To,
The {{officer}}

Subject: Payment of the amount ascertained in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 142(1A) of the Rules, by which the tax, interest and penalty ascertained with reference to {{section_text}} for {{period_text}} have been communicated to the noticee, namely {{demand_heads_text}}.

3. The noticee has examined the intimation and accepts the liability for {{demand_total_text}} ascertained in it. Its position on each issue is as follows:

{{issues_accept_paras}}

4. The noticee has paid the amount so ascertained in full {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Penalty, if any: Rs. [amount of penalty paid]

5. Under sections 73(5) and 73(6) of the Act, and the corresponding provisions of section 74 and section 74A of the Act, where the tax is paid with interest under section 50 of the Act, and with penalty where the provision so requires, before the service of a show cause notice, and the Proper Officer is informed of the payment, no notice is to be served in respect of the tax so paid. The noticee accordingly informs your goodself of the payment in terms of rule 142(2) of the Rules.

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this letter:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) the payment be taken on record and acknowledged in FORM GST DRC 04 under rule 142(2) of the Rules;
(b) no show cause notice be served on the noticee in respect of the tax so paid or any penalty in relation to it; and
(c) the proceedings initiated by the intimation be treated as closed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01a_partial: DRC-01A
('drc01a_partial', $t$Part payment and submissions on the balance$t$,
 $t$Use when part of the ascertained amount is accepted and paid and the balance is disputed in Part B.$t$,
 'partial', '{DRC-01A}', 30,
$t$To,
The {{officer}}

Subject: Submissions in Part B on the intimation in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in these submissions to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 142(1A) of the Rules, by which the tax, interest and penalty ascertained with reference to {{section_text}} for {{period_text}} have been communicated to the noticee, namely {{demand_heads_text}}.

3. Rule 142(2A) of the Rules permits a person who has paid a part of the amount communicated, or who wishes to file submissions against the proposed liability, to make submissions in Part B of FORM GST DRC 01A. The noticee accordingly makes these submissions.

4. Part accepted and paid. The noticee accepts the following part of the liability ascertained: [identify each item accepted, with its amount]. The amount so accepted has been paid {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Penalty, if any: Rs. [amount of penalty paid]

5. Balance disputed. The noticee does not accept the balance of the liability ascertained, for the reasons set out below:

{{issues_contest_paras}}

6. Without prejudice to the above, as no tax is short paid on the balance, the question of interest or penalty on it does not arise.

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of these submissions:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) the payment of the part accepted be taken on record and acknowledged in FORM GST DRC 04 under rule 142(2) of the Rules;
(b) the submissions on the balance be accepted;
(c) no show cause notice be issued in respect of the tax so paid or of the balance disputed; and
(d) should any point require further explanation, the noticee be given an opportunity of being heard before any show cause notice is issued.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01_contest: DRC-01
('drc01_contest', $t$Reply contesting the demand in full$t$,
 $t$Use to contest every proposal in the show cause notice and to ask for a personal hearing.$t$,
 'contest', '{DRC-01}', 10,
$t$To,
The {{officer}}

Subject: Reply in FORM GST DRC 06 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice", which includes the show cause notice and its annexures){{din_clause}} issued under {{section_text}} for {{period_text}}. By the notice, the noticee has been called upon to show cause why {{demand_heads_text}} should not be demanded and recovered from it.

3. The noticee denies the liability for {{demand_total_text}} in its entirety. Every allegation in the notice is denied, save to the extent expressly admitted in this reply, and nothing in the notice shall be deemed to be admitted merely because it is not specifically traversed. This reply is furnished in FORM GST DRC 06 under rule 142(4) of the Rules.

4. The submissions of the noticee on each issue raised in the notice are as follows. They are made in the alternative and without prejudice to one another.

{{issues_contest_paras}}

5. Without prejudice to the above, as no tax is payable, no interest under section 50 of the Act can be demanded, interest being compensatory and consequential upon a liability to tax. For the same reason, and as there is no contravention of the provisions of the Act or the Rules, no penalty is imposable.

6. The noticee requests that it be heard in person under section 75(4) of the Act before the matter is decided. {{hearing_clause}} The noticee craves leave to add to, alter or amend these submissions and to produce further documents at or before the hearing.

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) this reply be taken on record and the submissions made in it be accepted;
(b) the proposals in the notice to demand tax, interest and penalty be dropped in their entirety and the proceedings be concluded;
(c) the noticee be heard in person under section 75(4) of the Act before any order is passed; and
(d) such other order be passed as may be deemed fit in the facts and circumstances of the case.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01_partial: DRC-01
('drc01_partial', $t$Part acceptance with payment and contest of the balance$t$,
 $t$Use when part of the demand is accepted and paid through FORM GST DRC 03 and the rest is contested.$t$,
 'partial', '{DRC-01}', 20,
$t$To,
The {{officer}}

Subject: Reply in FORM GST DRC 06 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice", which includes the show cause notice and its annexures){{din_clause}} issued under {{section_text}} for {{period_text}}. By the notice, the noticee has been called upon to show cause why {{demand_heads_text}} should not be demanded and recovered from it.

3. This reply is furnished in FORM GST DRC 06 under rule 142(4) of the Rules. The noticee accepts a part of the proposals in the notice, which it has paid, and contests the balance, as set out below.

4. Part accepted and paid. The noticee accepts the following part of the proposals in the notice: [identify each item accepted, with its amount]. The tax so accepted has been paid together with interest under section 50 of the Act {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Penalty, if any: Rs. [amount of penalty paid]
The noticee requests that the payment be appropriated against the part of the demand so accepted.

5. Balance contested. The noticee denies the balance of the proposals in the notice, and its submissions on each issue are as follows:

{{issues_contest_paras}}

6. Without prejudice to the above, as no tax is payable on the balance, no interest under section 50 of the Act or penalty arises on it. As regards the part accepted, the tax has been paid with interest, and the noticee prays that no penalty, beyond such penalty, if any, as has been paid along with it, be imposed in respect of that part.

7. The noticee requests that it be heard in person under section 75(4) of the Act before the matter is decided. {{hearing_clause}} The noticee craves leave to add to, alter or amend these submissions and to produce further documents at or before the hearing.

8. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

9. In view of the foregoing, it is respectfully prayed that:
(a) the payment made be taken on record and appropriated against the part of the demand accepted;
(b) the proposals in respect of the balance be dropped;
(c) no penalty, beyond that, if any, paid along with the tax, be imposed in respect of the part accepted;
(d) the noticee be heard in person under section 75(4) of the Act before any order is passed; and
(e) such other order be passed as may be deemed fit in the facts and circumstances of the case.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01_pay_conclude: DRC-01
('drc01_pay_conclude', $t$Payment and request to conclude the proceedings$t$,
 $t$Use when the tax with interest, and any penalty the section invoked requires, has been paid within the period that concludes the proceedings.$t$,
 'accept_pay', '{DRC-01}', 30,
$t$To,
The {{officer}}

Subject: Intimation of payment against {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}, and request to conclude the proceedings

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice", which includes the show cause notice and its annexures){{din_clause}} issued under {{section_text}} for {{period_text}}. By the notice, the noticee has been called upon to show cause why {{demand_heads_text}} should not be demanded and recovered from it.

3. Without admitting the allegations in the notice beyond the liability to tax so accepted, and to buy peace and avoid protracted litigation, the noticee has decided not to contest the notice. Its position on each issue is as follows:

{{issues_accept_paras}}

4. The noticee has paid the tax demanded in the notice, together with interest under section 50 of the Act and the penalty, if any, payable on such payment under the provisions of the Act governing a notice issued under {{section_short}} of the Act, {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Penalty, if any: Rs. [amount of penalty paid], being [percentage] per cent of the tax

5. Under the provisions of the Act applicable to a notice issued under {{section_short}} of the Act, where the person chargeable with tax pays the tax with interest under section 50 of the Act, and the penalty where that provision so requires, within the period specified in it, all proceedings in respect of the notice are deemed to be concluded. The payment set out above has been made within that period. In terms of rule 142(3) of the Rules, the noticee intimates the payment made through FORM GST DRC 03 and requests that an order concluding the proceedings be issued in FORM GST DRC 05.

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this letter:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) the payment be taken on record;
(b) the proceedings initiated by the notice be treated as concluded and an order in FORM GST DRC 05 be issued under rule 142(3) of the Rules; and
(c) no further penalty be imposed, and no further proceedings be taken, in respect of the matters covered by the notice.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01_documents: DRC-01
('drc01_documents', $t$Request for documents relied upon$t$,
 $t$Use when the notice relies on documents, statements or data not supplied with it, before replying on the merits.$t$,
 'documents', '{DRC-01}', 40,
$t$To,
The {{officer}}

Subject: Request for copies of the documents relied upon in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice", which includes the show cause notice and its annexures){{din_clause}} issued under {{section_text}} for {{period_text}}. By the notice, the noticee has been called upon to show cause why {{demand_heads_text}} should not be demanded and recovered from it.

3. On a perusal of the notice, the noticee finds that the proposals in it are founded on documents, data and statements that have not been supplied with it, namely [description of each document, statement or data relied upon in the notice but not supplied].

4. It is a settled principle of natural justice that a person called upon to show cause must be furnished with the material relied upon in the notice, so as to be able to meet it effectively. Without the documents relied upon, the noticee is unable to file a complete reply on the merits in FORM GST DRC 06, and the opportunity of being heard contemplated by section 75(4) of the Act would be rendered illusory.

5. The noticee therefore requests that copies of the said documents relied upon be supplied to it, and that the time for filing its reply be reckoned from the date on which they are supplied. The noticee reserves its right to file a detailed reply on the merits on receipt of the documents.

6. This request is made without prejudice to the contentions of the noticee on the merits and on the validity of the notice, all of which are expressly reserved.

7. In view of the foregoing, it is respectfully prayed that:
(a) copies of the documents relied upon in the notice, as listed above, be supplied to the noticee;
(b) the noticee be allowed [number of days] days from the date of their receipt to file its reply in FORM GST DRC 06; and
(c) no order be passed in the matter before the reply is filed and the noticee is heard under section 75(4) of the Act.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01_adjournment: DRC-01
('drc01_adjournment', $t$Request for adjournment or more time$t$,
 $t$Use to seek more time to file the reply or to adjourn the personal hearing; the Act allows at most three adjournments.$t$,
 'adjournment', '{DRC-01}', 50,
$t$To,
The {{officer}}

Subject: Request for further time and adjournment in the matter of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under {{section_text}} for {{period_text}}. The notice requires the noticee to file its reply by {{reply_due_long}}. {{hearing_clause}}

3. The noticee is compiling the reconciliations and documents required for a complete reply to the issues raised in the notice, and requires further time for the following reason: [reason for which further time or an adjournment is needed].

4. Section 75(5) of the Act empowers the Proper Officer, where sufficient cause is shown, to grant time to the person chargeable with tax and to adjourn the hearing for reasons to be recorded in writing, provided that no adjournment is granted more than three times to a person during the proceedings. The noticee submits that the reason stated above constitutes sufficient cause, and that this is its [first, second or third] request for time in these proceedings.

5. The noticee therefore requests that it be granted time up to [date up to which time is sought] to file its reply in FORM GST DRC 06, and that the personal hearing, where one has been fixed, be adjourned to a date after that date convenient to your goodself.

6. The noticee assures its full cooperation in the proceedings. This request is made without prejudice to its rights and contentions, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01b_explain: DRC-01B
('drc01b_explain', $t$Explanation of the difference$t$,
 $t$Use when the difference between the tax in GSTR 1 and GSTR 3B is explained and no tax is short paid.$t$,
 'explain', '{DRC-01B}', 10,
$t$To,
The {{officer}}

Subject: Reply in Part B of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 88C(1) of the Rules for {{period_text}}. The intimation states that the tax payable according to the statement of outward supplies furnished in FORM GSTR 1, or through the invoice furnishing facility, exceeds the tax payable according to the return furnished in FORM GSTR 3B, and directs the noticee either to pay the difference with interest through FORM GST DRC 03 or to explain it.

3. In terms of rule 88C(2) of the Rules, the noticee furnishes in Part B of FORM GST DRC 01B the reasons for the difference. The difference does not represent any tax short paid, and arises as follows:
(a) [reason for the difference, such as tax on supplies reported in FORM GSTR 1 for the period but paid with the return for a later tax period, supplies reported in FORM GSTR 1 in error and since amended, or credit notes and advances adjusted in a later period]: Rs. [amount]
(b) [further reason, if any]: Rs. [amount]

4. The submissions of the noticee on the difference are as follows:

{{issues_contest_paras}}

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, the difference stands explained and no amount remains payable in respect of it. It is respectfully prayed that the explanation be accepted, that no amount be treated as recoverable under rule 88C(3) of the Rules, and that the noticee be given an opportunity of being heard before any adverse view is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01b_pay: DRC-01B
('drc01b_pay', $t$Payment of the difference through FORM GST DRC 03$t$,
 $t$Use when the difference is accepted and the tax with interest has been paid through FORM GST DRC 03.$t$,
 'accept_pay', '{DRC-01B}', 20,
$t$To,
The {{officer}}

Subject: Reply in Part B of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 88C(1) of the Rules for {{period_text}}. The intimation states that the tax payable according to the statement of outward supplies furnished in FORM GSTR 1, or through the invoice furnishing facility, exceeds the tax payable according to the return furnished in FORM GSTR 3B, and directs the noticee either to pay the difference with interest through FORM GST DRC 03 or to explain it.

3. The noticee has examined the difference and accepts it. In terms of rule 88C(2) of the Rules, the noticee has paid the differential tax together with interest under section 50 of the Act {{payment_clause}}, and furnishes the particulars in Part B of FORM GST DRC 01B as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]

4. The position of the noticee on the difference is as follows:

{{issues_accept_paras}}

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, the amount specified in the intimation stands paid. It is respectfully prayed that the payment be taken on record and that the matter be treated as closed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01b_partial: DRC-01B
('drc01b_partial', $t$Part explanation and part payment$t$,
 $t$Use when part of the difference is paid through FORM GST DRC 03 and the rest is explained.$t$,
 'partial', '{DRC-01B}', 30,
$t$To,
The {{officer}}

Subject: Reply in Part B of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 88C(1) of the Rules for {{period_text}}. The intimation states that the tax payable according to the statement of outward supplies furnished in FORM GSTR 1, or through the invoice furnishing facility, exceeds the tax payable according to the return furnished in FORM GSTR 3B, and directs the noticee either to pay the difference with interest through FORM GST DRC 03 or to explain it.

3. In terms of rule 88C(2) of the Rules, the noticee has paid a part of the difference and furnishes in Part B of FORM GST DRC 01B its reasons for the part that remains unpaid.

4. Part paid. The noticee accepts the difference to the extent of Rs. [amount accepted] and has paid it together with interest under section 50 of the Act {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]

5. Part explained. The remaining difference of Rs. [amount explained] does not represent any tax short paid, and arises as follows:
(a) [reason for the difference, such as tax on supplies reported in FORM GSTR 1 for the period but paid with the return for a later tax period, supplies reported in FORM GSTR 1 in error and since amended, or credit notes and advances adjusted in a later period]: Rs. [amount]
(b) [further reason, if any]: Rs. [amount]

6. The submissions of the noticee on the remaining difference are as follows:

{{issues_contest_paras}}

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that the payment be taken on record, that the explanation for the remaining difference be accepted, that no amount be treated as recoverable under rule 88C(3) of the Rules, and that the noticee be given an opportunity of being heard before any adverse view is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01c_explain: DRC-01C
('drc01c_explain', $t$Explanation of the difference in input tax credit$t$,
 $t$Use when the excess of the credit in GSTR 3B over GSTR 2B is explained and no credit was availed in excess.$t$,
 'explain', '{DRC-01C}', 10,
$t$To,
The {{officer}}

Subject: Reply in Part B of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 88D(1) of the Rules for {{period_text}}. The intimation states that the input tax credit availed in the return furnished in FORM GSTR 3B exceeds the input tax credit available in the statement in FORM GSTR 2B, and directs the noticee either to pay an amount equal to the excess with interest through FORM GST DRC 03 or to explain the difference.

3. In terms of rule 88D(2) of the Rules, the noticee furnishes in Part B of FORM GST DRC 01C the reasons for the difference. The credit availed does not exceed the entitlement of the noticee, and the difference arises as follows:
(a) [reason for the difference, such as credit on invoices reflected in FORM GSTR 2B of a later tax period, credit reversed earlier and reclaimed, or credit not reflected in FORM GSTR 2B by its nature, such as tax paid on self invoices for supplies from unregistered persons]: Rs. [amount]
(b) [further reason, if any]: Rs. [amount]

4. The submissions of the noticee on the difference are as follows:

{{issues_contest_paras}}

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, the difference stands explained and no amount remains payable in respect of it. It is respectfully prayed that the explanation be accepted, that no proceedings be initiated under rule 88D(3) of the Rules in respect of the difference, and that the noticee be given an opportunity of being heard before any adverse view is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01c_reverse_pay: DRC-01C
('drc01c_reverse_pay', $t$Reversal or payment of the excess credit$t$,
 $t$Use when the excess credit has been reversed in a return or paid through FORM GST DRC 03, with interest where due.$t$,
 'accept_pay', '{DRC-01C}', 20,
$t$To,
The {{officer}}

Subject: Reply in Part B of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 88D(1) of the Rules for {{period_text}}. The intimation states that the input tax credit availed in the return furnished in FORM GSTR 3B exceeds the input tax credit available in the statement in FORM GSTR 2B, and directs the noticee either to pay an amount equal to the excess with interest through FORM GST DRC 03 or to explain the difference.

3. The noticee has examined the difference and accepts it. In terms of rule 88D(2) of the Rules, it has discharged an amount equal to the excess input tax credit, together with interest under section 50 of the Act to the extent the credit was utilised, and furnishes the particulars in Part B of FORM GST DRC 01C as under:
Amount equal to the excess credit: Rs. [amount]
Interest under section 50 of the Act: Rs. [amount of interest paid, if any]
Manner of discharge: [ARN of FORM GST DRC 03 and date of payment, or the return in FORM GSTR 3B for the tax period in which the credit was reversed]

4. The position of the noticee on the difference is as follows:

{{issues_accept_paras}}

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, the excess credit pointed out in the intimation stands discharged. It is respectfully prayed that the particulars be taken on record and that the matter be treated as closed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc01c_partial: DRC-01C
('drc01c_partial', $t$Part explanation and part reversal or payment$t$,
 $t$Use when part of the excess credit is reversed or paid and the rest is explained.$t$,
 'partial', '{DRC-01C}', 30,
$t$To,
The {{officer}}

Subject: Reply in Part B of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the intimation in Part A of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the intimation"){{din_clause}} issued under rule 88D(1) of the Rules for {{period_text}}. The intimation states that the input tax credit availed in the return furnished in FORM GSTR 3B exceeds the input tax credit available in the statement in FORM GSTR 2B, and directs the noticee either to pay an amount equal to the excess with interest through FORM GST DRC 03 or to explain the difference.

3. In terms of rule 88D(2) of the Rules, the noticee has discharged a part of the difference and furnishes in Part B of FORM GST DRC 01C its reasons for the part that remains.

4. Part discharged. The noticee accepts the difference to the extent of Rs. [amount accepted] and has discharged an amount equal to it, together with interest under section 50 of the Act to the extent the credit was utilised, as under:
Amount equal to the excess credit accepted: Rs. [amount]
Interest under section 50 of the Act: Rs. [amount of interest paid, if any]
Manner of discharge: [ARN of FORM GST DRC 03 and date of payment, or the return in FORM GSTR 3B for the tax period in which the credit was reversed]

5. Part explained. The remaining difference of Rs. [amount explained] does not represent any credit availed in excess, and arises as follows:
(a) [reason for the difference, such as credit on invoices reflected in FORM GSTR 2B of a later tax period, credit reversed earlier and reclaimed, or credit not reflected in FORM GSTR 2B by its nature, such as tax paid on self invoices for supplies from unregistered persons]: Rs. [amount]
(b) [further reason, if any]: Rs. [amount]

6. The submissions of the noticee on the remaining difference are as follows:

{{issues_contest_paras}}

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that the particulars of the amount discharged be taken on record, that the explanation for the remaining difference be accepted, that no proceedings be initiated under rule 88D(3) of the Rules in respect of it, and that the noticee be given an opportunity of being heard before any adverse view is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- gstr3a_filed: GSTR-3A
('gstr3a_filed', $t$Intimation that the return has since been furnished$t$,
 $t$Use when the return named in the notice has been filed, to ask that the proceedings be dropped.$t$,
 'complied', '{GSTR-3A}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 46 of the Act read with rule 68 of the Rules, requiring the noticee to furnish the return for {{period_text}} within fifteen days, failing which its tax liability may be assessed under section 62 of the Act.

3. The noticee respectfully informs your goodself that the return referred to in the notice has since been furnished, together with the late fee payable under section 47 of the Act and the interest payable under section 50 of the Act, as under:
Return and tax period: [return and tax period]
ARN of the return: [ARN of the return] dated [date of filing]
Late fee paid: Rs. [amount of late fee paid]
Interest paid: Rs. [amount of interest paid, if any]

4. The delay in furnishing the return was caused by [reason for the delay], and was not deliberate. The default stated in the notice having been made good, the occasion for an assessment under section 62 of the Act does not arise.

5. The following documents are enclosed:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) the return furnished be taken on record;
(b) the proceedings initiated by the notice be dropped; and
(c) no assessment be made under section 62 of the Act in respect of the period.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- gstr3a_not_due: GSTR-3A
('gstr3a_not_due', $t$Reply that the return was not due$t$,
 $t$Use when the return was filed before the notice, or was not required of the noticee for the period.$t$,
 'explain', '{GSTR-3A}', 20,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 46 of the Act read with rule 68 of the Rules, requiring the noticee to furnish the return for {{period_text}} within fifteen days, failing which its tax liability may be assessed under section 62 of the Act.

3. The noticee respectfully submits that the notice has been issued in error, as no return was pending from it on the date of the notice, for the following reason: [reason, such as the return having been furnished before the notice, with its ARN and date, the noticee having paid tax under the composition levy for the period, the registration having been cancelled with effect from a date before the period, or the annual return not being required of the noticee for the financial year under an exemption notified under section 44 of the Act].

4. Section 46 of the Act, read with rule 68 of the Rules, applies only where a registered person fails to furnish a return that it is required to furnish. As no such return was pending, the notice may be withdrawn, and no assessment under section 62 of the Act arises.

5. The following documents are enclosed:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that the notice be withdrawn and the proceedings initiated by it be dropped.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- gstr3a_time: GSTR-3A
('gstr3a_time', $t$Request for time to furnish the return$t$,
 $t$Use when the return cannot be filed within the fifteen days allowed and a short extension is sought.$t$,
 'adjournment', '{GSTR-3A}', 30,
$t$To,
The {{officer}}

Subject: Request for time to comply with {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 46 of the Act read with rule 68 of the Rules, requiring the noticee to furnish the return for {{period_text}} within fifteen days, failing which its tax liability may be assessed under section 62 of the Act.

3. The noticee is unable to furnish the return within the time allowed for the following reason: [reason for the delay, such as the reconciliation of the books of account or a difficulty on the common portal].

4. The noticee undertakes to furnish the return, with the late fee payable under section 47 of the Act and the interest payable under section 50 of the Act, on or before [date by which the return will be furnished]. It requests that it be allowed time till then, and that no assessment under section 62 of the Act be made in the meantime.

5. The noticee assures your goodself that the delay is not deliberate and that it will comply within the time requested.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- asmt14_contest: ASMT-14
('asmt14_contest', $t$Reply contesting the proposed assessment$t$,
 $t$Use to oppose a best judgment assessment under section 63, for example where no registration was required or the tax was paid.$t$,
 'contest', '{ASMT-14}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}}, holding GSTIN {{gstin}} (hereinafter referred to as "the noticee"), submits this reply under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 63 of the Act read with rule 100(2) of the Rules, by which it has been called upon to show cause why its tax liability for {{period_text}} should not be assessed to the best of the judgment of the Proper Officer. The notice proposes {{demand_heads_text}}.

3. The noticee denies that section 63 of the Act is attracted. That section permits a best judgment assessment only of a taxable person who fails to obtain registration although liable to do so, or whose registration has been cancelled under section 29(2) of the Act but who was liable to pay tax. Neither condition is satisfied in the present case, because [facts showing that the noticee was not liable to be registered, held a valid registration, or has paid the tax for the period].

4. Without prejudice to the above, an assessment to the best of judgment must rest on relevant material and cannot be arbitrary. The turnover and tax proposed in the notice are not supported by the material on record, and the submissions of the noticee on the matters raised are as follows:

{{issues_contest_paras}}

5. The noticee requests an opportunity of being heard before any order in FORM GST ASMT 15 is passed, in accordance with section 63 of the Act and the principles of natural justice. {{hearing_clause}}

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) this reply be accepted;
(b) the proposed assessment under section 63 of the Act be dropped; and
(c) the noticee be heard before any order is passed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- asmt14_time: ASMT-14
('asmt14_time', $t$Request for time to reply$t$,
 $t$Use when the reply to the proposed best judgment assessment needs more than the fifteen days allowed.$t$,
 'adjournment', '{ASMT-14}', 20,
$t$To,
The {{officer}}

Subject: Request for further time to reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}}, holding GSTIN {{gstin}} (hereinafter referred to as "the noticee"), submits this letter under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 63 of the Act read with rule 100(2) of the Rules, by which it has been called upon to show cause why its tax liability for {{period_text}} should not be assessed to the best of the judgment of the Proper Officer. The notice proposes {{demand_heads_text}}.

3. The notice requires the noticee to reply by {{reply_due_long}}. The noticee intends to show cause against the proposed assessment, but requires further time to compile its records and reply, for the following reason: [reason for which further time is needed].

4. The noticee therefore requests that it be allowed time up to [date up to which time is sought] to file its reply, and that no order in FORM GST ASMT 15 be passed before the reply is considered and the noticee is heard. {{hearing_clause}}

5. The noticee assures your goodself of its full cooperation. This request is made without prejudice to its rights and contentions, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg17_show_cause: REG-17, REG-SCN
('reg17_show_cause', $t$Reply showing cause against cancellation$t$,
 $t$Use when the business is running and the ground for cancellation can be answered, or the default has been made good.$t$,
 'contest', '{REG-17,REG-SCN}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} by which it has been called upon to show cause why its registration should not be cancelled under section 29(2) of the Act, on the grounds stated therein.

3. The noticee respectfully submits that no ground for cancellation under section 29(2) of the Act exists in its case, and that its registration ought not to be cancelled, for the following reasons:
(a) The noticee carries on its business at its principal place of business at [address of the principal place of business], as declared in its registration, and the business continues to operate.
(b) [Reply to the ground stated in the notice, for example that all returns due have been furnished, with their ARNs, or that the documents called for are furnished with this reply.]
(c) [Any further fact in support.]

4. The submissions of the noticee on the matters raised are as follows:

{{issues_contest_paras}}

5. To the extent the notice is founded on a failure to furnish returns, the noticee has furnished all the pending returns and paid the tax due on them with interest and late fee, as shown in the enclosed statement. In such a case, the proviso to rule 22(4) of the Rules requires the Proper Officer to drop the proceedings and pass an order in FORM GST REG 20.

6. The first proviso to section 29(2) of the Act mandates that the registration shall not be cancelled without giving the person an opportunity of being heard. The noticee requests a personal hearing before any decision is taken. {{hearing_clause}} If the registration has been suspended under rule 21A of the Rules pending these proceedings, the noticee requests that the suspension be revoked.

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) this reply be accepted;
(b) the proceedings for cancellation be dropped by an order in FORM GST REG 20;
(c) any suspension of the registration be revoked; and
(d) the noticee be heard before any adverse decision is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg17_consent: REG-17, REG-SCN
('reg17_consent', $t$Consent to cancellation$t$,
 $t$Use when the business has closed or registration is no longer required and the noticee agrees to cancellation.$t$,
 'consent', '{REG-17,REG-SCN}', 20,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} by which it has been called upon to show cause why its registration should not be cancelled under section 29(2) of the Act, on the grounds stated therein.

3. The noticee respectfully submits that it has no objection to the cancellation of its registration, as [reason, such as the closure of the business on a stated date or the aggregate turnover having fallen below the threshold for registration].

4. The noticee requests that the cancellation take effect from [date from which cancellation is sought], being the date from which the reason stated above applies, and not from any earlier date, so that the returns already furnished, and the credit availed by its customers on its supplies, are not unsettled.

5. The noticee undertakes to furnish the final return in FORM GSTR 10 under section 45 of the Act read with rule 81 of the Rules, and to pay the amount payable under section 29(5) of the Act in respect of the inputs held in stock, the inputs contained in semi finished or finished goods held in stock, and the capital goods, if any, on the day immediately preceding the date of cancellation.

6. The noticee states that the returns up to [last tax period for which the return has been furnished] have been furnished, and that no tax is pending from it save as follows: [details of any dues, or state that there are none].

7. In view of the foregoing, it is respectfully prayed that:
(a) the consent of the noticee be taken on record;
(b) the registration be cancelled with effect from [date from which cancellation is sought]; and
(c) the undertaking of the noticee be accepted.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg17_hearing_time: REG-17, REG-SCN
('reg17_hearing_time', $t$Request for personal hearing or more time$t$,
 $t$Use when the reply needs more time, or the noticee wishes to be heard before any decision on cancellation.$t$,
 'adjournment', '{REG-17,REG-SCN}', 30,
$t$To,
The {{officer}}

Subject: Request for time and personal hearing in the matter of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} by which it has been called upon to show cause why its registration should not be cancelled under section 29(2) of the Act, on the grounds stated therein. The notice requires the noticee to reply by {{reply_due_long}}. {{hearing_clause}}

3. The noticee intends to show cause against the proposed cancellation, but requires further time to compile its reply and the supporting documents, for the following reason: [reason for which further time is needed].

4. Under the first proviso to section 29(2) of the Act, the registration cannot be cancelled without giving the person an opportunity of being heard. The noticee therefore requests that it be allowed time up to [date up to which time is sought] to file its reply, and that it be given a personal hearing before any decision is taken.

5. The noticee further requests that, if its registration has been suspended pending these proceedings, the suspension be revoked under rule 21A of the Rules in the meantime, as its business continues to operate.

6. The noticee assures your goodself of its full cooperation. This request is made without prejudice to its rights and contentions, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg23_support: REG-23
('reg23_support', $t$Reply in support of the revocation application$t$,
 $t$Use to answer the grounds on which rejection of the application for revocation of cancellation is proposed.$t$,
 'contest', '{REG-23}', 10,
$t$To,
The {{officer}}

Subject: Reply in FORM GST REG 24 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}}, holding GSTIN {{gstin}} (hereinafter referred to as "the applicant"), submits this reply under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The registration of the applicant was cancelled by an order dated [date of the order of cancellation]. The applicant filed an application for revocation of the cancellation in FORM GST REG 21, bearing ARN [ARN of the application] dated [date of the application], under section 30 of the Act read with rule 23 of the Rules. The applicant is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under rule 23(3) of the Rules, by which it has been called upon to show cause why the application should not be rejected. This reply is furnished in FORM GST REG 24.

3. The applicant respectfully submits that the application deserves to be allowed, for the following reasons:
(a) All returns due up to the date of cancellation have been furnished, and the tax due on them has been paid together with interest, penalty and late fee, as required by rule 23 of the Rules. The particulars are as follows: [returns furnished, with ARNs and dates, and the amounts paid].
(b) The applicant carries on its business at its principal place of business at [address of the principal place of business], and the reason that led to the cancellation, namely [reason], no longer subsists.
(c) [Reply to each further ground stated in the notice.]

4. The applicant undertakes to furnish, within the time required by rule 23 of the Rules, all returns due for the period from the date of the order of cancellation to the date of the order of revocation.

5. The applicant relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) this reply be accepted;
(b) the cancellation of the registration be revoked by an order in FORM GST REG 22 under rule 23(2) of the Rules; and
(c) the applicant be heard before any order rejecting the application is passed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg23_hearing: REG-23
('reg23_hearing', $t$Request for personal hearing and time$t$,
 $t$Use to ask for a personal hearing, and time if needed, before the application for revocation is decided.$t$,
 'adjournment', '{REG-23}', 20,
$t$To,
The {{officer}}

Subject: Request for time and personal hearing in the matter of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}}, holding GSTIN {{gstin}} (hereinafter referred to as "the applicant"), submits this letter under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The registration of the applicant was cancelled by an order dated [date of the order of cancellation]. The applicant filed an application for revocation of the cancellation in FORM GST REG 21, bearing ARN [ARN of the application] dated [date of the application], under section 30 of the Act read with rule 23 of the Rules. The applicant is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under rule 23(3) of the Rules, by which it has been called upon to show cause why the application should not be rejected. The notice requires the applicant to reply by {{reply_due_long}}.

3. The applicant intends to reply in FORM GST REG 24, but requires further time to compile the documents in support, for the following reason: [reason for which further time is needed].

4. The rejection of the application would deprive the applicant of its registration and of the ability to carry on its business lawfully. The principles of natural justice require that the applicant be heard before such a decision is taken. The applicant therefore requests that it be allowed time up to [date up to which time is sought] to file its reply, and that it be given a personal hearing before the application is decided.

5. The applicant assures your goodself of its full cooperation. This request is made without prejudice to its rights and contentions, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg03_clarify: REG-03
('reg03_clarify', $t$Clarification with documents$t$,
 $t$Use to answer each query raised on the application and to furnish the documents called for.$t$,
 'explain', '{REG-03}', 10,
$t$To,
The {{officer}}

Subject: Reply in FORM GST REG 04 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") has made an application bearing ARN [ARN of the application] dated [date of the application] under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The applicant is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} seeking clarification, information or documents in respect of the application. This reply is furnished in FORM GST REG 04.

3. The applicant furnishes the following clarification and documents in reply to each query raised in the notice:
(a) [Query raised in the notice]: [Clarification and the document furnished]
(b) [Query raised in the notice]: [Clarification and the document furnished]

4. The applicant relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

5. The applicant submits that the clarification and documents furnished meet every query raised in the notice. It is respectfully prayed that the application be approved and that, should any further clarification be required, the applicant be given an opportunity to furnish it before any adverse decision is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg03_time: REG-03
('reg03_time', $t$Request for time to furnish the clarification$t$,
 $t$Use when a document called for cannot be furnished within seven working days and a short extension is sought.$t$,
 'adjournment', '{REG-03}', 20,
$t$To,
The {{officer}}

Subject: Request for time to reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") has made an application bearing ARN [ARN of the application] dated [date of the application] under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The applicant is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} seeking clarification, information or documents in respect of the application. The notice requires the applicant to reply by {{reply_due_long}}.

3. The applicant is unable to furnish the clarification and documents within the time allowed, for the following reason: [reason for which further time is needed, such as a document awaited from an authority].

4. The applicant therefore requests that it be allowed time up to [date up to which time is sought] to furnish the clarification in FORM GST REG 04, and that the application not be rejected for want of a reply in the meantime.

5. The applicant assures your goodself of its full cooperation and undertakes to furnish the clarification within the time requested.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- rfd08_support: RFD-08
('rfd08_support', $t$Reply supporting the refund claim in full$t$,
 $t$Use to answer every ground of the proposed rejection and to seek the full refund claimed.$t$,
 'contest', '{RFD-08}', 10,
$t$To,
The {{officer}}

Subject: Reply in FORM GST RFD 09 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee had filed an application for refund in FORM GST RFD 01, bearing ARN [ARN of the refund application] dated [date of the refund application], for {{period_text}}, claiming a refund of Rs. [amount of refund claimed] on account of [category of refund, such as export of goods or services without payment of tax, accumulated credit due to an inverted duty structure, or excess balance in the electronic cash ledger] (hereinafter referred to as "the claim").

3. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under rule 92(3) of the Rules, by which it has been called upon to show cause why the claim should not be rejected, in whole or in part, on the grounds stated therein. This reply is furnished in FORM GST RFD 09.

4. The noticee submits that the claim is admissible in full. Its submissions on each ground are as follows:

{{issues_contest_paras}}

5. The claim was filed within the period prescribed by section 54(1) of the Act, with the statements, declarations and undertakings prescribed by rule 89 of the Rules for the category of refund claimed, and the amount claimed has been computed in accordance with that rule.

6. The proviso to rule 92(3) of the Rules provides that no application for refund shall be rejected without giving the applicant an opportunity of being heard. The noticee requests a personal hearing before any order is passed. {{hearing_clause}}

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) this reply be accepted;
(b) the refund of Rs. [amount of refund claimed] be sanctioned in full by an order in FORM GST RFD 06, together with interest under section 56 of the Act where the refund is not paid within the period specified in that section; and
(c) the noticee be heard before any adverse order is passed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- rfd08_partial: RFD-08
('rfd08_partial', $t$Reply accepting part of the proposed rejection$t$,
 $t$Use when part of the inadmissibility is accepted and the rest of the claim is pressed.$t$,
 'partial', '{RFD-08}', 20,
$t$To,
The {{officer}}

Subject: Reply in FORM GST RFD 09 to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee had filed an application for refund in FORM GST RFD 01, bearing ARN [ARN of the refund application] dated [date of the refund application], for {{period_text}}, claiming a refund of Rs. [amount of refund claimed] on account of [category of refund, such as export of goods or services without payment of tax, accumulated credit due to an inverted duty structure, or excess balance in the electronic cash ledger] (hereinafter referred to as "the claim").

3. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under rule 92(3) of the Rules, by which it has been called upon to show cause why the claim should not be rejected, in whole or in part, on the grounds stated therein. This reply is furnished in FORM GST RFD 09.

4. Part not pressed. The noticee accepts that Rs. [amount accepted as inadmissible] of the claim is not admissible, for the following reason: [reason], and does not press the claim to that extent. The noticee requests that the amount debited from its electronic credit ledger or electronic cash ledger at the time of filing the claim, to the extent of the part not pressed, be recredited in accordance with rule 93 of the Rules.

5. Balance pressed. The noticee submits that the balance of the claim, amounting to Rs. [balance amount pressed], is admissible. Its submissions on each ground are as follows:

{{issues_contest_paras}}

6. The proviso to rule 92(3) of the Rules provides that no application for refund shall be rejected without giving the applicant an opportunity of being heard. The noticee requests a personal hearing before any order is passed. {{hearing_clause}}

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) this reply be accepted;
(b) the balance of the claim, amounting to Rs. [balance amount pressed], be sanctioned by an order in FORM GST RFD 06, together with interest under section 56 of the Act where payable;
(c) the amount debited for the part not pressed be recredited in accordance with rule 93 of the Rules; and
(d) the noticee be heard before any adverse order is passed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- rfd08_time: RFD-08
('rfd08_time', $t$Request for time to reply$t$,
 $t$Use when the reply in FORM GST RFD 09 cannot be furnished within the fifteen days allowed.$t$,
 'adjournment', '{RFD-08}', 30,
$t$To,
The {{officer}}

Subject: Request for further time to reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee had filed an application for refund in FORM GST RFD 01, bearing ARN [ARN of the refund application] dated [date of the refund application], for {{period_text}}, claiming a refund of Rs. [amount of refund claimed] on account of [category of refund, such as export of goods or services without payment of tax, accumulated credit due to an inverted duty structure, or excess balance in the electronic cash ledger] (hereinafter referred to as "the claim").

3. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under rule 92(3) of the Rules, by which it has been called upon to show cause why the claim should not be rejected, in whole or in part, on the grounds stated therein. The notice requires the noticee to reply in FORM GST RFD 09 by {{reply_due_long}}.

4. The noticee is collecting the statements and documents needed to answer the grounds stated in the notice, and requires further time for the following reason: [reason for which further time is needed].

5. The noticee therefore requests that it be allowed time up to [date up to which time is sought] to file its reply, and that the claim not be rejected, in whole or in part, before the reply is considered and the noticee is heard, as the proviso to rule 92(3) of the Rules requires.

6. The noticee assures your goodself of its full cooperation. This request is made without prejudice to its rights and contentions, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- rfd03_fresh_application: RFD-03
('rfd03_fresh_application', $t$Cover letter for the fresh refund application$t$,
 $t$Use when the deficiencies have been rectified and a fresh refund application has been filed.$t$,
 'complied', '{RFD-03}', 10,
$t$To,
The {{officer}}

Subject: Fresh application for refund after rectification of the deficiencies in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The applicant had filed an application for refund in FORM GST RFD 01, bearing ARN [ARN of the original application] dated [date of the original application], for {{period_text}}. By {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the deficiency memo"){{din_clause}} issued under rule 90(3) of the Rules, the following deficiencies were communicated: [deficiencies stated in the deficiency memo].

3. The applicant has rectified the deficiencies, as set out below, and has filed a fresh application for refund in FORM GST RFD 01, bearing ARN [ARN of the fresh application] dated [date of the fresh application], as required by rule 90(3) of the Rules:
(a) [Deficiency]: [How it has been rectified and the document furnished]
(b) [Deficiency]: [How it has been rectified and the document furnished]

4. The fresh application relates to the same claim as the original application. In terms of rule 90(3) of the Rules, the period from the date of filing of the original application to the date of communication of the deficiencies is to be excluded in computing the period of two years under section 54(1) of the Act for the fresh application.

5. The applicant relies on the following documents, which are enclosed and may kindly be read as part of this letter:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) the fresh application be taken up and processed;
(b) the refund be sanctioned by an order in FORM GST RFD 06, together with interest under section 56 of the Act where payable; and
(c) should any further document be required, the applicant be informed, so that it may furnish it promptly.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- rfd03_contest: RFD-03
('rfd03_contest', $t$Reply that the deficiencies do not exist$t$,
 $t$Use when the documents said to be missing were filed with the original application, to ask that it be processed as filed.$t$,
 'contest', '{RFD-03}', 20,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The applicant had filed an application for refund in FORM GST RFD 01, bearing ARN [ARN of the original application] dated [date of the original application], for {{period_text}}. By {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the deficiency memo"){{din_clause}} issued under rule 90(3) of the Rules, the following deficiencies were communicated: [deficiencies stated in the deficiency memo].

3. The applicant respectfully submits that the deficiencies communicated do not exist, as the statements and documents referred to in the deficiency memo were furnished with the original application, as follows:
(a) [Deficiency stated in the memo]: [Where and how the document was furnished with the original application]
(b) [Deficiency stated in the memo]: [Where and how the document was furnished with the original application]

4. A deficiency memo under rule 90(3) of the Rules may be issued only where the application is in fact deficient. An application that was complete when filed ought to be processed as filed, and the applicant ought not to be required to file a fresh application, with the attendant risk to its claim on account of limitation.

5. The applicant relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) the deficiency memo be withdrawn and the original application be processed as filed;
(b) in the alternative, and without prejudice, any fresh application filed by the applicant be treated as a continuation of the original application for the purposes of section 54(1) of the Act; and
(c) the applicant be heard before any adverse view is taken.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- mov07_contest: MOV-07
('mov07_contest', $t$Reply contesting the detention and proposed penalty$t$,
 $t$Use when the goods moved with proper documents, or the defect was minor, and there was no intent to evade tax.$t$,
 'contest', '{MOV-07}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 129(3) of the Act, proposing a penalty in respect of the goods and the conveyance detained on [date of detention] at [place of detention]. The goods were being transported in conveyance number [vehicle number] under invoice number [invoice number] dated [invoice date] and e way bill number [e way bill number].

3. The noticee submits that the goods were in transit with the documents prescribed by the Act and the Rules, namely a tax invoice and an e way bill generated under rule 138 of the Rules, and that the tax on the supply was duly charged in the invoice. The discrepancy alleged in the notice, namely [discrepancy alleged in the notice], is explained as follows: [explanation of the discrepancy].

4. It is respectfully submitted that the power under section 129 of the Act is meant to secure the tax on goods in transit that would otherwise be evaded. It is not attracted where the transaction is fully documented, the tax is duly charged and accounted for, and the lapse, if any, is technical or clerical in nature, without any intention to evade tax. The proceedings ought therefore to be dropped and the goods and the conveyance released.

5. Section 129(4) of the Act provides that no penalty shall be determined under section 129(3) without giving the person concerned an opportunity of being heard. The noticee requests a personal hearing before any order is passed. {{hearing_clause}}

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) the proceedings under section 129 of the Act be dropped;
(b) the goods and the conveyance be released forthwith by an order in FORM GST MOV 05; and
(c) the noticee be heard before any order is passed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- mov07_pay_release: MOV-07
('mov07_pay_release', $t$Payment and request for release$t$,
 $t$Use when the penalty proposed has been paid, to have the goods and conveyance released and the proceedings closed.$t$,
 'accept_pay', '{MOV-07}', 20,
$t$To,
The {{officer}}

Subject: Payment of the penalty proposed in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}, and request for release

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 129(3) of the Act, proposing a penalty in respect of the goods and the conveyance detained on [date of detention] at [place of detention]. The goods were being transported in conveyance number [vehicle number] under invoice number [invoice number] dated [invoice date] and e way bill number [e way bill number].

3. To secure the early release of the goods and the conveyance, the noticee has paid the penalty proposed in the notice under section 129(1) of the Act {{payment_clause}}, as under:
Penalty paid: Rs. [amount of penalty paid]

4. Under section 129(5) of the Act, on payment of the amount referred to in section 129(1), all proceedings in respect of the notice are deemed to be concluded. The noticee accordingly requests that the goods and the conveyance be released forthwith by an order in FORM GST MOV 05.

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this letter:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) the payment be taken on record;
(b) the goods and the conveyance be released forthwith by an order in FORM GST MOV 05; and
(c) the proceedings in respect of the notice be treated as concluded.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- adt01_records: ADT-01
('adt01_records', $t$Letter furnishing records for the audit$t$,
 $t$Use to confirm the audit and to send the books of account and records called for.$t$,
 'complied', '{ADT-01}', 10,
$t$To,
The {{officer}}

Subject: Records furnished for the audit under {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 65(3) of the Act read with rule 101(2) of the Rules, informing the noticee that an audit of its records for {{period_text}} is to be conducted, and calling for the records specified in it.

3. In compliance with the notice, and in terms of section 65(5) of the Act, the noticee furnishes the following records and information:
{{annexure_list}}

4. The remaining records called for, namely [records still being compiled, if any], will be furnished on or before [date by which they will be furnished].

5. The noticee confirms that [name and designation of the person who will attend] will attend on [date of the audit], and will afford the audit team the facilities necessary to verify the books of account and other documents, as required by section 65(5) of the Act.

6. It is requested that the records be taken on record, and that any further record required be intimated to the noticee, so that it may be furnished promptly.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- adt01_defer: ADT-01
('adt01_defer', $t$Request to defer the audit$t$,
 $t$Use when the audit date or the deadline for records cannot be met and a later date is sought.$t$,
 'adjournment', '{ADT-01}', 20,
$t$To,
The {{officer}}

Subject: Request to defer the audit under {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 65(3) of the Act read with rule 101(2) of the Rules, informing the noticee that an audit of its records for {{period_text}} is to be conducted, and calling for the records specified in it. The audit is to commence on [date of the audit stated in the notice].

3. The noticee will extend its full cooperation in the audit. It is, however, unable to make the records available, or to have the persons in charge of its accounts present, on the date fixed, for the following reason: [reason for which deferment is sought].

4. The noticee therefore requests that the commencement of the audit be deferred to [date proposed for the audit], or to any later date convenient to your goodself, and that time till then be allowed for furnishing the records called for. Section 65(4) of the Act requires the audit to be completed within three months from its commencement, and a short deferment of its commencement will not prejudice the interests of the revenue.

5. The noticee assures your goodself of its full cooperation in the audit.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- adt02_contest: ADT-02
('adt02_contest', $t$Reply contesting the audit observations$t$,
 $t$Use to contest the discrepancies or findings of audit before the officer proceeds to a show cause notice.$t$,
 'contest', '{ADT-02}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} by which the observations of the audit of its records for {{period_text}}, conducted under section 65 of the Act, have been communicated to it.

3. The noticee does not accept the observations, for the reasons set out below. Rule 101(4) of the Rules requires the findings of audit to be finalised after due consideration of the reply furnished by the registered person, and the noticee requests that its submissions be considered accordingly.

4. The submissions of the noticee on each observation are as follows:

{{issues_contest_paras}}

5. Without prejudice to the above, as no tax is short paid and no credit has been availed in excess, no interest or penalty arises, and there is no occasion for any action under section 65(7) of the Act.

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) this reply be accepted and the observations be withdrawn or modified accordingly;
(b) no proceedings be initiated under section 73, section 74 or section 74A of the Act in respect of the observations; and
(c) the noticee be heard before any finding adverse to it is finalised.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- adt02_accept_pay: ADT-02
('adt02_accept_pay', $t$Acceptance of the observations with payment$t$,
 $t$Use when the observations are accepted and the tax with interest has been paid through FORM GST DRC 03.$t$,
 'accept_pay', '{ADT-02}', 20,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} by which the observations of the audit of its records for {{period_text}}, conducted under section 65 of the Act, have been communicated to it.

3. The noticee has examined the observations and accepts them. Its position on each observation is as follows:

{{issues_accept_paras}}

4. The noticee has paid the tax so accepted, together with interest under section 50 of the Act, {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Penalty, if any: Rs. [amount of penalty paid]

5. Under sections 73(5) and 73(6) of the Act, and the corresponding provisions of section 74 and section 74A of the Act, where the tax is paid with interest under section 50 of the Act, and with penalty where the provision so requires, before the service of a show cause notice, and the Proper Officer is informed of the payment, no notice is to be served in respect of the tax so paid. The noticee accordingly informs your goodself of the payment in terms of rule 142(2) of the Rules.

6. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) the payment be taken on record and acknowledged in FORM GST DRC 04 under rule 142(2) of the Rules;
(b) no show cause notice be served in respect of the tax so paid; and
(c) the audit be concluded on that basis.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- adt02_partial: ADT-02
('adt02_partial', $t$Part acceptance and contest of the balance$t$,
 $t$Use when some observations are accepted and paid and the others are contested.$t$,
 'partial', '{ADT-02}', 30,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} by which the observations of the audit of its records for {{period_text}}, conducted under section 65 of the Act, have been communicated to it.

3. The noticee accepts some of the observations, on which it has paid the tax with interest, and contests the others, as set out below. Rule 101(4) of the Rules requires the findings of audit to be finalised after due consideration of the reply furnished by the registered person.

4. Observations accepted. The noticee accepts the following observations: [identify each observation accepted, with its amount]. The tax so accepted has been paid together with interest under section 50 of the Act {{payment_clause}}, as under:
Tax: Rs. [amount of tax paid]
Interest under section 50 of the Act: Rs. [amount of interest paid]
Penalty, if any: Rs. [amount of penalty paid]

5. Observations contested. The submissions of the noticee on the remaining observations are as follows:

{{issues_contest_paras}}

6. Without prejudice to the above, as no tax is short paid on the observations contested, no interest or penalty arises on them, and there is no occasion for any action under section 65(7) of the Act in respect of them.

7. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) the payment be taken on record and acknowledged in FORM GST DRC 04 under rule 142(2) of the Rules;
(b) the observations contested be withdrawn, and no proceedings be initiated in respect of them under section 73, section 74 or section 74A of the Act; and
(c) the noticee be heard before any finding adverse to it is finalised.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc22_objection: DRC-22
('drc22_objection', $t$Objection to the provisional attachment$t$,
 $t$Use to object in FORM GST DRC 22A, within seven days of the attachment, that the property is not liable to attachment.$t$,
 'contest', '{DRC-22}', 10,
$t$To,
The {{officer}}

Subject: Objection in FORM GST DRC 22A to the provisional attachment under {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this objection to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. By {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order of attachment"){{din_clause}} issued under section 83 of the Act read with rule 159 of the Rules, the following property of the noticee has been attached provisionally: [description of the property attached, such as the bank account number and the name of the bank].

3. The noticee files this objection under rule 159(5) of the Rules in FORM GST DRC 22A, and submits that the property was not, and is not, liable to attachment, for the following reasons:
(a) Section 83 of the Act permits a provisional attachment only after the initiation of a proceeding under Chapter XII, Chapter XIV or Chapter XV of the Act, and only where the Commissioner forms the opinion that the attachment is necessary to protect the interest of the Government revenue. [State the proceeding, if any, that is pending, and why no such necessity exists.]
(b) The power of provisional attachment is drastic, and the opinion on which it rests must be formed on tangible material showing that the taxable person is likely to defeat the demand, if any, as held by the Hon'ble Supreme Court in Radha Krishan Industries v. State of Himachal Pradesh (2021). No such material has been disclosed to the noticee.
(c) The noticee is a running business, and the attachment has disabled it from meeting its regular obligations, including the payment of salaries, suppliers and taxes: [facts showing the effect of the attachment on the business].
(d) [Any further ground, such as the demand having been paid, stayed or secured.]

4. Rule 159(5) of the Rules contemplates an opportunity of being heard on this objection before it is decided. The noticee requests a personal hearing.

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this objection:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) the objection be upheld, the attachment be withdrawn, and the property be released by an order in FORM GST DRC 23;
(b) in the alternative, and without prejudice, the attachment be restricted to [amount or part of the property], and the noticee be permitted to operate the account beyond it; and
(c) the noticee be heard before the objection is decided.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc22_release: DRC-22
('drc22_release', $t$Request for release of the attached property$t$,
 $t$Use when the dues have been paid, the proceeding has concluded or an appeal is pending with pre deposit, to seek release.$t$,
 'complied', '{DRC-22}', 20,
$t$To,
The {{officer}}

Subject: Request for release of the property attached under {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. By {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order of attachment"){{din_clause}} issued under section 83 of the Act read with rule 159 of the Rules, the following property of the noticee has been attached provisionally: [description of the property attached, such as the bank account number and the name of the bank].

3. The noticee respectfully submits that the property is no longer liable to attachment, as [event on which release is sought, such as payment of the amount due through FORM GST DRC 03 with its ARN and date, the conclusion of the proceeding in which the attachment was made, or an appeal filed with the pre deposit on which recovery stands stayed].

4. The attachment was made to protect the interest of the revenue during the pendency of the proceeding. That purpose having been served, its continuance would cause the noticee hardship without any corresponding benefit to the revenue. Rule 159 of the Rules provides for the release of property that is no longer liable for attachment, by an order in FORM GST DRC 23.

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this letter:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that the property be released by an order in FORM GST DRC 23, and that the order be communicated forthwith to [the bank or other authority holding the property].

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc13_not_due: DRC-13
('drc13_not_due', $t$Statement that no money is due to the defaulter$t$,
 $t$Use when the noticee owes no money to, and holds no money for, the person named as the defaulter.$t$,
 'explain', '{DRC-13}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 79(1)(c) of the Act read with rule 145(1) of the Rules, requiring it to pay to the credit of the Government the amount specified in the notice out of the money stated to be due from it to, or held by it for or on account of, [name and GSTIN of the person in default] (hereinafter referred to as "the defaulter").

3. The noticee respectfully states that, on the date on which the notice was served on it, no money was due from it to the defaulter and it did not hold any money for or on account of the defaulter, and that no money is likely to become due to, or to be held for or on account of, the defaulter. [Particulars of the account of the defaulter in the books of the noticee, such as the last transaction and the balance.]

4. Section 79(1)(c) of the Act provides that where the person on whom such a notice is served proves to the satisfaction of the officer issuing it that the money demanded was not due to the person in default, or that it did not hold any money for or on account of that person, at the time the notice was served, and that no such money is likely to become due or to be held, nothing in that section requires the person served to pay any such money to the Government. The extract of the account of the defaulter in the books of the noticee is enclosed in proof of the above.

5. The noticee undertakes that, if any money becomes due to the defaulter, or comes to be held for or on account of the defaulter, while the notice remains in force, it will inform your goodself forthwith and act in accordance with the notice.

6. The following documents are enclosed:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) this statement be accepted;
(b) the notice be withdrawn as regards the noticee; and
(c) the noticee be not treated as a defaulter in respect of the amount specified in the notice.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc13_complied: DRC-13
('drc13_complied', $t$Intimation of compliance$t$,
 $t$Use when the amount directed has been deposited, to report it and to ask for the certificate in FORM GST DRC 14.$t$,
 'complied', '{DRC-13}', 20,
$t$To,
The {{officer}}

Subject: Compliance with {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 79(1)(c) of the Act read with rule 145(1) of the Rules, requiring it to pay to the credit of the Government the amount specified in the notice out of the money stated to be due from it to, or held by it for or on account of, [name and GSTIN of the person in default] (hereinafter referred to as "the defaulter").

3. In compliance with the notice, the noticee has paid to the credit of the Government the amount of Rs. [amount paid], being [the amount specified in the notice, or the whole of the money due to or held for the defaulter where that is less], as under:
Mode and reference of payment: [mode of payment and reference number]
Date of payment: [date of payment]

4. Under section 79(1)(c) of the Act, a payment made in compliance with such a notice is deemed to have been made under the authority of the person in default, and the receipt for it is a good and sufficient discharge of the liability of the noticee to that person to the extent of the amount paid. The noticee requests that a certificate in FORM GST DRC 14 be issued to it under rule 145(2) of the Rules, recording the liability so discharged.

5. [Where the amount paid is less than the amount specified in the notice: The noticee states that the amount paid is the whole of the money that was due to or held for the defaulter when the notice was served, and that no further money is due or held.]

6. The following documents are enclosed:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that the compliance be taken on record and that a certificate in FORM GST DRC 14 be issued to the noticee.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc13_withdraw: DRC-13
('drc13_withdraw', $t$Request to revoke the notice$t$,
 $t$Use when the notice seeks to recover a demand against the taxpayer that has since been paid or stayed in appeal.$t$,
 'appeal_stay', '{DRC-13}', 30,
$t$To,
The {{officer}}

Subject: Request to withdraw {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the taxpayer") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The taxpayer has come to know of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under section 79(1)(c) of the Act to [name of the person to whom the notice is addressed, such as a bank or a customer of the taxpayer], for the recovery of a demand of Rs. [amount] against the taxpayer arising from [order creating the demand, with its reference number and date].

3. The taxpayer respectfully submits that the demand is not recoverable, because [state the reason, such as the payment of the demand in full through FORM GST DRC 03 with its ARN and date, or the filing of an appeal under section 107 of the Act with the pre deposit required by section 107(6), on which the recovery of the balance stands stayed under section 107(7) of the Act].

4. The officer issuing a notice under section 79(1)(c) of the Act may at any time amend or revoke it. As no amount is recoverable, the taxpayer requests that the notice be revoked forthwith and that the person to whom it was addressed be informed accordingly, so that the taxpayer may operate its account and receive its dues without hindrance.

5. The following documents are enclosed:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that the notice be revoked and that the revocation be communicated forthwith to the person to whom it was addressed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- summons_appear: SUMMONS
('summons_appear', $t$Letter confirming appearance$t$,
 $t$Use to confirm that the person summoned will appear on the date fixed, with the documents called for.$t$,
 'complied', '{SUMMONS}', 10,
$t$To,
The {{officer}}

Subject: Appearance in response to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the summons with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the summons"){{din_clause}} issued under section 70 of the Act, requiring [name and designation of the person summoned] to appear before your goodself on {{hearing_date_long}} to give evidence or to produce documents in the inquiry referred to in it.

3. In compliance with the summons, [name and designation of the person who will appear] will appear before your goodself on {{hearing_date_long}} at [time of appearance], and will produce the following documents called for in the summons: [list of documents to be produced].

4. The noticee assures your goodself of its full cooperation in the inquiry. Should any further document or information be required, the noticee requests that it be specified, so that it may be produced without delay.

5. This letter is without prejudice to the rights of the noticee and of the person summoned under the law, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- summons_new_date: SUMMONS
('summons_new_date', $t$Request for another date of appearance$t$,
 $t$Use when the person summoned cannot appear on the date fixed, to propose another date.$t$,
 'adjournment', '{SUMMONS}', 20,
$t$To,
The {{officer}}

Subject: Request for another date of appearance in response to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of the summons with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the summons"){{din_clause}} issued under section 70 of the Act, requiring [name and designation of the person summoned] to appear before your goodself on {{hearing_date_long}} to give evidence or to produce documents in the inquiry referred to in it.

3. The person summoned is unable to appear on {{hearing_date_long}} for the following reason: [reason for which the person summoned cannot appear on the date fixed]. The documents called for are being compiled and will be produced on the date to be fixed.

4. The noticee therefore requests that the appearance be rescheduled to [date proposed for appearance], or to any later date convenient to your goodself. The request is made in good faith and not to delay the inquiry, and the noticee assures its full cooperation.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- aplhearing_attend: APL-HEARING
('aplhearing_attend', $t$Confirmation of attendance at the hearing$t$,
 $t$Use to confirm that the appellant or its authorised representative will attend the appeal hearing on the date fixed.$t$,
 'complied', '{APL-HEARING}', 10,
$t$To,
The {{officer}}

Subject: Personal hearing in the appeal: confirmation of attendance in response to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the appellant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The appellant has filed an appeal before the Appellate Authority under section 107 of the Act in FORM GST APL 01, bearing ARN [ARN of the appeal] dated [date of filing the appeal], against [order appealed against, with its reference number and date] (hereinafter referred to as "the appeal"). The personal hearing in the appeal has been fixed on {{hearing_date_long}} by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} issued in the appeal.

3. The appellant confirms that [name of the authorised representative], [designation or professional qualification], will appear on its behalf at the hearing on {{hearing_date_long}} at [time of hearing], as its authorised representative under section 116 of the Act. The authorisation is enclosed.

4. The appellant will rely on the grounds of appeal and the statement of facts filed with the appeal, and craves leave to file written submissions and a compilation of the documents and decisions relied upon at the hearing.

5. It is requested that the above be taken on record.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- aplhearing_adjourn: APL-HEARING
('aplhearing_adjourn', $t$Request for adjournment of the appeal hearing$t$,
 $t$Use when the appellant cannot attend on the date fixed; section 107(9) allows at most three adjournments.$t$,
 'adjournment', '{APL-HEARING}', 20,
$t$To,
The {{officer}}

Subject: Request for adjournment of the personal hearing fixed by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the appellant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The appellant has filed an appeal before the Appellate Authority under section 107 of the Act in FORM GST APL 01, bearing ARN [ARN of the appeal] dated [date of filing the appeal], against [order appealed against, with its reference number and date] (hereinafter referred to as "the appeal"). The personal hearing in the appeal has been fixed on {{hearing_date_long}} by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} issued in the appeal.

3. The appellant is unable to attend the hearing on {{hearing_date_long}} for the following reason: [reason for which the adjournment is sought].

4. Section 107(9) of the Act empowers the Appellate Authority, if sufficient cause is shown at any stage of the hearing of an appeal, to grant time to the parties and adjourn the hearing for reasons to be recorded in writing, provided that no adjournment is granted more than three times to a party during the hearing of the appeal. The appellant submits that the reason stated above constitutes sufficient cause, and that this is its [first, second or third] request for adjournment in the appeal.

5. The appellant therefore requests that the hearing be adjourned to [date proposed for the hearing], or to any later date convenient to the Appellate Authority. The appellant assures its full cooperation in the early disposal of the appeal.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- aplhearing_written: APL-HEARING
('aplhearing_written', $t$Written submissions in lieu of personal hearing$t$,
 $t$Use when the appellant will not attend and asks that the appeal be decided on its written submissions.$t$,
 'contest', '{APL-HEARING}', 30,
$t$To,
The {{officer}}

Subject: Written submissions in the appeal, in response to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the appellant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in these submissions to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The appellant has filed an appeal before the Appellate Authority under section 107 of the Act in FORM GST APL 01, bearing ARN [ARN of the appeal] dated [date of filing the appeal], against [order appealed against, with its reference number and date] (hereinafter referred to as "the appeal"). The personal hearing in the appeal has been fixed on {{hearing_date_long}} by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} issued in the appeal.

3. The appellant submits these written submissions in lieu of appearing in person at the hearing, and requests that the appeal be decided on their basis, together with the grounds of appeal and the documents already on record. This is without prejudice to the right of the appellant to be heard under section 107(8) of the Act, which it does not waive, should the Appellate Authority be inclined to take any view adverse to it.

4. The facts of the case, in brief, are as follows: [brief statement of the facts].

5. The order appealed against is not sustainable, for the following reasons, among others:
(a) [First ground on which the order is challenged]
(b) [Further ground]
(c) [Further ground]

6. In support of these submissions, the appellant relies on the following documents and decisions, copies of which are enclosed:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that:
(a) the appeal be allowed and the order appealed against be set aside, with consequential relief;
(b) the pre deposit made be refunded with interest under section 115 of the Act; and
(c) such other order be passed as may be deemed fit in the facts and circumstances of the case.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- order_rectify: DRC-07, DRC-07A, MOV-09, REG-19, APL-04, RFD-06, REG-05, RECT-ORDER, REG-CANCEL-REJ
('order_rectify', $t$Application for rectification of the order$t$,
 $t$Use when the order has an error apparent on the face of the record; the application lies within three months of the order.$t$,
 'rectify', '{DRC-07,DRC-07A,MOV-09,REG-19,APL-04,RFD-06,REG-05,RECT-ORDER,REG-CANCEL-REJ}', 30,
$t$To,
The {{officer}}

Subject: Application under section 161 for rectification of the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this application to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The applicant is in receipt of the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order"){{din_clause}} for {{period_text}}.

3. Section 161 of the Act empowers the authority that passed an order to rectify any error apparent on the face of the record, including where the error is brought to its notice by the affected person within three months from the date of issue of the order. The applicant, being a person affected by the order, brings the following errors apparent on the face of the record to the notice of your goodself:
(a) [Error apparent on the face of the record, and the correct position as shown by the record]
(b) [Further error, if any]

4. Each of these errors is evident from the record itself, namely [documents on record that show the error, such as the reply filed, the payments made through FORM GST DRC 03 or the returns furnished], and its correction requires neither fresh investigation nor a long process of reasoning. On rectification, the order would stand corrected as follows: [effect of the rectification, such as the corrected amount payable or the relief to be allowed].

5. Where the order creates a demand, the applicant requests that the recovery of the part of the demand affected by the errors be kept in abeyance until this application is decided. If the rectification sought is not found acceptable in any respect, the applicant requests an opportunity of being heard before the application is rejected.

6. This application is made without prejudice to the right of the applicant to prefer an appeal against the order, which is expressly reserved.

7. The applicant relies on the following documents, which are enclosed and may kindly be read as part of this application:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) the errors stated above be rectified under section 161 of the Act and a rectified order be issued;
(b) where the order created a demand, the summary of the rectified order be uploaded in FORM GST DRC 08 under rule 142(7) of the Rules and the electronic liability register be corrected accordingly; and
(c) the applicant be heard before any part of this application is rejected.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- order_appeal_stay: DRC-07, MOV-09
('order_appeal_stay', $t$Intimation of appeal and request to stay recovery$t$,
 $t$Use after an appeal is filed with the pre deposit under section 107(6), to record that recovery of the balance stands stayed.$t$,
 'appeal_stay', '{DRC-07,MOV-09}', 10,
$t$To,
The {{officer}}

Subject: Intimation of appeal against the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}, and request to stay recovery

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the appellant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The appellant is in receipt of the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order"){{din_clause}} for {{period_text}}, under which the appellant has been called upon to pay {{demand_heads_text}}.

3. Being aggrieved by the order, the appellant has filed an appeal before the Appellate Authority under section 107 of the Act in FORM GST APL 01, bearing ARN [ARN of the appeal] dated [date of filing the appeal].

4. Along with the appeal, the appellant has paid the pre deposit required by section 107(6) of the Act, namely the full amount of tax, interest, fine, fee and penalty arising from the order that is admitted by it, if any, and the further sum specified in that provision in relation to the amount in dispute, as under:
Amount admitted and paid: Rs. [amount admitted, if any]
Pre deposit on the amount in dispute: Rs. [amount of pre deposit]
Reference of payment: [ARN or reference of the payment] dated [date of payment]

5. Under section 107(7) of the Act, where the appellant has paid the amount required by section 107(6), the recovery proceedings for the balance amount are deemed to be stayed. The appellant accordingly requests that no recovery proceedings be initiated or continued in respect of the balance of the demand while the appeal is pending, and that the electronic liability register be updated to show the demand as stayed.

6. Should any recovery action have been initiated in respect of the demand, including any notice to a bank or other person under section 79 of the Act or any attachment, the appellant requests that it be withdrawn forthwith: [particulars of any recovery action taken].

7. The following documents are enclosed:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that the appeal and the pre deposit be taken on record, and that the recovery of the balance of the demand be treated as stayed until the appeal is disposed of.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- order_paid_close: DRC-07, DRC-07A, MOV-09, APL-04, RECT-ORDER
('order_paid_close', $t$Intimation of payment and request to close the demand$t$,
 $t$Use when the amount payable under the order has been paid in full and the demand should be shown as discharged.$t$,
 'complied', '{DRC-07,DRC-07A,MOV-09,APL-04,RECT-ORDER}', 20,
$t$To,
The {{officer}}

Subject: Intimation of payment of the amount payable under the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the taxpayer") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The taxpayer is in receipt of the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order"){{din_clause}} for {{period_text}}, under which the taxpayer has been called upon to pay {{demand_heads_text}}.

3. The taxpayer has accepted the order and has paid the amount payable under it in full, as under:
Tax: Rs. [amount of tax paid]
Interest: Rs. [amount of interest paid]
Penalty: Rs. [amount of penalty paid]
Other amounts, if any: Rs. [other amount paid]
Reference of payment: [ARN of FORM GST DRC 03 or other reference of the payment] dated [date of payment]

4. The taxpayer requests that the payment be appropriated against the demand created by the order, that the demand be shown as discharged in the electronic liability register, and that no recovery proceedings be initiated in respect of it. Where any goods or conveyance remain detained, or any recovery action has been taken, in connection with the demand, the taxpayer requests that the goods or conveyance be released and the action be withdrawn.

5. The following documents are enclosed:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that the payment be taken on record and that the demand created by the order be treated as discharged and closed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- drc07a_status: DRC-07A
('drc07a_status', $t$Intimation of the status of the pre GST demand$t$,
 $t$Use when the demand under the existing law uploaded for recovery has been paid, reduced, set aside or stayed.$t$,
 'appeal_stay', '{DRC-07A}', 10,
$t$To,
The {{officer}}

Subject: Status of the demand uploaded in {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the taxpayer") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The taxpayer is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the summary"){{din_clause}} uploaded under rule 142A of the Rules for the recovery, under section 142(8)(a) of the Act, of a demand of Rs. [amount of the demand] created under [name of the existing law, such as the State Value Added Tax Act or the Central Excise Act, 1944] by [order creating the demand, with its reference number and date].

3. The taxpayer respectfully informs your goodself that the demand stands [paid, reduced, set aside or stayed] under the existing law, as follows: [particulars, such as the challans for the payment made, the appellate order setting aside or reducing the demand, or the order of stay and the pre deposit made].

4. Under section 142(8)(a) of the Act, an amount that becomes recoverable under the existing law is recoverable as an arrear of tax under the Act only to the extent it is not recovered under the existing law. In view of the above, the amount that remains recoverable in respect of the demand is Rs. [amount that remains recoverable, or nil].

5. The taxpayer therefore requests that the summary be modified or withdrawn by uploading a summary in FORM GST DRC 08A under rule 142A of the Rules, that the electronic liability register be corrected accordingly, and that no recovery proceedings be initiated under the Act in respect of the amount paid, set aside or stayed.

6. The following documents are enclosed:
{{annexure_list}}

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- reg19_revocation: REG-19
('reg19_revocation', $t$Application for revocation of cancellation$t$,
 $t$Use with FORM GST REG 21, once the pending returns have been filed and the dues paid, to have the registration restored.$t$,
 'contest', '{REG-19}', 10,
$t$To,
The {{officer}}

Subject: Application for revocation of the cancellation of registration by the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}}, holding GSTIN {{gstin}} (hereinafter referred to as "the applicant"), submits this application under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this application to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The registration of the applicant has been cancelled by the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order of cancellation"){{din_clause}} on the ground that [ground stated in the order of cancellation].

3. The applicant submits this application for revocation of the cancellation of its registration under section 30 of the Act read with rule 23 of the Rules, in FORM GST REG 21, within the time allowed by rule 23 of the Rules.

4. The applicant has complied with the conditions of rule 23 of the Rules. All returns due up to the date of cancellation have been furnished, and the tax due on them has been paid together with interest, penalty and late fee, as follows: [returns furnished, with ARNs and dates, and the amounts paid].

5. The applicant continues to carry on its business at its principal place of business at [address of the principal place of business]. The default that led to the cancellation was caused by [reason for the default], and that reason no longer subsists.

6. The applicant undertakes to furnish, within the time required by rule 23 of the Rules, all returns due for the period from the date of the order of cancellation to the date of the order of revocation.

7. The applicant relies on the following documents, which are enclosed and may kindly be read as part of this application:
{{annexure_list}}

8. In view of the foregoing, it is respectfully prayed that:
(a) the cancellation of the registration be revoked by an order in FORM GST REG 22 under rule 23(2) of the Rules; and
(b) should the Proper Officer propose to reject this application, a notice in FORM GST REG 23 be issued and the applicant be heard before any order is passed.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- apl04_tribunal: APL-04
('apl04_tribunal', $t$Intimation of appeal before the Appellate Tribunal$t$,
 $t$Use after an appeal against the appellate order is filed before the Tribunal with the pre deposit under section 112(8).$t$,
 'appeal_stay', '{APL-04}', 10,
$t$To,
The {{officer}}

Subject: Intimation of appeal before the Goods and Services Tax Appellate Tribunal against the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the appellant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The appellant is in receipt of the order of the Appellate Authority communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the appellate order"){{din_clause}} for {{period_text}}, passed in the appeal of the appellant under section 107 of the Act against [order originally appealed against, with its reference number and date].

3. Being aggrieved by the appellate order, the appellant has filed an appeal before the Goods and Services Tax Appellate Tribunal under section 112 of the Act in FORM GST APL 05, bearing [ARN or filing reference of the appeal] dated [date of filing the appeal].

4. Along with the appeal, the appellant has paid the pre deposit required by section 112(8) of the Act, namely the full amount admitted by it, if any, and the further sum specified in that provision in relation to the amount in dispute, in addition to the amount paid under section 107(6) of the Act, as under:
Amount admitted and paid: Rs. [amount admitted, if any]
Pre deposit under section 112(8): Rs. [amount of pre deposit]
Amount paid earlier under section 107(6): Rs. [amount paid earlier]
Reference of payment: [ARN or reference of the payment] dated [date of payment]

5. Under section 112(9) of the Act, where the appellant has paid the amount required by section 112(8), the recovery proceedings for the balance amount are deemed to be stayed till the disposal of the appeal. The appellant accordingly requests that no recovery proceedings be initiated or continued in respect of the balance of the demand, and that the electronic liability register be updated to show the demand as stayed.

6. The following documents are enclosed:
{{annexure_list}}

7. In view of the foregoing, it is respectfully prayed that the appeal and the pre deposit be taken on record, and that the recovery of the balance of the demand be treated as stayed until the appeal is disposed of.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- order_appeal_intent: RFD-06, REG-05, RECT-ORDER, REG-CANCEL-REJ
('order_appeal_intent', $t$Letter recording the intention to appeal$t$,
 $t$Use to place on record that the order is not accepted and that an appeal will be filed within the time allowed.$t$,
 'appeal_stay', '{RFD-06,REG-05,RECT-ORDER,REG-CANCEL-REJ}', 15,
$t$To,
The {{officer}}

Subject: Intimation of intention to appeal against the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the taxpayer") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The taxpayer is in receipt of the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order"){{din_clause}} for {{period_text}}, by which [operative part of the order, such as the rejection of the application or the amount disallowed].

3. The taxpayer respectfully places on record that it does not accept the order, and that it intends to prefer an appeal against it before the Appellate Authority under section 107 of the Act within the period allowed by section 107(1) of the Act, on the grounds, among others, that [principal grounds on which the order will be challenged].

4. The taxpayer requests that no action prejudicial to it be taken on the basis of the order until the period for filing the appeal has expired and, where an appeal is filed, until it is disposed of.

5. This letter is without prejudice to the rights and contentions of the taxpayer, including its right to seek rectification of the order under section 161 of the Act, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- order_reconsider: REG-05, REG-CANCEL-REJ
('order_reconsider', $t$Letter seeking consideration of a fresh application$t$,
 $t$Use when the defect that led to the rejection has been cured and a fresh application has been filed.$t$,
 'general', '{REG-05,REG-CANCEL-REJ}', 12,
$t$To,
The {{officer}}

Subject: Fresh application after the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The applicant is in receipt of the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order"){{din_clause}} for {{period_text}}, by which its application bearing ARN [ARN of the application rejected] dated [date of that application] was rejected on the ground that [ground of rejection stated in the order].

3. The applicant has since cured the defect on which the order is founded, in that [steps taken to cure the defect, such as the documents now obtained or the returns now furnished], and has filed a fresh application bearing ARN [ARN of the fresh application] dated [date of the fresh application].

4. The applicant respectfully requests that the fresh application be considered on its merits in the light of the above and, should any clarification be required, that the applicant be informed and given an opportunity to furnish it before any decision is taken.

5. This letter is without prejudice to the right of the applicant to prefer an appeal against the order, which is reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- rfd06_recredit: RFD-06
('rfd06_recredit', $t$Undertaking not to appeal and request for recredit$t$,
 $t$Use when the rejection of the refund is accepted, so that the amount debited is recredited to the ledger in FORM GST PMT 03.$t$,
 'consent', '{RFD-06}', 25,
$t$To,
The {{officer}}

Subject: Undertaking not to appeal and request for recredit under the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the applicant") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. By the order communicated by {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the order"){{din_clause}} for {{period_text}}, the refund claimed by the applicant in its application bearing ARN [ARN of the refund application] dated [date of the refund application] has been rejected to the extent of Rs. [amount rejected].

3. The applicant accepts the order to the extent of the rejection and hereby undertakes that it shall not file an appeal against the order in respect of the amount rejected.

4. Rule 93 of the Rules provides for the amount debited at the time of filing the claim to be recredited, to the extent of the rejection, by an order in FORM GST PMT 03, and treats a refund as rejected for this purpose where the claimant gives an undertaking in writing that it shall not file an appeal. The applicant therefore requests that Rs. [amount to be recredited] be recredited to its [electronic credit ledger or electronic cash ledger] by an order in FORM GST PMT 03.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- general_reply: general (forms without templates of their own)
('general_reply', $t$Reply with submissions on the matters raised$t$,
 $t$Use for a notice without a template of its own, to reply on the facts and the law.$t$,
 'general', '{}', 10,
$t$To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this reply to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under {{section_text}} for {{period_text}}.

3. The noticee has examined the notice and the records relating to the matters raised in it, and its submissions are as follows:

{{issues_contest_paras}}

4. The noticee submits that, for the reasons stated above, no adverse action is called for in the matter. It craves leave to add to, alter or amend these submissions and to produce further documents, if required. {{hearing_clause}}

5. The noticee relies on the following documents, which are enclosed and may kindly be read as part of this reply:
{{annexure_list}}

6. In view of the foregoing, it is respectfully prayed that:
(a) this reply be taken on record and accepted;
(b) the proceedings initiated by the notice be dropped and the matter be closed;
(c) the noticee be given an opportunity of being heard before any adverse decision is taken; and
(d) such other order be passed as may be deemed fit in the facts and circumstances of the case.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- general_comply: general (forms without templates of their own)
('general_comply', $t$Letter furnishing the information called for$t$,
 $t$Use when the notice calls for information, documents or an action that the noticee has furnished or taken.$t$,
 'complied', '{}', 20,
$t$To,
The {{officer}}

Subject: Compliance with {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under {{section_text}} for {{period_text}}.

3. In compliance with the notice, the noticee furnishes the following information and documents, and states the action taken by it: [information furnished, documents enclosed and action taken in compliance with the notice].

4. The following documents are enclosed:
{{annexure_list}}

5. The noticee submits that it has thereby complied with the notice. It requests that the compliance be taken on record, that the matter be treated as closed and, should anything further be required, that the noticee be informed so that it may furnish it promptly.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$),

-- general_time: general (forms without templates of their own)
('general_time', $t$Request for more time to reply$t$,
 $t$Use when more time is needed to reply to a notice that has no template of its own.$t$,
 'adjournment', '{}', 30,
$t$To,
The {{officer}}

Subject: Request for further time to reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}. The provisions of the Act and of {{sgst_act}} being in pari materia, a reference in this letter to a provision of the Act or of the Central Goods and Services Tax Rules, 2017 (hereinafter referred to as "the Rules") includes a reference to the corresponding provision under {{sgst_act}}.

2. The noticee is in receipt of {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}} (hereinafter referred to as "the notice"){{din_clause}} issued under {{section_text}} for {{period_text}}. The notice requires the noticee to reply by {{reply_due_long}}. {{hearing_clause}}

3. The noticee requires further time to reply, for the following reason: [reason for which further time is needed].

4. The noticee therefore requests that it be allowed time up to [date up to which time is sought] to file its reply and that, where a personal hearing has been fixed, it be adjourned to a date after that date convenient to your goodself.

5. The noticee assures its full cooperation. This request is made without prejudice to its rights and contentions, all of which are reserved.

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}$t$)
ON CONFLICT (key) DO NOTHING;
