"use server";

/**
 * User administration server actions — invite by e-mail, change role and
 * locale. Admin only, audit-logged (user.invite, user.role, user.locale).
 * File path: /lib/admin/users-actions.ts
 *
 * Invite: the service-role client's auth.admin.inviteUserByEmail creates
 * the auth user (the DB trigger handle_new_user adds the profile row), then
 * the action writes role, locale and name straight into public.profiles
 * with the same service-role client. The role deliberately does NOT travel
 * in the invite's user metadata: raw_user_meta_data is writable by any
 * client at sign-up, so a role read from it by the trigger is a
 * privilege-escalation channel — the admin path must not depend on it
 * (only full_name and locale, harmless, go in the metadata). If the
 * profile write fails after the e-mail went out the form says so
 * ("roleNotSet") and the row form on the list fixes the role. Missing
 * service key → "notConfigured" (no throw). Role change: the pure guard in
 * lib/admin/users-guard.ts refuses to demote the last admin (which also
 * covers an admin demoting themself). Profile updates run as the admin
 * through RLS (profiles_admin_all).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ONLY, getCurrentUser, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import type { ProfileRow } from "@/lib/db/types";
import { checkRoleChange } from "@/lib/admin/users-guard";
import {
  isUserLocale,
  isUserRole,
  type InviteFormState,
  type UserRowFormState,
} from "@/lib/admin/users";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  full_name: z.string().trim().max(160),
  role: z.enum(["admin", "sales", "viewer"]),
  locale: z.enum(["pl", "en"]),
});

export async function inviteUserAction(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const values = {
    email: readString(formData, "email"),
    full_name: readString(formData, "full_name"),
    role: readString(formData, "role") || "sales",
    locale: readString(formData, "locale") || "pl",
  };
  const session = await getCurrentUser();
  if (!hasRole(session, ADMIN_ONLY) || !session) return { status: "error", error: "forbidden", values };
  if (!env.hasSupabaseAdmin()) return { status: "error", error: "notConfigured", values };

  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return { status: "error", error: emailIssue ? "invalidEmail" : "required", values };
  }

  const fullName = parsed.data.full_name || null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      // No `role` here — see the header: the role is written to the profile below.
      data: { full_name: fullName, locale: parsed.data.locale },
      redirectTo: `${env.siteUrl()}${routes.authCallback}`,
    });
    if (error) {
      console.error("[admin/users] invite failed", error);
      const exists = /already|exists|registered/i.test(error.message);
      return { status: "error", error: exists ? "exists" : "generic", values };
    }
    const userId = data.user?.id ?? null;
    const profile = userId
      ? await admin
          .from("profiles")
          .upsert(
            { id: userId, email: parsed.data.email, full_name: fullName, role: parsed.data.role, locale: parsed.data.locale },
            { onConflict: "id" }
          )
          .select("*")
          .single()
      : { data: null, error: { message: "invite returned no user id" } };
    if (profile.error || !profile.data) {
      console.error("[admin/users] profile write after invite failed", profile.error);
      await logAudit({
        actor: session.user.id,
        action: "user.invite",
        entity: "profiles",
        entityId: userId,
        after: { email: parsed.data.email, role: null, locale: null, intendedRole: parsed.data.role, intendedLocale: parsed.data.locale },
      });
      revalidatePath(routes.adminUsers);
      revalidatePath(routes.admin);
      return { status: "error", error: "roleNotSet", values };
    }
    const saved = profile.data as ProfileRow;
    await logAudit({
      actor: session.user.id,
      action: "user.invite",
      entity: "profiles",
      entityId: userId,
      after: { email: saved.email, role: saved.role, locale: saved.locale },
    });
  } catch (error) {
    console.error("[admin/users] invite failed", error);
    return { status: "error", error: "generic", values };
  }
  revalidatePath(routes.adminUsers);
  revalidatePath(routes.admin);
  return { status: "sent", email: parsed.data.email };
}

/** useActionState reducer bound to the target user id. Fields: role, locale. */
export async function updateUserAction(
  userId: string,
  _prev: UserRowFormState,
  formData: FormData
): Promise<UserRowFormState> {
  const session = await getCurrentUser();
  if (!hasRole(session, ADMIN_ONLY) || !session) return { status: "error", error: "forbidden" };
  if (!UUID.test(userId)) return { status: "error", error: "notFound" };
  const role = readString(formData, "role");
  const locale = readString(formData, "locale");
  if (!isUserRole(role) || !isUserLocale(locale)) return { status: "error", error: "invalid" };

  const supabase = await createClient();
  const existing = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (existing.error) {
    console.error("[admin/users] read failed", existing.error);
    return { status: "error", error: "generic" };
  }
  if (!existing.data) return { status: "error", error: "notFound" };
  const before = existing.data as ProfileRow;

  if (before.role === role && before.locale === locale) return { status: "noChange", profile: before };

  if (before.role !== role) {
    const { count, error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) {
      console.error("[admin/users] admin count failed", error);
      return { status: "error", error: "generic" };
    }
    const verdict = checkRoleChange({ currentRole: before.role, newRole: role, adminCount: count ?? 0 });
    if (!verdict.ok) return { status: "error", error: verdict.reason };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ role, locale })
    .eq("id", userId)
    .select("*")
    .single();
  if (error || !data) {
    console.error("[admin/users] update failed", error);
    return { status: "error", error: "generic" };
  }
  const after = data as ProfileRow;

  if (before.role !== after.role) {
    await logAudit({
      actor: session.user.id,
      action: "user.role",
      entity: "profiles",
      entityId: userId,
      before: { role: before.role, email: before.email },
      after: { role: after.role, email: after.email },
    });
  }
  if (before.locale !== after.locale) {
    await logAudit({
      actor: session.user.id,
      action: "user.locale",
      entity: "profiles",
      entityId: userId,
      before: { locale: before.locale },
      after: { locale: after.locale },
    });
  }
  revalidatePath(routes.adminUsers);
  return { status: "saved", profile: after };
}
