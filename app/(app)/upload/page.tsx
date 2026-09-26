/**
 * Upload landing — "start a new quote" (server action → createDraftQuote
 * → redirect to the quote's upload page) plus the user's own draft quotes
 * to continue.
 * File path: /app/(app)/upload/page.tsx
 *
 * Server component. Viewers see the drafts list (theirs — usually empty)
 * but no start button; the startNewQuote action re-checks the role.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser, hasRole, WRITE_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale, formatDateTime, interpolate } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { listRecentDrafts } from "@/lib/parts/queries";
import { startNewQuote } from "@/lib/parts/actions";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.upload.start.title };
}

export default async function UploadPage() {
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.upload.start;
  const session = await getCurrentUser();
  const canWrite = hasRole(session, WRITE_ROLES);
  const supabase = await createClient();
  const drafts = session ? await listRecentDrafts(supabase, session.user.id) : [];

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />

      <div className="flex flex-col gap-6">
        {canWrite && (
          <Panel>
            <form action={startNewQuote} className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-[13.5px] text-text-muted">{t.newQuoteHelp}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={routes.guide} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer">
                  {t.guideLink}
                </Link>
                <SubmitButton arrow pendingLabel={c.common.actions.loading}>
                  {t.newQuote}
                </SubmitButton>
              </div>
            </form>
          </Panel>
        )}

        <Panel title={t.recentTitle} flush>
          {drafts.length === 0 ? (
            <p className="px-4 py-6 text-[13.5px] text-text-muted">{t.recentEmpty}</p>
          ) : (
            <TableWrap>
              <Table dense>
                <thead>
                  <tr>
                    <Th>{t.columns.number}</Th>
                    <Th>{t.columns.customer}</Th>
                    <Th align="num">{t.columns.parts}</Th>
                    <Th>{t.columns.updated}</Th>
                    <Th>{t.columns.status}</Th>
                    <Th>{c.common.table.actions}</Th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft) => (
                    <tr key={draft.id}>
                      <Td>
                        <Link href={routes.quoteUpload(draft.id)} className="lnk font-bold">
                          {draft.number}
                          {draft.version > 1 ? `-v${draft.version}` : ""}
                        </Link>
                      </Td>
                      <Td muted={!draft.customerName}>{draft.customerName ?? t.noCustomer}</Td>
                      <Td align="num">{draft.partCount}</Td>
                      <Td>{formatDateTime(draft.updatedAt, locale)}</Td>
                      <Td>
                        <StatusChip severity={draft.status === "draft" ? "neutral" : "amber"} plain label={c.common.status[draft.status]} />
                      </Td>
                      <Td>
                        <Link href={routes.quoteUpload(draft.id)} className="btn btn-ghost btn-sm">
                          {t.continueQuote}
                          <span aria-hidden="true" className="btn-arrow">
                            →
                          </span>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="px-4 py-2 text-[12px] text-text-faint">{interpolate(c.common.table.results, { count: drafts.length })}</p>
            </TableWrap>
          )}
        </Panel>
      </div>
    </>
  );
}
