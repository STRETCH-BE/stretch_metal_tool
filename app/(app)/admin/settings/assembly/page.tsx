/**
 * Assembly labour rates — the single assembly_rates row (labour rate, gas
 * and wire, tack / fit-up / deburr / handling times, distortion factor,
 * step-bend and roll times) as a form with one Save.
 * File path: /app/(app)/admin/settings/assembly/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { getAssemblyRates } from "@/lib/admin/settings";
import { Panel } from "@/components/ui/panel";
import { SettingsFrame } from "@/components/admin/settings-frame";
import { AssemblyRatesForm } from "@/components/admin/settings-assembly-form";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.assembly.title };
}

export default async function AssemblyRatesPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const { row, missing } = await getAssemblyRates(supabase);

  return (
    <SettingsFrame content={c} table="assembly" title={t.assembly.title} hint={t.assembly.hint} missing={missing} placeholderHint>
      <Panel>
        <AssemblyRatesForm key={row?.updated_at ?? "new"} row={row} />
      </Panel>
    </SettingsFrame>
  );
}
