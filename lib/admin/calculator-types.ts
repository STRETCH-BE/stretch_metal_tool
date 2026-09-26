/**
 * "Use as machine rate" form state (kept out of the "use server" file).
 * File path: /lib/admin/calculator-types.ts
 */

export type UseAsRateState = {
  status: "idle" | "error";
  error?: "forbidden" | "labelRequired" | "invalidRate" | "noActiveVersion" | "failed";
  label?: string;
};

export const INITIAL_USE_AS_RATE_STATE: UseAsRateState = { status: "idle" };
