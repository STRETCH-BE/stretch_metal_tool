"use server";

/**
 * Machine editor server action — name + limits JSON, validated with the
 * pricing engine's zod schema for the machine kind, audit-logged.
 * File path: /lib/admin/machines-actions.ts
 *
 * useActionState reducer bound to the machine code. The client form
 * posts `name` and `limits` (a JSON string — from the typed form or the
 * raw textarea, both produce the same object). Admin only; writes as the
 * user through RLS (machines_admin_write). On any error the submitted
 * texts are echoed back so the form can re-populate after React 19's
 * form reset.
 */

import { revalidatePath } from "next/cache";
import { ADMIN_ONLY, getCurrentUser, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import type { Json, MachineRow } from "@/lib/db/types";
import { machineLimitsSchemas } from "@/lib/pricing/snapshot";
import type { MachineFormIssue, MachineFormState } from "@/lib/admin/machines";

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function asJson(row: MachineRow | null): Json | null {
  return row ? (JSON.parse(JSON.stringify(row)) as Json) : null;
}

export async function updateMachineAction(
  code: string,
  _prev: MachineFormState,
  formData: FormData
): Promise<MachineFormState> {
  const nameText = readString(formData, "name");
  const limitsText = readString(formData, "limits");
  const echo = { nameText, limitsText };

  const session = await getCurrentUser();
  if (!hasRole(session, ADMIN_ONLY) || !session) return { status: "error", error: "forbidden", ...echo };

  const name = nameText.trim().slice(0, 160);
  if (!name) return { status: "error", error: "nameRequired", ...echo };

  let parsed: unknown;
  try {
    parsed = JSON.parse(limitsText);
  } catch {
    return { status: "error", error: "invalidJson", ...echo };
  }

  const supabase = await createClient();
  const existing = await supabase.from("machines").select("*").eq("code", code).maybeSingle();
  if (existing.error) return { status: "error", error: "db", message: existing.error.message, ...echo };
  if (!existing.data) return { status: "error", error: "notFound", ...echo };
  const before = existing.data as MachineRow;

  const schema = machineLimitsSchemas[before.kind];
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues: MachineFormIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.map(String).join(".") : "(root)",
      message: issue.message,
    }));
    return { status: "error", error: "validation", issues, ...echo };
  }

  const { data, error } = await supabase
    .from("machines")
    .update({ name, limits: result.data as Json, updated_by: session.user.id })
    .eq("code", code)
    .select("*")
    .single();
  if (error || !data) {
    console.error("[admin/machines] update failed", error);
    return { status: "error", error: "db", message: error?.message, ...echo };
  }
  const after = data as MachineRow;

  await logAudit({
    actor: session.user.id,
    action: "machine.update",
    entity: "machines",
    entityId: code,
    before: asJson(before),
    after: asJson(after),
  });
  revalidatePath(routes.adminMachines);
  revalidatePath(routes.adminMachine(code));
  revalidatePath(routes.admin);
  return { status: "saved", machine: after };
}
