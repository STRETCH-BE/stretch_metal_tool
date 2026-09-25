"use client";

/**
 * LocaleSwitcher — PL / EN as two hard-edged chips; the active one is
 * black. Calls the setLocale server action (profile + cookie) and
 * refreshes the router so the whole tree re-renders in the new language.
 * File path: /components/shell/locale-switcher.tsx
 *
 * Works signed-out too (login page): setLocale then only writes the cookie.
 * `tone="dark"` keeps the inactive chips legible on black.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useContent } from "@/components/providers/locale";
import { siteConfig, type Locale } from "@/lib/site-config";
import { setLocale } from "@/lib/actions/locale";

export function LocaleSwitcher({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const c = useContent();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = c.locale;

  const choose = (locale: Locale) => {
    if (locale === current) return;
    startTransition(async () => {
      await setLocale(locale);
      router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={c.common.shell.localeSwitcher}
      className={`inline-flex ${className}`.trim()}
    >
      {siteConfig.locales.map((locale) => {
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={active}
            aria-label={c.common.locales[locale]}
            disabled={pending}
            onClick={() => choose(locale)}
            className={`chip chip-plain cursor-pointer ${active ? "" : "hover:text-black"} disabled:cursor-wait`}
            style={
              active
                ? {
                    background: "var(--color-black)",
                    color: "var(--color-white)",
                    borderColor: "var(--color-black)",
                  }
                : tone === "dark"
                  ? {
                      color: "var(--color-on-dark-soft)",
                      borderColor: "var(--color-line-dark)",
                    }
                  : undefined
            }
          >
            {locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
