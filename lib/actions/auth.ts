"use server";

/**
 * Auth server actions — password sign-in, magic link, sign-out.
 * File path: /lib/actions/auth.ts
 *
 * All three are <form action> targets on /login (and the topbar). They
 * never throw to the client: every failure becomes a redirect back to
 * /login?error=<code> so the page stays a server component and shows the
 * message from content.common.login. Codes: invalid | config | magic |
 * validation. Input is zod-validated BEFORE any Supabase call — a bad
 * e-mail never reaches Auth (see test/ui/auth-action.test.ts).
 *
 * `next` (the page the middleware redirected from) is accepted only as a
 * same-origin absolute path to rule out open redirects.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { routes } from "@/lib/routes";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

const passwordSchema = z.string().min(1).max(256);

const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const nextSchema = z
  .string()
  .max(512)
  .refine((v) => v.startsWith("/") && !v.startsWith("//") && !v.includes("\\"))
  .optional();

type LoginError = "invalid" | "config" | "magic" | "validation";

function loginUrl(params: { error?: LoginError; sent?: boolean; next?: string }) {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.sent) search.set("sent", "1");
  if (params.next) search.set("next", params.next);
  const query = search.toString();
  return query ? `${routes.login}?${query}` : routes.login;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readNext(formData: FormData): string | undefined {
  const parsed = nextSchema.safeParse(readString(formData, "next") || undefined);
  return parsed.success ? parsed.data : undefined;
}

export async function signInWithPassword(formData: FormData): Promise<void> {
  const next = readNext(formData);
  const parsed = credentialsSchema.safeParse({
    email: readString(formData, "email"),
    password: readString(formData, "password"),
  });
  if (!parsed.success) {
    redirect(loginUrl({ error: "invalid", next }));
  }
  if (!env.hasSupabase()) {
    redirect(loginUrl({ error: "config", next }));
  }

  let failed = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) {
    redirect(loginUrl({ error: "invalid", next }));
  }
  redirect(next ?? routes.home);
}

export async function sendMagicLink(formData: FormData): Promise<void> {
  const next = readNext(formData);
  const parsed = emailSchema.safeParse(readString(formData, "email"));
  if (!parsed.success) {
    redirect(loginUrl({ error: "validation", next }));
  }
  if (!env.hasSupabase()) {
    redirect(loginUrl({ error: "config", next }));
  }

  const callback = new URL("/auth/callback", env.siteUrl());
  if (next) callback.searchParams.set("next", next);

  let failed = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo: callback.toString(),
        // Accounts are created by the admin (Users page); never self-signup.
        shouldCreateUser: false,
      },
    });
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) {
    redirect(loginUrl({ error: "magic", next }));
  }
  redirect(loginUrl({ sent: true, next }));
}

export async function signOut(): Promise<void> {
  if (env.hasSupabase()) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // Cookie already gone or Supabase unreachable — landing on /login is
      // still the right outcome.
    }
  }
  redirect(routes.login);
}
