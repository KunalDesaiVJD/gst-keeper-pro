// Builder module — rate & classification engine.
//
// Governing law: Notification 11/2017-CT(R) Entry 3, as substituted by
// Notification 03/2019-CT(R) w.e.f. 01.04.2019. SAC 9954.
//
// RATE CONVENTION (firm's elected presentation):
// para 2 of Notif 11/2017 deems 1/3rd of the total amount charged to be the
// value of land. We report the TAXABLE VALUE AFTER that deduction (2/3rds of
// consideration) at the NOTIFIED rate — 1.5% / 7.5% / 18% — rather than the
// full consideration at the effective rate. Both produce identical tax; only
// the taxable value reported in GSTR-1 Table 7 / 3B Table 3.1(a) differs.
//
//   Affordable residential              1.5% on 2/3rd   (eff. 1%)
//   Other residential                   7.5% on 2/3rd   (eff. 5%)
//   Commercial in an RREP               7.5% on 2/3rd   (eff. 5%)
//   Commercial in a REP other than RREP  18% on 2/3rd   (eff. 12%)
//
// All supplies are intra-state: under s.12(3)(a) IGST Act the place of supply
// for a service in relation to immovable property is the location of the
// property. Supplier and property both being in Gujarat, tax is always
// CGST + SGST in equal halves. IGST never arises.

export type BuilderRateCode =
  | 'AFFORDABLE'
  | 'OTHER_RESIDENTIAL'
  | 'COMMERCIAL_RREP'
  | 'COMMERCIAL_REP';

/**
 * Rate codes an invoice can carry. The four unit codes above, plus delay
 * interest — which by the firm's election is billed as a supply SEPARATE from
 * construction, so the 1/3rd land deduction does not touch it and its notified
 * rate is also its effective rate.
 */
export type InvoiceRateCode = BuilderRateCode | 'DELAY_INTEREST_18';

export type UnitType = 'Residential' | 'Commercial';

export type ChargeHead =
  | 'PLC'
  | 'DEVELOPMENT'
  | 'PARKING'
  | 'CLUB'
  | 'UTILITY_DEPOSIT'
  | 'LEGAL'
  | 'MAINTENANCE_CORPUS'
  | 'OTHER';

/** Notified rate applied to the 2/3rd taxable value. */
export const NOTIFIED_RATE_PCT: Record<BuilderRateCode, number> = {
  AFFORDABLE: 1.5,
  OTHER_RESIDENTIAL: 7.5,
  COMMERCIAL_RREP: 7.5,
  COMMERCIAL_REP: 18,
};

/** Equivalent rate on the full consideration including land. */
export const EFFECTIVE_RATE_PCT: Record<BuilderRateCode, number> = {
  AFFORDABLE: 1,
  OTHER_RESIDENTIAL: 5,
  COMMERCIAL_RREP: 5,
  COMMERCIAL_REP: 12,
};

export const RATE_CODE_LABEL: Record<BuilderRateCode, string> = {
  AFFORDABLE: 'Affordable residential — 1.5% (eff. 1%)',
  OTHER_RESIDENTIAL: 'Other residential — 7.5% (eff. 5%)',
  COMMERCIAL_RREP: 'Commercial in RREP — 7.5% (eff. 5%)',
  COMMERCIAL_REP: 'Commercial in REP other than RREP — 18% (eff. 12%)',
};

/** Canonical order of the charge heads — drives every questionnaire, template
 *  column and working paper, so it lives here with the other pure rate data
 *  rather than in the data-access layer. */
export const CHARGE_HEADS: ChargeHead[] = [
  'PLC', 'DEVELOPMENT', 'PARKING', 'CLUB',
  'UTILITY_DEPOSIT', 'LEGAL', 'MAINTENANCE_CORPUS', 'OTHER',
];

export const CHARGE_HEAD_LABEL: Record<ChargeHead, string> = {
  PLC: 'Preferential location / floor rise',
  DEVELOPMENT: 'Development / infrastructure charges',
  PARKING: 'Parking',
  CLUB: 'Club membership / amenities',
  UTILITY_DEPOSIT: 'Electricity & water connection deposit',
  LEGAL: 'Legal / documentation charges',
  MAINTENANCE_CORPUS: 'Maintenance deposit / corpus fund',
  OTHER: 'Other charges',
};

/** Maps a charge head to its column in builder_client_settings. */
export const CHARGE_HEAD_SETTING_KEY: Record<ChargeHead, string> = {
  PLC: 'incl_plc',
  DEVELOPMENT: 'incl_development',
  PARKING: 'incl_parking',
  CLUB: 'incl_club',
  UTILITY_DEPOSIT: 'incl_utility_deposit',
  LEGAL: 'incl_legal',
  MAINTENANCE_CORPUS: 'incl_maintenance_corpus',
  OTHER: 'incl_other',
};

/** Rs. 45,00,000 — the affordable-housing consideration ceiling. */
export const AFFORDABLE_VALUE_LIMIT = 4500000;
/** Carpet area ceilings in sq m: 60 in metropolitan cities, 90 elsewhere. */
export const AFFORDABLE_AREA_LIMIT_METRO = 60;
export const AFFORDABLE_AREA_LIMIT_NON_METRO = 90;
/** A project is an RREP while commercial carpet area stays within this share. */
export const RREP_COMMERCIAL_THRESHOLD = 0.15;

const SQ_FT_PER_SQ_M = 10.7639;

export const sqFtToSqM = (sqFt: number): number => sqFt / SQ_FT_PER_SQ_M;
export const sqMToSqFt = (sqM: number): number => sqM * SQ_FT_PER_SQ_M;

// Money is rounded to 2dp at every boundary so a unit's parts always re-add to
// its whole — the per-unit tie-out depends on this.
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── The 15% RREP test ──────────────────────────────────────────────────────

export interface RrepTest {
  residentialSqM: number;
  commercialSqM: number;
  totalSqM: number;
  /** Commercial share, 0–1. Zero when the project has no carpet area yet. */
  commercialShare: number;
  isRrep: boolean;
  /** True when there is no area to test — treated as RREP until units exist. */
  isIndeterminate: boolean;
}

/**
 * RREP = a REP in which the carpet area of the commercial apartments is not
 * more than 15% of the total carpet area of all apartments in the project.
 * Tested at RERA-project level, across all blocks.
 */
export const testRrep = (residentialSqM: number, commercialSqM: number): RrepTest => {
  const resi = Math.max(0, residentialSqM || 0);
  const comm = Math.max(0, commercialSqM || 0);
  const total = resi + comm;
  if (total <= 0) {
    return {
      residentialSqM: resi, commercialSqM: comm, totalSqM: 0,
      commercialShare: 0, isRrep: true, isIndeterminate: true,
    };
  }
  const share = comm / total;
  return {
    residentialSqM: resi,
    commercialSqM: comm,
    totalSqM: total,
    commercialShare: share,
    isRrep: share <= RREP_COMMERCIAL_THRESHOLD,
    isIndeterminate: false,
  };
};

// ─── Gross consideration for a unit ─────────────────────────────────────────

export interface UnitCharge {
  charge_head: ChargeHead;
  amount: number;
  /** null = follow the client-level election for this head. */
  include_override?: boolean | null;
}

/** The subset of builder_client_settings this engine reads. */
export interface ChargeInclusionSettings {
  incl_plc: boolean;
  incl_development: boolean;
  incl_parking: boolean;
  incl_club: boolean;
  incl_utility_deposit: boolean;
  incl_legal: boolean;
  incl_maintenance_corpus: boolean;
  incl_other: boolean;
}

export const DEFAULT_CHARGE_INCLUSIONS: ChargeInclusionSettings = {
  incl_plc: true,
  incl_development: true,
  incl_parking: true,
  incl_club: true,
  incl_utility_deposit: true,
  incl_legal: true,
  incl_maintenance_corpus: true,
  incl_other: true,
};

/** Does this charge form part of the gross amount charged for the apartment? */
export const isChargeIncluded = (
  charge: UnitCharge,
  settings: ChargeInclusionSettings = DEFAULT_CHARGE_INCLUSIONS,
): boolean => {
  if (charge.include_override !== null && charge.include_override !== undefined) {
    return charge.include_override;
  }
  const key = CHARGE_HEAD_SETTING_KEY[charge.charge_head] as keyof ChargeInclusionSettings;
  return settings[key] !== false;
};

export interface GrossConsideration {
  base: number;
  includedCharges: number;
  excludedCharges: number;
  /** base + includedCharges — the "gross amount charged" for the apartment. */
  gross: number;
}

/**
 * Gross amount charged for the apartment, exclusive of GST.
 *
 * This single figure serves both the Rs. 45 lakh affordable test and the
 * taxable value — they are the same statutory base, which is why a charge head
 * carries one inclusion switch rather than two.
 */
export const computeGrossConsideration = (
  baseConsideration: number,
  charges: UnitCharge[] = [],
  settings: ChargeInclusionSettings = DEFAULT_CHARGE_INCLUSIONS,
): GrossConsideration => {
  let included = 0;
  let excluded = 0;
  charges.forEach((c) => {
    const amt = Number(c.amount) || 0;
    if (isChargeIncluded(c, settings)) included += amt;
    else excluded += amt;
  });
  const base = Number(baseConsideration) || 0;
  return {
    base: round2(base),
    includedCharges: round2(included),
    excludedCharges: round2(excluded),
    gross: round2(base + included),
  };
};

// ─── Affordable test & rate resolution ──────────────────────────────────────

export interface AffordableTest {
  isAffordable: boolean;
  areaLimitSqM: number;
  areaWithinLimit: boolean;
  valueWithinLimit: boolean;
  /** How much headroom is left before the Rs. 45L ceiling; negative = breached. */
  valueHeadroom: number;
}

/**
 * Both limbs must hold, and only a residential apartment can qualify.
 *
 * The value limb is the one that moves: adding a PLC or parking charge can
 * push a unit past Rs. 45 lakh long after booking, and the concession is then
 * treated as never having applied.
 */
export const testAffordable = (
  unitType: UnitType,
  carpetAreaSqM: number,
  grossConsideration: number,
  isMetro: boolean,
): AffordableTest => {
  const areaLimit = isMetro ? AFFORDABLE_AREA_LIMIT_METRO : AFFORDABLE_AREA_LIMIT_NON_METRO;
  const area = Number(carpetAreaSqM) || 0;
  const gross = Number(grossConsideration) || 0;
  const areaOk = unitType === 'Residential' && area > 0 && area <= areaLimit;
  const valueOk = gross > 0 && gross <= AFFORDABLE_VALUE_LIMIT;
  return {
    isAffordable: unitType === 'Residential' && areaOk && valueOk,
    areaLimitSqM: areaLimit,
    areaWithinLimit: areaOk,
    valueWithinLimit: valueOk,
    valueHeadroom: round2(AFFORDABLE_VALUE_LIMIT - gross),
  };
};

/**
 * Rate code from the project mix and the unit's own characteristics.
 *
 * Note commercial units split on the project-level RREP test, not on anything
 * about the unit: the same shop is 7.5% inside an RREP and 18% inside a REP
 * other than RREP.
 */
export const resolveRateCode = (
  unitType: UnitType,
  isAffordable: boolean,
  isRrep: boolean,
): BuilderRateCode => {
  if (unitType === 'Commercial') {
    return isRrep ? 'COMMERCIAL_RREP' : 'COMMERCIAL_REP';
  }
  return isAffordable ? 'AFFORDABLE' : 'OTHER_RESIDENTIAL';
};

export interface UnitClassification {
  gross: GrossConsideration;
  affordable: AffordableTest;
  rateCode: BuilderRateCode;
  ratePct: number;           // notified, on 2/3rd value
  effectiveRatePct: number;  // on full consideration
  areaLimitSqM: number;
  isRrep: boolean;
  /** True when a posted reclassification floors this below what raw inputs
   *  would otherwise compute — see {@link applyReclassificationLock}. */
  locked: boolean;
  lock?: ReclassificationLock;
}

/** One call from raw unit inputs to a fully classified unit. */
export const classifyUnit = (params: {
  unitType: UnitType;
  carpetAreaSqM: number;
  baseConsideration: number;
  charges?: UnitCharge[];
  isMetro: boolean;
  isRrep: boolean;
  settings?: ChargeInclusionSettings;
}): UnitClassification => {
  const gross = computeGrossConsideration(
    params.baseConsideration, params.charges || [],
    params.settings || DEFAULT_CHARGE_INCLUSIONS,
  );
  const affordable = testAffordable(
    params.unitType, params.carpetAreaSqM, gross.gross, params.isMetro,
  );
  const rateCode = resolveRateCode(params.unitType, affordable.isAffordable, params.isRrep);
  return {
    gross,
    affordable,
    rateCode,
    ratePct: NOTIFIED_RATE_PCT[rateCode],
    effectiveRatePct: EFFECTIVE_RATE_PCT[rateCode],
    areaLimitSqM: affordable.areaLimitSqM,
    isRrep: params.isRrep,
    locked: false,
  };
};

/** A unit's posted reclassification — the permanent rate the "no downgrade"
 *  position (§8) holds it to, regardless of what current inputs compute. */
export interface ReclassificationLock {
  toRateCode: BuilderRateCode;
  toRatePct: number;
  postedAt: string;
  reason: string | null;
}

/**
 * Floors a freshly computed classification at a unit's posted reclassification.
 *
 * `classifyUnit()` is a pure function of TODAY's base consideration and
 * charges — it has no memory of history. That is correct for a unit crossing
 * ₹45L for the first time, but wrong once a reclassification has posted: per
 * §8 of BUILDER_GST_POSITIONS.md, "a later fall below ₹45 lakh does not
 * restore the concession." Without this, editing (or correcting) a charge
 * after the crossing silently recomputes the unit back to the lower rate
 * everywhere the raw classification is used — the display badge, and the
 * actual rate a new receipt or invoice gets taxed at.
 *
 * Only ever floors upward-to-locked, never the reverse: a unit's residential
 * classification has exactly two tiers (AFFORDABLE, OTHER_RESIDENTIAL), so
 * once locked at the higher one there is nothing higher current inputs could
 * legitimately compute to.
 */
export function applyReclassificationLock(
  cls: UnitClassification,
  lock: ReclassificationLock | null | undefined,
): UnitClassification {
  if (!lock) return cls;
  return {
    ...cls,
    rateCode: lock.toRateCode,
    ratePct: lock.toRatePct,
    effectiveRatePct: EFFECTIVE_RATE_PCT[lock.toRateCode],
    // Keep isAffordable in step with the locked rate code — otherwise a unit
    // can show "Affordable: Yes" next to "Rate: 7.5%", which is exactly the
    // kind of self-contradictory display this exists to prevent. A lock only
    // ever fires by moving OUT of AFFORDABLE (see findReclassCandidates), so
    // this is always a flip to false, never the reverse.
    affordable: { ...cls.affordable, isAffordable: lock.toRateCode === 'AFFORDABLE' },
    locked: true,
    lock,
  };
}

// ─── Tax computation ────────────────────────────────────────────────────────

export interface TaxBreakup {
  /** Consideration excluding GST, including land. */
  consideration: number;
  /** 1/3rd deemed land value under para 2 of Notif 11/2017. */
  landDeduction: number;
  /** 2/3rds — what GSTR-1 Table 7 and 3B Table 3.1(a) carry. */
  taxableValue: number;
  ratePct: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  /** Consideration + tax. */
  grossInclusive: number;
}

/**
 * Tax on a GST-exclusive consideration.
 * Always CGST + SGST in equal halves — see the note on s.12(3)(a) above.
 */
export const computeTax = (consideration: number, rateCode: BuilderRateCode): TaxBreakup => {
  const amt = Number(consideration) || 0;
  const ratePct = NOTIFIED_RATE_PCT[rateCode];
  const landDeduction = round2(amt / 3);
  // Derive the taxable value by subtraction so taxableValue + landDeduction
  // re-adds to the consideration exactly, with no rounding drift.
  const taxableValue = round2(amt - landDeduction);
  const totalTax = round2((taxableValue * ratePct) / 100);
  const cgst = round2(totalTax / 2);
  const sgst = round2(totalTax - cgst);
  return {
    consideration: round2(amt),
    landDeduction,
    taxableValue,
    ratePct,
    cgst,
    sgst,
    totalTax: round2(cgst + sgst),
    grossInclusive: round2(amt + cgst + sgst),
  };
};

/**
 * Tax on a supply that carries NO land deduction — the whole amount is the
 * taxable value.
 *
 * Used for delay interest recovered from members where the firm has elected the
 * flat 18% treatment. Note this is a divergence from s.15(2)(d), which would
 * include such interest in the value of the principal supply and so carry the
 * unit's own rate: 18% is at or above every unit rate, so it over-collects
 * rather than under-declares and carries no exposure to the department.
 */
export const computeFlatTax = (amount: number, ratePct: number): TaxBreakup => {
  const amt = round2(Number(amount) || 0);
  const rate = Number(ratePct) || 0;
  const totalTax = round2((amt * rate) / 100);
  const cgst = round2(totalTax / 2);
  const sgst = round2(totalTax - cgst);
  return {
    consideration: amt,
    landDeduction: 0,
    taxableValue: amt,
    ratePct: rate,
    cgst,
    sgst,
    totalTax: round2(cgst + sgst),
    grossInclusive: round2(amt + cgst + sgst),
  };
};

/**
 * Rule 35 — back out the tax from a receipt that is inclusive of GST.
 *
 *   tax = inclusive x rate / (100 + rate)
 *
 * The rate here is the EFFECTIVE rate on full consideration (1/5/12), because
 * an inclusive receipt is inclusive of tax on the whole amount charged, not on
 * the 2/3rd taxable value.
 *
 * This is the correction path for receipts that were wrongly taxed on the
 * inclusive figure: restating one recomputes the tax and exposes the excess.
 */
export const backCalculateFromInclusive = (
  inclusiveAmount: number,
  rateCode: BuilderRateCode,
): TaxBreakup => {
  const inc = Number(inclusiveAmount) || 0;
  const effRate = EFFECTIVE_RATE_PCT[rateCode];
  const consideration = round2((inc * 100) / (100 + effRate));
  return computeTax(consideration, rateCode);
};

/**
 * Income-tax TDS u/s 194-IA: 1% where consideration is Rs. 50 lakh or more,
 * on the ENTIRE aggregate consideration (not the excess over Rs. 50 lakh).
 *
 * This has no GST effect — GST is computed on the gross consideration, never
 * on the net-of-TDS amount the builder actually banks.
 */
export const TDS_194IA_THRESHOLD = 5000000;
export const TDS_194IA_RATE_PCT = 1;

export const computeTds194IA = (totalConsideration: number, receiptAmount: number): number => {
  if ((Number(totalConsideration) || 0) < TDS_194IA_THRESHOLD) return 0;
  return round2(((Number(receiptAmount) || 0) * TDS_194IA_RATE_PCT) / 100);
};

export const isTds194IAApplicable = (totalConsideration: number): boolean =>
  (Number(totalConsideration) || 0) >= TDS_194IA_THRESHOLD;

// ─── Naming-vs-type sanity check ────────────────────────────────────────────
//
// Not a validation gate — a soft warning. A unit's actual rate is driven
// entirely by its `unit_type` (§ above), never by its number; this exists
// only to catch the transcription slip where a unit named like a shop gets
// left on the form's default Residential (or vice versa) before it reaches
// the database, where it would otherwise sit — silently correct by the
// engine's own logic, incorrect against what the unit actually is — until
// caught downstream by the reclassification sweep.

const COMMERCIAL_NAME_HINTS = ['shop', 'office', 'showroom', 'godown', 'warehouse', 'commercial'];
const RESIDENTIAL_NAME_HINTS = ['flat', 'row house', 'rowhouse', 'villa', 'bungalow', 'residential'];

/**
 * Null when the unit number carries no hint, or the hint agrees with the
 * selected type. Otherwise a short message naming the exact word that
 * triggered it, so the warning is checkable rather than a bare assertion.
 */
export const suggestedUnitTypeMismatch = (unitNo: string, unitType: UnitType): string | null => {
  const lower = (unitNo || '').toLowerCase();
  if (unitType === 'Residential') {
    const hit = COMMERCIAL_NAME_HINTS.find((h) => lower.includes(h));
    if (hit) return `"${unitNo}" contains "${hit}", which usually means Commercial — this unit is set to Residential.`;
  } else {
    const hit = RESIDENTIAL_NAME_HINTS.find((h) => lower.includes(h));
    if (hit) return `"${unitNo}" contains "${hit}", which usually means Residential — this unit is set to Commercial.`;
  }
  return null;
};

// ─── Formatting helpers ─────────────────────────────────────────────────────

export const formatINR = (n: number): string =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    .format(Number(n) || 0);

export const formatSqM = (n: number): string =>
  `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(n) || 0)} sq m`;

export const formatPct = (share: number): string => `${(share * 100).toFixed(2)}%`;
