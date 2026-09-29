/**
 * VAT rates — rate per country (PL domestic, OSS destination rates) as an
 * inline-editable table with an add row.
 * File path: /app/(app)/admin/settings/vat/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { listVatRates } from "@/lib/admin/settings";
import { Panel } from "@/components/ui/panel";
import { SettingsFrame } from "@/components/admin/settings-frame";
import { VatRatesTable } from "@/components/admin/settings-row-tables";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.vat.title };
}

export default async function VatRatesPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const { rows, missing } = await listVatRates(supabase);

  return (
    <SettingsFrame content={c} table="vat" title={t.vat.title} hint={t.vat.hint} missing={missing}>
      <Panel flush>
        <VatRatesTable rows={rows} />
      </Panel>
    </SettingsFrame>
  );
}
