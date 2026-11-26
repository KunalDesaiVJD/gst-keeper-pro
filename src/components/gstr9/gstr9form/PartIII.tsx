import React from 'react';
import type { Tax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { type MatrixHead, MatrixRow, MatrixTable, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { FORM_HEAD_LABELS, FORM_MATRIX_SCROLL, FORM_TAX_HEADS, fyStartYear, isManualPath, TAX_ORDER } from './helpers';
import { RowSrc, Src, StepLink } from './shared';
import { itcTableOf } from '../rcm/rcmShared';
import {
  dutiesLye,
  dutiesSuspended,
  itc6A1,
  itc8C,
  itcEntry6,
  itcEntry8,
  itcBuilderReversal,
  itcT7,
  itcT7Extra,
  itcWorking,
  portal3bTotal,
  portalItc,
  rcmFlow,
  salesCgSold,
  type T7EntryRow,
} from './sourceTargets';
import { rule42Final7C, rule43Year7D } from '../figure/targetsReco';

const hasTax = (t: Tax, eps = 0.005) => Math.abs(t.i) > eps || Math.abs(t.c) > eps || Math.abs(t.s) > eps || Math.abs(t.x) > eps;

/** "Central 1,234.00 · State/UT 1,234.00 · …" for the non-zero heads. */
const headsText = (t: Tax): string =>
  TAX_ORDER.filter((h) => Math.abs(t[h]) > 0.004)
    .map((h) => `${FORM_HEAD_LABELS[h].replace(' tax', '')} ${fmtMoney(t[h])}`)
    .join(' · ') || 'nil';

const Dash = () => <span className="text-muted-foreground">—</span>;

/** Builders on the no-ITC scheme: the same note as ITC reco (workings.ctx.noItcBuilder). */
const NoItcBuilderNote: React.FC = () => {
  const { workings } = useWorkspace();
  if (!workings.ctx.noItcBuilder) return null;
  return <Note>This client is a builder on the no-ITC scheme — nil ITC is expected, and ITC differences are for information only.</Note>;
};

// ---------------------------------------------------------------------------
// Table 6 — ITC availed
// ---------------------------------------------------------------------------

export const Table6: React.FC = () => {
  const { workings, docs } = useWorkspace();
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
  const rcmBooks = <RowSrc step="rcm" src={<Src kind="books" title="RCM step — Part B categories set to this table and column" />} />;
  const typed = <Src kind="typed" title="Typed in ITC reco" />;

  // Figure links (sourceTargets.ts): 6C / 6D / 6F open RCM › Where RCM flows, whose 6D / 6F lines show only while an expense is set to them.
  const rcmTableShown = (t: '6C' | '6D' | '6F') => t === '6C' || docs.rcm.categories.some((c) => itcTableOf(c.itcTable) === t);
  const rcmLink = (t: '6C' | '6D' | '6F') => (rcmTableShown(t) ? (h: MatrixHead) => rcmFlow(t, h) : undefined);
  const link6A =
    g.t6ASource === 'monthly_3b' ? (h: MatrixHead) => portal3bTotal('itc4aTotal', h) : (h: MatrixHead) => portalItc('t6A', h);

  const rows: MatrixRow[] = [
    { key: '6A', code: '6A', label: 'Total amount of input tax credit availed through FORM GSTR-3B (sum total of Table 4A of FORM GSTR-3B)', value: t6.A, note: src6A, link: link6A },
    {
      key: '6A1',
      code: '6A1',
      label: 'ITC of any preceding financial year availed in the financial year (which is included in 6A above) other than reclaim',
      value: t6.A1,
      link: docs.gstr9.t6A1 == null ? dutiesLye : itc6A1,
      note: (
        <RowSrc
          step="itc"
          src={docs.gstr9.t6A1 == null ? <Src kind="books" title="Last Year Effect — Duties & Taxes (Input) row 9">Books · LYE</Src> : <Src kind="typed" title="Typed in ITC reco" />}
        />
      ),
    },
    { key: '6A2', code: '6A2', label: 'Net ITC of the financial year (A − A1)', value: t6.A2, total: true, note: computed, link: (h) => itcWorking('asPer3B', h) },
    { key: '6B', code: '6B', label: 'Inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs)', heading: true },
    { key: '6B_ip', label: 'Inputs', indent: true, value: t6.B_ip, link: (h) => itcWorking('inputs', h), note: <RowSrc step="itc" src={<Src kind="books" title="PL-INPUT ledgers tagged A · Purchases (GSTR 9-INPUT row 9)" />} /> },
    { key: '6B_cg', label: 'Capital goods', indent: true, value: t6.B_cg, link: (h) => itcWorking('cg', h), note: <RowSrc step="itc" src={<Src kind="books" title="PL-INPUT ledgers tagged O · Capital goods (GSTR 9-INPUT row 12)" />} /> },
    {
      key: '6B_is',
      label: 'Input services',
      indent: true,
      value: t6.B_is,
      link: (h) => itcWorking('is', h),
      note: <RowSrc step="itc" src={<Src kind="computed" title="Balancing figure: 6A2 less every other row of 6B–6H (GSTR 9-INPUT D10)">Balancing</Src>} />,
    },
    { key: '6C', code: '6C', label: 'Inward supplies received from unregistered persons liable to reverse charge (other than B above) on which tax is paid & ITC availed', heading: true },
    { key: '6C_ip', label: 'Inputs', indent: true, value: t6.C_ip, note: rcmBooks, link: rcmLink('6C') },
    { key: '6C_cg', label: 'Capital goods', indent: true, value: t6.C_cg, note: rcmBooks, link: rcmLink('6C') },
    { key: '6C_is', label: 'Input services', indent: true, value: t6.C_is, note: rcmBooks, link: rcmLink('6C') },
    { key: '6D', code: '6D', label: 'Inward supplies received from registered persons liable to reverse charge (other than B above) on which tax is paid and ITC availed', heading: true },
    { key: '6D_ip', label: 'Inputs', indent: true, value: t6.D_ip, note: rcmBooks, link: rcmLink('6D') },
    { key: '6D_cg', label: 'Capital goods', indent: true, value: t6.D_cg, note: rcmBooks, link: rcmLink('6D') },
    { key: '6D_is', label: 'Input services', indent: true, value: t6.D_is, note: rcmBooks, link: rcmLink('6D') },
    { key: '6E', code: '6E', label: 'Import of goods (including supplies from SEZ)', heading: true },
    { key: '6E_ip', label: 'Inputs', indent: true, value: t6.E_ip, link: (h) => itcWorking('imp', h), note: <RowSrc step="purchases" src={<Src kind="books" title="PL-INPUT purchase and expense ledgers tagged D · Imported goods (GSTR 9-INPUT row 11)" />} /> },
    { key: '6E_cg', label: 'Capital goods', indent: true, value: t6.E_cg, link: (h) => itcWorking('imp', h), note: <RowSrc step="purchases" src={<Src kind="books" title="PL-INPUT capital-goods ledgers tagged D · Imported goods" />} /> },
    { key: '6F', code: '6F', label: 'Import of services (excluding inward supplies from SEZs)', value: t6.F, note: rcmBooks, link: rcmLink('6F') },
    {
      key: '6G',
      code: '6G',
      label: 'Input Tax credit received from ISD',
      value: t6.G,
      link: docs.gstr9.t6G == null ? (h) => portalItc('t6G', h) : itcEntry6('6G'),
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
      link: (h) => dutiesSuspended('rec', h),
      note: <RowSrc step="duties" src={<Src kind="books" title="Suspended ITC reclaimed — Duties & Taxes (Input)" />} />,
    },
    { key: '6I', code: '6I', label: 'Sub-total (B to H above)', value: t6.I, total: true, note: computed },
    { key: '6J', code: '6J', label: 'Difference (I − A2 above)', value: t6.J, signed: true, diffKey: 'itc.6J', note: computed, link: (h) => itcWorking('6J', h) },
    { key: '6K', code: '6K', label: 'Transition Credit through TRAN-1 (including revisions if any)', value: t6.K, note: typed, link: itcEntry6('6K') },
    { key: '6L', code: '6L', label: 'Transition Credit through TRAN-2', value: t6.L, note: typed, link: itcEntry6('6L') },
    { key: '6M', code: '6M', label: 'ITC availed through ITC-01, ITC-02 and ITC-02A (other than GSTR-3B and TRAN forms)', value: t6.M, note: typed, link: itcEntry6('6M') },
    { key: '6N', code: '6N', label: 'Sub-total (K to M above)', value: t6.N, total: true, note: computed },
    { key: '6O', code: '6O', label: 'Total ITC availed (I + N) above', value: t6.O, total: true, note: computed, link: (h) => itcWorking('total6O', h) },
  ];


  return (
    <SectionCard
      title="6 · Details of ITC availed during the financial year"
      description="6A from the portal, 6B–6H from the ITC working, 6G (override), 6K, 6L and 6M from ITC reco › Table 6 entries. Nothing is typed here."
      excelRef="GSTR-9 rows 40–64 · GSTR 9-INPUT"
      actions={<StepLink step="itc">ITC reco</StepLink>}
    >
      <NoItcBuilderNote />
      <MatrixTable rows={rows} heads={FORM_TAX_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 6" className={FORM_MATRIX_SCROLL} />
      <p className="text-[11px] text-muted-foreground">
        6B input services is the sheet&apos;s balancing figure, so 6I ties to 6A2. Books ITC on the same ledgers:{' '}
        <span className="tabular-nums text-foreground">{headsText(workings.itc.inputServicesBooks)}</span>.
      </p>
      <Note tone="position">
        6A1 defaults to the Last Year Effect (Duties &amp; Taxes), not a typed figure; RCM ITC goes to 6C input services unless an RCM category is set to 6D or 6F, to inputs or capital goods, or to No ITC (then it is not in Table 6).
      </Note>
      <p className="text-[11px] text-muted-foreground">
        6G (override), 6K, 6L and 6M are typed on <StepLink step="itc" tab={{ itctab: 'working' }}>ITC reco › Table 6 entries</StepLink>; this table only shows them.
      </p>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 7 — ITC reversed and ineligible (read-only; typed in ITC reco)
// ---------------------------------------------------------------------------

export const Table7: React.FC = () => {
  const { workings, docs } = useWorkspace();
  const g = workings.g9;
  const t7 = g.t7;
  const typed = <Src kind="typed" title="Typed in ITC reco" />;
  const s17 =
    docs.gstr9.t7.s17_5 == null ? <Src kind="as_filed_3b" title="Σ 4B(1) of the as-filed GSTR-3B, less 7A2, 7C and 7D" /> : typed;

  // Figure links (sourceTargets.ts): 7A to 7G open their row of ITC reco › Table 7 entries.
  const t7Link = (row: T7EntryRow) => (h: MatrixHead) => itcT7(row, h);
  const link7H = (id: string) =>
    id === 'h1' ? (h: MatrixHead) => dutiesSuspended('rev', h) : id === 'cg186' ? salesCgSold : (h: MatrixHead) => itcT7Extra(id, h);
  const note7H = (id: string, computed: boolean) =>
    id === 'cg186' ? (
      <Src kind="books" title="The s.18(6) shortfall on capital goods sold (Sales › Capital goods sold; the working is Annexure-5)">Capital goods sold · Annexure-5</Src>
    ) : computed ? (
      <Src kind="books" title="Suspended ITC reversed — Duties & Taxes (Input), incl. 180-day">Suspended ITC · Duties &amp; Taxes</Src>
    ) : (
      typed
    );

  // 7C / 7D: their true source (engine: the Rule 42/43 working while switched on — or a superadmin's figure typed over
  // it — else the ITC reco Table 7 entry; an approved builder ITC reversal adds to either).
  const r42On = workings.r42.enabled;
  const ruleSrc = (rule: '42' | '43') => {
    const override = rule === '42' ? workings.r42.t7CSource === 'override' : workings.r43.t7DSource === 'override';
    const builder = hasTax(rule === '42' ? workings.builderRev.r42 : workings.builderRev.r43);
    const workingTarget = rule === '42' ? rule42Final7C : rule43Year7D;
    if (r42On && override) {
      return {
        note: <Src kind="typed" title={`7${rule === '42' ? 'C' : 'D'} typed over the Rule ${rule} working by a superadmin (ITC reco › Rule 42/43)`}>Superadmin override</Src>,
        link: workingTarget,
      };
    }
    if (r42On) {
      return {
        note: (
          <Src kind="books" title={`Rule ${rule} working (ITC reco › Rule 42/43)${builder ? ', plus the approved Builder › ITC Reversal working posted this year' : ''}`}>
            Rule {rule} working{builder ? ' + builder' : ''}
          </Src>
        ),
        link: workingTarget,
      };
    }
    const typedAmt = docs.gstr9.t7[rule === '42' ? 'r42' : 'r43'];
    const typedSome = !!typedAmt && TAX_ORDER.some((h) => Math.abs(Number(typedAmt[h]) || 0) > 0.005);
    if (builder && !typedSome) {
      return {
        note: <Src kind="books" title="The approved Builder › ITC Reversal working posted in this year's GSTR-3B (shown on ITC reco › Rule 42/43)">Builder ITC reversal</Src>,
        link: itcBuilderReversal,
      };
    }
    if (builder) {
      return {
        note: <Src kind="typed" title="Typed in ITC reco › Table 7, plus the approved Builder › ITC Reversal working posted this year">Typed + builder</Src>,
        link: t7Link(rule === '42' ? 'r42' : 'r43'),
      };
    }
    return { note: typed, link: t7Link(rule === '42' ? 'r42' : 'r43') };
  };
  const src7C = ruleSrc('42');
  const src7D = ruleSrc('43');

  const rows: MatrixRow[] = [
    { key: '7A', code: '7A', label: 'As per Rule 37', value: t7.A, note: typed, link: t7Link('r37') },
    { key: '7A1', code: '7A1', label: 'As per Rule 37A', value: t7.A1, note: typed, link: t7Link('r37A') },
    { key: '7A2', code: '7A2', label: 'As per Rule 38', value: t7.A2, note: typed, link: t7Link('r38') },
    { key: '7B', code: '7B', label: 'As per Rule 39', value: t7.B, note: typed, link: t7Link('r39') },
    { key: '7C', code: '7C', label: 'As per Rule 42', value: t7.C, note: src7C.note, link: src7C.link },
    { key: '7D', code: '7D', label: 'As per Rule 43', value: t7.D, note: src7D.note, link: src7D.link },
    { key: '7E', code: '7E', label: 'As per section 17(5)', value: t7.E, note: s17, link: t7Link('s17_5') },
    { key: '7F', code: '7F', label: 'Reversal of TRAN-I credit', value: t7.F, note: typed, link: t7Link('tran1') },
    { key: '7G', code: '7G', label: 'Reversal of TRAN-II credit', value: t7.G, note: typed, link: t7Link('tran2') },
    { key: '7H', code: '7H', label: 'Other reversals', heading: true },
    ...g.t7H.map<MatrixRow>((h, i) => ({
      key: `7H-${h.id}`,
      code: `7H${i + 1}`,
      label: h.description || 'Other reversal',
      indent: true,
      value: h.tax,
      link: link7H(h.id),
      note: note7H(h.id, h.computed),
    })),
    { key: '7I', code: '7I', label: 'Total ITC Reversed (Sum of A to H above)', value: g.t7I, total: true, note: <Src kind="computed" />, link: (h) => itcT7Extra('footer:7I', h) },
    { key: '7J', code: '7J', label: 'Net ITC Available for Utilization (6O − 7I)', value: g.t7J, total: true, note: <Src kind="computed" />, link: (h) => itcT7Extra('footer:7J', h) },
  ];

  return (
    <SectionCard
      title="7 · Details of ITC reversed and ineligible ITC for the financial year"
      description="Read-only here — Table 7 is entered or worked in the ITC reco step (7C / 7D on its Rule 42/43 tab while that working is on); 7H's capital goods line comes from Sales › Capital goods sold."
      excelRef="GSTR-9 rows 66–78 · GSTR 9-INPUT rows 20–23"
      actions={<StepLink step="itc">Edit in ITC reco</StepLink>}
    >
      <NoItcBuilderNote />
      <MatrixTable rows={rows} heads={FORM_TAX_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 7" className={FORM_MATRIX_SCROLL} />
      <Note tone="position">
        Suspended-ITC reversals (incl. 180-day) are reported as a 7H other reversal rather than 7A (Rule 37), as in the firm&apos;s sheet.
      </Note>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 8 — other ITC related information
// ---------------------------------------------------------------------------

export const Table8: React.FC = () => {
  const { workings, docs, financialYear } = useWorkspace();
  const g = workings.g9;
  const t8 = g.t8;
  const meta = docs.portal.gstr9Meta;
  const manual = docs.portal.manual;
  const twoB = fyStartYear(financialYear) >= 2023;
  const typed = <Src kind="typed" title="Typed in ITC reco" />;
  const computed = <Src kind="computed" />;
  const igstOnly = { c: <Dash />, s: <Dash /> };

  const rows: MatrixRow[] = [
    {
      key: '8A',
      code: '8A',
      label: twoB ? 'ITC as per GSTR-2B [Table 3(I) thereof]' : 'ITC as per GSTR-2A (Table 3 & 5 thereof)',
      value: t8.A,
      link: (h) => portalItc('t8A', h),
      note: <RowSrc step="portal" src={<Src kind="portal" meta={meta} manual={isManualPath(manual, 'gstr9.t8A')} />} />,
    },
    { key: '8B', code: '8B', label: 'ITC as per sum total of 6(B) and 6(H) above', value: t8.B, note: computed },
    {
      key: '8C',
      code: '8C',
      label:
        'ITC on inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs) received during the financial year but availed in the next financial year up to the specified period',
      value: t8.C,
      link: docs.gstr9.t8C == null ? itc8C : itcEntry8('8C'),
      note:
        docs.gstr9.t8C == null ? (
          <RowSrc step="itc" src={<Src kind="computed" title="Not typed: Table 13 (ITC of this year availed next year). Type 8C on ITC reco › Table 8 entries to leave out imports and RCM." />} />
        ) : (
          typed
        ),
    },
    { key: '8D', code: '8D', label: 'Difference [A − (B + C)]', value: t8.D, signed: true, total: true, diffKey: 'g9.8D', note: computed },
    { key: '8E', code: '8E', label: 'ITC available but not availed', value: t8.E, note: typed, link: itcEntry8('8E') },
    { key: '8F', code: '8F', label: 'ITC available but ineligible', value: t8.F, note: typed, link: itcEntry8('8F') },
    {
      key: '8G',
      code: '8G',
      label: 'IGST paid on import of goods (including supplies from SEZ)',
      value: t8.G,
      cells: igstOnly,
      note: docs.gstr9.t8G == null ? <Src kind="computed" title="Not typed: 8H + 8H1 (IGST on imports availed this year and next year). Type the bills-of-entry figure on ITC reco › Table 8 entries." /> : typed,
      link: itcEntry8('8G'),
    },
    { key: '8H', code: '8H', label: 'IGST credit availed on import of goods (as per 6(E) above)', value: t8.H, cells: igstOnly, note: computed, link: (h) => itcWorking('imp', h) },
    { key: '8H1', code: '8H1', label: 'IGST credit availed on import of goods in next financial year', value: t8.H1, cells: igstOnly, note: typed, link: itcEntry8('8H1') },
    { key: '8I', code: '8I', label: 'Difference (G − H − H1)', value: t8.I, cells: igstOnly, signed: true, note: computed },
    { key: '8J', code: '8J', label: 'ITC available but not availed on import of goods (equal to I)', value: t8.J, cells: igstOnly, note: computed },
    { key: '8K', code: '8K', label: 'Total ITC to be lapsed in current financial year (E + F + J)', value: t8.K, total: true, note: computed },
  ];

  const unsplit = g.t8Unsplit;
  const dPositive = TAX_ORDER.some((h) => t8.D[h] > 0.005);


  return (
    <SectionCard
      title="8 · Other ITC related information"
      description="8A from the portal; 8C (when not Table 13), 8E, 8F, 8G and 8H1 from ITC reco — 8E + 8F explain the 8D difference, 8J the IGST on imports not availed."
      excelRef="GSTR-9 rows 80–92"
      actions={
        <>
          <StepLink step="portal">Portal data</StepLink>
          <StepLink step="itc">ITC reco</StepLink>
        </>
      }
    >
      <NoItcBuilderNote />
      <MatrixTable rows={rows} heads={FORM_TAX_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Table 8" className={FORM_MATRIX_SCROLL} />
      <Note tone="position">
        8B = 6(B) + 6(H), as the form reads and the portal computes; the firm&apos;s sheet sums 6(B) only. 8C is Table 13 unless typed (type it to leave out imports and RCM); the sheet took Table 13 − Table 12, which nets a reversal and can go below nil.
      </Note>
      <p className="text-[11px] text-muted-foreground">
        8C (when not Table 13), 8E, 8F, 8G and 8H1 are typed on <StepLink step="itc" tab={{ itctab: 'next' }}>ITC reco › Tables 8, 12 &amp; 13</StepLink>; this table only shows them.
      </p>
      {dPositive && (
        <p className={hasTax(unsplit) ? 'rounded bg-warning/15 px-2 py-1 text-xs text-foreground' : 'text-xs text-success-strong'}>
          {hasTax(unsplit) ? `8D not yet explained by 8E + 8F: ${headsText(unsplit)}.` : '8D is fully explained by 8E + 8F.'}
        </p>
      )}
    </SectionCard>
  );
};
