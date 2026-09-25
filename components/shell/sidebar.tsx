"use client";

/**
 * Sidebar — black navigation rail: logo lockup with the "QUOTE" suffix,
 * the Work group for everyone and the Admin group for admins only.
 * File path: /components/shell/sidebar.tsx
 *
 * Active link = the longest route prefix matching the pathname (so
 * /quotes/new lights "New quote", /quotes/<id> lights "Quotes"), exposed
 * as aria-current="page". Below 1024 px (Tailwind `lg`) the rail becomes
 * a top bar (globals.css) and the nav collapses behind a menu button;
 * the menu closes on navigation. Labels come from content.common.nav.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Logo } from "@/components/ui/logo";
import { routes } from "@/lib/routes";
import type { UserRole } from "@/lib/db/types";
import type { CommonContent } from "@/content/common";

type NavItem = { key: keyof CommonContent["nav"]; href: string };

const WORK_ITEMS: NavItem[] = [
  { key: "quotes", href: routes.quotes },
  { key: "newQuote", href: routes.quoteNew },
  { key: "upload", href: routes.upload },
  { key: "customers", href: routes.customers },
  { key: "guide", href: routes.guide },
];

const ADMIN_ITEMS: NavItem[] = [
  { key: "rates", href: routes.adminRates },
  { key: "machines", href: routes.adminMachines },
  { key: "calculator", href: routes.adminCalculator },
  { key: "users", href: routes.adminUsers },
  { key: "overrides", href: routes.adminOverrides },
  { key: "audit", href: routes.adminAudit },
];

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (matches(pathname, item.href) && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}

export function Sidebar({ role }: { role: UserRole }) {
  const c = useContent();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const navId = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const groups: { label: string; items: NavItem[] }[] = [
    { label: c.common.nav.groupWork, items: WORK_ITEMS },
  ];
  if (role === "admin") {
    groups.push({ label: c.common.nav.groupAdmin, items: ADMIN_ITEMS });
  }
  const active = activeHref(
    pathname,
    groups.flatMap((group) => group.items)
  );

  return (
    <aside className="app-sidebar">
      <div
        className="flex items-center justify-between border-b border-line-dark px-5"
        style={{ height: "var(--app-topbar-h)" }}
      >
        <Logo ariaLabel={c.common.app.logoAria} suffix="QUOTE" href={routes.quotes} />
        <span className="lg:hidden">
          <button
            type="button"
            className="tool-btn"
            aria-expanded={open}
            aria-controls={navId}
            aria-label={open ? c.common.shell.closeMenu : c.common.shell.openMenu}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? c.common.shell.closeMenu : c.common.shell.menu}
          </button>
        </span>
      </div>

      <nav
        id={navId}
        aria-label={c.common.app.mainNav}
        className={`${open ? "flex" : "hidden"} flex-1 flex-col overflow-y-auto pb-6 lg:flex`}
      >
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              const isActive = item.href === active;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="nav-link"
                  aria-current={isActive ? "page" : undefined}
                >
                  {c.common.nav[item.key]}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="hidden border-t border-line-dark px-5 py-3 text-[10.5px] font-bold tracking-[0.2em] text-on-dark-muted uppercase lg:block">
        {c.common.app.name}
      </div>
    </aside>
  );
}
