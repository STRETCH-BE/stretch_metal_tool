"use server";

/**
 * Machine-hour calculator → new rate version: clones the active version
 * under the given label, writes the computed rate into
 * rate_general.machine_rate_eur_h (placeholder = false) and opens the
 * new version. Activation stays a separate, explicit step on the versions
 * list (the admin may still edit other rows first).
 * File path: /lib/admin/calculator-actions.ts
 *
 * Fields: label, rate (canonical numeric string from the hidden input).
 * Audit: rate_version.clone + rate_general.update with before/after.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_ONLY, getCurrentUser, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import type { Json } from "@/lib/db/types";
import type { UseAsRateState } from "@/lib/admin/calculator-types";

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createVersionFromMachineRateAction(
  _prev: UseAsRateState,
  formData: FormData
): Promise<UseAsRateState> {
  const label = readString(formData, "label").slice(0, 120);
  const rate = Number(readString(formData, "rate"));
  const session = await getCurrentUser();
  if (!hasRole(session, ADMIN_ONLY) || !session) return { status: "error", error: "forbidden", label };
  if (!label) return { status: "error", error: "labelRequired", label };
  if (!Number.isFinite(rate) || rate <= 0) return { status: "error", error: "invalidRate", label };

  const supabase = await createClient();
  const active = await supabase.from("rate_versions").select("id, label").eq("active", true).maybeSingle();
  if (active.error || !active.data) return { status: "error", error: "noActiveVersion", label };

  const cloned = await supabase.rpc("clone_rate_version", { p_source: active.data.id, p_label: label });
  if (cloned.error || !cloned.data) {
    console.error("[admin/calculator] clone failed", cloned.error);
    return { status: "error", error: "failed", label };
  }
  const newId = cloned.data as string;
  await logAudit({
    actor: session.user.id,
    action: "rate_version.clone",
    entity: "rate_versions",
    entityId: newId,
    before: { source: active.data.id, sourceLabel: active.data.label },
    after: { id: newId, label, reason: "machine_hour_calculator" },
  });

  const before = await supabase.from("rate_general").select("*").eq("rate_version_id", newId).maybeSingle();
  const updated = await supabase
    .from("rate_general")
    .update({ machine_rate_eur_h: rate, placeholder: false })
    .eq("rate_version_id", newId)
    .select("*")
    .single();
  if (updated.error || !updated.data) {
    console.error("[admin/calculator] rate update failed", updated.error);
    return { status: "error", error: "failed", label };
  }
  await logAudit({
    actor: session.user.id,
    action: "rate_general.update",
    entity: "rate_general",
    entityId: newId,
    before: (before.data as Json | null) ?? null,
    after: updated.data as Json,
  });
  revalidatePath(routes.adminRates);
  revalidatePath(routes.admin);
  redirect(`${routes.adminRateVersion(newId)}?notice=cloned`);
}
