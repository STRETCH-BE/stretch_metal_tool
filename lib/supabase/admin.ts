/**
 * Service-role Supabase client — bypasses RLS. SERVER ONLY.
 * File path: /lib/supabase/admin.ts
 *
 * Only call after the caller's role has been verified with lib/auth.ts
 * (requireRole / assertRole). Used for: signed Storage URLs, writing the
 * audit log, server-side re-pricing on save/send, admin user invites,
 * rate-version cloning. Never import from a client component.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { env } from "@/lib/env";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() must never run in the browser.");
  }
  return createSupabaseClient<Database>(
    env.supabaseUrl(),
    env.supabaseServiceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

export type AdminSupabase = ReturnType<typeof createAdminClient>;
