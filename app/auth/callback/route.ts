/**
 * Auth callback — lands magic-link / password-reset / invite links.
 * File path: /app/auth/callback/route.ts
 *
 * Supabase redirects here with ?code=… (PKCE). We exchange it for a
 * session (cookies are written by the server client) and send the user
 * to `next` (validated same-origin path) or the app root. Any failure —
 * missing code, expired link, Supabase not configured — goes back to
 * /login?error=callback. Public route (middleware PUBLIC_PATHS).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

function safeNext(value: string | null): string {
  if (!value) return routes.home;
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : routes.home;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const failure = new URL(`${routes.login}?error=callback`, origin);

  if (!code || searchParams.get("error") || !env.hasSupabase()) {
    return NextResponse.redirect(failure);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failure);
  } catch {
    return NextResponse.redirect(failure);
  }

  return NextResponse.redirect(new URL(next, origin));
}
