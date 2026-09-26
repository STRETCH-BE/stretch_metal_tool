/**
 * Role-change guard — the last admin can never be demoted (nor demote
 * themself), otherwise nobody could edit rates or users again.
 * File path: /lib/admin/users-guard.ts
 *
 * Pure so the rule is unit-tested without a database
 * (test/admin/users-guard.test.ts). The server action counts the admins
 * and passes the numbers in; `adminCount` is the number of admin profiles
 * BEFORE the change.
 */

import type { UserRole } from "@/lib/db/types";

export type RoleChangeCheck = {
  currentRole: UserRole;
  newRole: UserRole;
  /** Admin profiles before the change. */
  adminCount: number;
};

export type RoleChangeVerdict = { ok: true } | { ok: false; reason: "lastAdmin" };

export function checkRoleChange(input: RoleChangeCheck): RoleChangeVerdict {
  const demotesAdmin = input.currentRole === "admin" && input.newRole !== "admin";
  if (demotesAdmin && input.adminCount <= 1) return { ok: false, reason: "lastAdmin" };
  return { ok: true };
}
