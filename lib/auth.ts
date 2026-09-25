/**
 * Auth helpers for server components, server actions and route handlers.
 * File path: /lib/auth.ts
 *
 *   getCurrentUser()        → { user, profile } | null   (never throws)
 *   requireUser()           → redirects to /login when signed out
 *   requireRole(roles)      → redirects to / (403 page) when the role is wrong
 *   assertRole(roles)       → for API routes: returns the session or a
 *                             NextResponse 401/403 to return as-is
 *
 * Roles: admin (everything), sales (quotes, customers, uploads, override
 * requests), viewer (read-only). Rate tables, machines, users, override
 * decisions and the audit log are admin-only.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow, UserRole } from "@/lib/db/types";

export type Session = { user: User; profile: ProfileRow };

/**
 * Memoised per request (React cache): the layout, getLocale() and every
 * page call this, so without the cache one navigation costs several Auth
 * round-trips and profile selects.
 */
export const getCurrentUser = cache(async (): Promise<Session | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) return null;
    return { user, profile };
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<Session> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(roles: UserRole[]): Promise<Session> {
  const session = await requireUser();
  if (!roles.includes(session.profile.role)) redirect("/forbidden");
  return session;
}

export function hasRole(session: Session | null, roles: UserRole[]): boolean {
  return Boolean(session && roles.includes(session.profile.role));
}

/** Route-handler variant: returns a ready-made error response instead of redirecting. */
export async function assertRole(
  roles: UserRole[]
): Promise<{ session: Session; error: null } | { session: null; error: NextResponse }> {
  const session = await getCurrentUser();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  if (!roles.includes(session.profile.role)) {
    return {
      session: null,
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { session, error: null };
}

export const WRITE_ROLES: UserRole[] = ["admin", "sales"];
export const ALL_ROLES: UserRole[] = ["admin", "sales", "viewer"];
export const ADMIN_ONLY: UserRole[] = ["admin"];
