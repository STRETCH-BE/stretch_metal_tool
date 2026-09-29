/**
 * Company settings — the single company_settings row (PDF sender block,
 * OSS switch, assembly / subcontract margins) as a sectioned form; a
 * notice lists the fields still carrying a placeholder marker.
 * File path: /app/(app)/admin/settings/company/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { interpolate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getCompanySettings } from "@/lib/admin/settings";
import { companySettingsPlaceholderFields } from "@/lib/admin/settings-types";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { SettingsFrame } from "@/components/admin/settings-frame";
import { CompanySettingsForm } from "@/components/admin/settings-company-form";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.company.title };
}

export default async function CompanySettingsPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const { row, missing } = await getCompanySettings(supabase);
  const placeholders = row ? companySettingsPlaceholderFields(row) : [];

  return (
    <SettingsFrame
      content={c}
      table="company"
      title={t.company.title}
      hint={t.company.hint}
      missing={missing}
      actions={
        placeholders.length > 0 ? <StatusChip severity="amber" label={t.placeholderChip} /> : row ? <StatusChip severity="green" label={t.confirmedChip} /> : null
      }
    >
      {placeholders.length > 0 && (
        <Notice tone="error">
          {interpolate(t.company.placeholderWarning, { fields: placeholders.map((field) => t.company.fields[field]).join(", ") })}
        </Notice>
      )}
      <Panel>
        <CompanySettingsForm key={row?.updated_at ?? "new"} row={row} />
      </Panel>
    </SettingsFrame>
  );
}
