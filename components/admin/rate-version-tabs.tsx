"use client";

/**
 * RateVersionTabs — one tab per rate table; selecting navigates to
 * /admin/rates/[id]/[table] so the URL is shareable and only the chosen
 * table's rows are loaded.
 * File path: /components/admin/rate-version-tabs.tsx
 */

import { useRouter } from "next/navigation";
import { useContent } from "@/components/providers/locale";
import { Tabs } from "@/components/ui/tabs";
import { routes } from "@/lib/routes";
import { RATE_TABLE_NAMES, type RateTableName } from "@/lib/admin/tables";

export function RateVersionTabs({ versionId, current }: { versionId: string; current: RateTableName }) {
  const c = useContent();
  const router = useRouter();
  return (
    <Tabs
      id={`rates-${versionId}`}
      ariaLabel={c.admin.rates.version.tabsLabel}
      items={RATE_TABLE_NAMES.map((name) => ({ value: name, label: c.admin.rates.tables[name] }))}
      value={current}
      onChange={(value) => router.push(routes.adminRateTable(versionId, value))}
      className="mb-4"
    />
  );
}
