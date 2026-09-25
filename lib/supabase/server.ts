/**
 * Server Supabase client bound to the request cookies (RLS applies —
 * this client acts AS the signed-in user).
 * File path: /lib/supabase/server.ts
 *
 * Use in server components, server actions and route handlers for every
 * read/write that should respect row-level security. For privileged work
 * (signed URLs, audit log, re-pricing on send) use lib/supabase/admin.ts
 * AFTER checking the user's role with lib/auth.ts.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/types";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.supabaseUrl(),
    env.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — the middleware refreshes
            // sessions, so ignoring the write here is safe.
          }
        },
      },
    }
  );
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
