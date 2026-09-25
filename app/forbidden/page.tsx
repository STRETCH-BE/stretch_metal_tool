/**
 * 403 page — a signed-in user opened an admin-only section.
 * File path: /app/forbidden/page.tsx
 */

import Link from "next/link";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";

export default async function ForbiddenPage() {
  const c = getContent(await getLocale());
  return (
    <main
      id="main"
      className="section-dark flex min-h-dvh flex-col items-center justify-center px-6 text-center"
    >
      <p className="eyebrow-label mb-4">403</p>
      <h1 className="h2-sm mb-4">{c.common.errors.forbidden}</h1>
      <p className="lead mb-8 max-w-md">{c.common.errors.forbiddenBody}</p>
      <Link href="/" className="btn btn-ghost-light">
        {c.common.nav.quotes}
        <span aria-hidden="true" className="btn-arrow">
          →
        </span>
      </Link>
    </main>
  );
}
