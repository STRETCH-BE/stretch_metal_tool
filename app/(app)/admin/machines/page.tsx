/**
 * Machines list — code, name, kind, limits summary, last change; rows
 * link to the editor.
 * File path: /app/(app)/admin/machines/page.tsx
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { listMachines } from "@/lib/admin/machines";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.machines.title };
}

function limitsSummary(limits: unknown): string {
  if (!limits || typeof limits !== "object") return "";
  return Object.entries(limits as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" || typeof value === "string")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" · ");
}

export default async function MachinesPage() {
  await requireRole(["admin"]);
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.machines;
  const supabase = await createClient();
  const machines = await listMachines(supabase);

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      {machines.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <Panel flush>
          <TableWrap>
            <Table dense>
              <thead>
                <tr>
                  <Th>{t.columns.code}</Th>
                  <Th>{t.columns.name}</Th>
                  <Th>{t.columns.kind}</Th>
                  <Th>{t.columns.limits}</Th>
                  <Th>{t.columns.updated}</Th>
                </tr>
              </thead>
              <tbody>
                {machines.map((machine) => (
                  <tr key={machine.code}>
                    <Td className="mono">
                      <Link href={routes.adminMachine(machine.code)} className="lnk font-bold">
                        {machine.code}
                      </Link>
                    </Td>
                    <Td>{machine.name}</Td>
                    <Td>
                      <StatusChip severity="neutral" plain label={t.kinds[machine.kind]} />
                    </Td>
                    <Td className="mono text-[11.5px]" muted>
                      {limitsSummary(machine.limits)}
                    </Td>
                    <Td className="num whitespace-nowrap">
                      {formatDateTime(machine.updated_at, locale)}
                      {machine.updatedByName && <span className="ml-2 text-text-faint">{machine.updatedByName}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>
      )}
    </>
  );
}
