/**
 * Shipping rates — carrier weight bands per destination country as an
 * inline-editable table (unique country + max kg); placeholder rows carry
 * the amber chip until saved.
 * File path: /app/(app)/admin/settings/shipping/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { listShippingRates } from "@/lib/admin/settings";
import { Panel } from "@/components/ui/panel";
import { SettingsFrame } from "@/components/admin/settings-frame";
import { ShippingRatesTable } from "@/components/admin/settings-row-tables";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.shipping.title };
}

export default async function ShippingRatesPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const { rows, missing } = await listShippingRates(supabase);

  return (
    <SettingsFrame content={c} table="shipping" title={t.shipping.title} hint={t.shipping.hint} missing={missing} placeholderHint>
      <Panel flush>
        <ShippingRatesTable rows={rows} />
      </Panel>
    </SettingsFrame>
  );
}
