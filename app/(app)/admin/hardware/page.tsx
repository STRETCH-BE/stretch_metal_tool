/**
 * Hardware names — PRODUCT-name fragments of STEP hardware bodies mapped
 * to a hardware kind, size and rate feature code, with the add / correct form.
 * File path: /app/(app)/admin/hardware/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createClient } from "@/lib/supabase/server";
import { listHardwareNames } from "@/lib/admin/sheetmetal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { HardwareNameDelete, HardwareNameForm } from "@/components/admin/sheet-forms";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.sheet.hardware.title };
}

export default async function HardwareNamesPage() {
  await requireRole(["admin"]);
  const t = getContent(await getLocale()).admin.sheet.hardware;
  const supabase = await createClient();
  const rows = await listHardwareNames(supabase);

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-6">
        {rows.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <Panel flush>
            <TableWrap>
              <Table dense>
                <thead>
                  <tr>
                    <Th>{t.columns.pattern}</Th>
                    <Th>{t.columns.kind}</Th>
                    <Th>{t.columns.size}</Th>
                    <Th>{t.columns.featureCode}</Th>
                    <Th>{t.columns.note}</Th>
                    <Th>{t.columns.actions}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <Td className="mono font-bold">{row.pattern}</Td>
                      <Td>{t.kinds[row.kind]}</Td>
                      <Td>{row.size}</Td>
                      <Td className="mono">{row.feature_code ?? "—"}</Td>
                      <Td muted>{row.note ?? ""}</Td>
                      <Td>
                        <HardwareNameDelete row={row} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Panel>
        )}
        <Panel title={t.addTitle}>
          <HardwareNameForm />
        </Panel>
      </div>
    </>
  );
}
