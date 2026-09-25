/**
 * 404 page.
 * File path: /app/not-found.tsx
 */

import Link from "next/link";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";

export default async function NotFound() {
  const c = getContent(await getLocale());
  return (
    <main
      id="main"
      className="section-dark flex min-h-dvh flex-col items-center justify-center px-6 text-center"
    >
      <p className="eyebrow-label mb-4">404</p>
      <h1 className="h2-sm mb-8">{c.common.errors.notFound}</h1>
      <Link href="/" className="btn btn-ghost-light">
        {c.common.nav.quotes}
        <span aria-hidden="true" className="btn-arrow">
          →
        </span>
      </Link>
    </main>
  );
}
