/**
 * Environment access — read lazily, never at module import time, so
 * `next build` succeeds on a machine (or Vercel preview) without the
 * Supabase variables set. Callers that actually need a value get a clear
 * error naming the missing variable.
 * File path: /lib/env.ts
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — see env.example and the README "Environment variables" table.`
    );
  }
  return value;
}

/**
 * Supabase issues two kinds of client keys: the legacy JWT "anon" key and
 * the newer "publishable" key (sb_publishable_…). Both work identically
 * with @supabase/ssr, so either variable name is accepted. Same for the
 * server key: legacy "service_role" JWT or the new secret key (sb_secret_…).
 */
export function publicSupabaseKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => {
    const key = publicSupabaseKey();
    if (!key) {
      throw new Error(
        "Missing environment variable NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) — see env.example."
      );
    }
    return key;
  },
  supabaseServiceRoleKey: () => {
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "Missing environment variable SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) — see env.example."
      );
    }
    return key;
  },
  /** True when the Supabase URL and a public key are present. */
  hasSupabase: () =>
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && publicSupabaseKey()),
  /** True when the server-side key is present (admin client usable). */
  hasSupabaseAdmin: () =>
    Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
    ),
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || null,
  hasAi: () => Boolean(process.env.ANTHROPIC_API_KEY),
  quoteFromAddress: () =>
    process.env.QUOTE_FROM_ADDRESS || process.env.MS_GRAPH_FROM_ADDRESS || null,
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
};

/** Name of the private Supabase Storage bucket holding every file. */
export const QUOTE_FILES_BUCKET = "quote-files";
