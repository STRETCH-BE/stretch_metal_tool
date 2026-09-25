/**
 * Auth callback — lands magic-link / password-reset / invite links.
 * File path: /app/auth/callback/route.ts
 *
 * Supabase redirects here with ?code=… (PKCE). We exchange it for a
 * session (cookies are written by the server client and merged into the
 * response by Next) and send the user to `next` (validated same-origin
 * path) or the app root. Any failure — missing code, expired link,
 * Supabase not configured — goes back to /login?error=callback. Public
 * route (middleware PUBLIC_PATHS).
 *
 * Redirects carry a RELATIVE Location. In a route handler `request.url`
 * and `request.nextUrl.origin` are the server's bind address (e.g.
 * http://localhost:3000) on any proxied / self-hosted deployment, so an
 * absolute redirect built from them would send the user to localhost.
 * A relative Location is resolved by the browser against the URL it
 * actually requested, which is the public origin whatever sits in front.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

const CALLBACK_FAILURE_PATH = `${routes.login}?error=callback`;

function safeNext(value: string | null): string {
  if (!value) return routes.home;
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : routes.home;
}

/** 307 to a same-origin path (relative Location — see file header). */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code || searchParams.get("error") || !env.hasSupabase()) {
    return redirectTo(CALLBACK_FAILURE_PATH);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectTo(CALLBACK_FAILURE_PATH);
  } catch {
    return redirectTo(CALLBACK_FAILURE_PATH);
  }

  return redirectTo(next);
}
