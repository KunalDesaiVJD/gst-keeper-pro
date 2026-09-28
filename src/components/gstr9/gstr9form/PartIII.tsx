import React from 'react';
import type { Tax, TaxIn } from '@/lib/gstr9/types';
import { zIn } from '@/lib/gstr9/defaults';
import { fmtMoney } from '../grid/money';
import { MatrixRow, MatrixTable, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { FORM_HEAD_LABELS, FORM_TAX_HEADS, fyStartYear, isManualPath, TAX_ORDER } from './helpers';
import { FixedRowDef } from './hooks';
import { EntryHeading, ResetButton, RowSrc, Src, StepLink, TaxEntryGrid } from './shared';

const hasTax = (t: Tax, eps = 0.005) => Math.abs(t.i) > eps || Math.abs(t.c) > eps || Math.abs(t.s) > eps || Math.abs(t.x) > eps;

/** "Central 1,234.00 · State/UT 1,234.00 · …" for the non-zero heads. */
const headsText = (t: Tax): string =>
  TAX_ORDER.filter((h) => Math.abs(t[h]) > 0.004)
    .map((h) => `${FORM_HEAD_LABELS[h].replace(' tax', '')} ${fmtMoney(t[h])}`)
    .join(' · ') || 'nil';

const Dash = () => <span className="text-muted-foreground">—</span>;

// ---------------------------------------------------------------------------
// Table 6 — ITC availed
// ---------------------------------------------------------------------------

const Table6: React.FC = () => {
  const { workings, docs, update } = useWorkspace();
  const g = workings.g9;
  const t6 = g.t6;
  const meta = docs.portal.gstr9Meta;
  const manual = docs.portal.manual;

  const src6A =
    g.t6ASource === 'gstr9' ? (
      <RowSrc step="portal" src={<Src kind="portal" meta={meta} manual={isManualPath(manual, 'gstr9.t6A')} />} />
    ) : g.t6ASource === 'monthly_3b' ? (
      <RowSrc step="portal" src={<Src kind="as_filed_3b" title="Σ Table 4A of the as-filed GSTR-3B (GSTR-9 not fetched)" />} />
    ) : (
      <RowSrc step="portal" src={<Src kind="none" />} />
    );
  const computed = <Src kind="computed" />;
  const unused = <Src kind="unused" title="Nil in this working — RCM ITC is reported as input services" />;
  const rcmBooks = <RowSrc step="rcm" src={<Src kind="books" title="RCM step — Part B categories set to this table" />} />;
  const typed = <Src kind="typed" title="Typed below" />;

  const rows: MatrixRow[] = [
    { key: '6A', code: '6A', label: 'Total amount of input tax credit availed through FORM GSTR-3B (sum total of Table 4A of FORM GSTR-3B)', value: t6.A, note: src6A },
    {
      key: '6A1',
      code: '6A1',
      label: 'ITC of any preceding financial year availed in the financial year (which is included in 6A above) other than reclaim',
      value: t6.A1,
      note: (
        <RowSrc
          step="itc"
          src={docs.gstr9.t6A1 == null ? <Src kind="books" title="Last Year Effect — Duties & Taxes (Input) row 9">Books · LYE</Src> : <Src kind="typed" title="Typed in ITC reco" />}
        />
      ),
    },
    { key: '6A2', code: '6A2', label: 'Net ITC of the financial year (A − A1)', value: t6.A2, total: true, note: computed },
    { key: '6B', code: '6B', label: 'Inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs)', heading: true },
    { key: '6B_ip', label: 'Inputs', indent: true, value: t6.B_ip, note: <RowSrc step="itc" src={<Src kind="books" title="PL-INPUT ledgers tagged A · Purchases (GSTR 9-INPUT row 9)" />} /> },
    { key: '6B_cg', label: 'Capital goods', indent: true, value: t6.B_cg, note: <RowSrc step="itc" src={<Src kind="books" title="PL-INPUT ledgers tagged O · Capital goods (GSTR 9-INPUT row 12)" />} /> },
    {
      key: '6B_is',
      label: 'Input services',
      indent: true,
      value: t6.B_is,
      note: <RowSrc step="itc" src={<Src kind="computed" title="Balancing figure: 6A2 less every other row of 6B–6H (GSTR 9-INPUT D10)">Balancing</Src>} />,
    },
    { key: '6C', code: '6C', label: 'Inward supplies received from unregistered persons liable to reverse charge (other than B above) on which tax is paid & ITC availed', heading: true },
    { key: '6C_ip', label: 'Inputs', indent: true, value: t6.C_ip, note: unused },
    { key: '6C_cg', label: 'Capital goods', indent: true, value: t6.C_cg, note: unused },
    { key: '6C_is', label: 'Input services', indent: true, value: t6.C_is, note: rcmBooks },
    { key: '6D', code: '6D', label: 'Inward supplies received from registered persons liable to reverse charge (other than B above) on which tax is paid and ITC availed', heading: true },
    { key: '6D_ip', label: 'Inputs', indent: true, value: t6.D_ip, note: unused },
    { key: '6D_cg', label: 'Capital goods', indent: true, value: t6.D_cg, note: unused },
    { key: '6D_is', label: 'Input services', indent: true, value: t6.D_is, note: rcmBooks },
    { key: '6E', code: '6E', label: 'Import of goods (including supplies from SEZ)', heading: true },
    { key: '6E_ip', label: 'Inputs', indent: true, value: t6.E_ip, note: <RowSrc step="purchases" src={<Src kind="books" title="PL-INPUT ledgers tagged D · Imported goods (GSTR 9-INPUT row 11)" />} /> },
    { key: '6E_cg', label: 'Capital goods', indent: true, value: t6.E_cg, note: <Src kind="unused" title="Nil in this working — imported capital goods are not split out" /> },
    { key: '6F', code: '6F', label: 'Import of services (excluding inward supplies from SEZs)', value: t6.F, note: rcmBooks },
    {
      key: '6G',
      code: '6G',
      label: 'Input Tax credit received from ISD',
      value: t6.G,
      note:
        docs.gstr9.t6G == null ? (
          <RowSrc step="portal" src={<Src kind="portal" meta={meta} manual={isManualPath(manual, 'gstr9.t6G')} />} />
        ) : (
          <Src kind="typed" title="Typed below — overrides the portal 6G">Override</Src>
        ),
    },
    {
      key: '6H',
      code: '6H',
      label: 'Amount of ITC reclaimed (other than B above) under the provisions of the Act',
      value: t6.H,
      note: <RowSrc step="duties" src={<Src kind="books" title="Suspended ITC reclaimed — Duties & Taxes (Input)" />} />,
    },
    { key: '6I', code: '6I', label: 'Sub-total (B to H above)', value: t6.I, total: true, note: computed },
    { key: '6J', code: '6J', label: 'Difference (I − A2 above)', value: t6.J, signed: true, diffKey: 'itc.6J', note: computed },
    { key: '6K', code: '6K', label: 'Transition Credit through TRAN-1 (including revisions if any)', value: t6.K, note: typed },
    { key: '6L', code: '6L', label: 'Transition Credit through TRAN-2', value: t6.L, note: typed },
    { key: '6M', code: '6M', label: 'ITC availed through ITC-01, ITC-02 and ITC-02A (other than GSTR-3B and TRAN forms)', value: t6.M, note: typed },
    { key: '6N', code: '6N', label: 'Sub-total (K to M above)', value: t6.N, total: true, note: computed },
    { key: '6O', code: '6O', label: 'Total ITC availed (I + N) above', value: t6.O, total: true, note: computed },
  ];

  const defs: FixedRowDef<TaxIn | null>[] = [
    {
      id: '6G',
      code: '6G',
      label: 'ITC received from ISD',
      title: 'Leave blank to use the portal 6G; type to override it',
      read: (d) => d.t6G,
      write: (d, v) => ({ ...d, t6G: v }),
      computed: docs.portal.gstr9.t6G,
    },
    { id: '6K', code: '6K', label: 'TRAN-1 credit', title: 'Transition Credit through TRAN-1 (including revisions if any)', read: (d) => d.t6K, write: (d, v) => ({ ...d, t6K: v ?? zIn() }) },
    { id: '6L', code: '6L', label: 'TRAN-2 credit', title: 'Transition Credit through TRAN-2', read: (d) => d.t6L, write: (d, v) => ({ ...d, t6L: v ?? zIn() }) },
    { id: '6M', code: '6M', label: 'ITC-01 / ITC-02 / ITC-02A', title: 'ITC availed through ITC-01, ITC-02 and ITC-02A', read: (d) => d.t6M, write: (d, v) => ({ ...d, t6M: v ?? zIn() }) },
  ];

  return (
    <SectionCard
      title="6 · Details of ITC availed during the financial year"
      description="6A from the portal, 6B–6H from the ITC working. Only 6G (override), 6K, 6L and 6M are typed here."
      excelRef="GSTR-9 rows 40–64 · GSTR 9-INPUT"
      actions={<StepLink step="itc">ITC reco</StepLink>}
    >
      <MatrixTable rows={rows} heads={FORM_TAX_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 6" />
      <Note>
        6B input services is the sheet&apos;s balancing figure, so 6I ties to 6A2. Books ITC on the same ledgers: {headsText(workings.itc.inputServicesBooks)}.
      </Note>
      <Note tone="position">
        6A1 defaults to the Last Year Effect (Duties &amp; Taxes), not a typed figure; RCM ITC goes to 6C input services unless an RCM category is set to 6D or 6F.
      </Note>
      <EntryHeading
        actions={
          <ResetButton show={docs.gstr9.t6G != null} onClick={() => update('gstr9', (d) => ({ ...d, t6G: null }))}>
            Use portal 6G
          </ResetButton>
        }
      >
        Typed rows
      </EntryHeading>
      <TaxEntryGrid defs={defs} label="GSTR-9 Table 6 typed rows" />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 7 — ITC reversed and ineligible (read-only; typed in ITC reco)
// ---------------------------------------------------------------------------

const Table7: React.FC = () => {
  const { workings, docs } = useWorkspace();
  const g = workings.g9;
  const t7 = g.t7;
  const typed = <Src kind="typed" title="Typed in ITC reco" />;
  const s17 =
    docs.gstr9.t7.s17_5 == null ? <Src kind="as_filed_3b" title="Σ 4B(1) of the as-filed GSTR-3B" /> : typed;

  const rows: MatrixRow[] = [
    { key: '7A', code: '7A', label: 'As per Rule 37', value: t7.A, note: typed },
    { key: '7A1', code: '7A1', label: 'As per Rule 37A', value: t7.A1, note: typed },
    { key: '7A2', code: '7A2', label: 'As per Rule 38', value: t7.A2, note: typed },
    { key: '7B', code: '7B', label: 'As per Rule 39', value: t7.B, note: typed },
    { key: '7C', code: '7C', label: 'As per Rule 42', value: t7.C, note: typed },
    { key: '7D', code: '7D', label: 'As per Rule 43', value: t7.D, note: typed },
    { key: '7E', code: '7E', label: 'As per section 17(5)', value: t7.E, note: s17 },
    { key: '7F', code: '7F', label: 'Reversal of TRAN-I credit', value: t7.F, note: typed },
    { key: '7G', code: '7G', label: 'Reversal of TRAN-II credit', value: t7.G, note: typed },
    { key: '7H', code: '7H', label: 'Other reversals', heading: true },
    ...g.t7H.map<MatrixRow>((h, i) => ({
      key: `7H-${h.id}`,
      code: `7H${i + 1}`,
      label: h.description || 'Other reversal',
      indent: true,
      value: h.tax,
      note: h.computed ? <Src kind="books" title="Suspended ITC reversed — Duties & Taxes (Input), incl. 180-day" /> : typed,
    })),
    { key: '7I', code: '7I', label: 'Total ITC Reversed (Sum of A to H above)', value: g.t7I, total: true, note: <Src kind="computed" /> },
    { key: '7J', code: '7J', label: 'Net ITC Available for Utilization (6O − 7I)', value: g.t7J, total: true, note: <Src kind="computed" /> },
  ];

  return (
    <SectionCard
      title="7 · Details of ITC reversed and ineligible ITC for the financial year"
      description="Read-only here — Table 7 is entered in the ITC reco step."
      excelRef="GSTR-9 rows 66–78 · GSTR 9-INPUT rows 20–23"
      actions={<StepLink step="itc">Edit in ITC reco</StepLink>}
    >
      <MatrixTable rows={rows} heads={FORM_TAX_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 7" />
      <Note tone="position">
        Suspended-ITC reversals (incl. 180-day) are reported as a 7H other reversal rather than 7A (Rule 37), as in the firm&apos;s sheet.
      </Note>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 8 — other ITC related information
// ---------------------------------------------------------------------------

const Table8: React.FC = () => {
  const { workings, docs, financialYear } = useWorkspace();
  const g = workings.g9;
  const t8 = g.t8;
  const meta = docs.portal.gstr9Meta;
  const manual = docs.portal.manual;
  const twoB = fyStartYear(financialYear) >= 2023;
  const typed = <Src kind="typed" title="Typed below" />;
  const computed = <Src kind="computed" />;
  const igstOnly = { c: <Dash />, s: <Dash /> };

  const rows: MatrixRow[] = [
    {
      key: '8A',
      code: '8A',
      label: twoB ? 'ITC as per GSTR-2B [Table 3(I) thereof]' : 'ITC as per GSTR-2A (Table 3 & 5 thereof)',
      value: t8.A,
      note: <RowSrc step="portal" src={<Src kind="portal" meta={meta} manual={isManualPath(manual, 'gstr9.t8A')} />} />,
    },
    { key: '8B', code: '8B', label: 'ITC as per sum total of 6(B) and 6(H) above', value: t8.B, note: computed },
    {
      key: '8C',
      code: '8C',
      label:
        'ITC on inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs) received during the financial year but availed in the next financial year up to the specified period',
      value: t8.C,
      note: <RowSrc step="itc" src={<Src kind="computed" title="Table 13 − Table 12, as in the sheet" />} />,
    },
    { key: '8D', code: '8D', label: 'Difference [A − (B + C)]', value: t8.D, signed: true, total: true, diffKey: 'g9.8D', note: computed },
    { key: '8E', code: '8E', label: 'ITC available but not availed', value: t8.E, note: typed },
    { key: '8F', code: '8F', label: 'ITC available but ineligible', value: t8.F, note: typed },
    {
      key: '8G',
      code: '8G',
      label: 'IGST paid on import of goods (including supplies from SEZ)',
      value: t8.G,
      cells: igstOnly,
      note: <RowSrc step="purchases" src={<Src kind="books" title="= 6E inputs (imported goods ledgers)" />} />,
    },
    { key: '8H', code: '8H', label: 'IGST credit availed on import of goods (as per 6(E) above)', value: t8.H, cells: igstOnly, note: computed },
    { key: '8H1', code: '8H1', label: 'IGST credit availed on import of goods in next financial year', value: t8.H1, cells: igstOnly, note: typed },
    { key: '8I', code: '8I', label: 'Difference (G − H − H1)', value: t8.I, cells: igstOnly, signed: true, note: computed },
    { key: '8J', code: '8J', label: 'ITC available but not availed on import of goods (equal to I)', value: t8.J, cells: igstOnly, note: computed },
    { key: '8K', code: '8K', label: 'Total ITC to be lapsed in current financial year (E + F + J)', value: t8.K, total: true, note: computed },
  ];

  const unsplit = g.t8Unsplit;
  const dPositive = TAX_ORDER.some((h) => t8.D[h] > 0.005);

  const defs: FixedRowDef<TaxIn | null>[] = [
    { id: '8E', code: '8E', label: 'Available, not availed', title: 'ITC available but not availed', read: (d) => d.t8E, write: (d, v) => ({ ...d, t8E: v ?? zIn() }) },
    { id: '8F', code: '8F', label: 'Available but ineligible', title: 'ITC available but ineligible', read: (d) => d.t8F, write: (d, v) => ({ ...d, t8F: v ?? zIn() }) },
    {
      id: '8H1',
      code: '8H1',
      label: 'Import IGST availed next FY',
      title: 'IGST credit availed on import of goods in next financial year (Integrated tax and Cess only)',
      read: (d) => d.t8H1,
      write: (d, v) => ({ ...d, t8H1: v ?? zIn() }),
      heads: ['i', 'x'],
    },
  ];

  return (
    <SectionCard
      title="8 · Other ITC related information"
      description="8A from the portal; 8E, 8F and 8H1 are typed here — 8E + 8F explain the 8D difference."
      excelRef="GSTR-9 rows 80–92"
      actions={
        <>
          <StepLink step="portal">Portal data</StepLink>
          <StepLink step="itc">ITC reco</StepLink>
        </>
      }
    >
      <MatrixTable rows={rows} heads={FORM_TAX_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 8" />
      <Note tone="position">
        8B = 6(B) + 6(H), as the form reads and the portal computes; the firm&apos;s sheet sums 6(B) only. 8C = Table 13 − Table 12, as in the sheet.
      </Note>
      <EntryHeading>Typed rows</EntryHeading>
      <TaxEntryGrid defs={defs} label="GSTR-9 Table 8 typed rows" />
      {dPositive && (
        <p className={hasTax(unsplit) ? 'rounded bg-warning/15 px-2 py-1 text-xs text-foreground' : 'text-xs text-success'}>
          {hasTax(unsplit) ? `8D not yet explained by 8E + 8F: ${headsText(unsplit)}.` : '8D is fully explained by 8E + 8F.'}
        </p>
      )}
    </SectionCard>
  );
};

const PartIII: React.FC = () => (
  <div className="space-y-4">
    <Table6 />
    <Table7 />
    <Table8 />
  </div>
);

export default PartIII;
