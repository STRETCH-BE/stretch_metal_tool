/**
 * Pricing engine — public API. Import from "@/lib/pricing" (UI, server
 * actions, route handlers) or "../pricing" inside lib.
 * File path: /lib/pricing/index.ts
 *
 * Everything here is pure: no Next, no Supabase, no env. The only
 * server-side module is lib/rates/load.ts, which loads a RateSnapshot /
 * MachinePark from the database and hands them to priceQuote().
 */

export * from "./types";
export { PricingError, isPricingError, type PricingErrorCode } from "./errors";
export { PRICING_ENGINE_VERSION } from "./version";
export * from "./formulas";
export * from "./lookup";
export {
  buildPartContext,
  resolveBends,
  resolveConfirmedThreads,
  resolveHoles,
  resolveSlowContours,
  resolveThickness,
  type ConfirmedThreadGroup,
  type PartContext,
  type ResolvedBend,
} from "./context";
export {
  areParallel,
  flangeLengthsMm,
  holeEdgeToBendMm,
  spansOverlap,
  type BendSegment,
  type FlangeLengths,
} from "./bend-checks";
export { computeFinish, finishTypeFor, type FinishComputation, type FinishDrivers } from "./finish";
export { evaluateContextFlags, evaluatePartFlags, evaluateQuoteFlags } from "./feasibility";
export { buildContextOperations, buildItemOperations, weldRateRef, type ItemOperations } from "./operations";
export { priceCostQuote, priceQuote, resolveMarginPct } from "./price-quote";
export { priceMarketQuote, laserSetupGroupKey, type MarketPricingOptions } from "./market";
export {
  PACKAGING_BOX_MAX_MASS_KG,
  PACKAGING_BOX_MAX_SIDE_MM,
  applicableMinPartRules,
  decidePackaging,
  describeMinPartSizes,
  meetsMinPartSize,
  parseMinPartRule,
  resolveLeadTimeMultiplier,
  type LeadTimeResolution,
  type MinPartRule,
  type PackagingDecision,
  type PackagingKind,
} from "./market-rules";
export { lotLine, priceWeldingOnly, type WeldingBlock } from "./welding-block";
/* ─── Assembly mode (docs/assembly-mode-design.md) ─── */
export {
  PARTS_AT_COST_EXCLUDED_TYPES,
  accumulateAssemblyCosts,
  effectiveMemberPart,
  memberQty,
  nestKey,
  partitionItems,
  priceAssemblies,
  type AssemblyPricingContext,
  type AssemblyPricingResult,
  type ItemPartition,
} from "./assembly";
export {
  assessForming,
  formingFeasibility,
  formingHint,
  formingSuspected,
  rollArcLengthMm,
  suggestedStepBendHits,
  type FormingAssessment,
  type FormingCharge,
  type FormingContext,
  type FormingFeasibility,
  type FormingHint,
} from "./forming";
export { JOB_RATE_DEFAULTS, rowsToJobRates, weldSpeedFor, type JobRateRows } from "./job-rates";
export { PACKAGING_ALLOWANCE_PCT, STEP_BEND_PITCH_MM, grossMassKg } from "./market-rules";
export {
  packagingEnvelope,
  packagingForParts,
  packagingLine,
  packedPart,
  pickPackaging,
  type PackagingEnvelope,
  type PackedPart,
} from "./packaging";
export { priceScale, scaleQuantities, scaledInput } from "./scale";
export { pickShippingBand, shippingLine, type ShippingContext, type ShippingResult } from "./shipping";
export { EU_COUNTRY_CODES, computeVat, hasVatId, isEuCountry, normaliseCountry, type VatComputation, type VatInput } from "./vat";
export {
  flatLaserLimitsSchema,
  machineFromRow,
  machineLimitsSchemas,
  marginByClassSchema,
  num,
  numOrNull,
  pressBrakeLimitsSchema,
  priceBandsSchema,
  rollLimitsSchema,
  rowsToMachinePark,
  rowsToRateSnapshot,
  sheetFormatsSchema,
  tubeLaserLimitsSchema,
  weldLimitsSchema,
  type Loose,
  type RateRows,
} from "./snapshot";
export { OPERATION_LABELS, type OperationLabelKey } from "./labels";
export {
  validateExtraOperation,
  validatePartAnnotations,
  validatePricingItem,
  validateWeldingOnly,
  validateWeldingOnlySeam,
} from "./validate";
