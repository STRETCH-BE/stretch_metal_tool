"use server";

/**
 * Locale switcher server action.
 * File path: /lib/actions/locale.ts
 *
 * Persists the choice in two places so it holds everywhere: the profile
 * row (RLS lets a user update their own row — profiles_update_self) for
 * signed-in users, and the `locale` cookie (LOCALE_COOKIE) so the public
 * pages (/login, /guide) and the next request agree before the profile
 * is read. The root layout is revalidated so <html lang> and the content
 * dictionary switch immediately.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

const localeSchema = z.enum(LOCALES as [Locale, ...Locale[]]);

export async function setLocale(locale: Locale): Promise<{ ok: boolean }> {
  const parsed = localeSchema.safeParse(locale);
  if (!parsed.success) return { ok: false };
  const value = parsed.data;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: ONE_YEAR_S,
    sameSite: "lax",
    httpOnly: false,
  });

  if (env.hasSupabase()) {
    const session = await getCurrentUser();
    if (session && session.profile.locale !== value) {
      try {
        const supabase = await createClient();
        await supabase
          .from("profiles")
          .update({ locale: value })
          .eq("id", session.user.id);
      } catch (error) {
        console.error("[locale] profile update failed", error);
      }
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
