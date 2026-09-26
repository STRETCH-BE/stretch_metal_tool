/**
 * User administration reads + form contracts (invite form, per-row role /
 * locale form).
 * File path: /lib/admin/users.ts
 *
 * Profiles are readable by every signed-in user (RLS profiles_select),
 * the admin-only guard sits on the pages and actions. Invites need the
 * service-role key (auth.admin API) — the page shows a notice when
 * env.hasSupabaseAdmin() is false and the action refuses with
 * "notConfigured".
 */

import type { ProfileRow, UserLocale, UserRole } from "@/lib/db/types";
import type { AdminClient } from "@/lib/admin/rates";

export const USER_ROLES: readonly UserRole[] = ["admin", "sales", "viewer"];
export const USER_LOCALES: readonly UserLocale[] = ["pl", "en"];

export type InviteFormState = {
  status: "idle" | "sent" | "error";
  error?: "invalidEmail" | "required" | "forbidden" | "generic" | "exists" | "notConfigured";
  email?: string;
  values?: { email: string; full_name: string; role: string; locale: string };
};

export const INITIAL_INVITE_FORM_STATE: InviteFormState = { status: "idle" };

export type UserRowFormState = {
  status: "idle" | "saved" | "error" | "noChange";
  error?: "lastAdmin" | "forbidden" | "generic" | "notFound" | "invalid";
  profile?: ProfileRow;
};

export const INITIAL_USER_ROW_FORM_STATE: UserRowFormState = { status: "idle" };

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

export async function listUsers(supabase: AdminClient): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
  if (error) fail("listUsers", error);
  return (data ?? []) as ProfileRow[];
}

export async function countAdmins(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) fail("countAdmins", error);
  return count ?? 0;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function isUserLocale(value: unknown): value is UserLocale {
  return typeof value === "string" && (USER_LOCALES as readonly string[]).includes(value);
}
