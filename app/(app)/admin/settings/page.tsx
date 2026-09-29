/**
 * Settings overview — one row per assembly-mode settings table: row
 * count, rows still to confirm, status chip, link; plus the sub-nav.
 * File path: /app/(app)/admin/settings/page.tsx
 *
 * Admin only (requireRole). Reads through the RLS client; a table the
 * database lacks shows "table missing" instead of failing the page.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { loadSettingsOverview } from "@/lib/admin/settings";
import { SETTINGS_TABLE_SLUGS } from "@/lib/admin/settings-types";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SettingsFrame } from "@/components/admin/settings-frame";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.settings.title };
}

export default async function SettingsIndexPage() {
  await requireRole(["admin"]);
  const c = getContent(await getLocale());
  const t = c.admin.settings;
  const supabase = await createClient();
  const overview = await loadSettingsOverview(supabase);

  return (
    <SettingsFrame content={c} title={t.title} hint={t.subtitle} placeholderHint>
      <Panel flush>
        <TableWrap>
          <Table dense>
            <thead>
              <tr>
                <Th>{t.overview.columns.table}</Th>
                <Th align="num">{t.overview.columns.rows}</Th>
                <Th align="num">{t.overview.columns.placeholders}</Th>
                <Th>{t.overview.columns.status}</Th>
                <Th>{t.overview.columns.actions}</Th>
              </tr>
            </thead>
            <tbody>
              {overview.tables.map((row) => {
                const href = routes.adminSettingsTable(SETTINGS_TABLE_SLUGS[row.table]);
                return (
                  <tr key={row.table}>
                    <Td>
                      <Link href={href} className="lnk font-bold">
                        {t.nav[row.table]}
                      </Link>
                      <span className="mono ml-2 text-[11.5px] text-text-faint">{row.dbTable}</span>
                    </Td>
                    <Td align="num">{row.rowCount === null ? "—" : row.singleRow ? t.overview.singleRow : row.rowCount}</Td>
                    <Td align="num">{row.rowCount === null ? "—" : row.placeholderCount}</Td>
                    <Td>
                      {row.rowCount === null ? (
                        <StatusChip severity="red" label={t.overview.statusMissing} />
                      ) : row.placeholderCount > 0 ? (
                        <StatusChip severity="amber" label={interpolate(t.overview.statusPlaceholder, { count: row.placeholderCount })} />
                      ) : (
                        <StatusChip severity="green" label={t.overview.statusOk} />
                      )}
                    </Td>
                    <Td>
                      <Link href={href} className="btn btn-ghost btn-sm">
                        {t.overview.open}
                        <span aria-hidden="true" className="btn-arrow">
                          →
                        </span>
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Panel>
    </SettingsFrame>
  );
}
