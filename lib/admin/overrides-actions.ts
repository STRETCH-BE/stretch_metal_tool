"use server";

/**
 * Override decision server action — admin approves or rejects a pending
 * request with a note (useActionState reducer, one form per row).
 * File path: /lib/admin/overrides-actions.ts
 *
 * Fields: overrideId, decision ("approve" | "reject" — the name/value of
 * the submit button pressed), note. The role check happens here; the unit
 * of work is lib/admin/overrides.ts decideOverride().
 */

import { revalidatePath } from "next/cache";
import { ADMIN_ONLY, getCurrentUser, hasRole } from "@/lib/auth";
import { routes } from "@/lib/routes";
import { decideOverride } from "@/lib/admin/overrides";
import type { OverrideDecisionState } from "@/lib/admin/overrides-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function decideOverrideAction(
  _prev: OverrideDecisionState,
  formData: FormData
): Promise<OverrideDecisionState> {
  const overrideId = readString(formData, "overrideId").trim();
  const decision = readString(formData, "decision");
  const note = readString(formData, "note");
  const echo = { overrideId, note };

  const session = await getCurrentUser();
  if (!hasRole(session, ADMIN_ONLY) || !session) return { status: "error", error: "forbidden", ...echo };
  if (!UUID.test(overrideId)) return { status: "error", error: "notFound", ...echo };
  if (decision !== "approve" && decision !== "reject") return { status: "error", error: "generic", ...echo };

  try {
    const result = await decideOverride({ overrideId, decision, note, actorId: session.user.id });
    if (!result.ok) return { status: "error", error: result.error, message: result.message, ...echo };
    revalidatePath(routes.adminOverrides);
    revalidatePath(routes.admin);
    revalidatePath(routes.quote(result.override.quote_id));
    return { status: "decided", decision, overrideId, quoteReverted: result.quoteReverted };
  } catch (error) {
    console.error("[admin/overrides] decision failed", error);
    return { status: "error", error: "generic", ...echo };
  }
}
