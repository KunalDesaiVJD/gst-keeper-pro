// Regenerates docs/Builder_GST_Staff_Guide.docx — a five-page walkthrough of
// the Builder module for staff preparing promoter returns. Re-run this after
// any change to the module's workflow so the guide doesn't go stale:
//
//   node scripts/generate-builder-staff-guide.mjs
//
// This is plain content generation, not application code: it has no runtime
// dependency on the app and produces a static .docx handed to staff.

import { writeFileSync } from 'node:fs';
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, PageBreak, ShadingType,
} from 'docx';

const H1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 120 } });
const H2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 100 } });
const bullet = (text, opts = {}) => new Paragraph({
  children: [new TextRun({ text, ...opts })], bullet: { level: 0 }, spacing: { after: 60 },
});
const note = (text) => new Paragraph({
  children: [new TextRun({ text, italics: true, color: '555555' })],
  spacing: { before: 60, after: 120 },
  shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
});

const cell = (text, opts = {}) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold })] })],
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  shading: opts.header ? { type: ShadingType.CLEAR, fill: 'E5E7EB' } : undefined,
});

const table = (headerRow, rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    left: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    right: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD' },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD' },
  },
  rows: [
    new TableRow({ children: headerRow.map((t, i) => cell(t, { header: true, width: widths?.[i] })) }),
    ...rows.map((r) => new TableRow({ children: r.map((t, i) => cell(t, { width: widths?.[i] })) })),
  ],
});

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } }, // 11pt
    },
  },
  sections: [{
    properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
    children: [
      new Paragraph({
        children: [new TextRun({ text: 'Builder GST Module — Staff Guide', bold: true, size: 40 })],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({
          text: 'V. J. Desai & Co. LLP — preparing GST returns for real-estate promoter clients',
          italics: true, color: '555555', size: 22,
        })],
        spacing: { after: 300 },
      }),

      // ── Page 1: One-time setup ──────────────────────────────────────────
      H1('1. One-time setup — do this once per project, not every month'),
      P(
        'Everything in this section happens once when a project is onboarded, not on a monthly cadence. '
        + 'Open a project from Builder → Projects, or use "Project setup" inside the workspace’s '
        + 'Client setup panel — both open the same dialog.',
      ),
      H2('1.1 Project settings'),
      P('One dialog holds every project-level election:'),
      bullet('Metro / non-metro — sets the affordable-housing carpet limit (60 sq m metro, 90 sq m elsewhere).'),
      bullet('Grouping level (Block / Wing / Tower / Phase) — how BU permission is expected to arrive.'),
      bullet('Carpet-area source — derived from the unit master, or entered manually for the 15% test.'),
      bullet('Document series prefix — used on every invoice/receipt doc number for this project.'),
      bullet('Opening cut-off date — the day this software takes over from the client’s earlier records.'),
      bullet('TDR/FSI treatment — pay RCM at 18%, or withhold pending written client instruction.'),
      note('The live RREP badge in this dialog shows the project’s current 15% classification as you type — check it before saving a manual carpet-area override.'),

      H2('1.2 Units and opening balances'),
      P('From a project’s Units tab:'),
      bullet('Add unit / Add many — single or bulk unit entry, with charge heads.'),
      bullet(
        'Opening balances — for a project onboarded mid-stream, set every unit’s starting position in one '
        + 'grid: one shared as-at date for the whole project, then per-unit agreement value, value already '
        + 'taxed, CGST/SGST paid, receipts (memo) and TDS to date. Only rows with an agreement value entered '
        + 'are saved — a unit left blank is not touched.',
      ),
      note('"Value already taxed" is the base a later BU event deducts from — enter what was offered to tax, never what was merely received.'),

      H2('1.3 Onboarding status — units already closed before this software saw the project'),
      P(
        'Some units may already be fully resolved under the firm’s earlier records by the time a project '
        + 'is onboarded here — BU received, dastavej registered, tax fully accounted for elsewhere. Flag such '
        + 'a unit’s "Onboarding status" as Closed before onboarding, on its Edit unit dialog.',
      ),
      table(
        ['Effect', 'What happens'],
        [
          ['BU-event sweeps', 'The unit is never offered as a sweep candidate, whatever the sweep’s cut-off date.'],
          ['Dastavej auto-post', 'The deed date/value can still be recorded for the register, but no automatic differential is posted from it.'],
          ['15% RREP test', 'Still counted — that test is about the project’s physical mix, not which units this software tracks tax for.'],
        ],
        [30, 70],
      ),
      note('Only set this where the firm’s own records already show the unit fully and correctly taxed. Flipping it back to Live is the fix if that assumption turns out wrong.'),

      new Paragraph({ children: [new PageBreak()] }),

      // ── Page 2: Monthly workflow ─────────────────────────────────────────
      H1('2. Monthly workflow — Bookings & Receipts'),
      P(
        'The Ledger tab (Bookings & Receipts) is where the month’s actual work happens: booking units, '
        + 'recording collections, raising invoices. Two view modes sit at the top:',
      ),
      bullet('"Up to [period]" — the cumulative position as of a period-end, one row per unit.'),
      bullet('"[period] register" — every receipt and invoice dated in that month, across all units, in the order a bank statement or Tally would show them.'),

      H2('2.1 Booking and receipts'),
      bullet('Book unit — capture the member(s) and ownership split for a newly sold unit.'),
      bullet('Add receipt (+ icon) — a single collection, with rate/tax derived live from the unit.'),
      bullet('Record receipts (bulk, per project) — one grid for the whole month’s collection run: set date and instrument once, then type down the amount column. Enter moves to the next unit; pasting a copied column fills it straight down. A jointly-held unit can be split by member. Rows are sectioned Block/Phase-wise.'),
      bullet('Record receipts (client-wide) — the "Record receipts" button on the workspace toolbar (visible the moment a client is selected, before picking a project) opens the same grid across EVERY project the client has at once, sectioned project → block. Use this when one bank statement spans several of the client’s projects.'),
      bullet('Opening balances (client-wide) — the toolbar’s "Opening balances" button does the same for onboarding: every unit across every project of the client in one grid, block by block, one shared as-at date.'),
      bullet('Raise invoice (document icon) — a milestone invoice, which absorbs open advances into Table 11B automatically.'),
      note('Agreement value changes: staff may record a receipt that takes a unit beyond its recorded value or past ₹45 lakh — it is never blocked. But update the unit’s value in Unit Master FIRST (the dialog reminds you, with an "Update unit value now" shortcut), because the ₹45 lakh test and rate are read from the master. A residential unit crossing ₹45 lakh is re-rated to 7.5% on everything already taxed, in the month it crosses — the Bookings page shows a "Re-rate now" banner for exactly those units.'),

      H2('2.2 The row menu (⋯) — reorganised by how often you’ll actually use it'),
      P('Every item deep-links straight into that unit’s own dialog — none of them drop you into a blank, unscoped page you have to search again.'),
      table(
        ['Group', 'Items', 'What it opens'],
        [
          ['This month', 'Record dastavej', 'The Dastavej Reconciliation dialog for this unit, pre-filled.'],
          ['Rare — occasional corrections', 'Credit note, Re-rate (Table 10), Bounce reversal, Convert to another unit', 'That correction’s own dialog, with the unit already selected (re-rate opens its schedule only if the unit is actually due for one).'],
          ['Setup', 'Edit unit & charge heads, Opening balance', 'The unit’s edit / opening-balance dialog directly.'],
        ],
        [22, 38, 40],
      ),

      new Paragraph({ children: [new PageBreak()] }),

      // ── Page 3: BU Working & Dastavej ────────────────────────────────────
      H1('3. BU Working & Dastavej Reconciliation'),
      H2('3.1 The cut-off and the differential'),
      P(
        'A unit’s cut-off is the earlier of its block’s BU date and its own dastavej (registered sale '
        + 'deed) date. For every unit booked before that cut-off, the entire remaining balance becomes '
        + 'taxable in the cut-off month — received or not. A unit unbooked at cut-off falls under Schedule '
        + 'III and is omitted from the returns entirely.',
      ),
      bullet('New BU event (BU Working tab) — choose full project or selected units, the BU date, and the posting basis.'),
      bullet('Prepare — runs the differential for every unit in scope and shows the working before anything is written.'),
      bullet('Post — writes the BU_DIFFERENTIAL invoices, closes out open advances in Table 11B, and subsumes any receipt dated inside the BU month.'),
      note('Each posted event carries its own s.34 credit-note deadline (30 November following that financial year) — GST gives no bad-debt relief on an uncollected balance taxed at BU.'),

      H2('3.2 Dastavej Reconciliation'),
      P(
        'Registration itself usually creates no fresh GST — by the time the deed is executed the unit is '
        + 'normally already fully taxed through ordinary advances. This page exists to catch the exception: '
        + 'a unit registered early, before its advances catch up.',
      ),
      bullet('Saving a dastavej date/value runs the same differential math automatically, dated at the deed — nothing to prepare or post by hand.'),
      bullet('Already fully taxed → nothing happens, silently. Unbooked at that date → Schedule III, recorded. A real shortfall → posted immediately.'),
      bullet('A unit flagged "Closed before onboarding" (§1.3) records the deed for the register only — no automatic posting follows.'),

      new Paragraph({ children: [new PageBreak()] }),

      // ── Page 4: Corrections & TDR/FSI ────────────────────────────────────
      H1('4. Corrections (rare events) & TDR/FSI'),
      P('One governing rule for everything in this section: a change in the flow of money is not a change in the supply. GST adjusts only when the consideration or the supply itself changes.'),
      table(
        ['Event', 'When to use it', 'Position'],
        [
          ['Credit note', 'Cancellation, or the deed value nets below what was taxed.', 's.34 window: 30 Nov following the financial year of the original document. Past it, recorded for the trail but excluded from the return — the buyer’s own route is a refund under s.54.'],
          ['Re-rate (Table 10)', 'A unit taxed at 1.5% later crosses ₹45 lakh.', 'The concession never applied — amend the earlier B2CS entries in Table 10, with interest u/s 50 scheduled period-wise. No downgrade if the value later falls back.'],
          ['Bounce reversal', 'A cheque/transfer bounces after the return is filed.', 'Reverse on an un-invoiced advance, offsetting later months at the same rate. On an already-invoiced amount, the firm’s position is no adjustment — GST has no bad-debt relief.'],
          ['Convert to another unit', 'A member switches to a different unit.', 'A cancellation plus a fresh booking — the value already taxed carries across and is re-taxed at the new unit’s rate.'],
        ],
        [18, 32, 50],
      ),

      H2('4.1 TDR / FSI reverse charge'),
      P(
        'Time of supply is the BU date, so this working hangs off a posted BU event. The residential leg is '
        + 'capped at 1%/5% of value, summed per unit; the commercial leg has no cap or exemption, booked or '
        + 'not. This liability is paid entirely in cash through 3B Table 3.1(d) — the credit is blocked, so it '
        + 'never reaches GSTR-1.',
      ),
      note('A client instructing the firm not to discharge this liability needs the consent gate cleared before the period files: request out from gst@vjdesai.com, the client’s written reply attached, and GST Manager approval — in that order. Filing Status will not allow Filed until all three exist.'),

      new Paragraph({ children: [new PageBreak()] }),

      // ── Page 5: ITC, cash working paper & returns ────────────────────────
      H1('5. Partial ITC, the cash working paper, and generating the returns'),
      H2('5.1 Partial ITC — when it applies'),
      P(
        'Where a project’s commercial carpet area exceeds 15% of total (a "REP other than an RREP"), '
        + 'commercial units are taxed at 18% with proportionate credit while residential stays on its usual '
        + 'no-ITC concessional rate. Input tax then has to be apportioned by carpet area under Rule 42/43 — '
        + 'the residential share of ITC is reversed every month; there is no annual true-up.',
      ),
      bullet('On the ITC Working page, mark the client Partial ITC and sync carpet areas from the project master with "Use project figures" — a deliberate, one-click action, since the split drives a real reversal.'),
      bullet('4(B)(1) — the residential-attributable reversal — and Net ITC 4(C) are then calculated automatically from Total 4A and the carpet-area ratio.'),

      H2('5.2 The ITC & cash working paper (Builder Returns)'),
      P(
        'This is important to understand correctly: the GST portal itself does not segregate input tax '
        + 'credit by supply type. It nets all available credit against the aggregate CGST/SGST liability, '
        + 'whatever generated either side — nothing in GST law would stop leftover commercial-eligible credit '
        + 'from being applied against a residential liability on the actual return.',
      ),
      P(
        'The firm elects not to do that anyway, as a matter of internal discipline. The working paper on the '
        + 'Builder Returns page lays this policy out for the period:',
      ),
      bullet('Commercial output tax sets off against the net ITC available (4C) first.'),
      bullet('Residential output tax is paid in cash, in full, every period — even where surplus credit remains.'),
      bullet('Any credit left over after commercial is fully covered carries forward for a future month’s commercial liability — it is never applied against residential.'),
      note('This table only suggests the split and writes nothing to ITC Working, GSTR-3B or any ledger. It appears automatically once a period has a saved ITC summary for a Partial-ITC client.'),

      H2('5.3 Generating the returns'),
      bullet('Builder Returns — review the period’s workpaper (Table 3.1(a), Table 7, Table 11A/11B, the ITC & cash working paper), then Generate to write the figures into GSTR-1.'),
      bullet('GSTR-1 Data — the generated period can be reviewed and uploaded to the portal from here like any other client.'),
      bullet('GSTR-3B — Table 4 (ITC) is pulled from ITC Working; builder TDR/FSI reaches Table 3.1(d) independently. The net-payable figure shown is indicative only — the actual set-off and cash payment happen on the portal.'),

      new Paragraph({
        children: [new TextRun({
          text: 'This guide covers the workflow as of the module’s current build. See docs/BUILDER_GST_POSITIONS.md in the repository for the firm’s full, sourced GST positions behind every figure here.',
          italics: true, color: '777777', size: 20,
        })],
        spacing: { before: 300 },
        alignment: AlignmentType.LEFT,
      }),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(new URL('../docs/Builder_GST_Staff_Guide.docx', import.meta.url), buf);
console.log('Wrote docs/Builder_GST_Staff_Guide.docx');
