/**
 * Admin index numbers — active rate version + its placeholder count,
 * machines, pending overrides, users.
 * File path: /lib/admin/dashboard.ts
 */

import type { AdminClient } from "@/lib/admin/rates";
import { countPlaceholdersByVersion, getActiveRateVersion } from "@/lib/admin/rates";
import { countPendingOverrides } from "@/lib/admin/overrides";

export type AdminDashboard = {
  activeVersion: { id: string; label: string } | null;
  activePlaceholders: number;
  machineCount: number;
  pendingOverrides: number;
  userCount: number;
};

async function countRows(supabase: AdminClient, table: "machines" | "profiles"): Promise<number> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`countRows ${table}: ${error.message}`);
  return count ?? 0;
}

export async function loadAdminDashboard(supabase: AdminClient): Promise<AdminDashboard> {
  const [active, machineCount, pendingOverrides, userCount] = await Promise.all([
    getActiveRateVersion(supabase),
    countRows(supabase, "machines"),
    countPendingOverrides(supabase),
    countRows(supabase, "profiles"),
  ]);
  const placeholders = active ? await countPlaceholdersByVersion(supabase, [active.id]) : new Map<string, number>();
  return {
    activeVersion: active ? { id: active.id, label: active.label } : null,
    activePlaceholders: active ? (placeholders.get(active.id) ?? 0) : 0,
    machineCount,
    pendingOverrides,
    userCount,
  };
}
