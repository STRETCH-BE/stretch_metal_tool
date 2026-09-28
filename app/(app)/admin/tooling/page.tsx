/**
 * Press-brake tooling — punches and dies for the DFM checks, with the
 * add / correct form; placeholder rows carry a chip until replaced.
 * File path: /app/(app)/admin/tooling/page.tsx
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listPressBrakeTools } from "@/lib/admin/sheetmetal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { ToolDelete, ToolForm } from "@/components/admin/sheet-forms";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.sheet.tooling.title };
}

export default async function ToolingPage() {
  await requireRole(["admin"]);
  const locale = await getLocale();
  const t = getContent(locale).admin.sheet.tooling;
  const supabase = await createClient();
  const tools = await listPressBrakeTools(supabase);
  const n = (value: number | null) => (value === null ? "—" : formatNumber(value, locale, { maximumFractionDigits: 2 }));

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-6">
        {tools.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <Panel flush>
            <TableWrap>
              <Table dense>
                <thead>
                  <tr>
                    <Th>{t.columns.code}</Th>
                    <Th>{t.columns.kind}</Th>
                    <Th>{t.columns.name}</Th>
                    <Th align="num">{t.columns.height}</Th>
                    <Th>{t.columns.type}</Th>
                    <Th align="num">{t.columns.tipRadius}</Th>
                    <Th align="num">{t.columns.throat}</Th>
                    <Th align="num">{t.columns.v}</Th>
                    <Th align="num">{t.columns.minFlange}</Th>
                    <Th>{t.columns.placeholder}</Th>
                    <Th>{t.columns.actions}</Th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => (
                    <tr key={tool.code}>
                      <Td className="mono font-bold">{tool.code}</Td>
                      <Td>{t.kinds[tool.kind]}</Td>
                      <Td>{tool.name}</Td>
                      <Td align="num">{n(tool.height_mm)}</Td>
                      <Td>{tool.type ? t.types[tool.type] : "—"}</Td>
                      <Td align="num">{n(tool.tip_radius_mm)}</Td>
                      <Td align="num">{n(tool.throat_depth_mm)}</Td>
                      <Td align="num">{n(tool.v_mm)}</Td>
                      <Td align="num">{n(tool.min_flange_mm)}</Td>
                      <Td>{tool.placeholder && <StatusChip severity="amber" plain label={t.placeholderChip} />}</Td>
                      <Td>
                        <ToolDelete tool={tool} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Panel>
        )}
        <Panel title={t.addTitle}>
          <ToolForm />
        </Panel>
      </div>
    </>
  );
}
