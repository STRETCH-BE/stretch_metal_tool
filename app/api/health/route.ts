/**
 * Uptime probe — public, no auth (see middleware PUBLIC_PATHS).
 * File path: /app/api/health/route.ts
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    supabase: env.hasSupabase(),
    ai: env.hasAi(),
    time: new Date().toISOString(),
  });
}
