/**
 * Bend-table versions — label, status, row count, quotes using it,
 * created; clone-to-edit form and activate button per draft.
 * File path: /app/(app)/admin/bend-table/page.tsx
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { listBendTableVersions } from "@/lib/admin/sheetmetal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { BendActivateButton, BendCloneForm } from "@/components/admin/sheet-forms";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.sheet.bendTable.title };
}

export default async function BendTablePage() {
  await requireRole(["admin"]);
  const locale = await getLocale();
  const t = getContent(locale).admin.sheet.bendTable;
  const supabase = await createClient();
  const versions = await listBendTableVersions(supabase);
  const active = versions.find((v) => v.active) ?? versions[0] ?? null;

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      {versions.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <div className="flex flex-col gap-6">
          <Panel flush>
            <TableWrap>
              <Table dense>
                <thead>
                  <tr>
                    <Th>{t.columns.label}</Th>
                    <Th>{t.columns.status}</Th>
                    <Th align="num">{t.columns.rows}</Th>
                    <Th align="num">{t.columns.usedBy}</Th>
                    <Th>{t.columns.created}</Th>
                    <Th>{t.columns.actions}</Th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <Td>
                        <Link href={routes.adminBendTableVersion(v.id)} className="lnk font-bold">
                          {v.label}
                        </Link>
                      </Td>
                      <Td>
                        <StatusChip severity={v.active ? "green" : "neutral"} label={v.active ? t.statusActive : t.statusDraft} />
                      </Td>
                      <Td align="num">{v.rowCount}</Td>
                      <Td align="num">{v.usedByQuotes}</Td>
                      <Td className="num whitespace-nowrap">
                        {formatDateTime(v.created_at, locale)}
                        {v.createdByName && <span className="ml-2 text-text-faint">{v.createdByName}</span>}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          <Link href={routes.adminBendTableVersion(v.id)} className="btn btn-ghost btn-sm">
                            {t.open}
                          </Link>
                          {!v.active && <BendActivateButton versionId={v.id} />}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Panel>
          {active && (
            <Panel title={t.cloneTitle}>
              <BendCloneForm sourceId={active.id} />
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
