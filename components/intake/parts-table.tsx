"use client";

/**
 * PartsTable — the quote's parts on the upload page: thumbnail, name,
 * source chip, material / thickness, qty, triage chip, worst flag,
 * edit link and inline-confirm delete.
 * File path: /components/intake/parts-table.tsx
 *
 * Rows come from lib/parts/queries.ts listQuoteParts (server); delete
 * calls the deletePart action and refreshes the route so the server
 * list re-renders. Every control is a link or a button — keyboard
 * reachable in DOM order.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useContent, useLocale } from "@/components/providers/locale";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PartThumbnail } from "@/components/viewer/part-thumbnail";
import { TriageChip } from "@/components/triage/triage-chip";
import { routes } from "@/lib/routes";
import { formatMm, interpolate } from "@/lib/format";
import { deletePart } from "@/lib/parts/actions";
import type { PartListRow } from "@/lib/parts/queries";

export function PartsTable({ rows, canWrite }: { rows: PartListRow[]; canWrite: boolean }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.intake.parts;
  const router = useRouter();
  const { toast } = useToast();

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-[13.5px] text-text-muted">{t.empty}</p>;
  }

  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{t.columns.thumbnail}</Th>
            <Th>{t.columns.name}</Th>
            <Th>{t.columns.source}</Th>
            <Th>{t.columns.material}</Th>
            <Th align="num">{t.columns.qty}</Th>
            <Th>{t.columns.triage}</Th>
            <Th>{t.columns.flags}</Th>
            <Th>{t.columns.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>
                <PartThumbnail svg={row.thumbnailSvg} size={48} label={row.name} />
              </Td>
              <Td>
                <Link href={routes.part(row.id)} className="lnk font-bold">
                  {row.name}
                </Link>
                {row.hasPdf && <StatusChip severity="neutral" plain label={t.pdfAttached} className="ml-2" />}
              </Td>
              <Td>
                <StatusChip severity={row.source === "manual" ? "amber" : "neutral"} plain label={c.upload.intake.sources[row.source]} />
              </Td>
              <Td muted={!row.materialCode}>
                {row.materialCode ?? t.noMaterial}
                {row.thicknessMm !== null && ` · ${formatMm(row.thicknessMm, locale)} ${c.common.units.mm}`}
              </Td>
              <Td align="num">{row.qty}</Td>
              <Td>
                <TriageChip state={row.triageState} />
              </Td>
              <Td>
                {row.worstFlag ? (
                  <StatusChip severity={row.worstFlag} label={c.flags.severity[row.worstFlag]} />
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </Td>
              <Td>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={routes.part(row.id)} className="btn btn-ghost btn-sm">
                    {t.edit}
                  </Link>
                  {canWrite && (
                    <ConfirmButton
                      question={t.deleteConfirm}
                      action={async () => {
                        const result = await deletePart(row.id);
                        if (result.ok) {
                          toast(t.deleted, { tone: "success" });
                          router.refresh();
                        } else {
                          toast(c.upload.errors[result.error] ?? c.upload.errors.generic, { tone: "error" });
                        }
                      }}
                    >
                      {t.delete}
                    </ConfirmButton>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="px-4 py-2 text-[12px] text-text-faint">{interpolate(t.count, { count: rows.length })}</p>
    </TableWrap>
  );
}
