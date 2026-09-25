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
export { priceQuote, resolveMarginPct } from "./price-quote";
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
