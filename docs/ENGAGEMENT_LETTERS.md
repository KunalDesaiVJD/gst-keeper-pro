# Engagement letters e-signed by the client

Asked by the firm on 28 October 2026: "In Reply Factory → Client consent, an
Engagement Letter template which I can send directly to a client by e-mail; the
client opens it from the e-mail and gives consent by e-signature. Check the DPDP
Act, which applies to CAs in India, and keep every relevant clause. The e-mail
opens a one page summary; only a link inside it opens the entire letter. Once the
client e-signs, the portal records everything."

Implemented by engineering judgement. **The letter's text is a draft for a
partner's review, not legal advice the firm has signed off**: version 1 is seeded
as a draft and nothing can be sent until a GST Manager or the superadmin reads it,
fills the firm's details and publishes it.

## The flow

1. **Template** (Reply Factory → Client consent → *Read and edit the letter*):
   `engagement_letter_templates`, one row per version: title, opening, clauses
   (each with its line for the one page summary) and the firm's details (name,
   FRN, address, e-mail, engagement partner and membership number, grievance
   officer and e-mail, city). Placeholders in double braces (`{{client_name}}`,
   `{{gstin}}`, `{{services}}`, `{{fees}}`, `{{start_date}}`, the firm's fields)
   are filled for each client. A published version never changes: saving it
   starts the next version as a draft. One version is published at a time
   (`engagement_letter_template_publish`, which refuses while a required firm
   detail is empty).
2. **Send** (tick clients → *Send engagement letter*, or *Send* on a row): the
   services (ticked from a list, others typed), the fees, the start date, how many
   days the link lasts (3 to 90, default 30), an optional line for the e-mail,
   and, for one client, the To and CC addresses (many clients each get their own
   e-mail on file). `engagement_letter_create` makes one letter per client: the
   text is rendered then and fixed, with its SHA-256 (`doc_sha256`). A client
   with a letter still open is left out unless *withdraw and send the new one* is
   ticked. Then the Edge Function `engagement-letter` (`send`) mints the link's
   token, stores only its hash, and e-mails the letter through Microsoft Graph.
3. **The e-mail is the one page summary**: the letter's facts, a *Review and
   e-sign* button, and every clause in a line with *Read clause n in full*,
   which opens `https://gst.vjdesai.com/engagement/<token>?clause=n`.
4. **The page** `/engagement/<token>` (public, no login) opens on the summary;
   a clause link or *Read the full engagement letter* opens the full text (and
   records that it was opened). The fingerprint of the text is recomputed in the
   browser and shown as matching.
5. **E-signature**, open only once the full letter was opened (the database
   refuses before): full name; capacity (proprietor, partner, director,
   authorised signatory and others); two required boxes (the terms, and the
   processing of personal data in clause 9); an explicit **yes or no to AI
   tools** (clause 11, optional, no default); the typed name as the signature and
   an optional drawn one; then a 6 digit code e-mailed to the letter's address
   (marked with a 4 letter reference, valid 30 minutes, 5 tries, 5 codes an hour
   and 10 a day per letter). `engagement_letter_sign` checks it all.
6. **What is recorded**: the letter becomes *signed* with the signer's name,
   capacity and e-mail and the consents; the drawn signature and the network
   address and browser of the signing are kept apart; every step is an event
   (made, e-mailed, summary opened, full letter opened, code asked and e-mailed,
   a refused signature, signed, changes asked, AI consent withdrawn, signed copy
   e-mailed, withdrawn by the firm), each with its time, network address and
   browser. **The AI consent goes onto the client by itself**: yes sets
   `ai_consent_at` (the day signed) with the letter in `ai_consent_note`; no sets
   `ai_opt_out`.
7. **Signed copy**: the Edge Function (`copy`, once) e-mails the signer (and the
   CC) a confirmation with the consents, the fingerprint and its own link to the
   signed letter (which keeps working), and the firm's mailbox a note with a link
   to the record. The page offers the signed letter as a PDF with a certificate of
   signing; staff get the same PDF with every step, network address, browser and
   the drawn signature.
8. **Later**: from the signed letter's page the client can withdraw the AI
   consent with a code (DPDP s.6(4): as easy as giving it), which sets
   `ai_opt_out` on the client. Before signing, the client can send *something to
   change* (recorded; the letter stays signable). Staff can e-mail a new link (the
   earlier one stops working once the new e-mail is out; if it fails, the earlier
   one keeps working) or withdraw a letter, and send a new one after a signature.

## Security

- The token (32 random bytes) and the codes are minted for one e-mail each, never
  stored or logged (only SHA-256 hashes, in `engagement_letter_tokens` and
  `engagement_letter_codes`, RLS on and no policies) and never go through
  `email_outbox`, which the anon key can read. The messages are not kept in the
  firm's Sent Items (`_shared/graph.ts`), so a person with the mailbox cannot sign
  for a client.
- `engagement_letters` and `engagement_letter_templates` are open to read (the app
  has no Supabase session, CLAUDE.md); no table has a write policy: every write is
  one of the functions. `engagement_letter_events` and
  `engagement_letter_signatures` are private; staff read them through
  `engagement_letter_audit` (a staff member only).
- The service role alone may mint and mark (`engagement_letter_issue`,
  `_mark_sent`, `_code_claim`, `_code_mark`, `_copy_claim`, `_copy_mark`).
  Sending, resending, withdrawing and the template are a GST Manager's or the
  superadmin's (`notice_case_admin`).
- The link's address is fixed to `https://gst.vjdesai.com`, never read from a
  setting. The network address comes from the request (`cf-connecting-ip`,
  `x-real-ip`, else the first `x-forwarded-for`), checked on live.

## What the letter covers (version 1)

Who the parties are; the services; the client's responsibilities (records,
information on time, approval of each return, payment, self assessment under
s.59 and rule 83); the firm's (ICAI standards, due care); the portal and the
authority to act (GST Practitioner, s.116 representation); notices, replies and
appeals; fees; confidentiality (Chartered Accountants Act, 1949, ICAI Code of
Ethics); and, for the **Digital Personal Data Protection Act, 2023** and the
**DPDP Rules, 2025** (notified 13 November 2025; Rule 4 from 13 November 2026,
Rule 3 and Rules 5 to 16 from 13 May 2027):

- **Roles**: the firm as Data Fiduciary for the personal data of the client and
  its proprietor, partners, directors and authorised persons; as Data Processor
  (s.8(2)) for the personal data in the client's records (customers, suppliers,
  employees), on the client's instructions in the letter.
- **The notice** (s.5, Rule 3): the data itemised, the purposes, how to withdraw
  consent and exercise rights, and the complaint to the Board.
- **Consent** (s.6): for the processing the services need, with AI tools as a
  separate, optional consent; withdrawal as easy as giving it.
- **Safeguards and sharing** (s.8(5), Rule 6): access limited to the staff on the
  client's matters, encrypted connections, records of access and changes,
  backups, contracts binding the service providers; the service providers named
  (cloud database and hosting, Microsoft 365, the GST portal and GSTN, the AI
  service only with consent); transfer outside India as s.16 permits; no sale or
  advertising use.
- **Retention and erasure** (s.8(7)): at least 72 months from the annual return's
  due date (s.36, CGST Act), longer while a proceeding is pending; the letter and
  its record for eight years after the engagement.
- **Rights** (ss.11 to 14) and duties (s.15), the grievance officer, an answer
  within 90 days, the Data Protection Board.
- **Breach** (s.8(6), Rule 7): the persons affected told without delay; the Board
  told without delay, with the detailed report within 72 hours; the client told
  without delay where the firm is its processor.

Then the limit of liability, ending the engagement and the handover,
communication and the electronic signature (s.10A, Information Technology Act,
2000), and general terms (Indian law, arbitration at the firm's city).

## Before publishing: for the partner to confirm

- Every clause, and the firm's details (FRN, address, partner, membership number,
  grievance officer and e-mail).
- **Clause 11**: that the AI service is used "only on terms that require the
  provider to keep your data confidential and to use it only to provide the
  service to us". The firm reaches Claude through its own CLI gateway on the
  firm's Claude subscription (CLAUDE.md); confirm that the plan's terms say so
  (including whether inputs may be used to train models), or change the clause.
- **Clause 10**: where the cloud database is hosted, and whether to name the
  providers in full.
- **Clause 12**: the eight years for the letter and its record.
- **Clause 15**: the limit of liability (12 months' fees for the service).
- The e-signature is a click-to-accept signature confirmed by a code e-mailed to
  the client (s.10A); it is not an Aadhaar eSign or a DSC under s.3A.

## Files

- Migration `supabase/migrations/20261028110000_engagement_letters.sql`.
- Edge Function `supabase/functions/engagement-letter/` (`handler.ts`,
  `message.ts`; tests `deno test --allow-read supabase/functions/engagement-letter/test/`).
  It reaches the database with plain PostgREST calls (no supabase-js).
- App: `src/lib/engagementLetters.ts` (data, PDF), `src/lib/engagementLetterRules.ts`
  (state, fingerprint; `node --experimental-strip-types scripts/verify-engagement-letter.mjs`),
  `src/pages/EngagementLetterPage.tsx` (the client's page),
  `src/components/notices/reply/factory/EngagementLetters.tsx` and `ConsentTab.tsx`
  (staff). The e-mail shell's kinds `engagement_letter`, `_code` and `_signed` are
  in `_shared/email.ts` and its mirror `src/lib/emailTemplate.ts`.
