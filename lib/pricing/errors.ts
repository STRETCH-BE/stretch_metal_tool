/**
 * Pricing engine — the typed error the engine throws on invalid input.
 * File path: /lib/pricing/errors.ts
 *
 * The engine is pure and must never produce a silent NaN/Infinity price:
 * anything it cannot price correctly (qty ≤ 0, margin ≥ 100 %, a missing
 * part, a rate row that fails validation, a machine whose limits JSON is
 * malformed) raises a PricingError with a stable `code` the route handler
 * can map to a message, plus `details` for the log. Data problems that a
 * salesperson can act on (missing rate rows, over-limit parts) are NOT
 * errors — they become Flags on the quote so the UI can show them.
 */

export type PricingErrorCode =
  | "invalid_qty"
  | "invalid_margin"
  | "invalid_input"
  | "missing_part"
  | "invalid_rate_json"
  | "invalid_machine_limits"
  | "no_active_rate_version"
  | "rate_version_not_found"
  | "db_error";

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  readonly details: Record<string, number | string | boolean | null>;

  constructor(
    code: PricingErrorCode,
    message: string,
    details: Record<string, number | string | boolean | null> = {}
  ) {
    super(message);
    this.name = "PricingError";
    this.code = code;
    this.details = details;
  }
}

export function isPricingError(error: unknown): error is PricingError {
  return error instanceof PricingError;
}
