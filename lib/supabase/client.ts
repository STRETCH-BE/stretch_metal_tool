"use client";

/**
 * Browser Supabase client (anon key + the user's session cookie).
 * File path: /lib/supabase/client.ts
 *
 * Used by client components for auth (login/logout) and for direct
 * uploads to Storage through signed upload URLs. Data reads/writes go
 * through server components, server actions and route handlers.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null =
  null;

export function createClient() {
  if (browserClient) return browserClient;
  // Both variable names must be spelled out literally so Next.js inlines
  // them into the browser bundle.
  browserClient = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!
  );
  return browserClient;
}
