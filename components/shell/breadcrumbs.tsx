"use client";

/**
 * Breadcrumbs — default content of the topbar page slot: the section
 * label derived from the first path segment plus "new" sub-pages.
 * File path: /components/shell/breadcrumbs.tsx
 *
 * Detail pages (ids) show only the section: their PageHeader carries the
 * entity name. Labels come from content.common.nav / quote.customers.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContent } from "@/components/providers/locale";
import { routes } from "@/lib/routes";

type Crumb = { label: string; href?: string };

export function Breadcrumbs() {
  const c = useContent();
  const pathname = usePathname() ?? "/";
  const [first = "", second = ""] = pathname.split("/").filter(Boolean);

  const sections: Record<string, { label: string; href: string }> = {
    quotes: { label: c.common.nav.quotes, href: routes.quotes },
    upload: { label: c.common.nav.upload, href: routes.upload },
    parts: { label: c.common.nav.quotes, href: routes.quotes },
    customers: { label: c.common.nav.customers, href: routes.customers },
    admin: { label: c.common.nav.admin, href: routes.admin },
    guide: { label: c.common.nav.guide, href: routes.guide },
  };
  const adminSections: Record<string, string> = {
    rates: c.common.nav.rates,
    machines: c.common.nav.machines,
    calculator: c.common.nav.calculator,
    users: c.common.nav.users,
    overrides: c.common.nav.overrides,
    audit: c.common.nav.audit,
  };

  const crumbs: Crumb[] = [];
  const section = sections[first];
  if (section) crumbs.push({ label: section.label, href: section.href });
  if (first === "admin" && adminSections[second]) {
    crumbs.push({ label: adminSections[second] });
  } else if (second === "new") {
    crumbs.push({
      label: first === "customers" ? c.quote.customers.newTitle : c.common.nav.newQuote,
    });
  }

  if (crumbs.length === 0) return null;
  const last = crumbs.length - 1;

  return (
    <nav aria-label={c.common.shell.breadcrumbs} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-[11.5px] font-bold tracking-[0.14em] text-text-muted uppercase">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
            {index > 0 && (
              <span aria-hidden="true" className="text-red">
                /
              </span>
            )}
            {crumb.href && index !== last ? (
              <Link href={crumb.href} className="truncate hover:text-black">
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate text-black" aria-current={index === last ? "page" : undefined}>
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
