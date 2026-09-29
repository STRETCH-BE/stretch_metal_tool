/**
 * Admin index numbers — active rate version + its placeholder count,
 * machines, pending overrides, users, and the assembly-mode settings
 * tables (missing / placeholder rows) for the settings card.
 * File path: /lib/admin/dashboard.ts
 *
 * The settings overview is read tolerant of a database that predates the
 * assembly-mode migration (missing tables → `settings.missing`); any other
 * failure there is logged and leaves `settings` null so the dashboard
 * still renders the other cards.
 */

import type { AdminClient } from "@/lib/admin/rates";
import { countPlaceholdersByVersion, getActiveRateVersion } from "@/lib/admin/rates";
import { countPendingOverrides } from "@/lib/admin/overrides";
import { loadSettingsOverview } from "@/lib/admin/settings";

export type AdminDashboardSettings = {
  /** At least one settings table does not exist (run the migration). */
  missing: boolean;
  /** Placeholder rows (and company fields with a placeholder marker) still to confirm. */
  placeholderCount: number;
};

export type AdminDashboard = {
  activeVersion: { id: string; label: string } | null;
  activePlaceholders: number;
  machineCount: number;
  pendingOverrides: number;
  userCount: number;
  /** null when the settings overview could not be read. */
  settings: AdminDashboardSettings | null;
};

async function loadSettingsCard(supabase: AdminClient): Promise<AdminDashboardSettings | null> {
  try {
    const overview = await loadSettingsOverview(supabase);
    return { missing: overview.missing, placeholderCount: overview.placeholderCount };
  } catch (error) {
    console.error("[admin/dashboard] settings overview failed", error);
    return null;
  }
}

async function countRows(supabase: AdminClient, table: "machines" | "profiles"): Promise<number> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`countRows ${table}: ${error.message}`);
  return count ?? 0;
}

export async function loadAdminDashboard(supabase: AdminClient): Promise<AdminDashboard> {
  const [active, machineCount, pendingOverrides, userCount, settings] = await Promise.all([
    getActiveRateVersion(supabase),
    countRows(supabase, "machines"),
    countPendingOverrides(supabase),
    countRows(supabase, "profiles"),
    loadSettingsCard(supabase),
  ]);
  const placeholders = active ? await countPlaceholdersByVersion(supabase, [active.id]) : new Map<string, number>();
  return {
    activeVersion: active ? { id: active.id, label: active.label } : null,
    activePlaceholders: active ? (placeholders.get(active.id) ?? 0) : 0,
    machineCount,
    pendingOverrides,
    userCount,
    settings,
  };
}
