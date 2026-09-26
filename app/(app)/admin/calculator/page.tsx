/**
 * Machine-hour calculator page — inputs persisted in the browser, live
 * breakdown, "use as machine rate in a new rate version".
 * File path: /app/(app)/admin/calculator/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { PageHeader } from "@/components/ui/page-header";
import { MachineHourCalculator } from "@/components/admin/machine-hour-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.calculator.title };
}

export default async function CalculatorPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.calculator;
  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <MachineHourCalculator />
    </>
  );
}
