/**
 * Locale resolution for the server (request-bound) + re-exports of the pure
 * formatters from lib/format.ts.
 * File path: /lib/i18n.ts
 *
 * SERVER ONLY (imports next/headers). Client components import the
 * formatters from "@/lib/format" instead — same functions, no server
 * dependency. Locale priority: the signed-in user's profile.locale → the
 * `locale` cookie (set by the language switcher on public pages) →
 * Accept-Language → "pl". UI strings never live in components: they come
 * from the typed dictionaries in /content via getContent().
 */

import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/lib/format";

export * from "@/lib/format";

/** Server-side locale for the current request. */
export async function getLocale(): Promise<Locale> {
  const session = await getCurrentUser();
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolveLocale({
    profileLocale: session?.profile.locale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
}

/** Locale for public pages (no session lookup). */
export async function getPublicLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolveLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
}
