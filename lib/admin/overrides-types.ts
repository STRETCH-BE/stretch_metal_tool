/**
 * Override decision form state — shared by the server action and the
 * client row form (kept out of the "use server" file).
 * File path: /lib/admin/overrides-types.ts
 */

export type OverrideDecisionState = {
  status: "idle" | "decided" | "error";
  decision?: "approve" | "reject";
  overrideId?: string;
  quoteReverted?: boolean;
  error?: "forbidden" | "notFound" | "alreadyDecided" | "noteRequired" | "db" | "generic";
  message?: string;
  /** Echoed note so the textarea keeps its text after an error. */
  note?: string;
};

export const INITIAL_OVERRIDE_DECISION_STATE: OverrideDecisionState = { status: "idle" };
