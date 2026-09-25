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

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** True when the three Supabase variables are present. */
  hasSupabase: () =>
    Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || null,
  hasAi: () => Boolean(process.env.ANTHROPIC_API_KEY),
  quoteFromAddress: () =>
    process.env.QUOTE_FROM_ADDRESS || process.env.MS_GRAPH_FROM_ADDRESS || null,
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
};

/** Name of the private Supabase Storage bucket holding every file. */
export const QUOTE_FILES_BUCKET = "quote-files";
