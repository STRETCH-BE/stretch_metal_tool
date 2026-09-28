/**
 * One bend-table version — its rows and the test-bend form; rows of a
 * version a quote pins are read-only (clone to edit).
 * File path: /app/(app)/admin/bend-table/[id]/page.tsx
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { formatNumber, interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/parts/schema";
import { loadBendTableVersion } from "@/lib/admin/sheetmetal";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { BendActivateButton, BendRowDelete, BendRowForm } from "@/components/admin/sheet-forms";

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.sheet.bendTable.title };
}

export default async function BendTableVersionPage({ params }: { params: Params }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.sheet.bendTable;
  const v = t.version;
  const supabase = await createClient();
  const detail = await loadBendTableVersion(supabase, id);
  if (!detail) notFound();
  const locked = detail.usedByQuotes > 0;
  const n = (value: number, decimals = 2) => formatNumber(value, locale, { maximumFractionDigits: decimals });

  return (
    <>
      <PageHeader
        eyebrow={v.eyebrow}
        title={interpolate(v.title, { label: detail.version.label })}
        subtitle={t.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip severity={detail.version.active ? "green" : "neutral"} label={detail.version.active ? t.statusActive : t.statusDraft} />
            {!detail.version.active && <BendActivateButton versionId={detail.version.id} />}
            <Link href={routes.adminBendTable} className="btn btn-ghost btn-sm">
              {v.backToList}
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        {locked && <Notice tone="info">{v.immutable}</Notice>}
        <Panel flush>
          {detail.rows.length === 0 ? (
            <p className="px-4 py-6 text-[13.5px] text-text-muted">{v.empty}</p>
          ) : (
            <TableWrap>
              <Table dense>
                <thead>
                  <tr>
                    <Th>{v.columns.family}</Th>
                    <Th align="num">{v.columns.thickness}</Th>
                    <Th align="num">{v.columns.radius}</Th>
                    <Th align="num">{v.columns.vDie}</Th>
                    <Th align="num">{v.columns.angle}</Th>
                    <Th align="num">{v.columns.allowance}</Th>
                    <Th>{v.columns.source}</Th>
                    <Th>{v.columns.note}</Th>
                    <Th>{v.columns.actions}</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((row) => (
                    <tr key={row.id}>
                      <Td>{c.admin.rates.options.family[row.material_family]}</Td>
                      <Td align="num">{n(row.thickness_mm)}</Td>
                      <Td align="num">{n(row.inner_radius_mm)}</Td>
                      <Td align="num">{row.v_die_mm === null ? "—" : n(row.v_die_mm)}</Td>
                      <Td align="num">{n(row.angle_deg, 1)}</Td>
                      <Td align="num">{n(row.bend_allowance_mm, 4)}</Td>
                      <Td>
                        <StatusChip severity={row.source === "test_bend" ? "green" : "amber"} plain label={v.sources[row.source]} />
                      </Td>
                      <Td muted className="max-w-[280px] truncate">
                        {row.note ?? ""}
                      </Td>
                      <Td>{!locked && <BendRowDelete versionId={detail.version.id} row={row} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Panel>
        <Panel title={v.addTitle}>
          <BendRowForm versionId={detail.version.id} disabled={locked} />
        </Panel>
      </div>
    </>
  );
}
