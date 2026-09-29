"use client";

/**
 * SettingsNav — the settings sub-navigation: a hard-edged .toolbar of
 * .tool-btn links, one per settings table plus the overview, the current
 * page marked aria-current="page" (red, like a pressed tool button).
 * File path: /components/admin/settings-nav.tsx
 *
 * Client component only for usePathname; labels from
 * content.admin.settings.nav, hrefs from routes.adminSettingsTable and
 * the slug map of lib/admin/settings-types.ts. The active colours are
 * token variables (never a raw hex) applied inline because .tool-btn's
 * pressed state is keyed to aria-pressed, a button-only attribute.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContent } from "@/components/providers/locale";
import { routes } from "@/lib/routes";
import { SETTINGS_TABLE_SLUGS, SETTINGS_TABLES } from "@/lib/admin/settings-types";

const ACTIVE_STYLE = { background: "var(--color-red)", color: "var(--color-white)" } as const;

export function SettingsNav() {
  const c = useContent();
  const pathname = usePathname() ?? "";
  const items = [
    { key: "index", href: routes.adminSettings, label: c.common.nav.settings },
    ...SETTINGS_TABLES.map((table) => ({
      key: table,
      href: routes.adminSettingsTable(SETTINGS_TABLE_SLUGS[table]),
      label: c.admin.settings.nav[table],
    })),
  ];
  return (
    <nav aria-label={c.admin.settings.navLabel} className="mb-6">
      <div className="toolbar">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.key} href={item.href} className="tool-btn" aria-current={active ? "page" : undefined} style={active ? ACTIVE_STYLE : undefined}>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
