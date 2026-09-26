/**
 * Machine reads for the admin editor (list + one machine) and the form
 * contract shared with the client component.
 * File path: /lib/admin/machines.ts
 *
 * Server reads take the caller's client. The form state type lives here
 * (not in the "use server" actions file). Limits are validated against
 * lib/pricing's zod schemas (machineLimitsSchemas) by kind — the same
 * schemas the pricing engine uses when it loads the park, so a saved
 * machine can always be parsed by the engine.
 */

import type { MachineRow, ProfileRow } from "@/lib/db/types";
import type { AdminClient } from "@/lib/admin/rates";

export type MachineListRow = MachineRow & { updatedByName: string | null };

export type MachineFormIssue = { path: string; message: string };

export type MachineFormState = {
  status: "idle" | "saved" | "error";
  error?: "forbidden" | "notFound" | "invalidJson" | "validation" | "db" | "generic" | "nameRequired";
  message?: string;
  issues?: MachineFormIssue[];
  machine?: MachineRow;
  /** Submitted raw JSON echoed back on error (React resets the form). */
  limitsText?: string;
  nameText?: string;
};

export const INITIAL_MACHINE_FORM_STATE: MachineFormState = { status: "idle" };

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

export async function listMachines(supabase: AdminClient): Promise<MachineListRow[]> {
  const { data, error } = await supabase.from("machines").select("*").order("code");
  if (error) fail("listMachines", error);
  const machines = (data ?? []) as MachineRow[];
  const ids = [...new Set(machines.map((m) => m.updated_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const profiles = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    if (profiles.error) fail("listMachines profiles", profiles.error);
    for (const p of (profiles.data ?? []) as Pick<ProfileRow, "id" | "full_name" | "email">[]) {
      names.set(p.id, p.full_name?.trim() || p.email);
    }
  }
  return machines.map((m) => ({ ...m, updatedByName: m.updated_by ? (names.get(m.updated_by) ?? null) : null }));
}

export async function getMachine(supabase: AdminClient, code: string): Promise<MachineRow | null> {
  const { data, error } = await supabase.from("machines").select("*").eq("code", code).maybeSingle();
  if (error) fail("getMachine", error);
  return (data as MachineRow | null) ?? null;
}
