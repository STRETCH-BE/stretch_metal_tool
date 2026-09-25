/**
 * Quotes list — TEMPORARY landing page inside the shell until the quote
 * builder build step replaces it (wave 2). Keeps the app navigable after
 * login: the middleware sends every signed-in user here.
 * File path: /app/(app)/quotes/page.tsx
 */

import Link from "next/link";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export default async function QuotesPage() {
  const c = getContent(await getLocale());
  return (
    <>
      <PageHeader eyebrow={c.common.nav.groupWork} title={c.common.nav.quotes} />
      <EmptyState
        title={c.common.empty.quotes}
        action={
          <Link href={routes.customers} className="btn btn-ghost btn-sm">
            {c.common.nav.customers}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </Link>
        }
      />
    </>
  );
}
