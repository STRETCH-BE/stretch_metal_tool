/**
 * RateVersionsTable — every rate version with status chip, quote usage,
 * placeholder count and the actions: clone (inline label form), activate
 * (inline confirm), delete (only draft versions, inline confirm).
 * File path: /components/admin/rate-versions-table.tsx
 *
 * Server component; the bound server actions are handed to the client
 * ConfirmButton / CloneVersionForm.
 */

import Link from "next/link";
import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { RateVersionSummary } from "@/lib/admin/rates";
import { activateRateVersionAction, deleteRateVersionAction } from "@/lib/admin/rates-actions";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { CloneVersionForm } from "@/components/admin/clone-version-form";

export function RateVersionsTable({
  versions,
  content,
  locale,
}: {
  versions: RateVersionSummary[];
  content: Content;
  locale: Locale;
}) {
  const t = content.admin.rates.versions;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{t.columns.label}</Th>
            <Th>{t.columns.status}</Th>
            <Th>{t.columns.created}</Th>
            <Th>{t.columns.createdBy}</Th>
            <Th align="num">{t.columns.usedBy}</Th>
            <Th align="num">{t.columns.placeholders}</Th>
            <Th>{t.columns.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => {
            const draft = !version.active && version.quoteCount === 0;
            return (
              <tr key={version.id}>
                <Td>
                  <Link href={routes.adminRateVersion(version.id)} className="lnk font-bold">
                    {version.label}
                  </Link>
                  {version.note && <p className="mt-1 max-w-[420px] text-[12px] text-text-faint">{version.note}</p>}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {version.active ? (
                      <StatusChip severity="green" label={t.statusActive} />
                    ) : (
                      <StatusChip severity="neutral" label={t.statusDraft} />
                    )}
                    {version.quoteCount > 0 && <StatusChip severity="dark" plain label={t.statusUsed} />}
                  </span>
                </Td>
                <Td className="num">{formatDate(version.created_at, locale)}</Td>
                <Td muted={!version.createdByName}>{version.createdByName ?? content.admin.audit.system}</Td>
                <Td align="num">{version.quoteCount}</Td>
                <Td align="num">
                  {version.placeholderCount > 0 ? (
                    <StatusChip severity="placeholder" plain label={String(version.placeholderCount)} />
                  ) : (
                    0
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <CloneVersionForm sourceId={version.id} compact />
                    {!version.active && (
                      <ConfirmButton
                        action={activateRateVersionAction.bind(null, version.id)}
                        question={t.activateQuestion}
                        variant="ghost"
                      >
                        {t.activate}
                      </ConfirmButton>
                    )}
                    {draft && (
                      <ConfirmButton
                        action={deleteRateVersionAction.bind(null, version.id)}
                        question={t.deleteQuestion}
                        variant="ghost"
                      >
                        {t.delete}
                      </ConfirmButton>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}
