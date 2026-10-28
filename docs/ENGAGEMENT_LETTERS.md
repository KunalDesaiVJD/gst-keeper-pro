# Engagement letters e-signed by the client

Asked by the firm on 28 October 2026: "In Reply Factory → Client consent, an
Engagement Letter template which I can send directly to a client by e-mail; the
client opens it from the e-mail and gives consent by e-signature. Check the DPDP
Act, which applies to CAs in India, and keep every relevant clause. The e-mail
opens a one page summary; only a link inside it opens the entire letter. Once the
client e-signs, the portal records everything."

Implemented by engineering judgement. **The letter's text is a draft for a
partner's review, not legal advice the firm has signed off**: version 1 was seeded
as a draft, filled and published by the firm. The same day the firm asked for
version 2 (migration `20261028130000`): "default permission is Yes only … if the
client does not want then will not sign it", "Email is too long so only signing
link", "PDF … properly structured … justify view", the signed e-mail "very short
… only … download the signed letter", "design letter only in 3 pages - keep AI
paragraph only in 1/2 liners … no need to name any AI tool", "delete fees
clause". Version 2 is published with the firm's details, version 1 retired (the
letter signed on it keeps its text). Version 3 (`20261028150000`, the firm: "no
need of mentioning anything related to fees"; "no need of withdraw my consent
link as if they want to then they will send us an email") names no fee of any
kind: clause 14 limits the firm's liability to direct loss from its own
negligence or wilful default (no cap by the fees), clauses 3, 6 and 14 name tax,
interest and penalties; clauses 10 (AI, two lines) and 11 (records, eight years
for the letter) stay as in version 2. The signed page no longer offers to
withdraw the AI consent.

The firm's details are kept once (the firm: "save everything our firm details …
permanently"): the table `firm_profile` (one row, open to read, written only by a
migration) and `REPORT_FIRM` in `src/utils/reportTheme.ts`: V. J. Desai & Co. LLP,
FRN 113541W/W101248, B-901/902, Ratnaakar Nine Square, Opp ITC Narmada,
Satellite, Ahmedabad-380015, engagement partner CA Kunal Desai (Membership No.
153784), grievance officer Mukesh Baldha (info@vjdesai.com).

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
   services (ticked from a list, others typed), the fees only when the published
   letter quotes `{{fees}}` (version 2 does not), the start date, how many
   days the link lasts (3 to 90, default 30), an optional line for the e-mail,
   and, for one client, the To and CC addresses (many clients each get their own
   e-mail on file). `engagement_letter_create` makes one letter per client: the
   text is rendered then and fixed, with its SHA-256 (`doc_sha256`). A client
   with a letter still open is left out unless *withdraw and send the new one* is
   ticked. Then the Edge Function `engagement-letter` (`send`) mints the link's
   token, stores only its hash, and e-mails the letter through Microsoft Graph.
3. **The e-mail carries only the link** (two short lines and a *Review and sign*
   button to `https://gst.vjdesai.com/engagement/<token>`).
4. **The page** `/engagement/<token>` (public, no login) opens on the one page
   summary, each clause in a line; a clause (`?clause=n`) or *Read the full
   engagement letter* opens the full text, justified (and
   records that it was opened). The fingerprint of the text is recomputed in the
   browser and shown as matching.
5. **E-signature**, open only once the full letter was opened (the database
   refuses before): full name; capacity (proprietor, partner, director,
   authorised signatory and others); **one box**: the whole letter agreed, its
   personal data and technology clauses included (the signature is the AI
   consent too: no separate question, the firm's choice of 28 October 2026; the
   page sends `ai_processing: true`); the typed name as the signature and
   an optional drawn one; then a 6 digit code e-mailed to the letter's address
   (marked with a 4 letter reference, valid 30 minutes, 5 tries, 5 codes an hour
   and 10 a day per letter). `engagement_letter_sign` checks it all.
6. **What is recorded**: the letter becomes *signed* with the signer's name,
   capacity and e-mail and the consents; the drawn signature and the network
   address and browser of the signing are kept apart; every step is an event
   (made, e-mailed, summary opened, full letter opened, code asked and e-mailed,
   a refused signature, signed, changes asked, AI consent withdrawn, signed copy
   e-mailed, withdrawn by the firm), each with its time, network address and
   browser. **The AI consent goes onto the client by itself**: `ai_consent_at`
   (the day signed) with the letter in `ai_consent_note` (a withdrawal sets
   `ai_opt_out`).
7. **Signed copy**: the Edge Function (`copy`, once) e-mails the signer (and the
   CC) one line and a *Download the signed letter* button (its own link with
   `?download=1`, which downloads the PDF at once and keeps working), and the
   firm's mailbox a note with a link to the record. **The PDF**: the letterhead
   (logo, address, e-mail and phone), the reference and date, the addressee, the
   subject, the clauses numbered with their text justified (jsPDF's own word
   spacing, so it copies with its spaces), then the firm's signature (partner and
   membership number) beside the client's acceptance (the typed and any drawn
   signature, name, capacity, time), a line on how it was signed with the
   fingerprint, and every page footed with the reference and its number: three
   pages for version 2. Staff get the same PDF with a page more: every step,
   network address and browser.
8. **Later**: a client who wants to withdraw the AI consent writes to the
   grievance officer (clause 8; the firm's choice of 28 October 2026, the page
   offers no withdrawal since version 3), and staff record it on the client
   (`ai_opt_out`); the database door `engagement_letter_withdraw_ai` (a code to
   the letter's address, setting `ai_opt_out`) stays, unused by the page. Before signing, the client can send *something to
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

## What the letter covers (version 3, 17 clauses)

Who the parties are; the services; the client's responsibilities (records,
information on time, approval of each return, payment, self assessment under
s.59 and rule 83); the firm's (ICAI standards, due care); the portal and the
authority to act (GST Practitioner, s.116 representation); notices, replies and
appeals; confidentiality (Chartered Accountants Act, 1949, ICAI Code of
Ethics); and, for the **Digital Personal Data Protection Act, 2023** and the
**DPDP Rules, 2025** (notified 13 November 2025; Rule 4 from 13 November 2026,
Rule 3 and Rules 5 to 16 from 13 May 2027):

- **Roles**: the firm as Data Fiduciary for the personal data of the client and
  its proprietor, partners, directors and authorised persons; as Data Processor
  (s.8(2)) for the personal data in the client's records (customers, suppliers,
  employees), on the client's instructions in the letter.
- **The notice** (s.5, Rule 3): the data itemised, the purposes, how to withdraw
  consent and exercise rights, and the complaint to the Board.
- **Consent** (s.6): the signature, for the processing the services need;
  withdrawal by writing to the grievance officer.
- **Technology tools** (clause 10): two lines, naming no tool: secure AI tools
  may help read documents and prepare drafts; a member of the firm reviews all
  such work before anything is filed or sent.
- **Safeguards and sharing** (s.8(5), Rule 6): access limited to the staff on the
  client's matters, encrypted connections, records of access and changes,
  backups, contracts binding the service providers; the kinds of service
  provider (hosting, e-mail, the GST portal and GSTN, the tools of clause 10);
  transfer outside India as s.16 permits; no sale or advertising use.
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

## For the partner to confirm

- Every clause of version 2. Clause 10 now says only that secure AI tools may help
  and that a member of the firm reviews all such work; confirm that the terms of
  the firm's AI service keep its data confidential (and whether inputs may be used
  to train models), as the firm's own obligation under clause 9.
- Clause 11: the eight years for the letter and its record (kept, the firm's
  choice). Clause 14: liability to direct loss from the firm's own negligence or
  wilful default, with no cap by the fees (version 3).
- The signature as the AI consent: a client who will not consent does not sign
  (the firm's choice); a signed client withdraws it by e-mail to the grievance
  officer (DPDP s.6(4)), which staff record.
- The e-signature is a click-to-accept signature confirmed by a code e-mailed to
  the client (s.10A); it is not an Aadhaar eSign or a DSC under s.3A.

## Files

- Migrations `supabase/migrations/20261028110000_engagement_letters.sql` and
  `20261028130000_engagement_letter_v2.sql` (firm_profile, fees only when quoted, version 2) and
  `20261028150000_engagement_letter_v3.sql` (version 3).
- Edge Function `supabase/functions/engagement-letter/` (`handler.ts`,
  `message.ts`; tests `deno test --allow-read supabase/functions/engagement-letter/test/`).
  It reaches the database with plain PostgREST calls (no supabase-js).
- App: `src/lib/engagementLetters.ts` (data, PDF), `src/lib/engagementLetterRules.ts`
  (state, fingerprint; `node --experimental-strip-types scripts/verify-engagement-letter.mjs`),
  `src/pages/EngagementLetterPage.tsx` (the client's page),
  `src/components/notices/reply/factory/EngagementLetters.tsx` and `ConsentTab.tsx`
  (staff). The e-mail shell's kinds `engagement_letter`, `_code` and `_signed` are
  in `_shared/email.ts` and its mirror `src/lib/emailTemplate.ts`.
