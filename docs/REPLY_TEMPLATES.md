# Reply templates

The replies the app prepares by itself for every notice that needs one (asked by the firm on
6 October 2026: "prepare different replies ... legal wordings ... without hyphen"). Each open
notice gets one option per active template of its form, two to five per form; a notice whose
form has no template of its own gets the three general templates. A person picks one on the
notice page and it becomes the next draft, which then goes through partner review.

- **Seed:** `supabase/migrations/20261008161000_reply_templates_seed.sql` (64 templates and the
  issue paragraphs of all 19 issue codes).
- **Machinery:** `20261008160000_reply_options.sql` (placeholders, rendering, triggers, the no
  dash constraints). Positions: `docs/REPLY_FACTORY_POSITIONS.md` §12.
- **Tests:** `supabase/tests/notices/test_101_reply_templates.sql`.

**These are drafts for the partner to review before first use (§12, decision pending).** The law
cited was checked against the Central Goods and Services Tax Act and Rules, 2017. Points that
depend on circulars, recent amendments or rates are left to fill-ins or listed under
[Points to verify](#points-to-verify).

## Catalogue

Stances: Contest, Part accept, Accept and pay, Explain, Complied, More time, Documents, Rectify,
Appeal or stay, Consent, General. "Fill-ins" are the square-bracketed blanks the person completes
in the draft; facts the app holds (names, GSTIN, form, reference, dates, DIN, officer, section,
period, demand, hearing, issues, annexures, place, signatory) are filled in by the renderer.

| Key | Forms | Stance | Legal basis | When to use | Fill-ins to complete |
|---|---|---|---|---|---|
| `asmt10_explain` | ASMT-10 | Explain | Section 61(1) and (2); rule 99(2) and (3); reply in FORM GST ASMT 11, closure in FORM GST ASMT 12 | Use when every discrepancy in the scrutiny notice can be explained and no tax is short paid. | anything the issue paragraphs leave open |
| `asmt10_accept_pay` | ASMT-10 | Accept and pay | Section 61; rule 99(2) and (3); payment through FORM GST DRC 03 with interest under section 50 | Use when the discrepancies are accepted and the tax, interest and other dues arising from them have been paid through FORM GST DRC 03. | ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; other amount paid; anything the issue paragraphs leave open |
| `asmt10_partial` | ASMT-10 | Part accept | Section 61; rule 99(2) and (3); payment of the part accepted through FORM GST DRC 03 | Use when some discrepancies are explained and the rest are accepted and paid through FORM GST DRC 03. | identify each discrepancy accepted, with its amount; ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; anything the issue paragraphs leave open |
| `asmt10_time` | ASMT-10 | More time | Rule 99(1): thirty days or such further period as the proper officer may permit | Use when the explanation cannot be completed within the time allowed and further time is needed. | reason for which further time is needed; number of days; date up to which time is sought |
| `drc01a_contest` | DRC-01A | Contest | Rule 142(1A) and (2A); submissions in Part B of FORM GST DRC 01A | Use to dispute the tax ascertained in Part A of FORM GST DRC 01A, so that no show cause notice is issued. | anything the issue paragraphs leave open |
| `drc01a_pay` | DRC-01A | Accept and pay | Sections 73(5) and 73(6) and the corresponding provisions of sections 74 and 74A; rule 142(2); acknowledgement in FORM GST DRC 04 | Use when the ascertained amount is accepted and paid in full through FORM GST DRC 03 before any show cause notice is issued. | ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount of penalty paid; anything the issue paragraphs leave open |
| `drc01a_partial` | DRC-01A | Part accept | Rule 142(2A) (part payment and submissions in Part B of FORM GST DRC 01A); rule 142(2); section 73(5) | Use when part of the ascertained amount is accepted and paid and the balance is disputed in Part B. | identify each item accepted, with its amount; ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount of penalty paid; anything the issue paragraphs leave open |
| `drc01_contest` | DRC-01 | Contest | Sections 73, 74 or 74A as invoked; section 75(4) (hearing); rule 142(4) (reply in FORM GST DRC 06) | Use to contest every proposal in the show cause notice and to ask for a personal hearing. | anything the issue paragraphs leave open |
| `drc01_partial` | DRC-01 | Part accept | Sections 73, 74 or 74A as invoked; section 75(4); rule 142(4) (reply in FORM GST DRC 06); payment through FORM GST DRC 03 | Use when part of the demand is accepted and paid through FORM GST DRC 03 and the rest is contested. | identify each item accepted, with its amount; ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount of penalty paid; anything the issue paragraphs leave open |
| `drc01_pay_conclude` | DRC-01 | Accept and pay | Section 73(8), section 74(8) or the corresponding provision of section 74A, as the section invoked requires; rule 142(3) (order in FORM GST DRC 05) | Use when the tax with interest, and any penalty the section invoked requires, has been paid within the period that concludes the proceedings. | ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount of penalty paid; percentage; anything the issue paragraphs leave open |
| `drc01_documents` | DRC-01 | Documents | Principles of natural justice; section 75(4); time to reply under rule 142(4) to run from the supply of the documents | Use when the notice relies on documents, statements or data not supplied with it, before replying on the merits. | description of each document, statement or data relied upon in the notice but not supplied; number of days |
| `drc01_adjournment` | DRC-01 | More time | Section 75(5): time and adjournment for sufficient cause, at most three times | Use to seek more time to file the reply or to adjourn the personal hearing; the Act allows at most three adjournments. | reason for which further time or an adjournment is needed; first, second or third; date up to which time is sought |
| `drc01b_explain` | DRC-01B | Explain | Rule 88C(1) and (2); reasons in Part B of FORM GST DRC 01B; rule 88C(3) | Use when the difference between the tax in GSTR 1 and GSTR 3B is explained and no tax is short paid. | reason for the difference, such as tax on supplies reported in FORM GSTR 1 for the period but paid with the return for a later tax period, supplies reported in FORM GSTR 1 in error and since amended, or credit notes and advances adjusted in a later period; amount; further reason, if any; anything the issue paragraphs leave open |
| `drc01b_pay` | DRC-01B | Accept and pay | Rule 88C(2): payment through FORM GST DRC 03 with interest under section 50, reported in Part B | Use when the difference is accepted and the tax with interest has been paid through FORM GST DRC 03. | ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; anything the issue paragraphs leave open |
| `drc01b_partial` | DRC-01B | Part accept | Rule 88C(2): part paid through FORM GST DRC 03, reasons for the unpaid part in Part B | Use when part of the difference is paid through FORM GST DRC 03 and the rest is explained. | amount accepted; ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount explained; reason for the difference, such as tax on supplies reported in FORM GSTR 1 for the period but paid with the return for a later tax period, supplies reported in FORM GSTR 1 in error and since amended, or credit notes and advances adjusted in a later period; amount; further reason, if any; anything the issue paragraphs leave open |
| `drc01c_explain` | DRC-01C | Explain | Rule 88D(1) and (2); reasons in Part B of FORM GST DRC 01C; rule 88D(3) | Use when the excess of the credit in GSTR 3B over GSTR 2B is explained and no credit was availed in excess. | reason for the difference, such as credit on invoices reflected in FORM GSTR 2B of a later tax period, credit reversed earlier and reclaimed, or credit not reflected in FORM GSTR 2B by its nature, such as tax paid on self invoices for supplies from unregistered persons; amount; further reason, if any; anything the issue paragraphs leave open |
| `drc01c_reverse_pay` | DRC-01C | Accept and pay | Rule 88D(2): an amount equal to the excess credit paid through FORM GST DRC 03 with interest under section 50 | Use when the excess credit has been reversed in a return or paid through FORM GST DRC 03, with interest where due. | amount; amount of interest paid, if any; ARN of FORM GST DRC 03 and date of payment, or the return in FORM GSTR 3B for the tax period in which the credit was reversed; anything the issue paragraphs leave open |
| `drc01c_partial` | DRC-01C | Part accept | Rule 88D(2): part paid through FORM GST DRC 03, reasons for the rest in Part B | Use when part of the excess credit is reversed or paid and the rest is explained. | amount accepted; amount; amount of interest paid, if any; ARN of FORM GST DRC 03 and date of payment, or the return in FORM GSTR 3B for the tax period in which the credit was reversed; amount explained; reason for the difference, such as credit on invoices reflected in FORM GSTR 2B of a later tax period, credit reversed earlier and reclaimed, or credit not reflected in FORM GSTR 2B by its nature, such as tax paid on self invoices for supplies from unregistered persons; further reason, if any; anything the issue paragraphs leave open |
| `gstr3a_filed` | GSTR-3A | Complied | Section 46 and rule 68; section 62 (no assessment once the return is furnished); late fee under section 47 and interest under section 50 | Use when the return named in the notice has been filed, to ask that the proceedings be dropped. | return and tax period; ARN of the return; date of filing; amount of late fee paid; amount of interest paid, if any; reason for the delay |
| `gstr3a_not_due` | GSTR-3A | Explain | Section 46 and rule 68 apply only to a return that is due; section 44 (exemption from the annual return by notification) | Use when the return was filed before the notice, or was not required of the noticee for the period. | reason, such as the return having been furnished before the notice, with its ARN and date, the noticee having paid tax under the composition levy for the period, the registration having been cancelled with effect from a date before the period, or the annual return not being required of the noticee for the financial year under an exemption notified under section 44 of the Act |
| `gstr3a_time` | GSTR-3A | More time | Section 46 and rule 68 (fifteen days); section 62 | Use when the return cannot be filed within the fifteen days allowed and a short extension is sought. | reason for the delay, such as the reconciliation of the books of account or a difficulty on the common portal; date by which the return will be furnished |
| `asmt14_contest` | ASMT-14 | Contest | Section 63; rule 100(2) (reply within fifteen days; order in FORM GST ASMT 15); natural justice | Use to oppose a best judgment assessment under section 63, for example where no registration was required or the tax was paid. | facts showing that the noticee was not liable to be registered, held a valid registration, or has paid the tax for the period; anything the issue paragraphs leave open |
| `asmt14_time` | ASMT-14 | More time | Rule 100(2) (fifteen days to reply); section 63; natural justice | Use when the reply to the proposed best judgment assessment needs more than the fifteen days allowed. | reason for which further time is needed; date up to which time is sought |
| `reg17_show_cause` | REG-17, REG-SCN | Contest | Section 29(2) and its first proviso (hearing); rule 22 (reply in FORM GST REG 18; proviso to rule 22(4); order in FORM GST REG 20); rule 21A (suspension) | Use when the business is running and the ground for cancellation can be answered, or the default has been made good. | address of the principal place of business; Reply to the ground stated in the notice, for example that all returns due have been furnished, with their ARNs, or that the documents called for are furnished with this reply.; Any further fact in support.; anything the issue paragraphs leave open |
| `reg17_consent` | REG-17, REG-SCN | Consent | Section 29(2); section 29(5) (credit on stock); section 45 and rule 81 (final return in FORM GSTR 10) | Use when the business has closed or registration is no longer required and the noticee agrees to cancellation. | reason, such as the closure of the business on a stated date or the aggregate turnover having fallen below the threshold for registration; date from which cancellation is sought; last tax period for which the return has been furnished; details of any dues, or state that there are none |
| `reg17_hearing_time` | REG-17, REG-SCN | More time | First proviso to section 29(2) (hearing); rule 22(1) (seven working days); rule 21A (suspension) | Use when the reply needs more time, or the noticee wishes to be heard before any decision on cancellation. | reason for which further time is needed; date up to which time is sought |
| `reg23_support` | REG-23 | Contest | Section 30; rule 23 (reply in FORM GST REG 24; revocation in FORM GST REG 22) | Use to answer the grounds on which rejection of the application for revocation of cancellation is proposed. | date of the order of cancellation; ARN of the application; date of the application; returns furnished, with ARNs and dates, and the amounts paid; address of the principal place of business; reason; Reply to each further ground stated in the notice. |
| `reg23_hearing` | REG-23 | More time | Rule 23(3) (seven working days to reply in FORM GST REG 24); natural justice | Use to ask for a personal hearing, and time if needed, before the application for revocation is decided. | date of the order of cancellation; ARN of the application; date of the application; reason for which further time is needed; date up to which time is sought |
| `reg03_clarify` | REG-03 | Explain | Rule 9(2) (reply in FORM GST REG 04 within seven working days); rule 9(4) | Use to answer each query raised on the application and to furnish the documents called for. | ARN of the application; date of the application; Query raised in the notice; Clarification and the document furnished |
| `reg03_time` | REG-03 | More time | Rule 9(2) (seven working days); rule 9(4) | Use when a document called for cannot be furnished within seven working days and a short extension is sought. | ARN of the application; date of the application; reason for which further time is needed, such as a document awaited from an authority; date up to which time is sought |
| `rfd08_support` | RFD-08 | Contest | Section 54; rule 89; rule 92(3) and its proviso (reply in FORM GST RFD 09; hearing); section 56 (interest) | Use to answer every ground of the proposed rejection and to seek the full refund claimed. | ARN of the refund application; date of the refund application; amount of refund claimed; category of refund, such as export of goods or services without payment of tax, accumulated credit due to an inverted duty structure, or excess balance in the electronic cash ledger; anything the issue paragraphs leave open |
| `rfd08_partial` | RFD-08 | Part accept | Rule 92(3) and its proviso (reply in FORM GST RFD 09); rule 93 (recredit of the part not pressed) | Use when part of the inadmissibility is accepted and the rest of the claim is pressed. | ARN of the refund application; date of the refund application; amount of refund claimed; category of refund, such as export of goods or services without payment of tax, accumulated credit due to an inverted duty structure, or excess balance in the electronic cash ledger; amount accepted as inadmissible; reason; balance amount pressed; anything the issue paragraphs leave open |
| `rfd08_time` | RFD-08 | More time | Rule 92(3) and its proviso (fifteen days to reply; hearing before rejection) | Use when the reply in FORM GST RFD 09 cannot be furnished within the fifteen days allowed. | ARN of the refund application; date of the refund application; amount of refund claimed; category of refund, such as export of goods or services without payment of tax, accumulated credit due to an inverted duty structure, or excess balance in the electronic cash ledger; reason for which further time is needed; date up to which time is sought |
| `rfd03_fresh_application` | RFD-03 | Complied | Rule 90(3) (fresh application after rectification; exclusion of the period for limitation); section 54(1); section 56 | Use when the deficiencies have been rectified and a fresh refund application has been filed. | ARN of the original application; date of the original application; deficiencies stated in the deficiency memo; ARN of the fresh application; date of the fresh application; Deficiency; How it has been rectified and the document furnished |
| `rfd03_contest` | RFD-03 | Contest | Rule 90(3) (a deficiency memo only for a deficient application); section 54(1) | Use when the documents said to be missing were filed with the original application, to ask that it be processed as filed. | ARN of the original application; date of the original application; deficiencies stated in the deficiency memo; Deficiency stated in the memo; Where and how the document was furnished with the original application |
| `mov07_contest` | MOV-07 | Contest | Section 129(1), (3) and (4) (hearing); rule 138 (e way bill); release in FORM GST MOV 05 | Use when the goods moved with proper documents, or the defect was minor, and there was no intent to evade tax. | date of detention; place of detention; vehicle number; invoice number; invoice date; e way bill number; discrepancy alleged in the notice; explanation of the discrepancy |
| `mov07_pay_release` | MOV-07 | Accept and pay | Section 129(1) and (5) (proceedings concluded on payment); rule 142(3); release in FORM GST MOV 05 | Use when the penalty proposed has been paid, to have the goods and conveyance released and the proceedings closed. | date of detention; place of detention; vehicle number; invoice number; invoice date; e way bill number; ARN of FORM GST DRC 03; date of payment; amount of penalty paid |
| `adt01_records` | ADT-01 | Complied | Section 65(3) and (5); rule 101(2) | Use to confirm the audit and to send the books of account and records called for. | records still being compiled, if any; date by which they will be furnished; name and designation of the person who will attend; date of the audit |
| `adt01_defer` | ADT-01 | More time | Section 65(3) and (4) (audit completed within three months of commencement); rule 101 | Use when the audit date or the deadline for records cannot be met and a later date is sought. | date of the audit stated in the notice; reason for which deferment is sought; date proposed for the audit |
| `adt02_contest` | ADT-02 | Contest | Section 65(6) and (7); rule 101(4) (findings finalised after considering the reply) | Use to contest the discrepancies or findings of audit before the officer proceeds to a show cause notice. | anything the issue paragraphs leave open |
| `adt02_accept_pay` | ADT-02 | Accept and pay | Sections 73(5) and 73(6) and the corresponding provisions of sections 74 and 74A; rule 142(2) (FORM GST DRC 04) | Use when the observations are accepted and the tax with interest has been paid through FORM GST DRC 03. | ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount of penalty paid; anything the issue paragraphs leave open |
| `adt02_partial` | ADT-02 | Part accept | Section 65(6) and (7); rule 101(4); section 73(5) and rule 142(2) for the part paid | Use when some observations are accepted and paid and the others are contested. | identify each observation accepted, with its amount; ARN of FORM GST DRC 03; date of payment; amount of tax paid; amount of interest paid; amount of penalty paid; anything the issue paragraphs leave open |
| `drc22_objection` | DRC-22 | Contest | Section 83(1); rule 159(5) (objection in FORM GST DRC 22A within seven days; hearing; release in FORM GST DRC 23); Radha Krishan Industries v. State of Himachal Pradesh (Supreme Court, 2021) | Use to object in FORM GST DRC 22A, within seven days of the attachment, that the property is not liable to attachment. | description of the property attached, such as the bank account number and the name of the bank; State the proceeding, if any, that is pending, and why no such necessity exists.; facts showing the effect of the attachment on the business; Any further ground, such as the demand having been paid, stayed or secured.; amount or part of the property |
| `drc22_release` | DRC-22 | Complied | Section 83; rule 159 (release in FORM GST DRC 23) | Use when the dues have been paid, the proceeding has concluded or an appeal is pending with pre deposit, to seek release. | description of the property attached, such as the bank account number and the name of the bank; event on which release is sought, such as payment of the amount due through FORM GST DRC 03 with its ARN and date, the conclusion of the proceeding in which the attachment was made, or an appeal filed with the pre deposit on which recovery stands stayed; the bank or other authority holding the property |
| `drc13_not_due` | DRC-13 | Explain | Section 79(1)(c) (no payment where the money is shown not to be due or held); rule 145(1) | Use when the noticee owes no money to, and holds no money for, the person named as the defaulter. | name and GSTIN of the person in default; Particulars of the account of the defaulter in the books of the noticee, such as the last transaction and the balance. |
| `drc13_complied` | DRC-13 | Complied | Section 79(1)(c) (payment a good discharge); rule 145(2) (certificate in FORM GST DRC 14) | Use when the amount directed has been deposited, to report it and to ask for the certificate in FORM GST DRC 14. | name and GSTIN of the person in default; amount paid; the amount specified in the notice, or the whole of the money due to or held for the defaulter where that is less; mode of payment and reference number; date of payment; Where the amount paid is less than the amount specified in the notice: The noticee states that the amount paid is the whole of the money that was due to or held for the defaulter when the notice was served, and that no further money is due or held. |
| `drc13_withdraw` | DRC-13 | Appeal or stay | Section 79(1)(c) (the officer may amend or revoke the notice); section 107(6) and (7) (deemed stay) | Use when the notice seeks to recover a demand against the taxpayer that has since been paid or stayed in appeal. | name of the person to whom the notice is addressed, such as a bank or a customer of the taxpayer; amount; order creating the demand, with its reference number and date; state the reason, such as the payment of the demand in full through FORM GST DRC 03 with its ARN and date, or the filing of an appeal under section 107 of the Act with the pre deposit required by section 107(6), on which the recovery of the balance stands stayed under section 107(7) of the Act |
| `summons_appear` | SUMMONS | Complied | Section 70 (summons to give evidence and produce documents) | Use to confirm that the person summoned will appear on the date fixed, with the documents called for. | name and designation of the person summoned; name and designation of the person who will appear; time of appearance; list of documents to be produced |
| `summons_new_date` | SUMMONS | More time | Section 70 | Use when the person summoned cannot appear on the date fixed, to propose another date. | name and designation of the person summoned; reason for which the person summoned cannot appear on the date fixed; date proposed for appearance |
| `aplhearing_attend` | APL-HEARING | Complied | Section 107(8) (hearing); section 116 (authorised representative) | Use to confirm that the appellant or its authorised representative will attend the appeal hearing on the date fixed. | ARN of the appeal; date of filing the appeal; order appealed against, with its reference number and date; name of the authorised representative; designation or professional qualification; time of hearing |
| `aplhearing_adjourn` | APL-HEARING | More time | Section 107(9): adjournment for sufficient cause, at most three times | Use when the appellant cannot attend on the date fixed; section 107(9) allows at most three adjournments. | ARN of the appeal; date of filing the appeal; order appealed against, with its reference number and date; reason for which the adjournment is sought; first, second or third; date proposed for the hearing |
| `aplhearing_written` | APL-HEARING | Contest | Section 107(8) (right of hearing reserved); section 115 (interest on refund of pre deposit) | Use when the appellant will not attend and asks that the appeal be decided on its written submissions. | ARN of the appeal; date of filing the appeal; order appealed against, with its reference number and date; brief statement of the facts; First ground on which the order is challenged; Further ground |
| `order_appeal_stay` | DRC-07, MOV-09 | Appeal or stay | Section 107(1) and (6) (pre deposit); section 107(7) (deemed stay of recovery of the balance) | Use after an appeal is filed with the pre deposit under section 107(6), to record that recovery of the balance stands stayed. | ARN of the appeal; date of filing the appeal; amount admitted, if any; amount of pre deposit; ARN or reference of the payment; date of payment; particulars of any recovery action taken |
| `order_paid_close` | DRC-07, DRC-07A, MOV-09, APL-04, RECT-ORDER | Complied | Section 78 (payment of the amount under the order); section 79 (recovery); electronic liability register | Use when the amount payable under the order has been paid in full and the demand should be shown as discharged. | amount of tax paid; amount of interest paid; amount of penalty paid; other amount paid; ARN of FORM GST DRC 03 or other reference of the payment; date of payment |
| `order_rectify` | DRC-07, DRC-07A, MOV-09, REG-19, APL-04, RFD-06, REG-05, RECT-ORDER, REG-CANCEL-REJ | Rectify | Section 161 (rectification of an error apparent on the face of the record; three months); rule 142(7) (FORM GST DRC 08) | Use when the order has an error apparent on the face of the record; the application lies within three months of the order. | Error apparent on the face of the record, and the correct position as shown by the record; Further error, if any; documents on record that show the error, such as the reply filed, the payments made through FORM GST DRC 03 or the returns furnished; effect of the rectification, such as the corrected amount payable or the relief to be allowed |
| `drc07a_status` | DRC-07A | Appeal or stay | Section 142(8)(a) (existing law dues recoverable only to the extent not recovered under that law); rule 142A (summary in FORM GST DRC 07A, modification in FORM GST DRC 08A) | Use when the demand under the existing law uploaded for recovery has been paid, reduced, set aside or stayed. | amount of the demand; name of the existing law, such as the State Value Added Tax Act or the Central Excise Act, 1944; order creating the demand, with its reference number and date; paid, reduced, set aside or stayed; particulars, such as the challans for the payment made, the appellate order setting aside or reducing the demand, or the order of stay and the pre deposit made; amount that remains recoverable, or nil |
| `reg19_revocation` | REG-19 | Contest | Section 30; rule 23 (application in FORM GST REG 21; revocation in FORM GST REG 22; notice in FORM GST REG 23 before rejection) | Use with FORM GST REG 21, once the pending returns have been filed and the dues paid, to have the registration restored. | ground stated in the order of cancellation; returns furnished, with ARNs and dates, and the amounts paid; address of the principal place of business; reason for the default |
| `apl04_tribunal` | APL-04 | Appeal or stay | Section 112(1) (appeal in FORM GST APL 05); section 112(8) (pre deposit); section 112(9) (deemed stay) | Use after an appeal against the appellate order is filed before the Tribunal with the pre deposit under section 112(8). | order originally appealed against, with its reference number and date; ARN or filing reference of the appeal; date of filing the appeal; amount admitted, if any; amount of pre deposit; amount paid earlier; ARN or reference of the payment; date of payment |
| `order_appeal_intent` | RFD-06, REG-05, RECT-ORDER, REG-CANCEL-REJ | Appeal or stay | Section 107(1) (appeal within three months of communication); section 161 | Use to place on record that the order is not accepted and that an appeal will be filed within the time allowed. | operative part of the order, such as the rejection of the application or the amount disallowed; principal grounds on which the order will be challenged |
| `rfd06_recredit` | RFD-06 | Consent | Rule 93 (recredit in FORM GST PMT 03; a refund deemed rejected on an undertaking not to appeal) | Use when the rejection of the refund is accepted, so that the amount debited is recredited to the ledger in FORM GST PMT 03. | ARN of the refund application; date of the refund application; amount rejected; amount to be recredited; electronic credit ledger or electronic cash ledger |
| `order_reconsider` | REG-05, REG-CANCEL-REJ | General | Rule 9 (registration) or rules 20 to 22 (cancellation on application), as the case may be; section 107 reserved | Use when the defect that led to the rejection has been cured and a fresh application has been filed. | ARN of the application rejected; date of that application; ground of rejection stated in the order; steps taken to cure the defect, such as the documents now obtained or the returns now furnished; ARN of the fresh application; date of the fresh application |
| `general_reply` | General (any form without its own) | General | The provision under which the notice is issued; natural justice | Use for a notice without a template of its own, to reply on the facts and the law. | anything the issue paragraphs leave open |
| `general_comply` | General (any form without its own) | Complied | The provision under which the notice is issued | Use when the notice calls for information, documents or an action that the noticee has furnished or taken. | information furnished, documents enclosed and action taken in compliance with the notice |
| `general_time` | General (any form without its own) | More time | The provision under which the notice is issued; natural justice | Use when more time is needed to reply to a notice that has no template of its own. | reason for which further time is needed; date up to which time is sought |

## Options per notice type

In the order the notice page shows them (`sort`, then key).

| Form | Options |
|---|---|
| ASMT-10 | 4: `asmt10_explain`, `asmt10_accept_pay`, `asmt10_partial`, `asmt10_time` |
| DRC-01A | 3: `drc01a_contest`, `drc01a_pay`, `drc01a_partial` |
| DRC-01 | 5: `drc01_contest`, `drc01_partial`, `drc01_pay_conclude`, `drc01_documents`, `drc01_adjournment` |
| DRC-01B | 3: `drc01b_explain`, `drc01b_pay`, `drc01b_partial` |
| DRC-01C | 3: `drc01c_explain`, `drc01c_reverse_pay`, `drc01c_partial` |
| GSTR-3A | 3: `gstr3a_filed`, `gstr3a_not_due`, `gstr3a_time` |
| ASMT-14 | 2: `asmt14_contest`, `asmt14_time` |
| REG-17 | 3: `reg17_show_cause`, `reg17_consent`, `reg17_hearing_time` |
| REG-SCN | 3: `reg17_show_cause`, `reg17_consent`, `reg17_hearing_time` |
| REG-23 | 2: `reg23_support`, `reg23_hearing` |
| REG-03 | 2: `reg03_clarify`, `reg03_time` |
| RFD-08 | 3: `rfd08_support`, `rfd08_partial`, `rfd08_time` |
| RFD-03 | 2: `rfd03_fresh_application`, `rfd03_contest` |
| MOV-07 | 2: `mov07_contest`, `mov07_pay_release` |
| ADT-01 | 2: `adt01_records`, `adt01_defer` |
| ADT-02 | 3: `adt02_contest`, `adt02_accept_pay`, `adt02_partial` |
| DRC-22 | 2: `drc22_objection`, `drc22_release` |
| DRC-13 | 3: `drc13_not_due`, `drc13_complied`, `drc13_withdraw` |
| SUMMONS | 2: `summons_appear`, `summons_new_date` |
| APL-HEARING | 3: `aplhearing_attend`, `aplhearing_adjourn`, `aplhearing_written` |
| DRC-07 | 3: `order_appeal_stay`, `order_paid_close`, `order_rectify` |
| DRC-07A | 3: `drc07a_status`, `order_paid_close`, `order_rectify` |
| MOV-09 | 3: `order_appeal_stay`, `order_paid_close`, `order_rectify` |
| REG-19 | 2: `reg19_revocation`, `order_rectify` |
| APL-04 | 3: `apl04_tribunal`, `order_paid_close`, `order_rectify` |
| RFD-06 | 3: `order_appeal_intent`, `rfd06_recredit`, `order_rectify` |
| REG-05 | 3: `order_reconsider`, `order_appeal_intent`, `order_rectify` |
| RECT-ORDER | 3: `order_appeal_intent`, `order_paid_close`, `order_rectify` |
| REG-CANCEL-REJ | 3: `order_reconsider`, `order_appeal_intent`, `order_rectify` |
| Any other form, or none | 3: `general_reply`, `general_comply`, `general_time` |

No templates for the information only types (DROPPED, ACCEPTED, LUT, LUT-APPROVED, APL-01,
APL-02, REG-06, REG-15, REG-22, SPL-APPROVED, DRC-03, PMT-03, RFD-04, ADT-CLOSURE): they need
no reply, and the renderer prepares none for a type whose response need is "none". DRC-01 has
five options (contest, part acceptance, payment and conclusion, documents relied upon, more
time), one more than the usual four, because each answers a different situation.

## How a reply is built

Every body has the same shape: "To," and "The {{officer}}"; a Subject line naming the form, the
reference number, the date and DIN, and the period; "Respected Sir/Madam,"; numbered paragraphs
(the facts of the notice, the submissions or explanation, the issue paragraphs where the form
raises issues, the enclosures, the prayer); and the signature block ("Thanking you,", "Yours
faithfully,", "For <taxpayer>", signatory, GSTIN, place, date).

- **Issue paragraphs.** Templates that answer issues carry `{{issues_contest_paras}}` or
  `{{issues_accept_paras}}`. The renderer writes "Issue (a): <title> (Rs. X)" and then the
  issue code's `para_contest` or `para_accept` from `reply_issue_types`, or a general paragraph
  for an issue without a code. The paragraphs are written impersonally ("It is respectfully
  submitted that ...", "... is accepted") so they fit any template, and contain no placeholders.
- **Part acceptance** templates (stance "Part accept") list the part accepted as a fill-in and
  then contest every issue: delete the issue paragraphs of the issues that were accepted.
- **The defined party** is "the noticee" in replies to notices (the fallback issue paragraphs
  use that word too), "the applicant" in applications, "the appellant" in appeals and "the
  taxpayer" in letters about orders. Every reply defines "the Act" (the CGST Act), "the Rules"
  and states that the State Act is in pari materia.
- **Payments** through FORM GST DRC 03 use `{{payment_clause}}` ("through FORM GST DRC 03 vide
  ARN [ARN of FORM GST DRC 03] dated [date of payment]") followed by the amounts as fill-ins.
  Penalty rates and pre deposit percentages are never written into a template: they depend on
  the section invoked and have changed with recent Finance Acts, so the person fills them in.

## Points to verify

Checked, but worth a partner's confirmation before first use:

1. **Circulars 183/15/2022 GST (27 December 2022) and 193/05/2023 GST (17 July 2023)** in the
   ITC_2A_V_3B and ITC_NONFILER paragraphs: the periods each covers (as the firm position
   already says).
2. **Rule 90(3), exclusion of time** (`rfd03_fresh_application`): the period from the original
   refund application to the deficiency memo is excluded from the two years of section 54(1)
   for the fresh application (proviso inserted in 2022).
3. **Section 79(1)(c)** (`drc13_not_due`, `drc13_complied`, `drc13_withdraw`): the relief for a
   garnishee who shows no money is due, the good discharge and the power to revoke are cited by
   the clause only, not by sub-clause.
4. **Section 74A** (financial year 2024/25 onwards) is cited only as "the corresponding
   provisions" of sections 73 and 74. Its sub-section numbers are not cited.
5. **REG-SCN** shares the REG-17 templates. When it is a suspension notice under rule 21A(2A)
   (FORM GST REG 31), check the reply period and the form the portal takes the reply in.
6. **DRC-07A**: the status letter asks for a summary in FORM GST DRC 08A under rule 142A. An
   appeal against the order itself lies under the existing law, not under section 107, which is
   why DRC-07A has no section 107 appeal template.
7. **Case law** is limited to Radha Krishan Industries v. State of Himachal Pradesh (Supreme
   Court, 2021) on provisional attachment, cited by name and year only.

## The no-hyphen rule

No reply may contain a hyphen or a dash of any kind. That means U+002D, U+2010 to U+2015, U+2212,
U+FE58, U+FE63, U+FF0D and the soft hyphen U+00AD. `public.reply_has_dash()` enforces it on
every template title, summary and body, on both issue paragraphs, on the signature settings and
on every rendered reply, so a template that breaks the rule cannot be saved. Facts are cleaned
before they go in (DRC-01 becomes DRC 01, 2023-24 becomes 2023/24).

When editing, write:

- "show cause notice", "pre deposit", "e way bill", "self invoices", "semi finished", "non
  business", "non filing", "recredit", "bona fide", "time barred", "pre GST", "email";
- "FORM GST DRC 01", "FORM GSTR 3B", "rule 88C", "Circular No. 183/15/2022 GST";
- "1 April 2023 to 31 March 2024", "financial year 2023/24";
- "Rs. 1,23,456", never "Rs. 1,23,456/-".

Ranges are written with "to" and compounds as two words.

## Editing the templates

- **Where.** The `reply_templates` table: `title` (short and plain), `summary` (one sentence
  saying when to use it), `stance`, `forms` (form codes; empty means general), `sort`, `body`,
  `is_active`. Issue paragraphs are `reply_issue_types.para_contest` and `para_accept` (two to
  five sentences, no placeholders).
- **What happens.** An edit raises the template's `version` and prepares the options of every
  open notice again; drafts already started keep their own text.
- **Placeholders.** Use only the keys `notice_reply_context()` fills: `today_long`, `client_name`,
  `gstin`, `sgst_act`, `form_name`, `form_title`, `form_code_text`, `notice_ref`,
  `notice_date_long`, `din_clause`, `officer`, `section_text`, `section_short`, `period_text`,
  `fy_text`, `demand_total_text`, `demand_total_figure`, `demand_heads_text`, `reply_due_long`,
  `hearing_clause`, `hearing_date_long`, `issues_list`, `issues_contest_paras`,
  `issues_accept_paras`, `annexure_list`, `payment_clause`, `place`, `signatory`. An unknown key
  shows as "[key]".
- **Write for the fallbacks.** Each placeholder has a fallback phrase, so every sentence must
  read well both ways:
  - "the amount proposed in the notice", "the amounts set out therein";
  - "the period covered by the notice", "the date specified in the notice";
  - "[reference number]", "[date of the notice]", "Proper Officer", "[List of documents enclosed]".
  - `{{din_clause}}` (", bearing Document Identification Number X,") and `{{hearing_clause}}` may
    be empty. So follow `{{din_clause}}` with a word, never a comma, and put `{{hearing_clause}}`
    where a missing sentence leaves no gap.
  - `{{officer}}` has no article: write "The {{officer}}".
- **Retiring a template.** Switch it off (`is_active = false`) rather than deleting it. The
  seed adds templates with `ON CONFLICT (key) DO NOTHING`, so a deleted one comes back if the
  seed is run again, while an edited or switched-off one is left as the firm set it. Issue
  paragraphs are only filled where empty.
- **Checks.** Run `supabase/tests/notices/run.sh`. `test_101_reply_templates` renders a notice
  of every form with every fact and with none. It checks the dashes, placeholders, shape,
  numbering and option counts, and that a re-run keeps the firm's edits.
